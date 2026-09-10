/**
 * Internet radio stations (AzuraCast) as first-class, listenable things.
 *
 * A link to a station's public player page upgrades from a gray link preview
 * to a Listen card that plays in the app's own audio player
 * (components/RadioStationCard.tsx). Detected from the URL alone, before any
 * network, the same way lib/audio-space.ts recognises a Corny Chat room. The
 * rule itself is shared with the server: shared/radio-station.ts.
 */
import type { RadioStationInfo, RadioStationRef } from "@shared/radio-station";
import type { MusicTrack } from "@/lib/music";

export { radioStationFromUrl, type RadioStationRef, type RadioStationInfo } from "@shared/radio-station";

/**
 * Which station, if any, a link preview shows as a Listen card. A post shows
 * one Listen card per station: a station the post links directly already has
 * its card, and among links whose pages lead to the same station the first in
 * post order owns it. A later link waits until every earlier one has loaded,
 * so a card never appears and then turns back into a plain link.
 */
export function pageStationToShow(input: {
  radioStation?: string | null;
  linkedStations?: Set<string>;
  earlier: Array<{ settled: boolean; radioStation?: string | null }>;
}): string | null {
  const station = input.radioStation;
  if (!station) return null;
  if (input.linkedStations?.has(station)) return null;
  if (input.earlier.some((link) => !link.settled)) return null;
  if (input.earlier.some((link) => link.radioStation === station)) return null;
  return station;
}

/**
 * The track Listen hands the app's audio player: the station's stream, marked
 * live (no duration, no seeking, no remembered position). Its id is the
 * station, not what is on air, so the card can tell the station is already
 * playing while the show changes. Null when there is no https stream to play.
 */
export function radioTrack(station: RadioStationRef, info: RadioStationInfo): MusicTrack | null {
  if (!info.listenUrl) return null;
  return {
    id: `radio:${station.pageUrl}`,
    title: info.name || station.shortcode,
    artist: info.nowPlaying || "Live radio",
    artistPubkey: "",
    audioUrl: info.listenUrl,
    coverUrl: info.art || "",
    description: info.description,
    genre: "Radio",
    duration: 0,
    createdAt: 0,
    source: "radio",
    live: true,
  };
}
