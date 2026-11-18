/**
 * The real things Relay's face reacts to, and the rule for which face wins.
 *
 * The mark moves only for a reason. Each signal here is a fact the app
 * already has, reported by the code that owns it; nothing is guessed:
 *   - the post you just made: waiting out its Undo time, sending, really
 *     sent, or not accepted by any relay (set by the composer);
 *   - a call ringing (set by the call ringer while its card is up);
 *   - the connection lost: the browser says it is offline, or the relays the
 *     app was connected to have dropped and will not connect again.
 *
 * When several things are true at once, problems come first: connection lost,
 * then a ringing call, then something that just arrived, then loading, then
 * the finished smile, then idle.
 */
type Listener = () => void;
function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<Listener>();
  return {
    get: () => value,
    set: (next: T) => { if (next === value) return; value = next; subs.forEach((f) => f()); },
    subscribe: (f: Listener) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

export type MarkMood = "here" | "work" | "done" | "ask" | "rest" | "worry" | "wait";

// ---- your post ---------------------------------------------------------------
export type PostStatus = "idle" | "waiting" | "sending" | "sent" | "failed";
const post = store<PostStatus>("idle");
let postTimer: ReturnType<typeof setTimeout> | undefined;
/** The smile passes after a moment; the concern stays until a retry, or lets go after a while. */
const SENT_MS = 1500, FAILED_MS = 15000;
export function setPostStatus(next: PostStatus): void {
  if (postTimer) clearTimeout(postTimer);
  postTimer = undefined;
  post.set(next);
  if (next === "sent") postTimer = setTimeout(() => post.set("idle"), SENT_MS);
  if (next === "failed") postTimer = setTimeout(() => post.set("idle"), FAILED_MS);
}
export const getPostStatus = post.get;
export const subscribePostStatus = post.subscribe;

// One post speaks at a time: the newest. An older send that finishes late, or
// an Undo left over from an older post, says nothing over a newer one.
let postRun = 0;
/**
 * Follow one real send. Thinking while it is out; the smile comes only when a
 * relay took it (the promise resolves true); concern when none did, or when
 * the send threw. Hands the same promise back, so it wraps a call in place.
 */
export function followSend<P extends Promise<unknown>>(sending: P): P {
  const run = ++postRun;
  setPostStatus("sending");
  const settle = (ok: boolean) => { if (run === postRun) setPostStatus(ok ? "sent" : "failed"); };
  sending.then((took) => settle(!!took), () => settle(false));
  return sending;
}
/** The post is waiting out its Undo time: nothing has left yet. Returns what Undo calls. */
export function holdSend(): () => void {
  const run = ++postRun;
  setPostStatus("waiting");
  return () => { if (run === postRun) setPostStatus("idle"); };
}

// ---- a call ringing ----------------------------------------------------------
const ringing = store(false);
export const setCallRinging = (on: boolean) => ringing.set(on);
export const getCallRinging = ringing.get;
export const subscribeCallRinging = ringing.subscribe;

// ---- the connection ----------------------------------------------------------
const lost = store(false);
export const getConnectionLost = lost.get;
export const subscribeConnectionLost = lost.subscribe;
const reportConnection = { browserOffline: false, relaysDown: false };
const recompute = () => lost.set(reportConnection.browserOffline || reportConnection.relaysDown);

let watching = false;
/** How many of the relays that were connected get asked again, and how often while the answer is still no. */
const REACH_SAMPLE = 4, ASK_AGAIN_EVERY = 3;
export interface WatchConnection {
  /** Each relay connection's state right now (the pool's own list). */
  statuses: () => Map<string, boolean>;
  /** Try to connect to these relays; true when any of them would (lib/relay-reach). */
  canReachAny: (urls: string[]) => Promise<boolean>;
  everyMs?: number;
  /** Where the browser's "offline" and "online" arrive, and whether it starts offline. */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  startsOffline?: boolean;
}
/**
 * Start watching the connection (once, from the app shell). Lost is a
 * positive claim, made in two cases only:
 *   - the browser says it is offline; or
 *   - relays the app WAS connected to have all dropped, stayed down for two
 *     checks, and would not connect when asked again.
 * No connections is not a loss on its own: a quiet start has none, and the
 * app closes relays it has finished with. Those still answer when asked, so
 * they are asked once and left alone.
 */
export function watchConnection({
  statuses, canReachAny, everyMs = 5000,
  target = typeof window !== "undefined" ? window : undefined,
  startsOffline = typeof navigator !== "undefined" && navigator.onLine === false,
}: WatchConnection): () => void {
  if (watching || !target) return () => {};
  watching = true;
  const offline = () => { reportConnection.browserOffline = true; recompute(); };
  const online = () => { reportConnection.browserOffline = false; recompute(); };
  reportConnection.browserOffline = startsOffline;
  recompute();
  target.addEventListener("offline", offline);
  target.addEventListener("online", online);
  let lastUp: string[] = [], quiet = 0, asked = false, asking = false, stopped = false;
  const timer = setInterval(() => {
    let up: string[];
    try { up = [...statuses()].filter(([, connected]) => connected).map(([url]) => url); } catch { return; }
    if (up.length) {
      lastUp = up.slice(0, REACH_SAMPLE); quiet = 0; asked = false;
      if (reportConnection.relaysDown) { reportConnection.relaysDown = false; recompute(); }
      return;
    }
    if (!lastUp.length) return; // never connected: a quiet start
    quiet++;
    if (quiet < 2 || asking || reportConnection.browserOffline) return;
    if (asked && !reportConnection.relaysDown) return; // asked, and they answer: closed on purpose
    if (asked && quiet % ASK_AGAIN_EVERY !== 0) return;
    asking = true;
    canReachAny(lastUp).then((reached) => reached, () => false).then((reached) => {
      asking = false; asked = true;
      if (stopped) return;
      reportConnection.relaysDown = !reached;
      recompute();
    });
  }, everyMs);
  return () => {
    stopped = true; watching = false;
    clearInterval(timer);
    target.removeEventListener("offline", offline);
    target.removeEventListener("online", online);
    reportConnection.browserOffline = false; reportConnection.relaysDown = false;
    recompute();
  };
}

// ---- which face wins ---------------------------------------------------------
export function logoMood(s: { awake: boolean; lost: boolean; ringing: boolean; arrived: boolean; attention: boolean; working: boolean; justDone: boolean; hover: boolean }): MarkMood {
  if (s.lost) return "worry";
  if (s.ringing) return "ask";
  if (s.arrived) return "ask";
  if (!s.awake) return "rest";
  if (s.working) return "work";
  if (s.hover || s.justDone) return "done";
  if (s.attention) return "ask";
  return "here";
}

/** The New-post button speaks only about your post, and never smiles for one that didn't go. */
export function postMood(s: { awake: boolean; status: PostStatus; hover: boolean }): MarkMood {
  if (s.status === "failed") return "worry";
  if (s.status === "sending") return "work";
  if (s.status === "waiting") return "wait";
  if (s.status === "sent") return "done";
  if (!s.awake) return "rest";
  return s.hover ? "done" : "here";
}
