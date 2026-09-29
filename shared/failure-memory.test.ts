/**
 * An outside service that just failed isn't asked again for a while
 * (performance QA, 2026-09-28): buzz.directory refusing connections and
 * Brainstorm answering its API with a web page were hit on every request,
 * and each failure cost the user the full timeout.
 */
import { describe, it, expect, vi } from "vitest";
import { FailureMemory, UpstreamUnavailable } from "./failure-memory";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("FailureMemory", () => {
  it("passes a working service's answer through", async () => {
    const mem = new FailureMemory(60_000);
    await expect(mem.run("buzz", async () => "directory")).resolves.toBe("directory");
  });

  it("after a failure, answers unavailable without calling the service again", async () => {
    const c = clock();
    const mem = new FailureMemory(60_000, c.now);
    const service = vi.fn(async () => { throw new Error("refused"); });
    await expect(mem.run("buzz", service)).rejects.toThrow("refused");
    c.advance(30_000);
    await expect(mem.run("buzz", service)).rejects.toBeInstanceOf(UpstreamUnavailable);
    expect(service).toHaveBeenCalledTimes(1);
    expect(mem.isDown("buzz")).toBe(true);
  });

  it("asks again once the wait is over", async () => {
    const c = clock();
    const mem = new FailureMemory(60_000, c.now);
    await mem.run("buzz", async () => { throw new Error("refused"); }).catch(() => {});
    c.advance(60_001);
    await expect(mem.run("buzz", async () => "back")).resolves.toBe("back");
    expect(mem.isDown("buzz")).toBe(false);
  });

  it("services are remembered separately", async () => {
    const mem = new FailureMemory(60_000);
    await mem.run("buzz", async () => { throw new Error("refused"); }).catch(() => {});
    await expect(mem.run("brainstorm", async () => "ok")).resolves.toBe("ok");
  });

  it("an answer that isn't what the service should send counts as a failure", async () => {
    const mem = new FailureMemory(60_000);
    // A caller validates the body and throws, e.g. an HTML page where JSON was due.
    await mem.run("brainstorm", async () => { throw new Error("expected JSON, got text/html"); }).catch(() => {});
    expect(mem.isDown("brainstorm")).toBe(true);
  });

  it("forgets old failures instead of growing without bound", async () => {
    const c = clock();
    const mem = new FailureMemory(1_000, c.now, 3);
    for (const host of ["a", "b", "c", "d", "e"]) {
      await mem.run(host, async () => { throw new Error("x"); }).catch(() => {});
      c.advance(10);
    }
    expect(mem.size).toBeLessThanOrEqual(3);
    expect(mem.isDown("e")).toBe(true);
  });
});
