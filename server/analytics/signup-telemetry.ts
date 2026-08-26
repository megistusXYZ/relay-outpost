// Lightweight, anonymous telemetry for the signup-resume flow added in
// task #274. We need to confirm whether the draft-resume mechanism is
// actually catching mobile users who would otherwise have bounced — without
// shipping a new third-party tracker. Counters live in-process; events are
// also written to a recent-events ring for ad-hoc log queries / debugging.
//
// Privacy: no pubkeys, no draft contents, no IPs, no cookies. We accept a
// random per-page-load `sessionId` (opaque) only so events from the same
// page load can be stitched into a tiny funnel server-side.

import type { Express, Request } from "express";

const ALLOWED_EVENTS = [
  "landing_viewed",       // the marketing landing (full warp overlay) was shown
  "launch_clicked",       // user clicked a "Launch Station" CTA to begin sign-in
  "draft_started",        // first non-empty save in a session
  "draft_hydrated",       // CreateAccountFlow restored a saved draft on mount
  "resume_chip_shown",    // GalaxyWarpOverlay rendered the "Resume signup" chip
  "resume_chip_tapped",   // user tapped the chip
  "signup_completed",     // finish step succeeded
  "signup_abandoned",     // user explicitly backed out with non-empty draft
] as const;
type SignupEvent = typeof ALLOWED_EVENTS[number];

interface IncomingPayload {
  event: SignupEvent;
  sessionId: string;
  // Optional flag set by the client when an event is the result of a
  // resumed draft (e.g. signup_completed after draft_hydrated). Used so
  // we can answer "did resume actually convert?" without joining sessions.
  wasResumed?: boolean;
}

interface RecordedEvent {
  event: SignupEvent;
  sessionId: string;
  wasResumed: boolean;
  isMobile: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  ts: number;
}

const counters: Record<SignupEvent, number> = {
  landing_viewed: 0,
  launch_clicked: 0,
  draft_started: 0,
  draft_hydrated: 0,
  resume_chip_shown: 0,
  resume_chip_tapped: 0,
  signup_completed: 0,
  signup_abandoned: 0,
};

// Resume-aware sub-counters so we can answer: of the signups that came
// through the resume chip, how many completed vs abandoned?
const resumedCounters = {
  signup_completed: 0,
  signup_abandoned: 0,
};

// Mobile-only counters so we can isolate the cohort the original theory
// was about. UA sniffing is rough but good enough for a directional signal.
const mobileCounters: Record<SignupEvent, number> = {
  landing_viewed: 0,
  launch_clicked: 0,
  draft_started: 0,
  draft_hydrated: 0,
  resume_chip_shown: 0,
  resume_chip_tapped: 0,
  signup_completed: 0,
  signup_abandoned: 0,
};

// Bounded ring of recent events for log-style inspection. Capped so a
// misbehaving client can't grow memory unbounded.
const RECENT_MAX = 500;
const recent: RecordedEvent[] = [];

// Per-session de-dup so a noisy client (e.g. effect that re-fires) can't
// inflate counters. Sessions naturally age out.
const SESSION_MAX = 2000;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const sessionEvents = new Map<string, { events: Set<SignupEvent>; ts: number }>();

function gcSessions() {
  if (sessionEvents.size <= SESSION_MAX) return;
  const cutoff = Date.now() - SESSION_TTL_MS;
  sessionEvents.forEach((v, k) => {
    if (v.ts < cutoff) sessionEvents.delete(k);
  });
  // If still oversized (all fresh), drop oldest by insertion order.
  while (sessionEvents.size > SESSION_MAX) {
    const firstKey = sessionEvents.keys().next().value;
    if (!firstKey) break;
    sessionEvents.delete(firstKey);
  }
}

function classifyUA(req: Request): { isMobile: boolean; isIOS: boolean; isStandalone: boolean } {
  const ua = String(req.headers["user-agent"] || "");
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isIOS || /Android|Mobile/i.test(ua);
  // PWA / standalone hint passed by the client (browsers don't expose it
  // in the UA). We accept a header so we don't need a body field for it.
  const isStandalone = String(req.headers["x-ro-display-mode"] || "").toLowerCase() === "standalone";
  return { isMobile, isIOS, isStandalone };
}

function isValidPayload(body: any): body is IncomingPayload {
  if (!body || typeof body !== "object") return false;
  if (typeof body.event !== "string") return false;
  if (!ALLOWED_EVENTS.includes(body.event)) return false;
  if (typeof body.sessionId !== "string") return false;
  // Reject obviously bogus session ids — keep them short and ascii.
  if (body.sessionId.length === 0 || body.sessionId.length > 64) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(body.sessionId)) return false;
  if (body.wasResumed !== undefined && typeof body.wasResumed !== "boolean") return false;
  return true;
}

export function registerSignupTelemetryRoutes(app: Express): void {
  app.post("/api/telemetry/signup", (req, res) => {
    // sendBeacon ships bodies as text/plain; accept either JSON or string.
    let body: any = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!isValidPayload(body)) {
      return res.status(204).end();
    }
    const ua = classifyUA(req);
    const seen = sessionEvents.get(body.sessionId);
    if (seen && seen.events.has(body.event) && body.event !== "signup_completed" && body.event !== "signup_abandoned") {
      // Idempotent for show/tap/hydrate/start; terminal events can fire once
      // even if a session is reused (shouldn't happen, but harmless).
      seen.ts = Date.now();
      return res.status(204).end();
    }
    if (seen) {
      seen.events.add(body.event);
      seen.ts = Date.now();
    } else {
      sessionEvents.set(body.sessionId, { events: new Set([body.event]), ts: Date.now() });
      gcSessions();
    }

    counters[body.event] += 1;
    if (ua.isMobile) mobileCounters[body.event] += 1;
    if (body.wasResumed && (body.event === "signup_completed" || body.event === "signup_abandoned")) {
      resumedCounters[body.event] += 1;
    }
    recent.push({
      event: body.event,
      sessionId: body.sessionId,
      wasResumed: !!body.wasResumed,
      isMobile: ua.isMobile,
      isIOS: ua.isIOS,
      isStandalone: ua.isStandalone,
      ts: Date.now(),
    });
    if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);

    // Structured log line so this is also greppable in deployment logs
    // without needing a dashboard.
    console.log(
      `[signup-telemetry] event=${body.event} mobile=${ua.isMobile} ios=${ua.isIOS} standalone=${ua.isStandalone} resumed=${!!body.wasResumed}`,
    );
    return res.status(204).end();
  });

  app.get("/api/telemetry/signup/summary", (_req, res) => {
    const completed = counters.signup_completed;
    const abandoned = counters.signup_abandoned;
    const completionRate = completed + abandoned > 0
      ? completed / (completed + abandoned)
      : null;
    const resumeTapRate = counters.resume_chip_shown > 0
      ? counters.resume_chip_tapped / counters.resume_chip_shown
      : null;
    const resumedTotal = resumedCounters.signup_completed + resumedCounters.signup_abandoned;
    const resumedCompletionRate = resumedTotal > 0
      ? resumedCounters.signup_completed / resumedTotal
      : null;
    // Top-of-funnel: of the people who saw the landing, how many clicked a
    // "Launch Station" CTA to begin sign-in?
    const launchClickRate = counters.landing_viewed > 0
      ? counters.launch_clicked / counters.landing_viewed
      : null;
    res.json({
      counters,
      mobileCounters,
      resumedCounters,
      derived: {
        completionRate,
        resumeTapRate,
        resumedCompletionRate,
        launchClickRate,
      },
      recent: recent.slice(-100),
      capturedAt: Date.now(),
    });
  });
}
