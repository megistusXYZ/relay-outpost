/**
 * Trust on a card, said once and without a number (owner, 2026-10-03): a
 * small mark beside the name and a phrase about the reader's network on the
 * status line. Both hide until the reader's own calculation exists, and
 * inside a tier section (the heading already says it). The words live in
 * lib/trust-words.ts; the percentage stays in the profile's trust panel.
 */
import { useCallback } from "react";
import { AlertTriangle, Shield, ShieldCheck } from "lucide-react";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getTrustMark, getTrustPhrase } from "@/lib/trust-words";
import { getSignalTier, type SignalTier } from "@/lib/graperank";

export function TrustMark({ tier, className }: { tier: SignalTier; className?: string }) {
  const { wotEnabled, wotReady } = useGrapeRankScores();
  if (!wotEnabled || !wotReady) return null;
  const mark = getTrustMark(tier);
  if (!mark) return null;
  const phrase = getTrustPhrase(tier);
  const common = { "aria-label": phrase, role: "img" as const, "data-testid": "trust-mark", "data-mark": mark };
  if (mark === "warning") {
    return <AlertTriangle className={`w-3.5 h-3.5 shrink-0 text-amber-700 dark:text-amber-400 ${className ?? ""}`} {...common}><title>{phrase}</title></AlertTriangle>;
  }
  return mark === "filled"
    ? <ShieldCheck className={`w-3.5 h-3.5 shrink-0 text-brand fill-brand/20 ${className ?? ""}`} {...common}><title>{phrase}</title></ShieldCheck>
    : <Shield className={`w-3.5 h-3.5 shrink-0 text-brand/70 ${className ?? ""}`} {...common}><title>{phrase}</title></Shield>;
}

/** The phrase for a status line. `bare` drops the leading "·" for a line of its own. */
export function TrustPhrase({ tier, bare = false, className }: { tier: SignalTier; bare?: boolean; className?: string }) {
  const { wotEnabled, wotReady } = useGrapeRankScores();
  if (!wotEnabled || !wotReady) return null;
  const phrase = getTrustPhrase(tier);
  if (!phrase) return null;
  const warn = tier === "flagged";
  return (
    <span className={`text-[12px] truncate ${warn ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"} ${className ?? ""}`} data-testid="trust-phrase">
      {!bare && <span className="mx-1" aria-hidden="true">·</span>}{phrase}
    </span>
  );
}

/**
 * A person's tier for a list, concerns first: someone your network has
 * concerns about is "flagged" whatever their score says (2026-11-17: a flagged
 * person with a high score read "Trusted by your network" on Following).
 */
export function useTrustTierOf(): (pubkey: string, influence?: number | null) => SignalTier | null {
  const { isAuthorFlagged, getAuthorInfluence, wotEnabled } = useGrapeRankScores();
  return useCallback((pubkey: string, influence?: number | null) => {
    if (wotEnabled && isAuthorFlagged(pubkey)) return "flagged";
    // No score passed: read the person's own (the lists that carry one, like
    // Following's connection scores, pass it in).
    const s = influence === undefined ? getAuthorInfluence(pubkey) : influence;
    return s !== null && s !== undefined ? getSignalTier(s) : null;
  }, [isAuthorFlagged, getAuthorInfluence, wotEnabled]);
}
