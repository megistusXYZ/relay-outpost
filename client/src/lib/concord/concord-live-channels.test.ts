/**
 * The orphan cases the two mounts were getting wrong.
 *
 * Sabotage that must turn these red: return `community.channels` unchanged —
 * which is exactly what ConcordOutpost.tsx did, and why the About-tab drawer
 * hid every channel a co-admin created.
 */
import { describe, it, expect } from "vitest";
import type { FoldedState, ChannelMetadata } from "./concord-events";
import type { StoredCommunity, StoredChannel } from "./concord-keys";
import { liveChannels } from "./concord-live-channels";

const chan = (id: string, name: string, isPrivate = false): StoredChannel =>
  ({ id, epoch: 0, name, isPrivate }) as StoredChannel;

const folded = (...cs: Partial<ChannelMetadata>[]): FoldedState =>
  ({
    channels: new Map(cs.map((c) => [c.channel_id!, { name: "", private: false, ...c } as ChannelMetadata])),
    roles: new Map(),
    grants: new Map(),
    banlist: new Set(),
  }) as FoldedState;

const community = (...cs: StoredChannel[]): StoredCommunity =>
  ({ id: "c1", name: "Test", owner: "o".repeat(64), root_epoch: 0, channels: cs }) as StoredCommunity;

describe("liveChannels", () => {
  it("surfaces a public channel the fold knows and the record does not", () => {
    // The whole defect: a co-admin created it, so this device's record has
    // never heard of it, and the drawer that manages channels omitted it.
    const out = liveChannels(community(chan("a", "general")), folded({ channel_id: "b", name: "random" }));
    expect(out.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(out.find((c) => c.id === "b")?.name).toBe("random");
  });

  it("prefers a folded rename over the stored name", () => {
    const out = liveChannels(community(chan("a", "old-name")), folded({ channel_id: "a", name: "new-name" }));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("new-name");
  });

  it("keeps the stored name when the fold carries no name for it", () => {
    // An empty folded name is not a rename to "" — it is silence.
    const out = liveChannels(community(chan("a", "general")), folded({ channel_id: "a", name: "" }));
    expect(out[0].name).toBe("general");
  });

  it("returns the record untouched when the fold is empty", () => {
    // The cold-subscription case: the fold saying nothing must never subtract.
    const out = liveChannels(community(chan("a", "general"), chan("b", "dev")), folded());
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("withholds a private channel this device has no key for", () => {
    // A row that opens nothing is worse than no row.
    const out = liveChannels(community(chan("a", "general")), folded({ channel_id: "p", name: "secret", private: true }));
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps a private channel the record DOES hold", () => {
    // Held locally means the key is held — the fold's `private` flag must not
    // subtract a channel this device can actually open.
    const out = liveChannels(community(chan("p", "secret", true)), folded({ channel_id: "p", name: "secret", private: true }));
    expect(out.map((c) => c.id)).toEqual(["p"]);
  });

  it("reaches a count of 2 from the fold alone", () => {
    // `canDelete` gates on this count. Reading it off the raw record disabled
    // Delete with "needs at least one channel" while the drawer listed several.
    const out = liveChannels(community(chan("a", "general")), folded({ channel_id: "b", name: "random" }));
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("does not mutate the stored record", () => {
    const rec = community(chan("a", "old-name"));
    liveChannels(rec, folded({ channel_id: "a", name: "new-name" }, { channel_id: "b", name: "random" }));
    expect(rec.channels).toHaveLength(1);
    expect(rec.channels[0].name).toBe("old-name");
  });
});
