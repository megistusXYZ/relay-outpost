/**
 * One way to say "live", in three sizes (2026-11-17).
 *
 * The old badges were "LIVE" in 7–10px capitals on a glowing red pill, drawn
 * a dozen different ways. The brand floor is 12px, sentence case, no glows,
 * and status as a word. Live stays red: it is the colour people already read
 * as "on air", and it is used for nothing else.
 *
 * - LiveTag: over a picture or video, where a bare word can't be read. A
 *   12px "Live" pill, white on solid red.
 * - LiveAvatarDot: on an avatar, where there is no room for 12px text. A red
 *   dot at the corner, labelled for screen readers; put a LiveWord beside the
 *   name wherever the row has one.
 * - LiveWord: in a line of text. "Live" as a red word with its dot.
 *
 * Only the dot pulses (`.live-dot`), and only for people who allow motion.
 */
const dot = "rounded-full live-dot";

export function LiveTag({ label = "Live", className = "", testId }: { label?: string; className?: string; testId?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-red-600 text-white text-[12px] font-semibold leading-none shrink-0 ${className}`}
      data-testid={testId}
    >
      <span className={`w-1.5 h-1.5 bg-white ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function LiveAvatarDot({ className = "", testId }: { className?: string; testId?: string }) {
  return (
    <span
      role="img"
      aria-label="Live"
      title="Live"
      className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-red-600 border-2 border-background ${dot} ${className}`}
      data-testid={testId}
    />
  );
}

export function LiveWord({ label = "Live", className = "", testId }: { label?: string; className?: string; testId?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold text-danger shrink-0 ${className}`} data-testid={testId}>
      <span className={`w-1.5 h-1.5 bg-red-600 ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
