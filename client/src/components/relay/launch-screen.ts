/**
 * The launch screen (client/index.html's #ro-splash), as the logo that takes
 * over from it needs to know it: where its face is, and when it lets go.
 *
 * Whatever comes next (the app's launch story, the landing's logo) starts as
 * the same face in the same place at the same size, so the hand-over is one
 * face throughout and never two.
 */
const LAUNCH_SCREEN = "ro-splash";

function launchScreen(): HTMLElement | null {
  try { return typeof document === "undefined" ? null : document.getElementById(LAUNCH_SCREEN); } catch { return null; }
}

/** True while the launch screen is still up and has not started to go. */
export function launchScreenIsUp(): boolean {
  const el = launchScreen();
  return !!el && el.isConnected && el.dataset.hiding !== "1";
}

/** Where the launch screen's face is, in viewport pixels, while the launch screen is in the page. */
export function launchScreenFace(): { cx: number; cy: number; width: number } | null {
  const mark = launchScreen()?.querySelector(".ro-splash-mark");
  if (!mark) return null;
  const r = mark.getBoundingClientRect();
  if (r.width < 1) return null;
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width };
}

/**
 * Calls `then` once, when the launch screen lets go: it marks itself as hiding,
 * then removes itself. At once if there is no launch screen. `capMs` is the
 * longest to wait: a launch screen that never lets go has its own Reload, and
 * nothing that follows it should wait forever. Returns a function that stops
 * waiting.
 */
export function whenLaunchScreenLetsGo(then: () => void, capMs = 10_000): () => void {
  let done = false;
  let watch: MutationObserver | undefined;
  let cap: number | undefined;
  const stop = () => { watch?.disconnect(); if (cap !== undefined) window.clearTimeout(cap); };
  const fire = () => { if (done) return; done = true; stop(); then(); };
  if (!launchScreenIsUp() || typeof MutationObserver !== "function") { fire(); return stop; }
  const el = launchScreen()!;
  watch = new MutationObserver(() => { if (!launchScreenIsUp()) fire(); });
  watch.observe(el, { attributes: true });
  if (el.parentNode) watch.observe(el.parentNode, { childList: true });
  cap = window.setTimeout(fire, capMs);
  return () => { done = true; stop(); };
}
