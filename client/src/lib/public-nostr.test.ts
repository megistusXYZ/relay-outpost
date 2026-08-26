import { describe, it, expect } from "vitest";
import { publicNostrEnabled, publicNostrStorageKey, PUBLIC_NOSTR_OFF } from "./public-nostr";

// Decision 4 of the IA plan: "Public Nostr: off for new accounts, preserved for
// existing. The reduction shouldn't tax the people who already showed up."
//
// The whole risk of this flag lives in one default. Every account that predates
// it has no stored value, so UNSET MUST MEAN ON. Get it backwards and the feed
// silently disappears for everyone already using this as a Nostr client — the
// same shape as the kind-3 follow-list wipe, where an empty base was treated as
// an intentional state instead of an absent one.

describe("publicNostrEnabled — the grandfathering default", () => {
  it("treats an unset value as ON, because that account predates the flag", () => {
    expect(publicNostrEnabled(null)).toBe(true);
    expect(publicNostrEnabled(undefined)).toBe(true);
  });

  it("is off ONLY for an explicit opt-out", () => {
    expect(publicNostrEnabled(PUBLIC_NOSTR_OFF)).toBe(false);
  });

  it("is on for an explicit opt-in", () => {
    expect(publicNostrEnabled("1")).toBe(true);
  });

  it("fails OPEN on anything it doesn't recognise", () => {
    // Corrupt storage, a half-written value, a future encoding: none of those
    // are consent to remove someone's feed. Only "0" is.
    for (const junk of ["", " ", "false", "off", "no", "{}", "null", "0 "]) {
      expect(publicNostrEnabled(junk), `junk value ${JSON.stringify(junk)}`).toBe(true);
    }
  });
});

describe("publicNostrStorageKey — per account, never device-wide", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("gives two accounts two different keys", () => {
    // Device-wide storage would let creating a second account in the same
    // browser write "0" over the FIRST account's state, stripping the feed of
    // an existing user who never asked for it. Keying by pubkey removes that
    // class of clobber entirely.
    expect(publicNostrStorageKey(A)).not.toBe(publicNostrStorageKey(B));
  });

  it("is stable for the same account", () => {
    expect(publicNostrStorageKey(A)).toBe(publicNostrStorageKey(A));
  });

  it("has no key without a pubkey — a signed-out session stores nothing", () => {
    expect(publicNostrStorageKey(null)).toBeNull();
    expect(publicNostrStorageKey("")).toBeNull();
  });
});
