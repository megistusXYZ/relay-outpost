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
import { fetchServerFeedSample, readRecentSample } from "./feed-sample-source";

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
    expect(got?.map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it("drops a note whose signature doesn't check out", async () => {
    const real = signed("gm");
    const forged = { ...signed("original"), content: "changed after signing" };
    const got = await fetchServerFeedSample(respond(200, { notes: [forged, real, { id: "junk" }] }));
    expect(got?.map((e) => e.id)).toEqual([real.id]);
  });

  it("the server found no trusted notes: an empty answer, not a failure", async () => {
    expect(await fetchServerFeedSample(respond(200, { notes: [] }))).toEqual([]);
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

describe("readRecentSample", () => {
  const mine = [signed("from my own sample")];
  const theirs = [signed("from the server")];

  it("default trust: the server's sample is enough, and it's already vetted", async () => {
    const direct = vi.fn(async () => mine);
    expect(await readRecentSample({ lens: "default", server: async () => theirs, direct })).toEqual({ notes: theirs, vetted: true });
    expect(direct).not.toHaveBeenCalled();
  });

  it("default trust, server found nothing: that's the answer", async () => {
    const direct = vi.fn(async () => mine);
    expect(await readRecentSample({ lens: "default", server: async () => [], direct })).toEqual({ notes: [], vetted: true });
    expect(direct).not.toHaveBeenCalled();
  });

  it("the server couldn't answer, or failed outright: the app takes its own sample, which nobody has vetted", async () => {
    expect(await readRecentSample({ lens: "default", server: async () => null, direct: async () => mine })).toEqual({ notes: mine, vetted: false });
    expect(await readRecentSample({ lens: "default", server: async () => { throw new Error("boom"); }, direct: async () => mine })).toEqual({ notes: mine, vetted: false });
  });

  it("the viewer's own trust map decides: the server's pick isn't theirs, so the app samples", async () => {
    const server = vi.fn(async () => theirs);
    expect(await readRecentSample({ lens: "own", server, direct: async () => mine })).toEqual({ notes: mine, vetted: false });
    expect(server).not.toHaveBeenCalled();
  });
});

describe("the Feed tile uses it", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "discover-data.ts"), "utf8");

  it("the recent sample goes through readRecentSample, by lens", () => {
    expect(src).toMatch(/readRecentSample\(\{\s*lens: chooseDiscoverLens\(trustOpts\),\s*server: \(\) => fetchServerFeedSample\(\)/);
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
    expect(src).toMatch(/vetted: recent\.vetted \? new Set\(recent\.notes\.map\(\(e\) => e\.pubkey\)\) : undefined/);
  });
});
