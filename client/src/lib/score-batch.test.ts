/**
 * Trust-score lookups made at the same moment go out as one request.
 * Measured 2026-09-30 on a cold Discover load: eight requests, five of them
 * in the same instant (Videos, Articles, Events and Feed each asking on their
 * own, in chunks of 50), against a limit of 30 a minute per IP.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { createScoreBatcher } from "./score-batch";
import { WOT_BATCH_MAX } from "@shared/wot-batch";

const pk = (n: number) => n.toString(16).padStart(64, "0");
const people = (from: number, count: number) => Array.from({ length: count }, (_, i) => pk(from + i));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A server that scores everyone 0.9, recording each request. */
function setup(opts: { maxPerRequest?: number; fail?: (chunk: string[]) => boolean } = {}) {
  const requests: string[][] = [];
  const send = vi.fn(async (chunk: string[]) => {
    requests.push(chunk);
    await new Promise((r) => setTimeout(r, 100));
    return new Map(opts.fail?.(chunk) ? [] : chunk.map((p) => [p, 0.9] as const));
  });
  const batcher = createScoreBatcher({ send, maxPerRequest: opts.maxPerRequest ?? 200, windowMs: 30 });
  return { batcher, requests };
}

describe("createScoreBatcher", () => {
  it("four tiles asking in the same instant make one request", async () => {
    const { batcher, requests } = setup();
    const asks = [batcher.ask(people(1, 14)), batcher.ask(people(100, 63)), batcher.ask(people(200, 28)), batcher.ask(people(300, 51))];
    await vi.advanceTimersByTimeAsync(200);
    const answers = await Promise.all(asks);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveLength(14 + 63 + 28 + 51);
    expect(answers[1].get(pk(100))).toBe(0.9);
    expect(answers[3].get(pk(350))).toBe(0.9);
  });

  it("each caller gets an answer about everyone it asked for", async () => {
    const { batcher } = setup();
    const a = batcher.ask(people(1, 3));
    const b = batcher.ask(people(10, 2));
    await vi.advanceTimersByTimeAsync(200);
    expect([...(await a).keys()].sort()).toEqual(expect.arrayContaining(people(1, 3)));
    expect([...(await b).keys()].sort()).toEqual(expect.arrayContaining(people(10, 2)));
  });

  it("someone asked about twice in the same moment is sent once", async () => {
    const { batcher, requests } = setup();
    const a = batcher.ask([pk(1), pk(2)]);
    const b = batcher.ask([pk(2), pk(3)]);
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([a, b]);
    expect(requests).toEqual([[pk(1), pk(2), pk(3)]]);
    expect((await b).get(pk(2))).toBe(0.9);
  });

  it("someone already being asked about isn't asked again by a later caller", async () => {
    const { batcher, requests } = setup();
    const a = batcher.ask([pk(1), pk(2)]);
    await vi.advanceTimersByTimeAsync(60); // the first request is out, not yet answered
    const b = batcher.ask([pk(2), pk(3)]);
    await vi.advanceTimersByTimeAsync(300);
    await a;
    expect(requests).toEqual([[pk(1), pk(2)], [pk(3)]]);
    expect((await b).get(pk(2))).toBe(0.9);
    expect((await b).get(pk(3))).toBe(0.9);
  });

  it("a caller that arrives later gets its own request", async () => {
    const { batcher, requests } = setup();
    const a = batcher.ask(people(1, 5));
    await vi.advanceTimersByTimeAsync(400);
    const b = batcher.ask(people(50, 5));
    await vi.advanceTimersByTimeAsync(400);
    await Promise.all([a, b]);
    expect(requests).toHaveLength(2);
  });

  it("no request carries more people than the server takes", async () => {
    const { batcher, requests } = setup({ maxPerRequest: 200 });
    const a = batcher.ask(people(1, 450));
    await vi.advanceTimersByTimeAsync(400);
    const got = await a;
    expect(requests.map((r) => r.length)).toEqual([200, 200, 50]);
    expect(got.size).toBe(450);
  });

  it("a request that fails leaves its people without an answer, for every caller, and nobody else", async () => {
    const { batcher } = setup({ maxPerRequest: 2, fail: (chunk) => chunk.includes(pk(1)) });
    const a = batcher.ask([pk(1), pk(2)]);
    const b = batcher.ask([pk(3)]);
    await vi.advanceTimersByTimeAsync(400);
    expect((await a).size).toBe(0);
    expect((await b).get(pk(3))).toBe(0.9);
  });

  it("asking about nobody asks nothing", async () => {
    const { batcher, requests } = setup();
    expect((await batcher.ask([])).size).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(requests).toEqual([]);
  });
});

describe("the app and the server agree on how many people one request carries", () => {
  const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");

  it("the app splits by the shared cap and the server takes exactly that many", () => {
    expect(WOT_BATCH_MAX).toBeGreaterThanOrEqual(150); // one Discover moment: 144 people measured
    expect(read("./brainstorm-search.ts")).toMatch(/maxPerRequest: WOT_BATCH_MAX/);
    expect(read("../../../server/routes.ts")).toMatch(/pubkeys\.slice\(0, WOT_BATCH_MAX\)/);
  });

  it("every lookup goes through the batcher", () => {
    const src = read("./brainstorm-search.ts");
    expect(src).toMatch(/send: fetchWotChunk/);
    expect(src.match(/fetchWotChunk\(/g) ?? []).toHaveLength(1); // its definition only
  });
});
