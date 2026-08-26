import { useState, useEffect, useCallback } from "react";
import type { ReachDepth } from "@/lib/spam-filter";
import type { SignalTier } from "@/lib/graperank";
import { readExcludedTiers, writeExcludedTiers } from "@/lib/trust-filter";

/**
 * "How strict is your feed?" — one plain-language preset that drives the two
 * underlying knobs the feed already honors: reach depth
 * (`relay-outpost-reach-depth`) and hidden trust tiers
 * (`relay-outpost-excluded-tiers`, shared with the feed + outpost filter).
 *
 * The preset is DERIVED: if the current (reach, tiers) exactly match a preset's
 * definition it's "active"; otherwise the user has hand-tuned the raw Advanced
 * knobs and we show "custom". Selecting a preset writes both keys + fires the
 * change events so the raw controls and feed stay in sync.
 */

const REACH_KEY = "relay-outpost-reach-depth";
const REACH_CHANGE_EVENT = "reach-depth-changed";
const TIERS_CHANGE_EVENT = "trust-filter-tiers-changed"; // matches trust-filter.ts
const VALID_REACH: ReachDepth[] = ["1hop", "2hops", "3hops", "global", "off"];

export function readReachDepth(): ReachDepth {
  try {
    const s = localStorage.getItem(REACH_KEY);
    if (s && VALID_REACH.includes(s as ReachDepth)) return s as ReachDepth;
  } catch {
    /* ignore */
  }
  return "global";
}

export function writeReachDepth(v: ReachDepth): void {
  try {
    localStorage.setItem(REACH_KEY, v);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(REACH_CHANGE_EVENT));
}

export type StrictnessPreset = "open" | "balanced" | "strict" | "custom";

export const PRESET_DEFS: Record<
  Exclude<StrictnessPreset, "custom">,
  { reach: ReachDepth; tiers: SignalTier[]; label: string; blurb: string }
> = {
  open: { reach: "global", tiers: [], label: "Open", blurb: "Everyone — no filtering" },
  balanced: { reach: "global", tiers: ["flagged"], label: "Balanced", blurb: "Hide accounts your network flagged as bad" },
  strict: { reach: "2hops", tiers: ["flagged", "none", "weak"], label: "Strict", blurb: "Only well-trusted people close to your network" },
};

/** The default a brand-new user lands on. */
export const DEFAULT_PRESET: Exclude<StrictnessPreset, "custom"> = "balanced";

function sameTiers(have: Set<SignalTier>, want: SignalTier[]): boolean {
  if (have.size !== want.length) return false;
  return want.every((t) => have.has(t));
}

export function detectPreset(reach: ReachDepth, tiers: Set<SignalTier>): StrictnessPreset {
  for (const name of ["open", "balanced", "strict"] as const) {
    const def = PRESET_DEFS[name];
    if (def.reach === reach && sameTiers(tiers, def.tiers)) return name;
  }
  // "Open" means no filtering: empty hidden tiers + unfiltered reach. The default
  // reach is "off" (no reach limit), which is display-equivalent to "global" here,
  // so both map to Open rather than falling through to "custom". Display-only — this
  // does not change what "off" does downstream.
  if (tiers.size === 0 && (reach === "off" || reach === "global")) return "open";
  return "custom";
}

export function applyPreset(name: Exclude<StrictnessPreset, "custom">): void {
  const def = PRESET_DEFS[name];
  writeReachDepth(def.reach);
  writeExcludedTiers(new Set(def.tiers));
}

/** Live-synced preset view: reflects raw-knob edits as "custom" and applies presets. */
export function useStrictnessPreset() {
  const [reach, setReach] = useState<ReachDepth>(() => readReachDepth());
  const [tiers, setTiers] = useState<Set<SignalTier>>(() => readExcludedTiers());

  useEffect(() => {
    const syncReach = () => setReach(readReachDepth());
    const syncTiers = () => setTiers(readExcludedTiers());
    const syncBoth = () => { syncReach(); syncTiers(); };
    window.addEventListener(REACH_CHANGE_EVENT, syncReach);
    window.addEventListener(TIERS_CHANGE_EVENT, syncTiers);
    window.addEventListener("storage", syncBoth);
    return () => {
      window.removeEventListener(REACH_CHANGE_EVENT, syncReach);
      window.removeEventListener(TIERS_CHANGE_EVENT, syncTiers);
      window.removeEventListener("storage", syncBoth);
    };
  }, []);

  const preset = detectPreset(reach, tiers);
  const setPreset = useCallback((name: Exclude<StrictnessPreset, "custom">) => applyPreset(name), []);
  return { preset, reach, tiers, setPreset };
}
