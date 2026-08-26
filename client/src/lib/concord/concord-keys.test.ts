import { describe, it, expect } from "vitest";
import { mergeCommunityLists } from "./concord-keys";
import type { StoredCommunity } from "./concord-keys";

const mk = (id: string, epoch = 0, addedAt = 1000, name = "c"): StoredCommunity => ({
  community_id: id, owner: "11".repeat(32), owner_salt: "22".repeat(32), community_root: "33".repeat(32),
  root_epoch: epoch, channels: [], relays: ["wss://a"], name, addedAt,
});
const entry = (c: StoredCommunity) => ({ community_id: c.community_id, seed: c, current: c, added_at: c.addedAt });

describe("mergeCommunityLists (CORD-02)", () => {
  it("unions distinct communities from both lists", () => {
    const a = { entries: [entry(mk("a"))], tombstones: [] };
    const b = { entries: [entry(mk("b"))], tombstones: [] };
    const merged = mergeCommunityLists(a, b);
    expect(merged.entries.map((e) => e.community_id).sort()).toEqual(["a", "b"]);
  });

  it("current keeps the higher root_epoch", () => {
    const a = { entries: [entry(mk("x", 1))], tombstones: [] };
    const b = { entries: [entry(mk("x", 3))], tombstones: [] };
    const merged = mergeCommunityLists(a, b);
    expect(merged.entries[0].current.root_epoch).toBe(3);
    expect(merged.entries[0].seed.root_epoch).toBe(1); // seed keeps lower
  });

  it("a tombstone beats an entry added before it", () => {
    const a = { entries: [entry(mk("gone", 0, 1000))], tombstones: [] };
    const b = { entries: [], tombstones: [{ community_id: "gone", removed_at: 2000 }] };
    const merged = mergeCommunityLists(a, b);
    expect(merged.entries.find((e) => e.community_id === "gone")).toBeUndefined();
    expect(merged.tombstones).toContainEqual({ community_id: "gone", removed_at: 2000 });
  });

  it("an entry re-added AFTER a tombstone survives", () => {
    const a = { entries: [entry(mk("back", 0, 3000))], tombstones: [] };
    const b = { entries: [], tombstones: [{ community_id: "back", removed_at: 2000 }] };
    const merged = mergeCommunityLists(a, b);
    expect(merged.entries.find((e) => e.community_id === "back")).toBeDefined();
  });
});
