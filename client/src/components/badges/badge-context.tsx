/**
 * Which community a screen belongs to, for the badge beside a name (owner,
 * 2026-10-06: helpful and meaningful, never in the way). Inside a community
 * — its feed, its Relay Control People — only the badge that community gave
 * shows; elsewhere, the person's first chosen badge (badge-events
 * badgeForContext).
 */
import { createContext, useContext, type ReactNode } from "react";

const BadgeCommunity = createContext<string | undefined>(undefined);

export function BadgeCommunityProvider({ community, children }: { community: string; children: ReactNode }) {
  return <BadgeCommunity.Provider value={community}>{children}</BadgeCommunity.Provider>;
}

export function useBadgeCommunity(): string | undefined {
  return useContext(BadgeCommunity);
}
