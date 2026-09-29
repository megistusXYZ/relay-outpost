/**
 * What "start a note" means where you are. Shared by the composer's floating
 * button and by Create › Note (the "open-note-composer" event), so both behave
 * the same in a community as anywhere else.
 */
export type NoteComposeAction =
  | { kind: "composer" }
  | { kind: "outpost"; type: "note" | "topic" }
  | { kind: "horizon" }
  | { kind: "none" };

export function noteComposeAction(
  outpost: { activeTab: string; canPostHorizon?: boolean } | null | undefined,
): NoteComposeAction {
  if (!outpost) return { kind: "composer" };
  if (outpost.activeTab === "horizon") return outpost.canPostHorizon ? { kind: "horizon" } : { kind: "none" };
  return { kind: "outpost", type: outpost.activeTab === "topics" ? "topic" : "note" };
}
