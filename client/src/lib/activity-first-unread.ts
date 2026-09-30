/**
 * Where a second tap on the Activity tab takes you (lib/footer-nav.ts): the
 * first section, top to bottom, that holds something unread. The page then
 * opens that section if it was collapsed and scrolls to its first unread
 * item. Nothing is marked as read by getting there.
 */
export function firstUnreadSection(
  grouped: readonly { type: string; items: readonly { read?: boolean }[] }[],
  /** The category tab in view: "all", or one section's type. */
  filter: string,
): { type: string; /** The unread is outside the filtered view: show All to reach it. */ showAll: boolean } | null {
  const hasUnread = (g: { items: readonly { read?: boolean }[] }) => g.items.some((n) => !n.read);
  const inView = filter === "all" ? grouped : grouped.filter((g) => g.type === filter);
  const here = inView.find(hasUnread);
  if (here) return { type: here.type, showAll: false };
  const elsewhere = grouped.find(hasUnread);
  return elsewhere ? { type: elsewhere.type, showAll: true } : null;
}
