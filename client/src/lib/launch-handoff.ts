/**
 * When the launch screen (client/index.html) may lift.
 *
 * It used to lift the moment the app's shell had painted. On a slow phone the
 * page itself was still downloading, so a stranger watched the launch screen
 * give way to an empty page with a small spinner for a second and a half
 * (measured 2026-10-03, production, throttled 4G: lift at 2.4 s, page at 3.9 s).
 *
 * Now a route-level loader (App's LazyFallback) says it is showing; while one
 * is, the launch screen stays. It lifts when the last one goes, or at a cap,
 * so a page that never arrives still ends in the app's own loader or error
 * screen rather than a launch screen that never moves. It lifts once.
 *
 * Pure: the clock, timers and the hide itself are handed in.
 */
export interface LaunchHandoff {
  /** The app's shell has painted (main.tsx). */
  appReady(): void;
  /** A route-level loader is showing; call the returned function when it goes. */
  loaderShown(): () => void;
}

export function createLaunchHandoff(opts: {
  hide: () => void;
  /** The longest the launch screen waits for a page, from appReady. */
  capMs: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => void;
}): LaunchHandoff {
  const setTimer = opts.setTimer ?? ((fn, ms) => { setTimeout(fn, ms); });
  let loaders = 0;
  let ready = false;
  let done = false;
  const lift = () => {
    if (done) return;
    done = true;
    opts.hide();
  };
  const maybeLift = () => { if (ready && loaders === 0) lift(); };
  return {
    appReady() {
      if (ready || done) return;
      ready = true;
      setTimer(lift, opts.capMs);
      maybeLift();
    },
    loaderShown() {
      loaders++;
      let off = false;
      return () => {
        if (off) return;
        off = true;
        loaders--;
        maybeLift();
      };
    },
  };
}

/** The handoff the app uses; main.tsx gives it the real hide. */
let current: LaunchHandoff | null = null;

export function installLaunchHandoff(h: LaunchHandoff): void {
  current = h;
}

/**
 * For LazyFallback: say a route loader is showing. Safe before install (the
 * handoff is installed before the first render in practice; if not, the
 * loader simply doesn't hold the launch screen).
 */
export function routeLoaderShown(): () => void {
  if (!current) return () => {};
  return current.loaderShown();
}
