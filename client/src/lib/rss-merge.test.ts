import { describe, it, expect } from "vitest";
import {
  mergeFeedItems,
  sortMergedItems,
  pickHero,
  countUnread,
  mergeItemId,
  interleaveMergedSources,
  capPerSource,
  type PerFeedItems,
  type MergeableItem,
  type MergedItem,
} from "./rss-merge";

interface Item extends MergeableItem {
  title: string;
}

const src = (url: string, name: string) => ({ url, name });

function item(title: string, opts: Partial<Item> = {}): Item {
  return { title, link: `https://x/${title}`, pubDate: "2026-01-01T00:00:00Z", ...opts };
}

describe("mergeItemId", () => {
  it("prefers guid, then id, then link", () => {
    expect(mergeItemId({ guid: "g", id: "i", link: "l" })).toBe("g");
    expect(mergeItemId({ id: "i", link: "l" })).toBe("i");
    expect(mergeItemId({ link: "l" })).toBe("l");
    expect(mergeItemId({})).toBe("");
  });
});

describe("mergeFeedItems", () => {
  it("flattens all feeds and attaches the correct source to each item", () => {
    const perFeed: PerFeedItems<Item>[] = [
      { source: src("f1", "Feed One"), items: [item("a"), item("b")] },
      { source: src("f2", "Feed Two"), items: [item("c")] },
    ];
    const merged = mergeFeedItems(perFeed);
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.item.title)).toEqual(["a", "b", "c"]);
    expect(merged.find((m) => m.item.title === "a")!.source.name).toBe("Feed One");
    expect(merged.find((m) => m.item.title === "c")!.source.name).toBe("Feed Two");
  });

  it("dedups by link, keeping the first occurrence (earlier feed wins)", () => {
    const shared = { link: "https://x/shared", title: "shared" };
    const perFeed: PerFeedItems<Item>[] = [
      { source: src("f1", "Feed One"), items: [{ ...shared }] },
      { source: src("f2", "Feed Two"), items: [{ ...shared }, item("unique")] },
    ];
    const merged = mergeFeedItems(perFeed);
    expect(merged).toHaveLength(2);
    const sharedMerged = merged.find((m) => m.item.link === "https://x/shared")!;
    expect(sharedMerged.source.name).toBe("Feed One");
  });

  it("falls back to guid/id when link is missing, and keeps identity-less items", () => {
    const perFeed: PerFeedItems<Item>[] = [
      {
        source: src("f1", "Feed One"),
        items: [
          { title: "g1", guid: "same" },
          { title: "g2", guid: "same" }, // dup by guid
          { title: "n1" }, // no identity — kept
          { title: "n2" }, // no identity — kept
        ],
      },
    ];
    const merged = mergeFeedItems(perFeed);
    expect(merged.map((m) => m.item.title)).toEqual(["g1", "n1", "n2"]);
  });
});

describe("sortMergedItems", () => {
  const a = item("a", { link: "a", pubDate: "2026-01-03T00:00:00Z" }); // newest
  const b = item("b", { link: "b", pubDate: "2026-01-02T00:00:00Z" });
  const c = item("c", { link: "c", pubDate: "2026-01-01T00:00:00Z" }); // oldest
  const merged = mergeFeedItems([{ source: src("f", "F"), items: [b, a, c] }]);
  const readLinks = new Set(["a"]); // newest is read
  const isRead = (it: Item) => readLinks.has(it.link!);

  it("latest = pure reverse-chronological regardless of read state", () => {
    const sorted = sortMergedItems(merged, "latest", isRead);
    expect(sorted.map((m) => m.item.title)).toEqual(["a", "b", "c"]);
  });

  it("unread-first = unread newest→oldest, then read newest→oldest", () => {
    const sorted = sortMergedItems(merged, "unread-first", isRead);
    // a is read (newest) so it sinks below unread b, c
    expect(sorted.map((m) => m.item.title)).toEqual(["b", "c", "a"]);
  });
});

describe("pickHero", () => {
  const none = () => false;

  it("picks the newest unread item that has an image", () => {
    const withImg = item("hero", { link: "h", pubDate: "2026-01-02T00:00:00Z", thumbnail: "img.jpg" });
    const newerNoImg = item("newer", { link: "n", pubDate: "2026-01-03T00:00:00Z" });
    const merged = mergeFeedItems([{ source: src("f", "F"), items: [withImg, newerNoImg] }]);
    // newest overall has no image → hero should be the newest-with-image
    expect(pickHero(merged, none)!.item.title).toBe("hero");
  });

  it("falls back to newest unread when none have an image", () => {
    const older = item("older", { link: "o", pubDate: "2026-01-01T00:00:00Z" });
    const newer = item("newer", { link: "n", pubDate: "2026-01-05T00:00:00Z" });
    const merged = mergeFeedItems([{ source: src("f", "F"), items: [older, newer] }]);
    expect(pickHero(merged, none)!.item.title).toBe("newer");
  });

  it("falls back to newest overall when everything is read", () => {
    const older = item("older", { link: "o", pubDate: "2026-01-01T00:00:00Z" });
    const newer = item("newer", { link: "n", pubDate: "2026-01-05T00:00:00Z", thumbnail: "i.jpg" });
    const merged = mergeFeedItems([{ source: src("f", "F"), items: [older, newer] }]);
    expect(pickHero(merged, () => true)!.item.title).toBe("newer");
  });

  it("returns null for an empty set", () => {
    expect(pickHero([], none)).toBeNull();
  });
});

describe("capPerSource", () => {
  const key = (m: MergedItem<Item>) => m.source.url;
  const mi = (title: string, url: string): MergedItem<Item> => ({ item: item(title), source: src(url, url) });

  it("keeps only the first item per source, preserving order", () => {
    const out = capPerSource(
      [mi("a1", "A"), mi("b1", "B"), mi("a2", "A"), mi("a3", "A"), mi("c1", "C")],
      key,
      1,
    );
    expect(out.map((m) => m.item.title)).toEqual(["a1", "b1", "c1"]);
  });

  it("respects a higher per-source cap", () => {
    const out = capPerSource([mi("a1", "A"), mi("a2", "A"), mi("a3", "A")], key, 2);
    expect(out.map((m) => m.item.title)).toEqual(["a1", "a2"]);
  });

  it("returns the input unchanged when cap < 1", () => {
    const t = [mi("a1", "A"), mi("a2", "A")];
    expect(capPerSource(t, key, 0)).toBe(t);
  });
});

describe("interleaveMergedSources", () => {
  /** Build a merged list from "source:title" specs, in the given order. */
  function thread(...specs: string[]): MergedItem<Item>[] {
    return specs.map((s) => {
      const [source, title] = s.split(":");
      return { item: item(title, { link: title }), source: src(source, source) };
    });
  }
  const titles = (items: MergedItem<Item>[]) => items.map((m) => m.item.title);
  const sources = (items: MergedItem<Item>[]) => items.map((m) => m.source.url);
  const none = () => false;

  it("breaks up a same-source run by pulling the nearest other source forward", () => {
    // The screenshot case: 4 ZeroHedge in a row with other outlets below.
    const t = thread("zh:z1", "zh:z2", "zh:z3", "zh:z4", "npr:n1", "bbc:b1");
    const out = interleaveMergedSources(t, "latest", none);
    expect(titles(out)).toEqual(["z1", "n1", "z2", "b1", "z3", "z4"]);
    // No two consecutive same-source items until only one source remains.
    for (let i = 1; i < out.length - 1; i++) {
      expect(sources(out)[i]).not.toBe(sources(out)[i - 1]);
    }
  });

  it("preserves relative order within each source and across pulls", () => {
    const t = thread("a:a1", "a:a2", "b:b1", "b:b2", "a:a3");
    const out = interleaveMergedSources(t, "latest", none);
    expect(titles(out)).toEqual(["a1", "b1", "a2", "b2", "a3"]);
    // Per-source order is intact.
    expect(titles(out).filter((x) => x.startsWith("a"))).toEqual(["a1", "a2", "a3"]);
    expect(titles(out).filter((x) => x.startsWith("b"))).toEqual(["b1", "b2"]);
  });

  it("leaves an already-diverse list untouched", () => {
    const t = thread("a:a1", "b:b1", "a:a2", "c:c1");
    expect(titles(interleaveMergedSources(t, "latest", none))).toEqual(["a1", "b1", "a2", "c1"]);
  });

  it("is a no-op when only one source exists (nothing to interleave with)", () => {
    const t = thread("a:a1", "a:a2", "a:a3");
    expect(titles(interleaveMergedSources(t, "latest", none))).toEqual(["a1", "a2", "a3"]);
  });

  it("lets the tail run consecutively once other sources are exhausted", () => {
    const t = thread("a:a1", "a:a2", "a:a3", "a:a4", "b:b1");
    const out = interleaveMergedSources(t, "latest", none);
    expect(titles(out)).toEqual(["a1", "b1", "a2", "a3", "a4"]);
  });

  it("is idempotent — re-running on its own output changes nothing", () => {
    const t = thread("zh:z1", "zh:z2", "zh:z3", "npr:n1", "bbc:b1", "zh:z4", "zh:z5");
    const once = interleaveMergedSources(t, "latest", none);
    const twice = interleaveMergedSources(once, "latest", none);
    expect(titles(twice)).toEqual(titles(once));
  });

  it("unread-first: diversifies unread and read segments independently — no read item climbs above the boundary", () => {
    // Sorted unread-first: unread [a1,a2,b1] then read [a3,a4,c1].
    const t = thread("a:a1", "a:a2", "b:b1", "a:a3", "a:a4", "c:c1");
    const read = new Set(["a3", "a4", "c1"]);
    const isRead = (it: Item) => read.has(it.link!);
    const out = interleaveMergedSources(t, "unread-first", isRead);
    // Unread segment interleaved among itself…
    expect(titles(out).slice(0, 3)).toEqual(["a1", "b1", "a2"]);
    // …read segment interleaved among itself, strictly after all unread.
    expect(titles(out).slice(3)).toEqual(["a3", "c1", "a4"]);
    expect(out.filter((m) => isRead(m.item)).length).toBe(3);
    // Unread count is unchanged by the pass.
    expect(countUnread(out, isRead)).toBe(countUnread(t, isRead));
  });

  it("handles empty and single-item lists", () => {
    expect(interleaveMergedSources([], "latest", none)).toEqual([]);
    const one = thread("a:a1");
    expect(titles(interleaveMergedSources(one, "unread-first", none))).toEqual(["a1"]);
  });
});

describe("interleaveMergedSources — source-dominance cap", () => {
  function thread(...specs: string[]): MergedItem<Item>[] {
    return specs.map((s) => {
      const [source, title] = s.split(":");
      return { item: item(title, { link: title }), source: src(source, source) };
    });
  }
  const titles = (items: MergedItem<Item>[]) => items.map((m) => m.item.title);
  const sources = (items: MergedItem<Item>[]) => items.map((m) => m.source.url);
  const none = () => false;
  const cap = { window: 4, maxPerWindow: 1 };

  /** Assert the sliding-window quota holds across the whole output. */
  function assertQuota(items: MergedItem<Item>[], window: number, maxPerWindow: number) {
    for (let i = 0; i + window <= items.length; i++) {
      const counts = new Map<string, number>();
      for (const m of items.slice(i, i + window)) {
        counts.set(m.source.url, (counts.get(m.source.url) ?? 0) + 1);
      }
      for (const [, n] of counts) expect(n).toBeLessThanOrEqual(maxPerWindow);
    }
  }

  it("bounds a firehose source's local share so it never dominates the mix", () => {
    // ZeroHedge floods; NPR/BBC/WSJ each have one. With window=4/max=1 no source
    // appears twice inside any 4-card window until the others are spent.
    const t = thread(
      "zh:z1", "zh:z2", "zh:z3", "zh:z4", "zh:z5",
      "npr:n1", "bbc:b1", "wsj:w1",
    );
    const out = interleaveMergedSources(t, "latest", none, cap);
    // The four distinct outlets are spread across the front, not tailed.
    expect(out.length).toBe(8);
    // First window of 4 has 4 distinct sources.
    expect(new Set(sources(out).slice(0, 4)).size).toBe(4);
    // Every window of 4 respects the quota where it can be satisfied…
    // (the pure tail once only ZeroHedge remains is exempt — checked separately).
    const firstZhTailIndex = sources(out).lastIndexOf("npr") + 1; // after last non-zh runs out
    assertQuota(out.slice(0, firstZhTailIndex + 3), 4, 1);
  });

  it("preserves per-source relative order under the cap", () => {
    const t = thread("zh:z1", "zh:z2", "zh:z3", "npr:n1", "npr:n2", "bbc:b1");
    const out = interleaveMergedSources(t, "latest", none, cap);
    expect(titles(out).filter((x) => x.startsWith("z"))).toEqual(["z1", "z2", "z3"]);
    expect(titles(out).filter((x) => x.startsWith("n"))).toEqual(["n1", "n2"]);
  });

  it("is idempotent — re-running the capped pass on its own output changes nothing", () => {
    const t = thread(
      "zh:z1", "zh:z2", "zh:z3", "zh:z4",
      "npr:n1", "bbc:b1", "wsj:w1", "cnn:c1",
    );
    const once = interleaveMergedSources(t, "latest", none, cap);
    const twice = interleaveMergedSources(once, "latest", none, cap);
    expect(titles(twice)).toEqual(titles(once));
  });

  it("lets one source run consecutively once it's all that remains (quota unsatisfiable)", () => {
    const t = thread("zh:z1", "zh:z2", "zh:z3", "zh:z4", "npr:n1");
    const out = interleaveMergedSources(t, "latest", none, cap);
    // NPR breaks up the front; the ZeroHedge tail necessarily runs on.
    expect(titles(out)[0]).toBe("z1");
    expect(titles(out).filter((x) => x.startsWith("z"))).toEqual(["z1", "z2", "z3", "z4"]);
    expect(titles(out).includes("n1")).toBe(true);
  });

  it("unread-first: the cap applies within each segment; read never crosses the divider", () => {
    // Unread [z1,z2,z3,n1,b1], read [z4,z5].
    const t = thread("zh:z1", "zh:z2", "zh:z3", "npr:n1", "bbc:b1", "zh:z4", "zh:z5");
    const read = new Set(["z4", "z5"]);
    const isRead = (it: Item) => read.has(it.link!);
    const out = interleaveMergedSources(t, "unread-first", isRead, cap);
    // Read items stay strictly at the tail.
    expect(titles(out).slice(-2).sort()).toEqual(["z4", "z5"]);
    expect(out.slice(0, 5).every((m) => !isRead(m.item))).toBe(true);
    expect(countUnread(out, isRead)).toBe(countUnread(t, isRead));
  });

  it("no cap (omitted) keeps the original max-run-of-1 behaviour", () => {
    const t = thread("zh:z1", "zh:z2", "zh:z3", "zh:z4", "npr:n1", "bbc:b1");
    const capped = titles(interleaveMergedSources(t, "latest", none, cap));
    const linear = titles(interleaveMergedSources(t, "latest", none));
    // The linear pass matches the documented screenshot case…
    expect(linear).toEqual(["z1", "n1", "z2", "b1", "z3", "z4"]);
    // …and the capped pass differs (it spreads more aggressively).
    expect(capped).not.toEqual(linear);
  });
});

describe("countUnread", () => {
  it("counts only unread items across the merged set", () => {
    const merged = mergeFeedItems([
      { source: src("f1", "F1"), items: [item("a", { link: "a" }), item("b", { link: "b" })] },
      { source: src("f2", "F2"), items: [item("c", { link: "c" })] },
    ]);
    const read = new Set(["b"]);
    expect(countUnread(merged, (it) => read.has(it.link!))).toBe(2);
    expect(countUnread(merged, () => false)).toBe(3);
    expect(countUnread(merged, () => true)).toBe(0);
  });
});
