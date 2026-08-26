// New-user default feed (calm/safe/works-day-one): with no explicit preference, a user
// should land on "For You" (deep_scan, always populated from trending) — NOT be dropped
// into a sparse "Following" feed. An explicit saved choice is always honored.
import { describe, it, expect } from "vitest";
import { resolveDefaultFeedMode, isReplyEvent, getSavedTabLabel } from "./helpers";

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

// The Saved pill is a value-displaying selector: while the saved lane is active
// it shows WHICH saved feed is on screen; on the other lanes it stays "Saved".
describe("getSavedTabLabel", () => {
  const feeds = [
    { id: "abc123", name: "#naturestr" },
    { id: "def456", name: "Bitcoin Builders & Friends" },
  ];

  it("stays 'Saved' while another lane (For you / Following / Trending) is active", () => {
    expect(getSavedTabLabel("raw_signal", "all", feeds)).toBe("Saved");
    expect(getSavedTabLabel("open_comms", "all", feeds)).toBe("Saved");
    expect(getSavedTabLabel("deep_scan", "all", feeds)).toBe("Saved");
  });

  it("names the built-in macro feed from feedStyle on custom_all", () => {
    expect(getSavedTabLabel("custom_all", "photos", feeds)).toBe("Images");
    expect(getSavedTabLabel("custom_all", "video", feeds)).toBe("Videos");
    expect(getSavedTabLabel("custom_all", "polls", feeds)).toBe("Polls");
  });

  it("falls back to 'Saved' on custom_all with an unexpected style", () => {
    expect(getSavedTabLabel("custom_all", "all", feeds)).toBe("Saved");
  });

  it("shows a custom feed's stored name while it is active", () => {
    expect(getSavedTabLabel("custom_abc123", "all", feeds)).toBe("#naturestr");
    expect(getSavedTabLabel("custom_def456", "all", feeds)).toBe("Bitcoin Builders & Friends");
  });

  it("falls back to 'Saved' when the active custom feed was deleted", () => {
    expect(getSavedTabLabel("custom_abc123", "all", [])).toBe("Saved");
    expect(getSavedTabLabel("custom_abc123", "all", [{ id: "def456", name: "Other" }])).toBe("Saved");
  });

  it("falls back to 'Saved' on the empty state and on blank feed names", () => {
    expect(getSavedTabLabel("custom_empty", "all", [])).toBe("Saved");
    expect(getSavedTabLabel("custom_ws", "all", [{ id: "ws", name: "   " }])).toBe("Saved");
  });
});
