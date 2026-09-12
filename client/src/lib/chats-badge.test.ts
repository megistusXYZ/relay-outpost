import { describe, it, expect } from "vitest";
import { chatsBadge } from "./chats-badge";
import { mentionKey } from "./concord/concord-mentions";

// Three unread DMs; group c1 has two mentions of you, group c2 is merely active.
const WAITING = {
  dmUnread: 3,
  unreadCommunities: new Set(["c1", "c2"]),
  mentionCounts: new Map([[mentionKey("c1", "general"), 2]]),
};

describe("chatsBadge", () => {
  it("counts what's waiting the calm way: DMs, mentions, and one per active group", () => {
    expect(chatsBadge({ ...WAITING, masked: false })).toEqual({ total: 6, dmUnread: 3, activeGroups: 2 });
  });

  it("shows nothing at all while private mode masks the chats", () => {
    expect(chatsBadge({ ...WAITING, masked: true })).toEqual({ total: 0, dmUnread: 0, activeGroups: 0 });
  });
});
