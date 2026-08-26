// @vitest-environment node
/**
 * The app signer must win, and a local-key user must not be treated as signed out.
 *
 * Both halves are load-bearing and both have been broken in production:
 *
 *  - `window.nostr` exists ONLY for NIP-07 extension users. Three functions in
 *    outpost-relays.ts opened with `if (!window.nostr) return false`, so for a
 *    local-key or PWA account they returned false and published nothing — the
 *    joined-communities list lived in localStorage and nowhere else, and an
 *    account switch took it. Found 2026-08-03 when a real join produced no
 *    kind-10073 at all.
 *  - An extension may be installed and unlocked as a DIFFERENT identity than
 *    the one the UI is showing. Signing as the wrong person is worse than not
 *    signing, so the app's own signer takes precedence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const appSigner = { signEvent: vi.fn(), getPublicKey: vi.fn().mockResolvedValue("a".repeat(64)) };
let currentGlobal: unknown = null;

vi.mock("./nip42-auth", () => ({ getGlobalSigner: () => currentGlobal }));

import { resolveSessionSigner, resolveSessionPubkey } from "./session-signer";

beforeEach(() => { currentGlobal = null; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("resolveSessionSigner", () => {
  it("finds a local-key user, who has no window.nostr at all", () => {
    // The whole bug: this used to be indistinguishable from signed-out.
    currentGlobal = appSigner;
    expect(resolveSessionSigner()).toBe(appSigner);
  });

  it("falls back to a NIP-07 extension when there is no app signer", () => {
    const ext = { signEvent: vi.fn(), getPublicKey: vi.fn() };
    vi.stubGlobal("window", { nostr: ext });
    expect(resolveSessionSigner()).toBe(ext);
  });

  it("prefers the APP signer over an extension — signing as the wrong identity is worse than not signing", () => {
    const otherIdentity = { signEvent: vi.fn(), getPublicKey: vi.fn() };
    vi.stubGlobal("window", { nostr: otherIdentity });
    currentGlobal = appSigner;
    expect(resolveSessionSigner()).toBe(appSigner);
  });

  it("returns null only when nobody is signed in", () => {
    vi.stubGlobal("window", {});
    expect(resolveSessionSigner()).toBeNull();
  });
});

describe("resolveSessionPubkey", () => {
  it("reads the pubkey from whichever signer answered", async () => {
    currentGlobal = appSigner;
    expect(await resolveSessionPubkey()).toBe("a".repeat(64));
  });

  it("never throws when the signer rejects — callers treat null as signed out", async () => {
    currentGlobal = { signEvent: vi.fn(), getPublicKey: vi.fn().mockRejectedValue(new Error("locked")) };
    await expect(resolveSessionPubkey()).resolves.toBeNull();
  });

  it("is null when nobody is signed in", async () => {
    vi.stubGlobal("window", {});
    expect(await resolveSessionPubkey()).toBeNull();
  });
});
