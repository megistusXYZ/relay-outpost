/**
 * Is this HLS URL a stream that is live right now?
 *
 * The old stream health check sent a HEAD and called any 2xx/3xx "alive", so
 * every finished video served as HLS (.m3u8) read as live — the feed's LIVE
 * chip on a plain clip. A playlist states its own state: a media playlist
 * still being appended to has no #EXT-X-ENDLIST and no VOD type. A master
 * playlist says nothing until one of its variants is read.
 */

export type PlaylistKind = "live" | "vod" | "master" | "not-hls";

export interface PlaylistResponse {
  status: number;
  text: string;
  location?: string;
  /** The body was longer than the read cap — see PLAYLIST_MAX_BYTES. */
  truncated?: boolean;
}

export type PlaylistFetch = (url: string) => Promise<PlaylistResponse>;

const MAX_REDIRECTS = 3;
const PLAYLIST_TIMEOUT_MS = 6000;
/**
 * A live playlist is a short sliding window of recent segments (a few KB).
 * Anything past this is a long recording or not a playlist at all — and a
 * cut-off body can't show its #EXT-X-ENDLIST — so it never reads as live.
 */
const PLAYLIST_MAX_BYTES = 256 * 1024;

function lines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim());
}

export function classifyPlaylist(text: string): PlaylistKind {
  const all = lines(text);
  const first = all.find((l) => l !== "");
  if (first !== "#EXTM3U") return "not-hls";
  if (all.some((l) => l.startsWith("#EXT-X-STREAM-INF"))) return "master";
  if (all.some((l) => l === "#EXT-X-ENDLIST" || l === "#EXT-X-PLAYLIST-TYPE:VOD")) return "vod";
  return "live";
}

/** The first variant's URI, resolved against the master's own URL. */
export function firstVariantUrl(masterText: string, baseUrl: string): string | null {
  const all = lines(masterText);
  for (let i = 0; i < all.length; i++) {
    if (!all[i].startsWith("#EXT-X-STREAM-INF")) continue;
    for (let j = i + 1; j < all.length; j++) {
      if (all[j] === "") continue;
      if (all[j].startsWith("#")) break;
      try {
        return new URL(all[j], baseUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

type Loaded = { text: string; url: string; truncated: boolean } | "refused" | null;

async function load(start: string, fetchPlaylist: PlaylistFetch, isAllowedHost: (hostname: string) => Promise<boolean>): Promise<Loaded> {
  let url = start;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    if (!(await isAllowedHost(host))) return "refused";
    let res: PlaylistResponse;
    try {
      res = await fetchPlaylist(url);
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      try {
        url = new URL(res.location, url).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return null;
    return { text: res.text, url, truncated: !!res.truncated };
  }
  return null;
}

/**
 * true = live now; false = finished, not a playlist, or unreachable;
 * null = a host we won't contact (same answer the endpoint gives up front).
 */
export async function probeHlsLiveness(
  url: string,
  fetchPlaylist: PlaylistFetch,
  isAllowedHost: (hostname: string) => Promise<boolean>,
): Promise<boolean | null> {
  const first = await load(url, fetchPlaylist, isAllowedHost);
  if (first === "refused") return null;
  if (!first) return false;
  let kind = classifyPlaylist(first.text);
  let truncated = first.truncated;
  if (kind === "master") {
    const variant = firstVariantUrl(first.text, first.url);
    if (!variant) return false;
    const media = await load(variant, fetchPlaylist, isAllowedHost);
    if (media === "refused") return null;
    if (!media) return false;
    kind = classifyPlaylist(media.text);
    truncated = media.truncated;
  }
  return kind === "live" && !truncated;
}

/** GET a playlist without following redirects, reading at most PLAYLIST_MAX_BYTES. */
export const fetchPlaylistText: PlaylistFetch = async (url) => {
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(PLAYLIST_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NostrClient/1.0)",
      Accept: "application/vnd.apple.mpegurl, application/x-mpegurl, */*",
    },
  });
  const location = res.headers.get("location") ?? undefined;
  if (res.status < 200 || res.status >= 300 || !res.body) {
    try { await res.body?.cancel(); } catch {}
    return { status: res.status, text: "", location };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > PLAYLIST_MAX_BYTES) {
      truncated = true;
      break;
    }
  }
  try { await reader.cancel(); } catch {}
  return { status: res.status, text: Buffer.concat(chunks).toString("utf8"), location, truncated };
};
