/**
 * An operator's status change shows at once and survives leaving the tab
 * (owner, 2026-10-12: a fix "vanished" when switching chips until the relay
 * round-trip landed, so it looked like it needed doing twice). The optimistic
 * copies live in one shared store the chip and the tab both read.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { addOptimisticRumor, addOptimisticEvent, removeOptimistic, optimisticFeedback, _resetOptimisticFeedback } from "./feedback-optimistic";

const r = (id: string, created_at: number) => ({ id, pubkey: "a".repeat(64), kind: 1111, content: "", created_at, tags: [["E", "e".repeat(64)], ["status", "resolved"]] });

describe("optimistic feedback store", () => {
  beforeEach(() => _resetOptimisticFeedback());
  it("keeps a status change until it is removed, for every reader", () => {
    addOptimisticRumor(r("opt-1", 1000) as any);
    expect(optimisticFeedback(1100).rumors.map((x) => x.id)).toEqual(["opt-1"]);
    removeOptimistic("opt-1");
    expect(optimisticFeedback(1100).rumors).toEqual([]);
  });
  it("forgets a copy after ten minutes: by then the real one has landed or the send failed", () => {
    addOptimisticRumor(r("opt-1", 1000) as any);
    addOptimisticEvent({ id: "opt-2", created_at: 1000 } as any);
    expect(optimisticFeedback(1000 + 599).rumors).toHaveLength(1);
    expect(optimisticFeedback(1000 + 601).rumors).toEqual([]);
    expect(optimisticFeedback(1000 + 601).events).toEqual([]);
  });
});
