/**
 * A room's `custom` object (CORD-02 §6, permitted on ChannelMetadata by
 * CORD-03): the fold keeps it, and an editor MUST round-trip it, so renaming a
 * room never wipes what another app (or ours) put there.
 */
import { describe, it, expect } from "vitest";
import { foldEditions, computeEditionId, VSK, type ControlEdition } from "./concord-events";
import { nextChannelEdition } from "./concord-channel-edition";

const OWNER = "a".repeat(64);
const CID = "c".repeat(64);
const HEAD = "ab".repeat(32);
const edition = (content: unknown): ControlEdition =>
  ({ vsk: VSK.CHANNEL, eid: CID, ev: 1, content: JSON.stringify(content), rumorId: "1".repeat(64), pubkey: OWNER });

describe("a room's custom fields", () => {
  it("the fold keeps them", () => {
    const custom = { "relayoutpost/hangout": { url: "https://cornychat.com/ro-abc" }, rules: "be kind" };
    const state = foldEditions([edition({ channel_id: CID, name: "hangout", custom })], OWNER);
    expect(state.channels.get(CID)?.custom).toEqual(custom);
  });

  it("the fold ignores a custom that isn't an object", () => {
    for (const custom of ["nope", [1, 2], 7, null]) {
      const state = foldEditions([edition({ channel_id: CID, name: "general", custom })], OWNER);
      expect(state.channels.get(CID)?.custom).toBeUndefined();
    }
  });

  it("renaming a room keeps another app's custom fields, and the edition id still matches", () => {
    const custom = { "vector/theme": "dark", rules: "be kind" };
    const out = nextChannelEdition(CID, undefined, { channel_id: CID, name: "old", custom }, { ev: 1, hash: HEAD }, { name: "new" });
    expect(out.content.custom).toEqual(custom);
    expect(out.content.name).toBe("new");
    expect(out.eid).toBe(computeEditionId(CID, 2, HEAD, JSON.stringify(out.content)));
  });

  it("a room without custom fields still serializes without one", () => {
    const out = nextChannelEdition(CID, undefined, { channel_id: CID, name: "old" }, { ev: 1, hash: HEAD }, { name: "new" });
    expect("custom" in out.content).toBe(false);
  });
});
