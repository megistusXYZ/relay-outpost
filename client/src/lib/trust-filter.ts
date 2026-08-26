import { useState, useEffect, useCallback } from "react";
import { getSignalTier, type SignalTier } from "@/lib/graperank";

/**
 * Shared Web-of-Trust filter primitives.
 *
 * There is ONE filter definition — the set of excluded tiers — persisted under the
 * same localStorage key the feed already uses (`relay-outpost-excluded-tiers`), so a
 * user configures their trust filter once and it's reused by the feed and by any
 * relay outpost. Each outpost then has its own on/off toggle (opt-in, off by default)
 * that decides whether to APPLY that shared definition across its tabs.
 */

const EXCLUDED_TIERS_KEY = "relay-outpost-excluded-tiers";
const TIERS_CHANGE_EVENT = "trust-filter-tiers-changed";

export function readExcludedTiers(): Set<SignalTier> {
  try {
    const raw = localStorage.getItem(EXCLUDED_TIERS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? (arr as SignalTier[]) : []);
  } catch {
    return new Set();
  }
}

export function writeExcludedTiers(tiers: Set<SignalTier>): void {
  try {
    localStorage.setItem(EXCLUDED_TIERS_KEY, JSON.stringify([...tiers]));
  } catch {
    /* ignore quota / private-mode */
  }
  // Notify same-tab listeners (storage event only fires cross-tab).
  window.dispatchEvent(new CustomEvent(TIERS_CHANGE_EVENT));
}

/** Live-synced view of the one shared excluded-tier set (feed + outposts stay in sync). */
export function useExcludedTiers() {
  const [excludedTiers, setExcludedTiers] = useState<Set<SignalTier>>(() => readExcludedTiers());

  useEffect(() => {
    const sync = () => setExcludedTiers(readExcludedTiers());
    window.addEventListener(TIERS_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TIERS_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggleTier = useCallback((tier: SignalTier) => {
    setExcludedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      writeExcludedTiers(next);
      return next;
    });
  }, []);

  const clearTiers = useCallback(() => {
    setExcludedTiers(new Set());
    writeExcludedTiers(new Set());
  }, []);

  return { excludedTiers, toggleTier, clearTiers };
}

/** Per-outpost on/off, keyed by relay URL (opt-in; defaults off). */
function outpostKey(relayUrl: string) {
  return `relay-outpost-trust-filter:${relayUrl}`;
}

export function readOutpostFilterOn(relayUrl: string): boolean {
  try {
    return localStorage.getItem(outpostKey(relayUrl)) === "true";
  } catch {
    return false;
  }
}

export function writeOutpostFilterOn(relayUrl: string, on: boolean): void {
  try {
    localStorage.setItem(outpostKey(relayUrl), on ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/**
 * Flicker-safe hide decision for a single author.
 *
 * Rules (matches the locked design):
 *  - Filter off / no excluded tiers → never hide.
 *  - A RESOLVED influence number → hide iff its tier is excluded.
 *  - Unscored (no number): stay VISIBLE until we definitively know it's "none"
 *    (`resolved` true). This avoids the hide→show flicker where an author defaults
 *    to "none" on first paint and then resolves to a trusted tier. Excluding the
 *    "none" tier is therefore an explicit, deliberate opt-in to hide people outside
 *    your network — and only takes effect once their score has settled.
 */
export function isHiddenByTrust(opts: {
  enabled: boolean;
  excludedTiers: Set<SignalTier>;
  influence: number | null;
  flagged: boolean;
  resolved: boolean;
}): boolean {
  const { enabled, excludedTiers, influence, flagged, resolved } = opts;
  if (!enabled || excludedTiers.size === 0) return false;
  // "flagged" is its own tier, tracked separately from influence — an account
  // your network reported can still carry a positive influence, so getSignalTier
  // (which only reads influence) never returns "flagged". Check it explicitly and
  // first, otherwise a filter that excludes "flagged" (e.g. the Balanced preset)
  // lets flagged accounts straight through.
  if (flagged && excludedTiers.has("flagged")) return true;
  if (influence != null) return excludedTiers.has(getSignalTier(influence));
  if (!resolved) return false; // not yet known → keep visible
  return excludedTiers.has("none");
}
