/**
 * Merge the live governance fold back into the locally stored record.
 *
 * `StoredCommunity`/`StoredChannel` are frozen at join time for everyone who did
 * not create the community. Twelve `putCommunity` sites; exactly one wrote a
 * folded value and it wrote only `name`. That one root cause shipped four
 * separate bugs — an invite gate reading a stale policy (9d7f47b), a link-joined
 * admin with no `about` and a chain nobody could fold (5e7ae4c), a channel
 * rename that dropped the private flag and leaked the room into invite bundles
 * (0c0a8b2), and a second ungated mint path off the same stale field (67e4e42) —
 * each fixed by routing around the record at one call site. This is the root.
 *
 * THREE RULES. Every entry below is an application of one of them.
 *
 * 1. AN ABSENT ANSWER IS NOT A NEGATIVE ANSWER (RELAY_REACHABILITY.md). An empty
 *    fold is a torn-down subscription, not a deletion. Nothing here writes on
 *    the absence of a folded value — only on a positive claim.
 * 2. A POSITIVE CLAIM NEEDS AN ANCHOR. The fold is not monotone: it recomputes
 *    on every rumor, so a cold subscribe walks the CONTENT of whatever editions
 *    the relays replay, in arrival order, and the dangling-head tolerance makes
 *    a mid-flight prefix a perfectly valid fold. Writes are therefore gated on a
 *    head `ev` against a monotone floor, and content moves WITH its cursor.
 * 3. UNTOUCHABLE MEANS STRUCTURALLY UNTOUCHABLE. This module never spreads the
 *    record and never composes a `StoredCommunity`. It returns a patch whose
 *    keys are a closed list, and the two lists together must exhaust
 *    `keyof StoredCommunity` AT COMPILE TIME — so a field added next year fails
 *    the build until somebody classifies it, rather than being silently
 *    reconciled or silently stomped.
 *
 * Pure and synchronous by contract: it runs inside an IDB transaction (see
 * `updateCommunity`), and it must be provable without a relay.
 */
import { VSK, ADMIN_ROLE_ID, type FoldedState } from "./concord-events";
import type { StoredChannel, StoredCommunity } from "./concord-keys";

// ── The allowlist, as a closed set ────────────────────────────────────────────
export const RECONCILABLE = [
  "name", "about", "icon", "allowMemberInvites", "relays",
  "channels", "metaVersion", "metaEid", "adminRolePublished", "retractedChannels",
] as const;

export const UNTOUCHABLE = [
  "community_id", "owner", "owner_salt", "community_root", "root_epoch",
  "priorRoots", "relayUrl", "addedAt",
  "banVersion", "banEid", "banSnapshot", "grantVersions",
] as const;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
/** Adding a field to StoredCommunity breaks HERE until it is classified above. */
export type _CommunityExhaustive = Assert<Equal<keyof StoredCommunity, (typeof RECONCILABLE)[number] | (typeof UNTOUCHABLE)[number]>>;
export type _ChannelExhaustive = Assert<Equal<keyof StoredChannel,
  "id" | "key" | "epoch" | "name" | "isPrivate" | "edVersion" | "edEid" | "seenEdVersion">>;

export type CommunityPatch = Partial<Pick<StoredCommunity, (typeof RECONCILABLE)[number]>>;

/** Fold-derived values are UNTRUSTED input — other Concord clients ship
 *  object-shaped `picture`, which the join path already type-guards. A
 *  reconciler that re-injects what `adoptInviteBundle` defends against is a new
 *  door onto the same input. */
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const isHex32 = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/i.test(v);
const isRelayUrl = (v: unknown): v is string => typeof v === "string" && /^wss?:\/\/\S+$/i.test(v);

/** Existing entries are never evicted, so this only bounds ACCRETION. */
const RELAY_CAP = 5;
/** Every channel row rides twice per record in the kind-13302 blob, under a
 *  NIP-44 size ceiling past which encrypt throws and the key backup silently
 *  stops updating. The bundle path caps; the fold path had nothing. */
const CHANNELS_CAP = 128;
const RETRACTED_CAP = 64;

/**
 * The patch, or null when the fold has nothing to add.
 *
 * Null is not an optimisation — it is the termination condition for a
 * fold-driven writer, and what makes this idempotent under its own notification.
 */
export function reconcilePatch(record: StoredCommunity, folded: FoldedState): CommunityPatch | null {
  const patch: CommunityPatch = {};
  reconcileMetadata(record, folded, patch);
  reconcileChannels(record, folded, patch);

  // adminRolePublished — a publish-once latch, false → true only, and only on a
  // POSITIVE folded claim that the vsk-1 Admin role edition exists. Saves an
  // owner's second device a needless republish after an add-only backup restore.
  // NEVER true → false: that would be a write keyed off absence, the exact habit
  // this module exists to break.
  if (!record.adminRolePublished && folded.roles.has(ADMIN_ROLE_ID)) patch.adminRolePublished = true;

  return Object.keys(patch).length ? patch : null;
}

/**
 * Record-shaped convenience, for tests and non-persisting callers.
 *
 * A PERSISTING caller must use the patch with `updateCommunity`: composing a
 * record here and `put`ting it is exactly the whole-row stomp this module cannot
 * defend against on its own.
 */
export function reconcile(record: StoredCommunity, folded: FoldedState): StoredCommunity | null {
  const patch = reconcilePatch(record, folded);
  return patch ? { ...record, ...patch } : null;
}

// ── Metadata (vsk-0): content and cursor move together, or not at all ─────────
function reconcileMetadata(record: StoredCommunity, folded: FoldedState, patch: CommunityPatch): void {
  const md = folded.metadata;
  const head = folded.heads.get(`${VSK.METADATA}:${record.community_id}`);

  // THE ANCHOR. "metadata is present" is not enough: a cold subscribe walks
  // v1 → v4 → v2 → v7 in arrival order, so writing on presence persists an older
  // edition's `allow_member_invites: true` over a policy the owner closed later —
  // re-arming 9d7f47b's fail-open with a POSITIVE `true`, where today the field
  // is merely undefined and therefore fails closed.
  //
  // `>=`, not `>`: re-folding the SAME head must be a no-op rather than a hold,
  // which is what makes this idempotent. And refusing `head.ev < metaVersion`
  // protects our own optimistically-recorded publish — editMetadata writes the
  // cursor before a best-effort publish, so the fold is legitimately behind for
  // as long as the echo takes.
  if (!md || !head?.hash || head.ev < (record.metaVersion ?? 0)) return;

  // name — `""` is not an assertion. The fold coerces `name: data.name ?? ""`,
  // so a foreign or truncated edition folds to "" identically to a real blank.
  // Never blank a real name.
  const name = str(md.name)?.trim();
  if (name && name !== record.name) patch.name = name;

  // about — three-way, because the fold passes `about` through RAW where `name`
  // is coerced. `""` IS a positive assertion of empty and must clear (matching
  // editMetadata's own `about || undefined`). `undefined` inside present
  // metadata means the edition carried no `about` key at all — which our writers
  // cannot produce, so it can only be a client that does not model the field.
  // Clearing on that is the absence-is-a-negative error.
  const about = str(md.about);
  if (about !== undefined) {
    const next = about.trim() || undefined;
    if (next !== record.about) patch.about = next;
  }

  // icon — the same three-way against `picture`. A wrongly cleared icon does not
  // just blank a header: it rides into every invite bundle minted afterwards.
  const picture = str(md.picture);
  if (picture !== undefined) {
    const next = picture.trim() || undefined;
    if (next !== record.icon) patch.icon = next;
  }

  // allowMemberInvites — the field this whole family circles. Written in BOTH
  // directions including true → false, because an owner CLOSING invites is the
  // one direction that must never fail open. No absence case exists; the fold
  // coerces `!!data.allow_member_invites`. This supplies POLICY, never STANDING:
  // `canInviteToCommunity`'s `&& !!myMember` stays exactly as shipped.
  const allow = md.allowMemberInvites === true;
  if (allow !== (record.allowMemberInvites === true)) patch.allowMemberInvites = allow;

  // relays — UNION, never replace, existing first. The record's relay list is
  // this device's way back to the community; a folded list that happens to be
  // shorter is not authority to drop the entry we are actually connected
  // through. Accretion only, capped.
  const folded_relays = (md.relays ?? []).filter(isRelayUrl);
  if (folded_relays.length) {
    const merged = [...record.relays];
    for (const r of folded_relays) if (!merged.includes(r) && merged.length < RELAY_CAP) merged.push(r);
    if (merged.length !== record.relays.length) patch.relays = merged;
  }

  // The cursor moves WITH the content it came from, or the next edit composes a
  // base from one edition and a chain from another. Copy `head.hash`; never
  // recompute it — a head is only ever an edition this device actually admitted.
  if (head.ev > (record.metaVersion ?? 0)) { patch.metaVersion = head.ev; patch.metaEid = head.hash; }
}

// ── Channels: merge on id, never rebuild ──────────────────────────────────────
function reconcileChannels(record: StoredCommunity, folded: FoldedState, patch: CommunityPatch): void {
  const retracted = new Set(record.retractedChannels ?? []);
  const newlyRetracted: string[] = [];
  let changed = false;

  // MERGE, never map over the fold. `ChannelMetadata` has no `key`, `epoch`,
  // `edVersion` or `edEid`, so an array rebuilt from folded entries silently
  // drops all four — and dropping `key` is the loss of the ONLY copy of a
  // private channel's secret. Every message ever sent there becomes
  // undecryptable, and the sole recovery is a fresh grant from another holder,
  // which does not exist once the community has rekeyed past it.
  const next: StoredChannel[] = [];
  for (const c of record.channels) {
    const fc = folded.channels.get(c.id);

    // RETRACT, one shape only: a keyless, non-private row the fold POSITIVELY
    // calls private — the phantom an unentitled device seated for itself off a
    // pre-0c0a8b2 rename that republished without the flag. Gate on
    // `private === true`, never absence: a DELETION also shows up as absence, so
    // "positively deleted", "not yet arrived" and "written on a plane we cannot
    // decrypt" are byte-identical. `!c.key` means a real member's private
    // channel is never the row dropped.
    if (!c.key && !c.isPrivate && fc?.private === true) {
      newlyRetracted.push(c.id); changed = true; continue;
    }

    let row = c;

    // isPrivate: MONOTONE false → true, and holding the key is un-fakeable local
    // proof needing no relay at all. Never write `false` — not on a folded
    // `private: false`, not on absence. The stream branches on `isPrivate && key`,
    // so a `false` over a key-bearing row sends both READS and WRITES to the
    // community_root-derived PUBLIC plane, where every member can decrypt them.
    // That disclosure cannot be taken back.
    if (!row.isPrivate && (row.key || fc?.private === true)) { row = { ...row, isPrivate: true }; changed = true; }

    // name: fold-wins, but ANCHORED — and on a cursor of the reconciler's own.
    // `edVersion` is the publish cursor, paired with `edEid`, and it is undefined
    // for exactly the population 0c0a8b2 was written for (link-joined,
    // grant-delivered, and rows we seated). Without a separate mark a replayed v1
    // name overwrites v3, the stored name flaps, and the flapped value is what
    // the fold-less surfaces read.
    const chHead = folded.heads.get(`${VSK.CHANNEL}:${row.id}`);
    const seen = row.seenEdVersion ?? row.edVersion ?? 0;
    if (fc && chHead?.hash && chHead.ev >= seen) {
      const nm = str(fc.name)?.trim();
      if (nm && nm !== row.name) { row = { ...row, name: nm, seenEdVersion: chHead.ev }; changed = true; }
      else if (chHead.ev > seen) { row = { ...row, seenEdVersion: chHead.ev }; changed = true; }
    }
    next.push(row);
  }

  // SEAT a folded channel the record lacks — keyless and public, on a positive
  // claim only. Invites from some clients ship `channels: []` (the list lives
  // solely in the encrypted control plane), so without this the unread watcher
  // and merged chat list stay blind. Refuse to seat a folded PRIVATE channel:
  // the channel grant is the ONLY private delivery and it writes key+epoch
  // itself, so seating could only ever hand a NON-holder that room's id and
  // name — which then qualifies for invite bundles handed to people outside the
  // community, with no revocation for a link already sent. The row is seated
  // keyless so the retraction above can undo it and a grant can re-seat it
  // properly, and `retractedChannels` stops a stale flag-dropping edition from
  // re-seating a phantom a correction already removed.
  const known = new Set(next.map((c) => c.id));
  for (const fc of folded.channels.values()) {
    if (fc.private === true) continue;
    const id = str(fc.channel_id);
    if (!isHex32(id) || known.has(id) || retracted.has(id)) continue;
    if (!folded.heads.get(`${VSK.CHANNEL}:${id}`)?.hash) continue;
    if (next.length >= CHANNELS_CAP) break;
    // `epoch: root_epoch` is the only correct seed: the plane key falls back to
    // (community_root, root_epoch) for anything without `isPrivate && key`.
    next.push({ id, epoch: record.root_epoch, name: str(fc.name)?.trim() || "channel", isPrivate: false });
    known.add(id); changed = true;
  }

  if (changed) patch.channels = next;
  if (newlyRetracted.length) {
    patch.retractedChannels = [...new Set([...(record.retractedChannels ?? []), ...newlyRetracted])].slice(-RETRACTED_CAP);
  }
}
