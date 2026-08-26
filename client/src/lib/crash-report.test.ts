// Locks the privacy + rate-limit contract of the anonymous crash reporter.
// The load-bearing guarantees:
//   • opt-out (default ON) suppresses everything,
//   • WS/chunk noise never becomes a ticket,
//   • each distinct crash is sent ≤ once / 24h AND ≤ 5 / session,
//   • the report body can NEVER contain a pubkey (redaction), and
//   • the reporter identity is a stable-per-install, nip44-capable throwaway
//     that is never the user's key.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrivateKeySigner } from "applesauce-signers";

// node env has no localStorage; the gates read/write it synchronously.
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});

// redactSensitive reads location.origin to tell same-origin (our own asset/stack)
// URLs from foreign ones. node has none; stub a stable app origin so the DEFAULT
// path of redactSensitive/buildCrashReport resolves an origin (realError's frame
// is https://app.example/... — same-origin under this stub, so it's preserved).
vi.stubGlobal("location", { origin: "https://app.example" });

import {
  crashReportsEnabled,
  isReportableError,
  firstStackFrame,
  computeErrorKey,
  redactSensitive,
  buildCrashReport,
  recentlySent,
  recordSent,
  claimCrashSlot,
  reportCrash,
  getAnonReporter,
  __resetAnonReporterCache,
  resetCrashReportSession,
  safeStringify,
  normalizeRejection,
  normalizeErrorEvent,
  CRASH_REPORTS_ENABLED_KEY,
  CRASH_REPORTER_SK_KEY,
  CRASH_TYPE,
  CRASH_SIG_TAG,
  isCrashIssue,
  groupCrashesBySig,
  tallyCrashStatuses,
  crashStatusFromIssueStatus,
  issueStatusForCrashStatus,
  deriveCrashStatuses,
} from "./crash-report";
import { SAFE_ROUTE, captureContext } from "./nip34-feedback";
import type { FeedbackContext, FeedbackIssue, CrashStatus } from "./nip34-feedback";

beforeEach(() => {
  __store.clear();
  resetCrashReportSession();
  __resetAnonReporterCache();
});

const realError = (msg = "Cannot read properties of undefined (reading 'foo')") => {
  const e = new Error(msg);
  e.stack = `Error: ${msg}\n    at Feed (https://app.example/assets/Feed-a1b2c3.js:2:1044)\n    at div`;
  return e;
};

describe("opt-out gate (default ON)", () => {
  it("unset → enabled", () => {
    expect(crashReportsEnabled()).toBe(true);
  });
  it('explicit "true" → enabled', () => {
    localStorage.setItem(CRASH_REPORTS_ENABLED_KEY, "true");
    expect(crashReportsEnabled()).toBe(true);
  });
  it('only the literal "false" disables', () => {
    localStorage.setItem(CRASH_REPORTS_ENABLED_KEY, "false");
    expect(crashReportsEnabled()).toBe(false);
  });
  it("opt-out suppresses claimCrashSlot entirely", () => {
    localStorage.setItem(CRASH_REPORTS_ENABLED_KEY, "false");
    expect(claimCrashSlot(realError())).toBeNull();
  });
});

describe("noise filter drops WS + stale-chunk errors", () => {
  it("drops WebSocket churn", () => {
    expect(isReportableError(new Error("WebSocket is not open"))).toBe(false);
    expect(isReportableError(new Error("relay: auth-required"))).toBe(false);
    expect(isReportableError(new Error("Cannot read ... reading 'maybe'"))).toBe(false);
  });
  it("drops post-deploy stale-chunk errors", () => {
    expect(isReportableError(new Error("Loading chunk 42 failed."))).toBe(false);
    const named = new Error("boom"); named.name = "ChunkLoadError";
    expect(isReportableError(named)).toBe(false);
    expect(isReportableError(new Error("Failed to fetch dynamically imported module: /x.js"))).toBe(false);
  });
  it("keeps a real render error", () => {
    expect(isReportableError(realError())).toBe(true);
  });
  it("null-ish is not reportable", () => {
    expect(isReportableError(null)).toBe(false);
    expect(isReportableError(undefined)).toBe(false);
  });
  it("claimCrashSlot returns null for noise", () => {
    expect(claimCrashSlot(new Error("WebSocket is not open"))).toBeNull();
  });
});

describe("error signature (dedup key)", () => {
  it("firstStackFrame skips the Error header and returns the first frame", () => {
    expect(firstStackFrame(realError().stack)).toContain("Feed-a1b2c3.js");
  });
  it("is stable for the same message + first frame", () => {
    expect(computeErrorKey("x", "  at a (f.js:1:1)\n at b")).toBe(computeErrorKey("x", "  at a (f.js:1:1)\n at c"));
  });
  it("differs when the message or first frame differs", () => {
    expect(computeErrorKey("x", "at a")).not.toBe(computeErrorKey("y", "at a"));
    expect(computeErrorKey("x", "at a")).not.toBe(computeErrorKey("x", "at b"));
  });
});

describe("redaction — never leak identity", () => {
  it("strips bech32 entities and 64-hex strings", () => {
    const npub = "npub1" + "q".repeat(58);
    const hex = "a".repeat(64);
    const nsec = "nsec1" + "w".repeat(58);
    const out = redactSensitive(`user ${npub} key ${hex} secret ${nsec}`);
    expect(out).not.toContain(npub);
    expect(out).not.toContain(hex);
    expect(out).not.toContain(nsec);
    expect(out).toContain("[redacted]");
  });

  it("redacts a FOREIGN URL to host-only (path/query/fragment dropped)", () => {
    const out = redactSensitive("boom at https://x.com/api?token=SECRET&q=hello#frag now", "https://relayop.xyz");
    expect(out).toContain("x.com");          // host preserved — which service failed
    expect(out).toContain("[redacted]");     // path replaced
    expect(out).not.toContain("SECRET");     // token gone
    expect(out).not.toContain("token=");
    expect(out).not.toContain("q=hello");
    expect(out).not.toContain("#frag");
    expect(out).not.toContain("/api");       // foreign path dropped
  });

  it("KEEPS a same-origin stack-frame URL's file:line:col intact (carve-out)", () => {
    const frame = "https://relayop.xyz/assets/Feed-abc.js:2:1044";
    const out = redactSensitive(`crashed at ${frame}`, "https://relayop.xyz");
    expect(out).toContain(frame);            // our own asset URL survives whole
    expect(out).toContain("Feed-abc.js:2:1044");
    expect(out).not.toContain("[redacted]");
  });

  it("drops the ?query token AND #fragment even for a SAME-origin URL", () => {
    const out = redactSensitive("post to https://relayop.xyz/api?token=SECRET#frag", "https://relayop.xyz");
    expect(out).toContain("https://relayop.xyz/api"); // path kept
    expect(out).not.toContain("SECRET");              // query token still dropped
    expect(out).not.toContain("token=");
    expect(out).not.toContain("#frag");               // fragment dropped
  });

  it("drops user:pass credentials embedded in a (foreign) URL", () => {
    const out = redactSensitive("failed https://user:pass@host.example/x", "https://relayop.xyz");
    expect(out).not.toContain("pass");       // new URL().host strips the authority creds
    expect(out).toContain("host.example");
  });

  it("redacts a bare email to [email]", () => {
    const out = redactSensitive("contact alice.smith@example.com about it");
    expect(out).toContain("[email]");
    expect(out).not.toContain("alice.smith@example.com");
    expect(out).not.toContain("@example.com");
  });

  it("redacts bolt11 and lnurl strings to [lightning]", () => {
    const bolt11 = "lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq";
    const lnurl = "lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxjum0ve5k7mf0v9cxjum0d3h82unvwq";
    const out = redactSensitive(`pay ${bolt11} or ${lnurl}`);
    expect(out).not.toContain(bolt11);
    expect(out).not.toContain(lnurl);
    expect(out).toContain("[lightning]");
  });

  it("still redacts nsec1… and a 64-hex string (existing guarantees hold)", () => {
    const nsec = "nsec1" + "w".repeat(58);
    const hex = "a".repeat(64);
    const out = redactSensitive(`key ${nsec} id ${hex}`);
    expect(out).not.toContain(nsec);
    expect(out).not.toContain(hex);
    expect(out).toContain("[redacted]");
  });
});

describe("buildCrashReport", () => {
  const ctx: FeedbackContext = { route: "/u/<id>", viewport: "390x844", signerType: "anon", appVersion: "9.9.9" };

  it("includes route, version, device and stack", () => {
    const { body } = buildCrashReport({ error: realError(), context: ctx, device: "TestUA/1.0" });
    expect(body).toContain("/u/<id>");        // route
    expect(body).toContain("9.9.9");          // app version
    expect(body).toContain("TestUA/1.0");     // device
    // Same-origin stack frame keeps its file:line:col (carve-out); location is
    // stubbed to https://app.example so realError's frame counts as "our own".
    expect(body).toContain("Feed-a1b2c3.js:2:1044"); // stack frame preserved intact
  });

  it("title is 'Crash: <first line>'", () => {
    const { title } = buildCrashReport({ error: realError("Boom happened"), context: ctx, device: "" });
    expect(title).toBe("Crash: Boom happened");
  });

  // THE privacy test: a report can never carry a user pubkey.
  it("never contains a pubkey even if the error/stack/component-stack embed one", () => {
    const hex = "b".repeat(64);
    const npub = "npub1" + "z".repeat(58);
    const err = new Error(`Failed for ${hex}`);
    err.stack = `Error: Failed for ${hex}\n    at X (https://app.example/assets/x.js:1:1)\n    ${npub}`;
    const { title, body } = buildCrashReport({
      error: err,
      componentStack: `\n    in Profile (owner ${hex})\n    in App`,
      context: ctx,
      device: "TestUA/1.0",
    });
    expect(body).not.toContain(hex);
    expect(body).not.toContain(npub);
    expect(body).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(body).not.toMatch(/npub1[0-9a-z]{20,}/i);
    expect(title).not.toContain(hex);
    // still a useful report — the same-origin frame keeps its path (carve-out),
    // while the pubkeys embedded in the message/component-stack are still redacted
    expect(body).toContain("x.js");
  });

  it("caps the stack around 2KB", () => {
    const err = new Error("big");
    err.stack = "Error: big\n" + "at frame ".repeat(2000);
    const { body } = buildCrashReport({ error: err, context: ctx, device: "" });
    expect(body.length).toBeLessThan(6000);
  });

  // Source distinguishes async/global errors from render crashes in the title.
  it("titles by source: render→Crash, uncaught→Uncaught error, rejection→Unhandled rejection", () => {
    const err = () => new Error("Boom happened");
    expect(buildCrashReport({ error: err(), context: ctx, device: "" }).title).toBe("Crash: Boom happened");
    expect(buildCrashReport({ error: err(), context: ctx, device: "", source: "render" }).title).toBe("Crash: Boom happened");
    expect(buildCrashReport({ error: err(), context: ctx, device: "", source: "uncaught" }).title).toBe("Uncaught error: Boom happened");
    expect(buildCrashReport({ error: err(), context: ctx, device: "", source: "rejection" }).title).toBe("Unhandled rejection: Boom happened");
  });
});

// The testable CORE of the global capture path (main.tsx wires these into the
// window "error"/"unhandledrejection" listeners): coerce any payload to an Error.
describe("normalizeRejection / normalizeErrorEvent (pure)", () => {
  it("normalizeRejection: Error passes through unchanged (keeps its stack)", () => {
    const e = new Error("kaboom");
    e.stack = "Error: kaboom\n    at f (x.js:1:1)";
    expect(normalizeRejection(e)).toBe(e);
  });
  it("normalizeRejection: string → Error(string)", () => {
    const out = normalizeRejection("plain string reason");
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("plain string reason");
  });
  it("normalizeRejection: object with .message → Error(message)", () => {
    const out = normalizeRejection({ message: "custom oops", code: 42 });
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("custom oops");
  });
  it("normalizeRejection: object without message → Error(truncated stringify ≤500)", () => {
    const out = normalizeRejection({ big: "x".repeat(1000) });
    expect(out).toBeInstanceOf(Error);
    expect(out.message.length).toBeLessThanOrEqual(500);
    expect(out.message.length).toBeGreaterThan(0);
  });
  it("normalizeRejection: null/undefined are null-safe → Error('Unknown error')", () => {
    expect(() => normalizeRejection(null)).not.toThrow();
    expect(() => normalizeRejection(undefined)).not.toThrow();
    expect(normalizeRejection(null).message).toBe("Unknown error");
    expect(normalizeRejection(undefined).message).toBe("Unknown error");
  });

  it("normalizeErrorEvent: prefers the real error object (keeps its stack)", () => {
    const e = new Error("boom");
    expect(normalizeErrorEvent({ error: e, message: "boom" })).toBe(e);
  });
  it("normalizeErrorEvent: no error object → Error(message)", () => {
    expect(normalizeErrorEvent({ error: null, message: "script blew up" }).message).toBe("script blew up");
  });
  it("normalizeErrorEvent: no error and no message → Error('Unknown error')", () => {
    expect(normalizeErrorEvent({ error: null, message: undefined }).message).toBe("Unknown error");
    expect(normalizeErrorEvent({}).message).toBe("Unknown error");
  });
  it("normalizeErrorEvent: non-Error truthy error is coerced, not lied about", () => {
    const out = normalizeErrorEvent({ error: "stringy error", message: "ignored" });
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("stringy error");
  });

  it("safeStringify never throws on circular / exotic input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => safeStringify(circular)).not.toThrow();
    expect(typeof safeStringify(circular)).toBe("string");
    expect(safeStringify("already a string")).toBe("already a string");
  });
});

describe("dedup / 24h throttle", () => {
  it("recentlySent is false until recorded, true within 24h, false after", () => {
    const key = "k1";
    const t0 = 1_000_000_000_000;
    expect(recentlySent(key, t0)).toBe(false);
    recordSent(key, t0);
    expect(recentlySent(key, t0 + 60_000)).toBe(true);          // 1 min later → suppressed
    expect(recentlySent(key, t0 + 23 * 3600_000)).toBe(true);   // 23h → still suppressed
    expect(recentlySent(key, t0 + 25 * 3600_000)).toBe(false);  // 25h → allowed again
  });
});

describe("claimCrashSlot — dedup + session cap", () => {
  it("sends a distinct crash once, then suppresses within 24h", () => {
    const err = realError();
    const t0 = 2_000_000_000_000;
    const key = claimCrashSlot(err, t0);
    expect(key).toBe(computeErrorKey(err.message, err.stack)); // group tag == signature
    expect(claimCrashSlot(err, t0 + 3600_000)).toBeNull();     // same error, 1h later → suppressed
    expect(claimCrashSlot(err, t0 + 25 * 3600_000)).not.toBeNull(); // 25h later → allowed
  });

  it("honors the per-session cap of 5 across DISTINCT crashes", () => {
    const t0 = 3_000_000_000_000;
    for (let n = 0; n < 5; n++) {
      expect(claimCrashSlot(realError(`distinct error ${n}`), t0)).not.toBeNull();
    }
    // 6th distinct crash in the same session is capped even though it's new
    expect(claimCrashSlot(realError("distinct error 6"), t0)).toBeNull();
    // a fresh session lifts the cap
    resetCrashReportSession();
    expect(claimCrashSlot(realError("distinct error 6"), t0)).not.toBeNull();
  });
});

describe("reportCrash never throws", () => {
  it("no-ops safely when disabled / noise / null", () => {
    localStorage.setItem(CRASH_REPORTS_ENABLED_KEY, "false");
    expect(() => reportCrash(realError())).not.toThrow();
    localStorage.removeItem(CRASH_REPORTS_ENABLED_KEY);
    expect(() => reportCrash(new Error("WebSocket is not open"))).not.toThrow();
    // @ts-expect-error — defensive: reporter is called from a catch handler
    expect(() => reportCrash(null)).not.toThrow();
  });
});

describe("anonymous reporter identity", () => {
  it("mints a stable, persisted, nip44-capable throwaway key", async () => {
    const r1 = await getAnonReporter();
    expect(r1.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof r1.signer.nip44.encrypt).toBe("function");
    expect(typeof r1.signer.nip44.decrypt).toBe("function");

    // persisted as hex, and reused (stable) on the next call
    const hex = localStorage.getItem(CRASH_REPORTER_SK_KEY);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    const r2 = await getAnonReporter();
    expect(r2.pubkey).toBe(r1.pubkey);
  });

  it("reloads the SAME identity from storage after a cache drop (per-install stable)", async () => {
    const r1 = await getAnonReporter();
    const hex = localStorage.getItem(CRASH_REPORTER_SK_KEY)!;
    __resetAnonReporterCache(); // simulate a fresh page load
    const r3 = await getAnonReporter();
    expect(r3.pubkey).toBe(r1.pubkey);
    // and it truly derives from the stored secret, not a re-mint
    expect(await PrivateKeySigner.fromKey(hex).getPublicKey()).toBe(r1.pubkey);
  });
});

// The captured route (attached to BOTH crash reports and human feedback) must
// never carry the URL #fragment — Concord invite secrets ride in the hash, so an
// auto-filed crash on an invite link would otherwise exfiltrate the secret.
// SAFE_ROUTE lives in nip34-feedback.ts (shared by both paths). node test env has
// no window, so we shim window.location to exercise the real (new URL) path.
describe("SAFE_ROUTE / captureContext drop the URL #fragment (invite secrets)", () => {
  const savedWindow = (globalThis as any).window;
  afterEach(() => {
    if (savedWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = savedWindow;
  });

  it("SAFE_ROUTE strips a secret-bearing hash (main path)", () => {
    (globalThis as any).window = { location: { origin: "https://app.example" } };
    const route = SAFE_ROUTE("/outposts/c/x#invite=SUPERSECRET");
    expect(route).toBe("/outposts/c/x");
    expect(route).not.toContain("SUPERSECRET");
    expect(route).not.toContain("#");
  });

  it("SAFE_ROUTE masks a bech32 id in the path AND drops the hash", () => {
    (globalThis as any).window = { location: { origin: "https://app.example" } };
    const route = SAFE_ROUTE("/u/npub1" + "q".repeat(40) + "#invite=SUPERSECRET");
    expect(route).toBe("/u/<id>");
    expect(route).not.toContain("SUPERSECRET");
    expect(route).not.toContain("#");
  });

  it("SAFE_ROUTE catch fallback drops BOTH query and hash", () => {
    delete (globalThis as any).window; // no window → new URL throws → catch branch
    const route = SAFE_ROUTE("/outposts/c/x?token=T#invite=SUPERSECRET");
    expect(route).toBe("/outposts/c/x");
    expect(route).not.toContain("SUPERSECRET");
    expect(route).not.toContain("#");
    expect(route).not.toContain("token");
  });

  it("captureContext never captures the location hash", () => {
    (globalThis as any).window = {
      location: { origin: "https://app.example", pathname: "/outposts/c/x", hash: "#invite=SUPERSECRET" },
      innerWidth: 390,
      innerHeight: 844,
    };
    const ctx = captureContext("anon");
    expect(ctx.route).toBe("/outposts/c/x");
    expect(ctx.route).not.toContain("SUPERSECRET");
    expect(ctx.route).not.toContain("#");
  });
});

// A minimal FeedbackIssue: the grouping helpers only touch event.id/tags,
// contextBlock.route, and latestActivityAt.
function crashIssue(o: { id: string; sig?: string; route?: string | null; at: number; crash?: boolean }): FeedbackIssue {
  const tags: string[][] = [];
  if (o.crash !== false) tags.push(["t", CRASH_TYPE]);
  if (o.sig) tags.push([CRASH_SIG_TAG, o.sig]);
  return {
    event: { id: o.id, tags } as any,
    contextBlock: o.route !== undefined ? ({ route: o.route } as any) : undefined,
    latestActivityAt: o.at,
  } as FeedbackIssue;
}

describe("isCrashIssue — separates auto crash reports from real feedback", () => {
  it("is true only when the ['t','crash'] topic tag is present", () => {
    expect(isCrashIssue(crashIssue({ id: "x", at: 1 }))).toBe(true);
    expect(isCrashIssue(crashIssue({ id: "y", at: 1, crash: false }))).toBe(false);
  });
});

describe("groupCrashesBySig — collapse occurrences by signature", () => {
  it("groups by crash-sig, counts occurrences, and keeps the latest per group", () => {
    const groups = groupCrashesBySig([
      crashIssue({ id: "a1", sig: "sigA", route: "/feed", at: 100 }),
      crashIssue({ id: "a2", sig: "sigA", route: "/feed", at: 300 }),
      crashIssue({ id: "b1", sig: "sigB", route: "/news", at: 200 }),
    ]);
    expect(groups.map((g) => g.sig)).toEqual(["sigA", "sigB"]); // newest activity first
    const a = groups.find((g) => g.sig === "sigA")!;
    expect(a.count).toBe(2);
    expect(a.latest.event.id).toBe("a2"); // the newer occurrence
    expect(a.route).toBe("/feed");
  });

  it("falls back to the event id when a crash carries no signature", () => {
    const groups = groupCrashesBySig([crashIssue({ id: "lonely", at: 5 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sig).toBe("lonely");
  });

  it("the latest occurrence's route wins; a group keeps a route it has seen", () => {
    const groups = groupCrashesBySig([
      crashIssue({ id: "n1", sig: "s", route: null, at: 500 }), // newest, no route
      crashIssue({ id: "o1", sig: "s", route: "/old", at: 100 }),
    ]);
    expect(groups[0].route).toBe("/old"); // filled from the older occurrence
  });
});

describe("crash status = the ticket's status (one source of truth)", () => {
  it("maps the NIP-34 lifecycle onto the crash vocabulary, round-trip", () => {
    const pairs: Array<[FeedbackIssue["status"], CrashStatus]> = [
      ["open", "new"],
      ["draft", "investigating"],
      ["resolved", "fixed"],
      ["closed", "ignored"],
    ];
    for (const [wire, crash] of pairs) {
      expect(crashStatusFromIssueStatus(wire)).toBe(crash);
      expect(issueStatusForCrashStatus(crash)).toBe(wire);
    }
  });

  it("deriveCrashStatuses reads each group's latest ticket status", () => {
    const closed = { ...crashIssue({ id: "a1", sig: "sA", at: 5 }), status: "closed" } as FeedbackIssue;
    const open = { ...crashIssue({ id: "b1", sig: "sB", at: 4 }), status: "open" } as FeedbackIssue;
    const groups = groupCrashesBySig([closed, open]);
    expect(deriveCrashStatuses(groups)).toEqual({ sA: "ignored", sB: "new" });
  });
});

describe("tallyCrashStatuses — the numbers behind the filter chips", () => {
  it("counts groups per status and defaults untouched groups to 'new'", () => {
    const groups = groupCrashesBySig([
      crashIssue({ id: "1", sig: "s1", at: 1 }),
      crashIssue({ id: "2", sig: "s2", at: 2 }),
      crashIssue({ id: "3", sig: "s3", at: 3 }),
    ]);
    const statuses: Record<string, CrashStatus> = { s1: "fixed", s2: "investigating" }; // s3 untouched
    expect(tallyCrashStatuses(groups, statuses)).toEqual({ new: 1, investigating: 1, fixed: 1, ignored: 0 });
  });
});
