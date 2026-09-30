/**
 * Where the Feed tile gets its recent sample. The server hands over the
 * trusted part of one shared sample; the app takes the sample itself
 * (megabytes, measured 2026-09-30) only when the server can't answer or when
 * the viewer's own trust map decides who's trusted. Notes from the server are
 * shown only if their signatures check out.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { fetchServerFeedSample, fetchServerSample, startTrustedSample } from "./discover-sample-source";

const signed = (content: string, created_at = 1_790_000_000) =>
  finalizeEvent({ kind: 1, created_at, tags: [], content }, generateSecretKey());
// Through JSON like the wire: nostr-tools marks events it signed in this
// process as already verified, and that mark must not reach the code under test.
const respond = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) }) as any);

describe("fetchServerFeedSample", () => {
  it("asks the server and returns its notes", async () => {
    const a = signed("gm"), b = signed("pv");
    const f = respond(200, { notes: [a, b] });
    const got = await fetchServerFeedSample(f);
    expect(f.mock.calls[0][0]).toBe("/api/discover/feed-sample");
    expect(got?.events.map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it("drops a note whose signature doesn't check out", async () => {
    const real = signed("gm");
    const forged = { ...signed("original"), content: "changed after signing" };
    const got = await fetchServerFeedSample(respond(200, { notes: [forged, real, { id: "junk" }] }));
    expect(got?.events.map((e) => e.id)).toEqual([real.id]);
  });

  it("the server found no trusted notes: an empty answer, not a failure", async () => {
    expect((await fetchServerFeedSample(respond(200, { notes: [] })))?.events).toEqual([]);
  });

  it("no usable answer is null", async () => {
    const forged = { ...signed("original"), content: "changed" };
    expect(await fetchServerFeedSample(respond(503, { notes: [], error: "Couldn't" }))).toBeNull();
    expect(await fetchServerFeedSample(respond(200, { notes: [forged] }))).toBeNull();
    expect(await fetchServerFeedSample(respond(200, "<html>"))).toBeNull();
    expect(await fetchServerFeedSample(respond(200, null))).toBeNull();
    expect(await fetchServerFeedSample(vi.fn(async () => { throw new Error("offline"); }))).toBeNull();
    expect(await fetchServerFeedSample(vi.fn(async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }) as any))).toBeNull();
  });
});

/**
 * The Feed tile ranks by trust plus freshness (owner, 2026-09-30). The
 * server vetted the sample's authors, so the app doesn't look them up; the
 * server sends their trust scores with the notes instead. Without them every
 * vetted author would count as exactly the bar (0.50) and trust couldn't
 * tell them apart.
 */
describe("the trust scores that come with the feed sample", () => {
  const a = signed("gm");
  const pk = a.pubkey;

  it("are read alongside the notes", async () => {
    const got = await fetchServerFeedSample(respond(200, { notes: [a], ranks: { [pk]: 0.83 } }));
    expect(got?.ranks.get(pk)).toBe(0.83);
  });

  it("only well-formed scores are kept", async () => {
    const got = await fetchServerFeedSample(respond(200, { notes: [a], ranks: { [pk]: 1.7, ["b".repeat(64)]: "high", nope: 0.5, ["c".repeat(64)]: 0.6 } }));
    expect([...(got?.ranks ?? new Map())]).toEqual([["c".repeat(64), 0.6]]);
  });

  it("a server that sends none is fine: no scores", async () => {
    const got = await fetchServerFeedSample(respond(200, { notes: [a] }));
    expect(got?.ranks.size).toBe(0);
  });

  it("they reach the tile with the sample", async () => {
    const ranks = new Map([[pk, 0.9]]);
    const s = startTrustedSample({ lens: "default", server: async () => ({ events: [a], ranks }), direct: async () => [] });
    expect((await s.sample).ranks.get(pk)).toBe(0.9);
  });

  it("the app's own sample has none (its authors are looked up instead)", async () => {
    const s = startTrustedSample({ lens: "default", server: async () => null, direct: async () => [a] });
    expect((await s.sample).ranks.size).toBe(0);
  });
});

describe("fetchServerSample (articles, events, videos)", () => {
  const article = (title: string) =>
    finalizeEvent({ kind: 30023, created_at: 1_790_000_000, tags: [["d", title], ["title", title]], content: "body" }, generateSecretKey());

  it("asks the server for that sample and returns its events", async () => {
    const a = article("One");
    const f = respond(200, { events: [a] });
    const got = await fetchServerSample("articles", f);
    expect(f.mock.calls[0][0]).toBe("/api/discover/sample/articles");
    expect(got?.map((e) => e.id)).toEqual([a.id]);
  });

  it("drops events with a bad signature, and events of a kind the sample doesn't hold", async () => {
    const real = article("Real");
    const forged = { ...article("Original"), content: "changed after signing" };
    const note = signed("a note is not an article");
    const got = await fetchServerSample("articles", respond(200, { events: [forged, note, real] }));
    expect(got?.map((e) => e.id)).toEqual([real.id]);
  });

  it("none by trusted people is an empty answer; no usable answer is null", async () => {
    expect(await fetchServerSample("videos", respond(200, { events: [] }))).toEqual([]);
    expect(await fetchServerSample("videos", respond(503, { events: [], error: "Couldn't" }))).toBeNull();
    expect(await fetchServerSample("events", respond(200, { notes: [] }))).toBeNull();
    expect(await fetchServerSample("events", respond(200, { events: [{ ...article("x"), content: "changed" }] }))).toBeNull();
    expect(await fetchServerSample("events", vi.fn(async () => { throw new Error("offline"); }))).toBeNull();
  });
});

describe("the sample a tile ends up with", () => {
  const readTrustedSample = (sources: Parameters<typeof startTrustedSample>[0]) => startTrustedSample(sources).sample;
  const mine = [signed("from my own sample")];
  const theirs = [signed("from the server")];

  it("default trust: the server's sample is enough, and it's already vetted", async () => {
    const direct = vi.fn(async () => mine);
    expect(await readTrustedSample({ lens: "default", server: async () => theirs, direct })).toEqual({ events: theirs, vetted: true, ranks: new Map() });
    expect(direct).not.toHaveBeenCalled();
  });

  it("default trust, server found nothing: that's the answer", async () => {
    const direct = vi.fn(async () => mine);
    expect(await readTrustedSample({ lens: "default", server: async () => [], direct })).toEqual({ events: [], vetted: true, ranks: new Map() });
    expect(direct).not.toHaveBeenCalled();
  });

  it("the server couldn't answer, or failed outright: the app takes its own sample, which nobody has vetted", async () => {
    expect(await readTrustedSample({ lens: "default", server: async () => null, direct: async () => mine })).toEqual({ events: mine, vetted: false, ranks: new Map() });
    expect(await readTrustedSample({ lens: "default", server: async () => { throw new Error("boom"); }, direct: async () => mine })).toEqual({ events: mine, vetted: false, ranks: new Map() });
  });

  it("the viewer's own trust map decides: the server's pick isn't theirs, so the app samples", async () => {
    const server = vi.fn(async () => theirs);
    expect(await readTrustedSample({ lens: "own", server, direct: async () => mine })).toEqual({ events: mine, vetted: false, ranks: new Map() });
    expect(server).not.toHaveBeenCalled();
  });
});

/**
 * A tile decides two things from "did the server's sample arrive": whether
 * to look the most trusted people up itself, and whether to probe a relay.
 * Both must be decided as soon as the server has (or hasn't) answered, not
 * when the app's own read finishes: otherwise, with the server down, the
 * tile's second relay read would only start after its first (8 s + 8 s,
 * the wait #199 removed).
 */
describe("startTrustedSample", () => {
  const mine = [signed("from my own sample")];
  const theirs = [signed("from the server")];
  const never = new Promise<never>(() => {});

  it("says the server answered, with the sample", async () => {
    const s = startTrustedSample({ lens: "default", server: async () => theirs, direct: async () => mine });
    expect(await s.fromServer).toBe(true);
    expect(await s.sample).toEqual({ events: theirs, vetted: true, ranks: new Map() });
  });

  it("says the server didn't answer without waiting for the app's own read", async () => {
    const s = startTrustedSample({ lens: "default", server: async () => null, direct: () => never });
    expect(await s.fromServer).toBe(false);
  });

  it("own lens: not from the server, known at once, and the server isn't asked", async () => {
    const server = vi.fn(async () => theirs);
    const s = startTrustedSample({ lens: "own", server, direct: () => never });
    expect(await s.fromServer).toBe(false);
    expect(server).not.toHaveBeenCalled();
  });

  it("starts the app's own read only after the server couldn't answer", async () => {
    const direct = vi.fn(async () => mine);
    const s = startTrustedSample({ lens: "default", server: async () => theirs, direct });
    await s.sample;
    expect(direct).not.toHaveBeenCalled();
  });
});

describe("the Feed tile uses it", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "discover-data.ts"), "utf8");

  it("the recent sample goes through startTrustedSample, by lens", () => {
    expect(src).toMatch(/startTrustedSample\(\{\s*lens: chooseDiscoverLens\(trustOpts\),\s*server: \(\) => fetchServerFeedSample\(\)/);
  });

  it("the 300-note read only exists as the fallback", () => {
    const reads = src.match(/limit: 300 \}/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(src).toMatch(/direct: \(\) => collectOnce\(sampleRelays\(getRelaysForPurpose\("notes"\)\), \{ kinds: \[1\], since: sinceSecs, limit: 300 \}/);
  });
});

describe("the Feed tile doesn't re-ask about people the server vetted", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "discover-data.ts"), "utf8");
  it("passes the server sample's authors to the trust check as vetted", () => {
    expect(src).toMatch(/vetted: vettedAuthors\(recent\)/);
  });
});

describe("Articles, Events and Videos take their broad sample from the server too", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "discover-data.ts"), "utf8");

  it.each([
    ["articles", /broadSample\("articles", \(\) => collectOnce\(sampleRelays\(FAST_RELAYS\), \{ kinds: \[KIND_LONG_FORM\], limit: 40 \}/],
    ["events", /broadSample\("events", \(\) => collectOnce\(sampleRelays\(FAST_RELAYS\), \{ kinds: \[KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT\], limit: 60 \}/],
    ["videos", /broadSample\("videos", \(\) => collectOnce\(sampleRelays\(FAST_RELAYS\), \{ kinds: \[21, 22, 34235, 34236\], limit: 20 \}/],
  ])("%s: the app's own read is only the fallback", (_name, pattern) => {
    expect(src).toMatch(pattern as RegExp);
  });

  it("the server's sample goes through the same lens check and signature check as the Feed's", () => {
    expect(src).toMatch(/function broadSample\([^)]*\)[^{]*\{\s*return startTrustedSample\(\{\s*lens: chooseDiscoverLens\(trustOpts\),\s*server: \(\) => fetchServerSample\(name\)/);
  });

  it("no tile asks for scores of people the server vetted", () => {
    expect(src.match(/vetted: vettedAuthors\(/g) ?? []).toHaveLength(5); // feed, articles, events, videos, images
  });

  it("with the server's sample in hand, no tile looks the most trusted people up itself or probes a relay", () => {
    // Every top-people lookup sits behind "the server's sample isn't in hand".
    const lookups = src.match(/authors: t(?:rust)?\.top\.slice\(0, \d+\)/g) ?? [];
    const guarded = src.match(/(?:!sample\.vetted|!fromServer|sample\.vetted\s*\?\s*sample\.events\s*:)[^;]*?authors: t(?:rust)?\.top\.slice\(0, \d+\)/g) ?? [];
    // Marketplace reads Conduit's relay and has no server sample: its lookup stays.
    expect(lookups.length - guarded.length).toBe(1);
    expect(guarded).toHaveLength(5);
    expect(src.match(/servedGiven\(started, FAST_RELAYS\)/g) ?? []).toHaveLength(4); // articles, events, videos, images
  });
});
