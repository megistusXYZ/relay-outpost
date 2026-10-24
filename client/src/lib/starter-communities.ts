/**
 * Curated starter communities for the Outposts hub: good rooms a new person
 * can join without knowing what to search for. The list lives in
 * shared/curated-lists.ts (served at /api/curated; this file's copy is the
 * built-in fallback).
 */
import { CURATED_LISTS, type StarterCommunity } from "@shared/curated-lists";

export type { StarterCommunity };

export const STARTER_COMMUNITIES: StarterCommunity[] = CURATED_LISTS.starterCommunities;

function canon(url: string): string {
  return url.trim().toLowerCase().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

/** The curated list (the server's, or the built-in one) minus anything the user already joined. */
export function starterSuggestions(joinedUrls: string[], list: StarterCommunity[] = STARTER_COMMUNITIES): StarterCommunity[] {
  const joined = new Set(joinedUrls.map(canon));
  return list.filter((c) => !joined.has(canon(c.url)));
}
