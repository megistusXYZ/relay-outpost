/**
 * Which profile chips (Posts / Replies / Articles / Media) render DIMMED —
 * "there's nothing behind this door" said before the tap, so nobody goes on a
 * goose chase through empty tabs.
 *
 * The rule is this repo's three-outcomes discipline in UI form. A chip's
 * section is in one of three states: has content / CONFIRMED empty / we don't
 * know yet — and only the middle one may ever dim. Dimming while a fetch is
 * still out would hide delayed-loading content behind a "nothing here" claim
 * we never earned; the moment data arrives, the count rises and the chip
 * un-dims on its own (state flows from data, both directions).
 *
 * Dimmed is DE-EMPHASIS, never disabled and never removed: tabs that vanish
 * make the layout unpredictable, a disabled control reads as broken, and if
 * our count is ever wrong the tap still lands on an honest empty state — the
 * user loses nothing either way.
 */
export interface ChipEvidence {
  /** The fetch that would populate this section has ANSWERED (not merely started). */
  answered: boolean;
  count: number;
}

/** "all" never dims: it is the landing chip, and the whole-profile empty state
 *  is the stream's own job, not a grey label's. */
export function chipDimmed(key: string, evidence: ChipEvidence | undefined): boolean {
  if (key === "all") return false;
  if (!evidence) return false;
  return evidence.answered && evidence.count === 0;
}
