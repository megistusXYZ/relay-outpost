/**
 * Which relays a brand-new account is given, and which it reads from, by the
 * state of its wider-network switch (owner, 2026-10-10; lib/network-mode.ts).
 *
 * While the wider network is OFF the account carries a two-relay FLOOR —
 * enough that friends on other apps can find its profile and message it,
 * and nothing more. Opening the wider network expands its relay list to the
 * app's defaults, junk-filtered (a test relay from the discovery pool reached
 * a real account's list), with the pay-to-post relay marked read-only so
 * other apps never send this account's posts somewhere that refuses them.
 *
 * No public relay is a safe content source — none declares moderation beyond
 * spam — so these lists are about reach, never about safety. Pure.
 */
import { DEFAULT_RELAYS } from "./relay-constants";
import { isJunkRelay } from "../../../shared/relay-junk";

/** The floor: profile and inbox reachable from other apps. */
export const FLOOR_RELAYS: readonly string[] = ["wss://relay.damus.io", "wss://nos.lol"];

/** Relays other apps are told to post to that would refuse a new account's writes. */
const READ_ONLY_RELAYS = new Set(["wss://nostr.land"]); // payment required (its own NIP-11, 2026-10-10)

const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

export function floorRelayList(): string[] {
  return [...FLOOR_RELAYS];
}

export function floorDmRelayList(): string[] {
  return [...FLOOR_RELAYS];
}

/** The kind-10002 `r` tags for an account with the wider network on. */
export function expandedRelayTags(opts: { junkCandidates?: string[] } = {}): string[][] {
  const candidates = [...DEFAULT_RELAYS, ...(opts.junkCandidates ?? [])];
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const url of candidates) {
    const key = norm(url);
    if (seen.has(key) || isJunkRelay(url)) continue;
    seen.add(key);
    out.push(READ_ONLY_RELAYS.has(key) ? ["r", url, "read"] : ["r", url]);
  }
  return out;
}

/**
 * What the switch publishes as the account's relay list.
 * On: everything already there (own markers kept) plus the expanded defaults.
 * Off: the floor plus the communities this account joined — a flip must never
 * drop a community the person chose.
 */
export function relayTagsForMode(on: boolean, current: string[][], joinedCommunityRelays: string[]): string[][] {
  const currentR = current.filter((t) => t[0] === "r" && typeof t[1] === "string");
  if (on) {
    const out = [...currentR];
    const seen = new Set(currentR.map((t) => norm(t[1])));
    for (const tag of expandedRelayTags()) {
      if (seen.has(norm(tag[1]))) continue;
      seen.add(norm(tag[1]));
      out.push(tag);
    }
    return out;
  }
  const keep = new Set([...FLOOR_RELAYS, ...joinedCommunityRelays].map(norm));
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const url of FLOOR_RELAYS) {
    seen.add(norm(url));
    out.push(currentR.find((t) => norm(t[1]) === norm(url)) ?? ["r", url]);
  }
  for (const t of currentR) {
    const key = norm(t[1]);
    if (!keep.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Where feeds are read from: today's list when on (or no switch), the floor when off. */
export function readRelaysForMode(on: boolean, fast: readonly string[]): string[] {
  return on ? [...fast] : floorRelayList();
}
