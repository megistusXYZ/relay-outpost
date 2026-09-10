/**
 * What the Listen card shows and plays, read from an AzuraCast station's own
 * now-playing API (`<origin>/api/nowplaying/<station>`), fetched server-side
 * so rendering a post never connects the viewer to the station's host.
 *
 * The fixture is the real response shape from Bowl After Bowl's station,
 * captured 2026-09-10 (trimmed to the fields read).
 */
import { describe, expect, it } from "vitest";
import { discoverRadioStation, fetchStationInfo, parseNowPlaying, stationLinksInHtml, type TextFetch } from "./radio-station";

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

/**
 * Most Bowl After Bowl posts link their site's /live/ page, not the station
 * itself. The page carries the station in its BODY (captured 2026-09-10,
 * ~11.6KB in, well past </head>): an "Open Stream" link to the AzuraCast
 * public player page, next to their own player button.
 */
const LIVE_PAGE_BODY = `
  <button id="live-now-playing-listen-btn" type="button" class="btn-form live-listen-btn"
    data-bab-play data-bab-live="true"
    data-audio-src="https://stream.bowlafterbowl.com:8000/stream.mp3"
    aria-label="Listen to current stream">Listen Now</button>
  <a class="btn-form live-chat-btn" href="https://stream.bowlafterbowl.com/public/bowlafterbowl" target="_blank" rel="noopener">Open Stream</a>
`;

describe("stationLinksInHtml", () => {
  it("finds the station a page links to, as its clean public player page", () => {
    expect(stationLinksInHtml(LIVE_PAGE_BODY)).toEqual(["https://stream.bowlafterbowl.com/public/bowlafterbowl"]);
  });
});

describe("discoverRadioStation", () => {
  const allowAll = async () => true;

  it("calls a page a station only once the station's own API confirms it", async () => {
    const asked: string[] = [];
    const fetchText: TextFetch = async (url) => {
      asked.push(url);
      return { status: 200, text: JSON.stringify(BOWL_AFTER_BOWL) };
    };
    expect(await discoverRadioStation(LIVE_PAGE_BODY, fetchText, allowAll)).toBe("https://stream.bowlafterbowl.com/public/bowlafterbowl");
    expect(asked).toEqual(["https://stream.bowlafterbowl.com/api/nowplaying/bowlafterbowl"]);
  });

  it("ignores a /public/ link whose host does not answer as a radio station", async () => {
    const page = `<a href="https://example.com/public/images">Press kit</a>`;
    const fetchText: TextFetch = async () => ({ status: 404, text: "<html>Not found</html>" });
    expect(await discoverRadioStation(page, fetchText, allowAll)).toBeNull();
  });

  it("asks nothing of a page that links no station", async () => {
    let calls = 0;
    const fetchText: TextFetch = async () => { calls++; return { status: 200, text: "{}" }; };
    expect(await discoverRadioStation("<p>Just an article.</p>", fetchText, allowAll)).toBeNull();
    expect(calls).toBe(0);
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
