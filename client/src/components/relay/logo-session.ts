/**
 * One telling of the logo's name per session, wherever it happens: the landing's
 * intro (components/landing/landing-logo.ts) or the app's launch story
 * (./LaunchStory.tsx). Whichever plays first marks the session, so someone who
 * watched it on the landing and then signs in is not shown it again.
 *
 * sessionStorage can be missing or can throw (private windows, blocked storage):
 * then nothing is remembered and the story may play again, which is harmless.
 */
const SEEN_KEY = "relay-outpost-logo-intro";

export function logoStorySeen(): boolean {
  try { return window.sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}

export function markLogoStorySeen(): void {
  try { window.sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* nothing to remember it with */ }
}
