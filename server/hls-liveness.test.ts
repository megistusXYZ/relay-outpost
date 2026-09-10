/**
 * server/hls-liveness.ts — is this HLS URL a stream that is live RIGHT NOW?
 *
 * Reported 2026-09-10 from a phone: a plain video clip in a feed post carried
 * the LIVE and "Live Streams" chips. The chips are gated on the server health
 * probe (hooks/use-stream-liveness → /api/stream/health-check-batch), and the
 * probe only sent a HEAD and called any 2xx/3xx "alive" — so every finished
 * video served as HLS (.m3u8) read as live. A finished playlist says so
 * itself: #EXT-X-ENDLIST, or #EXT-X-PLAYLIST-TYPE:VOD. A master playlist says
 * nothing about liveness until one of its variants is read.
 */
import { describe, expect, it } from "vitest";
import { classifyPlaylist, firstVariantUrl, probeHlsLiveness, type PlaylistFetch } from "./hls-liveness";

const LIVE_MEDIA = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:4",
  "#EXT-X-MEDIA-SEQUENCE:1841",
  "#EXTINF:4.000,",
  "seg1841.ts",
  "#EXTINF:4.000,",
  "seg1842.ts",
].join("\n");

const VOD_CLIP = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:6",
  "#EXT-X-PLAYLIST-TYPE:VOD",
  "#EXTINF:6.0,",
  "0.ts",
  "#EXTINF:4.2,",
  "1.ts",
  "#EXT-X-ENDLIST",
].join("\n");

const MASTER = [
  "#EXTM3U",
  "#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720",
  "720p/index.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
  "360p/index.m3u8",
].join("\n");

describe("classifyPlaylist", () => {
  it("a media playlist still being appended to is live", () => {
    expect(classifyPlaylist(LIVE_MEDIA)).toBe("live");
  });

  it("an ended playlist is not live — ENDLIST or a VOD type", () => {
    expect(classifyPlaylist(VOD_CLIP)).toBe("vod");
    expect(classifyPlaylist(LIVE_MEDIA + "\n#EXT-X-ENDLIST")).toBe("vod");
    expect(classifyPlaylist(LIVE_MEDIA.replace("#EXT-X-VERSION:3", "#EXT-X-PLAYLIST-TYPE:VOD"))).toBe("vod");
  });

  it("an EVENT playlist is live until it ends", () => {
    const event = LIVE_MEDIA.replace("#EXT-X-VERSION:3", "#EXT-X-PLAYLIST-TYPE:EVENT");
    expect(classifyPlaylist(event)).toBe("live");
    expect(classifyPlaylist(event + "\n#EXT-X-ENDLIST\n")).toBe("vod");
  });

  it("a master playlist has to be followed to a variant", () => {
    expect(classifyPlaylist(MASTER)).toBe("master");
  });

  it("anything that isn't a playlist is not HLS", () => {
    expect(classifyPlaylist("<html><body>Not found</body></html>")).toBe("not-hls");
    expect(classifyPlaylist("")).toBe("not-hls");
  });

  it("tolerates a byte-order mark and CRLF line endings", () => {
    expect(classifyPlaylist("﻿" + VOD_CLIP.replace(/\n/g, "\r\n"))).toBe("vod");
  });
});

describe("firstVariantUrl", () => {
  it("resolves the first variant against the master's URL", () => {
    expect(firstVariantUrl(MASTER, "https://cdn.example.com/live/abc/master.m3u8")).toBe(
      "https://cdn.example.com/live/abc/720p/index.m3u8",
    );
  });

  it("keeps an absolute variant URL and returns null when there is none", () => {
    expect(firstVariantUrl("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://other.example.com/v.m3u8", "https://a.example.com/m.m3u8"))
      .toBe("https://other.example.com/v.m3u8");
    expect(firstVariantUrl("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n", "https://a.example.com/m.m3u8")).toBeNull();
  });
});

type Answer = { status: number; text?: string; location?: string };

function fakeFetch(answers: Record<string, Answer | Error>): PlaylistFetch & { calls: string[] } {
  const calls: string[] = [];
  const fetchPlaylist = async (url: string) => {
    calls.push(url);
    const a = answers[url];
    if (!a) throw new Error("unexpected url " + url);
    if (a instanceof Error) throw a;
    return { status: a.status, text: a.text ?? "", location: a.location };
  };
  return Object.assign(fetchPlaylist, { calls });
}

const allowAll = async () => true;

describe("probeHlsLiveness", () => {
  it("a finished clip is NOT live (the reported case)", async () => {
    const f = fakeFetch({ "https://v.example.com/clip.m3u8": { status: 200, text: VOD_CLIP } });
    expect(await probeHlsLiveness("https://v.example.com/clip.m3u8", f, allowAll)).toBe(false);
  });

  it("a live media playlist is live", async () => {
    const f = fakeFetch({ "https://v.example.com/live.m3u8": { status: 200, text: LIVE_MEDIA } });
    expect(await probeHlsLiveness("https://v.example.com/live.m3u8", f, allowAll)).toBe(true);
  });

  it("a master playlist is decided by its first variant", async () => {
    const live = fakeFetch({
      "https://cdn.example.com/s/master.m3u8": { status: 200, text: MASTER },
      "https://cdn.example.com/s/720p/index.m3u8": { status: 200, text: LIVE_MEDIA },
    });
    expect(await probeHlsLiveness("https://cdn.example.com/s/master.m3u8", live, allowAll)).toBe(true);

    const ended = fakeFetch({
      "https://cdn.example.com/s/master.m3u8": { status: 200, text: MASTER },
      "https://cdn.example.com/s/720p/index.m3u8": { status: 200, text: VOD_CLIP },
    });
    expect(await probeHlsLiveness("https://cdn.example.com/s/master.m3u8", ended, allowAll)).toBe(false);
  });

  it("follows a redirect, re-checking the next host", async () => {
    const f = fakeFetch({
      "https://short.example.com/s": { status: 302, location: "https://cdn.example.com/live.m3u8" },
      "https://cdn.example.com/live.m3u8": { status: 200, text: LIVE_MEDIA },
    });
    expect(await probeHlsLiveness("https://short.example.com/s", f, allowAll)).toBe(true);

    const refused = fakeFetch({ "https://short.example.com/s": { status: 302, location: "https://internal.example/live.m3u8" } });
    const onlyPublic = async (host: string) => host !== "internal.example";
    expect(await probeHlsLiveness("https://short.example.com/s", refused, onlyPublic)).toBeNull();
    expect(refused.calls).toEqual(["https://short.example.com/s"]);
  });

  it("an error answer, a non-playlist body or an unreachable host is not live", async () => {
    expect(await probeHlsLiveness("https://a.example.com/x.m3u8", fakeFetch({ "https://a.example.com/x.m3u8": { status: 404 } }), allowAll)).toBe(false);
    expect(await probeHlsLiveness("https://a.example.com/x.m3u8", fakeFetch({ "https://a.example.com/x.m3u8": { status: 200, text: "<html></html>" } }), allowAll)).toBe(false);
    expect(await probeHlsLiveness("https://a.example.com/x.m3u8", fakeFetch({ "https://a.example.com/x.m3u8": new Error("ECONNREFUSED") }), allowAll)).toBe(false);
  });

  it("a playlist too long to be a live window is not live (its ENDLIST may be cut off)", async () => {
    const f = fakeFetch({ "https://a.example.com/long.m3u8": { status: 200, text: LIVE_MEDIA } });
    const truncated: PlaylistFetch = async (url) => ({ ...(await f(url)), truncated: true });
    expect(await probeHlsLiveness("https://a.example.com/long.m3u8", truncated, allowAll)).toBe(false);
  });

  it("gives up after a few redirects instead of looping", async () => {
    const loop = fakeFetch({
      "https://a.example.com/1": { status: 302, location: "https://a.example.com/2" },
      "https://a.example.com/2": { status: 302, location: "https://a.example.com/1" },
    });
    expect(await probeHlsLiveness("https://a.example.com/1", loop, allowAll)).toBe(false);
    expect(loop.calls.length).toBeLessThanOrEqual(4);
  });
});
