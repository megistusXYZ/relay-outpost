/**
 * The room on screen, kept in the link (`?channel=`), so a reload or a shared
 * link opens the same room.
 *
 * Found in the browser (2026-09-12): switching rooms changed the room on
 * screen but not the link, so a reload or a shared link reopened the room you
 * started in.
 */
import { useEffect, useRef } from "react";

/** Link parameters that belong to the room they arrived with: an invite code joins THAT room. */
const ROOM_BOUND = ["code", "invite"];

/** `search` with `roomId` as its room (none: all rooms), everything else kept. */
export function withRoom(search: string, roomId: string | null): string {
  const params = new URLSearchParams(search);
  if (params.get("channel") !== roomId) for (const p of ROOM_BOUND) params.delete(p);
  if (roomId) params.set("channel", roomId);
  else params.delete("channel");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/**
 * A room was written onto a phone sheet's back-guard entry (the sheet was
 * open when the room was picked). The page's own entry underneath still names
 * the previous room, so the next Back lands there; that Back must restore the
 * room on screen, not follow the stale link.
 */
let restoring = false;

/**
 * True while that Back is being handled. Anything that follows `?channel=`
 * must skip it: the router's own listener runs before this module's, and
 * React re-renders in between with the stale link. Found by logging every
 * history call: the chat followed the stale link back to the old room before
 * the restore ever ran.
 */
export function isRestoringRoom(): boolean {
  return restoring;
}

/** Write the room into the current entry, only while still on the page that owns it. */
function writeRoom(roomId: string | null | undefined, ownPath: string | null): void {
  if (roomId === undefined) return;
  try {
    const { pathname, search, hash } = window.location;
    if (ownPath && pathname !== ownPath) return;
    const next = withRoom(search, roomId);
    if (next === search) return;
    if ((window.history.state as { roModalGuard?: boolean } | null)?.roModalGuard) restoring = true;
    // replaceState, never push: a room switch is not a step Back should undo.
    // app-history keeps roHistIdx and _scrollToken through a null state.
    window.history.replaceState(null, "", pathname + next + hash);
  } catch { /* no history API: the room still switches, the link just lags */ }
}

/**
 * Keep the link pointing at the room on screen. `undefined` means no answer
 * yet (a room link still resolving), so the link is left alone; `null` means
 * all rooms.
 *
 * After a room was written onto a phone sheet's guard entry (see `restoring`),
 * the next Back writes the room on screen onto the page's own entry. Any
 * other Back is left alone: it's a real step back, and the link is followed.
 */
export function useRoomInUrl(roomId: string | null | undefined): void {
  const room = useRef(roomId);
  room.current = roomId;
  const ownPath = useRef<string | null>(null);
  useEffect(() => { ownPath.current = window.location.pathname; }, []);
  useEffect(() => { writeRoom(roomId, ownPath.current); }, [roomId]);
  useEffect(() => {
    const onPop = () => {
      if (!restoring) return;
      restoring = false;
      writeRoom(room.current, ownPath.current);
    };
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("popstate", onPop); restoring = false; };
  }, []);
}
