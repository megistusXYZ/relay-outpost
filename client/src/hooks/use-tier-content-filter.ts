import { useCallback } from "react";
import type { Event } from "nostr-tools";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useExcludedTiers } from "@/lib/trust-filter";
import type { SignalTier } from "@/lib/graperank";

/**
 * Shared tier-chip content filter for feeds that live OUTSIDE Home's pipeline
 * (the macro Images/Videos/Polls feeds rendered under the Saved tab and as
 * standalone pages). Mirrors Home's applyTierFilter semantics exactly:
 *
 *  - Reads the ONE shared excluded-tier set (live-synced via useExcludedTiers,
 *    so toggling a chip in Home's FeedTierFilter bar updates an embedded feed
 *    in the same tab immediately).
 *  - Flicker-safe: inert until this observer has a COMPLETED calculation
 *    (wotReady) — a never-calculated user would otherwise filter on phantom
 *    "none" tiers and watch content vanish as scores stream in.
 *  - "flagged" is checked explicitly and first: it's tracked separately from
 *    influence, so getAuthorTier (which only reads influence) never returns it.
 */
export function useTierContentFilter() {
  const { excludedTiers } = useExcludedTiers();
  const { wotEnabled, wotReady, flaggedPubkeys, getAuthorTier } = useGrapeRankScores();

  return useCallback(
    <T extends Event>(events: T[]): T[] => {
      if (excludedTiers.size === 0 || !wotEnabled || !wotReady) return events;
      return events.filter((e) => {
        const isFlagged = flaggedPubkeys?.has(e.pubkey) ?? false;
        const effectiveTier: SignalTier = isFlagged ? "flagged" : getAuthorTier(e.pubkey);
        return !excludedTiers.has(effectiveTier);
      });
    },
    [excludedTiers, wotEnabled, wotReady, flaggedPubkeys, getAuthorTier],
  );
}
