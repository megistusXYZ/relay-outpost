/**
 * The brand mark and wordmark (design canvas "Outpost rebrand", 2026-11-16):
 * Otto's open ring with the Ember dot, and "Outpost" in Geist 600, sentence
 * case. Static (eyes at rest); the landing's own Otto animates moods. Used on
 * the sign-in screen; the app's other wordmarks follow with the rename.
 */
export function OutpostWordmark({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-semibold tracking-[-0.02em] ${className}`} style={{ fontFamily: "var(--font-brand)" }} data-testid="outpost-wordmark">
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ overflow: "visible" }}>
        <path d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round" />
        <circle cx="71.2" cy="28.8" r="6.5" fill="hsl(var(--brand))" />
        <ellipse cx="42" cy="51" rx="3.6" ry="5.2" fill="currentColor" />
        <ellipse cx="58" cy="51" rx="3.6" ry="5.2" fill="currentColor" />
      </svg>
      <span>Outpost</span>
    </span>
  );
}
