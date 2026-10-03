import { describe, it, expect } from "vitest";
import { overallOrOurs } from "./trending-source";

const posts = (...ids: string[]) => ids.map((id) => ({ id }));

describe("Trending's Overall ranking, with our own chart behind it", () => {
  it("shows Overall when it answers", async () => {
    const got = await overallOrOurs(async () => posts("a", "b"), async () => posts("x"));
    expect(got).toEqual({ posts: posts("a", "b"), fellBack: false });
  });
  it("shows our most-replied chart, and says so, when Overall comes back empty", async () => {
    const got = await overallOrOurs(async () => [], async () => posts("x", "y"));
    expect(got).toEqual({ posts: posts("x", "y"), fellBack: true });
  });
  it("does the same when Overall fails outright", async () => {
    const got = await overallOrOurs(async () => { throw new Error("502"); }, async () => posts("x"));
    expect(got).toEqual({ posts: posts("x"), fellBack: true });
  });
  it("doesn't wait on an Overall that never answers: after its time, our chart", async () => {
    const never = () => new Promise<{ id: string }[]>(() => {});
    const t0 = Date.now();
    const got = await overallOrOurs(never, async () => posts("x"), 50);
    expect(got).toEqual({ posts: posts("x"), fellBack: true });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("is honestly empty when neither answers — no claim of a fallback it didn't make", async () => {
    const got = await overallOrOurs(async () => [], async () => { throw new Error("down"); });
    expect(got).toEqual({ posts: [], fellBack: false });
  });
});
