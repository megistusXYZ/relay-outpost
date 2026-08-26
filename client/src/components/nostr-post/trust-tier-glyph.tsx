import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSignalTierLabel, type SignalTier } from "@/lib/graperank";

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the per-tier trust glyph.
//
// Every place that shows a trust tier as a small mark — the feed legend/filter,
// the per-post badge (TrustTierDot), hover badges, member lists, the Trust &
// Safety calibration list, relay-ops badges — renders through TrustTierGlyph so
// the legend and the badges can never drift apart again.
//
// WCAG 1.4.1 (use of colour): the six tiers are distinguishable by SHAPE / FILL,
// not hue alone —
//   • strong / moderate / low / weak → FILLED dot (green / blue / teal / amber)
//   • none (Unknown)                 → HOLLOW outline dot (transparent + grey ring)
//   • flagged                        → FLAG icon (the ONLY red in the system)
// So even in greyscale: filled dots vs the hollow ring vs the flag stay distinct,
// and amber-Low ≠ grey-Unknown ≠ red-Flagged.
// ─────────────────────────────────────────────────────────────────────────────

export type TierGlyphKind = "dot" | "hollow" | "flag";

/** Coarse colour identity of a tier's glyph — used by tests to lock the mapping. */
export type TierGlyphColorToken = "green" | "blue" | "teal" | "amber" | "gray" | "red";

export interface TierGlyphDescriptor {
  kind: TierGlyphKind;
  colorToken: TierGlyphColorToken;
  /** Tailwind classes: fill for `dot`, border for `hollow`, text colour for `flag`. */
  className: string;
}

export const TIER_GLYPH: Record<SignalTier, TierGlyphDescriptor> = {
  strong:   { kind: "dot",    colorToken: "green", className: "bg-emerald-500 dark:bg-emerald-400" },
  moderate: { kind: "dot",    colorToken: "blue",  className: "bg-blue-500 dark:bg-blue-400" },
  low:      { kind: "dot",    colorToken: "teal",  className: "bg-cyan-500 dark:bg-cyan-400" },
  weak:     { kind: "dot",    colorToken: "amber", className: "bg-amber-500 dark:bg-amber-400" },
  none:     { kind: "hollow", colorToken: "gray",  className: "border-gray-400/70 dark:border-gray-500/70" },
  flagged:  { kind: "flag",   colorToken: "red",   className: "text-red-500 dark:text-red-400" },
};

/**
 * Render the canonical glyph for a trust tier.
 *
 * @param size    sizing (and any decoration) classes, e.g. "w-2 h-2". Defaults to w-2 h-2.
 * @param title   accessible label; defaults to the tier's human label.
 * @param decorative  when true the glyph is aria-hidden (use when an adjacent text
 *                    label already names the tier, to avoid double announcement).
 */
export function TrustTierGlyph({
  tier,
  size = "w-2 h-2",
  className,
  title,
  decorative = false,
  "data-testid": dataTestId,
}: {
  tier: SignalTier;
  size?: string;
  className?: string;
  title?: string;
  decorative?: boolean;
  "data-testid"?: string;
}) {
  const g = TIER_GLYPH[tier];
  const label = title ?? getSignalTierLabel(tier);
  const role = decorative ? undefined : "img";
  const ariaLabel = decorative ? undefined : label;
  const ariaHidden = decorative ? true : undefined;

  if (g.kind === "flag") {
    return (
      <Flag
        className={cn(size, "shrink-0 fill-current", g.className, className)}
        data-testid={dataTestId}
        role={role}
        aria-label={ariaLabel}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (g.kind === "hollow") {
    return (
      <span
        className={cn(size, "inline-block rounded-full border-2 bg-transparent shrink-0", g.className, className)}
        title={label}
        data-testid={dataTestId}
        role={role}
        aria-label={ariaLabel}
        aria-hidden={ariaHidden}
      />
    );
  }

  return (
    <span
      className={cn(size, "inline-block rounded-full shrink-0", g.className, className)}
      title={label}
      data-testid={dataTestId}
      role={role}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
    />
  );
}
