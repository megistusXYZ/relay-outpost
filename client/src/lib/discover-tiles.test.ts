/**
 * The Discover bento's one hard rule: a tile may say "nothing new" ONLY after
 * someone actually answered.
 *
 * Every tile on /discover is a live claim about a remote source, which makes
 * the page four chances to repeat the defect RELAY_REACHABILITY.md documents:
 * data / genuinely empty / WE NEVER GOT TO ASK, with the third collapsing into
 * the second. These tests pin the resolver so no tile can be written with two
 * states.
 */
import { describe, it, expect } from "vitest";
import { resolveTile, rankTopics, pickNextUpcoming, markRising, pickImageShelf, isSensitiveMedia, type TileState } from "./discover-tiles";
import type { Reached } from "./relay-reach";

const reached = <T,>(data: T): Reached<T> => ({ data, reached: true });
const unreached = <T,>(empty: T): Reached<T> => ({ data: empty, reached: false });

describe("resolveTile", () => {
  it("never renders empty when we never got to ask — the whole bug", () => {
    // A dead relay hands back its `empty` value with reached:false. Rendering
    // that as "Nothing new" is the exact confident-wrong-claim this page must
    // not make four times over.
    expect(resolveTile(unreached([])).status).toBe("unreachable");
  });

  it("says empty only after a positive answer", () => {
    expect(resolveTile(reached([])).status).toBe("empty");
  });

  it("renders content when there is some", () => {
    const t = resolveTile(reached([{ id: "a" }]));
    expect(t.status).toBe("ready");
    expect(t.data).toEqual([{ id: "a" }]);
  });

  it("treats a refusal as not-an-answer even though the socket opened", () => {
    // The Buzz case from relay-reach.ts: an auth-required relay accepts the
    // WebSocket happily (reached:true) and then declines the REQ. `data` is NOT
    // an answer, and "Nothing new" would be a false claim about a room full of
    // content.
    const t = resolveTile({ data: [], reached: true, refusedReason: "restricted: not a relay member" });
    expect(t.status).toBe("unreachable");
    expect(t.detail).toContain("restricted");
  });

  it("a refusal with data still present does not pretend to be ready", () => {
    // Partial reads before the refusal must not upgrade the claim.
    const t = resolveTile({ data: [{ id: "a" }], reached: true, refusedReason: "auth-required" });
    expect(t.status).toBe("unreachable");
  });

  it("is loading before the fetch settles", () => {
    expect(resolveTile(undefined).status).toBe("loading");
    expect(resolveTile(null).status).toBe("loading");
  });

  it("treats a null payload like an empty one — reached decides, not the shape", () => {
    expect(resolveTile(reached<null | { id: string }[]>(null)).status).toBe("empty");
  });

  it("exposes the states a tile component can exhaustively switch on", () => {
    const statuses = new Set<TileState<unknown>["status"]>([
      resolveTile(undefined).status,
      resolveTile(unreached([])).status,
      resolveTile(reached([])).status,
      resolveTile(reached([1])).status,
    ]);
    expect([...statuses].sort()).toEqual(["empty", "loading", "ready", "unreachable"]);
  });
});

describe("rankTopics", () => {
  const note = (pubkey: string, tags: string[]) =>
    ({ pubkey, tags: tags.map((t) => ["t", t]) }) as any;

  it("ranks by DISTINCT authors, so one spammer repeating a tag counts once", () => {
    const ranked = rankTopics([
      note("a", ["bitcoin"]), note("b", ["bitcoin"]), note("c", ["bitcoin"]),
      note("spam", ["shill"]), note("spam", ["shill"]), note("spam", ["shill"]), note("spam", ["shill"]),
      note("a", ["nostr"]), note("b", ["nostr"]),
    ]);
    expect(ranked.map((r) => r.tag)).toEqual(["bitcoin", "nostr"]);
    expect(ranked[0].authors).toBe(3);
  });

  it("needs at least two authors — one voice is not a trend", () => {
    expect(rankTopics([note("a", ["solo"])])).toEqual([]);
  });

  it("folds case and caps the list", () => {
    const notes = [
      note("a", ["Nostr"]), note("b", ["nostr"]), note("c", ["NOSTR"]),
      note("a", ["art"]), note("b", ["art"]),
      note("a", ["music"]), note("b", ["music"]),
      note("a", ["books"]), note("b", ["books"]),
      note("a", ["games"]), note("b", ["games"]),
      note("a", ["food"]), note("b", ["food"]),
    ];
    const ranked = rankTopics(notes, { top: 5 });
    expect(ranked).toHaveLength(5);
    // Three spellings, one topic, three distinct authors — ranked first.
    expect(ranked[0]).toEqual({ tag: "nostr", authors: 3 });
  });

  it("drops unusable tags: empty, numeric, over-long", () => {
    const ranked = rankTopics([
      note("a", ["", "12345", "x".repeat(40), "ok"]),
      note("b", ["", "12345", "x".repeat(40), "ok"]),
    ]);
    expect(ranked.map((r) => r.tag)).toEqual(["ok"]);
  });
});

describe("pickNextUpcoming", () => {
  const NOW = 1_700_000_000;
  const ev = (over: object) => ({ id: Math.random().toString(), title: "t", ...over }) as any;

  it("picks the soonest event that has not started yet", () => {
    const soon = ev({ startTime: NOW + 3600 });
    const later = ev({ startTime: NOW + 86400 });
    expect(pickNextUpcoming([later, soon], NOW)).toBe(soon);
  });

  it("reads all-day dates (31922) from startDate", () => {
    const d = new Date((NOW + 86400) * 1000).toISOString().slice(0, 10);
    const allDay = ev({ startDate: d });
    expect(pickNextUpcoming([allDay], NOW)).toBe(allDay);
  });

  it("keeps an event that started within the last hour (in-progress grace)", () => {
    const justStarted = ev({ startTime: NOW - 1800 });
    expect(pickNextUpcoming([justStarted], NOW)).toBe(justStarted);
  });

  it("drops the past and answers null when nothing is ahead", () => {
    expect(pickNextUpcoming([ev({ startTime: NOW - 86400 })], NOW)).toBeNull();
    expect(pickNextUpcoming([ev({})], NOW)).toBeNull();
  });
});

describe("markRising", () => {
  const t = (tag: string, authors: number) => ({ tag, authors });

  it("a topic whose distinct-author count grew is rising", () => {
    const out = markRising([t("nostr", 5), t("art", 2)], [t("nostr", 3), t("art", 2)]);
    expect(out).toEqual([
      { tag: "nostr", authors: 5, rising: true },
      { tag: "art", authors: 2, rising: false },
    ]);
  });

  it("a topic with no previous snapshot claims nothing", () => {
    expect(markRising([t("new", 4)], [])).toEqual([{ tag: "new", authors: 4, rising: false }]);
    expect(markRising([t("new", 4)], undefined)).toEqual([{ tag: "new", authors: 4, rising: false }]);
  });

  it("shrinking or equal is never rising", () => {
    const out = markRising([t("fade", 2)], [t("fade", 5)]);
    expect(out[0].rising).toBe(false);
  });
});

describe("pickImageShelf", () => {
  const img = (id: string, authorPk: string, timeMs: number) => ({ id, url: `https://x/${id}.jpg`, authorPk, timeMs });

  it("prefers one image per author, newest first — a shelf of eight from one poster is a profile, not a discovery", () => {
    const picked = pickImageShelf([
      img("a1", "alice", 3000), img("a2", "alice", 2900),
      img("b1", "bob", 2000), img("c1", "carol", 1000),
    ], 3);
    expect(picked.map((p) => p.id)).toEqual(["a1", "b1", "c1"]);
  });

  it("fills remaining slots with repeat authors once variety is exhausted", () => {
    const picked = pickImageShelf([img("a1", "alice", 3000), img("a2", "alice", 2900)], 3);
    expect(picked.map((p) => p.id)).toEqual(["a1", "a2"]);
  });

  it("caps at max and returns [] for no candidates", () => {
    const many = Array.from({ length: 20 }, (_, i) => img(`e${i}`, `pk${i}`, i));
    expect(pickImageShelf(many, 8)).toHaveLength(8);
    expect(pickImageShelf([], 8)).toEqual([]);
  });
});

describe("isSensitiveMedia", () => {
  const ev = (tags: string[][], content = "") => ({
    id: "e", pubkey: "p", kind: 20, tags, content, created_at: 0, sig: "",
  }) as unknown as import("nostr-tools").Event;

  it("respects a NIP-36 content-warning tag regardless of reason", () => {
    expect(isSensitiveMedia(ev([["content-warning", "nudity"]]))).toBe(true);
    expect(isSensitiveMedia(ev([["content-warning"]]))).toBe(true);
  });

  it("catches self-labelled nsfw hashtags, case-insensitively", () => {
    expect(isSensitiveMedia(ev([["t", "NSFW"]]))).toBe(true);
    expect(isSensitiveMedia(ev([["t", "porn"]]))).toBe(true);
    expect(isSensitiveMedia(ev([["t", "photography"]]))).toBe(false);
  });

  it("catches an nsfw word in the caption, but not substrings of other words", () => {
    expect(isSensitiveMedia(ev([], "late night #nsfw drop"))).toBe(true);
    expect(isSensitiveMedia(ev([], "sunset over the bay"))).toBe(false);
  });

  it("unlabelled clean posts pass", () => {
    expect(isSensitiveMedia(ev([["t", "art"]], "a chart of relay counts"))).toBe(false);
  });
});
