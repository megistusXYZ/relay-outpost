/**
 * The shape of the News stream: a quiet lead story, then your stories in time
 * groups (Today / Yesterday / weekday). Part of the 2026-09 calm redesign,
 * after the page felt "forced with our agenda and presets".
 */
import { describe, expect, it } from "vitest";
import { groupByDay, orderStream, pickLead, withoutLead, withoutMuted } from "./news-stream";
import type { MergedItem } from "./rss-merge";

const NOW = Date.parse("2026-09-10T18:00:00Z");

function story(id: string, hoursAgo: number, extra: Record<string, unknown> = {}): MergedItem {
  return {
    item: {
      id,
      title: `Story ${id}`,
      link: `https://example.com/${id}`,
      pubDate: new Date(NOW - hoursAgo * 3600_000).toISOString(),
      thumbnail: "",
      ...extra,
    } as MergedItem["item"],
    source: { url: "https://example.com/feed.xml", name: "Example" },
  };
}

describe("the lead story", () => {
  const idOf = (m: MergedItem | null) => (m ? (m.item as { id: string }).id : null);

  it("is the newest unread story with a picture big enough to lead, otherwise the newest unread one, and nothing when all is read", () => {
    const textOnly = story("text-only", 1);
    const bigPicture = story("big-picture", 3, { thumbnail: "https://example.com/big.jpg", thumbnailWidth: 1200 });
    const smallPicture = story("small-picture", 2, { thumbnail: "https://example.com/small.jpg", thumbnailWidth: 240 });
    const alreadyRead = story("already-read", 0.5, { thumbnail: "https://example.com/read.jpg", thumbnailWidth: 1200 });
    const isRead = (item: MergedItem["item"]) => (item as { id: string }).id === "already-read";

    expect(idOf(pickLead([textOnly, smallPicture, bigPicture, alreadyRead], isRead))).toBe("big-picture");
    expect(idOf(pickLead([smallPicture, textOnly], isRead))).toBe("text-only");
    expect(pickLead([alreadyRead], isRead)).toBeNull();
  });

  /**
   * The lead used to be removed from the list by object. After the live feed
   * replaced a remembered copy with a fresh object for the same story, the
   * story showed twice: once as the lead, once below it.
   */
  it("never repeats below the lead, even when the list holds a different copy of the same story", () => {
    const lead = story("a", 1);
    const freshCopyOfLead = story("a", 1);
    const rest = withoutLead([freshCopyOfLead, story("b", 2)], lead);
    expect(rest.map((m) => (m.item as { id: string }).id)).toEqual(["b"]);
  });
});

/**
 * Strictly by time. A source-balancing pass (no outlet back-to-back) was tried
 * first: on the real starter it alternated around the Guardian's ~45 stories a
 * day and pulled other outlets' stories up by as much as an hour, so the "36
 * minutes ago… about 1 hour ago… 30 minutes ago" times read as disorder in a
 * column labelled by time (measured in the browser, 2026-09-10).
 */
describe("the order", () => {
  it("is newest first, even when one outlet has the newest few stories in a row", () => {
    const other = { url: "https://other.example/feed", name: "Other" };
    const ordered = orderStream([
      story("a-older", 3),
      { ...story("b", 2), source: other },
      story("a-newest", 1),
      story("a-middle", 1.5),
      story("undated", 0, { pubDate: "" }),
    ]);
    expect(ordered.map((m) => (m.item as { id: string }).id)).toEqual(["a-newest", "a-middle", "b", "a-older", "undated"]);
  });
});

/**
 * The stream no longer hides stories by our own scoring (it used to drop
 * "low-priority" items once you had any read history). The only things it
 * leaves out are the ones you chose to mute.
 */
describe("your mutes", () => {
  it("hides a story from a source you muted, or with a keyword you muted in its title", () => {
    const kept = story("kept", 1);
    const fromMutedSource = { ...story("muted-source", 1), source: { url: "https://muted.example/feed", name: "Muted" } };
    const withMutedWord = story("muted-word", 1, { title: "Weekend celebrity Gossip roundup" });
    const visible = withoutMuted([kept, fromMutedSource, withMutedWord], {
      mutedSources: ["https://muted.example/feed"],
      mutedKeywords: ["gossip"],
    });
    expect(visible.map((m) => (m.item as { id: string }).id)).toEqual(["kept"]);
  });
});

describe("time groups", () => {
  // Local-time dates, so the day boundaries hold in any time zone.
  const at = (month: number, day: number, hour: number) => new Date(2026, month - 1, day, hour, 0).toISOString();
  const now = new Date(2026, 8, 10, 18, 0).getTime(); // Thursday 10 September, 6pm
  const ids = (groups: { label: string; items: MergedItem[] }[]) =>
    groups.map((g) => [g.label, g.items.map((m) => (m.item as { id: string }).id)]);

  it("groups stories under Today, Yesterday and the weekday, newest day first, keeping the given order within each day", () => {
    const ordered = [
      story("today-morning", 0, { pubDate: at(9, 10, 9) }),
      story("yesterday", 0, { pubDate: at(9, 9, 20) }),
      story("today-afternoon", 0, { pubDate: at(9, 10, 15) }),
      story("monday", 0, { pubDate: at(9, 7, 10) }),
    ];
    expect(ids(groupByDay(ordered, now))).toEqual([
      ["Today", ["today-morning", "today-afternoon"]],
      ["Yesterday", ["yesterday"]],
      ["Monday", ["monday"]],
    ]);
  });

  it("counts a story dated in the future as today, and puts stories with no date in a last 'Earlier' group", () => {
    const ordered = [
      story("undated", 0, { pubDate: "" }),
      story("tomorrow", 0, { pubDate: at(9, 11, 9) }),
      story("today", 0, { pubDate: at(9, 10, 12) }),
    ];
    expect(ids(groupByDay(ordered, now))).toEqual([
      ["Today", ["tomorrow", "today"]],
      ["Earlier", ["undated"]],
    ]);
  });
});
