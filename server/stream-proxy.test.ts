import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { pipeUpstream, isPlaylistAnswer, looksLikePlaylist } from "./stream-proxy";

/** A stand-in for an Express response: records what was written, how it ended. */
function fakeRes() {
  const chunks: Buffer[] = [];
  const res = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } }) as Writable & { headersSent: boolean; statusCode: number; status: (n: number) => { end: () => void } };
  res.headersSent = false;
  res.statusCode = 200;
  res.status = (n: number) => { res.statusCode = n; return { end: () => res.end() } };
  return { res, chunks };
}

describe("piping an upstream body to a browser", () => {
  it("passes the bytes through", async () => {
    const up = new PassThrough();
    const { res, chunks } = fakeRes();
    pipeUpstream(up, res as never, 1024);
    up.end(Buffer.from("hello"));
    await new Promise((r) => res.on("finish", r));
    expect(Buffer.concat(chunks).toString()).toBe("hello");
  });

  it("an upstream that drops mid-stream ends this response — it never takes the server down", async () => {
    const up = new PassThrough();
    const { res } = fakeRes();
    pipeUpstream(up, res as never, 1024);
    up.write(Buffer.from("partial"));
    res.headersSent = true;
    // Without a handler this 'error' is unhandled and the process exits ("TypeError: terminated").
    up.destroy(new TypeError("terminated"));
    await new Promise((r) => setTimeout(r, 20));
    expect(res.destroyed).toBe(true);
  });

  it("before anything was sent, the browser gets a 502", async () => {
    const up = new PassThrough();
    const { res } = fakeRes();
    pipeUpstream(up, res as never, 1024);
    up.destroy(new Error("connection reset"));
    await new Promise((r) => setTimeout(r, 20));
    expect(res.statusCode).toBe(502);
  });

  it("too large: stops reading and ends the response", async () => {
    const up = new PassThrough();
    const { res } = fakeRes();
    let tooLarge = false;
    pipeUpstream(up, res as never, 4, () => { tooLarge = true; });
    up.write(Buffer.from("12345678"));
    await new Promise((r) => setTimeout(r, 20));
    expect(tooLarge).toBe(true);
    expect(up.destroyed).toBe(true);
  });
});

/**
 * The stream proxy rewrites and returns a playlist as text, readable by any
 * site (CORS *). It decided "playlist" by `.m3u8` anywhere in the address, so
 * `https://any.site/page?x=.m3u8` returned any public page through this
 * server. A playlist is now one whose path or declared type says so, and
 * whose body starts like one.
 */
describe("which upstream answers are playlists", () => {
  it("by the path, or by a playlist content type", () => {
    expect(isPlaylistAnswer("https://cdn.example/live/index.m3u8", null)).toBe(true);
    expect(isPlaylistAnswer("https://cdn.example/live/INDEX.M3U8?token=1", "")).toBe(true);
    expect(isPlaylistAnswer("https://cdn.example/live/master", "application/vnd.apple.mpegurl")).toBe(true);
    expect(isPlaylistAnswer("https://cdn.example/live/master", "audio/x-mpegURL; charset=utf-8")).toBe(true);
  });

  it("the old rule took a page with `.m3u8` in its query for a playlist (or the next check proves nothing)", () => {
    const oldRule = (u: string, ct: string | null) => u.includes(".m3u8") || (ct || "").includes("mpegurl");
    expect(oldRule("https://any.site/page?x=.m3u8", "text/html")).toBe(true);
  });

  it("never by `.m3u8` in the query string or fragment", () => {
    expect(isPlaylistAnswer("https://any.site/page?x=.m3u8", "text/html")).toBe(false);
    expect(isPlaylistAnswer("https://any.site/page?u=https://cdn.example/a.m3u8", null)).toBe(false);
    expect(isPlaylistAnswer("https://any.site/page#.m3u8", "text/html; charset=utf-8")).toBe(false);
  });

  it("a body is a playlist only if it starts like one", () => {
    expect(looksLikePlaylist("#EXTM3U\n#EXT-X-VERSION:3\nseg0.ts\n")).toBe(true);
    expect(looksLikePlaylist("﻿#EXTM3U\r\nseg0.ts")).toBe(true);
    expect(looksLikePlaylist("  \n#EXTM3U\nseg0.ts")).toBe(true);
    expect(looksLikePlaylist("<!doctype html><html><body>secret</body></html>")).toBe(false);
    expect(looksLikePlaylist('{"token":"abc"}')).toBe(false);
    expect(looksLikePlaylist("")).toBe(false);
  });
});
