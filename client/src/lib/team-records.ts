/**
 * A relay team's private records: who's on the team, the shared moderation
 * log, and notes about members (owner, 2026-10-03).
 *
 * Where they live: on the operator's OWN relay, sealed and gift-wrapped
 * (NIP-59) once per teammate, like a group private message — so only the team
 * can read them, they sync across devices and teammates, and they leave with
 * the operator if they stop using this app. Nothing is kept on our server and
 * no new key is made: each teammate's own signer seals and opens them.
 *
 * Who's on the team is the relay OWNER's latest roster; a teammate can't
 * rewrite it. Someone removed gets nothing written after — what they already
 * received can't be taken back, and the screen says so.
 *
 * Pure: building tags, reading rumors back, folding them. lib/relay-team.ts
 * wraps, publishes and unwraps.
 */

/** The rumor kind inside the wraps (NIP-78 app data), also on each wrap as ["k", …] so readers skip unrelated wraps. */
export const TEAM_RUMOR_KIND = 30078;
const D_PREFIX = "relay-outpost/team/";

export type RecordType = "roster" | "log" | "note";

export interface TeamRumor {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export function recordTags(type: RecordType, relayUrl: string): string[][] {
  return [["d", D_PREFIX + type], ["relay", relayUrl]];
}

const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

export interface ReadRecord {
  type: RecordType;
  author: string;
  at: number;
  id: string;
  body: Record<string, unknown>;
}

export function readRecord(r: TeamRumor, relayUrl: string): ReadRecord | null {
  if (r.kind !== TEAM_RUMOR_KIND) return null;
  const d = r.tags.find((t) => t[0] === "d")?.[1] ?? "";
  if (!d.startsWith(D_PREFIX)) return null;
  const type = d.slice(D_PREFIX.length) as RecordType;
  if (!["roster", "log", "note"].includes(type)) return null;
  const relay = r.tags.find((t) => t[0] === "relay")?.[1];
  if (!relay || norm(relay) !== norm(relayUrl)) return null;
  try {
    const body = JSON.parse(r.content);
    if (!body || typeof body !== "object") return null;
    return { type, author: r.pubkey.toLowerCase(), at: r.created_at, id: r.id, body };
  } catch {
    return null;
  }
}

export interface TeamNote { id: string; author: string; at: number; about: string; text: string }
export interface TeamLogEntry {
  id: string; author: string; at: number; action: string;
  targetPubkey?: string; targetEventId?: string; targetKind?: number; count?: number; note?: string;
}

export interface TeamState {
  members: string[];
  log: TeamLogEntry[];
  notesAbout: (pubkey: string) => TeamNote[];
}

const HEX = /^[0-9a-f]{64}$/i;

export function foldTeam(rumors: readonly TeamRumor[], ctx: { owner: string; me: string; relayUrl?: string }): TeamState {
  const owner = ctx.owner.toLowerCase();
  const recs = rumors
    .map((r) => (ctx.relayUrl ? readRecord(r, ctx.relayUrl) : readAny(r)))
    .filter((r): r is ReadRecord => !!r);
  // The owner's newest roster decides; everyone it ever named may have written.
  const rosters = recs.filter((r) => r.type === "roster" && r.author === owner).sort((a, b) => b.at - a.at);
  const listOf = (r: ReadRecord) => (Array.isArray(r.body.members) ? (r.body.members as unknown[]) : [])
    .filter((m): m is string => typeof m === "string" && HEX.test(m)).map((m) => m.toLowerCase());
  const members = [...new Set([owner, ...(rosters[0] ? listOf(rosters[0]) : [])])];
  const ever = new Set([owner, ...rosters.flatMap(listOf)]);
  const fromTeam = (r: ReadRecord) => ever.has(r.author);

  const log: TeamLogEntry[] = recs
    .filter((r) => r.type === "log" && fromTeam(r) && typeof r.body.action === "string")
    .map((r) => ({
      id: r.id, author: r.author, at: r.at, action: r.body.action as string,
      targetPubkey: typeof r.body.targetPubkey === "string" ? r.body.targetPubkey : undefined,
      targetEventId: typeof r.body.targetEventId === "string" ? r.body.targetEventId : undefined,
      targetKind: typeof r.body.targetKind === "number" ? r.body.targetKind : undefined,
      count: typeof r.body.count === "number" ? r.body.count : undefined,
      note: typeof r.body.note === "string" ? r.body.note : undefined,
    }))
    .sort((a, b) => b.at - a.at);

  const notes: TeamNote[] = recs
    .filter((r) => r.type === "note" && fromTeam(r) && typeof r.body.about === "string" && typeof r.body.text === "string" && (r.body.text as string).trim())
    .map((r) => ({ id: r.id, author: r.author, at: r.at, about: (r.body.about as string).toLowerCase(), text: (r.body.text as string).trim() }))
    .sort((a, b) => b.at - a.at);

  return { members, log, notesAbout: (pk) => notes.filter((n) => n.about === pk.toLowerCase()) };
}

function readAny(r: TeamRumor): ReadRecord | null {
  const relay = r.tags.find((t) => t[0] === "relay")?.[1];
  return relay ? readRecord(r, relay) : null;
}

const SENTENCES: Record<string, (e: { count?: number }) => string> = {
  delete_event: () => "Removed a post",
  bulk_delete: (e) => `Removed ${e.count ?? "several"} posts`,
  block_author: () => "Banned someone",
  add_blocklist: () => "Banned someone",
  remove_blocklist: () => "Lifted a ban",
  add_allowlist: () => "Allowed someone to post",
  remove_allowlist: () => "Took someone off the allow list",
  restore_event: () => "Brought a post back",
  dismiss_report: () => "Closed a report",
};

/** "Removed 32 posts · Spam" */
export function describeLogEntry(e: { action: string; count?: number; note?: string }): string {
  const s = (SENTENCES[e.action] ?? (() => e.action.replace(/_/g, " ")))(e);
  return e.note ? `${s} · ${e.note}` : s;
}

/** A moderation action this device recorded (pages/relay-ops/shared.tsx), as far as matching needs. */
export interface DeviceLogEntry {
  id: string; ts: number; action: string;
  targetPubkey?: string; targetEventId?: string; count?: number; note?: string;
}

/** How far apart (ms) the same action can be stamped on this device and in the team log. */
const SAME_ACTION_WINDOW_MS = 2 * 60 * 1000;

/**
 * What only this device knows, for the log's "Earlier, on this device only".
 * Every action used to be written to both places, so the same ban showed
 * twice (owner, 2026-10-04): leave out anything the team log has (same
 * action, same target, stamped within two minutes — the team log shows a new
 * entry at once, before the relay confirms it) and the relay's own health
 * checks, which aren't moderation. Matching, not a "sent" mark: the team
 * write is fire-and-forget, so a mark could hide an entry it never stored.
 */
export function deviceOnlyEntries<E extends DeviceLogEntry>(local: readonly E[], team: readonly TeamLogEntry[]): E[] {
  return local.filter((e) => {
    if (/^relay_/.test(e.action)) return false;
    return !team.some((t) => t.action === e.action
      && (t.targetPubkey ?? null) === (e.targetPubkey ?? null)
      && (t.targetEventId ?? null) === (e.targetEventId ?? null)
      && Math.abs(t.at * 1000 - e.ts) <= SAME_ACTION_WINDOW_MS);
  });
}

/**
 * Who to offer for the team (owner, 2026-10-04: one team list). The console
 * used to keep three — Overview's "Relay Team" (this browser), the moderators
 * record, and the relay's own moderators; people on them who aren't on the
 * team yet are offered once, unless you said no.
 */
export function teamSuggestions(oldLists: ReadonlyArray<readonly string[]>, members: readonly string[], dismissed: readonly string[]): string[] {
  const skip = new Set([...members, ...dismissed].map((k) => k.toLowerCase()));
  const out: string[] = [];
  for (const list of oldLists) for (const raw of list) {
    const k = (raw || "").toLowerCase();
    if (!HEX.test(k) || skip.has(k)) continue;
    skip.add(k);
    out.push(k);
  }
  return out;
}
