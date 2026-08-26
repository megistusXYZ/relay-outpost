// Pure parsing for Podcasting 2.0 episode extras: `podcast:transcript` files
// (SRT, WebVTT, and the Podcasting 2.0 JSON transcript format) and
// `podcast:chapters` JSON. Everything here is best-effort and never throws —
// malformed input yields whatever segments could be salvaged, or [].
//
// Spec references:
//   https://github.com/Podcastindex-org/podcast-namespace/blob/main/transcripts/transcripts.md
//   https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/examples/chaptering/jsonChapters.md

export interface TranscriptSegment {
  /** Segment start, in seconds. */
  start: number;
  /** Segment end, in seconds (>= start; best-effort for word-level sources). */
  end: number;
  text: string;
  speaker?: string;
}

export interface PodcastChapter {
  /** Chapter start, in seconds. */
  startTime: number;
  /** May be empty when the source chapter has no title. */
  title: string;
  img?: string;
  url?: string;
}

export type TranscriptFormat = "srt" | "vtt" | "json";

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

// SRT arrow line: `00:00:00,000 --> 00:00:02,500` (comma OR dot ms, optional hours).
const SRT_TIME_LINE = /(?:\d{1,2}:)?\d{1,2}:\d{1,2}[,.]\d{1,3}\s+-->\s+(?:\d{1,2}:)?\d{1,2}:\d{1,2}[,.]\d{1,3}/;

/** Map a declared type (mime or short name) to a parser format, if recognizable. */
function normalizeFormat(declared?: string): TranscriptFormat | null {
  if (!declared) return null;
  const d = declared.toLowerCase();
  if (d.includes("json")) return "json";
  if (d.includes("vtt")) return "vtt";
  if (d.includes("srt") || d.includes("subrip")) return "srt";
  return null;
}

/** Best-effort sniff of the transcript format from the file body. */
export function detectTranscriptFormat(text: string): TranscriptFormat | null {
  if (typeof text !== "string") return null;
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (!trimmed) return null;
  if (/^WEBVTT/.test(trimmed)) return "vtt";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      return null;
    }
  }
  if (SRT_TIME_LINE.test(trimmed)) return "srt";
  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Parse `hh:mm:ss.mmm`, `mm:ss.mmm` (comma or dot ms) into seconds, or null. */
function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const mins = parseInt(m[2], 10);
  const secs = parseInt(m[3], 10);
  const ms = m[4] ? parseInt(m[4].padEnd(3, "0"), 10) : 0;
  if ([hours, mins, secs, ms].some((n) => !isFinite(n))) return null;
  return hours * 3600 + mins * 60 + secs + ms / 1000;
}

/** Collapse internal whitespace/newlines into single spaces. */
function squashWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Leading `Name:` speaker convention used by Podcasting 2.0 SRT transcripts.
// Conservative: short, no sentence punctuation inside the name.
const SRT_SPEAKER_RE = /^([A-Za-z][A-Za-z0-9 ._'-]{0,38}?):\s+(.*)$/s;

function extractInlineSpeaker(text: string): { speaker?: string; text: string } {
  const m = text.match(SRT_SPEAKER_RE);
  if (m && !m[1].includes("  ")) {
    return { speaker: m[1].trim(), text: m[2] };
  }
  return { text };
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

function parseSrt(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    // Optional numeric index line before the arrow line.
    let arrowIdx = lines.findIndex((l) => l.includes("-->"));
    if (arrowIdx === -1) continue;
    const [rawStart, rawEnd] = lines[arrowIdx].split("-->");
    const start = parseTimestamp(rawStart ?? "");
    const end = parseTimestamp((rawEnd ?? "").trim().split(/\s+/)[0] ?? "");
    if (start == null || end == null) continue;
    const body = squashWhitespace(lines.slice(arrowIdx + 1).join(" "));
    if (!body) continue;
    const { speaker, text: cleanText } = extractInlineSpeaker(body);
    segments.push({ start, end: Math.max(end, start), text: cleanText, ...(speaker ? { speaker } : {}) });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

function parseVtt(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    const first = lines[0].trim();
    if (first.startsWith("WEBVTT") || first.startsWith("NOTE") || first.startsWith("STYLE") || first.startsWith("REGION")) {
      continue;
    }
    const arrowIdx = lines.findIndex((l) => l.includes("-->"));
    if (arrowIdx === -1) continue;
    const timeLine = lines[arrowIdx];
    const [rawStart, rawRest] = timeLine.split("-->");
    const start = parseTimestamp(rawStart ?? "");
    // Cue settings (`align:start` etc.) may follow the end time.
    const end = parseTimestamp((rawRest ?? "").trim().split(/\s+/)[0] ?? "");
    if (start == null || end == null) continue;
    let body = lines.slice(arrowIdx + 1).join(" ");
    if (!body) continue;
    // Voice tag: <v Speaker>text</v> (closing tag optional in the wild).
    let speaker: string | undefined;
    const voice = body.match(/<v(?:\.[^ >]*)?\s+([^>]+)>/);
    if (voice) speaker = voice[1].trim();
    body = squashWhitespace(body.replace(/<[^>]*>/g, ""));
    if (!body) continue;
    segments.push({ start, end: Math.max(end, start), text: body, ...(speaker ? { speaker } : {}) });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Podcasting 2.0 JSON
// ---------------------------------------------------------------------------

function toFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function parseJsonTranscript(text: string): TranscriptSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const rawSegments: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).segments)
      ? (parsed as any).segments
      : [];
  const segments: TranscriptSegment[] = [];
  for (const raw of rawSegments) {
    if (!raw || typeof raw !== "object") continue;
    const seg = raw as Record<string, unknown>;
    const start = toFiniteNumber(seg.startTime) ?? toFiniteNumber(seg.start);
    const endRaw = toFiniteNumber(seg.endTime) ?? toFiniteNumber(seg.end);
    const body = typeof seg.body === "string" ? seg.body : typeof seg.text === "string" ? seg.text : "";
    const cleanText = squashWhitespace(body);
    if (start == null || start < 0 || !cleanText) continue;
    const speaker = typeof seg.speaker === "string" && seg.speaker.trim() ? seg.speaker.trim() : undefined;
    segments.push({
      start,
      end: endRaw != null ? Math.max(endRaw, start) : start,
      text: cleanText,
      ...(speaker ? { speaker } : {}),
    });
  }
  segments.sort((a, b) => a.start - b.start);
  return coalesceWordLevel(segments);
}

// Many JSON transcripts are word-level (one segment per word). Rendering those
// one-per-row is unreadable, so when segments look word-sized we merge runs of
// the same speaker into sentence-ish lines.
const COALESCE_MAX_CHARS = 200;

function coalesceWordLevel(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length < 4) return segments;
  const avgLen = segments.reduce((sum, s) => sum + s.text.length, 0) / segments.length;
  if (avgLen > 16) return segments; // already sentence/paragraph level
  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  for (const seg of segments) {
    if (
      current &&
      current.speaker === seg.speaker &&
      current.text.length + seg.text.length + 1 <= COALESCE_MAX_CHARS
    ) {
      current.text = `${current.text} ${seg.text}`;
      current.end = Math.max(current.end, seg.end);
    } else {
      if (current) merged.push(current);
      current = { ...seg };
    }
  }
  if (current) merged.push(current);
  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a transcript file body into normalized segments. `declaredType` is the
 * `podcast:transcript` `type` attribute (mime or short name) when known; the
 * format is sniffed from the body when absent or unrecognized. Never throws.
 */
export function parseTranscript(text: string, declaredType?: string): TranscriptSegment[] {
  try {
    if (typeof text !== "string" || !text.trim()) return [];
    const format = normalizeFormat(declaredType) ?? detectTranscriptFormat(text);
    if (!format) return [];
    // A declared format can be wrong (mislabelled feeds); if it yields nothing,
    // fall back to sniffing before giving up.
    const parse = (f: TranscriptFormat) =>
      f === "srt" ? parseSrt(text) : f === "vtt" ? parseVtt(text) : parseJsonTranscript(text);
    const segments = parse(format);
    if (segments.length > 0) return segments;
    const sniffed = detectTranscriptFormat(text);
    if (sniffed && sniffed !== format) return parse(sniffed);
    return segments;
  } catch {
    return [];
  }
}

/**
 * Parse a Podcasting 2.0 chapters document (JSON string or pre-parsed object)
 * into a sorted chapter list. Chapters marked `toc: false` are excluded, as are
 * entries without a valid non-negative startTime. Never throws.
 */
export function parseChapters(input: unknown): PodcastChapter[] {
  try {
    let parsed: unknown = input;
    if (typeof input === "string") {
      if (!input.trim()) return [];
      try {
        parsed = JSON.parse(input);
      } catch {
        return [];
      }
    }
    if (!parsed || typeof parsed !== "object") return [];
    const rawChapters = Array.isArray(parsed) ? parsed : (parsed as any).chapters;
    if (!Array.isArray(rawChapters)) return [];
    const chapters: PodcastChapter[] = [];
    for (const raw of rawChapters) {
      if (!raw || typeof raw !== "object") continue;
      const ch = raw as Record<string, unknown>;
      if (ch.toc === false) continue;
      const startTime = toFiniteNumber(ch.startTime) ?? toFiniteNumber(ch.start);
      if (startTime == null || startTime < 0) continue;
      const chapter: PodcastChapter = {
        startTime,
        title: typeof ch.title === "string" ? squashWhitespace(ch.title) : "",
      };
      if (typeof ch.img === "string" && ch.img) chapter.img = ch.img;
      if (typeof ch.url === "string" && ch.url) chapter.url = ch.url;
      chapters.push(chapter);
    }
    chapters.sort((a, b) => a.startTime - b.startTime);
    return chapters;
  } catch {
    return [];
  }
}

/** Index of the chapter containing `time`, or -1 before the first chapter. */
export function findChapterIndex(chapters: PodcastChapter[], time: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].startTime <= time) idx = i;
    else break;
  }
  return idx;
}

/** `h:mm:ss` / `m:ss` display timestamp for transcript rows and chapter lists. */
export function formatTranscriptTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}
