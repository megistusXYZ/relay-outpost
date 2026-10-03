/**
 * The Events section's one search field.
 *
 * Operators used to have five boxes (id, kind, author, text, time) and a
 * separate Live Feed tab with its own four. Now there is one field: what you
 * type is read for what it is — an event id looks that event up, an npub
 * narrows to that author, `kind:N` narrows to a kind, anything else is words
 * to find in content — and the time window sits behind the Filter button.
 *
 * Pure: the list reads it; nothing here touches a relay.
 */
import { nip19 } from "nostr-tools";
import type { NostrFilter, SavedToolbarState } from "./shared";

export interface EventQuery {
  id?: string;
  author?: string;
  kind?: number;
  text?: string;
}

export type RangeId = "any" | "1h" | "6h" | "24h" | "7d" | "30d";

export const TIME_RANGES: ReadonlyArray<{ id: RangeId; label: string; seconds?: number }> = [
  { id: "any", label: "Any time" },
  { id: "1h", label: "Last hour", seconds: 3600 },
  { id: "6h", label: "6 hours", seconds: 6 * 3600 },
  { id: "24h", label: "24 hours", seconds: 86400 },
  { id: "7d", label: "7 days", seconds: 7 * 86400 },
  { id: "30d", label: "30 days", seconds: 30 * 86400 },
];

export interface TimeWindow {
  range: RangeId | "custom";
  /** Unix seconds; only read when range is "custom". */
  since?: number;
  until?: number;
}

const HEX64 = /^[0-9a-f]{64}$/i;

function decodeKey(token: string): { id?: string; author?: string } | null {
  if (HEX64.test(token)) return { id: token.toLowerCase() };
  try {
    const d = nip19.decode(token);
    if (d.type === "note") return { id: d.data as string };
    if (d.type === "nevent") return { id: (d.data as { id: string }).id };
    if (d.type === "npub") return { author: d.data as string };
    if (d.type === "nprofile") return { author: (d.data as { pubkey: string }).pubkey };
  } catch {}
  return null;
}

export function parseEventQuery(text: string): EventQuery {
  const q: EventQuery = {};
  const words: string[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const kind = /^(?:kind|k):(\d+)$/i.exec(token);
    if (kind) { q.kind = Number(kind[1]); continue; }
    const key = decodeKey(token.replace(/^nostr:/, ""));
    if (key?.id) { q.id = key.id; continue; }
    if (key?.author) { q.author = key.author; continue; }
    words.push(token);
  }
  if (words.length) q.text = words.join(" ");
  return q;
}

export function sinceFor(range: RangeId | "custom", nowSec: number): number | undefined {
  const r = TIME_RANGES.find((x) => x.id === range);
  return r?.seconds ? nowSec - r.seconds : undefined;
}

/** The filter sent to the relay. Words are matched on this side, after. */
export function queryFilter(q: EventQuery, window: TimeWindow, nowSec: number, limit = 100): NostrFilter {
  if (q.id) return { ids: [q.id] };
  const f: NostrFilter = { limit };
  if (q.author) f.authors = [q.author];
  if (q.kind !== undefined) f.kinds = [q.kind];
  if (window.range === "custom") {
    if (window.since) f.since = window.since;
    if (window.until) f.until = window.until;
  } else {
    const since = sinceFor(window.range, nowSec);
    if (since) f.since = since;
  }
  return f;
}

/** Views saved when the search was five boxes still load into the one field. */
export function queryFromSavedToolbar(t: SavedToolbarState): string {
  if (t.searchEventId) return t.searchEventId.trim();
  const parts: string[] = [];
  const kind = t.searchKind || (t.kindFilter && t.kindFilter !== "all" ? t.kindFilter : "");
  if (kind) parts.push(`kind:${kind}`);
  const author = t.searchAuthor || t.authorFilter;
  if (author) parts.push(author.trim());
  if (t.searchContent) parts.push(t.searchContent.trim());
  return parts.join(" ");
}
