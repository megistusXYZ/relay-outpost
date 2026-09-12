/**
 * The group chat's desktop layout as you left it: which sections are open and
 * how wide you dragged each side. One layout per device, for every group.
 *
 * Widths are pixels, not shares of the window: a rooms list you set to 240px
 * stays 240px on a wider monitor, and the chat takes whatever is left.
 * Dragging a side well past its narrowest folds it away (the way an editor's
 * side panel snaps shut); it reopens at the width it had.
 *
 * Pure: the page reads and writes the stored string (CHAT_LAYOUT_KEY).
 */

export const CHAT_LAYOUT_KEY = "ro_chat_layout";

export type ChatSection = "rooms" | "members" | "about";
/** The two draggable sides: the rooms list (left) and Members + About (right). */
export type ChatPane = "rooms" | "info";

export const PANE_LIMITS: Record<ChatPane, { min: number; max: number; initial: number }> = {
  rooms: { min: 180, max: 360, initial: 224 },
  info: { min: 220, max: 440, initial: 280 },
};

export interface ChatLayout {
  sections: Record<ChatSection, boolean>;
  widths: Record<ChatPane, number>;
  collapsed: Record<ChatPane, boolean>;
}

const DEFAULT_SECTIONS: Record<ChatSection, boolean> = { rooms: true, members: true, about: false };
const PANES = Object.keys(PANE_LIMITS) as ChatPane[];

const clampWidth = (pane: ChatPane, width: number) =>
  Math.round(Math.min(PANE_LIMITS[pane].max, Math.max(PANE_LIMITS[pane].min, width)));

/** A drag that ends under half a side's narrowest width folds it. */
const foldsAt = (pane: ChatPane) => PANE_LIMITS[pane].min / 2;

/**
 * `legacy`: the one layout choice saved before this module existed (the
 * Members panel hidden, `ro_chat_members_collapsed`). It counts only until
 * the new layout is first saved.
 */
export function loadChatLayout(raw: string | null, legacy?: { membersHidden?: boolean }): ChatLayout {
  let stored: Partial<ChatLayout> = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { /* a corrupt value reads as the defaults */ }
  if (!raw && legacy?.membersHidden) stored = { collapsed: { rooms: false, info: true } };
  const sections = { ...DEFAULT_SECTIONS };
  for (const key of Object.keys(DEFAULT_SECTIONS) as ChatSection[]) {
    const v = stored?.sections?.[key];
    if (typeof v === "boolean") sections[key] = v;
  }
  const widths = {} as Record<ChatPane, number>;
  const collapsed = {} as Record<ChatPane, boolean>;
  for (const pane of PANES) {
    const w = stored?.widths?.[pane];
    widths[pane] = typeof w === "number" && Number.isFinite(w) ? clampWidth(pane, w) : PANE_LIMITS[pane].initial;
    collapsed[pane] = stored?.collapsed?.[pane] === true;
  }
  return { sections, widths, collapsed };
}

export function saveChatLayout(layout: ChatLayout): string {
  return JSON.stringify(layout);
}

export function toggleSection(layout: ChatLayout, key: ChatSection): ChatLayout {
  return { ...layout, sections: { ...layout.sections, [key]: !layout.sections[key] } };
}

/**
 * Where a drag of a side's edge lands: a width, or folded away. `drag.from` is
 * the width when the drag began: a real drag reports every width on its way
 * down, so a fold restores that one, not the narrowest it passed through.
 */
export function resizePane(layout: ChatLayout, pane: ChatPane, width: number, drag?: { from: number }): ChatLayout {
  if (width < foldsAt(pane)) {
    const keep = drag && drag.from >= PANE_LIMITS[pane].min ? clampWidth(pane, drag.from) : layout.widths[pane];
    return { ...layout, widths: { ...layout.widths, [pane]: keep }, collapsed: { ...layout.collapsed, [pane]: true } };
  }
  return {
    ...layout,
    widths: { ...layout.widths, [pane]: clampWidth(pane, width) },
    collapsed: { ...layout.collapsed, [pane]: false },
  };
}

export function togglePane(layout: ChatLayout, pane: ChatPane): ChatLayout {
  return { ...layout, collapsed: { ...layout.collapsed, [pane]: !layout.collapsed[pane] } };
}

/** Double-clicking a divider: that side back to its first width, open. */
export function resetPane(layout: ChatLayout, pane: ChatPane): ChatLayout {
  return {
    ...layout,
    widths: { ...layout.widths, [pane]: PANE_LIMITS[pane].initial },
    collapsed: { ...layout.collapsed, [pane]: false },
  };
}

/**
 * Showing a side you asked for (the Members button): open it, and if the
 * window has no room for it next to the other side, fold the other one.
 */
export function showPane(layout: ChatLayout, pane: ChatPane, available: number): ChatLayout {
  const open = { ...layout, collapsed: { ...layout.collapsed, [pane]: false } };
  if (fitPanes(open, available)[pane] > 0) return open;
  const other: ChatPane = pane === "info" ? "rooms" : "info";
  return { ...open, collapsed: { ...open.collapsed, [other]: true } };
}

/** The narrowest the chat itself gets before a side gives way. */
export const CHAT_MIN_WIDTH = 420;

/**
 * The widths the sides actually get in `available` pixels (0 = not shown). In
 * a narrow window the chat keeps a readable width: Members + About give way
 * first, then the rooms list. Nothing is saved, so widening the window brings
 * them back as you left them.
 */
export function fitPanes(layout: ChatLayout, available: number): Record<ChatPane, number> {
  let rooms = layout.collapsed.rooms ? 0 : layout.widths.rooms;
  let info = layout.collapsed.info ? 0 : layout.widths.info;
  if (rooms + info + CHAT_MIN_WIDTH > available) info = 0;
  if (rooms + CHAT_MIN_WIDTH > available) rooms = 0;
  return { rooms, info };
}
