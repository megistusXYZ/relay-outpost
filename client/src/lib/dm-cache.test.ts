import { describe, it, expect } from "vitest";
import { isLeakedInviteBundleJson } from "./dm-cache";

// The leak this guards against: a kind-3313 Concord direct invite decrypted by
// a DM path and cached as message text — its JSON contains community_root
// (secret key material) and must be purged on load, never re-cached.
describe("isLeakedInviteBundleJson", () => {
  const bundle = {
    community_id: "aa".repeat(32),
    owner: "bb".repeat(32),
    owner_salt: "cc".repeat(32),
    community_root: "dd".repeat(32),
    root_epoch: 0,
    channels: [{ id: "ee".repeat(32), epoch: 0, name: "general" }],
    relays: ["wss://relay.damus.io"],
    name: "Secret Base",
  };

  it("matches a cached invite-bundle JSON payload", () => {
    expect(isLeakedInviteBundleJson(JSON.stringify(bundle))).toBe(true);
  });

  it("matches with leading whitespace", () => {
    expect(isLeakedInviteBundleJson("  \n" + JSON.stringify(bundle))).toBe(true);
  });

  it("ignores normal chat text, even text mentioning the fields", () => {
    expect(isLeakedInviteBundleJson("hey, want to join my outpost?")).toBe(false);
    expect(isLeakedInviteBundleJson('the fields are "community_root" and "community_id", fyi')).toBe(false);
  });

  it("ignores an invite LINK message (no JSON payload)", () => {
    expect(isLeakedInviteBundleJson("https://relayop.xyz/invite/naddr1abc#BAADtoken")).toBe(false);
  });

  it("ignores JSON without the secret key material", () => {
    expect(isLeakedInviteBundleJson(JSON.stringify({ community_id: "x", name: "not an invite" }))).toBe(false);
  });

  it("ignores empty / null content", () => {
    expect(isLeakedInviteBundleJson("")).toBe(false);
    expect(isLeakedInviteBundleJson(null)).toBe(false);
    expect(isLeakedInviteBundleJson(undefined)).toBe(false);
  });
});
