/**
 * How the operator console is laid out (owner, 2026-10-04): like a community
 * tool people already know — Discord's server settings — in plain words.
 *
 * Six sections in one row that never wraps on a phone (a column on a
 * computer): Overview, Posts, People, Inbox, Community, Advanced. Community
 * is what a community manager sets up and looks after; Advanced is what only
 * some people need. Section ids are the hashes, kept from before so old links
 * land: #events is Posts, #feedback is Inbox, #settings is Community.
 *
 * Pure: the page reads it; nothing here touches the DOM.
 */
import type { TabId } from "./shared";

export type SectionId = "overview" | "events" | "people" | "feedback" | "settings" | "advanced";

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "events", label: "Posts" },
  { id: "people", label: "People" },
  { id: "feedback", label: "Inbox" },
  { id: "settings", label: "Community" },
  { id: "advanced", label: "Advanced" },
];

export interface ConsoleScreen { tab: TabId; label: string; hint: string }

export const COMMUNITY_SCREENS: ReadonlyArray<ConsoleScreen> = [
  { tab: "community", label: "Community details", hint: "Name, picture, cover, description and rules" },
  { tab: "access", label: "Who can post", hint: "Who's allowed, and what can be posted" },
  { tab: "featured", label: "Featured & announcements", hint: "What greets people, and news you post" },
  { tab: "contact", label: "Member inbox", hint: "Let members contact the team" },
  { tab: "team", label: "Team", hint: "Who helps you run it" },
  { tab: "badges", label: "Badges", hint: "Badges your community gives" },
  { tab: "log", label: "Moderation log", hint: "Everything your team has done here" },
  // Only where the relay runs group chats (the page leaves it out otherwise).
  { tab: "groups", label: "Group chats", hint: "Create groups, invite people, set roles" },
];

export const ADVANCED_SCREENS: ReadonlyArray<ConsoleScreen> = [
  { tab: "connection", label: "Connection & sign-in", hint: "How this app reaches it, and when to sign in" },
  { tab: "card", label: "Public card", hint: "What other apps read about this relay" },
  { tab: "scans", label: "Activity & storage", hint: "Counts, top posters, storage and uptime" },
];

/** Old addresses that now live elsewhere. */
const MOVED: Record<string, TabId> = {
  // Public card's announcements moved to Featured & announcements (2026-10-04).
  announce: "featured",
};

const ALL_TABS = new Set<string>([
  "overview", "live", "events", "people", "feedback", "settings", "advanced",
  ...COMMUNITY_SCREENS.map((s) => s.tab), ...ADVANCED_SCREENS.map((s) => s.tab),
]);

/** The screen an address (a hash without #) opens. */
export function resolveTab(hash: string): TabId {
  if (hash in MOVED) return MOVED[hash];
  if (ALL_TABS.has(hash)) return hash as TabId;
  return "overview";
}

/** The section a tab belongs to. */
export function sectionOf(tab: TabId): SectionId {
  if (tab === "live") return "events";
  if (tab === "settings" || COMMUNITY_SCREENS.some((s) => s.tab === tab)) return "settings";
  if (tab === "advanced" || ADVANCED_SCREENS.some((s) => s.tab === tab)) return "advanced";
  return tab as SectionId;
}

/** The list a screen goes back to, or null for a section of its own. */
export function listOf(tab: TabId): { tab: TabId; label: string } | null {
  if (COMMUNITY_SCREENS.some((s) => s.tab === tab)) return { tab: "settings", label: "Community" };
  if (ADVANCED_SCREENS.some((s) => s.tab === tab)) return { tab: "advanced", label: "Advanced" };
  return null;
}

/** What a screen is called, for the page title and the back row. */
export function consoleTitle(tab: TabId): string {
  const screen = [...COMMUNITY_SCREENS, ...ADVANCED_SCREENS].find((s) => s.tab === tab);
  if (screen) return screen.label;
  return SECTIONS.find((s) => s.id === sectionOf(tab))?.label ?? "Relay Control";
}
