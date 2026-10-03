/**
 * Comment notifications and news discussions judge strangers with the same
 * quality floor as the feeds (admitStranger), but they passed it ONLY a trust
 * score. With scores missing, an unscored stranger had nothing else to show
 * and was dropped unless they did proof-of-work. Both now pass the floor's
 * real signals: account age, follower count and engagement.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SITES = ["contexts/notification-engine.tsx", "pages/RSSFeed.tsx"];

describe("discussion trust gets the stranger floor's real signals", () => {
  it("each call site passes discussionSignals()", () => {
    const missing = SITES.filter((f) => !readFileSync(resolve(__dirname, "..", f), "utf8").includes("...discussionSignals()"));
    expect(missing).toEqual([]);
  });
});
