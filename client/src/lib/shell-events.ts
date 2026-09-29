// The window events that open the app-shell overlays, and their openers.
//
// Kept apart from the overlays themselves (CreateStudio, OrbitMenu,
// CreatePost's composer, FeedbackDrawer) so the footer, rail and sidebar can
// offer "open" without pulling those overlays into the launch bundle: the
// overlays load after the first screen (components/DeferredShell.tsx), which
// replays any open that arrived before they had.

export const OPEN_CREATE_STUDIO = "open-create-studio";
export const OPEN_ORBIT_MENU = "open-orbit-menu";
export const OPEN_FEEDBACK = "relay-outpost:open-feedback";
/** Start a note the way the composer's own button does (community-aware). */
export const OPEN_NOTE_COMPOSER = "open-note-composer";

export function openCreateStudio(): void {
  window.dispatchEvent(new CustomEvent(OPEN_CREATE_STUDIO));
}

export function openOrbitMenu(): void {
  window.dispatchEvent(new CustomEvent(OPEN_ORBIT_MENU));
}

export function openNoteComposer(): void {
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_COMPOSER));
}

/** Everything that opens the overlays DeferredShell holds back at launch. */
export const SHELL_OVERLAY_EVENTS = [
  OPEN_CREATE_STUDIO,
  OPEN_ORBIT_MENU,
  // CreatePostFAB's composer
  OPEN_NOTE_COMPOSER,
  "open-compose",
  "open-compose-schedule",
  "edit-scheduled-post",
] as const;

export const FEEDBACK_EVENTS = [OPEN_FEEDBACK] as const;
