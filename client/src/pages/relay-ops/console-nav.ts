/**
 * How the operator console is laid out (owner, 2026-10-02: "iOS Settings for
 * the relay you run").
 *
 * Eight tabs became five sections in one row that never wraps. Live Feed
 * folded into Events as a switch on the same list. The relay's
 * public face — its settings, its published card, its featured feeds — is one
 * section, Settings, with three screens inside it. Every old tab id keeps its
 * hash, so a link made before this still lands on the same content.
 *
 * Pure: the page reads it; nothing here touches the DOM.
 */
import type { TabId } from "./shared";

export type SectionId = "overview" | "events" | "access" | "feedback" | "settings";

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "events", label: "Events" },
  { id: "access", label: "Access" },
  { id: "feedback", label: "Feedback" },
  { id: "settings", label: "Settings" },
];

export const SETTINGS_SCREENS: ReadonlyArray<{ tab: TabId; label: string; hint: string }> = [
  { tab: "community", label: "Relay settings", hint: "Name, description, icon and banner" },
  { tab: "announce", label: "Public card", hint: "What other apps show about this relay" },
  { tab: "featured", label: "Featured feeds", hint: "What greets people on the Featured tab" },
];

/** The section a tab belongs to. */
export function sectionOf(tab: TabId | "settings"): SectionId {
  if (tab === "settings") return "settings";
  if (tab === "community" || tab === "announce" || tab === "featured") return "settings";
  // Live Feed became the Live switch on the Events list; its hash still lands.
  if (tab === "live") return "events";
  return tab;
}

/** What a screen is called, for the page title and the back row. */
export function consoleTitle(tab: TabId | "settings"): string {
  const screen = SETTINGS_SCREENS.find((s) => s.tab === tab);
  if (screen) return screen.label;
  return SECTIONS.find((s) => s.id === sectionOf(tab))?.label ?? "Relay Control";
}
