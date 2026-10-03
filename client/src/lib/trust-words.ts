/**
 * Trust, said as a fact about the reader's network — not a grade on a person.
 *
 * Owner (2026-10-03): "Highly Trusted 100%" on a stranger's card read as a
 * verdict on them. The score is really a distance from the reader, so the
 * words say that: whose network, what tie. No number anywhere on a card; the
 * percentage stays in the profile's trust panel for people who want it.
 *
 * Pure: cards and headings read it; nothing here touches scores.
 */
import type { SignalTier } from "./graperank";

export function getTrustPhrase(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "Trusted by your network";
    case "moderate": return "Known to your network";
    case "low": return "New to your network";
    case "weak": return "Few ties to your network";
    case "flagged": return "Your network has concerns";
    default: return "";
  }
}

/** The small glyph beside a name: present only where it means something. */
export function getTrustMark(tier: SignalTier): "filled" | "outline" | "warning" | null {
  switch (tier) {
    case "strong": return "filled";
    case "moderate": return "outline";
    case "flagged": return "warning";
    default: return null;
  }
}
