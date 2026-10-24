/**
 * One person's profile, asked of the profile directories directly, with their
 * trust score: what Search shows on top when you search an exact npub or
 * name@domain. It used Brainstorm's search API, which has answered its web
 * page instead of data since 2026-09-28, so that person never showed.
 */
import type { Event } from "nostr-tools";
import { pool, PROFILE_RELAYS, registerProfileInAllCaches } from "./nostr";
import { fetchBrainstormWotBatch } from "./brainstorm-search";

const WAIT_MS = 4_000;

export interface ProfileDirectDeps {
  /** Every kind-0 the directories hold for this person. */
  query: (pubkey: string) => Promise<Event[]>;
  /** Trust scores (0..1) by pubkey, as the rest of the app reads them. */
  score: (pubkey: string) => Promise<Map<string, number>>;
  /** Keep the profile where every screen finds it. */
  remember: (event: Event) => void;
}

export async function lookupProfileDirectWith(pubkey: string, deps: ProfileDirectDeps): Promise<{ event: Event | null; wotScore: number | null }> {
  let events: Event[] = [];
  try { events = await deps.query(pubkey); } catch { events = []; }
  const newest = events
    .filter((e) => e.kind === 0 && e.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  if (!newest) return { event: null, wotScore: null };
  deps.remember(newest);
  let wotScore: number | null = null;
  try { wotScore = (await deps.score(pubkey)).get(pubkey) ?? null; } catch { wotScore = null; }
  return { event: newest, wotScore };
}

export function lookupProfileDirect(pubkey: string): Promise<{ event: Event | null; wotScore: number | null }> {
  return lookupProfileDirectWith(pubkey, {
    query: (pk) => pool.querySync(PROFILE_RELAYS, { kinds: [0], authors: [pk] }, { maxWait: WAIT_MS }),
    score: (pk) => fetchBrainstormWotBatch([pk]),
    remember: registerProfileInAllCaches,
  });
}
