/**
 * The communities the Outposts hub features above its "Run a community? Get
 * it featured here." line. The list lives in shared/curated-lists.ts (served
 * at /api/curated, with the built-in copy as fallback) and is empty as
 * shipped: the hub advertises no community of its own (owner, 2026-11-22).
 */
import type { StarterCommunity } from "@shared/curated-lists";

export type { StarterCommunity };

function canon(url: string): string {
  return url.trim().toLowerCase().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

/** The featured list minus anything the user already joined. */
export function starterSuggestions(joinedUrls: string[], list: StarterCommunity[]): StarterCommunity[] {
  const joined = new Set(joinedUrls.map(canon));
  return list.filter((c) => !joined.has(canon(c.url)));
}
