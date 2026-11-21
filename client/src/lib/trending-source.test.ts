import { describe, it, expect, vi } from "vitest";
import { overallRanking, OVERALL_WAIT_MS } from "./trending-source";

/**
 * Trending has one source, an outside ranking. Asking it has three outcomes,
 * and the page must be able to tell them apart: posts, an answer with
 * nothing in it, and no answer at all. Until 2026-11-21 a second outside
 * service stood in when the first could not answer; it closed.
 */
describe("Trending's ranking: posts, quiet, or never reached", () => {
  it("posts when it answers with some", async () => {
    expect(await overallRanking(async () => ["a", "b"])).toEqual({ posts: ["a", "b"], reached: true });
  });

  it("an answer with nothing in it was reached: it is quiet, not broken", async () => {
    expect(await overallRanking(async () => [])).toEqual({ posts: [], reached: true });
  });

  it("a failure was never reached", async () => {
    expect(await overallRanking(async () => { throw new Error("502"); })).toEqual({ posts: [], reached: false });
  });

  it("doesn't wait on a ranking that never answers: after its time, never reached", async () => {
    vi.useFakeTimers();
    try {
      const pending = overallRanking(() => new Promise<string[]>(() => {}));
      let settled = false; void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(OVERALL_WAIT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await pending).toEqual({ posts: [], reached: false });
    } finally { vi.useRealTimers(); }
  });

  it("an answer that arrives in time is never called unreachable by the clock", async () => {
    vi.useFakeTimers();
    try {
      const pending = overallRanking(() => new Promise<string[]>((r) => setTimeout(() => r(["a"]), 1000)));
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ posts: ["a"], reached: true });
    } finally { vi.useRealTimers(); }
  });
});
