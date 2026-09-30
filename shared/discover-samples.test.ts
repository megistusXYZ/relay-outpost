/**
 * Discover's broad samples for Articles, Events and Videos: the newest of
 * each kind from anyone on the fast relays, of which only trusted people's
 * are shown. Measured 2026-09-30, per visitor: articles 981 KB across three
 * relays (36 of 83 by trusted people), events 118 KB, videos 132 KB. The
 * server takes each sample once and keeps the trusted part
 * (server/trusted-sample.ts), as it does for the Feed tile.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { DISCOVER_SAMPLES, SAMPLE_RELAYS, TOP_LOOKUP_RELAYS, isDiscoverSampleName, isSignedEvent, sampleRequests, trustedSample } from "./discover-samples";

const hex = (c: string, n = 64) => c.repeat(n);
const ALICE = hex("a");
const BOB = hex("b");
const ev = (id: string, pubkey: string, kind: number, created_at: number, tags: string[][] = [], over: Record<string, unknown> = {}) =>
  ({ id: hex(id), pubkey, created_at, kind, tags, content: "body", sig: hex("f", 128), ...over });

describe("trustedSample", () => {
  const articles = DISCOVER_SAMPLES.articles;

  it("keeps trusted people's events of the sample's kinds, newest first", () => {
    const out = trustedSample([
      ev("1", ALICE, 30023, 100, [["d", "one"]]),
      ev("2", BOB, 30023, 300, [["d", "spam"]]),
      ev("3", ALICE, 30023, 200, [["d", "two"]]),
      ev("4", ALICE, 1, 400),
    ], new Set([ALICE]), articles);
    expect(out.map((e) => e.id)).toEqual([hex("3"), hex("1")]);
  });

  it("an edited article appears once, in its newest version", () => {
    const out = trustedSample([
      ev("1", ALICE, 30023, 100, [["d", "essay"], ["title", "Draft"]]),
      ev("2", ALICE, 30023, 300, [["d", "essay"], ["title", "Final"]]),
      ev("3", ALICE, 30023, 200, [["d", "essay"], ["title", "Second draft"]]),
    ], new Set([ALICE]), articles);
    expect(out.map((e) => e.id)).toEqual([hex("2")]);
  });

  it("the same title from two people is two articles", () => {
    const out = trustedSample([ev("1", ALICE, 30023, 100, [["d", "gm"]]), ev("2", BOB, 30023, 100, [["d", "gm"]])], new Set([ALICE, BOB]), articles);
    expect(out).toHaveLength(2);
  });

  it("videos that aren't addressable (kinds 21, 22) are told apart by id", () => {
    const out = trustedSample([ev("1", ALICE, 21, 100, [["d", "x"]]), ev("2", ALICE, 21, 200, [["d", "x"]])], new Set([ALICE]), DISCOVER_SAMPLES.videos);
    expect(out).toHaveLength(2);
  });

  it("one copy of an event two relays both sent", () => {
    const e = ev("1", ALICE, 30023, 100, [["d", "one"]]);
    expect(trustedSample([e, { ...e }], new Set([ALICE]), articles)).toHaveLength(1);
  });

  it("drops anything that isn't a well-formed signed event", () => {
    const bad = [ev("1", ALICE, 30023, 100, [], { sig: "short" }), ev("2", ALICE, 30023, 100, [], { tags: "x" }), { ...ev("3", ALICE, 30023, 100), id: "zz" }, null, 7];
    expect(trustedSample(bad as any, new Set([ALICE]), articles)).toEqual([]);
  });

  it("hands over no more than the sample's cap, keeping the newest", () => {
    const many = Array.from({ length: articles.max + 15 }, (_, i) => ({ ...ev("0", ALICE, 30023, i, [["d", "a" + i]]), id: i.toString(16).padStart(64, "0") }));
    const out = trustedSample(many, new Set([ALICE]), articles);
    expect(out).toHaveLength(articles.max);
    expect(out[0].created_at).toBe(articles.max + 14);
  });
});

describe("isSignedEvent", () => {
  it("accepts a signed event of an allowed kind and refuses other kinds", () => {
    expect(isSignedEvent(ev("1", ALICE, 31923, 1, [["d", "meetup"]]), [31922, 31923])).toBe(true);
    expect(isSignedEvent(ev("1", ALICE, 1, 1), [31922, 31923])).toBe(false);
  });
});

describe("sample names", () => {
  it("are articles, events, videos and images, and nothing else", () => {
    expect(["articles", "events", "videos", "images"].every(isDiscoverSampleName)).toBe(true);
    expect(isDiscoverSampleName("notes")).toBe(false);
    expect(isDiscoverSampleName("__proto__")).toBe(false);
    expect(isDiscoverSampleName("constructor")).toBe(false);
  });
});

describe("the server asks the relays what the app would ask", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "../client/src/lib/discover-data.ts"), "utf8");
  it("articles: the newest 40 long-form posts", () => {
    expect(DISCOVER_SAMPLES.articles).toMatchObject({ kinds: [30023], limit: 40 });
    expect(src).toMatch(/\{ kinds: \[KIND_LONG_FORM\], limit: 40 \}/);
  });
  it("events: the newest 60 calendar events", () => {
    expect(DISCOVER_SAMPLES.events).toMatchObject({ kinds: [31922, 31923], limit: 60 });
    expect(src).toMatch(/\{ kinds: \[KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT\], limit: 60 \}/);
  });
  it("videos: the newest 20 of every video kind", () => {
    expect(DISCOVER_SAMPLES.videos).toMatchObject({ kinds: [21, 22, 34235, 34236], limit: 20 });
    expect(src).toMatch(/\{ kinds: \[21, 22, 34235, 34236\], limit: 20 \}/);
  });
});

/**
 * Each tile also asked the relays what the most trusted people posted: the
 * same question for every visitor on the default trust list. Measured
 * 2026-09-30: 256 KB of keys uploaded per visitor for 41 KB of answers, and
 * a wait of at least a second. The server asks once.
 */
describe("sampleRequests — what the relays are asked for a sample", () => {
  const people = Array.from({ length: 400 }, (_, i) => i.toString(16).padStart(64, "0"));
  const now = 1_790_000_000;

  it("articles: the newest 40 from anyone, and the newest 30 by the 200 most trusted", () => {
    expect(sampleRequests(DISCOVER_SAMPLES.articles, now, people)).toEqual([
      { relays: SAMPLE_RELAYS, filter: { kinds: [30023], limit: 40 } },
      { relays: TOP_LOOKUP_RELAYS, filter: { kinds: [30023], authors: people.slice(0, 200), limit: 30 } },
    ]);
  });

  it("images: only the 300 most trusted people's last day, never a stranger's", () => {
    expect(sampleRequests(DISCOVER_SAMPLES.images, now, people)).toEqual([
      { relays: TOP_LOOKUP_RELAYS, filter: { kinds: [1, 20], authors: people.slice(0, 300), since: now - 86400, limit: 80 } },
    ]);
  });

  it("with nobody on the trusted list, only the broad read is left", () => {
    expect(sampleRequests(DISCOVER_SAMPLES.events, now, [])).toEqual([
      { relays: SAMPLE_RELAYS, filter: { kinds: [31922, 31923], limit: 60 } },
    ]);
    expect(sampleRequests(DISCOVER_SAMPLES.images, now, [])).toEqual([]);
  });

  it("the broad reads skip damus; the small top-people lookups ask every fast relay", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../client/src/lib/nostr.ts"), "utf8");
    const block = src.match(/export const FAST_RELAYS = \[([^\]]*)\]/)?.[1] ?? "";
    const fast = [...block.matchAll(/"(wss:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect([...TOP_LOOKUP_RELAYS].sort()).toEqual([...fast].sort());
    expect(SAMPLE_RELAYS).toEqual(fast.filter((r) => r !== "wss://relay.damus.io"));
  });
});

describe("the server asks for the top people's posts what the app would ask", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "../client/src/lib/discover-data.ts"), "utf8");
  it.each([
    ["articles", /\{ kinds: \[KIND_LONG_FORM\], authors: t\.top\.slice\(0, 200\), limit: 30 \}/],
    ["events", /\{ kinds: \[KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT\], authors: trust\.top\.slice\(0, 300\), limit: 60 \}/],
    ["videos", /\{ kinds: \[21, 22, 34235, 34236\], authors: trust\.top\.slice\(0, 200\), limit: 20 \}/],
    ["images", /\{ kinds: \[1, 20\], authors: trust\.top\.slice\(0, 300\), since, limit: 80 \}/],
    ["feed", /\{ kinds: \[1\], authors: t\.top\.slice\(0, 300\), since: Math\.floor\(Date\.now\(\) \/ 1000\) - 24 \* 3600, limit: 150 \}/],
  ])("%s", (_name, pattern) => {
    expect(src).toMatch(pattern as RegExp);
  });
});
