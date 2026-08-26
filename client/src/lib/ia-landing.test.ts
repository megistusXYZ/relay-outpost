import { describe, it, expect } from "vitest";
import { shouldLandOnChats, postAuthLandingPath, CHATS_PATH } from "./ia-landing";

const A = "a".repeat(64);
const base = {
  pubkey: A,
  collapsed: true,
  pathname: "/",
  search: "",
  hash: "",
  landed: false,
};

describe("shouldLandOnChats", () => {
  it("lands a signed-in person opening the app at the bare root", () => {
    expect(shouldLandOnChats(base)).toBe(true);
    expect(CHATS_PATH).toBe("/messages");
  });

  it("does nothing once the tab has already landed", () => {
    // This is what keeps Discover reachable: `/` is Discover's own path, so
    // after the first arrival the root must behave normally forever.
    expect(shouldLandOnChats({ ...base, landed: true })).toBe(false);
  });

  it("does nothing while the collapsed IA is off", () => {
    expect(shouldLandOnChats({ ...base, collapsed: false })).toBe(false);
  });

  it("does nothing for a signed-out visitor", () => {
    // The collapsed nav shows them Discover only — there is no Chats to land on.
    expect(shouldLandOnChats({ ...base, pubkey: null })).toBe(false);
  });

  describe("leaves anything carrying intent alone", () => {
    it("a deeper path", () => {
      for (const pathname of ["/messages", "/notifications", "/profile/npub1x", "/outposts", "//"]) {
        expect(shouldLandOnChats({ ...base, pathname }), pathname).toBe(false);
      }
    });

    it("an invite arrival — the case that matters most", () => {
      // ?inviter= is captured on mount; rewriting the URL out from under that
      // would drop the connection the whole invite rail exists to make.
      expect(shouldLandOnChats({ ...base, search: "?inviter=npub1abc" })).toBe(false);
    });

    it("any other query string", () => {
      for (const search of ["?tab=media", "?q=bitcoin", "?relay=wss%3A%2F%2Fx"]) {
        expect(shouldLandOnChats({ ...base, search }), search).toBe(false);
      }
    });

    it("a hash", () => {
      expect(shouldLandOnChats({ ...base, hash: "#invite" })).toBe(false);
    });

    it("but tolerates a bare ? or # with nothing after it", () => {
      // Some clients append these; they carry no intent.
      expect(shouldLandOnChats({ ...base, search: "?" })).toBe(true);
      expect(shouldLandOnChats({ ...base, hash: "#" })).toBe(true);
    });
  });

  it("one behaviour for everyone — nothing here reads account age", () => {
    // Decision 8 resolved this explicitly: existing users land on Chats too,
    // with the one-time notice. No branch on new-vs-existing exists.
    const forAnyone = shouldLandOnChats({ ...base, pubkey: "b".repeat(64) });
    expect(forAnyone).toBe(shouldLandOnChats(base));
  });
});

/**
 * Sabotage that must turn these red: return "/search" unconditionally — the
 * shape both call sites shipped with, and the reason Decision 8 was false for
 * anyone whose session started signed out.
 */
describe("postAuthLandingPath", () => {
  it("lands on Chats under the collapsed IA", () => {
    expect(postAuthLandingPath(null, true)).toBe(CHATS_PATH);
  });

  it("keeps the old feed default when the IA is not collapsed", () => {
    // The flag is still a kill-switch; flipping it back must restore the old
    // behaviour completely, not leave this one redirect converted.
    expect(postAuthLandingPath(null, false)).toBe("/search");
  });

  it("honours an explicit Settings choice over both", () => {
    expect(postAuthLandingPath("/news", true)).toBe("/news");
    expect(postAuthLandingPath("/news", false)).toBe("/news");
  });

  it("ignores a stored value that is not a path", () => {
    // Guards against a stale or corrupted preference navigating somewhere odd.
    expect(postAuthLandingPath("news", true)).toBe(CHATS_PATH);
    expect(postAuthLandingPath("", true)).toBe(CHATS_PATH);
    expect(postAuthLandingPath(undefined, true)).toBe(CHATS_PATH);
  });
});
