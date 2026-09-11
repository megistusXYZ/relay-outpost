/**
 * Concord invites (CORD-05): revocable shareable links + gift-wrapped direct
 * invites. The link's secret token lives in the URL fragment and never touches
 * a relay; a public kind-33301 bundle holds the encrypted key material.
 *
 * The fragment codec + bundle encrypt/decrypt + community_id verification are
 * pure and unit-tested; the relay/IDB I/O around them is not.
 */
import { generateSecretKey, getPublicKey, finalizeEvent, nip19, type Event } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { bundleKeyFromToken, legacyBundleKeyFromToken, verifyCommunityId } from "./concord-crypto";
import { KIND_INVITE_BUNDLE, KIND_CONTROL_EDITION, VSK, buildJoinLeaveRumor, parseControlEdition, type ControlEdition } from "./concord-events";
import { putCommunity, getCommunity, publishCommunityList, putInviteSigner, getInviteSigners, type StoredCommunity, type StoredInviteSigner } from "./concord-keys";
import { publishGuestbook, subscribeGovernance } from "./concord-stream";
import { checkHeldBundle, anchorsGenesis } from "./concord-invite-guard";
import { parseCommunityImage, type CommunityImage } from "./concord-image";
import { persistentPoolSubscribe } from "@/lib/nostr";
import { inviteAttribution } from "./concord-invite-links";
import { createGiftWrap, publishWithFallback } from "@/lib/dm";
import { fetchDMRelayList, hasDMRelayList, getDMRelaysForContact } from "@/lib/outbox";

// Stock relay dictionary for flags=1 (CORD-05 §fragment).
const STOCK_RELAYS = [
  "wss://jskitty.com/nostr",
  "wss://asia.vectorapp.io/nostr",
  "wss://relay.ditto.pub",
  "wss://relay.dreamith.to",
];

const FRAGMENT_VERSION = 4;
export const KIND_DIRECT_INVITE = 3313;

// ── base64url (no padding) ────────────────────────────────────────────────────
function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Fragment codec (pure, CORD-05) ────────────────────────────────────────────
export interface DecodedFragment { version: number; token: Uint8Array; relays: string[] }

/**
 * Encode a fragment: `[version][flags][relays?][token:16]` base64url. Uses
 * flags=1 (stock relays, no relay bytes) when `relays` ⊆ the stock set;
 * otherwise custom literals (0x00 host form). Max 3 bootstrap relays.
 */
export function encodeFragment(token: Uint8Array, relays?: string[]): string {
  const useStock = !relays || relays.length === 0 || relays.every((r) => STOCK_RELAYS.includes(r));
  const head: number[] = [FRAGMENT_VERSION, useStock ? 1 : 0];
  if (!useStock) {
    const custom = relays!.slice(0, 3);
    head.push(custom.length);
    for (const r of custom) {
      const host = r.replace(/^wss:\/\//, "");
      if (r.startsWith("wss://") && host === r.slice(6)) {
        const hb = new TextEncoder().encode(host);
        head.push(0x00, hb.length, ...hb);
      } else {
        const fb = new TextEncoder().encode(r);
        head.push(0xff, fb.length, ...fb);
      }
    }
  }
  const out = new Uint8Array(head.length + token.length);
  out.set(head, 0);
  out.set(token, head.length);
  return b64urlEncode(out);
}

export function decodeFragment(fragment: string): DecodedFragment | null {
  try {
    // Chat linkifiers (incl. our own Messages URL regex) can swallow trailing
    // sentence punctuation into the href — cut everything from the first
    // non-base64url character so a pasted "…#<frag>." still decodes.
    const clean = fragment.replace(/^#/, "").replace(/[^A-Za-z0-9_-][\s\S]*$/, "");
    const bytes = b64urlDecode(clean);
    let i = 0;
    const version = bytes[i++];
    if (version < FRAGMENT_VERSION) return null;
    const flags = bytes[i++];
    const relays: string[] = [];
    if ((flags & 1) === 1) {
      relays.push(...STOCK_RELAYS);
    } else {
      const count = bytes[i++];
      for (let n = 0; n < count; n++) {
        const kind = bytes[i++];
        if (kind === 0x00) {
          const len = bytes[i++]; const host = new TextDecoder().decode(bytes.slice(i, i + len)); i += len;
          relays.push("wss://" + host);
        } else if (kind === 0xff) {
          const len = bytes[i++]; relays.push(new TextDecoder().decode(bytes.slice(i, i + len))); i += len;
        } else if (kind >= 1 && kind <= STOCK_RELAYS.length) {
          relays.push(STOCK_RELAYS[kind - 1]); // dictionary ref
        }
      }
    }
    const token = bytes.slice(bytes.length - 16);
    if (token.length !== 16) return null;
    return { version, token, relays };
  } catch {
    return null;
  }
}

// ── Bundle shape ──────────────────────────────────────────────────────────────
export interface InviteBundle {
  community_id: string;
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  /** The admin plane's address (CORD-02 §5), hex. Absent = a legacy group (CORD-05 §1). */
  control_pk?: string;
  channels: { id: string; key?: string; epoch: number; name: string }[];
  relays: string[];
  name: string;
  /** A plain photo URL, as our older groups carry it. Only ever a string here. */
  icon?: string;
  /**
   * The group's encrypted photo (CORD-02 §6). On the wire this is `icon` as an
   * object, which is how Armada and Vector write it; it's split out here so
   * every reader of `icon` keeps getting a string.
   */
  iconImage?: CommunityImage;
  expires_at?: number;
  creator_npub?: string;
  label?: string;
}

export function encryptBundle(bundle: InviteBundle, token: Uint8Array): string {
  const { iconImage, ...rest } = bundle;
  const wire = iconImage ? { ...rest, icon: iconImage } : rest;
  // New links always use the canonical cross-client key.
  return nip44v2.encrypt(JSON.stringify(wire), bundleKeyFromToken(token));
}
/**
 * TOLERANT DUAL-READ (Armada interop). `icon` is a plain URL from us, or the
 * spec's encrypted-photo OBJECT ({url,key,nonce,hash}) from Armada and Vector,
 * and every string reader of `icon` threw on the object (`icon?.trim()`). The
 * object moves to `iconImage`, only if it's a pointer we can safely fetch, and
 * `icon` is left a string or nothing. `iconImage` itself is never taken from
 * the wire. Every way a bundle arrives (link or direct invite) comes through here.
 */
function normalizeBundleIcon(bundle: InviteBundle): InviteBundle {
  const image = typeof bundle.icon === "string" ? null : parseCommunityImage(bundle.icon);
  if (typeof bundle.icon !== "string") delete bundle.icon;
  delete bundle.iconImage;
  if (image) bundle.iconImage = image;
  return bundle;
}

export function decryptBundle(ciphertext: string, token: Uint8Array): InviteBundle | null {
  // Dual-read: try the canonical bundle_key first (cross-client + all new links),
  // then fall back to the legacy label-only key so invite links our users already
  // shared before the HKDF fix still open in OUR client. Null-safe, never throws.
  for (const derive of [bundleKeyFromToken, legacyBundleKeyFromToken]) {
    try {
      const bundle = JSON.parse(nip44v2.decrypt(ciphertext, derive(token))) as InviteBundle;
      if (bundle && typeof bundle === "object") normalizeBundleIcon(bundle);
      return bundle;
    } catch {
      /* try the next key */
    }
  }
  return null;
}

/**
 * Build the CommunityInvite bundle for a standard invite (link or direct):
 * the community root + the PUBLIC channels only.
 *
 * SECURITY (CORD-03/05): a private channel is "readable only by granted
 * role-holders" and its independent key is "delivered on grant" — never in a
 * general invite. A public channel's key derives from `community_root`
 * (CORD-03 §1: "it adds nothing to an invite"), so public entries carry no
 * key either; they ride along for names/preview. Private channels are omitted
 * ENTIRELY (no key, no id, no name) — membership alone must not disclose
 * them, and access flows only through the explicit channel-scoped rekey grant
 * (concord-governance createPrivateChannel / concord-rekey).
 */
export function bundleFromCommunity(c: StoredCommunity, creatorNpub?: string, label?: string, expiresAt?: number): InviteBundle {
  return {
    community_id: c.community_id, owner: c.owner, owner_salt: c.owner_salt,
    community_root: c.community_root, root_epoch: c.root_epoch,
    // Whoever joins needs the admin address to see the group's rooms and roles.
    ...(c.control_pk ? { control_pk: c.control_pk } : {}),
    channels: c.channels
      .filter((ch) => !ch.isPrivate && !ch.key)
      .map((ch) => ({ id: ch.id, epoch: ch.epoch, name: ch.name })),
    relays: c.relays, name: c.name, icon: c.icon, expires_at: expiresAt, creator_npub: creatorNpub, label,
    // The group's encrypted photo goes out as the spec's `icon` (encryptBundle).
    ...(c.iconImage ? { iconImage: c.iconImage } : {}),
  };
}

// ── Mint / revoke link (I/O) ──────────────────────────────────────────────────
type PublishFn = (event: Event, relays: string[]) => Promise<unknown>;

/**
 * Mint a revocable invite link. Generates a one-use link_signer, publishes the
 * encrypted 33301 bundle signed by it, records the signer secret for revocation,
 * and returns the shareable `${base}/invite/<naddr>#<fragment>` URL.
 */
export async function mintInviteLink(
  ownerPubkey: string,
  community: StoredCommunity,
  baseUrl: string,
  publish: PublishFn,
  opts?: { label?: string; expiresAt?: number; creatorNpub?: string },
): Promise<string> {
  const linkSk = generateSecretKey();
  const linkPk = getPublicKey(linkSk);
  const token = generateSecretKey().slice(0, 16);

  const bundle = bundleFromCommunity(community, opts?.creatorNpub, opts?.label, opts?.expiresAt);
  const content = encryptBundle(bundle, token);
  // CORD-05: the joinable addressable invite marker is vsk 6 (NOT the vsk-8
  // invite-link registry). Amethyst & other Concord clients key on vsk 6 to
  // recognize a bundle — emitting 8 made our invites invisible to them.
  const event = finalizeEvent({ kind: KIND_INVITE_BUNDLE, created_at: Math.floor(Date.now() / 1000), tags: [["d", ""], ["vsk", String(VSK.INVITE)]], content }, linkSk);
  await publish(event, community.relays).catch(() => {});

  await putInviteSigner(ownerPubkey, {
    communityId: community.community_id, linkSignerPubkey: linkPk, linkSignerSecret: bytesToHex(linkSk),
    token: bytesToHex(token), label: opts?.label, createdAt: Date.now(), publishedAt: event.created_at,
    ...(opts?.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  });

  const naddr = nip19.naddrEncode({ kind: KIND_INVITE_BUNDLE, pubkey: linkPk, identifier: "", relays: community.relays.slice(0, 3) });
  return `${baseUrl.replace(/\/+$/, "")}/invite/${naddr}#${encodeFragment(token, community.relays)}`;
}

/**
 * Rebuild the shareable URL for an already-minted link (used to show a QR for
 * an "Active link"). Pure: same naddr + fragment construction as mintInviteLink,
 * fed from the stored signer record instead of freshly generated keys.
 */
export function rebuildInviteLink(
  link: Pick<StoredInviteSigner, "linkSignerPubkey" | "token">,
  community: Pick<StoredCommunity, "relays">,
  baseUrl: string,
): string {
  const naddr = nip19.naddrEncode({ kind: KIND_INVITE_BUNDLE, pubkey: link.linkSignerPubkey, identifier: "", relays: community.relays.slice(0, 3) });
  return `${baseUrl.replace(/\/+$/, "")}/invite/${naddr}#${encodeFragment(hexToBytes(link.token), community.relays)}`;
}

/**
 * Refresh this creator's LIVE invite links after a key rotation (CORD-05 §2:
 * "the creator re-posting under it refreshes the bundle — fresh keys behind
 * the same URL — so a link shared once survives every rotation"). Re-encrypts
 * the current bundle with each link's original token and republishes the 33301
 * coordinate with its stored link_signer. Best-effort: only links minted on
 * THIS device (whose signer secrets we hold) can be refreshed; without it a
 * shared QR link keeps handing out the pre-rekey root and new joiners see
 * nothing. Skips revoked links.
 */
export async function refreshInviteLinks(
  ownerPubkey: string,
  community: StoredCommunity,
  publish: PublishFn,
  /** The links to refresh; defaults to this device's. */
  links?: StoredInviteSigner[],
  /**
   * What the relays hold at a link's address. Links sync between devices
   * (CORD-05 §4), so one this device still thinks is live may have been turned
   * off elsewhere; re-posting it would bring it back. Checked when given.
   */
  fetchCurrent?: (linkSigner: string, relays: string[]) => Promise<Event[]>,
): Promise<void> {
  const signers = links ?? await getInviteSigners(ownerPubkey, community.community_id).catch(() => [] as StoredInviteSigner[]);
  for (const s of signers) {
    if (s.revoked) continue;
    try {
      if (fetchCurrent) {
        const current = pickBundleEvent(await fetchCurrent(s.linkSignerPubkey, community.relays).catch(() => []));
        if (current && isRevokedBundleEvent(current)) {
          await putInviteSigner(ownerPubkey, { ...s, revoked: true });
          continue;
        }
      }
      // Fresh keys, same link: its name, expiry and creator stay. Dropping them
      // here un-expired every link and wiped its join attribution on each rekey.
      const bundle = bundleFromCommunity(community, nip19.npubEncode(ownerPubkey), s.label, s.expiresAt);
      const content = encryptBundle(bundle, hexToBytes(s.token));
      const event = finalizeEvent(
        { kind: KIND_INVITE_BUNDLE, created_at: Math.floor(Date.now() / 1000), tags: [["d", ""], ["vsk", String(VSK.INVITE)]], content },
        hexToBytes(s.linkSignerSecret),
      );
      await publish(event, community.relays).catch(() => {});
      await putInviteSigner(ownerPubkey, { ...s, publishedAt: event.created_at });
    } catch { /* best-effort per link */ }
  }
}

/**
 * Revoke a link: republish its 33301 coordinate as a vsk-9 tombstone (link_signer-signed).
 * Dated after the link's last bundle (`lastBundleAt`, unix s): a relay keeping one
 * event per address may keep the bundle over a tombstone from the same second.
 */
export async function revokeInviteLink(linkSignerSecretHex: string, relays: string[], publish: PublishFn, lastBundleAt?: number): Promise<void> {
  const sk = hexToBytes(linkSignerSecretHex);
  const createdAt = Math.max(Math.floor(Date.now() / 1000), (lastBundleAt ?? 0) + 1);
  const tombstone = finalizeEvent({ kind: KIND_INVITE_BUNDLE, created_at: createdAt, tags: [["d", ""], ["vsk", String(VSK.REVOKED)]], content: "" }, sk);
  await publish(tombstone, relays).catch(() => {});
}

/**
 * Recognize a JOINABLE invite-bundle event vs a revocation tombstone (CORD-05).
 *
 * Dual-read (back-compat): the spec's addressable invite marker is `vsk 6`; we
 * ALSO accept legacy `vsk 8` bundles this client minted before the 8→6 fix, so
 * links already shared in the wild keep working. A `vsk 9` tombstone (empty
 * content) is rejected. Any other/absent vsk WITH content is still accepted for
 * maximum cross-client interop — only the revocation marker gates joinability.
 *
 * Returns true if the event is a revoked/empty tombstone (i.e. NOT joinable).
 */
export function isRevokedBundleEvent(event: { tags: string[][]; content: string }): boolean {
  const vsk = event.tags.find((t) => t[0] === "vsk")?.[1];
  return vsk === String(VSK.REVOKED) || !event.content;
}

/**
 * The event that speaks for a link, from every version seen at its address.
 * A tombstone anywhere wins: turning a link off is for good (CORD-05 §2, §4),
 * so neither a same-second bundle nor one a stale device posted later brings
 * it back. Otherwise the newest bundle.
 */
export function pickBundleEvent(events: Event[]): Event | null {
  const tombstones = events.filter(isRevokedBundleEvent);
  return (tombstones.length ? tombstones : events).reduce<Event | null>((best, e) => (!best || e.created_at > best.created_at ? e : best), null);
}

// ── Parse + accept a link (I/O) ───────────────────────────────────────────────
// parseInviteUrl moved to the dependency-light `invite-detect.ts` so the feed/
// DM renderers and paste faucets can detect cross-client invite links without
// pulling this module's I/O deps into their bundles. Re-exported for callers.
export { parseInviteUrl, detectGroupInvite, type GroupInviteTarget } from "./invite-detect";

/**
 * Accept an invite link. Decodes the fragment, fetches the 33301 bundle from the
 * bootstrap relays, decrypts it, VERIFIES the community_id recomputes from
 * owner+salt (rejects a spoofed bundle), stores the keys, and publishes a
 * guestbook join + Community List sync. Returns the joined community or null.
 */
export async function acceptInviteLink(
  ownerPubkey: string,
  signer: ISigner,
  naddr: string,
  fragment: string,
  fetchBundle: (linkSignerPubkey: string, relays: string[]) => Promise<Event | null>,
  publish: PublishFn,
  publishSelf: (e: Event) => Promise<unknown>,
): Promise<JoinResult | null> {
  const frag = decodeFragment(fragment);
  if (!frag) return null;
  let decoded: nip19.DecodedResult;
  try { decoded = nip19.decode(naddr); } catch { return null; }
  if (decoded.type !== "naddr" || decoded.data.kind !== KIND_INVITE_BUNDLE) return null;
  const linkSignerPubkey = decoded.data.pubkey;
  const bootstrapRelays = [...new Set([...(decoded.data.relays ?? []), ...frag.relays])];

  const event = await fetchBundle(linkSignerPubkey, bootstrapRelays).catch(() => null);
  if (!event) return null;
  // Dual-read: accept the vsk-6 marker AND legacy vsk-8 bundles; reject the
  // vsk-9 tombstone (empty content). See isRevokedBundleEvent.
  if (isRevokedBundleEvent(event)) return null;

  const bundle = decryptBundle(event.content, frag.token);
  if (!bundle) return null;
  if (bundle.expires_at && Date.now() > bundle.expires_at) return null;
  // Thread the bootstrap relays through so a bundle with a thin/absent relay
  // list still yields a community we can actually fetch from (union — never
  // narrower than the bundle's own list).
  return adoptInviteBundle(ownerPubkey, signer, bundle, publish, publishSelf, bootstrapRelays);
}

/**
 * The stored record an invite bundle becomes. Pure: adoptInviteBundle checks
 * the bundle first and persists the result. Only a real key is kept as the
 * admin address; anything else reads as a legacy group (CORD-05 §1).
 */
export function recordFromBundle(bundle: InviteBundle, bootstrapRelays: string[]): StoredCommunity {
  const channels = Array.isArray(bundle.channels) ? bundle.channels : [];
  const controlPk = typeof bundle.control_pk === "string" && /^[0-9a-f]{64}$/.test(bundle.control_pk) ? bundle.control_pk : undefined;
  const iconImage = parseCommunityImage(bundle.iconImage);
  return {
    community_id: bundle.community_id, owner: bundle.owner, owner_salt: bundle.owner_salt,
    community_root: bundle.community_root, root_epoch: bundle.root_epoch,
    ...(controlPk ? { control_pk: controlPk } : {}),
    channels: channels.map((ch) => ({ id: ch.id, key: ch.key, epoch: ch.epoch, name: ch.name, isPrivate: !!ch.key })),
    relays: [...new Set([...(bundle.relays ?? []), ...bootstrapRelays])].slice(0, 5),
    name: bundle.name, icon: typeof bundle.icon === "string" ? bundle.icon : undefined, addedAt: Date.now(),
    ...(iconImage ? { iconImage } : {}),
  };
}

/**
 * What accepting an invite did. `already`: you hold this group; any rooms you
 * were missing were added, and `kept` says the invite carried other keys (an
 * old link, say), so yours were kept. `unverified`: the owner's own record
 * didn't open under the invite's keys, or couldn't be read yet — nothing was
 * kept or announced. `invalid`: the group id doesn't match its owner, or the
 * bundle is malformed.
 */
export type JoinResult =
  | { status: "joined"; record: StoredCommunity }
  | { status: "already"; record: StoredCommunity; added: number; kept?: true }
  | { status: "unverified" }
  | { status: "invalid" };

/** How long a join waits for the owner's record on the admin plane. */
const ANCHOR_WAIT_MS = 5000;

/**
 * The genesis anchor, read live: subscribe to the admin plane the invite's keys
 * open, and settle as soon as the owner's record shows (anchorsGenesis), or say
 * no after the wait. Nothing found is never an admit.
 */
function liveGenesisAnchor(me: string) {
  return (record: StoredCommunity) => new Promise<boolean>((resolve) => {
    const editions: ControlEdition[] = [];
    let settled = false;
    let sub: { close: () => void } | null = null;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.close();
      resolve(ok);
    };
    const timer = setTimeout(() => settle(anchorsGenesis(editions, record)), ANCHOR_WAIT_MS);
    sub = subscribeGovernance(me, record, (rumor) => {
      if (rumor.kind !== KIND_CONTROL_EDITION) return;
      const ed = parseControlEdition(rumor);
      if (!ed) return;
      editions.push(ed);
      if (anchorsGenesis(editions, record)) settle(true);
    }, (relays, filter, onevent) => persistentPoolSubscribe(relays, filter, { onevent }));
    if (settled) sub.close();
  });
}

/**
 * Adopt an invite bundle: verify the community id (anti-spoof), persist the
 * keys, publish a guestbook join and sync your Community List. Shared by link acceptance
 * and direct-invite (3313) acceptance. Returns null if the bundle doesn't verify.
 */
export async function adoptInviteBundle(
  ownerPubkey: string,
  signer: ISigner,
  bundle: InviteBundle,
  publish: PublishFn,
  publishSelf: (e: Event) => Promise<unknown>,
  /** Relays the invite itself was resolved from (naddr ∪ fragment) — unioned
   *  into the stored set so hydration is never NARROWER than what already
   *  worked to fetch the bundle (Armada-style bundles ship `channels: []` and
   *  rely entirely on governance self-heal over these relays). */
  bootstrapRelays: string[] = [],
  /** The genesis anchor (CORD-05 §1): does the owner's record open under these keys? Tests pass a fake. */
  anchor: (record: StoredCommunity) => Promise<boolean> = liveGenesisAnchor(ownerPubkey),
): Promise<JoinResult> {
  if (!verifyCommunityId(bundle.community_id, bundle.owner, bundle.owner_salt)) return { status: "invalid" }; // anti-spoof
  // CORD-05 §1 bounds: a bundle is attacker-crafted input — reject an insane
  // channel count (Vector's ceiling is 256) and truncate relays to the cap.
  // TOLERANT DUAL-READ: an ABSENT channels list reads as none (the governance
  // stream is the source of truth for Armada-style bundles); a PRESENT
  // non-array is still rejected as malformed.
  const channels = bundle.channels ?? [];
  if (!Array.isArray(channels) || channels.length > 256) return { status: "invalid" };

  // The held-base rule: an invite for a group you're in only adds rooms you
  // were missing, and never moves your keys (concord-invite-guard).
  const held = await getCommunity(ownerPubkey, bundle.community_id).catch(() => null);
  const check = checkHeldBundle(held, { ...bundle, channels });
  if (check.kind === "refused") return { status: "already", record: held!, added: 0, kept: true };
  if (check.kind === "held") {
    if (check.added > 0) {
      await putCommunity(ownerPubkey, check.record);
      await publishCommunityList(signer, ownerPubkey, publishSelf).catch(() => {});
    }
    return { status: "already", record: check.record, added: check.added };
  }

  // The genesis anchor: keep a new group only once its owner's record opens
  // under the keys this invite delivered.
  const record = recordFromBundle({ ...bundle, channels }, bootstrapRelays);
  if (!(await anchor(record).catch(() => false))) return { status: "unverified" };
  await putCommunity(ownerPubkey, record);
  // The Join names the link it came through, so its creator can count joins per link (CORD-05 §1).
  const via = inviteAttribution(bundle) ?? undefined;
  await publishGuestbook(signer, ownerPubkey, record, buildJoinLeaveRumor(ownerPubkey, true, Math.floor(Date.now() / 1000), 0, via), publish).catch(() => null);
  await publishCommunityList(signer, ownerPubkey, publishSelf).catch(() => {});
  return { status: "joined", record };
}

// ── Pending direct invites (received 3313s awaiting explicit Accept) ─────────
export interface PendingInvite { bundle: InviteBundle; from: string; at: number }

const pendingKey = (owner: string) => `ro_concord_pending_invites_${owner}`;

export function listPendingInvites(owner: string): PendingInvite[] {
  try { return JSON.parse(localStorage.getItem(pendingKey(owner)) ?? "[]"); } catch { return []; }
}

/** Store a received invite (dedup by community id; latest wins). Returns true if new. */
export function addPendingInvite(owner: string, invite: PendingInvite): boolean {
  try {
    const list = listPendingInvites(owner);
    const existing = list.findIndex((p) => p.bundle.community_id === invite.bundle.community_id);
    if (existing >= 0) list.splice(existing, 1);
    list.unshift(invite);
    localStorage.setItem(pendingKey(owner), JSON.stringify(list.slice(0, 20)));
    return existing < 0;
  } catch { return false; }
}

/**
 * Route a decrypted kind-3313 rumor (raw invite-bundle JSON) into the pending-
 * invite store. Every gift-wrap unwrap path MUST call this for rumorKind 3313
 * instead of treating the rumor as a DM — the payload contains community_root
 * (secret key material) and must never render or be cached as message text.
 * Returns the parsed bundle (isNew = first sighting) or null if the payload
 * isn't a valid invite bundle.
 */
export function stashDirectInviteRumor(
  owner: string,
  rumor: { content: string; senderPubkey: string; timestamp: number },
): { bundle: InviteBundle; isNew: boolean } | null {
  try {
    const bundle = JSON.parse(rumor.content) as InviteBundle;
    if (!bundle?.community_id || !bundle?.owner || !bundle?.community_root) return null;
    normalizeBundleIcon(bundle);
    const isNew = addPendingInvite(owner, { bundle, from: rumor.senderPubkey, at: rumor.timestamp });
    try { window.dispatchEvent(new Event("concord-invite-received")); } catch {}
    return { bundle, isNew };
  } catch {
    return null;
  }
}

export function removePendingInvite(owner: string, communityId: string): void {
  try {
    localStorage.setItem(pendingKey(owner), JSON.stringify(listPendingInvites(owner).filter((p) => p.bundle.community_id !== communityId)));
  } catch {}
}

// ── Direct gift-wrapped invite (CORD-05 §3313) ───────────────────────────────
/** Send a direct invite: a kind-3313 rumor in a NIP-59 gift wrap with outer ["k","3313"]. */
export async function sendDirectInvite(
  signer: ISigner,
  senderPubkey: string,
  recipientPubkey: string,
  community: StoredCommunity,
  publish: (event: Event, relays: string[]) => Promise<unknown>,
): Promise<boolean> {
  const bundle = bundleFromCommunity(community, undefined, undefined, undefined);
  const result = await createGiftWrap(signer, senderPubkey, recipientPubkey, JSON.stringify(bundle), {
    rumorKind: KIND_DIRECT_INVITE,
    outerTags: [["k", String(KIND_DIRECT_INVITE)]],
  });
  if (!result) return false;
  // The recipient watches THEIR inbox relays (kind-10050), not the community's —
  // publish there first (DM machinery), with the community relays as redundancy.
  await fetchDMRelayList(recipientPubkey, { force: true }).catch(() => {});
  const inboxRelays = getDMRelaysForContact(recipientPubkey);
  await publishWithFallback(inboxRelays, result.wrap, hasDMRelayList(recipientPubkey)).catch(() => {});
  await publish(result.wrap, community.relays).catch(() => {});
  return true;
}
