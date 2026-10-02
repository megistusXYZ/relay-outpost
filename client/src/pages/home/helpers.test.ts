// New-user default feed (calm/safe/works-day-one): with no explicit preference, a user
// should land on "For You" (deep_scan, always populated from trending) — NOT be dropped
// into a sparse "Following" feed. An explicit saved choice is always honored.
import { describe, it, expect } from "vitest";
import { resolveDefaultFeedMode, isReplyEvent } from "./helpers";

describe("resolveDefaultFeedMode", () => {
  it("defaults to 'For You' (deep_scan) when there is no saved preference", () => {
    expect(resolveDefaultFeedMode(null)).toBe("deep_scan");
    expect(resolveDefaultFeedMode(undefined)).toBe("deep_scan");
  });

  it("honors an explicit 'Following' (open_comms) choice", () => {
    expect(resolveDefaultFeedMode("open_comms")).toBe("open_comms");
  });

  it("honors explicit 'Everyone' (raw_signal) and custom feeds", () => {
    expect(resolveDefaultFeedMode("raw_signal")).toBe("raw_signal");
    expect(resolveDefaultFeedMode("custom_abc123")).toBe("custom_abc123");
  });

  it("falls back to 'For You' for an unrecognized value", () => {
    expect(resolveDefaultFeedMode("garbage")).toBe("deep_scan");
  });

  describe("public Nostr off — decision 4, finally read", () => {
    it("lands on Following instead of posts from across the network", () => {
      expect(resolveDefaultFeedMode(null, { publicNostr: false })).toBe("open_comms");
      expect(resolveDefaultFeedMode(undefined, { publicNostr: false })).toBe("open_comms");
    });

    it("still honors every explicit choice, including 'For You'", () => {
      // The flag fills a blank; it does not overrule someone who picked a lane.
      // Turning public Nostr off must not confiscate a feed you chose.
      expect(resolveDefaultFeedMode("deep_scan", { publicNostr: false })).toBe("deep_scan");
      expect(resolveDefaultFeedMode("raw_signal", { publicNostr: false })).toBe("raw_signal");
      expect(resolveDefaultFeedMode("custom_abc123", { publicNostr: false })).toBe("custom_abc123");
    });

    it("changes nothing when public Nostr is on", () => {
      expect(resolveDefaultFeedMode(null, { publicNostr: true })).toBe("deep_scan");
    });

    it("changes nothing when the caller says nothing", () => {
      // Every pre-existing call site passes no options and must keep the exact
      // behaviour it had — this is what grandfathers existing accounts.
      expect(resolveDefaultFeedMode(null, {})).toBe("deep_scan");
      expect(resolveDefaultFeedMode(null)).toBe("deep_scan");
    });

    it("garbage still lands somewhere populated, whichever way the flag reads", () => {
      expect(resolveDefaultFeedMode("garbage", { publicNostr: false })).toBe("open_comms");
      expect(resolveDefaultFeedMode("garbage", { publicNostr: true })).toBe("deep_scan");
    });
  });
});

describe("isReplyEvent", () => {
  it("treats a NIP-10 marked 'reply' or 'root' e-tag as a reply", () => {
    expect(isReplyEvent([["e", "abc", "", "reply"]])).toBe(true);
    expect(isReplyEvent([["e", "abc", "", "root"]])).toBe(true);
  });

  it("treats a deprecated positional (unmarked) e-tag as a reply", () => {
    // Legacy NIP-10 positional reply: e-tag present but with no marker.
    expect(isReplyEvent([["e", "abc"]])).toBe(true);
    expect(isReplyEvent([["e", "root123"], ["e", "parent456"]])).toBe(true);
  });

  it("does NOT treat a mention-marked e-tag as a reply", () => {
    expect(isReplyEvent([["e", "abc", "", "mention"]])).toBe(false);
  });

  it("does NOT treat a plain post (no e-tags) as a reply", () => {
    expect(isReplyEvent([])).toBe(false);
    expect(isReplyEvent([["p", "somepubkey"], ["t", "nostr"]])).toBe(false);
  });

  it("does NOT misclassify q-tag quotes or p-tag mentions as replies", () => {
    expect(isReplyEvent([["q", "quotedid"]])).toBe(false);
    expect(isReplyEvent([["p", "mentioned"], ["q", "quoted"]])).toBe(false);
  });
});
