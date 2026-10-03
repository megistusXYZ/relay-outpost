import { describe, it, expect } from "vitest";
import { EMPTY_FILTERS, withFilters, filterChips, removeChip, isEmpty, readSavedViews, saveView, deleteView } from "./content-filters";

const BOB = "b".repeat(64), AMY = "a".repeat(64);
const base = { limit: 200, since: 100 };
const nameOf = (pk: string) => ({ [BOB]: "Bob", [AMY]: "Amy" } as Record<string, string>)[pk];

describe("filters the relay applies", () => {
  it("nothing chosen: the request is unchanged", () => {
    expect(withFilters(base, EMPTY_FILTERS)).toEqual(base);
    expect(isEmpty(EMPTY_FILTERS)).toBe(true);
  });

  it("kinds, people and hashtags go to the relay", () => {
    const f = { ...EMPTY_FILTERS, kinds: [1, 7], people: [BOB, AMY], hashtags: ["#Bitcoin", "nostr"] };
    expect(withFilters(base, f)).toEqual({ limit: 200, since: 100, kinds: [1, 7], authors: [BOB, AMY], "#t": ["bitcoin", "nostr"] });
  });

  it("chosen kinds win over the view's kinds; a typed author joins the chosen people", () => {
    const f = { ...EMPTY_FILTERS, kinds: [7], people: [BOB] };
    expect(withFilters({ limit: 200, kinds: [1, 1111], authors: [AMY] }, f)).toEqual({ limit: 200, kinds: [7], authors: [AMY, BOB] });
  });

  it("an id lookup is left alone", () => {
    const f = { ...EMPTY_FILTERS, kinds: [7] };
    expect(withFilters({ ids: ["x"] }, f)).toEqual({ ids: ["x"] });
  });
});

describe("chips show what you're looking at", () => {
  const f = { ...EMPTY_FILTERS, kinds: [1, 7], people: [BOB], hashtags: ["bitcoin"] };

  it("one chip per kind of filter, in words", () => {
    expect(filterChips(f, nameOf).map((c) => c.label)).toEqual(["Kind: Note, Reaction", "From: Bob", "#bitcoin"]);
  });

  it("removing a chip removes that filter", () => {
    const chips = filterChips(f, nameOf);
    const noKinds = removeChip(f, chips[0].key);
    expect(noKinds.kinds).toEqual([]);
    expect(noKinds.people).toEqual([BOB]);
    expect(removeChip(f, "tag:bitcoin").hashtags).toEqual([]);
  });

  it("many people are summarised, not listed forever", () => {
    const many = { ...EMPTY_FILTERS, people: [BOB, AMY, "c".repeat(64), "d".repeat(64)] };
    expect(filterChips(many, nameOf)[0].label).toBe("From: Bob, Amy +2");
  });
});

describe("saved views", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const f = { ...EMPTY_FILTERS, kinds: [1], hashtags: ["spam"] };

  it("save one with a name and get it back, per relay", () => {
    saveView("wss://a", "Spam watch", { query: "buy now", view: "notes", filters: f }, storage);
    const views = readSavedViews("wss://a", storage);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ name: "Spam watch", query: "buy now", view: "notes", filters: f });
    expect(readSavedViews("wss://b", storage)).toEqual([]);
  });

  it("saving the same name again replaces it", () => {
    saveView("wss://a", "spam watch", { query: "", view: "all", filters: EMPTY_FILTERS }, storage);
    expect(readSavedViews("wss://a", storage)).toHaveLength(1);
    expect(readSavedViews("wss://a", storage)[0].query).toBe("");
  });

  it("delete one", () => {
    deleteView("wss://a", readSavedViews("wss://a", storage)[0].id, storage);
    expect(readSavedViews("wss://a", storage)).toEqual([]);
  });

  it("a damaged store reads as no views, not a crash", () => {
    store.set("ro_content_views:wss://c", "{not json");
    expect(readSavedViews("wss://c", storage)).toEqual([]);
  });
});
