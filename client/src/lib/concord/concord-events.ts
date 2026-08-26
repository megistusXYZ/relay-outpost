/**
 * Concord protocol — event kinds, rumor builders/parsers, control-edition fold,
 * roster + permission math (CORD-02 §5, CORD-03, CORD-04).
 *
 * Pure like `concord-crypto.ts`: builders return UNSIGNED rumor templates (the
 * publish layer computes the id + signs); parsers/fold take plain events. No
 * I/O, no signer — fully unit-testable in the node env. Mirrors the shape of
 * the existing NIP-29 layer (`lib/nip29.ts`) so the two read alike.
 *
 * The fold is AUTHORITY-GATED (CORD-04 §authority): owner-signed editions seed
 * the authoritative state, then each control edition is admitted only if its
 * signer's standing authority (capability + strictly-outranks-the-target) allows
 * it, resolved via a fixpoint since authority itself derives from folded grants.
 * The structural checks (highest version per entity, chain-intactness,
 * lower-rumor-id tie-break) and the permission/roster math live here too.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { u64BE, concatBytes } from "./concord-crypto";

// ── Rumor / event kinds ──────────────────────────────────────────────────────
export const KIND_MESSAGE = 9;
export const KIND_REPLY = 1111;
export const KIND_REACTION = 7;
export const KIND_DELETE = 5;
export const KIND_EDIT = 3302;
export const KIND_REKEY = 3303;
export const KIND_JOIN_LEAVE = 3306;
export const KIND_CONTROL_EDITION = 3308;
export const KIND_KICK = 3309;
export const KIND_SNAPSHOT = 3312;
export const KIND_DIRECT_INVITE = 3313;
export const KIND_TYPING = 23311;
export const KIND_COMMUNITY_LIST = 13302;
export const KIND_INVITE_LIST = 13303;
export const KIND_INVITE_BUNDLE = 33301;
export const KIND_AUDIT = 3314;

/**
 * Control-edition entity types + invite-marker sub-kinds (the `vsk` tag),
 * CORD-02 Appendix B / CORD-05.
 *
 * 0–4 are the control-edition (kind 3308) entity types. 5 is reserved
 * (role ordering); 7 is retired (v1 owner attestation).
 *
 * INVITE (6) is the ADDRESSABLE INVITE MARKER on the joinable kind-33301 bundle
 * (CORD-05 examples: `["vsk","6"]` on the live bundle). REVOKED (9) is that
 * marker's revocation-tombstone variant (`["vsk","9"]`, empty content) — CORD-02
 * Appendix B lists "6, 9" as claimed by the addressable invite marker.
 *
 * REGISTRY (8) is the unrelated "invite-link registry" entity — kept defined but
 * unused. (It was previously and wrongly emitted as the bundle marker; the
 * joinable bundle must carry vsk 6, not 8.)
 */
export const VSK = {
  METADATA: 0,
  ROLE: 1,
  CHANNEL: 2,
  GRANT: 3,
  BANLIST: 4,
  INVITE: 6,
  REGISTRY: 8,
  REVOKED: 9,
  DISSOLVED: 10,
} as const;

/** Permission bits (CORD-04). u64, transmitted as a decimal string. */
export const PERM = {
  MANAGE_ROLES: 1n << 0n,
  MANAGE_CHANNELS: 1n << 1n,
  MANAGE_METADATA: 1n << 2n,
  KICK: 1n << 3n,
  BAN: 1n << 4n,
  MANAGE_MESSAGES: 1n << 5n,
  CREATE_INVITE: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 8n,
  MENTION_EVERYONE: 1n << 9n,
} as const;

/** Owner's rank; lower position = higher authority, owner is supreme. */
export const OWNER_POSITION = 0;

/** The single built-in "Admin" role's fixed id. Lives here rather than in
 *  concord-governance so a pure module can recognise it without importing the
 *  publish stack; concord-governance re-exports it. */
export const ADMIN_ROLE_ID = "ad".repeat(32);

const EDITION_LABEL = "vector-community/v1/edition";

// ── Types ────────────────────────────────────────────────────────────────────
export interface RumorTemplate {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
}

export interface ControlEdition {
  vsk: number;
  /** entity id — stable 32-byte-hex coordinate for this entity. */
  eid: string;
  /** edition version, starts at 1. */
  ev: number;
  /** previous edition hash (absent on v1). */
  ep?: string;
  /** authority citation [grant eid, grant version, grant edition hash] (absent when owner-signed). */
  vac?: [string, string, string];
  /** raw JSON state string. */
  content: string;
  /** the rumor id of the event carrying this edition (tie-breaker). */
  rumorId: string;
  /** author pubkey. */
  pubkey: string;
}

export interface Role {
  role_id: string;
  name: string;
  position: number;
  permissions: bigint;
  scope: { kind: "server" } | { kind: "channel"; channel_id: string };
  color?: number;
}

export interface CommunityMetadata {
  name: string;
  about?: string;
  picture?: string;
  relays: string[];
  /** Community policy: if true, any member (not just owner/admins) may create
   *  invite links. Default false — owner/admins only. */
  allowMemberInvites?: boolean;
}

export interface ChannelMetadata {
  channel_id: string;
  name: string;
  about?: string;
  picture?: string;
  /** private channels need a distributed key; public derive from community_root. */
  private?: boolean;
}

export interface FoldedState {
  metadata?: CommunityMetadata;
  roles: Map<string, Role>;
  channels: Map<string, ChannelMetadata>;
  grants: Map<string, string[]>; // member pubkey → role_ids
  banlist: Set<string>;
  /**
   * Every pubkey ANY admitted banlist edition names — not only the winner's.
   *
   * `banlist` above is what the fold ENFORCES, and it must stay the single
   * winning edition per CORD-04. This is a strictly separate question: what has
   * anyone with authority ever said should be banned here?
   *
   * It exists because the banlist is the one entity at a fixed coordinate, so
   * two editions can genuinely fork — and the loser's names then sit on the
   * relays, admitted and authorised, enforced by nobody. A publisher composing
   * the NEXT edition can put them back. That heals the fork WITHOUT changing how
   * anyone folds, which is why it is done here and not in the winner selection.
   *
   * Only safe while there is no unban: a smaller list at a higher version would
   * be a legitimate removal, and unioning would resurrect it. There is no unban
   * publisher in Concord (AUDIT_META reserves the verb; nothing emits it). If
   * one is added, this must become "seen minus explicitly unbanned".
   */
  banlistSeen: Set<string>;
  dissolved: boolean;
  /**
   * The WINNING edition per `${vsk}:${eid}` coordinate — its version and its
   * computed hash, which is exactly what a successor must carry as `ep`.
   *
   * Publishing a chained edition requires knowing the current head, and for
   * most entities the publisher can track that locally because it is the only
   * writer (see StoredCommunity.metaVersion). The banlist cannot: any PERM.BAN
   * holder may publish it, so a second admin's device has no local history and
   * would restart the chain. This exposes what the relays actually hold.
   */
  heads: Map<string, { ev: number; hash: string }>;
}

export interface Member {
  pubkey: string;
  joinedAt: number;
  roleIds: string[];
  permissions: bigint;
  /** lowest position among the member's roles; owner = OWNER_POSITION. */
  rank: number;
}

// ── ms tag / effective time (CORD-02 §5) ─────────────────────────────────────
export function msTag(ms: number): string[] {
  if (!Number.isInteger(ms) || ms < 0 || ms > 999) throw new Error("ms out of range 0..999");
  return ["ms", String(ms)];
}

/** true time basis = created_at*1000 + ms; malformed/absent ms folds to 0. */
export function effectiveTime(ev: { created_at: number; tags: string[][] }): number {
  const raw = ev.tags.find((t) => t[0] === "ms")?.[1];
  const ms = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
  return ev.created_at * 1000 + (ms >= 0 && ms <= 999 ? ms : 0);
}

// ── Permission math (CORD-04) ────────────────────────────────────────────────
export function parsePermissions(dec: string): bigint {
  try {
    const v = BigInt(dec);
    return v < 0n ? 0n : v;
  } catch {
    return 0n;
  }
}
export const serializePermissions = (bits: bigint): string => bits.toString();
export const hasPermissionBit = (bits: bigint, perm: bigint): boolean => (bits & perm) === perm;

/** Effective permission bits = union of a member's roles' bits. */
export function memberPermissions(roleIds: string[], roles: Map<string, Role>): bigint {
  let bits = 0n;
  for (const id of roleIds) {
    const r = roles.get(id);
    if (r) bits |= r.permissions;
  }
  return bits;
}

/** Whether a member holds a permission (owner always does). */
export function hasPermission(member: Member, perm: bigint): boolean {
  if (member.rank === OWNER_POSITION) return true;
  return hasPermissionBit(member.permissions, perm);
}

/**
 * CORD-04 rank rule: an actor may act on a target only if it strictly outranks
 * it (lower position wins; equal cannot act on equal). Owner outranks everyone.
 */
export function canActOn(actorRank: number, targetRank: number): boolean {
  return actorRank < targetRank;
}

// ── Rumor builders (unsigned templates) ──────────────────────────────────────
/** A channel message rumor with the mandatory binding tags (CORD-03). */
export function buildMessageRumor(
  author: string, channelId: string, epoch: bigint, content: string, ms: number, createdAt: number,
): RumorTemplate {
  return {
    kind: KIND_MESSAGE,
    pubkey: author,
    created_at: createdAt,
    content,
    tags: [["channel", channelId], ["epoch", epoch.toString()], msTag(ms)],
  };
}

/** A threaded reply (NIP-22): uppercase K/E/P = thread root, lowercase = immediate parent. */
export function buildReplyRumor(
  author: string, channelId: string, epoch: bigint, content: string, ms: number, createdAt: number,
  ref: { rootKind: number; rootId: string; rootPubkey: string; parentKind: number; parentId: string; parentPubkey: string },
): RumorTemplate {
  return {
    kind: KIND_REPLY,
    pubkey: author,
    created_at: createdAt,
    content,
    tags: [
      ["channel", channelId], ["epoch", epoch.toString()], msTag(ms),
      ["K", String(ref.rootKind)], ["E", ref.rootId], ["P", ref.rootPubkey],
      ["k", String(ref.parentKind)], ["e", ref.parentId], ["p", ref.parentPubkey],
    ],
  };
}

/** A guestbook join/leave rumor (kind 3306). `join=false` records a leave. */
/**
 * A reaction rumor (kind 7, NIP-25 shape) targeting a message. `content` is the
 * emoji ("❤️", "+") or a `:shortcode:` for a custom emoji (with an ["emoji",…]
 * tag, NIP-30). Carries the CORD-03 channel/epoch binding so it routes.
 */
export function buildReactionRumor(
  author: string, channelId: string, epoch: bigint, content: string,
  target: { id: string; pubkey: string }, ms: number, createdAt: number,
  customEmoji?: { shortcode: string; url: string },
): RumorTemplate {
  const tags: string[][] = [
    ["channel", channelId], ["epoch", epoch.toString()], msTag(ms),
    ["e", target.id], ["p", target.pubkey], ["k", String(KIND_MESSAGE)],
  ];
  if (customEmoji) tags.push(["emoji", customEmoji.shortcode, customEmoji.url]);
  return { kind: KIND_REACTION, pubkey: author, created_at: createdAt, content, tags };
}

/** A delete rumor (kind 5) tombstoning one of the author's own events (reaction
 *  un-react, or a message delete). Carries the channel/epoch binding. */
export function buildDeleteRumor(
  author: string, channelId: string, epoch: bigint, targetId: string, ms: number, createdAt: number,
): RumorTemplate {
  return {
    kind: KIND_DELETE, pubkey: author, created_at: createdAt, content: "",
    tags: [["channel", channelId], ["epoch", epoch.toString()], msTag(ms), ["e", targetId]],
  };
}

/** An edit rumor (kind 3302) replacing the content of the author's own message.
 *  `e` references the target; content is the new text. Channel/epoch bound. */
export function buildEditRumor(
  author: string, channelId: string, epoch: bigint, targetId: string, content: string, ms: number, createdAt: number,
): RumorTemplate {
  return {
    kind: KIND_EDIT, pubkey: author, created_at: createdAt, content,
    tags: [["channel", channelId], ["epoch", epoch.toString()], msTag(ms), ["e", targetId]],
  };
}

/** An ephemeral typing rumor (kind 23311, carried in a 21059 wrap). Channel/epoch
 *  bound so it routes to the right channel; empty content. */
export function buildTypingRumor(author: string, channelId: string, epoch: bigint, createdAt: number): RumorTemplate {
  return {
    kind: KIND_TYPING, pubkey: author, created_at: createdAt, content: "",
    tags: [["channel", channelId], ["epoch", epoch.toString()], msTag(0)],
  };
}

export function buildJoinLeaveRumor(author: string, join: boolean, createdAt: number, ms = 0): RumorTemplate {
  return {
    kind: KIND_JOIN_LEAVE,
    pubkey: author,
    created_at: createdAt,
    content: "",
    tags: [["action", join ? "join" : "leave"], msTag(ms)],
  };
}

// ── Refounding guestbook snapshot (CORD-06 §3 / CORD-02 §5, kind 3312) ────────
/** Members listed per snapshot event (CORD-02 §5: "chunks at 400 members per
 *  event"). 400 lowercase-hex pubkeys stay well under the NIP-44 plaintext cap. */
export const SNAPSHOT_CHUNK = 400;
/** Defensive ceiling on chunk COUNT, matching the rekey path's 80-chunk bound
 *  (#298 `PSEUDONYM_CHUNK`). A snapshot is best-effort and partial snapshots are
 *  spec-useful, so an implausibly huge survivor set truncates rather than fails;
 *  80×400 = 32000 seats, far past any real Community. */
export const SNAPSHOT_CHUNK_CAP = 80;

/**
 * One chunk of a Refounding's guestbook snapshot (kind 3312, CORD-02 §5):
 * refounder-signed, present-members-only, `content` a JSON array of x-only
 * pubkey hexes, `["snap", <id>, <i>, <n>]` carrying the shared snapshot id and
 * the 1-BASED chunk index over the chunk count (matched to Vector
 * `build_snapshot_rumors`; Vector rejects a 0th chunk, `i >= 1 && i <= n`).
 * All chunks of one snapshot share one `snapshotId` and one `createdAt`.
 */
export function buildSnapshotRumor(
  refounder: string, membersChunk: string[], snapshotId: string, i: number, n: number, createdAt: number, ms = 0,
): RumorTemplate {
  return {
    kind: KIND_SNAPSHOT,
    pubkey: refounder,
    created_at: createdAt,
    content: JSON.stringify(membersChunk),
    tags: [["snap", snapshotId, String(i), String(n)], msTag(ms)],
  };
}

/** A parsed snapshot chunk: the refounder (the rumor's real author), the present
 *  members it seeds, the shared snapshot id, the 1-based `(i, n)` chunk position,
 *  and its effective time. */
export interface SnapshotEntry {
  refounder: string;
  members: string[];
  snapshotId: string;
  i: number;
  n: number;
  t: number;
}

/**
 * Parse a kind-3312 snapshot rumor, or null if malformed. The `snap` tag is
 * load-bearing (id must be 64-hex, `1 <= i <= n`), so any malformation rejects
 * the whole event (matched to Vector `parse_guestbook_event`). Individual bad
 * member entries in the content array drop INDIVIDUALLY — a snapshot is
 * secondhand seeding, so one bad hex shouldn't cost the other 399 their seed.
 */
export function parseSnapshotRumor(
  ev: { kind: number; pubkey: string; content: string; tags: string[][]; created_at: number },
): SnapshotEntry | null {
  if (ev.kind !== KIND_SNAPSHOT) return null;
  const snap = ev.tags.find((t) => t[0] === "snap");
  if (!snap || snap.length < 4) return null;
  const snapshotId = snap[1];
  if (!/^[0-9a-f]{64}$/i.test(snapshotId)) return null;
  const i = Number(snap[2]); const n = Number(snap[3]);
  if (!Number.isInteger(i) || !Number.isInteger(n) || i < 1 || i > n) return null;
  let raw: unknown;
  try { raw = JSON.parse(ev.content); } catch { return null; }
  if (!Array.isArray(raw)) return null;
  const members = raw.filter((h): h is string => typeof h === "string" && /^[0-9a-f]{64}$/i.test(h));
  return { refounder: ev.pubkey, members, snapshotId, i, n, t: effectiveTime(ev) };
}

/** The moderation actions recorded in the audit log. */
export type AuditAction = "kick" | "ban" | "unban" | "make_admin" | "remove_admin" | "rename_channel" | "delete_channel" | "edit_metadata" | "dissolve";

/** One decoded audit entry (who did what, to whom, when, why). */
export interface AuditEntry { id: string; actor: string; action: AuditAction; target?: string; reason?: string; detail?: string; t: number }

/** An audit-log rumor (kind 3314): actor is the rumor's pubkey; action/target/reason
 *  in tags. Published to the guestbook plane so admins fold it beside join/leave. */
export function buildAuditRumor(
  actor: string, action: AuditAction, createdAt: number,
  opts?: { target?: string; reason?: string; detail?: string },
): RumorTemplate {
  const tags: string[][] = [["action", action], msTag(0)];
  if (opts?.target) tags.push(["p", opts.target]);
  if (opts?.detail) tags.push(["detail", opts.detail]);
  return { kind: KIND_AUDIT, pubkey: actor, created_at: createdAt, content: opts?.reason ?? "", tags };
}

/** Parse an audit rumor into an entry, or null if it isn't a well-formed 3314. */
export function parseAuditRumor(ev: { kind: number; pubkey: string; id: string; content: string; tags: string[][]; created_at: number }): AuditEntry | null {
  if (ev.kind !== KIND_AUDIT) return null;
  const action = ev.tags.find((t) => t[0] === "action")?.[1] as AuditAction | undefined;
  if (!action) return null;
  return {
    id: ev.id, actor: ev.pubkey, action,
    target: ev.tags.find((t) => t[0] === "p")?.[1],
    reason: ev.content || undefined,
    detail: ev.tags.find((t) => t[0] === "detail")?.[1],
    t: ev.created_at,
  };
}

/** A control edition rumor (kind 3308). Owner-signed editions omit `vac`. */
export function buildControlEdition(
  author: string, vsk: number, eid: string, ev: number, contentObj: unknown, createdAt: number,
  opts?: { prevHash?: string; vac?: [string, string, string] },
): RumorTemplate {
  const tags: string[][] = [["vsk", String(vsk)], ["eid", eid], ["ev", String(ev)]];
  if (opts?.prevHash) tags.push(["ep", opts.prevHash]);
  if (opts?.vac) tags.push(["vac", opts.vac[0], opts.vac[1], opts.vac[2]]);
  return { kind: KIND_CONTROL_EDITION, pubkey: author, created_at: createdAt, content: JSON.stringify(contentObj), tags };
}

/**
 * Ingest-dedup key for a control edition.
 *
 * Keyed by the rumor id, like every OTHER rumor type the governance stream
 * dedups (join/leave, audit, rekey, snapshot). Editions were the one exception,
 * keyed on `vsk:eid:ev` on the reasoning that an eid is content-derived, so one
 * coordinate at one version could only ever mean one payload.
 *
 * That is true of every entity except the banlist, whose eid is a fixed
 * constant. Two different banlists therefore shared a key and the second was
 * dropped before the fold could apply its tie-break — so which snapshot survived
 * came down to relay delivery order, and two devices could disagree.
 *
 * The rumor id is a content hash fixed at publish time (concord-stream.ts
 * getEventHash), so a redelivered edition still collapses to one entry: the
 * churn this dedup exists to prevent is unaffected.
 */
export function editionKey(ed: ControlEdition): string {
  return `${ed.vsk}:${ed.eid}:${ed.ev}:${ed.rumorId}`;
}

// ── Control-edition parse + id ───────────────────────────────────────────────
export function parseControlEdition(ev: { kind: number; pubkey: string; id: string; content: string; tags: string[][] }): ControlEdition | null {
  if (ev.kind !== KIND_CONTROL_EDITION) return null;
  const get = (k: string) => ev.tags.find((t) => t[0] === k);
  const vskTag = get("vsk"); const eidTag = get("eid"); const evTag = get("ev");
  if (!vskTag || !eidTag || !evTag) return null;
  const vsk = Number(vskTag[1]); const ev_ = Number(evTag[1]);
  if (!Number.isInteger(vsk) || !Number.isInteger(ev_) || ev_ < 1) return null;
  const vacTag = get("vac");
  return {
    vsk, eid: eidTag[1], ev: ev_,
    ep: get("ep")?.[1],
    vac: vacTag && vacTag.length >= 4 ? [vacTag[1], vacTag[2], vacTag[3]] : undefined,
    content: ev.content, rumorId: ev.id, pubkey: ev.pubkey,
  };
}

/**
 * Edition hash (what the NEXT edition's `ep` references), CORD-04:
 *   sha256(len64(label) || label || entity_id[32] || version_be[8]
 *          || (prev ? 0x01||prev[32] : 0x00||zero[32]) || len64(content) || content)
 */
export function computeEditionId(entityId: string, version: number, prev: string | undefined, content: string): string {
  const label = utf8ToBytes(EDITION_LABEL);
  const idB = hexToBytes(entityId);
  const contentB = utf8ToBytes(content);
  const prevPart = prev
    ? concatBytes(new Uint8Array([0x01]), hexToBytes(prev))
    : concatBytes(new Uint8Array([0x00]), new Uint8Array(32));
  return bytesToHex(sha256(concatBytes(
    u64BE(BigInt(label.length)), label,
    idB, u64BE(BigInt(version)),
    prevPart,
    u64BE(BigInt(contentB.length)), contentB,
  )));
}

// ── Authority-gated fold (CORD-04 §authority) ────────────────────────────────
/**
 * Apply an already-admitted, structurally-intact set of editions into state.
 * Per entity coordinate (vsk:eid) the highest `ev` wins, tie-breaking on the
 * lexicographically-lower rumor id (never timestamp, per CORD-04).
 */
function applyEditions(
  admitted: Iterable<ControlEdition>,
  hashOf?: Map<ControlEdition, string>,
): FoldedState {
  const byCoord = new Map<string, ControlEdition>();
  // Names from EVERY admitted banlist edition, gathered before the winner-only
  // reduction below discards the rest. See FoldedState.banlistSeen.
  const seenBans = new Set<string>();
  for (const e of admitted) {
    const coord = `${e.vsk}:${e.eid}`;
    const cur = byCoord.get(coord);
    if (!cur || e.ev > cur.ev || (e.ev === cur.ev && e.rumorId < cur.rumorId)) byCoord.set(coord, e);
    if (e.vsk === VSK.BANLIST) {
      try {
        const names = JSON.parse(e.content);
        if (Array.isArray(names)) for (const n of names) if (typeof n === "string") seenBans.add(n);
      } catch { /* malformed content is skipped, as it is below */ }
    }
  }

  const state: FoldedState = { roles: new Map(), channels: new Map(), grants: new Map(), banlist: new Set(), banlistSeen: new Set(), dissolved: false, heads: new Map() };
  for (const b of seenBans) state.banlistSeen.add(b);
  for (const [coord, e] of byCoord) {
    // The winner per coordinate IS the head a successor must chain onto. We
    // already know it here; publishing it costs nothing and saves every caller
    // from re-deriving it (or, as the banlist did, from assuming version 1).
    const hash = hashOf?.get(e);
    if (hash) state.heads.set(coord, { ev: e.ev, hash });
  }
  for (const e of byCoord.values()) {
    try {
      const data = JSON.parse(e.content);
      switch (e.vsk) {
        case VSK.METADATA:
          state.metadata = { name: data.name ?? "", about: data.about, picture: data.picture, relays: Array.isArray(data.relays) ? data.relays.slice(0, 5) : [], allowMemberInvites: !!data.allow_member_invites };
          break;
        case VSK.ROLE:
          state.roles.set(data.role_id, {
            role_id: data.role_id, name: data.name ?? "", position: Number(data.position) || 0,
            permissions: parsePermissions(String(data.permissions ?? "0")),
            scope: data.scope?.kind === "channel" ? { kind: "channel", channel_id: data.scope.channel_id } : { kind: "server" },
            color: data.color,
          });
          break;
        case VSK.CHANNEL: {
          // TOLERANT DUAL-READ (Armada interop): our writer repeats the channel
          // id inside the content (always equal to the edition eid); Armada's
          // channel editions carry only {name, private} — per CORD-04 the
          // entity coordinate (eid) IS the channel id. Without the fallback all
          // of Armada's channels collapsed onto one `undefined` key ("0
          // channels · blank community"). Writes stay canonical (content keeps
          // channel_id).
          const channelId = typeof data.channel_id === "string" && data.channel_id ? data.channel_id : e.eid;
          if (data.deleted) state.channels.delete(channelId);
          else state.channels.set(channelId, { channel_id: channelId, name: data.name ?? "", about: data.about, picture: data.picture, private: !!data.private });
          break;
        }
        case VSK.GRANT:
          if (Array.isArray(data.role_ids) && data.role_ids.length > 0) state.grants.set(data.member, data.role_ids);
          else state.grants.delete(data.member); // empty array = revoke
          break;
        case VSK.BANLIST:
          if (Array.isArray(data)) state.banlist = new Set(data);
          break;
        case VSK.DISSOLVED:
          state.dissolved = true;
          break;
      }
    } catch { /* skip malformed content */ }
  }
  return state;
}

/** A signer's standing authority (rank + permission bits) resolved from an
 *  interim authoritative state. Owner is supreme (rank 0). A member with no
 *  admitted grant has rank Infinity and no permissions. */
function standingAuthority(pubkey: string, state: FoldedState, ownerPubkey: string): { rank: number; perms: bigint } {
  if (pubkey === ownerPubkey) return { rank: OWNER_POSITION, perms: 0n };
  const roleIds = state.grants.get(pubkey) ?? [];
  const perms = memberPermissions(roleIds, state.roles);
  const rank = roleIds.reduce((min, id) => Math.min(min, state.roles.get(id)?.position ?? Infinity), Infinity);
  return { rank: Number.isFinite(rank) ? rank : Infinity, perms };
}

function safeParse(content: string): any {
  try { return JSON.parse(content); } catch { return undefined; }
}

/**
 * CORD-04 authorization predicate: may `e`'s signer enact this control edition
 * against `state` (the already-admitted authoritative state)?
 *   - Owner-signed editions are always admissible.
 *   - (a) capability: the signer holds the entity-type permission.
 *   - (b) rank: the signer STRICTLY outranks every role handed out AND the
 *         target's current standing (this is the vacuous-revoke CVE guard — a
 *         revoke with empty role_ids must still outrank the standing grant).
 *   - (c) forged-predecessor guard: if a `vac` authority citation is present it
 *         must resolve to an ADMITTED edition (matching eid + version + hash).
 * `byHash` maps every edition's own hash → edition; `admitted` is the set so far.
 */
function authorizeEdition(
  e: ControlEdition, state: FoldedState, ownerPubkey: string,
  byHash: Map<string, ControlEdition>, admitted: Set<ControlEdition>,
): boolean {
  if (e.pubkey === ownerPubkey) return true; // owner is supreme

  // (c) forged-predecessor guard: a cited authority must be admitted state.
  if (e.vac) {
    const cited = byHash.get(e.vac[2]);
    if (!cited || !admitted.has(cited) || cited.eid !== e.vac[0] || String(cited.ev) !== e.vac[1]) return false;
  }

  const signer = standingAuthority(e.pubkey, state, ownerPubkey);
  const outranks = (targetRank: number) => canActOn(signer.rank, targetRank);

  switch (e.vsk) {
    case VSK.DISSOLVED:
      return false; // owner-only; owner handled above
    case VSK.METADATA:
      return hasPermissionBit(signer.perms, PERM.MANAGE_METADATA);
    case VSK.CHANNEL:
      return hasPermissionBit(signer.perms, PERM.MANAGE_CHANNELS);
    case VSK.BANLIST: {
      if (!hasPermissionBit(signer.perms, PERM.BAN)) return false;
      const data = safeParse(e.content);
      const targets: string[] = Array.isArray(data) ? data : [];
      // Must strictly outrank every member being banned (never the owner).
      return targets.every((t) => outranks(standingAuthority(t, state, ownerPubkey).rank));
    }
    case VSK.ROLE: {
      if (!hasPermissionBit(signer.perms, PERM.MANAGE_ROLES)) return false;
      const data = safeParse(e.content);
      const position = Number(data?.position) || 0;
      // Can't create/modify a role at or above one's own rank.
      return outranks(position);
    }
    case VSK.GRANT: {
      if (!hasPermissionBit(signer.perms, PERM.MANAGE_ROLES)) return false;
      const data = safeParse(e.content);
      const roleIds: string[] = Array.isArray(data?.role_ids) ? data.role_ids : [];
      // Must strictly outrank every role handed out …
      for (const id of roleIds) {
        if (!outranks(state.roles.get(id)?.position ?? Infinity)) return false;
      }
      // … AND the target's CURRENT standing rank. Empty role_ids (a revoke) has
      // no roles to check, so this is the sole guard for the disclosed CVE:
      // a vacuous revoke must strictly outrank the grant it removes.
      const target = typeof data?.member === "string" ? data.member : undefined;
      const targetRank = target ? standingAuthority(target, state, ownerPubkey).rank : Infinity;
      return outranks(targetRank);
    }
    default:
      return false; // REGISTRY/REVOKED and unknown types: non-owner may not set
  }
}

/**
 * Fold control editions into current state with AUTHORITY GATING (CORD-04).
 *
 * Two structural prerequisites gate admission, then authority is resolved via a
 * fixpoint (authority derives from folded grants, so it is circular):
 *   1. Chain intactness — each `ep` must resolve to this entity's prior edition
 *      (`computeEditionId`); an edition whose `ep` names an unknown parent is a
 *      gap and is skipped until the parent is present.
 *   2. Signer authority — owner-signed editions seed the authoritative state;
 *      then each not-yet-admitted, chain-intact edition is admitted only if its
 *      signer's standing authority (resolved from the ALREADY-ADMITTED state)
 *      satisfies `authorizeEdition`. Versions are considered oldest-first so a
 *      `vac`-cited predecessor is admitted before its successor is judged.
 *   Repeat until no new admissions (fixpoint). Non-admitted editions are dropped
 *   — never applied — so downstream (`computeRoster`) is unchanged.
 */
export function foldEditions(editions: ControlEdition[], ownerPubkey: string): FoldedState {
  // Index editions by their own hash so we can verify `ep` links + `vac`
  // citations. A malformed eid (not 32-byte hex) can't be a real edition.
  const byHash = new Map<string, ControlEdition>();
  // Inverse of byHash: the edition -> its own hash, which is what a SUCCESSOR
  // must carry as `ep`. Same computeEditionId call, kept rather than discarded,
  // so FoldedState.heads costs no extra hashing.
  const hashOf = new Map<ControlEdition, string>();
  for (const e of editions) {
    try {
      const h = computeEditionId(e.eid, e.ev, e.ep, e.content);
      byHash.set(h, e);
      hashOf.set(e, h);
    } catch { /* skip */ }
  }

  // Held versions per entity — the dangling-head tolerance below needs to know
  // whether a claimed-but-unresolvable parent CONTRADICTS something we hold.
  const versionsHeld = new Map<string, Set<number>>();
  for (const e of editions) {
    let s = versionsHeld.get(e.eid);
    if (!s) { s = new Set(); versionsHeld.set(e.eid, s); }
    s.add(e.ev);
  }

  const chainIntact = (e: ControlEdition): boolean => {
    // Walk backwards to version 1; every ep must resolve to a known edition.
    let cur: ControlEdition | undefined = e;
    const seen = new Set<string>();
    while (cur) {
      if (cur.ev === 1) return cur.ep === undefined;
      if (!cur.ep || seen.has(cur.ep)) return false;
      seen.add(cur.ep);
      const parent = byHash.get(cur.ep);
      if (!parent) {
        // TOLERANT DUAL-READ (Armada interop): Armada does not retain
        // superseded editions on the relays, so an honest latest head (e.g.
        // metadata at ev=4) arrives with an `ep` whose parent no one can fetch
        // — strict full-chain verification made the community's metadata
        // unfoldable forever. Accept a dangling head IFF we hold NO candidate
        // parent version for this entity; if we DO hold ev-1 and its hash
        // doesn't match the claimed `ep`, the head cites a history that
        // contradicts what we can see — reject it (this keeps the
        // orphan-v2-must-not-beat-held-v1 property). Authority gating below is
        // unchanged and remains the actual security gate: a signer who could
        // forge a dangling head could equally publish a legitimate successor.
        return !versionsHeld.get(e.eid)?.has(cur.ev - 1);
      }
      if (parent.eid !== e.eid || parent.ev !== cur.ev - 1) return false;
      cur = parent;
    }
    return false;
  };

  // Structurally-valid candidates, considered oldest-version first so a cited
  // predecessor is admitted before the edition that cites it.
  const candidates = editions.filter(chainIntact).sort((a, b) => a.ev - b.ev);

  const admitted = new Set<ControlEdition>();
  // Seed: owner-signed editions are always admissible.
  for (const e of candidates) if (e.pubkey === ownerPubkey) admitted.add(e);

  // Fixpoint: admit non-owner editions whose signer is authorized by the state
  // built from already-admitted editions; repeat until nothing new is admitted.
  let changed = true;
  while (changed) {
    changed = false;
    const state = applyEditions(admitted, hashOf);
    for (const e of candidates) {
      if (admitted.has(e)) continue;
      if (authorizeEdition(e, state, ownerPubkey, byHash, admitted)) {
        admitted.add(e);
        changed = true;
      }
    }
  }

  return applyEditions(admitted, hashOf);
}

// ── Roster (CORD-04 §Roster) ──────────────────────────────────────────────────
/**
 * The npubs whose Refounding snapshots (CORD-02 §5) a receiver honors: the owner
 * plus every member whose folded grant carries `BAN` — i.e. everyone authorized
 * to Refound (CORD-06 §Authority). Vector honors only the OWNER (its Refounding
 * is owner-only), but our Refounding requires `BAN` and a non-owner admin may
 * mint an epoch, so its snapshot must be honorable too. Derived from the folded
 * CONTROL PLANE (grants/roles), NOT from roster membership, so a fresh joiner —
 * who holds the new root and folds the re-published control plane but never
 * received the base-rekey blobs that would name the exact minting rotator — can
 * still verify a refounder's authority. This is a SUPERSET of the spec's exact
 * "npub that minted this epoch" gate; it is safe because a snapshot only ever
 * SEEDS `Joined` (never removes, never a negative state) and any firsthand entry
 * supersedes it, so a wider-but-still-authorized gate cannot cause a member to
 * disappear — only, at worst, an authorized admin seeding a keyless npub that
 * heals by never being observed. Flagged in the PR as a documented divergence.
 */
function snapshotAuthorities(state: FoldedState, ownerPubkey: string): Set<string> {
  const out = new Set<string>([ownerPubkey]);
  for (const [pk, roleIds] of state.grants) {
    if (hasPermissionBit(memberPermissions(roleIds, state.roles), PERM.BAN)) out.add(pk);
  }
  return out;
}

/**
 * Build the roster from guestbook join/leave rumors + folded grants/roles/ban.
 * Latest action per pubkey wins (by effective time); leavers and banned drop.
 * Rank = lowest role position; owner is passed explicitly (position 0).
 *
 * `snapshots` (CORD-06 §3 / CORD-02 §5) SEED pre-Refounding survivors into the
 * new epoch so a post-removal fresh joiner — who reads only the new epoch's
 * Guestbook and thus sees no pre-Refounding Joins — still recovers the roster.
 * A snapshot is *secondhand*: honored only from an authorized refounder
 * (`snapshotAuthorities`), it seeds `Joined` at the snapshot's time, and any
 * FIRSTHAND join/leave wins on a strictly-later time or a tie (a member's own
 * word beats the refounder's attestation, CORD-02 §5). Absent snapshots ⇒ the
 * exact prior behavior (the argument defaults to empty).
 */
export function computeRoster(
  joinLeave: { pubkey: string; created_at: number; tags: string[][] }[],
  state: FoldedState,
  ownerPubkey: string,
  snapshots: { refounder: string; members: string[]; t: number }[] = [],
): Member[] {
  type Src = "firsthand" | "snapshot";
  const latest = new Map<string, { join: boolean; t: number; src: Src }>();
  // Firsthand Joins/Leaves first — unchanged last-wins-on-tie behavior.
  for (const ev of joinLeave) {
    const action = ev.tags.find((t) => t[0] === "action")?.[1];
    const join = action !== "leave";
    const t = effectiveTime(ev);
    const cur = latest.get(ev.pubkey);
    if (!cur || t >= cur.t) latest.set(ev.pubkey, { join, t, src: "firsthand" });
  }
  // Snapshot seeds: authorized refounders only, seeding Joined. A snapshot beats
  // what it finds only when strictly newer, or when tying a prior SNAPSHOT seed;
  // it never overrides a firsthand entry at an equal-or-later time.
  if (snapshots.length > 0) {
    const authorities = snapshotAuthorities(state, ownerPubkey);
    for (const snap of snapshots) {
      if (!authorities.has(snap.refounder)) continue;
      for (const m of snap.members) {
        const cur = latest.get(m);
        if (!cur || snap.t > cur.t || (snap.t === cur.t && cur.src === "snapshot")) {
          latest.set(m, { join: true, t: snap.t, src: "snapshot" });
        }
      }
    }
  }

  const members: Member[] = [];
  const consider = (pubkey: string, joinedAt: number) => {
    if (state.banlist.has(pubkey)) return;
    const roleIds = pubkey === ownerPubkey ? [] : (state.grants.get(pubkey) ?? []);
    const permissions = memberPermissions(roleIds, state.roles);
    const rank = pubkey === ownerPubkey
      ? OWNER_POSITION
      : roleIds.reduce((min, id) => Math.min(min, state.roles.get(id)?.position ?? Infinity), Infinity);
    members.push({ pubkey, joinedAt, roleIds, permissions, rank: Number.isFinite(rank) ? rank : Infinity });
  };

  // Owner is always a member (unless dissolved); never needs a join rumor.
  if (!state.banlist.has(ownerPubkey)) consider(ownerPubkey, 0);
  for (const [pubkey, s] of latest) {
    if (pubkey === ownerPubkey) continue;
    if (s.join) consider(pubkey, s.t);
  }
  return members;
}
