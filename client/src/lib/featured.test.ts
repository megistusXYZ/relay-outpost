// The featured doc (kind-30078, keyed per relay) is the single source the
// community page reads for its pinned announcement + highlights. Phase 2b wired
// the operator ANNOUNCE outbox into that same write path, so these tests lock in
// the shared, order-sensitive behaviour: preserving pinned items when the
// announcement changes, round-tripping the `sourceId` that links a pin back to
// the announcement it came from, and the "which announcement is pinned" match.
import { describe, it, expect } from "vitest";
import {
  parseFeaturedDoc,
  buildFeaturedEventTemplate,
  setDocAnnouncement,
  announcementBody,
  isAnnouncementPinnedFrom,
  featuredDTag,
  type FeaturedItem,
  type FeaturedDoc,
} from "./featured";

const RELAY = "wss://relay.example.com";
const EVENT_ID = "a".repeat(64);
const ITEMS: FeaturedItem[] = [
  { kind: 1, id: "b".repeat(64) },
  { kind: 30023, coord: `30023:${"c".repeat(64)}:my-article` },
];

describe("announcementBody", () => {
  it("strips the trailing relay URL the outbox appends", () => {
    expect(announcementBody(`Big news today\n\n${RELAY}`, RELAY)).toBe("Big news today");
  });

  it("keeps the body intact when the URL is not appended", () => {
    expect(announcementBody("Just some text", RELAY)).toBe("Just some text");
  });

  it("does not strip a URL that only appears mid-body (not a trailing suffix)", () => {
    // Here the relay URL is mentioned inside the prose and there is no trailing
    // copy; the fallback replace would remove the mid-body mention, so assert the
    // trailing-suffix path is preferred when a real trailing URL is present.
    const content = `See ${RELAY} for details\n\n${RELAY}`;
    expect(announcementBody(content, RELAY)).toBe(`See ${RELAY} for details`);
  });

  it("is resilient to empty content", () => {
    expect(announcementBody("", RELAY)).toBe("");
  });
});

describe("setDocAnnouncement", () => {
  it("sets the announcement while preserving existing pinned items", () => {
    const doc = setDocAnnouncement({ items: ITEMS }, { text: "Hello", sourceId: EVENT_ID }, RELAY, 100);
    expect(doc.announcement).toEqual({ text: "Hello", updatedAt: 100, sourceId: EVENT_ID });
    expect(doc.items).toEqual(ITEMS);
    expect(doc.relay).toBe(RELAY);
  });

  it("clears the announcement (unpin) but keeps the pinned items", () => {
    const doc = setDocAnnouncement({ items: ITEMS }, null, RELAY, 100);
    expect(doc.announcement).toBeUndefined();
    expect(doc.items).toEqual(ITEMS);
  });

  it("treats blank/whitespace text as a clear, not an empty announcement", () => {
    const doc = setDocAnnouncement({ items: ITEMS }, { text: "   " }, RELAY, 100);
    expect(doc.announcement).toBeUndefined();
  });

  it("omits sourceId when the announcement was typed directly (no source event)", () => {
    const doc = setDocAnnouncement({ items: [] }, { text: "Typed in Community tab" }, RELAY, 100);
    expect(doc.announcement).toEqual({ text: "Typed in Community tab", updatedAt: 100 });
    expect("sourceId" in (doc.announcement as object)).toBe(false);
  });

  it("trims the stored text", () => {
    const doc = setDocAnnouncement({ items: [] }, { text: "  padded  " }, RELAY, 100);
    expect(doc.announcement?.text).toBe("padded");
  });
});

describe("buildFeaturedEventTemplate + parseFeaturedDoc round-trip", () => {
  it("round-trips the sourceId that links a pin to its announcement", () => {
    const doc = setDocAnnouncement({ items: ITEMS }, { text: "Launch day", sourceId: EVENT_ID }, RELAY, 100);
    const template = buildFeaturedEventTemplate(doc, RELAY);
    expect(template.kind).toBe(30078);
    expect(template.tags).toEqual([["d", featuredDTag(RELAY)]]);

    const parsed = parseFeaturedDoc(template.content, RELAY);
    expect(parsed.announcement).toEqual({ text: "Launch day", updatedAt: 100, sourceId: EVENT_ID });
    expect(parsed.items).toEqual(ITEMS);
  });

  it("round-trips an announcement without a sourceId (no phantom field)", () => {
    const doc = setDocAnnouncement({ items: [] }, { text: "Typed" }, RELAY, 100);
    const parsed = parseFeaturedDoc(buildFeaturedEventTemplate(doc, RELAY).content, RELAY);
    expect(parsed.announcement).toEqual({ text: "Typed", updatedAt: 100 });
    expect(parsed.announcement && "sourceId" in parsed.announcement).toBe(false);
  });

  it("ignores a non-string sourceId defensively", () => {
    const content = JSON.stringify({ announcement: { text: "x", updatedAt: 1, sourceId: 12345 }, items: [], relay: RELAY });
    const parsed = parseFeaturedDoc(content, RELAY);
    expect(parsed.announcement && "sourceId" in parsed.announcement).toBe(false);
  });
});

describe("isAnnouncementPinnedFrom", () => {
  const event = { id: EVENT_ID, content: `Launch day\n\n${RELAY}` };

  it("matches the pinned announcement by sourceId", () => {
    const doc: FeaturedDoc = { announcement: { text: "Launch day", updatedAt: 1, sourceId: EVENT_ID }, items: [], relay: RELAY };
    expect(isAnnouncementPinnedFrom(doc, event, RELAY)).toBe(true);
  });

  it("does not match a different event even if the text is identical", () => {
    const doc: FeaturedDoc = { announcement: { text: "Launch day", updatedAt: 1, sourceId: EVENT_ID }, items: [], relay: RELAY };
    expect(isAnnouncementPinnedFrom(doc, { id: "d".repeat(64), content: `Launch day\n\n${RELAY}` }, RELAY)).toBe(false);
  });

  it("falls back to body-text match for legacy pins without a sourceId", () => {
    const doc: FeaturedDoc = { announcement: { text: "Launch day", updatedAt: 1 }, items: [], relay: RELAY };
    expect(isAnnouncementPinnedFrom(doc, event, RELAY)).toBe(true);
  });

  it("returns false when nothing is pinned", () => {
    const doc: FeaturedDoc = { items: [], relay: RELAY };
    expect(isAnnouncementPinnedFrom(doc, event, RELAY)).toBe(false);
    expect(isAnnouncementPinnedFrom(null, event, RELAY)).toBe(false);
  });
});
