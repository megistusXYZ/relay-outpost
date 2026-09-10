/**
 * Recognising an internet radio station (AzuraCast) from a link.
 *
 * `https://<host>/public/<station>` is AzuraCast's own path for a station's
 * public player page, on any host that runs it. Shared so the client (which
 * upgrades the link to a Listen card, before any network) and the server
 * (which only fetches now-playing data for links that pass the same rule)
 * cannot disagree about what a station link is.
 */

export interface RadioStationRef {
  /** Scheme + host (+ port) of the AzuraCast install. */
  origin: string;
  /** AzuraCast's station short name, as it appears in the URL. */
  shortcode: string;
  /** The station's public player page, query and fragment dropped. */
  pageUrl: string;
}

/** What the Listen card shows and plays: the server's reading of a station's now-playing API. */
export interface RadioStationInfo {
  name: string;
  description: string;
  /** The stream the app's audio player plays (https only). */
  listenUrl: string | null;
  art: string | null;
  /** What is on air now, as the station labels it. */
  nowPlaying: string | null;
  /** A presenter is broadcasting live (not the station's automated playlist). */
  isLive: boolean;
  streamer: string | null;
  isOnline: boolean;
}

export function radioStationFromUrl(url: string): RadioStationRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const match = parsed.pathname.match(/^\/public\/([a-z0-9_-]+)/i);
  if (!match) return null;
  const shortcode = match[1];
  return { origin: parsed.origin, shortcode, pageUrl: `${parsed.origin}/public/${shortcode}` };
}
