import { useEffect } from "react";
import { useNotifications } from "@/contexts/NotificationContext";

const DEFAULT_TITLE = "Relay Outpost | Beyond the Algorithm";

export function useDocumentTitle(title: string | undefined | null) {
  const { unreadCount } = useNotifications();

  useEffect(() => {
    const prefix = unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount}) ` : "";
    if (title) {
      document.title = `${prefix}${title} | Relay Outpost`;
    } else {
      document.title = `${prefix}${DEFAULT_TITLE}`;
    }
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title, unreadCount]);
}
