// Tier-2 mention ledger: the pure core (entry add/prune, mention predicate,
// badge math, first-unread-channel picker) plus the localStorage-backed
// round-trip — including the load-bearing invariant that a channel's mention
// count CLEARS the moment its read mark advances past the mention, and that
// mute filters every count.

import { describe, it, expect, beforeEach, vi } from "vitest";

// node env has no localStorage/window; the ledger reads them synchronously.
const __store = new Map<string, string>();
const __dispatched: string[] = [];
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});
vi.stubGlobal("window", {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: (e: { type: string }) => { __dispatched.push(e.type); return true; },
});
vi.stubGlobal("Event", class { type: string; constructor(type: string) { this.type = type; } });

import {
  mentionKey, splitMentionKey,
  rumorMentionsMe, addMentionEntry, pruneMentionEntries,
  recordMention, getMentionCounts,
  communityMentionTotals, concordChatsBadgeCount, pickFirstUnreadChannel,
  MENTIONS_CHANGED_EVENT, MENTION_CAP_PER_CHANNEL,
  type MentionEntry,
} from "./concord-mentions";
import { setChannelMuted, setCommunityMuted } from "./concord-mute";

const ME = "me".padEnd(64, "0");
const OTHER = "aa".padEnd(64, "1");

const setLastRead = (cid: string, chid: string, t: number) =>
  __store.set(`ro_concord_read_${cid}_${chid}`, String(t));

beforeEach(() => { __store.clear(); __dispatched.length = 0; });

describe("rumorMentionsMe", () => {
  it("true when a p-tag names me and someone else wrote it", () => {
    expect(rumorMentionsMe([["channel", "c"], ["p", ME]], ME, OTHER)).toBe(true);
  });
  it("covers replies-to-me (reply rumors p-tag the parent author)", () => {
    expect(rumorMentionsMe([["e", "parent"], ["p", ME]], ME, OTHER)).toBe(true);
  });
  it("false for my own messages (self-mentions never notify)", () => {
    expect(rumorMentionsMe([["p", ME]], ME, ME)).toBe(false);
  });
  it("false when the p-tags name only others", () => {
    expect(rumorMentionsMe([["p", OTHER]], ME, OTHER)).toBe(false);
    expect(rumorMentionsMe([], ME, OTHER)).toBe(false);
  });
});

describe("addMentionEntry / pruneMentionEntries (pure)", () => {
  it("dedupes by id and keeps ascending time order", () => {
    let list: MentionEntry[] = [];
    list = addMentionEntry(list, { id: "b", t: 200 });
    list = addMentionEntry(list, { id: "a", t: 100 });
    list = addMentionEntry(list, { id: "b", t: 200 }); // duplicate
    expect(list.map((e) => e.id)).toEqual(["a", "b"]);
  });
  it("caps at the NEWEST entries", () => {
    let list: MentionEntry[] = [];
    for (let i = 0; i < MENTION_CAP_PER_CHANNEL + 5; i++) {
      list = addMentionEntry(list, { id: `m${i}`, t: i + 1 });
    }
    expect(list).toHaveLength(MENTION_CAP_PER_CHANNEL);
    expect(list[0].id).toBe("m5"); // oldest five dropped
  });
  it("prune keeps only entries newer than the read mark", () => {
    const list: MentionEntry[] = [{ id: "a", t: 100 }, { id: "b", t: 200 }];
    expect(pruneMentionEntries(list, 100).map((e) => e.id)).toEqual(["b"]);
    expect(pruneMentionEntries(list, 50)).toBe(list); // unchanged ⇒ same ref
    expect(pruneMentionEntries(list, 999)).toEqual([]);
  });
});

describe("ledger round-trip (recordMention → getMentionCounts)", () => {
  it("records and counts per channel", () => {
    recordMention("c1", "general", "m1", 1000);
    recordMention("c1", "general", "m2", 2000);
    recordMention("c1", "random", "m3", 1500);
    const counts = getMentionCounts();
    expect(counts.get(mentionKey("c1", "general"))).toBe(2);
    expect(counts.get(mentionKey("c1", "random"))).toBe(1);
  });

  it("dedupes the same rumor id (scanner + cached pass can both see it)", () => {
    recordMention("c1", "general", "m1", 1000);
    recordMention("c1", "general", "m1", 1000);
    expect(getMentionCounts().get(mentionKey("c1", "general"))).toBe(1);
  });

  it("refuses mentions the read mark already passed", () => {
    setLastRead("c1", "general", 5000);
    recordMention("c1", "general", "old", 4000);
    expect(getMentionCounts().size).toBe(0);
  });

  it("CLEARS a channel's count when its read mark advances past the mention", () => {
    recordMention("c1", "general", "m1", 1000);
    recordMention("c1", "general", "m2", 2000);
    expect(getMentionCounts().get(mentionKey("c1", "general"))).toBe(2);
    setLastRead("c1", "general", 1000); // read up to (and including) m1
    expect(getMentionCounts().get(mentionKey("c1", "general"))).toBe(1);
    setLastRead("c1", "general", 2000); // caught up
    expect(getMentionCounts().has(mentionKey("c1", "general"))).toBe(false);
  });

  it("announces new mentions via MENTIONS_CHANGED_EVENT", () => {
    recordMention("c1", "general", "m1", 1000);
    expect(__dispatched).toContain(MENTIONS_CHANGED_EVENT);
  });

  it("mute filters counts: channel mute and community mute both zero the badge", () => {
    recordMention("c1", "general", "m1", 1000);
    recordMention("c2", "general", "m2", 1000);
    setChannelMuted("c1", "general", true);
    let counts = getMentionCounts();
    expect(counts.has(mentionKey("c1", "general"))).toBe(false);
    expect(counts.get(mentionKey("c2", "general"))).toBe(1);
    setCommunityMuted("c2", true);
    counts = getMentionCounts();
    expect(counts.size).toBe(0);
    // Unmute ⇒ the (still-unread) mentions come back — mute hides, not erases.
    setChannelMuted("c1", "general", false);
    setCommunityMuted("c2", false);
    expect(getMentionCounts().size).toBe(2);
  });
});

describe("badge math", () => {
  it("communityMentionTotals sums a community's channels", () => {
    const totals = communityMentionTotals(new Map([
      [mentionKey("c1", "a"), 2],
      [mentionKey("c1", "b"), 1],
      [mentionKey("c2", "a"), 4],
    ]));
    expect(totals.get("c1")).toBe(3);
    expect(totals.get("c2")).toBe(4);
  });

  it("chats badge: mentions count as numbers, plain activity as presence (1), never both", () => {
    const unread = new Set(["c1", "c2"]); // both have activity
    const counts = new Map([[mentionKey("c1", "general"), 3]]); // c1 also has mentions
    // c1 → 3 (mentions), c2 → 1 (activity presence)
    expect(concordChatsBadgeCount(unread, counts)).toBe(4);
  });

  it("a mention in a not-yet-unread-listed community still counts", () => {
    expect(concordChatsBadgeCount(new Set(), new Map([[mentionKey("c1", "a"), 2]]))).toBe(2);
  });

  it("quiet everywhere ⇒ 0", () => {
    expect(concordChatsBadgeCount(new Set(), new Map())).toBe(0);
  });
});

describe("pickFirstUnreadChannel", () => {
  const channels = ["general", "random", "dev"];
  it("mention-bearing channels win, in channel-list order", () => {
    const mentions = new Map([["dev", 1], ["random", 2]]);
    expect(
      pickFirstUnreadChannel(channels, new Set(["general"]), (id) => mentions.get(id) ?? 0),
    ).toBe("random"); // random precedes dev in list order
  });
  it("falls back to the first plain-unread channel", () => {
    expect(
      pickFirstUnreadChannel(channels, new Set(["dev", "random"]), () => 0),
    ).toBe("random");
  });
  it("nothing unread ⇒ undefined (caller opens the default channel)", () => {
    expect(pickFirstUnreadChannel(channels, new Set(), () => 0)).toBeUndefined();
  });
});

describe("keys", () => {
  it("mentionKey/splitMentionKey round-trip (channel ids may not contain |)", () => {
    const key = mentionKey("cid123", "ch456");
    expect(splitMentionKey(key)).toEqual(["cid123", "ch456"]);
  });
});
