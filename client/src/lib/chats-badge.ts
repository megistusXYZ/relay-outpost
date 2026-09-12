/**
 * The Chats badge, worked out once for every place that shows it (the mobile
 * footer, the desktop rail, the sidebar and the orbit launcher). Each used to
 * add it up on its own, which is how private mode came to mask the chats list
 * but not the badge beside it.
 */
import { concordChatsBadgeCount } from "./concord/concord-mentions";

export interface ChatsBadge {
  /** The number on the badge: unread DMs, plus mentions of you, plus one per otherwise-active group. */
  total: number;
  /** Unread direct messages. */
  dmUnread: number;
  /** Groups with something new. */
  activeGroups: number;
}

/**
 * What the Chats badge may say. While private mode masks the chats, nothing:
 * no number, no dot, no hint that anything is waiting.
 */
export function chatsBadge(input: {
  dmUnread: number;
  unreadCommunities: ReadonlySet<string>;
  mentionCounts: ReadonlyMap<string, number>;
  masked: boolean;
}): ChatsBadge {
  if (input.masked) return { total: 0, dmUnread: 0, activeGroups: 0 };
  return {
    total: input.dmUnread + concordChatsBadgeCount(input.unreadCommunities, input.mentionCounts),
    dmUnread: input.dmUnread,
    activeGroups: input.unreadCommunities.size,
  };
}
