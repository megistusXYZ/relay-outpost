import { describe, it, expect } from "vitest";
import {
  parseTranscript,
  parseChapters,
  detectTranscriptFormat,
  findChapterIndex,
  type TranscriptSegment,
} from "./podcast-transcript";

// ---------------------------------------------------------------------------
// Fixtures — realistic samples of the three common `podcast:transcript`
// formats plus the Podcasting 2.0 chapters JSON.
// ---------------------------------------------------------------------------

const SRT_FIXTURE = `1
00:00:00,000 --> 00:00:02,500
Adam: Welcome back to the show.

2
00:00:02,500 --> 00:00:06,000
Dave: Thanks for having me, it's great
to be here again.

3
00:01:02,000 --> 00:01:05,250
Let's talk about value for value.
`;

const SRT_CRLF_FIXTURE = SRT_FIXTURE.replace(/\n/g, "\r\n");

// SRT without index lines (some hosts emit bare cue blocks) + short mm:ss times.
const SRT_NO_INDEX_FIXTURE = `00:00,000 --> 00:04,000
First cue without an index.

00:04,000 --> 00:09,500
Second cue without an index.
`;

const VTT_FIXTURE = `WEBVTT

NOTE This is a comment and must be skipped.

STYLE
::cue { color: papayawhip; }

intro
00:00.000 --> 00:02.500 align:start position:0%
<v Adam>Welcome back to the show.</v>

00:02.500 --> 00:06.000
<v Dave>Thanks for having me, <i>it's great</i>
to be here again.</v>

01:00:02.000 --> 01:00:05.250
Plain cue with no voice tag.
`;

// Podcasting 2.0 JSON transcript, sentence-level segments.
const JSON_FIXTURE = JSON.stringify({
  version: "1.0.0",
  segments: [
    { speaker: "Adam", startTime: 0, endTime: 2.5, body: "Welcome back to the show." },
    { speaker: "Dave", startTime: 2.5, endTime: 6, body: "Thanks for having me." },
    { startTime: 62, endTime: 65.25, body: "Let's talk about value for value." },
  ],
});

// Word-level JSON transcript (each segment a single word) — must be coalesced
// into readable lines rather than rendered one word per row.
const JSON_WORD_LEVEL_FIXTURE = JSON.stringify({
  version: "1.0.0",
  segments: [
    { speaker: "Darth", startTime: 0.5, endTime: 0.7, body: "I" },
    { speaker: "Darth", startTime: 0.7, endTime: 0.9, body: "am" },
    { speaker: "Darth", startTime: 0.9, endTime: 1.2, body: "your" },
    { speaker: "Darth", startTime: 1.2, endTime: 1.6, body: "father." },
    { speaker: "Luke", startTime: 2.0, endTime: 2.4, body: "No." },
    { speaker: "Luke", startTime: 2.4, endTime: 2.8, body: "That's" },
    { speaker: "Luke", startTime: 2.8, endTime: 3.0, body: "not" },
    { speaker: "Luke", startTime: 3.0, endTime: 3.4, body: "true!" },
  ],
});

// Alternate JSON key spellings seen in the wild.
const JSON_ALT_KEYS_FIXTURE = JSON.stringify([
  { start: 0, end: 3, text: "Alternate key spelling one." },
  { start: 3, end: 6, text: "Alternate key spelling two." },
]);

const CHAPTERS_FIXTURE = JSON.stringify({
  version: "1.2.0",
  chapters: [
    { startTime: 0, title: "Intro", img: "https://example.com/intro.jpg" },
    { startTime: 120, title: "Interview", url: "https://example.com/guest" },
    { startTime: 60, title: "News" },
    { startTime: 500, title: "Hidden", toc: false },
    { startTime: 900 },
  ],
});

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

describe("detectTranscriptFormat", () => {
  it("detects SRT", () => {
    expect(detectTranscriptFormat(SRT_FIXTURE)).toBe("srt");
    expect(detectTranscriptFormat(SRT_NO_INDEX_FIXTURE)).toBe("srt");
  });

  it("detects WebVTT", () => {
    expect(detectTranscriptFormat(VTT_FIXTURE)).toBe("vtt");
    expect(detectTranscriptFormat("﻿WEBVTT\n\n00:00.000 --> 00:01.000\nHi")).toBe("vtt");
  });

  it("detects JSON", () => {
    expect(detectTranscriptFormat(JSON_FIXTURE)).toBe("json");
    expect(detectTranscriptFormat(JSON_ALT_KEYS_FIXTURE)).toBe("json");
  });

  it("returns null for garbage", () => {
    expect(detectTranscriptFormat("<html><body>Not a transcript</body></html>")).toBeNull();
    expect(detectTranscriptFormat("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

describe("parseTranscript — SRT", () => {
  it("parses cues with hours, speakers, and multi-line text", () => {
    const segs = parseTranscript(SRT_FIXTURE);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ start: 0, end: 2.5, speaker: "Adam", text: "Welcome back to the show." });
    expect(segs[1].speaker).toBe("Dave");
    expect(segs[1].text).toBe("Thanks for having me, it's great to be here again.");
    expect(segs[2].start).toBeCloseTo(62);
    expect(segs[2].end).toBeCloseTo(65.25);
    expect(segs[2].speaker).toBeUndefined();
  });

  it("handles CRLF line endings", () => {
    const segs = parseTranscript(SRT_CRLF_FIXTURE);
    expect(segs).toHaveLength(3);
    expect(segs[0].text).toBe("Welcome back to the show.");
  });

  it("handles blocks without index lines and mm:ss times", () => {
    const segs = parseTranscript(SRT_NO_INDEX_FIXTURE);
    expect(segs).toHaveLength(2);
    expect(segs[0].start).toBe(0);
    expect(segs[0].end).toBe(4);
    expect(segs[1].end).toBeCloseTo(9.5);
  });

  it("skips malformed cue blocks without throwing", () => {
    const mangled = `1
not-a-timestamp --> also-not
Broken cue.

2
00:00:10,000 --> 00:00:12,000
Good cue.
`;
    const segs = parseTranscript(mangled, "srt");
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("Good cue.");
  });

  it("accepts mime-type format hints", () => {
    expect(parseTranscript(SRT_FIXTURE, "application/srt")).toHaveLength(3);
    expect(parseTranscript(SRT_FIXTURE, "application/x-subrip")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

describe("parseTranscript — WebVTT", () => {
  it("parses cues, voice-tag speakers, and strips markup", () => {
    const segs = parseTranscript(VTT_FIXTURE);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ start: 0, end: 2.5, speaker: "Adam", text: "Welcome back to the show." });
    expect(segs[1].speaker).toBe("Dave");
    expect(segs[1].text).toBe("Thanks for having me, it's great to be here again.");
    expect(segs[2].start).toBeCloseTo(3602);
    expect(segs[2].speaker).toBeUndefined();
  });

  it("skips NOTE and STYLE blocks", () => {
    const segs = parseTranscript(VTT_FIXTURE, "text/vtt");
    expect(segs.some((s) => s.text.includes("comment"))).toBe(false);
    expect(segs.some((s) => s.text.includes("papayawhip"))).toBe(false);
  });

  it("tolerates a header-only file", () => {
    expect(parseTranscript("WEBVTT\n", "vtt")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

describe("parseTranscript — JSON", () => {
  it("parses sentence-level Podcasting 2.0 segments", () => {
    const segs = parseTranscript(JSON_FIXTURE);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ start: 0, end: 2.5, speaker: "Adam", text: "Welcome back to the show." });
    expect(segs[2].speaker).toBeUndefined();
  });

  it("coalesces word-level segments into readable lines per speaker", () => {
    const segs = parseTranscript(JSON_WORD_LEVEL_FIXTURE);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ speaker: "Darth", text: "I am your father." });
    expect(segs[0].start).toBeCloseTo(0.5);
    expect(segs[0].end).toBeCloseTo(1.6);
    expect(segs[1]).toMatchObject({ speaker: "Luke", text: "No. That's not true!" });
  });

  it("accepts alternate key spellings and bare arrays", () => {
    const segs = parseTranscript(JSON_ALT_KEYS_FIXTURE, "application/json");
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: 0, end: 3, text: "Alternate key spelling one." });
  });

  it("drops entries without usable time or text", () => {
    const segs = parseTranscript(
      JSON.stringify({
        segments: [
          { startTime: 0, endTime: 1, body: "Good." },
          { startTime: "nope", endTime: 2, body: "Bad time." },
          { startTime: 3, endTime: 4, body: "" },
          "not-an-object",
        ],
      }),
      "json",
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("Good.");
  });
});

// ---------------------------------------------------------------------------
// Malformed input tolerance
// ---------------------------------------------------------------------------

describe("parseTranscript — malformed input", () => {
  const garbage = [
    "",
    "   \n\n  ",
    "<html><head><title>404</title></head></html>",
    "{ definitely not json",
    JSON.stringify({ hello: "world" }),
    " binary-ish",
  ];

  it("never throws and returns [] for unparseable input", () => {
    for (const g of garbage) {
      expect(() => parseTranscript(g)).not.toThrow();
      expect(parseTranscript(g)).toEqual([]);
    }
  });

  it("ignores an unknown declared format and falls back to detection", () => {
    expect(parseTranscript(SRT_FIXTURE, "application/pdf")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

describe("parseChapters", () => {
  it("parses, sorts by startTime, and excludes toc:false chapters", () => {
    const chapters = parseChapters(CHAPTERS_FIXTURE);
    expect(chapters.map((c) => c.startTime)).toEqual([0, 60, 120, 900]);
    expect(chapters[0]).toMatchObject({ startTime: 0, title: "Intro", img: "https://example.com/intro.jpg" });
    expect(chapters[2]).toMatchObject({ startTime: 120, title: "Interview", url: "https://example.com/guest" });
    expect(chapters.some((c) => c.title === "Hidden")).toBe(false);
  });

  it("tolerates a missing title (empty string)", () => {
    const chapters = parseChapters(CHAPTERS_FIXTURE);
    const untitled = chapters.find((c) => c.startTime === 900);
    expect(untitled).toBeDefined();
    expect(untitled!.title).toBe("");
  });

  it("accepts pre-parsed objects too", () => {
    const chapters = parseChapters({ version: "1.2.0", chapters: [{ startTime: 5, title: "Only" }] });
    expect(chapters).toEqual([{ startTime: 5, title: "Only" }]);
  });

  it("drops invalid entries and never throws on garbage", () => {
    expect(parseChapters("not json at all")).toEqual([]);
    expect(parseChapters("")).toEqual([]);
    expect(parseChapters(null)).toEqual([]);
    expect(parseChapters(JSON.stringify({ chapters: [{ title: "no time" }, { startTime: -5, title: "negative" }] }))).toEqual([]);
    expect(parseChapters(JSON.stringify({ chapters: "wrong shape" }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chapter lookup
// ---------------------------------------------------------------------------

describe("findChapterIndex", () => {
  const chapters = [
    { startTime: 0, title: "A" },
    { startTime: 60, title: "B" },
    { startTime: 120, title: "C" },
  ];

  it("finds the chapter containing a time", () => {
    expect(findChapterIndex(chapters, 0)).toBe(0);
    expect(findChapterIndex(chapters, 59.9)).toBe(0);
    expect(findChapterIndex(chapters, 60)).toBe(1);
    expect(findChapterIndex(chapters, 4000)).toBe(2);
  });

  it("returns -1 before the first chapter or with no chapters", () => {
    expect(findChapterIndex([{ startTime: 10, title: "A" }], 5)).toBe(-1);
    expect(findChapterIndex([], 30)).toBe(-1);
  });
});
