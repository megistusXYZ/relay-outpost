/**
 * The character is called RELAY (owner, 2026-11-18; it was "Otto" until then).
 * Everything a person can see or hear says Relay; the vocabulary guard retires
 * "Otto" on screens. The component, file and class names keep "Otto": in this
 * codebase "RelayMark" would read as the mark of a relay (the servers), which
 * is a different thing.
 */
/**
 * Otto, the mark with character (owner, 2026-11-16): the open ring is the
 * head, the Ember dot sits at its opening, and the eyes say what the app is
 * doing. The landing's Otto animates its own copy; this one is for the app's
 * chrome (the rail logo, the compose button) and reads the app's state:
 *
 *   rest   nothing has happened for a minute, or the tab is hidden: eyes shut
 *   work   the app is fetching (react-query, after a short grace): eyes up,
 *          the dot pulses
 *   done   a fetch just finished, or the pointer is over the mark: a smile
 *   ask    something waits for the person (`attention`): round eyes, a ring
 *   here   otherwise: a calm face that blinks, glances about now and then on
 *          a phone, follows the mouse on a desktop, and smiles when tapped
 *
 * Relay moves only for a reason (owner, 2026-11-18). A mark with a `role`
 * also reads the real signals in lib/mark-signals, and problems come first:
 *
 *   role="logo"  the app's logo (rail, classic sidebar, phone header):
 *     worry  the connection is lost (the browser is offline, or the relays
 *            dropped and will not connect again)
 *     ask    a call is ringing, or something new just arrived (with one
 *            short look up, `data-react="perk"`)
 *     and one blink when you come back (`data-react="wake"`)
 *   role="post"  the New-post button, which speaks only about your post:
 *     wait   the post is waiting out its Undo time (the dot is hollow)
 *     work   it is on its way
 *     done   a relay took it; never before
 *     worry  no relay took it
 *
 * Reactions play once and last well under a second; nothing loops. Reduced
 * motion: the faces still change and nothing moves. Lite, when the person
 * chose it: no pointer-follow and no idle glances.
 * Styles: otto-mark.css, scoped to .otto-mark.
 *
 * The face is on by default (owner, 2026-11-16: the animated faces in the
 * chrome's icons are the point, as on the landing). `face={false}` leaves the
 * mark, ring and dot, where a screen wants that.
 */
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { isBusy, subscribeBusy } from "@/lib/otto-busy";
import { useChoseLite } from "@/hooks/use-perf-mode";
import { logoMood, postMood, getConnectionLost, subscribeConnectionLost, getCallRinging, subscribeCallRinging, getPostStatus, subscribePostStatus } from "@/lib/mark-signals";
import "./otto-mark.css";

export type OttoMood = "cycle" | "here" | "work" | "done" | "ask" | "rest" | "worry" | "wait";
/** A passing reaction, played once: a glance toward the tabs when something arrives, a blink on coming back. */
export type OttoReact = "perk" | "wake" | null;
/** Where the mark sits: the logo reacts to the app; the New-post button speaks only about your post. */
export type OttoRole = "logo" | "post";

const INK = "currentColor";
const IDLE_MS = 180_000;
const WORK_GRACE_MS = 600;
const DONE_MS = 1_400;
/** An arrival holds the face this long; a passing reaction lasts this long; counts that load as the app opens are not arrivals. */
const ARRIVED_MS = 1500, REACT_MS = 600, ARRIVAL_GRACE_MS = 6000;

function reducedMotion(): boolean {
  try { return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

// ——— One idle clock for every mark on the page ———
let awake = true;
let idleTimer: number | undefined;
const idleSubs = new Set<() => void>();
const notifyIdle = () => idleSubs.forEach((fn) => fn());
function armIdle() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => { awake = false; notifyIdle(); }, IDLE_MS);
}
function onActivity() {
  // A hidden tab stays asleep whatever scrolls inside it, so coming back is
  // one clear moment (and gets its blink).
  if (document.hidden) return;
  if (!awake) { awake = true; notifyIdle(); }
  armIdle();
}
function onVisibility() {
  if (document.hidden) { awake = false; window.clearTimeout(idleTimer); notifyIdle(); }
  else onActivity();
}
let idleListening = false;
function subscribeIdle(fn: () => void) {
  idleSubs.add(fn);
  if (!idleListening) {
    idleListening = true;
    (["pointermove", "pointerdown", "keydown", "touchstart", "scroll"] as const).forEach((n) => window.addEventListener(n, onActivity, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVisibility);
    armIdle();
  }
  return () => { idleSubs.delete(fn); };
}
const getAwake = () => awake;

// ——— One pointer listener: every mark's eyes look toward the mouse ———
const looking = new Set<SVGSVGElement>();
let lookListening = false;
let lookRaf = 0;
let lastPointer: { x: number; y: number } | null = null;
function applyLook() {
  lookRaf = 0;
  if (!lastPointer) return;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  for (const el of looking) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    el.style.setProperty("--ex", (clamp((lastPointer.x - cx) / 320) * 7).toFixed(2));
    el.style.setProperty("--ey", (clamp((lastPointer.y - cy) / 320) * 6).toFixed(2));
  }
}
function onPointer(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  lastPointer = { x: e.clientX, y: e.clientY };
  if (!lookRaf) lookRaf = requestAnimationFrame(applyLook);
}
function subscribeLook(el: SVGSVGElement) {
  looking.add(el);
  if (!lookListening) { lookListening = true; window.addEventListener("pointermove", onPointer, { passive: true }); }
  return () => { looking.delete(el); };
}

/** The mood the app's state asks for; `cycle` when nothing is going on. */
export function useOttoMood({ attention = false, hover = false, role, waiting = 0 }: { attention?: boolean; hover?: boolean; role?: OttoRole; /** How many things wait for the person; a rise is an arrival. */ waiting?: number }): { mood: OttoMood; react: OttoReact } {
  const isAwake = useSyncExternalStore(subscribeIdle, getAwake, () => true);
  // The query client, when there is one: a mark rendered outside the app
  // (a test, a static page) just never works.
  const client = useContext(QueryClientContext);
  const querying = useSyncExternalStore(
    (cb) => (client ? client.getQueryCache().subscribe(cb) : () => {}),
    () => (client ? client.isFetching() > 0 : false),
    () => false,
  );
  // A loader on screen (lib/otto-busy) counts too: relay reads bypass react-query.
  const loading = useSyncExternalStore(subscribeBusy, isBusy, () => false);
  const fetching = querying || loading;
  const [working, setWorking] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const wasWorking = useRef(false);
  // The real signals (lib/mark-signals): the connection, a ringing call, your post.
  const lost = useSyncExternalStore(subscribeConnectionLost, getConnectionLost, () => false);
  const ringing = useSyncExternalStore(subscribeCallRinging, getCallRinging, () => false);
  const postStatus = useSyncExternalStore(subscribePostStatus, getPostStatus, () => "idle" as const);

  // A fetch has to last a moment before it is "work": the app fetches constantly.
  useEffect(() => {
    if (fetching) {
      const t = window.setTimeout(() => setWorking(true), WORK_GRACE_MS);
      return () => window.clearTimeout(t);
    }
    setWorking(false);
    return undefined;
  }, [fetching]);

  // Work that ends gets a smile.
  useEffect(() => {
    if (working) { wasWorking.current = true; return undefined; }
    if (!wasWorking.current) return undefined;
    wasWorking.current = false;
    setJustDone(true);
    const t = window.setTimeout(() => setJustDone(false), DONE_MS);
    return () => window.clearTimeout(t);
  }, [working]);

  // Something new arrived: the count of things waiting went up. Not the first
  // counts after the app opens: those were already there.
  const [arrived, setArrived] = useState(false);
  const [react, setReact] = useState<OttoReact>(null);
  const seen = useRef(waiting);
  const mountedAt = useRef(Date.now());
  const arrivedTimer = useRef(0), reactTimer = useRef(0);
  const once = (kind: Exclude<OttoReact, null>) => {
    setReact(kind);
    window.clearTimeout(reactTimer.current);
    reactTimer.current = window.setTimeout(() => setReact(null), REACT_MS);
  };
  useEffect(() => {
    if (role === "logo" && waiting > seen.current && Date.now() - mountedAt.current > ARRIVAL_GRACE_MS) {
      setArrived(true);
      once("perk");
      window.clearTimeout(arrivedTimer.current);
      arrivedTimer.current = window.setTimeout(() => setArrived(false), ARRIVED_MS);
    }
    seen.current = waiting;
  }, [waiting, role]);
  // You came back: a blink.
  const wasAwake = useRef(isAwake);
  useEffect(() => {
    if (role === "logo" && isAwake && !wasAwake.current) once("wake");
    wasAwake.current = isAwake;
  }, [isAwake, role]);
  useEffect(() => () => { window.clearTimeout(arrivedTimer.current); window.clearTimeout(reactTimer.current); }, []);

  if (role === "post") return { mood: postMood({ awake: isAwake, status: postStatus, hover }), react: null };
  const logo = role === "logo";
  return { mood: logoMood({ awake: isAwake, lost: logo && lost, ringing: logo && ringing, arrived: logo && arrived, attention, working, justDone, hover }), react };
}

export function OttoMark({
  size = 24,
  className = "",
  attention = false,
  mood: forced,
  label,
  face = true,
  role,
  waiting = 0,
}: {
  /** The logo reacts to the app (connection, a call, arrivals); the New-post button speaks only about your post. */
  role?: OttoRole;
  /** How many things wait for the person. When it rises, the logo perks up. */
  waiting?: number;
  size?: number;
  className?: string;
  /** Show the eyes. Off, it is the mark: ring and dot. */
  face?: boolean;
  /** Something waits for the person (unread, a request): Otto asks. */
  attention?: boolean;
  /** Pin a mood (tests, static uses); otherwise the app's state decides. */
  mood?: OttoMood;
  label?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const { mood, react } = useOttoMood({ attention, hover: hover || pressed, role, waiting });
  const shown: OttoMood = forced ?? mood;
  const quiet = useChoseLite();
  // A tap gets a smile: the button it sits in acts, Otto acknowledges.
  const onPress = () => { setPressed(true); window.setTimeout(() => setPressed(false), 700); };

  useEffect(() => {
    const el = ref.current;
    // Lite, when the person chose it: faces and short reactions stay, but the
    // eyes don't follow the pointer and there are no idle glances (otto-mark.css).
    if (!el || !face || quiet || reducedMotion()) return;
    return subscribeLook(el);
  }, [face, quiet]);

  return (
    <svg
      ref={ref}
      className={`otto-mark ${className}`}
      data-mood={shown}
      data-react={react || undefined}
      data-role={role}
      data-quiet={quiet || undefined}
      data-testid="otto-mark"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(true); }}
      onPointerLeave={() => setHover(false)}
      onPointerDown={onPress}
    >
      <path d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" fill="none" stroke={INK} strokeWidth={9} strokeLinecap="round" />
      <circle className="m m-ask" cx="71.2" cy="28.8" r="12" fill="none" stroke="hsl(var(--brand))" strokeWidth={2} strokeOpacity={0.45} />
      <circle className="dot" cx="71.2" cy="28.8" r="6.5" fill="hsl(var(--brand))" />
      {face && (
        <g className="look">
          <g className="m m-here blink"><ellipse cx="42" cy="51" rx="3.6" ry="5.2" fill={INK} /><ellipse cx="58" cy="51" rx="3.6" ry="5.2" fill={INK} /></g>
          <g className="m m-work"><ellipse cx="47" cy="45" rx="3.4" ry="4.8" fill={INK} /><ellipse cx="61" cy="45" rx="3.4" ry="4.8" fill={INK} /></g>
          <path className="m m-done" d="M37 53.5q5-8 10 0M53 53.5q5-8 10 0" fill="none" stroke={INK} strokeWidth={4.2} strokeLinecap="round" />
          <g className="m m-ask"><circle cx="42" cy="50" r="5" fill={INK} /><circle cx="58" cy="50" r="5" fill={INK} /></g>
          <path className="m m-rest" d="M37 51.5h10M53 51.5h10" fill="none" stroke={INK} strokeWidth={4.2} strokeLinecap="round" />
          {/* Concern: the eyes slant, inner ends high. For a lost connection, or a post no relay accepted. */}
          <path className="m m-worry" d="M37 54l9.5-4.5M63 54l-9.5-4.5" fill="none" stroke={INK} strokeWidth={4.2} strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
