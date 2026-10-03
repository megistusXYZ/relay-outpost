/**
 * Notifications, for the badge and the list.
 *
 * This file is the small, always-loaded part: the context, its shape and the
 * hook. The engine that fills it (notification-engine.tsx — the private-
 * message pipeline, the feedback inbox, the external-comments reader) is a
 * separate chunk that loads only once someone is signed in. It renders
 * nothing and pushes its value here, so the app tree never remounts when
 * sign-in happens. A visitor gets the empty value and none of the code.
 */
import { createContext, useContext, useState, useCallback, lazy, Suspense, type ReactNode } from "react";
import type { Event } from "nostr-tools";
import { useNostrAuth } from "@/contexts/NostrAuthContext";

export interface NotificationItem {
  id: string;
  event: Event;
  type: "reply" | "mention" | "reaction" | "repost" | "zap" | "follow" | "ticket" | "accepted";
  fromPubkey: string;
  timestamp: number;
  read: boolean;
}

export interface NotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  unreadDmCount: number;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clearAll: () => void;
  lastSeenTimestamp: number;
  loading: boolean;
  updateLastSeen: () => void;
}

export const EMPTY_NOTIFICATIONS: NotificationContextType = {
  notifications: [],
  unreadCount: 0,
  unreadDmCount: 0,
  markAllRead: () => {},
  markRead: () => {},
  clearAll: () => {},
  lastSeenTimestamp: 0,
  loading: false,
  updateLastSeen: () => {},
};

const NotificationContext = createContext<NotificationContextType>(EMPTY_NOTIFICATIONS);

export function useNotifications() {
  return useContext(NotificationContext);
}

const NotificationEngine = lazy(() => import("./notification-engine"));
const ChatsBadgeEngine = lazy(() => import("@/hooks/chats-badge-engine"));

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { pubkey } = useNostrAuth();
  const [value, setValue] = useState<NotificationContextType>(EMPTY_NOTIFICATIONS);
  const onChange = useCallback((next: NotificationContextType) => setValue(next), []);
  return (
    <NotificationContext.Provider value={pubkey ? value : EMPTY_NOTIFICATIONS}>
      {pubkey && (
        <Suspense fallback={null}>
          <NotificationEngine onChange={onChange} />
          <ChatsBadgeEngine />
        </Suspense>
      )}
      {children}
    </NotificationContext.Provider>
  );
}
