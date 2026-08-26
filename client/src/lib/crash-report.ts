// Anonymous crash reporting.
//
// When the app shows a user an error boundary, we file an ANONYMOUS crash ticket
// to the operator's admin inbox, reusing the existing NIP-34 private-feedback
// pipeline (sendPrivateTicket → gift-wrapped kind-1621 issue). The privacy model
// is deliberately strict and NON-NEGOTIABLE:
//
//   • Anonymous — reports are signed by a THROWAWAY key that is never the user's
//     identity. The key is persistent per-install (so the operator can tell
//     "1 user, 50 crashes" from "50 users, 1 crash each") but carries no link to
//     the signed-in account.
//   • Opt-out, default ON — a single localStorage flag (mirrors the client-tag
//     opt-out) disables it. Surfaced honestly in Settings.
//   • No PII — the report body is redacted (bech32 entities + 64-hex strings
//     stripped) and the user's real pubkey is NEVER passed into it.
//
// Everything here is fire-and-forget and MUST NEVER re-throw: a failure in the
// reporter must not break the error-boundary fallback the user is looking at.

import { PrivateKeySigner } from "applesauce-signers";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isUnactionableError } from "./error-noise";
import { isChunkLoadError } from "./stale-chunk-recovery";
import {
  captureContext,
  formatContextBlock,
  sendPrivateTicket,
  type FeedbackContext,
  type FeedbackIssue,
  type CrashStatus,
} from "./nip34-feedback";

// The operator's admin inbox (same key the beta Feedback tab reads).
// npub1m2lrszeztt0jvte79nukgcx5s7d3t7ha9apjtyukqr79cw6s5y3qqgeeph
export const CRASH_REPORT_PUBKEY =
  "dabe380b225adf262f3e2cf96460d4879b15fafd2f4325939600fc5c3b50a122";
// The operator's own relay. The gift wrap MUST reach here (the operator reads
// crash reports there), so it's force-appended to the publish set in sendDM —
// see sendPrivateTicket({ extraRelays }).
export const CRASH_REPORT_RELAY = "wss://relay-op.nostr1.com";

// Opt-out flag (default ON — only the literal "false" disables). Mirrors
// CLIENT_TAG_ENABLED_KEY / clientTags() in nostr-helpers.ts.
export const CRASH_REPORTS_ENABLED_KEY = "relay-outpost-crash-reports-enabled";

// Persistent per-install throwaway secret (hex). NOT the user's key. Kept out of
// LOCAL_SETTINGS_KEYS on purpose so it is neither NIP-78 synced nor wiped on
// account switch — it must stay stable per install.
export const CRASH_REPORTER_SK_KEY = "relay-outpost-crash-reporter-sk";

// Group tag: every crash from the same error signature carries the same value,
// so the operator's Feedback tab can collapse "Error X · 12×".
export const CRASH_SIG_TAG = "crash-sig";
// Topic tag value marking a ticket as a crash (vs real user feedback).
export const CRASH_TYPE = "crash";
// Signer label written into the context block. A fixed value, never the user's
// real signer type, so the report can't be fingerprinted back to an account.
export const CRASH_SIGNER_LABEL = "anon";

// ── Crash triage: grouping + tallies (pure, shared by the Feedback tab and the
//    Overview summary so both read one source of truth) ─────────────────────

/** True when a feedback issue is an auto-filed crash report (vs real user
 *  feedback). Keys off the `["t","crash"]` topic tag. */
export function isCrashIssue(i: FeedbackIssue): boolean {
  return i.event.tags.some((t) => t[0] === "t" && t[1] === CRASH_TYPE);
}

/** One collapsed crash: all occurrences sharing a crash signature, with the
 *  latest occurrence, an occurrence count, and the route it last fired on. */
export interface CrashGroup {
  sig: string;
  count: number;
  latest: FeedbackIssue;
  route: string | null;
}

/** Collapse crash occurrences by signature into groups, newest activity first.
 *  The latest occurrence's route wins; a group keeps any route it has seen. */
export function groupCrashesBySig(crashIssues: FeedbackIssue[]): CrashGroup[] {
  const groups = new Map<string, CrashGroup>();
  for (const i of crashIssues) {
    const sig = i.event.tags.find((t) => t[0] === CRASH_SIG_TAG)?.[1] || i.event.id;
    const route = i.contextBlock?.route || null;
    const g = groups.get(sig);
    if (!g) {
      groups.set(sig, { sig, count: 1, latest: i, route });
    } else {
      g.count += 1;
      if (i.latestActivityAt > g.latest.latestActivityAt) {
        g.latest = i;
        if (route) g.route = route;
      } else if (!g.route && route) {
        g.route = route;
      }
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.latest.latestActivityAt - a.latest.latestActivityAt);
}

/** Count crash groups per triage status (defaulting untouched groups to "new"),
 *  so filter chips can show "New 5 · Investigating 0 · Fixed 0 · Ignored 0". */
export function tallyCrashStatuses(
  groups: CrashGroup[],
  statuses: Record<string, CrashStatus>,
): Record<CrashStatus, number> {
  const t: Record<CrashStatus, number> = { new: 0, investigating: 0, fixed: 0, ignored: 0 };
  for (const g of groups) t[statuses[g.sig] || "new"] += 1;
  return t;
}

// ── Crash status = the TICKET's status (one source of truth) ────────────────
// Crash triage uses its own vocabulary (New / Investigating / Fixed / Closed)
// but it is a VIEW over the ticket's real NIP-34 lifecycle — the same status
// the Feedback detail shows and publishes. Mapping:
//   open ↔ New · draft(Triaged) ↔ Investigating · resolved ↔ Fixed · closed ↔ Closed
// (the "ignored" view key predates the label rename; the operator always sees
// "Closed" so closing a ticket reads back as the action they actually took)
// Deriving (instead of a parallel local store) means marking a crash Closed in
// the detail view flips the list chip too, and statuses sync across operator
// devices like every other ticket.

export function crashStatusFromIssueStatus(s: FeedbackIssue["status"]): CrashStatus {
  switch (s) {
    case "draft": return "investigating";
    case "resolved": return "fixed";
    case "closed": return "ignored";
    default: return "new";
  }
}

export function issueStatusForCrashStatus(c: CrashStatus): FeedbackIssue["status"] {
  switch (c) {
    case "investigating": return "draft";
    case "fixed": return "resolved";
    case "ignored": return "closed";
    default: return "open";
  }
}

/** Per-signature triage status derived from each group's latest ticket. */
export function deriveCrashStatuses(groups: CrashGroup[]): Record<string, CrashStatus> {
  const out: Record<string, CrashStatus> = {};
  for (const g of groups) out[g.sig] = crashStatusFromIssueStatus(g.latest.status);
  return out;
}

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // send each distinct crash ≤ once/24h
const SESSION_CAP = 5; // hard ceiling per page-load, independent of dedup
const STACK_CAP = 2000; // ~2KB
const COMPONENT_STACK_CAP = 1500;
const MESSAGE_CAP = 1000;
const DEVICE_CAP = 200;

// ---------------------------------------------------------------------------
// Opt-out gate (pure) — mirrors clientTags(): default ON, only "false" disables.
// ---------------------------------------------------------------------------
export function crashReportsEnabled(): boolean {
  try {
    return localStorage.getItem(CRASH_REPORTS_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Noise filter (pure) — drop expected relay/WebSocket churn and post-deploy
// stale-chunk errors so the operator inbox isn't flooded with non-bugs.
// ---------------------------------------------------------------------------
export function isReportableError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (isUnactionableError(message)) return false;
  if (isChunkLoadError(error)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Event normalization (pure) — the testable core of the global capture path.
// The window "error" / "unhandledrejection" surfaces hand us `any`-typed
// payloads (an Error, a string, a bare object, or nothing); coerce each to a
// real Error so the rest of the pipeline (dedup key, redaction, delivery) has a
// message + optional stack to work with. Never throws.
// ---------------------------------------------------------------------------

/** Best-effort string form of an arbitrary value; never throws. */
export function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "Unknown error";
    }
  }
}

/**
 * Normalize an `unhandledrejection` reason to an Error:
 *   • Error   → passthrough (keeps its stack)
 *   • string  → new Error(string)
 *   • object  → new Error(reason.message ?? truncated safeStringify)
 *   • null/undefined → new Error("Unknown error")
 */
export function normalizeRejection(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string") return new Error(reason || "Unknown error");
  if (reason == null) return new Error("Unknown error");
  const objMsg =
    typeof (reason as { message?: unknown }).message === "string"
      ? ((reason as { message: string }).message)
      : "";
  return new Error(objMsg || safeStringify(reason).slice(0, 500) || "Unknown error");
}

/**
 * Normalize a window `"error"` event payload to an Error. Prefers the real
 * `error` object (it carries a stack); falls back to the `message` string.
 * Mirrors `e.error ?? new Error(String(e.message ?? "Unknown error"))` but
 * guarantees an Error out even when `error` is a non-Error truthy value.
 */
export function normalizeErrorEvent(event: { error?: unknown; message?: unknown }): Error {
  const err = event?.error;
  if (err instanceof Error) return err;
  if (err != null) return normalizeRejection(err);
  return new Error(String(event?.message ?? "Unknown error"));
}

// ---------------------------------------------------------------------------
// Error signature (pure) — hash(message + first stack frame) → a stable, short
// key used both for the 24h dedup guard and the ["crash-sig", key] group tag.
// ---------------------------------------------------------------------------
export function firstStackFrame(stack?: string | null): string {
  if (!stack) return "";
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Skip the leading "Error: message" header (V8) — we want the first FRAME.
    if (/^[A-Za-z].*Error/.test(line) && !/\bat\b|@|https?:/.test(line)) continue;
    if (/\bat\b|@|https?:|\.(js|ts|tsx|jsx|mjs)/.test(line)) return line;
  }
  // No recognizable frame — fall back to the first non-empty line.
  const first = stack.split("\n").map((l) => l.trim()).find(Boolean);
  return first || "";
}

function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function computeErrorKey(message?: string | null, stack?: string | null): string {
  return fnv1aHex(`${message || ""}\n${firstStackFrame(stack)}`);
}

// ---------------------------------------------------------------------------
// Redaction (pure) — strip anything that could carry identity out of the body.
// Nostr bech32 entities (npub/nprofile/nsec/nevent/naddr/note) and any 64-char
// hex string (raw pubkey / privkey / event id) are replaced. Belt-and-braces on
// top of "never pass the user's pubkey in": even if a stack or component stack
// happened to embed one, it won't survive into the ticket.
// ---------------------------------------------------------------------------
const BECH32_RE = /\b(npub1|nprofile1|nsec1|nevent1|naddr1|note1)[0-9a-z]{20,}\b/gi;
const HEX64_RE = /\b[0-9a-f]{64}\b/gi;
// Error messages can also embed URLs-with-tokens, emails and Lightning strings —
// each an identity/secret leak on top of the Nostr keys/ids above.
const URL_RE = /\bhttps?:\/\/[^\s'"<>)\]}]+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
const LIGHTNING_RE = /\b(lnbc|lntb|lnbcrt|lnurl)[0-9a-z]{10,}\b/gi;

// The app's own origin (e.g. https://relayop.xyz), or "" when unavailable
// (node tests / workers without a location). Never throws.
function appOrigin(): string {
  try {
    return typeof location !== "undefined" ? location.origin : "";
  } catch {
    return "";
  }
}

// URL redaction with a SAME-ORIGIN carve-out:
//   • same-origin (our own asset/stack URLs) → keep scheme+host+path so a stack
//     frame like https://relayop.xyz/assets/Feed-abc.js:2:1044 survives intact —
//     file:line:col is the crash reporter's core debug value, and our own asset
//     URLs aren't sensitive. Only the query+fragment are dropped (tokens ride
//     there, and Concord invite secrets live in the fragment).
//   • foreign URL → host-only (`${protocol}//${host}/[redacted]`), so a token in
//     a third-party URL never survives. `new URL().host` also strips any
//     `user:pass@` credentials embedded in the authority.
// `selfOrigin` is injectable (defaults to appOrigin()) so node tests can exercise
// both branches without a real location.
function redactUrl(m: string, selfOrigin: string): string {
  try {
    const u = new URL(m);
    if (selfOrigin && u.origin === selfOrigin) {
      return `${u.origin}${u.pathname}`;
    }
    return `${u.protocol}//${u.host}/[redacted]`;
  } catch {
    return "[url]";
  }
}

export function redactSensitive(text: string, selfOrigin: string = appOrigin()): string {
  if (!text) return text;
  // Order matters: strip whole URLs (and their token tails) first, then emails,
  // then Lightning, then the Nostr key/id patterns. Doing URLs first means a token
  // that happens to look like hex/bech32 inside a URL is gone before those run.
  return text
    .replace(URL_RE, (m) => redactUrl(m, selfOrigin))
    .replace(EMAIL_RE, "[email]")
    .replace(LIGHTNING_RE, "[lightning]")
    .replace(BECH32_RE, "[redacted]")
    .replace(HEX64_RE, "[redacted]");
}

// Where a reported error came from — lets the operator tell an async/global
// error apart from a React render crash. Drives the ticket title prefix and a
// machine-readable ["t", source] tag (see deliverCrash). "render" is the
// default (the two ErrorBoundary callers), so existing behavior is unchanged.
export type CrashSource = "render" | "uncaught" | "rejection";
const CRASH_TITLE_PREFIX: Record<CrashSource, string> = {
  render: "Crash:",
  uncaught: "Uncaught error:",
  rejection: "Unhandled rejection:",
};

// ---------------------------------------------------------------------------
// Report builder (pure) — assemble the ticket title + body. The body is fully
// self-contained (message + truncated stack + component stack + device + the
// formatted context block) and passes through redactSensitive, so it can be
// asserted in tests to never contain a pubkey. NB: because the builder already
// embeds the context block, deliverCrash passes context:null to sendPrivateTicket
// to avoid appending it twice. The title prefix reflects `source` (default
// "render" → "Crash:") so async/global errors are distinguishable at a glance.
// ---------------------------------------------------------------------------
export function buildCrashReport(opts: {
  error: Error;
  componentStack?: string | null;
  context: FeedbackContext | null;
  device?: string; // injectable for tests; defaults to navigator.userAgent
  source?: CrashSource; // default "render"
}): { title: string; body: string } {
  const { error, componentStack, context } = opts;
  const source = opts.source ?? "render";
  const message = (error?.message || "Unknown error").slice(0, MESSAGE_CAP);
  const firstLine = message.split("\n")[0].trim().slice(0, 120) || "Unknown error";

  const device = opts.device !== undefined ? opts.device : deviceLineValue();
  const parts: string[] = [message];

  const stack = (error?.stack || "").trim();
  if (stack) {
    parts.push("", "Stack:", stack.slice(0, STACK_CAP));
  }
  if (componentStack && componentStack.trim()) {
    parts.push("", "Component stack:", componentStack.trim().slice(0, COMPONENT_STACK_CAP));
  }
  if (device) {
    parts.push("", `- device: ${device.slice(0, DEVICE_CAP)}`);
  }
  if (context) {
    parts.push(formatContextBlock(context));
  }

  const title = redactSensitive(`${CRASH_TITLE_PREFIX[source]} ${firstLine}`);
  const body = redactSensitive(parts.join("\n"));
  return { title, body };
}

function deviceLineValue(): string {
  try {
    if (typeof navigator === "undefined") return "";
    return navigator.userAgent || "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Dedup / throttle (localStorage) — mirrors the markIssueRead map pattern:
// a JSON object errorKey → lastSentAtMs, pruned on write so it can't grow.
// ---------------------------------------------------------------------------
const THROTTLE_KEY = "relay-outpost:crash-reports:last-sent";

function readThrottle(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(THROTTLE_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeThrottle(map: Record<string, number>): void {
  try {
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(map));
  } catch {}
}

export function recentlySent(key: string, now: number = Date.now()): boolean {
  const last = readThrottle()[key] || 0;
  return now - last < DEDUP_WINDOW_MS;
}

export function recordSent(key: string, now: number = Date.now()): void {
  const map = readThrottle();
  for (const k of Object.keys(map)) {
    if (now - map[k] >= DEDUP_WINDOW_MS) delete map[k];
  }
  map[key] = now;
  writeThrottle(map);
}

// ---------------------------------------------------------------------------
// Per-session cap — an in-memory counter that resets on page load (a fresh app
// session), independent of the persistent 24h dedup.
// ---------------------------------------------------------------------------
const session = { count: 0 };
/** Test hook: reset the per-session counter between cases. */
export function resetCrashReportSession(): void {
  session.count = 0;
}

// ---------------------------------------------------------------------------
// Gate + commit (no network). Runs every check and, if the crash should be
// reported, atomically claims the slot (bumps the session counter + records the
// send time) and returns the crash-sig key. Returns null to skip. Never throws.
// Split out from reportCrash so the full gate is unit-testable without network.
// ---------------------------------------------------------------------------
export function claimCrashSlot(error: unknown, now: number = Date.now()): string | null {
  try {
    if (!crashReportsEnabled()) return null;
    if (!isReportableError(error)) return null;
    const err = error as Error;
    const key = computeErrorKey(err.message, err.stack);
    if (recentlySent(key, now)) return null;
    if (session.count >= SESSION_CAP) return null;
    session.count += 1;
    recordSent(key, now);
    return key;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Anonymous reporter identity — a persistent per-install throwaway key. Minted
// once, cached in localStorage as hex, reloaded on subsequent reports. NOT the
// user's identity. nip44-capable (PrivateKeySigner) so the gift wrap encrypts.
// ---------------------------------------------------------------------------
let cachedReporter: { signer: PrivateKeySigner; pubkey: string } | null = null;

export async function getAnonReporter(): Promise<{ signer: PrivateKeySigner; pubkey: string }> {
  if (cachedReporter) return cachedReporter;

  let signer: PrivateKeySigner | null = null;
  try {
    const hex = localStorage.getItem(CRASH_REPORTER_SK_KEY);
    if (hex) signer = PrivateKeySigner.fromKey(hex);
  } catch {
    signer = null;
  }
  if (!signer) {
    signer = new PrivateKeySigner();
    try {
      localStorage.setItem(CRASH_REPORTER_SK_KEY, bytesToHex(signer.key));
    } catch {}
  }
  const pubkey = await signer.getPublicKey();
  cachedReporter = { signer, pubkey };
  return cachedReporter;
}

/** Test hook: drop the in-memory reporter cache to exercise the reload path. */
export function __resetAnonReporterCache(): void {
  cachedReporter = null;
}

// ---------------------------------------------------------------------------
// Delivery (network) — gift-wrap the sanitized report to the operator via the
// existing private-ticket pipeline, forcing CRASH_REPORT_RELAY into the publish
// set so it lands where the operator reads. Fire-and-forget.
// ---------------------------------------------------------------------------
async function deliverCrash(error: Error, componentStack: string | undefined, key: string, source: CrashSource): Promise<void> {
  const { signer, pubkey } = await getAnonReporter();
  const context = captureContext(CRASH_SIGNER_LABEL);
  const { title, body } = buildCrashReport({ error, componentStack, context, source });
  await sendPrivateTicket({
    signer,
    myPubkey: pubkey, // the ANON reporter pubkey, never the user's
    operatorPubkey: CRASH_REPORT_PUBKEY,
    title,
    body,
    types: [CRASH_TYPE],
    context: null, // body already embeds the context block (see buildCrashReport)
    // crash-sig groups repeats of the same error; the source tag lets the
    // operator filter render crashes vs uncaught/rejection (unknown to readTypes,
    // which only recognizes bug/idea/ux/question — so it's parse-safe).
    extraTags: [[CRASH_SIG_TAG, key], ["t", source]],
    extraRelays: [CRASH_REPORT_RELAY],
  });
}

// ---------------------------------------------------------------------------
// Public entry point. Fire-and-forget; MUST NEVER re-throw. `source` marks
// where the error came from (default "render" for the ErrorBoundary callers;
// "uncaught"/"rejection" for the global handlers in main.tsx).
// ---------------------------------------------------------------------------
export function reportCrash(error: Error, componentStack?: string, source: CrashSource = "render"): void {
  try {
    // Dev-server sessions never report: HMR half-swapped components throw
    // phantom "X is not defined" errors that filed real tickets into the
    // operator inbox (first seen 2026-07-20, from the embedded preview
    // browser). Production builds are unaffected.
    if (import.meta.env.DEV) return;
    const key = claimCrashSlot(error);
    if (!key) return;
    deliverCrash(error, componentStack, key, source).catch(() => {});
  } catch {
    // swallow — reporting must never break the error-boundary fallback
  }
}
