/**
 * Where "Trending in your circle" gets its material (owner, 2026-11-23): what
 * the people you follow reacted to, then those posts. Three outcomes are kept
 * apart: an answer with posts, an answer with nothing, and never reached.
 */
import { describe, it, expect } from "vitest";
import { interactionsFrom, postsWorthFetching, fetchCircleTrending, coverageNote } from "./circle-trending-source";

const ev = (over: Record<string, unknown>) => ({ id: "x", pubkey: "p", kind: 1, created_at: 100, tags: [], content: "", sig: "", ...over }) as never;

describe("interactionsFrom", () => {
  it("a like and a repost name the post in their last e tag", () => {
    expect(interactionsFrom([ev({ kind: 7, pubkey: "ana", tags: [["e", "root"], ["e", "post"]] }), ev({ kind: 6, pubkey: "bo", tags: [["e", "post"]] })]))
      .toEqual([{ eventId: "post", by: "ana", kind: "like" }, { eventId: "post", by: "bo", kind: "repost" }]);
  });
  it("a reply counts for the conversation it is in: the root when marked, else the first e tag", () => {
    expect(interactionsFrom([ev({ pubkey: "ana", tags: [["e", "mid", "", "reply"], ["e", "top", "", "root"]] })])).toEqual([{ eventId: "top", by: "ana", kind: "reply" }]);
    expect(interactionsFrom([ev({ pubkey: "ana", tags: [["e", "first"], ["e", "second"]] })])).toEqual([{ eventId: "first", by: "ana", kind: "reply" }]);
  });
  it("a post that replies to nothing, a quote, and a dislike are not reactions", () => {
    expect(interactionsFrom([ev({ pubkey: "ana", tags: [] }), ev({ pubkey: "ana", tags: [["e", "q", "", "mention"]] }), ev({ kind: 7, pubkey: "ana", content: "-", tags: [["e", "post"]] })])).toEqual([]);
  });
});

describe("postsWorthFetching", () => {
  it("only posts two different people reacted to, most people first, capped", () => {
    const i = [
      { eventId: "one", by: "ana", kind: "like" as const }, { eventId: "one", by: "ana", kind: "reply" as const },
      { eventId: "two", by: "ana", kind: "like" as const }, { eventId: "two", by: "bo", kind: "like" as const },
      { eventId: "three", by: "ana", kind: "like" as const }, { eventId: "three", by: "bo", kind: "like" as const }, { eventId: "three", by: "cy", kind: "repost" as const },
    ];
    expect(postsWorthFetching(i, 10)).toEqual(["three", "two"]);
    expect(postsWorthFetching(i, 1)).toEqual(["three"]);
  });
});

describe("fetchCircleTrending", () => {
  const like = (by: string, post: string) => ev({ id: `${by}-${post}`, kind: 7, pubkey: by, tags: [["e", post]] });
  const base = { follows: ["ana", "bo"], since: 0, relays: ["wss://r.example"] };

  it("asks what your follows reacted to, then for those posts", async () => {
    const asked: Record<string, unknown>[] = [];
    const got = await fetchCircleTrending({ ...base, query: async (_r, f) => {
      asked.push(f);
      if ("authors" in f) return { events: [like("ana", "post"), like("bo", "post"), like("ana", "lonely")], answered: true };
      return { events: [ev({ id: "post", pubkey: "ines" })], answered: true };
    } });
    expect(asked[0]).toMatchObject({ kinds: [1, 6, 7], authors: ["ana", "bo"], since: 0 });
    expect(asked[1]).toMatchObject({ ids: ["post"] });
    expect(got.reached).toBe(true);
    expect(got.posts.map((p) => p.id)).toEqual(["post"]);
    expect(got.interactions).toHaveLength(3);
  });

  it("nobody you follow reacted to anything: reached, and empty", async () => {
    const got = await fetchCircleTrending({ ...base, query: async () => ({ events: [], answered: true }) });
    expect(got).toMatchObject({ reached: true, posts: [], interactions: [] });
  });

  it("no relay answered: not reached, which is not the same as empty", async () => {
    const got = await fetchCircleTrending({ ...base, query: async () => ({ events: [], answered: false }) });
    expect(got.reached).toBe(false);
  });

  it("you follow nobody: nothing is asked, and it is an honest empty", async () => {
    let calls = 0;
    const got = await fetchCircleTrending({ ...base, follows: [], query: async () => { calls++; return { events: [], answered: true }; } });
    expect(calls).toBe(0);
    expect(got).toMatchObject({ reached: true, posts: [], interactions: [] });
  });

  // Found on live relays (2026-11-23): a relay returns only its newest few hundred
  // events per question, so one question for a week came back with 35 hours.
  describe("a busy circle", () => {
    const page = (newest: number, oldest: number, n = 500) => Array.from({ length: n }, (_, i) => ev({ id: `e${newest}-${i}`, kind: 7, pubkey: "ana", created_at: Math.round(newest - (i * (newest - oldest)) / (n - 1)), tags: [["e", `p${i % 7}`]] }));

    it("asks again for older reactions until the span is covered", async () => {
      const untils: (number | undefined)[] = [];
      const got = await fetchCircleTrending({ ...base, since: 1000, query: async (_r, f) => {
        if (!("authors" in f)) return { events: [], answered: true };
        untils.push(f.until as number | undefined);
        if (f.until === undefined) return { events: page(9000, 6000), answered: true };
        if (f.until === 5999) return { events: page(5999, 3000), answered: true };
        return { events: page(2999, 1500, 40), answered: true }; // fewer than a full page: nothing older
      } });
      expect(untils).toEqual([undefined, 5999, 2999]);
      expect(got.interactions).toHaveLength(1040);
      expect(got.coveredSince).toBe(1000);
    });

    it("stops after a few questions, and says how far back it got", async () => {
      let calls = 0;
      const got = await fetchCircleTrending({ ...base, since: 0, maxPages: 3, query: async (_r, f) => {
        if (!("authors" in f)) return { events: [], answered: true };
        calls++;
        const newest = (f.until as number | undefined) ?? 100_000;
        return { events: page(newest, newest - 1000), answered: true };
      } });
      expect(calls).toBe(3);
      expect(got.coveredSince).toBe(97_000 - 2); // three pages of 1000s, each starting one second before the last
      expect(got.reached).toBe(true);
    });

    it("a quiet circle is covered by one question", async () => {
      let calls = 0;
      const got = await fetchCircleTrending({ ...base, since: 1000, query: async (_r, f) => { if ("authors" in f) calls++; return { events: "authors" in f ? page(9000, 8000, 12) : [], answered: true }; } });
      expect(calls).toBe(1);
      expect(got.coveredSince).toBe(1000);
    });
  });

  it("many follows are asked about in chunks a relay accepts", async () => {
    const follows = Array.from({ length: 520 }, (_, i) => `f${i}`);
    const sizes: number[] = [];
    await fetchCircleTrending({ ...base, follows, query: async (_r, f) => { if ("authors" in f) sizes.push((f.authors as string[]).length); return { events: [], answered: true }; } });
    expect(sizes).toEqual([250, 250, 20]);
  });
});

describe("coverageNote: say so when a busy circle could not be covered for the whole span", () => {
  const NOW = 1_000_000;
  it("nothing to say when the span was covered, or missed by under two hours", () => {
    expect(coverageNote(NOW - 86_400, NOW - 86_400, NOW)).toBeNull();
    expect(coverageNote(NOW - 86_400, NOW - 86_400 + 3600, NOW)).toBeNull();
  });
  it("hours when it reached back less than two days, days beyond that", () => {
    expect(coverageNote(NOW - 7 * 86_400, NOW - 35 * 3600, NOW)).toBe("Your circle has been busy: this covers the last 35 hours.");
    expect(coverageNote(NOW - 7 * 86_400, NOW - 4 * 86_400, NOW)).toBe("Your circle has been busy: this covers the last 4 days.");
  });
});
