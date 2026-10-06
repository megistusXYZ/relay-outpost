import { useEffect, useState } from "react";
import type { ReachDepth } from "@/lib/spam-filter";
import type { SignalTier } from "@/lib/graperank";
import { readExcludedTiers, writeExcludedTiers } from "@/lib/trust-filter";
import { readReachDepth, writeReachDepth } from "@/lib/trust-preset";

/**
 * "How careful should we be with people you don't know?" — the one question
 * the Trust page asks (owner, 2026-10-06: make it an easy concept). Each
 * answer sets the three things the feeds already honor: whether trust scores
 * are on, which trust levels are hidden, and the reach filter.
 *
 * Reach is only ever "off" or "global" here: Home reads the hop depths
 * (1hop/2hops/3hops) as "global", so a choice built on them showed as
 * "Custom" on the feed.
 */
export type TrustChoice = "everything" | "balanced" | "careful";

export const TRUST_CHOICES: Record<TrustChoice, { wot: boolean; reach: ReachDepth; tiers: SignalTier[]; label: string; line: string }> = {
  everything: { wot: false, reach: "off", tiers: [], label: "See everything", line: "Nothing is hidden. Your mutes and reports still apply." },
  balanced: { wot: true, reach: "global", tiers: ["flagged"], label: "Balanced", line: "Hides accounts that people you trust have flagged." },
  careful: { wot: true, reach: "global", tiers: ["flagged", "none", "weak"], label: "Careful", line: "Also hides accounts your network doesn't know yet." },
};

export const WOT_ENABLED_KEY = "relay-outpost-wot-enabled";
const WOT_CHOICE_SET_KEY = "relay-outpost-wot-choice-set";
/** The trust-score provider listens for this to follow a choice made here. */
export const WOT_ENABLED_EVENT = "wot-enabled-changed";

export function readWotEnabled(): boolean {
  try { return localStorage.getItem(WOT_ENABLED_KEY) === "true"; } catch { return false; }
}

function writeWotEnabled(on: boolean): void {
  try {
    localStorage.setItem(WOT_ENABLED_KEY, String(on));
    localStorage.setItem(WOT_CHOICE_SET_KEY, "true");
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(WOT_ENABLED_EVENT)); } catch { /* ignore */ }
}

export function applyTrustChoice(choice: TrustChoice): void {
  const def = TRUST_CHOICES[choice];
  writeWotEnabled(def.wot);
  writeReachDepth(def.reach);
  writeExcludedTiers(new Set(def.tiers));
}

/** The choice the stored settings add up to; "custom" when tuned by hand. */
export function trustChoiceOf(s: { wot: boolean; reach: ReachDepth; tiers: Set<SignalTier> }): TrustChoice | "custom" {
  if (!s.wot) return "everything";
  for (const name of ["balanced", "careful"] as const) {
    const def = TRUST_CHOICES[name];
    const sameTiers = s.tiers.size === def.tiers.length && def.tiers.every((t) => s.tiers.has(t));
    if (sameTiers && s.reach === def.reach) return name;
  }
  return "custom";
}

export function readTrustChoice(): TrustChoice | "custom" {
  return trustChoiceOf({ wot: readWotEnabled(), reach: readReachDepth(), tiers: readExcludedTiers() });
}

/** A brand-new account starts on Balanced (owner, 2026-10-06). */
export function startNewAccountTrust(): void {
  applyTrustChoice("balanced");
}

/** Has this account ever answered the question (or the old switch)? */
export function hasMadeTrustChoice(): boolean {
  try { return localStorage.getItem(WOT_CHOICE_SET_KEY) === "true"; } catch { return false; }
}

const CHANGE_EVENTS = ["trust-filter-tiers-changed", "reach-depth-changed", WOT_ENABLED_EVENT, "nip78-settings-applied", "storage"];

/** The current choice, kept live as the feeds, Fine-tune or another device change it. */
export function useTrustChoice(): { choice: TrustChoice | "custom"; chosen: boolean } {
  const read = () => ({ choice: readTrustChoice(), chosen: hasMadeTrustChoice() });
  const [state, setState] = useState(read);
  useEffect(() => {
    const sync = () => setState(read());
    for (const ev of CHANGE_EVENTS) window.addEventListener(ev, sync);
    return () => { for (const ev of CHANGE_EVENTS) window.removeEventListener(ev, sync); };
  }, []);
  return state;
}
