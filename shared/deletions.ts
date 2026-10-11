/**
 * Honouring NIP-09 deletions in what the server hands out (owner, 2026-10-11):
 * a post its author deleted never reaches the first screen or Discover. Only
 * the author's own, properly signed deletion counts.
 */
import { verifyEvent } from "nostr-tools";
import { isSignedEvent } from "./discover-samples";

const isAddressable = (kind: number) => kind >= 30000 && kind < 40000;

export interface EventLike { id: string; pubkey: string; kind: number; tags: string[][] }

/** Enough of an event to be matched against a deletion. `pick` does the full check. */
export function looksLikeEvent(x: unknown): x is EventLike {
  const e = x as EventLike | null;
  return !!e && typeof e === "object" && typeof e.id === "string" && typeof e.pubkey === "string" && typeof e.kind === "number" && Array.isArray(e.tags);
}

/** The ask that follows a read: the authors' deletions, once each. */
export function deletionAsk(events: readonly { pubkey: string }[]): { kinds: number[]; authors: string[]; limit: number } | null {
  const authors = Array.from(new Set(events.map((e) => e.pubkey)));
  return authors.length > 0 ? { kinds: [5], authors, limit: 500 } : null;
}

/** `events` without those their own author deleted (by id, or by address for addressable kinds). */
export function dropDeleted<T extends EventLike>(events: readonly T[], deletions: readonly unknown[]): T[] {
  const ids = new Set<string>();
  const addresses = new Set<string>();
  for (const x of deletions) {
    if (!isSignedEvent(x, [5]) || !verifyEvent(x as any)) continue;
    for (const t of x.tags) {
      if (t[0] === "e" && t[1]) ids.add(`${x.pubkey}:${t[1]}`);
      if (t[0] === "a" && t[1] && t[1].split(":")[1] === x.pubkey) addresses.add(t[1]);
    }
  }
  if (ids.size === 0 && addresses.size === 0) return [...events];
  return events.filter((e) => {
    if (ids.has(`${e.pubkey}:${e.id}`)) return false;
    if (isAddressable(e.kind)) {
      const d = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
      if (addresses.has(`${e.kind}:${e.pubkey}:${d}`)) return false;
    }
    return true;
  });
}
