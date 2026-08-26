/**
 * React side of the impersonation guard: builds the trusted-identity list from
 * data ALREADY in memory (follow list + strong/moderate GrapeRank tiers +
 * session profile cache — zero relay fetches) and runs the pure engine for one
 * candidate. Verdicts cache per pubkey inside the engine, so per-row usage on
 * request lists / thread replies costs a couple of Map lookups after the first
 * check.
 */
import { useMemo } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getCachedProfile } from "@/lib/nostr";
import { getSignalTier } from "@/lib/graperank";
import {
  checkImpersonation,
  type ImpersonationVerdict,
  type NameIdentity,
} from "@/lib/impersonation-check";

// Parsed kind-0 content, cached per event object (profile events are stable
// references in the session cache — parse each at most once).
const parsedProfiles = new WeakMap<object, { name: string; names: string[]; nip05?: string }>();

function identityFromCache(pubkey: string): NameIdentity {
  const ev = getCachedProfile(pubkey);
  if (!ev || typeof ev !== "object" || typeof ev.content !== "string") {
    return { pubkey, displayName: "" };
  }
  let parsed = parsedProfiles.get(ev);
  if (!parsed) {
    let name = "";
    let names: string[] = [];
    let nip05: string | undefined;
    try {
      const c = JSON.parse(ev.content);
      // BOTH aliases. `display_name || name` picked one and discarded the other,
      // which loses a real match whenever they differ — the trusted CryptoCloaks
      // publishes display_name "CryptoCloaks™" and name "CryptoCloaks", and the
      // plain one is exactly what an impersonator copies.
      names = [c?.display_name, c?.name].filter((x): x is string => typeof x === "string" && !!x.trim());
      name = names[0] ?? "";
      if (typeof c?.nip05 === "string") nip05 = c.nip05;
    } catch {}
    parsed = { name, names, nip05 };
    parsedProfiles.set(ev, parsed);
  }
  return { pubkey, displayName: parsed.name, displayNames: parsed.names, nip05: parsed.nip05 };
}

// Trusted-list rebuilds are throttled: follows changes (rare) rebuild
// immediately; score-map churn (accumulator flushes every ~150ms during
// hydration) only triggers a rebuild every REBUILD_INTERVAL_MS. A rebuild
// produces a NEW array, which also rolls the engine's per-set verdict cache.
const REBUILD_INTERVAL_MS = 10_000;
let trustedCache: {
  selfPubkey: string | null;
  followsRef: readonly string[] | null;
  builtAt: number;
  list: NameIdentity[];
} | null = null;

function getTrustedIdentities(
  selfPubkey: string | null,
  follows: readonly string[] | null,
  scores: Map<string, number> | null
): NameIdentity[] {
  const c = trustedCache;
  if (
    c &&
    c.selfPubkey === selfPubkey &&
    c.followsRef === follows &&
    // Deliberately NOT keyed on the scores ref (it churns every ~150ms during
    // hydration) — the age bound alone folds in both new scores and the
    // late-arriving names in the session profile cache.
    Date.now() - c.builtAt < REBUILD_INTERVAL_MS
  ) {
    return c.list;
  }

  const pubkeys = new Set<string>();
  if (selfPubkey) pubkeys.add(selfPubkey); // lookalikes of *me* count too
  if (follows) for (const pk of follows) pubkeys.add(pk);
  if (scores) {
    for (const [pk, score] of scores) {
      if (pubkeys.has(pk)) continue;
      const tier = getSignalTier(score);
      if (tier === "strong" || tier === "moderate") pubkeys.add(pk);
    }
  }
  // Entries without a cached profile keep an empty name: the engine skips them
  // for matching but their pubkey still participates in the in-network exit.
  const list: NameIdentity[] = [];
  for (const pk of pubkeys) list.push(identityFromCache(pk));
  trustedCache = { selfPubkey, followsRef: follows, builtAt: Date.now(), list };
  return list;
}

export interface ImpersonationCandidate {
  pubkey?: string | null;
  /** The PROFILE-claimed display name — never pass an npub fallback. */
  displayName?: string | null;
  nip05?: string | null;
  /** Set false to skip all work (e.g. rows outside the Requests tab). */
  enabled?: boolean;
}

/**
 * Verdict for one candidate account, or null. Null whenever: disabled, no
 * pubkey/display name, signed out, the candidate is the user or in-network,
 * or no trusted name resembles the candidate's.
 */
export function useImpersonationCheck(candidate: ImpersonationCandidate): ImpersonationVerdict | null {
  const { pubkey: myPubkey, follows } = useNostrAuth();
  const { scores } = useGrapeRankScores();

  const { pubkey, displayName, nip05, enabled = true } = candidate;

  return useMemo(() => {
    if (!enabled || !pubkey || !displayName) return null;
    if (!myPubkey) return null; // signed-out: no network to protect
    if (pubkey === myPubkey) return null;
    const trusted = getTrustedIdentities(myPubkey, follows, scores);
    if (trusted.length === 0) return null;
    return checkImpersonation({ pubkey, displayName, nip05: nip05 ?? undefined }, trusted);
  }, [enabled, pubkey, displayName, nip05, myPubkey, follows, scores]);
}
