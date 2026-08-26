import { describe, it, expect } from "vitest";
import {
  packEdition,
  unpackEdition,
  mergeEditions,
  editionItemKey,
  NEWS_EDITION_CAP,
} from "./news-edition";
import type { MergedItem } from "./rss-merge";

const mk = (id: string, url = "https://feed.example/rss"): MergedItem =>
  ({ item: { id, title: `t-${id}`, link: `https://x/${id}` } as any, source: { url } });

describe("packEdition / unpackEdition", () => {
  it("round-trips renderable items", () => {
    const items = [mk("a"), mk("b")];
    const raw = packEdition(items, 1000)!;
    const back = unpackEdition(raw);
    expect(back.map((m) => (m.item as any).id)).toEqual(["a", "b"]);
  });

  it("caps the stored count", () => {
    const many = Array.from({ length: NEWS_EDITION_CAP + 50 }, (_, i) => mk(`n${i}`));
    const back = unpackEdition(packEdition(many, 1)!);
    expect(back.length).toBe(NEWS_EDITION_CAP);
  });

  it("returns null when there is nothing worth storing", () => {
    expect(packEdition([], 1)).toBeNull();
    expect(packEdition([{ item: null, source: null } as any], 1)).toBeNull();
  });

  it("never throws on malformed / missing / wrong-version input", () => {
    expect(unpackEdition(null)).toEqual([]);
    expect(unpackEdition("not json")).toEqual([]);
    expect(unpackEdition(JSON.stringify({ v: 2, items: [mk("a")] }))).toEqual([]);
    expect(unpackEdition(JSON.stringify({ v: 1, items: "nope" }))).toEqual([]);
  });

  it("strips the heavy article body so the snapshot stays small", () => {
    const heavy: MergedItem = {
      item: { id: "big", title: "t", fullContent: "x".repeat(50000), description: "y".repeat(1000) } as any,
      source: { url: "https://f/rss" },
    };
    const back = unpackEdition(packEdition([heavy], 1)!);
    const it = back[0].item as any;
    expect(it.fullContent).toBeUndefined();
    expect(it.description.length).toBeLessThanOrEqual(400);
    expect(it.title).toBe("t"); // card fields kept
  });

  it("drops items without a source url on the way back in", () => {
    const raw = JSON.stringify({ v: 1, ts: 1, items: [mk("a"), { item: { id: "b" }, source: {} }] });
    expect(unpackEdition(raw).map((m) => (m.item as any).id)).toEqual(["a"]);
  });
});

describe("mergeEditions", () => {
  it("returns live untouched when nothing is remembered", () => {
    const live = [mk("a")];
    expect(mergeEditions(live, [])).toBe(live);
  });

  it("shows the remembered edition when live is still empty (instant paint)", () => {
    const remembered = [mk("a"), mk("b")];
    expect(mergeEditions([], remembered)).toBe(remembered);
  });

  it("appends only remembered items the live set doesn't already have", () => {
    const live = [mk("a"), mk("b")];
    const remembered = [mk("b"), mk("c")]; // b is a dup
    const merged = mergeEditions(live, remembered);
    expect(merged.map((m) => (m.item as any).id)).toEqual(["a", "b", "c"]);
  });

  it("converges to exactly live once live is a superset (no leftovers)", () => {
    const live = [mk("a"), mk("b"), mk("c")];
    const remembered = [mk("a"), mk("b")];
    expect(mergeEditions(live, remembered)).toBe(live);
  });
});

describe("editionItemKey", () => {
  it("prefers guid, then id, then link", () => {
    expect(editionItemKey({ item: { guid: "g", id: "i", link: "l" } as any, source: { url: "u" } })).toBe("g");
    expect(editionItemKey({ item: { id: "i", link: "l" } as any, source: { url: "u" } })).toBe("i");
    expect(editionItemKey({ item: { link: "l" } as any, source: { url: "u" } })).toBe("l");
  });
});
