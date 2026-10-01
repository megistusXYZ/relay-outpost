/**
 * The profile's pinned rail on desktop (owner, 2026-10-01).
 *
 * The left rail's content ends after about 900px; a busy profile scrolls for
 * 40,000. Once the identity cards have left, the rail pins and becomes a
 * companion to the stream beside it: a time spine (where you are in their
 * history, click to jump) and the pictures from that stretch.
 *
 * The spine is LABELS ONLY. No bars, no counts per period: that would be the
 * contribution graph this profile deliberately does not have (see
 * IdentityPresence) turned on its side. It is for moving around, not for
 * judging how much someone posts.
 *
 * Everything here is pure; ProfileCompanion.tsx does the measuring.
 */

/** Time "chapter" a post belongs to — the stream's headings and the spine's
 *  rows are the same words, from the same function. */
export function timeChapter(ts: number, now: number = Date.now()): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  if (diffDays < 31) return "This month";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The chapters of a stream, in the order their headings appear. `ts` is the
 *  time the row is SORTED by (a repost's is when it was reposted). */
export function streamChapters(items: readonly { ts: number }[], now: number = Date.now()): string[] {
  const out: string[] = [];
  for (const item of items) {
    const label = timeChapter(item.ts, now);
    if (out[out.length - 1] !== label) out.push(label);
  }
  return out;
}

/**
 * The chapter being read: the last heading that has passed the reading line.
 * Before any has (the top of the page), it is the first chapter.
 */
export function currentChapter(headings: readonly { label: string; top: number }[], line: number): string | null {
  if (headings.length === 0) return null;
  let current = headings[0].label;
  for (const h of headings) {
    if (h.top <= line) current = h.label;
  }
  return current;
}

export interface CompanionMedia {
  /** The post the picture is in: a tap goes to it. */
  eventId: string;
  url: string;
  isVideo: boolean;
  poster?: string;
  chapter: string;
}

/**
 * The pictures to show beside the chapter being read.
 *
 * A stretch with no pictures falls back to their most recent ones, labelled
 * "Recent" (owner call): an empty panel in the rail is the very problem the
 * rail exists to fix. Nothing at all to show returns no items, and the panel
 * is not drawn.
 */
export function mediaForChapter(
  media: readonly CompanionMedia[],
  chapter: string | null,
  limit = 5,
): { label: string; items: CompanionMedia[]; fallback: boolean } {
  const mine = chapter ? media.filter((m) => m.chapter === chapter) : [];
  if (mine.length > 0) return { label: chapter as string, items: mine.slice(0, limit), fallback: false };
  return { label: "Recent", items: media.slice(0, limit), fallback: true };
}
