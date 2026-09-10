/**
 * The shape of the News stream: a quiet lead story, then your stories in time
 * groups (Today / Yesterday / weekday). Pure, so the rules are node-testable;
 * RSSFeed only wires them in. See news-stream.test.ts.
 */
import { mergeItemId, type MergeableItem, type MergedItem } from "./rss-merge";
import { chatDayLabel, startOfLocalDay } from "./day-label";
import { imageFit } from "./news-image";

/** How far down the newest unread stories the lead looks for a good picture. */
const LEAD_WINDOW = 10;

function timeOf(item: MergeableItem): number {
  const t = Date.parse(item.pubDate || "");
  return Number.isFinite(t) ? t : 0;
}

function hasLeadPicture<T extends MergeableItem>(m: MergedItem<T>): boolean {
  const item = m.item as MergeableItem & { thumbnail?: string; thumbnailWidth?: number };
  const feedImage = (m.source as { feedImage?: string }).feedImage;
  return imageFit(item.thumbnail || "", { width: item.thumbnailWidth, feedImage })?.fit === "lead";
}

/**
 * The quiet lead: the newest unread story whose picture is big enough to lead
 * (among the newest few), otherwise the newest unread story as a text lead.
 * Nothing when everything is read: the lead never resurfaces a read story.
 */
export function pickLead<T extends MergeableItem>(
  items: MergedItem<T>[],
  isRead: (item: T) => boolean,
): MergedItem<T> | null {
  const unread = items.filter((m) => !isRead(m.item)).sort((a, b) => timeOf(b.item) - timeOf(a.item));
  if (unread.length === 0) return null;
  return unread.slice(0, LEAD_WINDOW).find(hasLeadPicture) ?? unread[0];
}

/**
 * The stream's order: strictly newest first (undated stories last). No
 * unread-first split, per-source caps or source balancing: time is the only
 * ranking, so the times you read down the column always go back in time. See
 * the test for why balancing was dropped.
 */
export function orderStream<T extends MergeableItem>(items: MergedItem<T>[]): MergedItem<T>[] {
  return [...items].sort((a, b) => timeOf(b.item) - timeOf(a.item));
}

export interface NewsMutes {
  mutedSources?: Iterable<string>;
  mutedKeywords?: Iterable<string>;
}

/**
 * The stream without what you chose to mute: a muted source, or a muted
 * keyword in a story's title or summary (case-insensitive, the same matching
 * news-scoring used). Nothing else is hidden: the stream no longer drops
 * stories by our own scoring.
 */
export function withoutMuted<T extends MergeableItem>(items: MergedItem<T>[], mutes: NewsMutes): MergedItem<T>[] {
  const sources = new Set(mutes.mutedSources ?? []);
  const words = [...(mutes.mutedKeywords ?? [])].map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (sources.size === 0 && words.length === 0) return items;
  return items.filter((m) => {
    if (sources.has(m.source.url)) return false;
    if (words.length === 0) return true;
    const item = m.item as MergeableItem & { title?: string; description?: string };
    const text = `${item.title ?? ""} ${item.description ?? ""}`.toLowerCase();
    return !words.some((w) => text.includes(w));
  });
}

export interface DayGroup<T extends MergeableItem = MergeableItem> {
  label: string;
  items: MergedItem<T>[];
}

/**
 * Stories in time groups: Today / Yesterday / weekday / date, newest day
 * first. Within a day the given order is kept, so the stream's frozen order
 * (useStableOrder) survives and nothing reshuffles as feeds stream in. A story
 * dated in the future (a publisher's clock or time zone slip) counts as today;
 * stories with no usable date go in a last "Earlier" group.
 */
export function groupByDay<T extends MergeableItem>(ordered: MergedItem<T>[], now: number): DayGroup<T>[] {
  const today = startOfLocalDay(now);
  const byDay = new Map<number, MergedItem<T>[]>();
  const undated: MergedItem<T>[] = [];
  for (const m of ordered) {
    const t = Date.parse(m.item.pubDate || "");
    if (!Number.isFinite(t)) {
      undated.push(m);
      continue;
    }
    const day = Math.min(startOfLocalDay(t), today);
    const group = byDay.get(day);
    if (group) group.push(m);
    else byDay.set(day, [m]);
  }
  const groups: DayGroup<T>[] = [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, items]) => ({ label: chatDayLabel(day, now), items }));
  if (undated.length > 0) groups.push({ label: "Earlier", items: undated });
  return groups;
}

/**
 * Everything but the lead, compared by story id (guid, id or link), not by
 * object: the live feed can replace a remembered copy of the lead with a fresh
 * object for the same story, and comparing objects then showed it twice.
 */
export function withoutLead<T extends MergeableItem>(
  items: MergedItem<T>[],
  lead: MergedItem<T> | null,
): MergedItem<T>[] {
  if (!lead) return items;
  const leadId = mergeItemId(lead.item);
  if (!leadId) return items.filter((m) => m.item !== lead.item);
  return items.filter((m) => mergeItemId(m.item) !== leadId);
}
