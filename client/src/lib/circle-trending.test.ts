/**
 * Trending in your circle (owner, 2026-11-23): Home's Trending is ranked by
 * us, from your own network. A post rises by how many DIFFERENT people in
 * your circle replied to, reposted, liked or zapped it. Strangers' reactions
 * count for nothing, one person counts once, and a post needs two people.
 */
import { describe, it, expect } from "vitest";
import { rankCircleTrending, type Interaction } from "./circle-trending";

const NOW = 1_800_000_000;
const H = 3600;
const FOLLOWED = new Set(["ana", "bo", "cy", "di"]);
const VOUCHED = new Set(["ines", "rui"]);
const circle = {
  me: "me",
  isFollowed: (pk: string) => FOLLOWED.has(pk),
  inCircle: (pk: string) => FOLLOWED.has(pk) || VOUCHED.has(pk),
};
const post = (id: string, pubkey: string, hoursAgo: number) => ({ id, pubkey, created_at: NOW - hoursAgo * H });
const by = (eventId: string, kind: Interaction["kind"], ...people: string[]): Interaction[] => people.map((p) => ({ eventId, by: p, kind }));
const rank = (posts: ReturnType<typeof post>[], interactions: Interaction[], c = circle) => rankCircleTrending(posts, interactions, c, NOW);

describe("rankCircleTrending", () => {
  it("a post two people in your circle reacted to trends; one person is not enough", () => {
    const rows = rank([post("a", "ana", 2), post("b", "bo", 2)], [...by("a", "reply", "bo", "cy"), ...by("b", "like", "cy")]);
    expect(rows.map((r) => r.post.id)).toEqual(["a"]);
    expect(rows[0].people).toBe(2);
  });

  it("one person reacting many times counts once", () => {
    const rows = rank([post("a", "ana", 2)], [...by("a", "like", "bo"), ...by("a", "reply", "bo"), ...by("a", "repost", "bo"), ...by("a", "zap", "bo")]);
    expect(rows).toEqual([]);
  });

  it("strangers' reactions count for nothing, however many", () => {
    const strangers = Array.from({ length: 50 }, (_, i) => `bot${i}`);
    const rows = rank([post("a", "ana", 2)], [...by("a", "like", ...strangers), ...by("a", "like", "bo")]);
    expect(rows).toEqual([]);
  });

  it("the author's own reactions, and yours, are not the circle talking", () => {
    const rows = rank([post("a", "ana", 2)], [...by("a", "reply", "ana"), ...by("a", "like", "me"), ...by("a", "like", "bo")]);
    expect(rows).toEqual([]);
  });

  it("a stranger's post never trends, even when your circle reacts to it; nor does your own", () => {
    const rows = rank([post("s", "stranger", 1), post("m", "me", 1)], [...by("s", "reply", "ana", "bo", "cy"), ...by("m", "like", "ana", "bo")]);
    expect(rows).toEqual([]);
  });

  it("more people outranks fewer at the same age, and at the same count the newer post leads", () => {
    const rows = rank(
      [post("few", "ana", 3), post("many", "bo", 3), post("older", "cy", 20), post("newer", "di", 1)],
      [...by("few", "like", "bo", "cy"), ...by("many", "like", "ana", "cy", "di"), ...by("older", "like", "ana", "bo"), ...by("newer", "like", "ana", "bo")],
    );
    expect(rows.map((r) => r.post.id)).toEqual(["many", "newer", "few", "older"]);
  });

  it("a vouched writer's post can trend, and vouched people's reactions count", () => {
    const rows = rank([post("v", "ines", 2)], [...by("v", "reply", "ana", "rui")]);
    expect(rows.map((r) => r.post.id)).toEqual(["v"]);
  });

  it("with the wider network off the circle is only people you follow", () => {
    const followsOnly = { ...circle, inCircle: circle.isFollowed };
    expect(rank([post("v", "ines", 2)], [...by("v", "reply", "ana", "bo")], followsOnly)).toEqual([]);
    expect(rank([post("a", "ana", 2)], [...by("a", "reply", "bo", "rui")], followsOnly)).toEqual([]);
    expect(rank([post("a", "ana", 2)], [...by("a", "reply", "bo", "cy")], followsOnly).map((r) => r.post.id)).toEqual(["a"]);
  });

  describe("the reason line", () => {
    it("names the reaction most of them made, and that they are people you follow", () => {
      const [row] = rank([post("a", "ana", 2)], [...by("a", "reply", "bo", "cy", "di"), ...by("a", "like", "bo")]);
      expect(row.reason).toBe("3 people you follow replied");
    });
    it("says \"in your circle\" when some of them are vouched rather than followed", () => {
      const [row] = rank([post("a", "ana", 2)], [...by("a", "repost", "bo", "rui")]);
      expect(row.reason).toBe("Reposted by 2 in your circle");
    });
    it("likes and zaps have their own words", () => {
      expect(rank([post("a", "ana", 2)], by("a", "like", "bo", "cy"))[0].reason).toBe("2 people you follow liked this");
      expect(rank([post("a", "ana", 2)], by("a", "zap", "bo", "cy"))[0].reason).toBe("Zapped by 2 people you follow");
    });
    it("when no one reaction has two people, it says they reacted", () => {
      const [row] = rank([post("a", "ana", 2)], [...by("a", "reply", "bo"), ...by("a", "like", "cy")]);
      expect(row.reason).toBe("2 people you follow reacted");
    });
  });
});
