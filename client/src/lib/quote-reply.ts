/**
 * A "quote-reply" — a post that replies to a note AND pastes that same note into
 * its own text — used to render the quoted note TWICE.
 *
 * Two independent code paths draw a referenced note and neither knew about the
 * other. The reply-context preview renders the e-tag target; the quote cards
 * render every `nostr:note1…` / `nevent…` found in the content. A quote-reply
 * satisfies both, so the note appeared once as a context preview and again as a
 * card immediately below it, with the author's own words — often none, since the
 * quote IS the post — nowhere between them.
 *
 * The rule is an ID comparison, not "does this post have any quote cards". That
 * distinction is the whole point: replying to one person while quoting a
 * different note is a normal thing to do, and both belong on screen.
 */
export function quotesItsParent(
  replyTargetId: string | null | undefined,
  quotedIds: readonly (string | undefined)[],
): boolean {
  if (!replyTargetId) return false;
  return quotedIds.some((id) => id === replyTargetId);
}
