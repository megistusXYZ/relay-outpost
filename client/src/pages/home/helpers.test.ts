// Default feed: with no explicit preference a user lands on "For you" (raw_signal) —
// NOT in a sparse "Following" feed, and (since Trending got its own tab, 2026-10-02)
// not on the Trending chart either. An explicit saved choice is always honored.
import { describe, it, expect } from "vitest";
import { resolveDefaultFeedMode, initialFeedMode, DEFAULT_FEED_MODE, isReplyEvent, feedBodyFor } from "./helpers";

describe("resolveDefaultFeedMode", () => {
  it("with no saved preference the app opens on For you — the first tab — not on Trending", () => {
    expect(DEFAULT_FEED_MODE).toBe("raw_signal");
    expect(resolveDefaultFeedMode(null)).toBe("raw_signal");
    expect(resolveDefaultFeedMode(undefined)).toBe("raw_signal");
  });

  it("someone who chose Trending as their launch feed keeps it", () => {
    expect(resolveDefaultFeedMode("deep_scan")).toBe("deep_scan");
  });

  it("honors an explicit 'Following' (open_comms) choice", () => {
    expect(resolveDefaultFeedMode("open_comms")).toBe("open_comms");
  });

  it("honors explicit 'Everyone' (raw_signal) and custom feeds", () => {
    expect(resolveDefaultFeedMode("raw_signal")).toBe("raw_signal");
    expect(resolveDefaultFeedMode("custom_abc123")).toBe("custom_abc123");
  });

  it("falls back to 'For You' for an unrecognized value", () => {
    expect(resolveDefaultFeedMode("garbage")).toBe("raw_signal");
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
      expect(resolveDefaultFeedMode(null, { publicNostr: true })).toBe("raw_signal");
    });

    it("changes nothing when the caller says nothing", () => {
      // Every pre-existing call site passes no options and must keep the exact
      // behaviour it had — this is what grandfathers existing accounts.
      expect(resolveDefaultFeedMode(null, {})).toBe("raw_signal");
      expect(resolveDefaultFeedMode(null)).toBe("raw_signal");
    });

    it("garbage still lands somewhere populated, whichever way the flag reads", () => {
      expect(resolveDefaultFeedMode("garbage", { publicNostr: false })).toBe("open_comms");
      expect(resolveDefaultFeedMode("garbage", { publicNostr: true })).toBe("raw_signal");
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

describe("initialFeedMode — where the page starts, before sign-in and follows have loaded", () => {
  it("starts on For you when nothing is saved", () => {
    expect(initialFeedMode(null)).toBe("raw_signal");
  });

  it("starts on a saved Trending, For you or feed of your own straight away", () => {
    expect(initialFeedMode("deep_scan")).toBe("deep_scan");
    expect(initialFeedMode("raw_signal")).toBe("raw_signal");
    expect(initialFeedMode("custom_abc123")).toBe("custom_abc123");
  });

  it("a saved Following waits behind the default until the follow list is in", () => {
    expect(initialFeedMode("open_comms")).toBe("raw_signal");
  });

  it("Home uses these rules, and takes the first-time trust step wherever For you starts", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const home = readFileSync(path.resolve(import.meta.dirname, "../Home.tsx"), "utf8");
    expect(home).toMatch(/return initialFeedMode\(localStorage\.getItem\("relay-outpost-default-feed-mode"\)\);/);
    expect(home).not.toMatch(/return "deep_scan";/);
    expect(home).toMatch(/if \(feedMode === "raw_signal"\) startForYouOnNetwork\(\);/);
  });
});

// "Your space" (owner, 2026-10-10): with the wider network off, the For you
// and Trending lanes are the DOOR — one card that opens the switch — and
// nothing is read for them. Following and a person's own feeds are the
// account's space and stay feeds. With the wider network on, every lane is
// a feed, exactly as before.
describe("feedBodyFor — a feed, or the door to the wider network", () => {
  it("off: For you and Trending are the door", () => {
    expect(feedBodyFor("raw_signal", false)).toBe("door");
    expect(feedBodyFor("deep_scan", false)).toBe("door");
  });
  it("off: Following and custom feeds are still feeds", () => {
    expect(feedBodyFor("open_comms", false)).toBe("feed");
    expect(feedBodyFor("custom_abc", false)).toBe("feed");
  });
  it("on: everything is a feed", () => {
    for (const m of ["raw_signal", "deep_scan", "open_comms", "custom_abc"]) expect(feedBodyFor(m, true)).toBe("feed");
  });
});
