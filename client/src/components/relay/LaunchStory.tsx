import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { choseLite } from "@/hooks/use-perf-mode";
import { RelayLogo, type RelayState } from "./RelayLogo";
import { logoStorySeen, markLogoStorySeen } from "./logo-session";
import { whenLaunchScreenLetsGo } from "./launch-screen";
import "./launch-story.css";

/**
 * The app's launch story: once per session, as the app opens, Relay tells its
 * name in the middle of the screen (the face, "Relay", "Relay Outpost", the
 * face again) and lands on the app's own logo, the top bar on a phone or the
 * rail on a desktop.
 *
 * It takes over from the loading screen (index.html's #ro-splash), whose face
 * sits in the same spot at the same size, and starts when that screen lets go.
 * The app is mounted and working underneath the whole time; this is a layer
 * over it, never a gate in front of it.
 *
 * No story when: this session has already seen the logo tell its name (here or
 * on the landing), reduced motion is on, Lite was chosen, or the app was
 * already on screen when this mounted (signing in mid-session, say).
 * Any tap, key or scroll skips it. A tap that skips it is spent on that and
 * goes no further, so nothing hidden underneath is pressed by accident.
 */

/** The story, each in ms after the one before: the name is written, the face becomes the O, it folds, it lands. */
export const LAUNCH_STEPS = { relay: 750, full: 950, fold: 1150, land: 700 } as const;
/** The glide to the app's logo, the moment it then rests on it before it is taken away, and the quick fade of a skip. Must match launch-story.css. */
const GLIDE_MS = 700;
const REST_MS = 140;
const SKIP_MS = 220;
/** Where the app's own logo is: the phone's top bar, the desktop rail, or the classic sidebar. */
const APP_LOGO = '[data-testid="button-mobile-sidebar-trigger"] [data-testid="otto-mark"], [data-testid="rail-logo"] [data-testid="otto-mark"], [data-sidebar="header"] [data-testid="otto-mark"]';

function shouldPlay(): boolean {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    if (!document.getElementById("ro-splash")) return false; // the app is already on screen: nothing to take over from
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if (choseLite()) return false;
    return !logoStorySeen();
  } catch {
    return false;
  }
}

type Phase = "story" | "landing" | "skipping" | "done";

export function LaunchStory() {
  const [plays] = useState(shouldPlay);
  const [phase, setPhase] = useState<Phase>(plays ? "story" : "done");
  const [stage, setStage] = useState<RelayState>("icon");
  const [flight, setFlight] = useState<CSSProperties | undefined>(undefined);
  const logoRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<Phase>(plays ? "story" : "done");
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  const go = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);

  /** Glide onto the app's own logo while this layer clears; with no logo to land on, simply clear. */
  const land = useCallback(() => {
    if (phaseRef.current !== "story") return;
    const mark = logoRef.current?.querySelector<HTMLElement>(".rl-m");
    const target = [...document.querySelectorAll<HTMLElement>(APP_LOGO)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const box = logoRef.current;
    if (box && mark && target) {
      // From the logo's resting box and the mark's laid-out width: neither moves with the face's own motion.
      const from = box.getBoundingClientRect(), to = target.getBoundingClientRect();
      const k = to.width / (mark.offsetWidth || 1);
      const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
      setFlight({ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${k.toFixed(4)})` });
    }
    go("landing");
    later(() => go("done"), GLIDE_MS + REST_MS);
  }, [go, later]);

  const skip = useCallback(() => {
    if (phaseRef.current !== "story") return;
    timers.current.forEach((t) => window.clearTimeout(t));
    go("skipping");
    later(() => go("done"), SKIP_MS);
  }, [go, later]);

  useEffect(() => {
    if (!plays) return;
    markLogoStorySeen();
    let begun = false;
    const begin = () => {
      if (begun) return;
      begun = true;
      later(() => setStage("relay"), LAUNCH_STEPS.relay);
      later(() => setStage("full"), LAUNCH_STEPS.relay + LAUNCH_STEPS.full);
      later(() => setStage("icon"), LAUNCH_STEPS.relay + LAUNCH_STEPS.full + LAUNCH_STEPS.fold);
      later(land, LAUNCH_STEPS.relay + LAUNCH_STEPS.full + LAUNCH_STEPS.fold + LAUNCH_STEPS.land);
    };
    // The story begins when the loading screen lets go (components/relay/launch-screen.ts). A loading
    // screen that never lets go has its own Reload; this layer must not outlast it forever.
    const stopWaiting = whenLaunchScreenLetsGo(begin);
    // A key or a turn of the wheel skips it, as a tap does (the layer's own onPointerDown).
    const onSkip = () => skip();
    window.addEventListener("keydown", onSkip, { passive: true });
    window.addEventListener("wheel", onSkip, { passive: true });
    const pending = timers.current;
    return () => { stopWaiting(); window.removeEventListener("keydown", onSkip); window.removeEventListener("wheel", onSkip); pending.forEach((t) => window.clearTimeout(t)); };
  }, [plays, land, skip, later]);

  if (phase === "done" || typeof document === "undefined") return null;
  return createPortal(
    <div className="launch-story" data-phase={phase} data-testid="launch-story" aria-hidden="true" onPointerDown={skip}>
      <span ref={logoRef} className="launch-story-logo" style={flight}>
        <RelayLogo state={stage} size={36} label="" />
      </span>
    </div>,
    document.body,
  );
}
