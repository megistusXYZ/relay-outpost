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
