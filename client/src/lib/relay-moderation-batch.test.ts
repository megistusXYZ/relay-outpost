import { describe, it, expect, vi } from "vitest";
import { runBatch } from "./relay-moderation";

const ids = Array.from({ length: 10 }, (_, i) => String(i));

describe("acting on many posts at once", () => {
  it("does them all and reports progress to the end", async () => {
    const seen: number[] = [];
    const out = await runBatch(ids, async () => ({ result: true }), (d) => seen.push(d));
    expect(out.done).toHaveLength(10);
    expect(out.failed).toHaveLength(0);
    expect(seen[seen.length - 1]).toBe(10);
  });

  it("keeps going past a few failures and names them", async () => {
    const out = await runBatch(ids, async (id) => (id === "4" ? { error: "already gone" } : { result: true }));
    expect(out.done).toHaveLength(9);
    expect(out.failed).toEqual([{ id: "4", error: "already gone" }]);
  });

  it("stops after the first round when the relay refuses everything", async () => {
    const call = vi.fn(async () => ({ error: "Not authorized to manage this relay" }));
    const out = await runBatch(ids, call);
    expect(out.stopped).toBe("Not authorized to manage this relay");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("counts a call that throws as failed, not done", async () => {
    const out = await runBatch(["a"], async () => { throw new Error("socket closed"); });
    expect(out.failed).toEqual([{ id: "a", error: "socket closed" }]);
  });
});
