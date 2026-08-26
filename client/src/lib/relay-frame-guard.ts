// Guard against nostr-tools' self-crashing WebSocket message handler.
//
// nostr-tools 2.23.1 AbstractRelay._onmessage wraps its frame handling in
// try/catch — but the CATCH block itself starts with an unguarded re-parse of
// the same payload:
//
//     } catch (err) {
//       const [_, __, event] = JSON.parse(json);   // ← throws again
//       window.printer.maybe(event.pubkey, ...);
//     }
//
// So when a relay delivers a malformed or truncated frame, the initial
// JSON.parse throws, control lands in the catch, and the re-parse throws the
// SAME SyntaxError ("JSON Parse error: Unterminated string" on WebKit) — this
// time OUT of the catch, escaping the WebSocket onmessage handler as an
// uncaught window "error" (live crash-sig 1ekh2ng). The window.printer.maybe
// shim in main.tsx cannot help here: the re-parse throws before printer is
// ever reached. The same catch also crashes on any non-array/non-EVENT payload
// (event is undefined → event.pubkey throws) and on binary frames (Blob.data
// has no .indexOf for getSubscriptionId).
//
// A malformed frame carries no usable data — the vendor catch would only have
// logged and dropped it anyway — so the correct behavior is: drop the frame,
// log for debugging, never throw. AbstractRelay isn't exported from
// "nostr-tools"'s root entry (which is what lib/nostr.ts's SimplePool uses),
// but the exported Relay extends it, so the shared prototype is reachable via
// Object.getPrototypeOf(Relay.prototype).
//
// Installed once from main.tsx, next to the printer shim. Remove both when a
// nostr-tools upgrade ships a sane catch block — the "vendor bug still exists"
// test in relay-frame-guard.test.ts will fail loudly when that day comes.

import { Relay } from "nostr-tools";
import { recordAuthVerdict } from "./nip42-auth";

let installed = false;

/**
 * The vendor's own methods, captured on the FIRST install and reused forever.
 *
 * Without this, a second install (the test reset hook does exactly that) wraps
 * the already-wrapped function: `originalAuth` becomes our own patch, so what
 * it returns is our wrapper rather than the relay's `authPromise`, and every
 * identity check against the memo silently stops matching. Nested wrappers
 * would also double every verdict we record.
 */
let pristineOnMessage: ((ev: MessageEvent) => void) | undefined;
let pristineAuth: ((signer: unknown) => Promise<string>) | undefined;

/** Test hook: lets the test file exercise a fresh install. */
export function __resetRelayFrameGuardForTests(): void {
  installed = false;
}

export function installRelayFrameGuard(): void {
  if (installed) return;
  try {
    // AbstractRelay.prototype — the prototype SimplePool's relay instances use.
    const proto = Object.getPrototypeOf(Relay.prototype) as {
      _onmessage?: (ev: MessageEvent) => void;
      auth?: (signer: unknown) => Promise<string>;
      url?: string;
    } | null;
    pristineOnMessage = pristineOnMessage || proto?._onmessage;
    const original = pristineOnMessage;
    if (typeof original !== "function") return; // internals changed — do nothing
    proto!._onmessage = function (this: { url?: string }, ev: MessageEvent) {
      try {
        original.call(this, ev);
      } catch (err) {
        // Malformed/truncated/binary relay frame (or a throw from the vendor
        // catch block itself). Droppable noise — never let it escape to
        // window.onerror as a crash.
        try {
          console.debug("[nostr-tools] dropped malformed relay frame", this?.url, err);
        } catch {}
      }
    };

    // Second escape route, which the catch above structurally CANNOT cover: a
    // relay that declines our AUTH. The vendor's `case "AUTH"` runs
    // `this.auth(this.onauth)` and discards the promise; auth() parks
    // {resolve, reject} in openEventPublishes; the relay's
    // `OK <id> false "restricted: not a relay member"` then rejects a promise
    // nobody holds. That rejection is ASYNC, so it sails past the synchronous
    // catch and lands as an unhandled rejection — a full-screen error overlay
    // in dev, a crash report in prod. closeAllSubscriptions() rejects the same
    // map, so an ordinary disconnect takes this path too.
    //
    // Attaching a no-op handler marks the promise handled without consuming it:
    // auth() memoizes into this.authPromise and we return that same promise, so
    // any caller that genuinely awaits authentication still sees the rejection
    // and its reason. Being turned away is a normal answer from a relay we are
    // not a member of — not a crash.
    // This is also the ONLY always-on observation point for the relay's AUTH
    // verdict anywhere in the app, so as well as marking the rejection handled
    // we record it. Until we did, the one sentence that explains an empty
    // screen — the relay's own "restricted: …" — was logged at debug level and
    // dropped, and nip42-auth went on reporting a refusal as a success.
    //
    // Prototype-level, so this covers every relay and every caller at once,
    // including the ones that never pass `onauth`.
    // Third escape route, and the nastiest: a signer that THROWS wedges the
    // relay permanently. The vendor's auth() is
    //
    //     this.authPromise = new Promise(async (resolve, reject) => {
    //       try { let evt = await signAuthEvent(...); ... }
    //       catch (err) { console.warn("subscribe auth function failed:", err) }
    //     })
    //
    // — the catch neither resolves nor rejects, so that promise never settles,
    // and `if (this.authPromise) return this.authPromise` hands the same dead
    // promise to every later attempt. Measured: a throwing signer, then a
    // PERFECTLY GOOD signer on the same relay, both NEVER SETTLED.
    //
    // Our signers throw by design — openPersistentSub for an ungated relay,
    // createTemplateScopedAuthHandler for a relay outside the per-relay gate —
    // and refusing to authenticate somewhere must not disable authenticating
    // there ever again. So: detect a signer-side throw, drop the memo so the
    // next challenge gets a fresh attempt, and settle the promise we handed out
    // instead of leaving callers (and subscribeMany's re-auth `.then`) hanging.
    // Promises the vendor abandoned: our signer threw, its catch swallowed the
    // error, and nothing will ever settle them. Identified by object rather
    // than by comparing against the current memo, because the pool's own
    // auto-auth can replace `authPromise` between the throw and our cleanup —
    // and then a straight `=== p` check quietly does nothing, which is exactly
    // what the first attempt at this fix did.
    const deadAuthPromises = new WeakSet<object>();
    pristineAuth = pristineAuth || proto!.auth;
    const originalAuth = pristineAuth;
    if (typeof originalAuth === "function") {
      proto!.auth = function (this: { url?: string; authPromise?: unknown }, signer: unknown) {
        const url = this?.url;
        // Heal on the way IN: whatever happened last time, a dead memo must not
        // be handed to this attempt. Order-independent, so it works even if the
        // throw and the cleanup interleaved badly.
        if (this.authPromise && deadAuthPromises.has(this.authPromise as object)) {
          this.authPromise = undefined;
        }
        let signerThrew = false;
        let reportSignerThrow: (err: Error) => void = () => {};
        const signerFailed = new Promise<Error>((resolve) => { reportSignerThrow = resolve; });

        const guardedSigner =
          typeof signer === "function"
            ? async (evt: unknown) => {
                try {
                  return await (signer as (e: unknown) => Promise<unknown>)(evt);
                } catch (err) {
                  signerThrew = true;
                  const e = err instanceof Error ? err : new Error(String(err));
                  reportSignerThrow(e);
                  throw e;
                }
              }
            : signer;

        const p = originalAuth.call(this, guardedSigner);
        if (!p || typeof p.then !== "function") return p;
        // The relay's OWN memo for this attempt, read off the relay rather than
        // assumed to be what auth() returned. That assumption is what a wrapped
        // auth() quietly breaks.
        const memoForThisAttempt = this.authPromise;

        const guarded = new Promise<string>((resolve, reject) => {
          p.then(
            (value: unknown) => {
              if (url) recordAuthVerdict(url, true);
              resolve(value as string);
            },
            (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              try {
                console.debug("[nostr-tools] relay declined AUTH", url, err);
              } catch {}
              // A throw from OUR signer is not the relay's verdict. Recording it
              // as one would report "the relay declined our sign-in" about a
              // relay that never got asked. recordAuthVerdict also discriminates
              // ordinary disconnects and the 15s timeout, which reject here too.
              if (url && !signerThrew) recordAuthVerdict(url, false, message);
              reject(err);
            },
          );
          signerFailed.then((err) => {
            // Mark it dead so the next attempt heals on the way in, and clear it
            // now if it is still the current memo. Never stomp a newer, live
            // attempt — the marking is what makes that safe.
            if (memoForThisAttempt) deadAuthPromises.add(memoForThisAttempt as object);
            if (this.authPromise === memoForThisAttempt) this.authPromise = undefined;
            reject(err);
          });
        });

        // Same reason the guard exists at all: a rejection nobody awaited must
        // not surface as an unhandled rejection. Callers that do await still
        // get their own copy of the outcome.
        guarded.catch(() => {});
        return guarded;
      };
    }
    installed = true;
  } catch {
    // Hardening must never break startup.
  }
}
