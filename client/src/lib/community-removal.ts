/**
 * Removing a post from a community (owner, 2026-10-11): the admin's removal
 * is the relay's fact ("not here any more"), never the author's doing, so it
 * never borrows the author's words. One confirmation for posts, topics and
 * comments; a log entry; a placeholder only where replies hang off the
 * removed post; and a private note to the author.
 */
export type RemovalKind = "post" | "topic" | "comment" | "ban";

export const REMOVED_BY_COMMUNITY = "Removed by the community";

export function removalWords(kind: RemovalKind, communityName: string): { title: string; description: string; confirmLabel: string } {
  if (kind === "ban") {
    return {
      title: `Ban this person from ${communityName}?`,
      description: `Their posts are removed from ${communityName} and they can't post here again.`,
      confirmLabel: "Ban",
    };
  }
  return {
    title: `Remove from ${communityName}?`,
    description: `This removes it from ${communityName}. The author gets a private message saying so.`,
    confirmLabel: "Remove",
  };
}

/** The private message the author receives. No reason yet (owner: later, from a short list). */
export function removalNotice(communityName: string): string {
  return `Your post was removed from ${communityName} by a community admin.`;
}
