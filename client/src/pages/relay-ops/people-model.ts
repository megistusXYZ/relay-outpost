/**
 * Relays › People: everyone on your relay, as a community manager sees them.
 *
 * Built from two sources the relay itself gives us: who has posted (from
 * what the list has loaded) and its allow and ban lists (NIP-86). Pure —
 * the screen reads it. Two honesty rules:
 *   - "New this week" only when what we've loaded reaches back past a week
 *     (or is the whole relay); otherwise we can't know who's new.
 *   - someone known only from a list "has no posts in what we've loaded" —
 *     not "has never posted".
 */
import { nip19 } from "nostr-tools";
import type { SignalTier } from "@/lib/graperank";

export type PersonStatus = "banned" | "allowed" | "none";

export interface Person {
  pubkey: string;
  posts: number;
  lastSeen?: number;
  firstSeen?: number;
  status: PersonStatus;
}

export function buildDirectory(
  events: ReadonlyArray<{ pubkey: string; created_at: number }>,
  lists: { allowed: readonly string[]; banned: readonly string[]; also?: readonly string[] },
): Person[] {
  const by = new Map<string, Person>();
  const get = (pk: string) => {
    const k = pk.toLowerCase();
    let p = by.get(k);
    if (!p) { p = { pubkey: k, posts: 0, status: "none" }; by.set(k, p); }
    return p;
  };
  for (const e of events) {
    const p = get(e.pubkey);
    p.posts++;
    if (p.lastSeen === undefined || e.created_at > p.lastSeen) p.lastSeen = e.created_at;
    if (p.firstSeen === undefined || e.created_at < p.firstSeen) p.firstSeen = e.created_at;
  }
  // People you've just acted on stay in view even with no posts and no rule
  // left — otherwise lifting a ban makes the person vanish mid-action.
  for (const pk of lists.also ?? []) get(pk);
  for (const pk of lists.allowed) get(pk).status = "allowed";
  for (const pk of lists.banned) get(pk).status = "banned";
  return [...by.values()];
}

const WEEK = 7 * 86400;

/** Can we tell who's new this week? Only if what we loaded goes back further. */
export function knowsNewcomers(oldestLoaded: number | undefined, nowSec: number, wholeRelay: boolean): boolean {
  if (wholeRelay) return true;
  return oldestLoaded !== undefined && oldestLoaded < nowSec - WEEK;
}

export type PeopleFilter = "all" | "banned" | "allowed" | "new" | "concerns";

export const PEOPLE_FILTERS: ReadonlyArray<{ id: PeopleFilter; label: string }> = [
  { id: "all", label: "Everyone" },
  { id: "new", label: "New this week" },
  { id: "concerns", label: "Your network has concerns" },
  { id: "allowed", label: "Allowed" },
  { id: "banned", label: "Banned" },
];

export function filterPeople(
  people: readonly Person[],
  filter: PeopleFilter,
  query: string,
  ctx: { nowSec: number; newcomersKnown: boolean; nameOf: (pk: string) => string | undefined; tierOf: (pk: string) => SignalTier },
): Person[] {
  const q = query.trim().toLowerCase();
  return people.filter((p) => {
    if (filter === "banned" && p.status !== "banned") return false;
    if (filter === "allowed" && p.status !== "allowed") return false;
    if (filter === "new" && !(ctx.newcomersKnown && p.firstSeen !== undefined && p.firstSeen >= ctx.nowSec - WEEK)) return false;
    if (filter === "concerns" && ctx.tierOf(p.pubkey) !== "flagged") return false;
    if (!q) return true;
    if ((ctx.nameOf(p.pubkey) ?? "").toLowerCase().includes(q)) return true;
    if (p.pubkey.startsWith(q)) return true;
    try { return nip19.npubEncode(p.pubkey).startsWith(q); } catch { return false; }
  });
}

export type PeopleSort = "active" | "posts" | "name";

export function sortPeople(people: readonly Person[], sort: PeopleSort, nameOf: (pk: string) => string | undefined): Person[] {
  return [...people].sort((a, b) => {
    if (sort === "posts") return b.posts - a.posts || (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
    if (sort === "name") return (nameOf(a.pubkey) ?? "~" + a.pubkey).localeCompare(nameOf(b.pubkey) ?? "~" + b.pubkey, undefined, { sensitivity: "base" });
    return (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
  });
}

function ago(sec: number, nowSec: number): string {
  const d = Math.max(0, nowSec - sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 30 * 86400) return `${Math.floor(d / 86400)}d ago`;
  return `on ${new Date(sec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** "3 posts · active 2h ago" — the line under a name. */
export function activityLine(p: Person, nowSec: number): string {
  if (!p.posts || p.lastSeen === undefined) return "No posts in what we've loaded";
  return `${p.posts} ${p.posts === 1 ? "post" : "posts"} · active ${ago(p.lastSeen, nowSec)}`;
}

export function peopleCsv(people: readonly Person[], nameOf: (pk: string) => string | undefined): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ["name", "key", "status", "posts", "last active"].map(q).join(",");
  const rows = people.map((p) => [nameOf(p.pubkey) ?? "", p.pubkey, p.status, p.posts, p.lastSeen !== undefined ? new Date(p.lastSeen * 1000).toISOString() : ""].map(q).join(","));
  return [head, ...rows].join("\n");
}
