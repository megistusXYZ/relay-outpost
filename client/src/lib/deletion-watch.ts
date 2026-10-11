/**
 * Honouring everyone's deletions (owner, 2026-10-11): for every author whose
 * posts we show, ask their deletions (kind 5) once, by author, and drop what
 * they named: from the event store (applesauce removes the author's own
 * events on a kind 5) and from the deleted-ids set that feeds, threads and
 * tombstones read. One request per batch of new authors, never per post.
 */
import type { Event } from "nostr-tools";

const HEX64 = /^[0-9a-f]{64}$/;

/** The event ids a deletion names. Only a kind 5 counts; only well-formed ids. */
export function deletedIdsFrom(event: Pick<Event, "kind" | "tags">): string[] {
  if (event.kind !== 5) return [];
  return event.tags.filter((t) => t[0] === "e" && HEX64.test(t[1] || "")).map((t) => t[1]);
}

/** The authors not yet asked, in order, each added to `seen`. */
export function authorsToAsk(seen: Set<string>, authors: string[]): string[] {
  const out: string[] = [];
  for (const a of authors) {
    if (!HEX64.test(a) || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}
