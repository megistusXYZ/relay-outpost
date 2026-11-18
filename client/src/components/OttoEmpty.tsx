/**
 * The empty-state illustration (owner, 2026-11-16): Otto on a quiet ground,
 * with a mood that says what kind of empty this is.
 *
 *   quiet    nothing here yet (eyes at rest): a fresh list, a new account
 *   looking  nothing found, or still asking (round eyes, the ring): a search
 *            with no match, a relay that hasn't answered
 *   glad     all caught up (a smile): an inbox you have read
 *
 * Drawn with OttoMark pinned to that mood, so the face is the same one the
 * chrome wears. Colour follows `currentColor`; size by the box.
 */
import { cn } from "@/lib/utils";
import { OttoMark, type OttoMood } from "@/components/OttoMark";

export type OttoEmptyMood = "quiet" | "looking" | "glad";

const MOOD: Record<OttoEmptyMood, OttoMood> = { quiet: "rest", looking: "ask", glad: "done" };

export function OttoEmpty({ mood = "quiet", className, size = 96, face = true }: { mood?: OttoEmptyMood; className?: string; size?: number; /** false where another Otto already speaks on the screen */ face?: boolean }) {
  const otto = Math.round(size * 0.5);
  return (
    <div
      className={cn("relative inline-flex items-center justify-center shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-testid="otto-empty"
      data-mood={mood}
    >
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full" fill="none">
        {/* the ground: a soft disc, a faint ring, and three stones */}
        <circle cx="60" cy="60" r="44" fill="currentColor" opacity="0.06" />
        <circle cx="60" cy="60" r="54" stroke="currentColor" strokeOpacity="0.12" strokeDasharray="2 7" strokeLinecap="round" />
        <ellipse cx="60" cy="96" rx="26" ry="3.5" fill="currentColor" opacity="0.1" />
        <circle cx="24" cy="78" r="2.2" fill="currentColor" opacity="0.28" />
        <circle cx="98" cy="70" r="1.7" fill="currentColor" opacity="0.22" />
        <circle cx="88" cy="30" r="1.5" fill="currentColor" opacity="0.18" />
      </svg>
      <OttoMark size={otto} mood={MOOD[mood]} face={face} className="relative" />
    </div>
  );
}
