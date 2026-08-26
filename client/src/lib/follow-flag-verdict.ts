// Presumption-of-innocence verdict for a flagged follow.
//
// A flat "N trusted accounts flagged this" count treats every allegation the
// same and ignores the target's own earned standing. This module weighs the
// EVIDENCE (who reported, and how trusted THEY are) against the target's
// STANDING (the trust they earned in your network), tempered by the SEVERITY of
// the reason. It is pure — no IO, no React — so the reasoning is cheap to unit
// test and impossible to get subtly wrong in the UI.
//
// ── The reach-relative model (a ratio, not a fixed discount) ──────────────────
// The literal creators of Nostr / Damus, flagged for "illegal / impersonation"
// by a handful of trusted people, should not render as scary cards: 5 flags out
// of thousands of trusted followers is statistically nothing. A tier-based
// SHIELD encodes their earned reach, and the verdict is the FRACTION of the
// argument the flags win against that shield:
//
//   E    = avgReporterWeight × √count                 (evidence, UNCHANGED)
//   Seff = SHIELD[standingTier] × RESIST[severity]    (shield severity pierces)
//   R    = E / (E + Seff) ∈ [0, 1)                    (the flags' share of the argument)
//
// The level comes from R; `effectiveEvidence = E × R` and `mitigationApplied =
// Seff / (E + Seff)` (the shield's share) are the same ratio, re-expressed.
//
// Four principles, encoded and tested:
//   1. Standing MITIGATES, never IMMUNIZES. R never reaches 1 while a shield
//      stands, and never reaches 0 while there is evidence — every flagged
//      account still appears, and E>0 ⇒ effectiveEvidence>0.
//   2. A SEVERE allegation (impersonation, illegal, malware) pierces the shield
//      (RESIST < 1) and is never ranked "weak" — it always surfaces for review.
//   3. Reach shields the trusted. A handful of flaggers can't out-argue a strong
//      standing tier's shield, so top-standing accounts read reassuringly (lead
//      with trust) and collapse OUT of the prominent list (`suppressed`).
//   4. Escalation is automatic. As count → large, E dominates Seff, R → 1, and a
//      strong-standing target escalates back to "strong" on overwhelming evidence.

import { getSignalTier, type SignalTier } from "@/lib/graperank";

/** How damaging the reported reason is. `neutral` = no reason published. */
export type Severity = "severe" | "mild" | "neutral";

/** Three-level verdict, strongest first when sorted. */
export type VerdictLevel = "weak" | "worth-a-look" | "strong";

export interface VerdictReporter {
  pubkey: string;
  /** The reporter's OWN influence in your network (null = unknown). */
  influence: number | null;
}

export interface FlagVerdictInput {
  pubkey: string;
  /** The target's own influence/score — the trust they earned in YOUR network. */
  targetInfluence: number | null;
  /** Reporters with their influence, so a close reporter can count more. */
  reporters: VerdictReporter[];
  /** trusted_reporters count from the graph payload — the floor / fallback. */
  reporterCount: number;
  /** Severity from the kind-1984 report reason; `neutral` when none is published. */
  severity: Severity;
  /** Optional human label for the reason (e.g. "impersonation"), for the chip. */
  reasonLabel?: string;
}

export interface FlagVerdict {
  pubkey: string;
  level: VerdictLevel;
  /** Raw weighted reporter evidence E = avgWeight × √count (before the shield). */
  evidence: number;
  /** E × R — the evidence scaled by the fraction of the argument the flags win. */
  effectiveEvidence: number;
  /** The target's own standing tier. */
  standingTier: SignalTier;
  severity: Severity;
  reporterCount: number;
  /** The shield's share of the argument, Seff/(E+Seff) ∈ [0,1) — never reaches 1. */
  mitigationApplied: number;
  /**
   * True when the target is well-trusted (strong/moderate standing) and the
   * verdict was NOT escalated to "strong" — i.e. a trusted-but-flagged row that
   * should read reassuringly and sink below genuine strong signals.
   */
  reassuring: boolean;
  /**
   * True when the row should collapse OUT of the prominent list into the calm
   * "accounts you trust were also flagged" expander: a top-standing account that
   * did not escalate to strong (fiatjaf / jb55), or a mild reason on any
   * well-trusted account (spam on a trusted acct). Never immunizes — the row is
   * still present, just collapsed.
   */
  suppressed: boolean;
  /** Plain-language chip text. Leads with trust when `reassuring`. */
  summary: string;
}

// A closer, higher-trust reporter's flag is stronger evidence than a fringe one.
// getSignalTier never returns "flagged" (that's not an influence tier), but we
// map it to 0 defensively.
const REPORTER_WEIGHT: Record<SignalTier, number> = {
  strong: 4,
  moderate: 3,
  low: 2,
  weak: 1,
  none: 0.5,
  flagged: 0,
};

// The target's standing SHIELD — the resistance their earned reach lends against
// the flags, in the same units as evidence. It is tier-based (not raw influence)
// for robustness to custom thresholds: GrapeRank influence already encodes
// trust-weighted reach, so the tier IS the shield magnitude. A strong tier's 32
// out-argues a handful of √-damped flaggers; a weak tier barely resists.
const SHIELD: Record<SignalTier, number> = {
  strong: 32,
  moderate: 12,
  low: 4,
  weak: 1.5,
  none: 0,
  flagged: 0,
};

// Severity PIERCES the shield. A severe allegation cuts the shield to ~half
// (0.45); a mild one leaves it more than intact (1.2), so a mild reason needs
// overwhelming evidence to out-argue a trusted target. Applied as
// Seff = SHIELD[tier] × RESIST[severity].
const RESIST: Record<Severity, number> = {
  severe: 0.45,
  neutral: 0.8,
  mild: 1.2,
};

// Level cut-points on the ratio R = E / (E + Seff) — the fraction of the argument
// the flags win. No standing ⇒ Seff 0 ⇒ R 1 ⇒ strong; a strong shield pushes R
// down toward weak until overwhelming evidence drives it back up (principle 4).
const STRONG_R = 0.62;
const WORTH_A_LOOK_R = 0.34;

const LEVEL_RANK: Record<VerdictLevel, number> = {
  strong: 3,
  "worth-a-look": 2,
  weak: 1,
};

// NIP-56 report types → severity. The most severe type among a target's reports
// wins. Unknown / "other" is neutral (never assume the worst without a reason).
const SEVERE_TYPES = new Set(["illegal", "impersonation", "malware"]);
const MILD_TYPES = new Set(["spam", "profanity", "nudity"]);

/** Fold a set of NIP-56 report types into a single severity (most severe wins). */
export function severityFromReportTypes(types: Iterable<string>): Severity {
  let sawMild = false;
  for (const raw of types) {
    const t = (raw || "").toLowerCase().trim();
    if (SEVERE_TYPES.has(t)) return "severe";
    if (MILD_TYPES.has(t)) sawMild = true;
  }
  return sawMild ? "mild" : "neutral";
}

/**
 * Pull NIP-56 report types from a kind-1984 event's tags. Types live either on
 * the `p` tag (`["p", pubkey, type]`) or a dedicated `["report", type]` tag.
 */
export function reportTypesFromEvent(
  ev: { tags: string[][] },
  target: string,
): string[] {
  const types: string[] = [];
  for (const tag of ev.tags) {
    if (tag[0] === "p" && tag[1] === target) {
      // NIP-56 puts the type at index 2: ["p", pubkey, type]. But clients also
      // borrow the kind-1 reply shape — ["p", pubkey, relayHint, marker] — and
      // put it at 3, leaving 2 empty. THIS app's own ReportDialog did exactly
      // that, so every report it ever wrote was unreadable by this function and
      // collapsed to `neutral` severity; 27 of the 30 reports on our test relay
      // are that shape. Reading both slots costs nothing: a relay hint sitting
      // at index 2 simply matches no known type.
      if (tag[2]) types.push(tag[2]);
      if (tag[3]) types.push(tag[3]);
    } else if (tag[0] === "report" && tag[1]) types.push(tag[1]);
  }
  return types;
}

function levelLabel(level: VerdictLevel): string {
  switch (level) {
    case "strong": return "Strong signal";
    case "worth-a-look": return "Worth a look";
    case "weak": return "Weak signal";
  }
}

function standingPhrase(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "but strong standing in your network";
    case "moderate": return "but trusted in your network";
    case "low": return "with modest standing in your network";
    default: return "with little standing in your network";
  }
}

function reasonPhrase(severity: Severity, reasonLabel?: string): string {
  if (reasonLabel) return `flagged for ${reasonLabel}`;
  switch (severity) {
    case "severe": return "flagged for a serious reason";
    case "mild": return "flagged";
    case "neutral": return "flagged";
  }
}

// Every reporter here is drawn from the trusted set (the feature is literally
// "flagged by N people you trust"), so the phrasing always leads with trust.
function reporterPhrase(input: FlagVerdictInput): string {
  const n = Math.max(input.reporterCount, input.reporters.length);
  const noun = n === 1 ? "person" : "people";
  return `${n} ${noun} you trust`;
}

/** Compute the weighed verdict for a single flagged candidate. */
export function computeFlagVerdict(input: FlagVerdictInput): FlagVerdict {
  const { reporters, reporterCount, severity, targetInfluence } = input;

  // ── Evidence: average reporter weight × DIMINISHING-RETURNS count. ──
  // The average weight preserves reporter-tier weighting (a close, high-trust
  // reporter counts more than a fringe one). Multiplying by √count instead of
  // the raw count means a handful of flaggers no longer blows past the bar,
  // while a large pile still grows (sub-linearly) without limit.
  const count = Math.max(reporters.length, reporterCount);
  let avgWeight: number;
  if (reporters.length > 0) {
    const sum = reporters.reduce(
      (s, r) => s + REPORTER_WEIGHT[getSignalTier(r.influence)], 0);
    avgWeight = sum / reporters.length;
  } else {
    // Identities unresolved: a trusted_reporter is by definition trusted, so
    // treat each as moderate-weight evidence.
    avgWeight = REPORTER_WEIGHT.moderate;
  }
  // A trusted flag is always at least weak-weight evidence.
  avgWeight = Math.max(avgWeight, REPORTER_WEIGHT.weak);
  const evidence = count > 0 ? avgWeight * Math.sqrt(count) : 0;

  // ── Reach-relative shield: R = E / (E + Seff), the flags' share of the argument. ──
  // Seff is the standing tier's shield, cut by how far the severity pierces it.
  // No standing ⇒ Seff 0 ⇒ R 1 (the flags fully win); a strong shield pushes R
  // toward 0 until overwhelming evidence dominates it (principle 4). R never
  // reaches 1 while a shield stands, and never 0 while there is evidence.
  const standingTier = getSignalTier(targetInfluence);
  const seff = SHIELD[standingTier] * RESIST[severity];
  const denom = evidence + seff;
  const ratio = denom > 0 ? evidence / denom : 0;

  // Redefine the two verdict fields coherently on the ratio.
  const effectiveEvidence = evidence * ratio;      // = E² / (E + Seff)
  const mitigationApplied = denom > 0 ? seff / denom : 0; // shield's share; never 1

  // ── Level, straight from the ratio. ──
  let level: VerdictLevel =
    ratio >= STRONG_R ? "strong"
    : ratio >= WORTH_A_LOOK_R ? "worth-a-look"
    : "weak";

  // Never-immunize floor for SEVERE allegations: with any real evidence a
  // serious allegation is never buried as "weak", regardless of standing.
  if (severity === "severe" && evidence > 0 && level === "weak") {
    level = "worth-a-look";
  }

  // A well-trusted target that did NOT escalate to "strong" reads reassuringly
  // (leads with trust) and sinks below genuine strong signals when ranked.
  const wellTrusted = standingTier === "strong" || standingTier === "moderate";
  const reassuring = wellTrusted && level !== "strong";

  // Collapse OUT of the prominent list: a top-standing account that did not
  // escalate (fiatjaf / jb55), or a mild reason on any well-trusted account.
  const suppressed =
    (standingTier === "strong" && level !== "strong")
    || (wellTrusted && severity === "mild" && level !== "strong");

  const summary = reassuring
    ? `Trusted in your network — ${reasonPhrase(severity, input.reasonLabel)} by ${reporterPhrase(input)}`
    : `${levelLabel(level)} — ${reasonPhrase(severity, input.reasonLabel)} by ${reporterPhrase(input)}, ${standingPhrase(standingTier)}`;

  return {
    pubkey: input.pubkey,
    level,
    evidence,
    effectiveEvidence,
    standingTier,
    severity,
    reporterCount,
    mitigationApplied,
    reassuring,
    suppressed,
    summary,
  };
}

/** Compute + sort verdicts strong-first (the render order for the flagged card). */
export function rankFlagVerdicts(inputs: FlagVerdictInput[]): FlagVerdict[] {
  return inputs
    .map(computeFlagVerdict)
    .sort((a, b) =>
      LEVEL_RANK[b.level] - LEVEL_RANK[a.level]
      // Within a level, trusted-but-flagged rows sink below genuine ones, and
      // suppressed rows (collapsed into the "you trust these" expander) sink
      // below everything — kept deterministic even though the render partitions.
      || Number(a.reassuring) - Number(b.reassuring)
      || Number(a.suppressed) - Number(b.suppressed)
      || b.effectiveEvidence - a.effectiveEvidence
      || b.reporterCount - a.reporterCount
      || a.pubkey.localeCompare(b.pubkey));
}
