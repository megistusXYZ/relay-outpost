/**
 * The Chats badge for any place that shows one. The group unread watcher,
 * the mention scanner and private mode's re-mask arm live in
 * hooks/chats-badge-engine.tsx, a signed-in-only chunk, so showing a badge
 * never loads the group-chat library for a visitor.
 */
import { useMemo } from "react";
import { useNotifications } from "@/contexts/NotificationContext";
import { useConcordMentionCounts } from "@/lib/concord/concord-mentions";
import { usePrivateMasked } from "@/lib/private-mode";
import { useUnreadCommunities } from "@/lib/chats-badge-store";
import { chatsBadge, type ChatsBadge } from "@/lib/chats-badge";

export function useChatsBadge(_pubkey: string | null | undefined): ChatsBadge {
  const { unreadDmCount } = useNotifications();
  // Filled by hooks/chats-badge-engine.tsx (signed-in only); empty for a visitor.
  const unreadCommunities = useUnreadCommunities();
  const mentionCounts = useConcordMentionCounts();
  const masked = usePrivateMasked();
  return useMemo(
    () => chatsBadge({ dmUnread: unreadDmCount, unreadCommunities, mentionCounts, masked }),
    [unreadDmCount, unreadCommunities, mentionCounts, masked],
  );
}
