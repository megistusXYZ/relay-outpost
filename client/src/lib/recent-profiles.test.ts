import { describe, it, expect } from "vitest";
import { pushRecentProfile, type RecentProfileVisit } from "./recent-profiles";

const v = (pubkey: string, at = 0): RecentProfileVisit => ({ pubkey, at });

describe("pushRecentProfile", () => {
  it("puts the newest visit first", () => {
    const out = pushRecentProfile([v("a")], v("b"));
    expect(out.map((x) => x.pubkey)).toEqual(["b", "a"]);
  });

  it("dedupes by pubkey, moving a revisit to the front", () => {
    const out = pushRecentProfile([v("a"), v("b")], v("b", 9));
    expect(out.map((x) => x.pubkey)).toEqual(["b", "a"]);
    expect(out[0].at).toBe(9);
  });

  it("caps the list", () => {
    let list: RecentProfileVisit[] = [];
    for (let i = 0; i < 12; i++) list = pushRecentProfile(list, v(`p${i}`), 8);
    expect(list).toHaveLength(8);
    expect(list[0].pubkey).toBe("p11");
  });
});
