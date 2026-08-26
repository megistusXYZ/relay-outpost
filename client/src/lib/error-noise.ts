// Shared classifier for "noise" errors that must NEVER surface as real crashes.
//
// These are expected, self-healing relay/WebSocket churn — an AUTH challenge we
// haven't answered yet, a socket that closed mid-send, nostr-tools' dev-only
// `window.printer.maybe` shim throwing. They are logged for debugging but are
// deliberately swallowed by main.tsx's global error/unhandledrejection handlers
// so they don't trip the dev runtime-error overlay, and they are dropped by the
// crash reporter (lib/crash-report.ts) so the operator inbox isn't flooded with
// transient connectivity chatter.
//
// Single source of truth: main.tsx and crash-report.ts both import from here so
// the list can never drift between the two.

export const WS_NOISE = [
  "on a closed connection",
  "auth timed out",
  "auth event validation failed",
  "auth-required",
  "restricted: not authenticated",
  // A relay refuses an auth-required READ for a client that isn't (or can't be)
  // authenticated — e.g. a logged-out ("anon") user deep-linking to a DM thread
  // whose inbox relay gates reads behind NIP-42. nostr-tools rejects the pending
  // REQ promise with the CLOSED reason; that's expected policy churn, not a bug.
  // (First live report: anon on /messages/<id>, 2026-07-21.)
  "restricted: user unauthorized",
  "user unauthorized",
  "WebSocket is already in CLOSING",
  "WebSocket is not open",
  "Tried to send message",
  "reading 'maybe'",
  // nostr-tools' AbstractRelay rejects pending publishes/subscriptions with
  // this when a socket drops (closeAllSubscriptions/handleHardClose). It is
  // expected churn — the pool reconnects — but the global unhandledrejection
  // capture was dutifully filing it as a crash ticket (first live report,
  // 2026-07-19). Relay disconnects are not bugs.
  "relay connection failed",
  "connection to relay closed",
];

/** True if the message looks like expected relay/WebSocket churn (see WS_NOISE). */
export function isWsNoise(msg: string): boolean {
  if (!msg) return false;
  return WS_NOISE.some((n) => msg.includes(n));
}

// Browser noise that is real-but-un-actionable — nothing our code can fix and
// zero actionable info attached. These flood the operator inbox as phantom
// "crashes" that aren't ours, so the reporter drops them (industry standard —
// Sentry/Bugsnag drop these by default).
export const BROWSER_NOISE = [
  // The classic cross-origin masked error: when a script from ANOTHER origin
  // (a Safari extension / content-blocker / password-manager / embedded widget)
  // throws, the browser hides the details for security and reports only
  // "Script error." with a null error object — so its "stack" is just our own
  // reporter's frames. Same-origin app errors are NEVER masked this way, so a
  // "Script error." is by definition not our bug. (First live report: an iPhone
  // Safari user on /search, 2026-07-20.)
  "Script error",
  // Benign layout-thrash warning some browsers surface as a global error; never
  // a crash. Widely filtered everywhere.
  "ResizeObserver loop",
  // WebKit's OWN media-controls code (the shadow-DOM <video> controls) throws
  // this internally on iOS 26.x — every reported stack is Apple frames
  // (played / syncControl / handleEvent / endTimeForBufferedRangeContaining…)
  // with zero app frames. Not our bug, not actionable, filtered.
  // (First live reports: iPhone Safari 26.5 on /profile, 2026-08.)
  "Can't find variable: EmptyRanges",
];

/** True for expected relay churn OR un-actionable cross-origin/browser noise —
 *  the full set the global handlers swallow and the crash reporter drops. */
export function isUnactionableError(msg: string): boolean {
  if (!msg) return false;
  return isWsNoise(msg) || BROWSER_NOISE.some((n) => msg.includes(n));
}
