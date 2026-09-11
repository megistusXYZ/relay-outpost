/**
 * Group-chat mentions and replies in Activity: which ones still need you, and
 * what each row says. Pure; the ledger, the read marks, mutes, the held groups
 * and the message cache are passed in.
 */
import { describe, it, expect } from "vitest";
import { ledgerRows, groupMentionRows, type MentionRef } from "./concord-activity-mentions";
import type { CachedMessage } from "./concord-keys";

const G1 = "a1".repeat(32), G2 = "b2".repeat(32), R1 = "c3".repeat(32), R2 = "d4".repeat(32);
const ME = "e5".repeat(32), ANN = "f6".repeat(32);
const key = (c: string, r: string) => `${c}|${r}`;

describe("which group mentions still need you", () => {
  it("newest first, without the ones you've read or muted", () => {
    const ledger = {
      [key(G1, R1)]: [{ id: "m1", t: 100 }, { id: "m2", t: 300 }],
      [key(G1, R2)]: [{ id: "m3", t: 200 }],
      [key(G2, R1)]: [{ id: "m4", t: 400 }],
    };
    const rows = ledgerRows(ledger, (c, r) => (c === G1 && r === R1 ? 150 : 0), (c) => c === G2);
    expect(rows).toEqual([
      { communityId: G1, channelId: R1, id: "m2", t: 300 },
      { communityId: G1, channelId: R2, id: "m3", t: 200 },
    ]);
  });
});

describe("what a group mention row says", () => {
  const groups = new Map([
    [G1, { name: "Book Club", channels: [{ id: R1, name: "general" }, { id: R2, name: "spoilers" }] }],
    [G2, { name: "Solo", channels: [{ id: R1, name: "general" }] }],
  ]);
  const msgs: Record<string, CachedMessage> = {
    m2: { id: "m2", pubkey: ANN, content: "  hey  @you\n\nwhat did you think of   chapter 3?  ", t: 300 },
    m3: { id: "m3", pubkey: ANN, content: "yes!", t: 200, replyTo: { id: "x", pubkey: ME } },
    m5: { id: "m5", pubkey: ANN, content: "word ".repeat(80), t: 50 },
  };
  const lookup = (_c: string, _r: string, id: string) => msgs[id];
  const ref = (communityId: string, channelId: string, id: string, t: number): MentionRef => ({ communityId, channelId, id, t });

  it("names the group, the room, who, and what they said, and opens that room", () => {
    expect(groupMentionRows([ref(G1, R1, "m2", 300)], groups, lookup, ME)).toEqual([{
      key: `${G1}|${R1}|m2`, communityId: G1, channelId: R1, groupName: "Book Club", roomName: "general",
      author: ANN, verb: "mentioned you", snippet: "hey @you what did you think of chapter 3?", t: 300,
      href: `/outposts/c/${G1}?channel=${R1}`,
    }]);
  });

  it("a reply to you says so", () => {
    expect(groupMentionRows([ref(G1, R2, "m3", 200)], groups, lookup, ME)[0].verb).toBe("replied to you");
  });

  it("a one-room group doesn't name its room", () => {
    expect(groupMentionRows([ref(G2, R1, "m2", 300)], groups, lookup, ME)[0].roomName).toBeUndefined();
  });

  it("a mention whose message isn't on this device still shows, without words", () => {
    const [row] = groupMentionRows([ref(G1, R1, "gone", 90)], groups, lookup, ME);
    expect(row).toMatchObject({ groupName: "Book Club", verb: "mentioned you", t: 90 });
    expect(row.snippet).toBeUndefined();
    expect(row.author).toBeUndefined();
  });

  it("a group you've left shows nothing", () => {
    expect(groupMentionRows([ref("99".repeat(32), R1, "m2", 300)], groups, lookup, ME)).toEqual([]);
  });

  it("a long message is cut to one line", () => {
    const { snippet } = groupMentionRows([ref(G1, R1, "m5", 50)], groups, lookup, ME)[0];
    expect(snippet!.length).toBeLessThanOrEqual(140);
    expect(snippet!.endsWith("…")).toBe(true);
  });
});
