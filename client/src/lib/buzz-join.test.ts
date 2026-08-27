import { describe, it, expect } from "vitest";
import { claimBuzzInvite, isBuzzCommunityHost } from "./buzz-join";

// A signer that "signs" by attaching a fake sig — enough to prove what we
// would have sent, without a key ceremony in the test.
const fakeSigner = {
  signEvent: async (t: any) => ({ ...t, id: "e".repeat(64), pubkey: "p".repeat(64), sig: "s".repeat(128) }),
};

function decodeAuth(header: string): any {
  expect(header.startsWith("Nostr ")).toBe(true);
  return JSON.parse(atob(header.slice(6)));
}

describe("isBuzzCommunityHost", () => {
  it("matches only *.communities.buzz.xyz relays", () => {
    expect(isBuzzCommunityHost("wss://buzzbuild.communities.buzz.xyz")).toBe(true);
    expect(isBuzzCommunityHost("wss://buzzbuild.communities.buzz.xyz/")).toBe(true);
    expect(isBuzzCommunityHost("wss://relay.damus.io")).toBe(false);
    expect(isBuzzCommunityHost("wss://evil.communities.buzz.xyz.attacker.com")).toBe(false);
    expect(isBuzzCommunityHost("not a url")).toBe(false);
  });
});

describe("claimBuzzInvite (Buzz's HTTP invite-claim door)", () => {
  it("claims with a NIP-98-signed POST whose payload tag covers the body", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchFn = async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ status: "joined", community_id: "x" }) } as any;
    };
    const got = await claimBuzzInvite({
      relayUrl: "wss://buzzbuild.communities.buzz.xyz",
      code: "v2.6-abc",
      io: { fetchFn, signer: fakeSigner },
    });
    expect(got).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://buzzbuild.communities.buzz.xyz/api/invites/claim");
    expect(JSON.parse(calls[0].init.body)).toEqual({ code: "v2.6-abc" });
    const ev = decodeAuth(calls[0].init.headers["Authorization"]);
    expect(ev.kind).toBe(27235);
    expect(ev.tags).toContainEqual(["u", "https://buzzbuild.communities.buzz.xyz/api/invites/claim"]);
    expect(ev.tags).toContainEqual(["method", "POST"]);
    // payload = sha256 hex of the exact body bytes (the relay verifies this).
    const payload = ev.tags.find((t: string[]) => t[0] === "payload");
    expect(payload?.[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts the join policy first and forwards the receipt when acceptance is given", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchFn = async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.endsWith("/api/invites/accept-policy")) {
        return { ok: true, status: 200, json: async () => ({ receipt: "r-123" }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ status: "joined" }) } as any;
    };
    const got = await claimBuzzInvite({
      relayUrl: "wss://buzzbuild.communities.buzz.xyz",
      code: "v2.6-abc",
      acceptance: { policyVersion: "pv-9", ageConfirmed: true },
      io: { fetchFn, signer: fakeSigner },
    });
    expect(got).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([
      "https://buzzbuild.communities.buzz.xyz/api/invites/accept-policy",
      "https://buzzbuild.communities.buzz.xyz/api/invites/claim",
    ]);
    expect(JSON.parse(calls[0].init.body)).toEqual({ code: "v2.6-abc", policy_version: "pv-9", age_confirmed: true });
    expect(JSON.parse(calls[1].init.body)).toEqual({ code: "v2.6-abc", policy_receipt: "r-123" });
  });

  it("surfaces the relay's error in human words — an invalid code is not a crash", async () => {
    const fetchFn = async () =>
      ({ ok: false, status: 403, json: async () => ({ error: "invite_invalid" }) }) as any;
    const got = await claimBuzzInvite({
      relayUrl: "wss://buzzbuild.communities.buzz.xyz",
      code: "v2.6-stale",
      io: { fetchFn, signer: fakeSigner },
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error).toBe("That invite isn't valid anymore — ask the community for a fresh one.");
  });

  it("reports policy_required so the caller can show the consent step", async () => {
    const fetchFn = async () =>
      ({ ok: false, status: 403, json: async () => ({ error: "join_policy_required" }) }) as any;
    const got = await claimBuzzInvite({
      relayUrl: "wss://buzzbuild.communities.buzz.xyz",
      code: "v2.6-abc",
      io: { fetchFn, signer: fakeSigner },
    });
    expect(got).toMatchObject({ ok: false, policyRequired: true });
  });

  it("is reach-honest: a network failure says unreachable, never 'refused'", async () => {
    const fetchFn = async () => { throw new Error("Failed to fetch"); };
    const got = await claimBuzzInvite({
      relayUrl: "wss://buzzbuild.communities.buzz.xyz",
      code: "v2.6-abc",
      io: { fetchFn, signer: fakeSigner },
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error).toContain("Couldn't reach");
  });
});
