/**
 * Internet radio stations (AzuraCast): what the feed's Listen card shows and
 * plays, read server-side from the station's own now-playing API
 * (`<origin>/api/nowplaying/<station>`) so rendering a post never connects the
 * viewer to the station's host. The listener's player only reaches the stream
 * once they press Listen. Client side: client/src/lib/radio-station.ts.
 */
import { radioStationFromUrl, type RadioStationInfo } from "@shared/radio-station";

export type { RadioStationInfo };

export interface TextResponse {
  status: number;
  text: string;
  location?: string;
}

/** GET without following redirects (the caller re-checks every hop). */
export type TextFetch = (url: string) => Promise<TextResponse>;

const MAX_REDIRECTS = 3;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The app is served over https: a plain-http stream is blocked as mixed content. */
function httpsUrl(v: unknown): string | null {
  try {
    const url = new URL(text(v));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseNowPlaying(json: unknown): RadioStationInfo | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, any>;
  const station = data.station ?? {};
  const song = data.now_playing?.song ?? {};
  return {
    name: text(station.name),
    description: text(station.description),
    listenUrl: httpsUrl(station.listen_url),
    art: text(song.art) || null,
    nowPlaying: text(song.text) || null,
    isLive: data.live?.is_live === true,
    streamer: text(data.live?.streamer_name) || null,
    isOnline: data.is_online === true,
  };
}

/**
 * The AzuraCast stations a page links to, as clean public player page URLs,
 * distinct, at most `limit`. A candidate only: `/public/<name>` also occurs on
 * sites that are not radio stations, so callers confirm it against the
 * station's own API (fetchStationInfo) before calling the page a station.
 */
export function stationLinksInHtml(html: string, limit = 2): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>\/]+\/public\/[A-Za-z0-9_-]+/g)) {
    const ref = radioStationFromUrl(match[0]);
    if (ref && !found.includes(ref.pageUrl)) found.push(ref.pageUrl);
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * The station a linked page carries, confirmed: a candidate from
 * stationLinksInHtml counts only once the station's own API answers with a
 * stream to play. Returns the station's public player page URL, or null.
 */
export async function discoverRadioStation(
  html: string,
  fetchText: TextFetch,
  isAllowedHost: (hostname: string) => Promise<boolean>,
): Promise<string | null> {
  for (const pageUrl of stationLinksInHtml(html)) {
    const info = await fetchStationInfo(pageUrl, fetchText, isAllowedHost);
    if (info?.listenUrl) return pageUrl;
  }
  return null;
}

/**
 * Read a station's now-playing data from its public player page link. Only
 * links that pass the shared station rule are fetched, and every hop —
 * the first included — must pass `isAllowedHost` (the SSRF gate).
 */
export async function fetchStationInfo(
  pageUrl: string,
  fetchText: TextFetch,
  isAllowedHost: (hostname: string) => Promise<boolean>,
): Promise<RadioStationInfo | null> {
  const ref = radioStationFromUrl(pageUrl);
  if (!ref) return null;
  let url = `${ref.origin}/api/nowplaying/${ref.shortcode}`;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!(await isAllowedHost(parsed.hostname))) return null;
    let res: TextResponse;
    try {
      res = await fetchText(url);
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
    try {
      return parseNowPlaying(JSON.parse(res.text));
    } catch {
      return null;
    }
  }
  return null;
}
