// Tiny client for the signup-resume telemetry endpoint. Anonymous: we send
// a random per-page-load session id and an event name — never any draft
// fields, pubkeys, or other PII. Used to verify the mobile-eviction theory
// from task #274 without adding a third-party tracker.

const ENDPOINT = "/api/telemetry/signup";

export type SignupTelemetryEvent =
  | "landing_viewed"
  | "launch_clicked"
  | "draft_started"
  | "draft_hydrated"
  | "resume_chip_shown"
  | "resume_chip_tapped"
  | "signup_completed"
  | "signup_abandoned";

// iOS Safari exposes `navigator.standalone` to indicate a home-screen PWA,
// which the standard `Navigator` type doesn't include. Narrow the surface
// we touch instead of reaching for `any`.
interface NavigatorWithStandalone extends Navigator {
  readonly standalone?: boolean;
}

let sessionId: string | null = null;
const dedup = new Set<SignupTelemetryEvent>();

function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const arr = new Uint8Array(12);
    const c: Crypto | undefined =
      typeof globalThis !== "undefined" && globalThis.crypto
        ? globalThis.crypto
        : (typeof window !== "undefined" ? window.crypto : undefined);
    if (!c) throw new Error("no crypto");
    c.getRandomValues(arr);
    let s = "";
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    sessionId = btoa(s)
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    sessionId = `s${Math.random().toString(36).slice(2, 14)}`;
  }
  return sessionId!;
}

function isStandalone(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    const nav = window.navigator as NavigatorWithStandalone;
    if (nav.standalone === true) return true;
  } catch {}
  return false;
}

export interface TrackOptions {
  // Whether this event is the consequence of a resumed draft. Only
  // meaningful for terminal events (`signup_completed`, `signup_abandoned`).
  wasResumed?: boolean;
  // Force-send even if we've already sent this event in this page load.
  // Default is to dedup non-terminal events.
  force?: boolean;
}

export function trackSignupEvent(event: SignupTelemetryEvent, opts: TrackOptions = {}): void {
  try {
    if (typeof window === "undefined") return;
    const isTerminal = event === "signup_completed" || event === "signup_abandoned";
    if (!opts.force && !isTerminal && dedup.has(event)) return;
    dedup.add(event);

    const payload = JSON.stringify({
      event,
      sessionId: getSessionId(),
      wasResumed: !!opts.wasResumed,
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isStandalone()) headers["x-ro-display-mode"] = "standalone";

    // Prefer sendBeacon on terminal events — the page may be evicted right
    // after, and beacons survive page lifecycle changes. Note: sendBeacon
    // can't set custom headers, so we only use it when we don't need the
    // standalone hint (or accept losing it on PWA terminal events — better
    // than dropping the event entirely).
    if (isTerminal && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      } catch {}
    }

    void fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: payload,
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // Telemetry must never break signup.
  }
}
