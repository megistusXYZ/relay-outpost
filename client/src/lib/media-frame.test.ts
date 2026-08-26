import { describe, it, expect } from "vitest";
import {
  MEDIA_DOMINANT_PROSE_LIMIT,
  KIND_PICTURE,
  KIND_VIDEO,
  KIND_SHORT_VIDEO,
  isMediaEventKind,
  proseLength,
  hasQuotedNote,
  hasInlineMedia,
  isMediaDominant,
  frameFor,
  type FramableEvent,
} from "./media-frame";

const PHOTO = "https://cdn.example/a.jpg";
const CLIP = "https://cdn.example/a.mp4";

const ev = (over: Partial<FramableEvent> = {}): FramableEvent => ({
  kind: 1,
  content: "",
  tags: [],
  ...over,
});

describe("isMediaEventKind", () => {
  it("recognises the three dedicated media kinds", () => {
    expect(isMediaEventKind(KIND_PICTURE)).toBe(true);
    expect(isMediaEventKind(KIND_VIDEO)).toBe(true);
    expect(isMediaEventKind(KIND_SHORT_VIDEO)).toBe(true);
  });

  it("does not claim ordinary notes", () => {
    for (const k of [0, 1, 6, 7, 30023, 1111]) expect(isMediaEventKind(k)).toBe(false);
  });
});

describe("proseLength — what the reader actually reads", () => {
  it("counts plain text as itself", () => {
    expect(proseLength("hello there")).toBe(11);
  });

  it("does not count a mention's raw token", () => {
    // ~70 characters on the wire, "@alice" on screen. Counting the token would
    // push a photo with a single mention over the limit by itself.
    const npub = "nostr:npub1" + "q".repeat(58);
    expect(proseLength(`gm ${npub}`)).toBe(proseLength("gm "));
  });

  it("does not count hashtags", () => {
    // Fifteen tags is 200-odd characters of metadata; counting them would flip
    // an obvious photo post to inset.
    const tags = Array.from({ length: 15 }, (_, i) => `#tag${i}`).join(" ");
    expect(proseLength(tags)).toBe(0);
  });

  it("collapses the whitespace a stripped URL leaves behind", () => {
    expect(proseLength("a\n\n\n   b")).toBe(3); // "a b"
  });

  it("is zero for empty, whitespace, and undefined-ish input", () => {
    expect(proseLength("")).toBe(0);
    expect(proseLength("   \n\t ")).toBe(0);
    expect(proseLength(undefined as unknown as string)).toBe(0);
  });
});

describe("hasQuotedNote", () => {
  it("sees an explicit q tag", () => {
    expect(hasQuotedNote({ content: "", tags: [["q", "abc"]] })).toBe(true);
  });

  it("sees an event URI in the body", () => {
    expect(hasQuotedNote({ content: "look at nostr:nevent1qqq", tags: [] })).toBe(true);
    expect(hasQuotedNote({ content: "see nostr:note1abc", tags: [] })).toBe(true);
    expect(hasQuotedNote({ content: "see nostr:naddr1abc", tags: [] })).toBe(true);
  });

  it("does NOT treat a person mention as a quote", () => {
    // A quote renders a card; a mention renders as a name. Only the card is
    // the second focal point the rule is protecting against.
    expect(hasQuotedNote({ content: "hi nostr:npub1abc", tags: [] })).toBe(false);
  });

  it("is false for a plain post", () => {
    expect(hasQuotedNote({ content: "good morning", tags: [["t", "gm"]] })).toBe(false);
  });
});

describe("hasInlineMedia", () => {
  it("finds an image and a video", () => {
    expect(hasInlineMedia(`look ${PHOTO}`)).toBe(true);
    expect(hasInlineMedia(`look ${CLIP}`)).toBe(true);
  });

  it("ignores embeds, which carry their own player chrome", () => {
    // Full-bleeding someone else's branded iframe does not feel like
    // Instagram; it feels like a bigger iframe.
    expect(hasInlineMedia("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });

  it("ignores plain links and empty content", () => {
    expect(hasInlineMedia("https://example.com/article")).toBe(false);
    expect(hasInlineMedia("")).toBe(false);
  });
});

describe("isMediaDominant — the rule, in its decided order", () => {
  it("a bare photo is the post", () => {
    expect(isMediaDominant(ev({ content: PHOTO }))).toBe(true);
  });

  it("a photo with a caption is still the post", () => {
    expect(isMediaDominant(ev({ content: `sunset over the bay\n${PHOTO}` }))).toBe(true);
  });

  it("an essay with a screenshot is not", () => {
    // Past the limit the image is evidence for an argument, and full-bleeding
    // it would shout over the writing.
    const essay = "x".repeat(MEDIA_DOMINANT_PROSE_LIMIT + 1);
    expect(isMediaDominant(ev({ content: `${essay} ${PHOTO}` }))).toBe(false);
  });

  it("holds the boundary exactly at the limit", () => {
    const atLimit = "x".repeat(MEDIA_DOMINANT_PROSE_LIMIT);
    expect(isMediaDominant(ev({ content: `${atLimit} ${PHOTO}` }))).toBe(true);
    const overLimit = "x".repeat(MEDIA_DOMINANT_PROSE_LIMIT + 1);
    expect(isMediaDominant(ev({ content: `${overLimit} ${PHOTO}` }))).toBe(false);
  });

  it("text with no picture is never media-dominant", () => {
    expect(isMediaDominant(ev({ content: "just thinking out loud" }))).toBe(false);
  });

  it("a quoted note forces inset even for a bare photo", () => {
    // Two focal points: the rule exists so the hierarchy does not collapse.
    expect(isMediaDominant(ev({ content: `${PHOTO} nostr:nevent1qqq` }))).toBe(false);
    expect(isMediaDominant(ev({ content: PHOTO, tags: [["q", "abc"]] }))).toBe(false);
  });

  it("a dedicated media kind wins regardless of caption length", () => {
    // The author picked kind 20. That IS the declaration — overriding an
    // explicit choice with a caption heuristic would be the tail wagging.
    const long = "x".repeat(900);
    expect(isMediaDominant(ev({ kind: KIND_PICTURE, content: long }))).toBe(true);
    expect(isMediaDominant(ev({ kind: KIND_SHORT_VIDEO, content: long }))).toBe(true);
  });

  it("a media kind still yields to a quoted note", () => {
    expect(isMediaDominant(ev({ kind: KIND_PICTURE, content: "nostr:nevent1qqq" }))).toBe(false);
  });

  it("a media kind needs no URL in its body — the media lives in imeta", () => {
    expect(isMediaDominant(ev({ kind: KIND_VIDEO, content: "" }))).toBe(true);
  });

  it("hashtag spam under a photo does not demote it", () => {
    const tags = Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" ");
    expect(isMediaDominant(ev({ content: `${PHOTO} ${tags}` }))).toBe(true);
  });

  it("survives an empty or malformed event without throwing", () => {
    expect(isMediaDominant(ev())).toBe(false);
    expect(isMediaDominant({ kind: 1, content: undefined as unknown as string, tags: [] })).toBe(false);
  });
});

describe("frameFor", () => {
  it("names the two outcomes", () => {
    expect(frameFor(ev({ content: PHOTO }))).toBe("full-bleed");
    expect(frameFor(ev({ content: "hello" }))).toBe("inset");
  });
});
