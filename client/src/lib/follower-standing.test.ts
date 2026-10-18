/**
 * A new follower, in your terms (owner, 2026-10-18): how your network sees
 * them, and who you follow that follows them too. Followers with no ties to
 * you whom your network doesn't trust (and flagged accounts) are grouped as
 * "outside your network" and don't raise the badge. Before your network has
 * loaded, nobody is grouped away.
 */
import { describe, it, expect } from "vitest";
import { followerStanding, followerTrustWords, sharedFollowersLine, followerCountsInBadge, offersFollowBack } from "./follower-standing";

describe("followerStanding", () => {
  it("trusted and known come from your network's view", () => {
    expect(followerStanding({ tier: "strong", flagged: false, sharedCount: 0, ready: true })).toBe("trusted");
    expect(followerStanding({ tier: "moderate", flagged: false, sharedCount: 0, ready: true })).toBe("known");
  });

  it("someone you follow following them is enough to keep them in", () => {
    expect(followerStanding({ tier: "low", flagged: false, sharedCount: 2, ready: true })).toBe("new");
  });

  it("no ties and not trusted is outside; flagged always is", () => {
    expect(followerStanding({ tier: "none", flagged: false, sharedCount: 0, ready: true })).toBe("outside");
    expect(followerStanding({ tier: "weak", flagged: false, sharedCount: 0, ready: true })).toBe("outside");
    expect(followerStanding({ tier: "strong", flagged: true, sharedCount: 5, ready: true })).toBe("concerns");
  });

  it("before your network has loaded, nobody is grouped away", () => {
    expect(followerStanding({ tier: "none", flagged: false, sharedCount: 0, ready: false })).toBe("unknown");
  });
});

describe("what a follower row says and does", () => {
  it("in words, never scores", () => {
    expect(followerTrustWords("trusted")).toBe("Trusted by your network");
    expect(followerTrustWords("known")).toBe("Known to your network");
    expect(followerTrustWords("new")).toBe("New to your network");
    expect(followerTrustWords("outside")).toBe("Not known to your network");
    expect(followerTrustWords("concerns")).toBe("Your network has concerns");
    expect(followerTrustWords("unknown")).toBe("");
  });

  it("names who you follow that follows them", () => {
    expect(sharedFollowersLine([], 0)).toBe("");
    expect(sharedFollowersLine(["Alex"], 1)).toBe("Followed by Alex, who you follow");
    expect(sharedFollowersLine(["Alex", "Sam"], 2)).toBe("Followed by Alex and Sam, who you follow");
    expect(sharedFollowersLine(["Alex", "Sam"], 5)).toBe("Followed by Alex, Sam and 3 others you follow");
    expect(sharedFollowersLine(["Alex", "Sam"], 3)).toBe("Followed by Alex, Sam and 1 other you follow");
  });

  it("only outside and flagged followers stay out of the badge", () => {
    expect(["trusted", "known", "new", "unknown"].every((s) => followerCountsInBadge(s as never))).toBe(true);
    expect(followerCountsInBadge("outside")).toBe(false);
    expect(followerCountsInBadge("concerns")).toBe(false);
  });

  it("Follow back is offered to trusted and known followers you don't follow yet", () => {
    expect(offersFollowBack("trusted", false)).toBe(true);
    expect(offersFollowBack("known", false)).toBe(true);
    expect(offersFollowBack("trusted", true)).toBe(false);
    expect(offersFollowBack("new", false)).toBe(false);
    expect(offersFollowBack("outside", false)).toBe(false);
  });
});
