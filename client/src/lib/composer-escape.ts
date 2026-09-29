/**
 * What Escape does in the note composer. Layers on top of it (the mention
 * list, a media preview, pickers, dialogs) claim the key with preventDefault
 * before it reaches the composer's listener, so an Escape arriving unclaimed
 * is the composer's own.
 */
export type ComposerEscapeAction = "close" | "close-mention" | "ignore";

export function composerEscapeAction(
  e: { key: string; defaultPrevented: boolean; isComposing?: boolean },
  state: { mentionActive: boolean },
): ComposerEscapeAction {
  if (e.key !== "Escape" && e.key !== "Esc") return "ignore";
  if (e.defaultPrevented || e.isComposing) return "ignore";
  // A mention lookup with no results doesn't claim the key; close it first.
  if (state.mentionActive) return "close-mention";
  return "close";
}
