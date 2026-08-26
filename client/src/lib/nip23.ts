import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { clientTags } from "./nostr-helpers";

export const KIND_LONG_FORM = 30023;
export const KIND_DRAFT_LONG_FORM = 30024;

export const HORIZON_SECTION_NAMESPACE = "codex-section";

export const DEFAULT_HORIZON_SECTIONS = ["Updates", "Guides", "Resources", "Links"];

function extractFirstImage(content: string): string {
  const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp|avif|svg)(?:\?[^\s)]*)?)\)/i);
  if (mdMatch) return mdMatch[1];
  const urlMatch = content.match(/^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|avif|svg)(?:\?[^\s]*)?)$/im);
  return urlMatch?.[1] || "";
}

export type HorizonContentType = "article" | "video" | "audio" | "file" | "link";

const VIDEO_URL_RE = /https?:\/\/[^\s<>"]+\.(mp4|webm|mov|m4v|ogv|m3u8)(\?[^\s]*)?/i;
const YOUTUBE_RE = /https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;
const RUMBLE_RE = /https?:\/\/(www\.)?rumble\.com\//i;
const VIMEO_RE = /https?:\/\/(www\.)?vimeo\.com\//i;
const AUDIO_URL_RE = /https?:\/\/[^\s<>"]+\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?[^\s]*)?/i;
const FILE_DOWNLOAD_RE = /(?:📎\s*)?\[.+?\]\(https?:\/\/[^\s)]+\.(?:pdf|zip|tar|gz|rar|7z|doc|docx|xls|xlsx|ppt|pptx|csv|txt|rtf|epub|apk|dmg|iso|bin|exe|deb|rpm)\)/i;

export function detectContentType(content: string): HorizonContentType {
  if (VIDEO_URL_RE.test(content) || YOUTUBE_RE.test(content) || RUMBLE_RE.test(content) || VIMEO_RE.test(content)) return "video";
  if (AUDIO_URL_RE.test(content)) return "audio";
  if (FILE_DOWNLOAD_RE.test(content)) return "file";
  const urlCount = (content.match(/https?:\/\/[^\s<>"]+/g) || []).length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (urlCount > 0 && wordCount < 80 && urlCount >= wordCount / 10) return "link";
  return "article";
}

export interface ArticleData {
  event: Event;
  title: string;
  summary: string;
  image: string;
  publishedAt: number;
  dTag: string;
  hashtags: string[];
  naddr: string;
  section: string;
  contentType: HorizonContentType;
  commentsDisabled: boolean;
}

export function parseArticle(event: Event): ArticleData {
  const getTag = (name: string): string => {
    const tag = event.tags.find((t) => t[0] === name);
    return tag?.[1] || "";
  };

  const title = getTag("title");
  const summary = getTag("summary");
  const image = getTag("image") || getTag("thumb") || getTag("banner") || getTag("picture") || extractFirstImage(event.content);
  const dTag = getTag("d");
  const publishedAtStr = getTag("published_at");
  const rawPublishedAt = publishedAtStr ? parseInt(publishedAtStr, 10) : event.created_at;
  const publishedAt = !Number.isFinite(rawPublishedAt) || rawPublishedAt > event.created_at
    ? event.created_at
    : rawPublishedAt;

  const hashtags = Array.from(new Set(
    event.tags
      .filter((t) => t[0] === "t" && t[1])
      .map((t) => t[1].toLowerCase())
  ));

  const sectionTag = event.tags.find(
    (t) => t[0] === "l" && t[2] === HORIZON_SECTION_NAMESPACE
  );
  const section = sectionTag?.[1] || "";

  const contentType = detectContentType(event.content);

  const commentsTag = event.tags.find((t) => t[0] === "comments");
  const commentsDisabled = commentsTag?.[1] === "off";

  let naddr = "";
  try {
    naddr = nip19.naddrEncode({
      identifier: dTag,
      pubkey: event.pubkey,
      kind: KIND_LONG_FORM,
      relays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
    });
  } catch {
    naddr = `${event.pubkey}:${dTag}`;
  }

  return { event, title, summary, image, publishedAt, dTag, hashtags, naddr, section, contentType, commentsDisabled };
}

export function decodeNaddr(naddrStr: string): {
  identifier: string;
  pubkey: string;
  kind: number;
  relays: string[];
} | null {
  try {
    const decoded = nip19.decode(naddrStr);
    if (decoded.type === "naddr") {
      return decoded.data as {
        identifier: string;
        pubkey: string;
        kind: number;
        relays: string[];
      };
    }
  } catch {}
  return null;
}

export function generateDTag(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 8);
  return slug ? `${slug}-${suffix}` : `article-${Date.now()}-${suffix}`;
}

export function buildArticleEvent(params: {
  title: string;
  summary: string;
  content: string;
  image: string;
  hashtags: string[];
  dTag?: string;
  section?: string;
  commentsDisabled?: boolean;
}): { kind: number; created_at: number; tags: string[][]; content: string } {
  const now = Math.floor(Date.now() / 1000);
  const d = params.dTag || generateDTag(params.title);

  const tags: string[][] = [
    ["d", d],
    ["title", params.title],
    ["published_at", String(now)],
  ];

  if (params.summary) tags.push(["summary", params.summary]);
  if (params.image) tags.push(["image", params.image]);

  for (const t of params.hashtags) {
    if (t.trim()) tags.push(["t", t.trim().toLowerCase()]);
  }

  if (params.section && params.section.trim()) {
    tags.push(["L", HORIZON_SECTION_NAMESPACE]);
    tags.push(["l", params.section.trim(), HORIZON_SECTION_NAMESPACE]);
  }

  if (params.commentsDisabled) {
    tags.push(["comments", "off"]);
  }

  tags.push(...clientTags());

  return {
    kind: KIND_LONG_FORM,
    created_at: now,
    tags,
    content: params.content,
  };
}

export function estimateReadingTime(content: string): number {
  const words = content.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
