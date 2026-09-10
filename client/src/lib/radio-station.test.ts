/**
 * Internet radio stations in posts: a link to a station's public player page
 * upgrades to a Listen card that plays in the app's own audio player.
 *
 * Asked 2026-09-10 about a Bowl After Bowl post ("could we join from the post
 * like we do Corny Chat?"). The show streams through AzuraCast, and its post
 * links the station's public player page:
 * https://stream.bowlafterbowl.com/public/bowlafterbowl. `/public/<station>`
 * is AzuraCast's own path for that page, on any host that runs it, so the
 * station is recognised from the link alone, before any network, the same way
 * lib/audio-space.ts recognises a Corny Chat room.
 */
import { describe, expect, it } from "vitest";
import { pageStationToShow, radioStationFromUrl, radioTrack } from "./radio-station";

describe("radioStationFromUrl", () => {
  it("reads an AzuraCast public player link as a station: host, station name and clean page link", () => {
    expect(radioStationFromUrl("https://stream.bowlafterbowl.com/public/bowlafterbowl")).toEqual({
      origin: "https://stream.bowlafterbowl.com",
      shortcode: "bowlafterbowl",
      pageUrl: "https://stream.bowlafterbowl.com/public/bowlafterbowl",
    });
  });

  it("only upgrades web links: another scheme on the same path is not a station", () => {
    expect(radioStationFromUrl("ftp://stream.bowlafterbowl.com/public/bowlafterbowl")).toBeNull();
    expect(radioStationFromUrl("javascript:alert(1)//public/x")).toBeNull();
  });
});

/**
 * One Listen card per station per post. 13 of Bowl After Bowl's recent posts
 * link BOTH their /live/ page and the stream's root address, and each of those
 * pages leads to the same station: the first link, in post order, owns the
 * card and the rest stay plain link cards.
 */
describe("pageStationToShow — one Listen card per station per post", () => {
  const STATION = "https://stream.bowlafterbowl.com/public/bowlafterbowl";

  it("lets the first link that leads to a station show it, and keeps a later link to the same station plain", () => {
    expect(pageStationToShow({ radioStation: STATION, linkedStations: new Set(), earlier: [] })).toBe(STATION);
    expect(pageStationToShow({ radioStation: STATION, linkedStations: new Set(), earlier: [{ settled: true, radioStation: STATION }] })).toBeNull();
  });

  it("stays a plain link when the post links the station directly, which already shows its card", () => {
    expect(pageStationToShow({ radioStation: STATION, linkedStations: new Set([STATION]), earlier: [] })).toBeNull();
  });

  it("waits for earlier links to load, so a card never shows and then turns plain", () => {
    expect(pageStationToShow({ radioStation: STATION, linkedStations: new Set(), earlier: [{ settled: false }] })).toBeNull();
    expect(pageStationToShow({ radioStation: STATION, linkedStations: new Set(), earlier: [{ settled: true, radioStation: null }] })).toBe(STATION);
  });
});

describe("radioTrack — what Listen hands the app's audio player", () => {
  const station = radioStationFromUrl("https://stream.bowlafterbowl.com/public/bowlafterbowl")!;
  const info = {
    name: "bowlafterbowl",
    description: "Bowl After Bowl live stream.",
    listenUrl: "https://stream.bowlafterbowl.com:8000/stream.mp3",
    art: "https://stream.bowlafterbowl.com/static/uploads/bowlafterbowl/album_art.1695683135.jpg",
    nowPlaying: 'Homegrown Hits: "Homegrown Hits - Episode 149"',
    isLive: false,
    streamer: null,
    isOnline: true,
  };

  it("plays the station's stream as a live track, the same track every time for the same station", () => {
    const track = radioTrack(station, info);
    expect(track).toMatchObject({
      audioUrl: "https://stream.bowlafterbowl.com:8000/stream.mp3",
      live: true,
      source: "radio",
      title: "bowlafterbowl",
      artist: 'Homegrown Hits: "Homegrown Hits - Episode 149"',
      coverUrl: info.art,
    });
    expect(radioTrack(station, { ...info, nowPlaying: "Something else" })?.id).toBe(track?.id);
  });
});
