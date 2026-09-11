/**
 * This device's message cache is the display source after a reload: the live
 * stream skips wraps it has already decoded. The reader used to copy an
 * allowlist of fields that left out the thread, so after a reload every thread
 * reply came back without it and showed in the room.
 */
import { describe, it, expect } from "vitest";
import { messageFromCacheRow } from "./concord-keys";
import { groupThreads } from "./concord-threads";

describe("reading a message back from this device's cache", () => {
  it("a reply in a thread comes back still in its thread", () => {
    const row = {
      ownerPubkey: "me", communityId: "group", channelId: "room",
      id: "reply", pubkey: "alice", content: "Me!", t: 2,
      replyTo: { id: "starter", pubkey: "bob" }, rootId: "starter", kind: 1111,
      root: { id: "starter", pubkey: "bob", kind: 9 },
    };
    const msg = messageFromCacheRow(row);
    expect(msg).toMatchObject({ id: "reply", rootId: "starter", kind: 1111, root: { id: "starter", pubkey: "bob", kind: 9 } });
    expect(msg).not.toHaveProperty("ownerPubkey");
    const grouped = groupThreads([{ id: "starter", pubkey: "bob", t: 1 }, msg]);
    expect(grouped.threads.get("starter")?.map((m) => m.id)).toEqual(["reply"]);
    expect(grouped.timeline.map((m) => m.id)).toEqual(["starter"]);
  });
});
