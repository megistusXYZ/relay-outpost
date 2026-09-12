/**
 * The Chats badge for any place that shows one. It starts the group unread
 * watcher and mention scanner (both idempotent), and arms private mode's
 * re-mask on backgrounding even if the chats list was never opened, so a badge
 * can't outlive the mask it sits beside.
 */
import { useEffect, useMemo } from "react";
import { useNotifications } from "@/contexts/NotificationContext";
import { ensureConcordUnreadWatcher, useConcordUnread } from "@/lib/concord/concord-unread";
import { useConcordMentionCounts } from "@/lib/concord/concord-mentions";
import { ensureConcordMentionScanner } from "@/lib/concord/concord-mention-scan";
import { ensurePrivateModeRearm, usePrivateMasked } from "@/lib/private-mode";
import { chatsBadge, type ChatsBadge } from "@/lib/chats-badge";

export function useChatsBadge(pubkey: string | null | undefined): ChatsBadge {
  const { unreadDmCount } = useNotifications();
  const unreadCommunities = useConcordUnread();
  const mentionCounts = useConcordMentionCounts();
  const masked = usePrivateMasked();
  useEffect(() => {
    void ensureConcordUnreadWatcher(pubkey);
    ensureConcordMentionScanner(pubkey);
    ensurePrivateModeRearm();
  }, [pubkey]);
  return useMemo(
    () => chatsBadge({ dmUnread: unreadDmCount, unreadCommunities, mentionCounts, masked }),
    [unreadDmCount, unreadCommunities, mentionCounts, masked],
  );
}
