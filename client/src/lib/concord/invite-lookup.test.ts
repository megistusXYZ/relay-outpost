import { describe, it, expect } from "vitest";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { classifyInviteFetch, bundleToDisplay } from "./invite-resolve";
import { encryptBundle, type InviteBundle } from "./concord-invites";
import { KIND_INVITE_BUNDLE, VSK } from "./concord-events";

const bundle: InviteBundle = {
  community_id: "aa".repeat(32), owner: "bb".repeat(32), owner_salt: "cc".repeat(32), community_root: "dd".repeat(32),
  root_epoch: 0, channels: [], relays: ["wss://relay.example"], name: "Book Club",
};
const linkSk = generateSecretKey();
const token = new Uint8Array(16).fill(5);
const live = (b: InviteBundle) =>
  finalizeEvent({ kind: KIND_INVITE_BUNDLE, created_at: 1, tags: [["d", ""], ["vsk", String(VSK.INVITE)]], content: encryptBundle(b, token) }, linkSk);
const NOW = 1_800_000_000_000;

describe("what an invite lookup found (CORD-05 §2)", () => {
  it("says we never reached a relay, rather than that the invite is gone", () => {
    expect(classifyInviteFetch({ reached: false, event: null }, token, NOW)).toEqual({ status: "unreachable" });
  });

  it("says the relays answered without it, which is not proof it was turned off", () => {
    expect(classifyInviteFetch({ reached: true, event: null }, token, NOW)).toEqual({ status: "missing" });
  });

  it("knows a turned-off link by its tombstone", () => {
    const tomb = finalizeEvent({ kind: KIND_INVITE_BUNDLE, created_at: 2, tags: [["d", ""], ["vsk", String(VSK.REVOKED)]], content: "" }, linkSk);
    expect(classifyInviteFetch({ reached: true, event: tomb }, token, NOW)).toEqual({ status: "revoked" });
  });

  it("calls a link whose secret doesn't open the bundle broken", () => {
    expect(classifyInviteFetch({ reached: true, event: live(bundle) }, new Uint8Array(16).fill(6), NOW)).toEqual({ status: "broken" });
  });

  it("still shows an expired invite, marked expired", () => {
    const out = classifyInviteFetch({ reached: true, event: live({ ...bundle, expires_at: NOW - 1 }) }, token, NOW);
    expect(out).toMatchObject({ status: "expired", bundle: { name: "Book Club" } });
  });

  it("opens a live invite", () => {
    expect(classifyInviteFetch({ reached: true, event: live({ ...bundle, expires_at: NOW + 1 }) }, token, NOW)).toMatchObject({ status: "ok", bundle: { name: "Book Club" } });
  });

  it("marks an expired invite on its card", () => {
    expect(bundleToDisplay({ ...bundle, label: "Flyer", expires_at: NOW - 1 }, NOW).subtitle).toBe("This invite has expired");
    expect(bundleToDisplay({ ...bundle, label: "Flyer", expires_at: NOW + 1 }, NOW).subtitle).toBe("Flyer");
  });
});
