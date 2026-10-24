/**
 * Which curated list a screen shows (lib/curated-lists-source.ts): the
 * server's when it answered with entries, the built-in copy when it didn't.
 * Never an empty list because the server couldn't be reached.
 */
import { describe, it, expect } from "vitest";
import { pickCurated, fetchCuratedLists, curatedNow, rememberCurated } from "./curated-lists-source";
import { CURATED_LISTS } from "@shared/curated-lists";

const room = { url: "wss://new.example", name: "New", tagline: "A new room" };
const feed = { name: "New feed", url: "https://new.example/rss", category: "World" };

describe("pickCurated", () => {
  it("the server's lists when it answered", () => {
    const got = pickCurated({ starterCommunities: [room], suggestedFeeds: [feed] });
    expect(got.starterCommunities).toEqual([room]);
    expect(got.suggestedFeeds).toEqual([feed]);
  });
  it("the built-in lists when it didn't", () => {
    expect(pickCurated(null)).toEqual(CURATED_LISTS);
  });
  it("per list: one missing or empty from the server falls back on its own", () => {
    const got = pickCurated({ starterCommunities: [room] });
    expect(got.starterCommunities).toEqual([room]);
    expect(got.suggestedFeeds).toEqual(CURATED_LISTS.suggestedFeeds);
    expect(pickCurated({ starterCommunities: [], suggestedFeeds: [feed] }).starterCommunities).toEqual(CURATED_LISTS.starterCommunities);
  });
});

describe("fetchCuratedLists", () => {
  it("parses what the server sent", async () => {
    const got = await fetchCuratedLists(async () => ({ ok: true, json: async () => ({ starterCommunities: [room, { url: "bad" }] }) }));
    expect(got?.starterCommunities).toEqual([room]);
  });
  it("a failed or odd answer is null (so the screen uses the built-in list)", async () => {
    expect(await fetchCuratedLists(async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(await fetchCuratedLists(async () => { throw new TypeError("offline"); })).toBeNull();
    expect(await fetchCuratedLists(async () => ({ ok: true, json: async () => "<html>" }))).toBeNull();
  });
});

describe("the other lists, and code that isn't a screen", () => {
  it("each list falls back on its own, shows included", () => {
    const hex = "b".repeat(64);
    const got = pickCurated({ mutedSellers: [hex], podcastShows: {} });
    expect(got.mutedSellers).toEqual([hex]);
    expect(got.podcastShows).toEqual(CURATED_LISTS.podcastShows);
    expect(got.suggestedPeople).toEqual(CURATED_LISTS.suggestedPeople);
  });

  it("curatedNow: the built-in lists until the server's arrive, then the server's", () => {
    expect(curatedNow()).toEqual(CURATED_LISTS);
    const hex = "c".repeat(64);
    rememberCurated({ mutedSellers: [hex] });
    expect(curatedNow().mutedSellers).toEqual([hex]);
    expect(curatedNow().suggestedFeeds).toEqual(CURATED_LISTS.suggestedFeeds);
    rememberCurated(null);
    expect(curatedNow().mutedSellers).toEqual([hex]);
  });
});
