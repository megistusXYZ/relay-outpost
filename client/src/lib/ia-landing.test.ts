import { describe, it, expect } from "vitest";
import { arrivalOutcome, shouldLandOnChats, postAuthLandingPath, holdHomeForLanding, CHATS_PATH, WELCOME_PATH } from "./ia-landing";

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

describe("a brand-new account's first landing", () => {
  it("opens the welcome screen once, then lands on Chats as usual", () => {
    expect(postAuthLandingPath(null, true, { isNew: true, welcomed: false })).toBe(WELCOME_PATH);
    expect(WELCOME_PATH).toBe("/welcome");
    // Already welcomed on this device: back to the normal landing.
    expect(postAuthLandingPath(null, true, { isNew: true, welcomed: true })).toBe(CHATS_PATH);
    // A key signed in from elsewhere is not a new member: no welcome.
    expect(postAuthLandingPath(null, true, { isNew: false, welcomed: false })).toBe(CHATS_PATH);
  });
});

describe("holdHomeForLanding: don't start the feed on the way to Chats", () => {
  const PK = "a".repeat(64);
  const arrivedAt = (pathname: string) => ({ pathname, search: "", hash: "" });
  const base = { location: "/", pubkey: PK, collapsed: true, landed: false };

  it("a signed-in launch at / holds the feed: it's about to land on Chats", () => {
    expect(holdHomeForLanding({ ...base, arrival: arrivedAt("/") })).toBe(true);
  });

  it("tapping Feed after arriving somewhere else shows the feed (reported 2026-09-29: Discover → Feed was blank)", () => {
    // Arrived at /discover (or a reload on Chats): the tab never landed, but
    // this is a tap, not an arrival, and nothing is going to redirect it.
    expect(holdHomeForLanding({ ...base, arrival: arrivedAt("/discover") })).toBe(false);
    expect(holdHomeForLanding({ ...base, arrival: arrivedAt("/messages") })).toBe(false);
  });

  it("once the tab has landed, / is the feed", () => {
    expect(holdHomeForLanding({ ...base, arrival: arrivedAt("/"), landed: true })).toBe(false);
  });

  it("only while the location is / itself", () => {
    expect(holdHomeForLanding({ ...base, location: "/messages", arrival: arrivedAt("/") })).toBe(false);
  });

  it("signed out, or the expanded layout: no landing, no hold", () => {
    expect(holdHomeForLanding({ ...base, pubkey: null, arrival: arrivedAt("/") })).toBe(false);
    expect(holdHomeForLanding({ ...base, collapsed: false, arrival: arrivedAt("/") })).toBe(false);
  });
});

/**
 * Measured on iOS Safari, 2026-10-01: a tab opened on Discover; a new build
 * was out; tapping the Feed tile made the app reload onto it at "/" — and that
 * load was taken for the tab's first arrival and sent to Chats.
 */
describe("arrivalOutcome — arriving somewhere on purpose is an arrival too", () => {
  it("the bare root, first time: Chats", () => {
    expect(arrivalOutcome(base)).toBe("chats");
  });

  it("a tab that opens on Discover, a thread or an invite has landed where it is", () => {
    expect(arrivalOutcome({ ...base, pathname: "/discover" })).toBe("here");
    expect(arrivalOutcome({ ...base, pathname: "/thread/abc" })).toBe("here");
    expect(arrivalOutcome({ ...base, search: "?inviter=npub1abc" })).toBe("here");
  });

  it("…so the app's own reload at the feed, after a tap on Feed, stays on the feed", () => {
    // What the effect does with "here" is mark the tab landed; this is the reload.
    expect(arrivalOutcome({ ...base, pathname: "/", landed: true })).toBe("nothing");
  });

  it("nothing is decided for a signed-out visitor or with the collapsed IA off", () => {
    expect(arrivalOutcome({ ...base, pathname: "/discover", pubkey: null })).toBe("nothing");
    expect(arrivalOutcome({ ...base, pathname: "/discover", collapsed: false })).toBe("nothing");
  });

  it("the app marks the tab for both outcomes, and only navigates for Chats", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const app = readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");
    const effect = app.slice(app.indexOf("const outcome = arrivalOutcome("), app.indexOf("}, [pubkey, iaCollapsedForLanding, navigate]);"));
    expect(effect).toMatch(/if \(outcome === "nothing"\) return;\s*(\/\/.*\s*)*markLanded\(\);\s*if \(outcome === "chats"\) navigate\(CHATS_PATH, \{ replace: true \}\);/);
  });
});
