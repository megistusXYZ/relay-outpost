/**
 * The landing's logo: one logo, three states (components/relay/RelayLogo).
 *
 *   icon   Relay's face
 *   relay  "Relay" written beside it
 *   full   "Relay Outpost", the face standing in as the O
 *
 * First visit in a session: Relay appears large in the middle, writes its
 * name, becomes the O, then glides into the header as the page fades in.
 * About three seconds; any tap, key, wheel or touch skips it.
 * After that the logo rests as the full name at the top of the page and folds
 * to the face once the page scrolls. A click replays the name; on a pointer
 * device, pointing at the folded face opens it and leaving closes it.
 *
 * Reduced motion, or Lite when the person chose it: no intro and no sequences;
 * the logo simply shows the state it should rest in.
 *
 * This file holds the timing only. The look is CSS (relay-logo.css for the
 * states, outpost-landing.css for where the logo sits and how it arrives).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { logoStorySeen, markLogoStorySeen } from "@/components/relay/logo-session";

export type LogoStage = "icon" | "relay" | "full";

/** The intro, in ms after the one before: the name is written, the face becomes the O, the logo lands. */
export const INTRO_STEPS = { relay: 750, full: 950, land: 1150 } as const;
/** After landing, how long the full name holds before the logo takes its resting state. */
const SETTLE_MS = 900;
/** A click: fold, write the name, become the O, then rest. */
const REPLAY_STEPS = { relay: 900, full: 950, rest: 1700 } as const;
/** How long after the pointer leaves before a hovered-open logo folds again. */
const HOVER_CLOSE_MS = 500;

function prefersStill(): boolean {
  try { return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
export interface LandingLogo {
  stage: LogoStage;
  /** The logo is large in the middle of the screen (the header's `is-intro`). */
  intro: boolean;
  /** The page waits behind the intro (the root's `is-pre`). */
  pre: boolean;
  /** The page is fading in as the logo lands (the root's `is-landing`), for about a second. */
  landing: boolean;
  onClick: () => void;
  onPointerEnter: (pointerType: string) => void;
  onPointerLeave: () => void;
}

/**
 * @param rest   the state the logo rests in right now (full at the top, icon once scrolled or where there is no room)
 * @param still  no motion wanted beyond reduced-motion (Lite, when chosen): no intro, no sequences
 */
export function useLandingLogo(rest: LogoStage, still: boolean): LandingLogo {
  // Decided before the first paint, so the page never flashes ahead of the intro.
  const [plays] = useState(() => typeof window !== "undefined" && !still && !prefersStill() && !logoStorySeen());
  const [stage, setStage] = useState<LogoStage>(plays ? "icon" : rest);
  const [intro, setIntro] = useState(plays);
  const [pre, setPre] = useState(plays);
  const [landing, setLanding] = useState(false);

  const restRef = useRef(rest);
  restRef.current = rest;
  const introRef = useRef(plays);
  // One sequence at a time: starting a new one drops the steps of the last.
  const token = useRef(0);
  const timers = useRef<number[]>([]);
  // True while a click's replay is telling the name: it is left to finish, whatever the page does meanwhile.
  const replaying = useRef(false);
  const run = useCallback((steps: [number, () => void][]) => {
    const mine = ++token.current;
    replaying.current = false;
    let at = 0;
    for (const [ms, fn] of steps) {
      at += ms;
      timers.current.push(window.setTimeout(() => { if (mine === token.current) fn(); }, at));
    }
  }, []);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  /** The logo goes to the header and the page comes in. `settleNow` (a skip) takes the resting state at once. */
  const land = useCallback((settleNow: boolean) => {
    introRef.current = false;
    setIntro(false);
    setPre(false);
    setLanding(true);
    // Its own timer, not a step: a scroll during the fade starts a new sequence and must not leave the page "landing".
    timers.current.push(window.setTimeout(() => setLanding(false), 1100));
    run([[settleNow ? 0 : SETTLE_MS, () => setStage(restRef.current)]]);
  }, [run]);

  // The intro, once.
  useEffect(() => {
    if (!plays) return;
    markLogoStorySeen();
    run([
      [INTRO_STEPS.relay, () => setStage("relay")],
      [INTRO_STEPS.full, () => setStage("full")],
      [INTRO_STEPS.land, () => land(false)],
    ]);
    const skip = () => { if (introRef.current) land(true); };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, skip, { passive: true }));
    return () => { events.forEach((e) => window.removeEventListener(e, skip)); };
  }, [plays, run, land]);

  // Where it rests changed (the page scrolled, or came back to the top): go there, unless the logo is
  // in the middle of telling its name (the intro, or a click's replay, which scrolls the page to the
  // top by itself). Both end in the resting state of that moment.
  useEffect(() => {
    if (introRef.current || replaying.current) return;
    run([[0, () => setStage(rest)]]);
  }, [rest, run]);

  const quiet = useCallback(() => still || prefersStill(), [still]);

  const onClick = useCallback(() => {
    if (introRef.current) return;
    if (quiet()) { setStage(restRef.current); return; }
    run([
      [0, () => setStage("icon")],
      [REPLAY_STEPS.relay, () => setStage("relay")],
      [REPLAY_STEPS.full, () => setStage("full")],
      [REPLAY_STEPS.rest, () => { replaying.current = false; setStage(restRef.current); }],
    ]);
    replaying.current = true;
  }, [run, quiet]);

  const stageRef = useRef(stage);
  stageRef.current = stage;
  const onPointerEnter = useCallback((pointerType: string) => {
    if (pointerType !== "mouse" || introRef.current || stageRef.current !== "icon") return;
    run([[0, () => setStage("full")]]);
  }, [run]);
  const onPointerLeave = useCallback(() => {
    if (introRef.current || replaying.current) return;
    run([[HOVER_CLOSE_MS, () => setStage(restRef.current)]]);
  }, [run]);

  return { stage, intro, pre, landing, onClick, onPointerEnter, onPointerLeave };
}

/** True where the header has no room for the full name beside its buttons (a 320px phone). */
export function useNoRoomForName(): boolean {
  const query = "(max-width: 359px)";
  const [narrow, setNarrow] = useState(() => { try { return !!window.matchMedia && window.matchMedia(query).matches; } catch { return false; } });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(query); } catch { return; }
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
