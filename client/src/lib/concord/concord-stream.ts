/**
 * Concord stream pipeline (CORD-01/03): publish a rumor to a plane and
 * subscribe/decrypt a plane's traffic. Sits on top of the pure crypto/events
 * layers and the app's relay pool.
 *
 * Layering per message: rumor (unsigned, kind 9) → author-signed seal (20013
 * encrypted for chat, 20014 plaintext for control) → plane-signed wrap (1059).
 * Decrypt is symmetric (plane conv key) so it needs NO signer — only publishing
 * a message needs one `signer.signEvent` for the seal.
 */
import { getEventHash, verifyEvent, type Event } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import {
  groupKey, wrapStream, unwrapStream, buildPlainSeal, buildEncryptedSeal, openSeal, planeConvKey,
  channelRekeyAddress, baseRekeyAddress, deriveSnapshotId,
  LABEL_CONTROL, LABEL_GUESTBOOK, LABEL_CHANNEL, KIND_SEAL_ENC, KIND_SEAL_PLAIN, KIND_STREAM_WRAP, KIND_EPHEMERAL_WRAP, type GroupKey, type Seal,
} from "./concord-crypto";
import { KIND_MESSAGE, KIND_REPLY, KIND_REACTION, KIND_DELETE, KIND_EDIT, KIND_TYPING, KIND_CONTROL_EDITION, KIND_JOIN_LEAVE, buildTypingRumor, buildSnapshotRumor, SNAPSHOT_CHUNK, SNAPSHOT_CHUNK_CAP, type RumorTemplate } from "./concord-events";
import type { StoredCommunity, StoredChannel } from "./concord-keys";
import { isStreamProcessed, markStreamProcessed } from "./concord-keys";
import { registerPlaneAuth } from "./concord-plane-auth";

// ── Plane key derivation (CORD-02/03) ────────────────────────────────────────
export function controlPlaneKey(c: StoredCommunity): GroupKey {
  return groupKey(LABEL_CONTROL, hexToBytes(c.community_root), c.community_id, BigInt(c.root_epoch));
}
export function guestbookPlaneKey(c: StoredCommunity): GroupKey {
  return groupKey(LABEL_GUESTBOOK, hexToBytes(c.community_root), c.community_id, BigInt(c.root_epoch));
}
/** Public channel derives from community_root; private uses its own secret+epoch. */
export function channelPlaneKey(c: StoredCommunity, ch: StoredChannel): GroupKey {
  return ch.isPrivate && ch.key
    ? groupKey(LABEL_CHANNEL, hexToBytes(ch.key), ch.id, BigInt(ch.epoch))
    : groupKey(LABEL_CHANNEL, hexToBytes(c.community_root), ch.id, BigInt(c.root_epoch));
}

/**
 * Every base (root, epoch) pair this member holds: the prior roots retained
 * across rekeys plus the current one, oldest → newest. CORD-03 §3: history
 * spanning a rekey stays continuous because clients query "every epoch pubkey
 * they hold" — the read side derives planes for ALL of these; the publish side
 * always uses the current key only.
 */
export function heldBaseKeys(c: StoredCommunity): { root: string; epoch: number }[] {
  const held = [...(c.priorRoots ?? []).filter((p) => p.epoch < c.root_epoch), { root: c.community_root, epoch: c.root_epoch }];
  return held.sort((a, b) => a.epoch - b.epoch);
}

/** Control + guestbook plane keys across every held base epoch (read side). */
export function governancePlanes(c: StoredCommunity): GroupKey[] {
  const planes: GroupKey[] = [];
  for (const { root, epoch } of heldBaseKeys(c)) {
    planes.push(groupKey(LABEL_CONTROL, hexToBytes(root), c.community_id, BigInt(epoch)));
    planes.push(groupKey(LABEL_GUESTBOOK, hexToBytes(root), c.community_id, BigInt(epoch)));
  }
  return planes;
}

/**
 * The CORD-06 §2 rekey-pseudonym addresses this member must watch (spec-path
 * read side; a Vector/Amethyst-minted rotation lives ONLY here, never on our
 * legacy control-plane location):
 *  - the NEXT base-rotation address, derived from the CURRENT root at
 *    root_epoch + 1 (a Refounding is addressed under the prior root, which at
 *    arrival time is exactly the root this member holds). Missing several
 *    epochs heals sequentially: adopting N+1 re-runs the subscription for N+2.
 *  - per held PRIVATE channel, the next channel-epoch rekey address at
 *    channel_epoch + 1, derived under EVERY held base root: a standalone
 *    channel rekey is addressed under the current root, while a
 *    removal-companion channel rekey rides the prior root alongside its base
 *    rekey (CORD-06 §3) — after the base is adopted, that prior root is
 *    retained in `priorRoots`, so the companion still resolves.
 */
export function rekeyReadPlanes(c: StoredCommunity): GroupKey[] {
  const planes: GroupKey[] = [
    baseRekeyAddress(hexToBytes(c.community_root), c.community_id, BigInt(c.root_epoch + 1)),
  ];
  for (const ch of c.channels) {
    if (!ch.isPrivate || !ch.key) continue;
    for (const { root } of heldBaseKeys(c)) {
      planes.push(channelRekeyAddress(hexToBytes(root), ch.id, BigInt(ch.epoch + 1)));
    }
  }
  return planes;
}

/**
 * A channel's readable planes, each with the epoch its rumors must bind to
 * (CORD-03 message binding). A private channel is its own (key, epoch); a
 * public channel derives one plane per held base epoch so pre-rekey history
 * still decodes.
 */
export function channelReadPlanes(c: StoredCommunity, ch: StoredChannel): { plane: GroupKey; epoch: number }[] {
  if (ch.isPrivate && ch.key) {
    return [{ plane: groupKey(LABEL_CHANNEL, hexToBytes(ch.key), ch.id, BigInt(ch.epoch)), epoch: ch.epoch }];
  }
  return heldBaseKeys(c).map(({ root, epoch }) => ({
    plane: groupKey(LABEL_CHANNEL, hexToBytes(root), ch.id, BigInt(epoch)),
    epoch,
  }));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ── Publish a rumor to a plane ────────────────────────────────────────────────
/**
 * Sign a rumor's seal (author) and wrap it (plane), then publish. `sealKind`
 * chooses 20013 (encrypted — chat) vs 20014 (plaintext — control editions that
 * must carry a stable signature). Returns the wrap, or null on signer failure.
 */
export async function publishToPlane(
  signer: ISigner,
  authorPubkey: string,
  plane: GroupKey,
  rumor: RumorTemplate,
  sealKind: number,
  publish: (event: Event) => Promise<unknown>,
  createdAt: number = Math.floor(Date.now() / 1000),
  wrapKind: number = KIND_STREAM_WRAP,
): Promise<Event | null> {
  try {
    const rumorWithId = { ...rumor, id: getEventHash(rumor as never) };
    const rumorJson = JSON.stringify(rumorWithId);
    const seal: Seal = sealKind === KIND_SEAL_ENC
      ? buildEncryptedSeal(authorPubkey, rumorJson, planeConvKey(plane), createdAt)
      : buildPlainSeal(authorPubkey, rumorJson, createdAt);
    const signedSeal = await signer.signEvent({ kind: seal.kind, created_at: seal.created_at, tags: seal.tags, content: seal.content });
    const wrap = wrapStream(plane, signedSeal as unknown as Seal, createdAt, wrapKind);
    // HONOUR THE PUBLISHER'S VERDICT. `publishEvent` returns false when zero
    // relays accepted the event — it does NOT throw — and this used to discard
    // that answer and return the wrap regardless. So every caller that "checked
    // whether the publish worked" was really only catching signer and
    // serialization errors, and a write made offline reported success. That is
    // the difference between a delete that failed and a delete that destroyed
    // the only local copy of a private channel's key.
    const landed = await publish(wrap);
    if (landed === false) return null;
    return wrap;
  } catch {
    return null;
  }
}

// ── Read: unwrap → verify → open → parse (symmetric, no signer) ──────────────
export interface DecodedRumor {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id: string;
}

/**
 * Decode one stream wrap with a plane key. Verifies the plane-signed outer, the
 * author-signed seal, and that the rumor author matches the seal author (no
 * forged sender). Returns null on any failure. Pure given (plane, wrap).
 */
export function decodeStreamEvent(plane: GroupKey, wrap: Event): DecodedRumor | null {
  const seal = unwrapStream(plane, wrap);
  if (!seal) return null;
  // The seal must be a validly author-signed event.
  if (!seal.id || !seal.sig || !verifyEvent(seal as unknown as Event)) return null;
  const sealKey = seal.kind === KIND_SEAL_ENC ? planeConvKey(plane) : undefined;
  const rumorJson = openSeal(seal, sealKey);
  if (!rumorJson) return null;
  try {
    const rumor = JSON.parse(rumorJson) as DecodedRumor;
    if (rumor.pubkey !== seal.pubkey) return null; // sender attribution
    return rumor;
  } catch {
    return null;
  }
}

// ── Pure router: classify a decoded rumor for a channel ──────────────────────
export type RoutedRumor =
  | { type: "message"; rumor: DecodedRumor }
  | { type: "reply"; rumor: DecodedRumor }
  | { type: "reaction"; rumor: DecodedRumor }
  | { type: "delete"; rumor: DecodedRumor }
  | { type: "edit"; rumor: DecodedRumor }
  | { type: "control"; rumor: DecodedRumor }
  | { type: "join_leave"; rumor: DecodedRumor }
  | { type: "ignored" };

/**
 * Route a decoded rumor, enforcing CORD-03 binding: a chat rumor MUST carry
 * `["channel", channelId]` + `["epoch", n]` matching the key that opened it, or
 * it is dropped. Control/guestbook rumors have no channel binding.
 */
export function routeRumor(rumor: DecodedRumor, expectChannelId?: string, expectEpoch?: number): RoutedRumor {
  switch (rumor.kind) {
    case KIND_MESSAGE:
    case KIND_REPLY:
    case KIND_REACTION:
    case KIND_DELETE:
    case KIND_EDIT: {
      const ch = rumor.tags.find((t) => t[0] === "channel")?.[1];
      const ep = rumor.tags.find((t) => t[0] === "epoch")?.[1];
      if (expectChannelId !== undefined && ch !== expectChannelId) return { type: "ignored" };
      if (expectEpoch !== undefined && ep !== String(expectEpoch)) return { type: "ignored" };
      const type = rumor.kind === KIND_MESSAGE ? "message" : rumor.kind === KIND_REPLY ? "reply" : rumor.kind === KIND_REACTION ? "reaction" : rumor.kind === KIND_DELETE ? "delete" : "edit";
      return { type, rumor };
    }
    case KIND_CONTROL_EDITION: return { type: "control", rumor };
    case KIND_JOIN_LEAVE: return { type: "join_leave", rumor };
    default: return { type: "ignored" };
  }
}

// ── Subscribe a channel (I/O) ─────────────────────────────────────────────────
export interface StreamSub { close: () => void }

/**
 * Live-subscribe a public/private channel: {kinds:[1059], authors:[channel_pk]}
 * on the community's relays. Decodes symmetrically, dedupes via the IDB stream
 * ledger, routes, and calls back with in-order messages. `subscribe` is the
 * app's pool subscribe (injected to keep this module free of a hard nostr.ts
 * dep and testable at the seams).
 */
export function subscribeChannel(
  ownerPubkey: string,
  community: StoredCommunity,
  channel: StoredChannel,
  onMessage: (rumor: DecodedRumor) => void,
  subscribe: (relays: string[], filter: { kinds: number[]; authors: string[] }, onevent: (e: Event) => void) => StreamSub,
): StreamSub {
  // One plane per held epoch (public channels span base rekeys, CORD-03 §3);
  // each wrap decodes with the plane that authored it and binds to ITS epoch.
  const planes = new Map(channelReadPlanes(community, channel).map((p) => [p.plane.pk, p]));
  // Armada-flavored relays NIP-42-gate wrap reads by their filter authors —
  // register the plane keys so the transport can authenticate AS the planes.
  registerPlaneAuth(community.relays, [...planes.values()].map((p) => p.plane));
  return subscribe(community.relays, { kinds: [1059], authors: [...planes.keys()] }, async (wrap) => {
    const held = planes.get(wrap.pubkey);
    if (!held) return;
    if (await isStreamProcessed(ownerPubkey, wrap.id)) return;
    void markStreamProcessed(ownerPubkey, wrap.id);
    const rumor = decodeStreamEvent(held.plane, wrap);
    if (!rumor) return;
    const routed = routeRumor(rumor, channel.id, held.epoch);
    if (routed.type === "message" || routed.type === "reply" || routed.type === "reaction" || routed.type === "delete" || routed.type === "edit") onMessage(routed.rumor);
  });
}

/**
 * Subscribe a community's control + guestbook planes, decoding editions and
 * join/leave rumors — the raw material for a roster + folded state. Both planes
 * are queried in one subscription (their pubkeys differ). Returns decoded rumors
 * (with the carrying event id) via the callback.
 */
export function subscribeGovernance(
  ownerPubkey: string,
  community: StoredCommunity,
  onRumor: (rumor: DecodedRumor) => void,
  subscribe: (relays: string[], filter: { kinds: number[]; authors: string[] }, onevent: (e: Event) => void) => StreamSub,
): StreamSub {
  // Control + guestbook planes across EVERY held base epoch — after a
  // removal-rekey, join rumors + audit entries written under earlier epochs
  // must keep decoding or the roster/audit history vanishes (the live-test
  // "removing one member showed everyone removed" bug).
  //
  // DUAL-READ (CORD-06 §2): rekeys are ALSO watched at their dedicated
  // pseudonym addresses — the spec location Vector/Amethyst publish to. The
  // legacy location (3303 rumors on the control plane, what our deployed
  // clients mint) keeps decoding via the governance planes above. A rotation
  // dual-written to both locations carries the identical rumor, so the
  // consumer's rumor-id keyed map processes it once.
  const planes = new Map<string, GroupKey>(
    [...governancePlanes(community), ...rekeyReadPlanes(community)].map((p) => [p.pk, p]),
  );
  // Armada-flavored relays NIP-42-gate wrap reads by their filter authors —
  // register the plane keys so the transport can authenticate AS the planes.
  registerPlaneAuth(community.relays, [...planes.values()]);
  return subscribe(community.relays, { kinds: [1059], authors: [...planes.keys()] }, (wrap) => {
    const plane = planes.get(wrap.pubkey);
    if (!plane) return;
    const rumor = decodeStreamEvent(plane, wrap);
    if (rumor) onRumor(rumor);
  });
}

// ── Typing indicators (ephemeral 21059 / 23311) ──────────────────────────────
/** Broadcast an ephemeral "I'm typing" to a channel (relays don't store it). */
export async function publishTyping(
  signer: ISigner,
  authorPubkey: string,
  community: StoredCommunity,
  channel: StoredChannel,
  publish: (event: Event, relays: string[]) => Promise<unknown>,
): Promise<void> {
  const plane = channelPlaneKey(community, channel);
  const epoch = channel.isPrivate ? channel.epoch : community.root_epoch;
  const rumor = buildTypingRumor(authorPubkey, channel.id, BigInt(epoch), Math.floor(Date.now() / 1000));
  await publishToPlane(signer, authorPubkey, plane, rumor, KIND_SEAL_PLAIN, (e) => publish(e, community.relays), Math.floor(Date.now() / 1000), KIND_EPHEMERAL_WRAP).catch(() => null);
}

/** Subscribe a channel's ephemeral typing stream → calls back with each typist. */
export function subscribeTyping(
  community: StoredCommunity,
  channel: StoredChannel,
  onTyping: (pubkey: string) => void,
  subscribe: (relays: string[], filter: { kinds: number[]; authors: string[] }, onevent: (e: Event) => void) => StreamSub,
): StreamSub {
  const plane = channelPlaneKey(community, channel);
  registerPlaneAuth(community.relays, [plane]);
  return subscribe(community.relays, { kinds: [KIND_EPHEMERAL_WRAP], authors: [plane.pk] }, (wrap) => {
    const rumor = decodeStreamEvent(plane, wrap);
    if (rumor && rumor.kind === KIND_TYPING) onTyping(rumor.pubkey);
  });
}

// ── Publish a channel message (I/O) ───────────────────────────────────────────
export async function publishChannelMessage(
  signer: ISigner,
  authorPubkey: string,
  community: StoredCommunity,
  channel: StoredChannel,
  rumor: RumorTemplate,
  publish: (event: Event, relays: string[]) => Promise<unknown>,
): Promise<Event | null> {
  const plane = channelPlaneKey(community, channel);
  return publishToPlane(signer, authorPubkey, plane, rumor, KIND_SEAL_ENC, (e) => publish(e, community.relays));
}

/** Publish a control-plane edition (20014 plaintext, e.g. metadata/channel/grant). */
export async function publishControlEdition(
  signer: ISigner,
  authorPubkey: string,
  community: StoredCommunity,
  rumor: RumorTemplate,
  publish: (event: Event, relays: string[]) => Promise<unknown>,
): Promise<Event | null> {
  const plane = controlPlaneKey(community);
  return publishToPlane(signer, authorPubkey, plane, rumor, KIND_SEAL_PLAIN, (e) => publish(e, community.relays));
}

/**
 * Publish a guestbook join/leave/kick/audit rumor.
 *
 * CORD-02 §5: "the Chat, Guestbook, and rekey planes' seals MUST be encrypted
 * (kind 20013)" — only the Control Plane may be plaintext. A plaintext guestbook
 * seal is a liftable, publicly-verifiable standalone artifact (a private roster
 * leaked as a public Nostr event), so the seal is ENCRYPTED under the guestbook
 * plane's self-ECDH conv key (the same key that encrypts the wrap). This matches
 * Vector byte-for-byte (`community/v2/guestbook.rs` seals with `SealForm::Encrypted`
 * at `guestbook_pk`; its `parse_guestbook_event` REJECTS the plaintext form) and
 * Amethyst/quartz. The guestbook plane key derivation itself is pinned to Vector's
 * GOLDEN_GUESTBOOK_E0_PK (see concord-crypto.test.ts).
 *
 * DUAL-READ back-compat: `decodeStreamEvent` still opens legacy plaintext (20014)
 * guestbook seals our earlier clients published, so existing join/leave/audit
 * history isn't lost — only the OUTBOUND seal form changed to encrypted.
 */
export async function publishGuestbook(
  signer: ISigner,
  authorPubkey: string,
  community: StoredCommunity,
  rumor: RumorTemplate,
  publish: (event: Event, relays: string[]) => Promise<unknown>,
): Promise<Event | null> {
  const plane = guestbookPlaneKey(community);
  return publishToPlane(signer, authorPubkey, plane, rumor, KIND_SEAL_ENC, (e) => publish(e, community.relays));
}

/**
 * Publish a Refounding guestbook snapshot (CORD-06 §3 / CORD-02 §5): seed the
 * surviving members into the NEW epoch's Guestbook so a post-removal fresh
 * joiner recovers the pre-Refounding roster. `community` MUST already hold the
 * NEW `community_root` + `root_epoch` (call AFTER `adoptBaseRekey`), so
 * `guestbookPlaneKey` addresses the new epoch. Present members only, chunked at
 * 400/event (1-based, one shared snapshot id + timestamp), each sealed
 * ENCRYPTED (kind 20013) as CORD-02 §5 mandates for the Guestbook plane. An
 * empty survivor set still emits one chunk, so the step is observable. Best
 * effort: a Refounding succeeds with or without it — callers swallow failures.
 */
export async function publishGuestbookSnapshot(
  signer: ISigner,
  refounderPubkey: string,
  community: StoredCommunity,
  survivors: string[],
  publish: (event: Event, relays: string[]) => Promise<unknown>,
  createdAt: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const plane = guestbookPlaneKey(community);
  // Dedupe + sort so a retried Refounding chunks identically (idempotent).
  const members = [...new Set(survivors.filter((p) => /^[0-9a-f]{64}$/i.test(p)))].sort();
  const snapshotId = deriveSnapshotId(community.community_id, BigInt(community.root_epoch));
  const chunks: string[][] = [];
  for (let i = 0; i < members.length; i += SNAPSHOT_CHUNK) chunks.push(members.slice(i, i + SNAPSHOT_CHUNK));
  if (chunks.length === 0) chunks.push([]); // empty snapshot still emits one chunk
  const capped = chunks.slice(0, SNAPSHOT_CHUNK_CAP);
  const n = capped.length;
  for (let i = 0; i < capped.length; i++) {
    const rumor = buildSnapshotRumor(refounderPubkey, capped[i], snapshotId, i + 1, n, createdAt);
    await publishToPlane(signer, refounderPubkey, plane, rumor, KIND_SEAL_ENC, (e) => publish(e, community.relays), createdAt).catch(() => null);
  }
}
