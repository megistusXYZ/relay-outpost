/**
 * What the Listen card shows and plays, read from an AzuraCast station's own
 * now-playing API (`<origin>/api/nowplaying/<station>`), fetched server-side
 * so rendering a post never connects the viewer to the station's host.
 *
 * The fixture is the real response shape from Bowl After Bowl's station,
 * captured 2026-09-10 (trimmed to the fields read).
 */
import { describe, expect, it } from "vitest";
import { fetchStationInfo, parseNowPlaying, type TextFetch } from "./radio-station";

const BOWL_AFTER_BOWL = {
  station: {
    id: 1,
    name: "bowlafterbowl",
    shortcode: "bowlafterbowl",
    description: "Bowl After Bowl live stream featuring live shows every Tuesday at 9 PM Central US.",
    listen_url: "https://stream.bowlafterbowl.com:8000/stream.mp3",
    url: "https://bowlafterbowl.com",
    public_player_url: "https://stream.bowlafterbowl.com/public/bowlafterbowl",
    is_public: true,
    hls_url: null,
  },
  live: { is_live: false, streamer_name: "" },
  now_playing: {
    song: {
      text: 'Homegrown Hits: "Homegrown Hits - Episode 149"',
      art: "https://stream.bowlafterbowl.com/static/uploads/bowlafterbowl/album_art.1695683135.jpg",
    },
  },
  is_online: true,
};

describe("parseNowPlaying", () => {
  it("reads the station's name, stream, artwork and what is on air now", () => {
    expect(parseNowPlaying(BOWL_AFTER_BOWL)).toEqual({
      name: "bowlafterbowl",
      description: "Bowl After Bowl live stream featuring live shows every Tuesday at 9 PM Central US.",
      listenUrl: "https://stream.bowlafterbowl.com:8000/stream.mp3",
      art: "https://stream.bowlafterbowl.com/static/uploads/bowlafterbowl/album_art.1695683135.jpg",
      nowPlaying: 'Homegrown Hits: "Homegrown Hits - Episode 149"',
      isLive: false,
      streamer: null,
      isOnline: true,
    });
  });

  it("offers nothing to play when the stream is not https: the app is https and would block it", () => {
    const plain = { ...BOWL_AFTER_BOWL, station: { ...BOWL_AFTER_BOWL.station, listen_url: "http://stream.bowlafterbowl.com:8000/stream.mp3" } };
    expect(parseNowPlaying(plain)?.listenUrl).toBeNull();
    const garbage = { ...BOWL_AFTER_BOWL, station: { ...BOWL_AFTER_BOWL.station, listen_url: "javascript:alert(1)" } };
    expect(parseNowPlaying(garbage)?.listenUrl).toBeNull();
  });
});

describe("fetchStationInfo", () => {
  const PAGE = "https://stream.bowlafterbowl.com/public/bowlafterbowl";
  const allowAll = async () => true;

  it("asks the station's own now-playing API and reads it", async () => {
    const asked: string[] = [];
    const fetchText: TextFetch = async (url) => {
      asked.push(url);
      return { status: 200, text: JSON.stringify(BOWL_AFTER_BOWL) };
    };
    const info = await fetchStationInfo(PAGE, fetchText, allowAll);
    expect(asked).toEqual(["https://stream.bowlafterbowl.com/api/nowplaying/bowlafterbowl"]);
    expect(info?.listenUrl).toBe("https://stream.bowlafterbowl.com:8000/stream.mp3");
  });

  it("fetches nothing for a link that is not a station page", async () => {
    let calls = 0;
    const fetchText: TextFetch = async () => { calls++; return { status: 200, text: "{}" }; };
    expect(await fetchStationInfo("https://bowlafterbowl.com/live/", fetchText, allowAll)).toBeNull();
    expect(calls).toBe(0);
  });

  it("will not follow a redirect to a host that fails the safety check", async () => {
    const asked: string[] = [];
    const fetchText: TextFetch = async (url) => {
      asked.push(url);
      return { status: 302, text: "", location: "http://10.0.0.5/api/nowplaying/bowlafterbowl" };
    };
    const isAllowedHost = async (host: string) => host === "stream.bowlafterbowl.com";
    expect(await fetchStationInfo(PAGE, fetchText, isAllowedHost)).toBeNull();
    expect(asked).toEqual(["https://stream.bowlafterbowl.com/api/nowplaying/bowlafterbowl"]);
  });

  it("does not ask at all when the station's own host fails the safety check", async () => {
    let calls = 0;
    const fetchText: TextFetch = async () => { calls++; return { status: 200, text: "{}" }; };
    expect(await fetchStationInfo(PAGE, fetchText, async () => false)).toBeNull();
    expect(calls).toBe(0);
  });
});
