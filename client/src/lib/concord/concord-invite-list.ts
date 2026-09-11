/**
 * The Invite List (CORD-05 §4, kind 13303): your invite links, encrypted to
 * yourself, so every device and every Concord app on your account can show,
 * refresh and turn off the links you made anywhere. Pure rules; the relay work
 * is concord-invite-list-sync.ts.
 *
 * - The token is the merge key and an entry never changes once minted.
 * - Tombstones union, and a tombstone beats an entry for good, so a stale
 *   device can never bring back a link you turned off.
 * - Another app shares this document, so fields we don't know are kept.
 */
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { StoredInviteSigner } from "./concord-keys";

export type InviteListEntry = {
  token: string; signer_sk: string; community_id: string; url: string;
  label?: string; created_at: number; expires_at?: number;
  [field: string]: unknown;
};
export type InviteListTombstone = { token: string; community_id: string; [field: string]: unknown };
export type InviteList = { entries: InviteListEntry[]; tombstones: InviteListTombstone[]; [field: string]: unknown };

const TOKEN = /^[0-9a-f]{32}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function isEntry(e: unknown): e is InviteListEntry {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return typeof o.token === "string" && TOKEN.test(o.token)
    && typeof o.signer_sk === "string" && HEX32.test(o.signer_sk)
    && typeof o.community_id === "string" && HEX32.test(o.community_id)
    && typeof o.url === "string" && isTime(o.created_at)
    && (o.label === undefined || typeof o.label === "string")
    && (o.expires_at === undefined || isTime(o.expires_at));
}
const isTombstone = (t: unknown): t is InviteListTombstone =>
  !!t && typeof t === "object"
  && typeof (t as InviteListTombstone).token === "string" && TOKEN.test((t as InviteListTombstone).token)
  && typeof (t as InviteListTombstone).community_id === "string" && HEX32.test((t as InviteListTombstone).community_id);

/** A decrypted list, keeping only entries that can become a working link. Null when it isn't a list at all. */
export function readInviteList(json: string): InviteList | null {
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    return {
      ...p,
      entries: (Array.isArray(p.entries) ? p.entries : []).filter(isEntry),
      tombstones: (Array.isArray(p.tombstones) ? p.tombstones : []).filter(isTombstone),
    };
  } catch { return null; }
}

export function mergeInviteLists(a: InviteList, b: InviteList): InviteList {
  const tombstones = new Map<string, InviteListTombstone>();
  for (const t of [...a.tombstones, ...b.tombstones]) if (!tombstones.has(t.token)) tombstones.set(t.token, t);
  const entries = new Map<string, InviteListEntry>();
  for (const e of [...a.entries, ...b.entries]) if (!tombstones.has(e.token) && !entries.has(e.token)) entries.set(e.token, e);
  const { entries: _ae, tombstones: _at, ...aRest } = a;
  const { entries: _be, tombstones: _bt, ...bRest } = b;
  return { ...bRest, ...aRest, entries: [...entries.values()], tombstones: [...tombstones.values()] };
}

/** The list keeps seconds (CORD-05 §4); a value too large for seconds is another app's milliseconds. */
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);

function signerFromEntry(e: InviteListEntry): StoredInviteSigner | null {
  try {
    return {
      communityId: e.community_id, linkSignerPubkey: getPublicKey(hexToBytes(e.signer_sk)), linkSignerSecret: e.signer_sk,
      token: e.token, createdAt: toMs(e.created_at),
      ...(e.label ? { label: e.label } : {}), ...(e.expires_at ? { expiresAt: toMs(e.expires_at) } : {}),
    };
  } catch { return null; }
}

function entryFromSigner(s: StoredInviteSigner, url: string): InviteListEntry {
  return {
    token: s.token, signer_sk: s.linkSignerSecret, community_id: s.communityId, url,
    created_at: Math.floor(s.createdAt / 1000),
    ...(s.label ? { label: s.label } : {}), ...(s.expiresAt ? { expires_at: Math.floor(s.expiresAt / 1000) } : {}),
  };
}

const tokens = (xs: { token: string }[]) => new Set(xs.map((x) => x.token));
const sameTokens = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((t) => b.has(t));

/**
 * What to do with the list as a relay holds it: the links made elsewhere to
 * keep here, the links turned off elsewhere to turn off here, and the list to
 * write back, or null when it already has everything this device knows.
 */
export function planInviteSync(
  local: StoredInviteSigner[],
  remote: InviteList,
  urlFor: (s: StoredInviteSigner) => string,
): { adopt: StoredInviteSigner[]; revoke: string[]; next: InviteList | null } {
  const held = tokens(local);
  const dead = tokens(remote.tombstones);
  const adopt = remote.entries
    .filter((e) => !held.has(e.token) && !dead.has(e.token))
    .map(signerFromEntry)
    .filter((s): s is StoredInviteSigner => s !== null);
  const revoke = local.filter((s) => !s.revoked && dead.has(s.token)).map((s) => s.linkSignerPubkey);

  const mine: InviteList = {
    entries: local.filter((s) => !s.revoked).map((s) => entryFromSigner(s, urlFor(s))),
    tombstones: local.filter((s) => s.revoked).map((s) => ({ token: s.token, community_id: s.communityId })),
  };
  const merged = mergeInviteLists(remote, mine);
  const changed = !sameTokens(tokens(merged.entries), tokens(remote.entries)) || !sameTokens(tokens(merged.tombstones), dead);
  return { adopt, revoke, next: changed ? merged : null };
}
