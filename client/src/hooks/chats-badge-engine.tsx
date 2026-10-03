/**
 * The Chats badge's group side, as its own chunk: starts the group unread
 * watcher and the mention scanner (both idempotent), arms private mode's
 * re-mask, and mirrors the unread-groups set into chats-badge-store.ts for
 * every badge to read. Rendered by NotificationContext once someone is
 * signed in; renders nothing itself.
 */
import { useEffect } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { ensureConcordUnreadWatcher, useConcordUnread } from "@/lib/concord/concord-unread";
import { ensureConcordMentionScanner } from "@/lib/concord/concord-mention-scan";
import { ensurePrivateModeRearm } from "@/lib/private-mode";
import { setUnreadCommunities } from "@/lib/chats-badge-store";

export default function ChatsBadgeEngine() {
  const { pubkey } = useNostrAuth();
  const unread = useConcordUnread();
  useEffect(() => { setUnreadCommunities(unread); }, [unread]);
  useEffect(() => {
    void ensureConcordUnreadWatcher(pubkey);
    ensureConcordMentionScanner(pubkey);
    ensurePrivateModeRearm();
  }, [pubkey]);
  useEffect(() => () => setUnreadCommunities(new Set()), []);
  return null;
}
