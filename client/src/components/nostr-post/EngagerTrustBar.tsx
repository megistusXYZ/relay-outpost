/**
 * How the people who engaged with a post sit in the reader's network: one bar,
 * one legend, one plain sentence. Shared by the "Who engaged" and "Engagement
 * score" pop-ups (it was two hand-kept copies).
 *
 * Colours come from TIER_GLYPH, the one trust colour map, so the bar, its
 * legend and the dot beside every author name agree, and red stays for
 * concerns only. Legend marks are the glyphs themselves (shape as well as
 * colour). Words are the tier words (Trusted · Known · New · Few ties ·
 * Concerns) and plain sentences; no raw averages or percentages on screen —
 * the numbers stay in the tooltips for anyone who wants them.
 */
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTierLabel, type SignalTier } from "@/lib/graperank";
import { TIER_GLYPH, TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";

type Participant = { pubkey: string };

const ORDER: SignalTier[] = ["strong", "moderate", "low", "weak", "flagged", "none"];

// No score at all reads "No data", as in the thread bar (not a verdict).
const word = (tier: SignalTier) => (tier === "none" ? "No data" : getSignalTierLabel(tier));

function barColour(tier: SignalTier): string {
  if (tier === "flagged") return "bg-danger";
  if (tier === "none") return "bg-foreground/15";
  return TIER_GLYPH[tier].className;
}

export function EngagerTrustBar({ participants }: { participants: Participant[] }) {
  const { scores, getAuthorTier, getAuthorInfluence, isAuthorFlagged, wotEnabled } = useGrapeRankScores();
  if (!wotEnabled || !scores || scores.size === 0 || participants.length === 0) return null;

  const counts: Record<SignalTier, number> = { strong: 0, moderate: 0, low: 0, weak: 0, flagged: 0, none: 0 };
  const allScores: number[] = [];
  let scoredCount = 0;
  let totalWeight = 0;
  for (const p of participants) {
    const influence = getAuthorInfluence(p.pubkey);
    allScores.push(influence ?? 0);
    if (influence !== null) { scoredCount++; totalWeight += influence; }
    if (isAuthorFlagged(p.pubkey)) { counts.flagged++; continue; }
    const t = getAuthorTier(p.pubkey);
    counts[t === "strong" || t === "moderate" || t === "low" || t === "weak" ? t : "none"]++;
  }
  const total = participants.length;
  const scored = total - counts.none;
  if (total === 0) return null;

  const avg = scoredCount > 0 ? totalWeight / scoredCount : 0;
  const topN = Math.max(1, Math.min(3, Math.ceil(total * 0.1)));
  const topWeight = [...allScores].sort((a, b) => b - a).slice(0, topN).reduce((s, v) => s + v, 0);
  const concentration = totalWeight > 0 ? topWeight / totalWeight : 0;
  const trustedRatio = (counts.strong + counts.moderate) / total;

  // The read on the whole group, as a status word: never a pill.
  const verdict = counts.flagged > 0 && counts.flagged >= total * 0.2
    ? { word: "Suspicious", tone: "text-danger", desc: `${counts.flagged} ${counts.flagged === 1 ? "person your network has concerns about" : "people your network has concerns about"}` }
    : total >= 10 && concentration > 0.85 && avg < 0.02
    ? { word: "Inorganic", tone: "text-danger", desc: "Most of the trust comes from a few accounts" }
    : trustedRatio >= 0.5
    ? { word: "Organic", tone: "text-success", desc: "Most of it comes from people your network trusts" }
    : trustedRatio >= 0.2
    ? { word: "Mixed", tone: "text-amber-700 dark:text-amber-400", desc: "Some from people your network trusts, some from people it doesn't know" }
    : { word: "Unverified", tone: "text-muted-foreground", desc: "Too few people with ties to your network to say" };

  const spread = total < 4 ? null : concentration > 0.85 ? "the trust sits with a few accounts" : concentration > 0.6 ? "the trust is somewhat concentrated" : "the trust is spread widely";
  const numbers = `Average ${avg.toFixed(4)}${total >= 4 ? ` · top ${topN} hold ${Math.round(concentration * 100)}%` : ""}`;

  const segments = ORDER.filter((t) => counts[t] > 0);

  return (
    <div className="pt-2 mt-2 border-t border-border/60 space-y-2" data-testid="engager-trust-bar">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">Trust among them</p>
        <span className={`text-[12px] font-semibold ${verdict.tone}`} data-testid="engager-trust-verdict">{verdict.word}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden flex gap-px bg-foreground/[0.06]" role="img" aria-label={segments.map((t) => `${word(t)} ${counts[t]}`).join(", ")}>
        {segments.map((t) => (
          <div
            key={t}
            className={`h-full ${barColour(t)}`}
            style={{ width: `${(counts[t] / total) * 100}%`, minWidth: "3px" }}
            title={`${word(t)}: ${counts[t]}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
        {segments.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <TrustTierGlyph tier={t} size={t === "flagged" ? "w-3 h-3" : "w-2 h-2"} decorative />
            {word(t)} <span className="tabular-nums text-foreground">{counts[t]}</span>
          </span>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground leading-snug" title={scoredCount > 0 ? numbers : undefined}>
        {verdict.desc}{scoredCount > 0 && spread ? `; ${spread}` : ""}.
      </p>
      <p className="text-[12px] text-muted-foreground">{scored} of {total} have ties to your network</p>
    </div>
  );
}
