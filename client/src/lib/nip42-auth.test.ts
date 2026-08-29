// Regression guard for the DM-delivery AUTH bug: the client refused to NIP-42
// authenticate to a recipient's auth-required inbox relay (auth.nostr1.com), so
// gift-wrapped DMs never reached it. The pool's automaticallyAuth hook only arms a
// relay's onauth when shouldAutoAuth() is true — which it wasn't for relays that
// aren't the user's own. allowAuthForPublish() opens that gate, scoped to deliberate
// publishes.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPoolAuthHandler, createTemplateScopedAuthHandler, allowAuthForPublish, setGlobalSigner, setOwnDMInboxProvider, shouldAutoAuth } from "./nip42-auth";

const mockSigner = {
  async getPublicKey() {
    return "a".repeat(64);
  },
  async signEvent(e: unknown) {
    return { ...(e as object), id: "f".repeat(64), sig: "0".repeat(128), pubkey: "a".repeat(64) };
  },
} as never;

describe("scoped NIP-42 auto-AUTH gate", () => {
  beforeEach(() => setGlobalSigner(mockSigner));

  it("refuses to auto-AUTH an arbitrary relay (e.g. a recipient's inbox) by default", () => {
    const handler = createPoolAuthHandler();
    expect(handler("wss://recipient-inbox-1.example")).toBeNull();
  });

  it("shouldAutoAuth is false for a relay the user hasn't opted into (ops-center count gate)", () => {
    // The hand-rolled COUNT path in relay-ops consults this directly, so a
    // crafted /relay-ops-center/<attacker-relay> link can't harvest a signed
    // 22242. A relay opted in for a publish flips it true (proven below).
    const attacker = "wss://attacker-relay.example";
    expect(shouldAutoAuth(attacker)).toBe(false);
    allowAuthForPublish([attacker]);
    expect(shouldAutoAuth(attacker)).toBe(true);
  });

  it("the publish auth grant expires — no permanent passive-read leak", () => {
    vi.useFakeTimers();
    try {
      const inbox = "wss://recipient-inbox-ttl.example";
      allowAuthForPublish([inbox]);
      expect(shouldAutoAuth(inbox)).toBe(true);
      vi.advanceTimersByTime(61_000);
      expect(shouldAutoAuth(inbox)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-AUTHs a relay once it is cleared for a deliberate publish", () => {
    const url = "wss://recipient-inbox-2.example";
    const handler = createPoolAuthHandler();
    expect(handler(url)).toBeNull();
    allowAuthForPublish([url]);
    expect(typeof handler(url)).toBe("function");
  });

  it("never auto-AUTHs without a signer, even when cleared", () => {
    const url = "wss://recipient-inbox-3.example";
    allowAuthForPublish([url]);
    setGlobalSigner(null);
    const handler = createPoolAuthHandler();
    expect(handler(url)).toBeNull();
  });
});

describe("scoped auto-AUTH for the user's own DM inbox (P2 receive-side)", () => {
  beforeEach(() => {
    setGlobalSigner(mockSigner);
    setOwnDMInboxProvider(() => []); // reset between tests
  });

  it("auto-AUTHs a relay the user designated as their own DM inbox", () => {
    setOwnDMInboxProvider(() => ["wss://auth.nostr1.com"]);
    const handler = createPoolAuthHandler();
    expect(typeof handler("wss://auth.nostr1.com")).toBe("function");
  });

  it("does NOT auto-AUTH a relay that isn't in the user's own inbox", () => {
    setOwnDMInboxProvider(() => ["wss://auth.nostr1.com"]);
    const handler = createPoolAuthHandler();
    expect(handler("wss://someone-elses-inbox.example")).toBeNull();
  });

  it("matches own-inbox relays regardless of trailing slash / normalization", () => {
    setOwnDMInboxProvider(() => ["wss://inbox.nostr.wine/"]);
    const handler = createPoolAuthHandler();
    expect(typeof handler("wss://inbox.nostr.wine")).toBe("function");
  });

  it("goes back to refusing once the inbox set is cleared", () => {
    setOwnDMInboxProvider(() => ["wss://auth.nostr1.com"]);
    const handler = createPoolAuthHandler();
    expect(typeof handler("wss://auth.nostr1.com")).toBe("function");
    setOwnDMInboxProvider(() => []);
    expect(handler("wss://auth.nostr1.com")).toBeNull();
  });
});

/**
 * A multi-relay read gets ONE onauth for the whole set, which is the wrong
 * shape for a per-relay gate. The template-scoped handler exists so the DM
 * history query can authenticate to the user's own auth-gated inbox WITHOUT
 * offering their pubkey to every other relay in the same call.
 *
 * The gate is the point. Getting this wrong would not look like a bug — the
 * DMs would arrive — it would silently announce the user to relays they never
 * opted into.
 */
describe("template-scoped auto-AUTH across a multi-relay read", () => {
  const OWN_INBOX = "wss://auth.nostr1.com";
  const STRANGER = "wss://someone-elses-inbox.example";
  const authTemplate = (relayUrl: string) => ({
    kind: 22242,
    created_at: 0,
    content: "",
    tags: [["relay", relayUrl], ["challenge", "abc"]],
  }) as never;

  beforeEach(() => {
    setGlobalSigner(mockSigner);
    setOwnDMInboxProvider(() => [OWN_INBOX]);
  });

  it("signs for the user's own inbox relay", async () => {
    const onauth = createTemplateScopedAuthHandler();
    await expect(onauth(authTemplate(OWN_INBOX))).resolves.toMatchObject({ kind: 22242 });
  });

  it("REFUSES a relay outside the gate, even in the same read — the leak", async () => {
    const onauth = createTemplateScopedAuthHandler();
    await expect(onauth(authTemplate(STRANGER))).rejects.toThrow(/auth not enabled/);
  });

  it("decides per challenge, so one set can contain both", async () => {
    // The whole reason this is template-scoped rather than bound at creation.
    const onauth = createTemplateScopedAuthHandler();
    await expect(onauth(authTemplate(OWN_INBOX))).resolves.toBeTruthy();
    await expect(onauth(authTemplate(STRANGER))).rejects.toThrow();
  });

  it("refuses when the template names no relay at all", async () => {
    const onauth = createTemplateScopedAuthHandler();
    await expect(onauth({ kind: 22242, created_at: 0, content: "", tags: [] } as never))
      .rejects.toThrow(/auth not enabled/);
  });

  it("refuses everything once the signer is gone", async () => {
    setGlobalSigner(null);
    const onauth = createTemplateScopedAuthHandler();
    await expect(onauth(authTemplate(OWN_INBOX))).rejects.toThrow(/auth not enabled/);
  });
});
