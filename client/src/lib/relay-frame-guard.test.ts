// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { Relay } from "nostr-tools";
import { installRelayFrameGuard, __resetRelayFrameGuardForTests } from "./relay-frame-guard";

// Regression for live crash-sig 1ekh2ng ("Uncaught error: JSON Parse error:
// Unterminated string"): nostr-tools 2.23.1's AbstractRelay._onmessage catch
// block re-runs JSON.parse on the same malformed frame, so a truncated relay
// frame threw OUT of the catch and escaped the WebSocket onmessage handler as
// an uncaught window error. relay-frame-guard wraps the handler so malformed
// frames are dropped instead. These tests drive the REAL nostr-tools class —
// no DOM, no sockets: _onmessage is called directly with fake message events.

type MessageHandler = (ev: { data: unknown }) => void;
const abstractProto = () =>
  Object.getPrototypeOf(Relay.prototype) as { _onmessage: MessageHandler };

// Node 20 (what CI runs) has no global WebSocket by default; Node 22+ (what we
// run locally) enables one. nostr-tools reads that global EAGERLY, in the
// constructor:
//
//     this._WebSocket = opts.websocketImplementation || WebSocket;
//                                                       ^^^^^^^^^ bare global
//     — node_modules/nostr-tools/lib/esm/index.js:632, `new AbstractRelay`
//
// so `new Relay(...)` alone is a ReferenceError on Node 20, long before any
// connect(). Relay spreads caller options AFTER its own defaults —
// `super(url, { verifyEvent, websocketImplementation: _WebSocket, ...options })`
// (index.js:1060) — so passing an implementation wins, short-circuits the `||`,
// and the global is never evaluated. That is version-independent: it behaves
// identically whether or not globalThis.WebSocket exists.
//
// (nostr-tools' `useWebSocketImplementation` cannot do this job here: the root
// "nostr-tools" bundle does not export it at all, and the copy under
// "nostr-tools/relay" is a separate module instance with its own AbstractRelay
// class — patching that prototype would miss the one relay-frame-guard.ts and
// these tests actually use.)
//
// These tests drive _onmessage/auth directly and never connect, so the class is
// only stored, never constructed. This one throws if that ever stops being
// true, so the "no sockets" claim in the header is enforced, not just asserted.
class NeverConstructedWebSocket {
  constructor() {
    throw new Error("relay-frame-guard tests must not open a socket");
  }
}
type RelayOptions = NonNullable<ConstructorParameters<typeof Relay>[1]> & {
  websocketImplementation: unknown;
};
const NO_SOCKET: RelayOptions = { websocketImplementation: NeverConstructedWebSocket };
const newRelay = () => new Relay("wss://example.relay/", NO_SOCKET);

function makeRelay(): { relay: Relay; notices: string[] } {
  const relay = newRelay();
  const notices: string[] = [];
  relay.onnotice = (msg: string) => notices.push(msg);
  return { relay, notices };
}

// A frame cut off mid-string — exactly what an interrupted relay write or a
// dropped connection delivers. WebKit reports the resulting SyntaxError as
// "JSON Parse error: Unterminated string".
const TRUNCATED_FRAME = '["NOTICE","half a mess';
// Valid JSON that is not a Nostr frame: the vendor catch destructures it as an
// array ([_, __, event]) and reads event.pubkey — both throw on this shape.
const NON_ARRAY_FRAME = '{"kind":1}';

describe("nostr-tools vendor bug (tripwire)", () => {
  it("unpatched _onmessage still throws on a truncated frame — retire relay-frame-guard when this fails", () => {
    const { relay } = makeRelay();
    const original = abstractProto()._onmessage;
    // Call the pristine vendor handler directly (the guard may already be
    // installed on the prototype by an earlier test run — bypass it).
    expect(() => original.call(relay, { data: TRUNCATED_FRAME })).toThrow(SyntaxError);
  });
});

describe("installRelayFrameGuard", () => {
  it("drops a truncated frame instead of throwing", () => {
    __resetRelayFrameGuardForTests();
    installRelayFrameGuard();
    const { relay } = makeRelay();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      expect(() => abstractProto()._onmessage.call(relay, { data: TRUNCATED_FRAME })).not.toThrow();
      expect(debug).toHaveBeenCalled();
    } finally {
      debug.mockRestore();
    }
  });

  it("drops valid-JSON-but-not-a-frame payloads (vendor catch destructure crash)", () => {
    installRelayFrameGuard();
    const { relay } = makeRelay();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      expect(() => abstractProto()._onmessage.call(relay, { data: NON_ARRAY_FRAME })).not.toThrow();
    } finally {
      debug.mockRestore();
    }
  });

  it("passes well-formed frames through to the vendor handler", () => {
    installRelayFrameGuard();
    const { relay, notices } = makeRelay();
    abstractProto()._onmessage.call(relay, { data: '["NOTICE","rate limited"]' });
    expect(notices).toEqual(["rate limited"]);
  });

  it("is idempotent — double install does not double-handle frames", () => {
    installRelayFrameGuard();
    installRelayFrameGuard();
    const { relay, notices } = makeRelay();
    abstractProto()._onmessage.call(relay, { data: '["NOTICE","once"]' });
    expect(notices).toEqual(["once"]);
  });
});

// A relay DECLINING our AUTH is a different escape route than a malformed
// frame, and the try/catch above structurally cannot catch it. nostr-tools'
// `case "AUTH"` calls `this.auth(this.onauth)` and throws the returned promise
// away; auth() parks {resolve, reject} in openEventPublishes; when the relay
// answers `OK <id> false "restricted: not a relay member"` the vendor calls
// ep.reject() on a promise NOBODY is holding. That is an async rejection, so it
// sails past a synchronous catch and lands as an unhandled rejection — a
// full-screen crash overlay in dev and a crash report in prod. Seen live
// against wss://relayop.communities.buzz.xyz. closeAllSubscriptions() rejects
// the same map, so an ordinary disconnect takes this path too.

/** The id our fake signer stamps, so we can address the parked publish. */
const AUTH_EVENT_ID = "a".repeat(64);
/** Let queued microtasks AND node's unhandled-rejection check run. */
const tick = () => new Promise((r) => setTimeout(r, 0));

type TestableRelay = Relay & {
  challenge?: string;
  send: (payload: string) => void;
  auth: (signer: (e: unknown) => Promise<unknown>) => Promise<string>;
};

/** A relay with no socket: `send` is captured, and a challenge is already in hand. */
function makeAuthableRelay(): TestableRelay {
  const relay = newRelay() as TestableRelay;
  relay.send = () => {};
  relay.challenge = "c0ffee";
  return relay;
}

const signsAs = async (e: unknown) => ({ ...(e as object), id: AUTH_EVENT_ID, sig: "00" });
const declineFrame = JSON.stringify([
  "OK",
  AUTH_EVENT_ID,
  false,
  "restricted: not a relay member",
]);

describe("relay declines our AUTH", () => {
  it("does not surface as an unhandled rejection", async () => {
    installRelayFrameGuard();
    const relay = makeAuthableRelay();
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      // Fire-and-forget, exactly as abstract-relay.js's `case "AUTH"` does.
      void relay.auth(signsAs);
      await tick();
      abstractProto()._onmessage.call(relay, { data: declineFrame });
      await tick();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("still reports the reason to a caller that awaits it", async () => {
    // Adopting the rejection must not swallow it: code that actually asked to
    // authenticate still needs to learn the relay said no, and why.
    installRelayFrameGuard();
    const relay = makeAuthableRelay();
    const settled = relay.auth(signsAs).then(
      () => "resolved",
      (err: Error) => err.message,
    );
    await tick();
    abstractProto()._onmessage.call(relay, { data: declineFrame });
    expect(await settled).toBe("restricted: not a relay member");
  });
});

/**
 * A signer that THROWS wedges the relay permanently.
 *
 * nostr-tools 2.23.1 auth():
 *
 *     this.authPromise = new Promise(async (resolve, reject) => {
 *       try { let evt = await signAuthEvent(...); ...; this.send(...) }
 *       catch (err) { console.warn("subscribe auth function failed:", err) }
 *     })
 *
 * The catch neither resolves nor rejects, so that promise never settles — and
 * `if (this.authPromise) return this.authPromise` hands the same dead promise
 * to every later attempt. Measured live against an auth-gated relay: a throwing
 * signer, then a PERFECTLY GOOD signer on the same relay, both NEVER SETTLED.
 *
 * This matters because our signers throw BY DESIGN for a relay outside the
 * per-relay auto-AUTH gate (openPersistentSub, createTemplateScopedAuthHandler).
 * Declining to authenticate somewhere must not disable authenticating there
 * ever again — allowAuthForPublish exists precisely to arm a relay mid-session.
 *
 * These drive the real vendor auth() with a hand-built `this`; no sockets.
 */
type FakeRelay = {
  url: string;
  challenge?: string;
  authPromise?: unknown;
  publishTimeout: number;
  openEventPublishes: Map<string, unknown>;
  send: (payload: string) => void;
  sent: string[];
};

function fakeRelay(): FakeRelay {
  const sent: string[] = [];
  return {
    url: "wss://wedge.example",
    challenge: "challenge-1",
    authPromise: undefined,
    publishTimeout: 10_000,
    openEventPublishes: new Map(),
    send(payload: string) { sent.push(payload); },
    sent,
  };
}

const signed = async () => ({ id: "a".repeat(64), sig: "0".repeat(128) }) as never;
const throwing = async () => { throw new Error("auth not enabled for this relay"); };

/** Did it settle within a generous microtask/timer budget? */
async function settles(p: unknown): Promise<"resolved" | "rejected" | "never"> {
  let out: "resolved" | "rejected" | "never" = "never";
  const tracked = Promise.resolve(p as Promise<unknown>).then(
    () => { out = "resolved"; },
    () => { out = "rejected"; },
  );
  await Promise.race([tracked, new Promise((r) => setTimeout(r, 50))]);
  return out;
}

describe("a throwing auth signer must not wedge the relay", () => {
  it("VENDOR BUG STILL EXISTS: unpatched auth() never settles and keeps the memo", async () => {
    // "nostr-tools/relay" is a SEPARATE module instance with its own
    // AbstractRelay, so its prototype is untouched by our guard — which makes it
    // the honest way to show the vendor behaviour we are compensating for.
    const { Relay: Unpatched } = await import("nostr-tools/relay");
    const vendorAuth = (Object.getPrototypeOf(Unpatched.prototype) as { auth: (s: unknown) => Promise<string> }).auth;

    const r = fakeRelay();
    const p = vendorAuth.call(r as never, throwing);
    (p as Promise<unknown>).catch(() => {});
    // THE vendor defect: the catch swallows the throw without resolving or
    // rejecting, so this promise is dead forever — and it is memoized onto the
    // relay, which is what makes it contagious to later attempts.
    expect(await settles(p)).toBe("never");
    expect(r.authPromise).toBeTruthy();
    // Nothing was sent, because the signer never produced an event.
    expect(r.sent).toHaveLength(0);
  });

  it("with the guard: a signer throw REJECTS instead of hanging forever", async () => {
    __resetRelayFrameGuardForTests();
    installRelayFrameGuard();
    const patched = abstractProto() as unknown as { auth: (s: unknown) => Promise<string> };

    const r = fakeRelay();
    const p = patched.auth.call(r as never, throwing);
    expect(await settles(p)).toBe("rejected");
  });

  it("with the guard: a later GOOD signer gets a fresh attempt, not the dead memo", async () => {
    __resetRelayFrameGuardForTests();
    installRelayFrameGuard();
    const patched = abstractProto() as unknown as { auth: (s: unknown) => Promise<string> };

    const r = fakeRelay();
    const first = patched.auth.call(r as never, throwing);
    (first as Promise<unknown>).catch(() => {});
    await settles(first);

    // The point of the whole fix: this must actually reach the relay.
    const second = patched.auth.call(r as never, signed);
    (second as Promise<unknown>).catch(() => {});
    await settles(second);
    expect(r.sent.length).toBeGreaterThan(0);
    expect(r.sent[0]).toContain('["AUTH"');
  });
});
