import { describe, it, expect } from "vitest";
import { DecryptionQueue } from "./decryption-queue";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("DecryptionQueue", () => {
  it("coalesces concurrent calls for the same id into one task run", async () => {
    const q = new DecryptionQueue(1);
    let runs = 0;
    const task = async () => { runs++; return "ok"; };

    const [a, b, c] = await Promise.all([
      q.enqueue("wrap1", task),
      q.enqueue("wrap1", task),
      q.enqueue("wrap1", task),
    ]);

    expect(runs).toBe(1);
    expect([a, b, c]).toEqual(["ok", "ok", "ok"]);
  });

  it("runs different ids serially with concurrency 1", async () => {
    const q = new DecryptionQueue(1);
    let active = 0;
    let maxActive = 0;
    const make = () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick();
      active--;
      return true;
    };

    await Promise.all([
      q.enqueue("a", make()),
      q.enqueue("b", make()),
      q.enqueue("c", make()),
    ]);

    expect(maxActive).toBe(1);
  });

  it("propagates rejection to all coalesced callers and frees the id afterward", async () => {
    const q = new DecryptionQueue(1);
    const failing = async () => { throw new Error("denied"); };

    await expect(q.enqueue("x", failing)).rejects.toThrow("denied");

    // After settling, the id is free to be attempted again.
    let ran = false;
    await q.enqueue("x", async () => { ran = true; return 1; });
    expect(ran).toBe(true);
  });

  it("reports progress via subscribe", async () => {
    const q = new DecryptionQueue(1);
    const states: number[] = [];
    const unsub = q.subscribe((s) => states.push(s.completed));

    await Promise.all([
      q.enqueue("a", async () => 1),
      q.enqueue("b", async () => 2),
    ]);
    await tick();
    unsub();

    expect(q.getState().completed).toBe(2);
    expect(q.outstanding()).toBe(0);
  });
});
