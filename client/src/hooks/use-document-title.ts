import { useEffect } from "react";
import { useNotifications } from "@/contexts/NotificationContext";

const DEFAULT_TITLE = "Relay Outpost | Beyond the Algorithm";

/** The tab's title: the unread count, the page, and the app's name once. */
export function documentTitleFor(title: string | undefined | null, unreadCount: number): string {
  const prefix = unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount}) ` : "";
  if (!title) return `${prefix}${DEFAULT_TITLE}`;
  // A title that already names the app ("Help & Guides — Relay Outpost") is
  // not branded a second time (it read "… — Relay Outpost | Relay Outpost").
  return /Relay Outpost/.test(title) ? `${prefix}${title}` : `${prefix}${title} | Relay Outpost`;
}

export function useDocumentTitle(title: string | undefined | null) {
  const { unreadCount } = useNotifications();

  useEffect(() => {
    document.title = documentTitleFor(title, unreadCount);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title, unreadCount]);
}
