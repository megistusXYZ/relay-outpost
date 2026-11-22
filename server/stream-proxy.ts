/**
 * Pipe an upstream body (an image, a feed) to the browser — safely.
 *
 * A stream that errors with no 'error' listener is an unhandled error, and
 * Node exits. The image proxy piped without one, so an image host dropping
 * the connection mid-download ("TypeError: terminated", "other side closed")
 * took the whole server down — one replica in production, so an outage.
 * Here every failure ends just this response: a 502 if nothing was sent yet,
 * otherwise the connection is closed so the browser sees a broken image.
 */
import type { Readable } from "node:stream";
import type { Response } from "express";

export function pipeUpstream(body: Readable, res: Response, maxBytes: number, onTooLarge?: () => void): void {
  let seen = 0;
  const fail = () => {
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  };
  body.on("error", fail);
  res.on("close", () => { if (!body.destroyed) body.destroy(); });
  body.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > maxBytes) {
      body.off("error", fail);
      body.on("error", () => { /* we stopped it on purpose */ });
      body.destroy();
      if (onTooLarge) onTooLarge();
      else res.end();
    }
  });
  body.pipe(res);
}

/**
 * Whether an upstream answer is a playlist, from its address's PATH or its
 * declared type. The playlist branch returns text readable by any site, so
 * `.m3u8` in the query string or fragment never counts: that let any public
 * page be fetched through this server.
 */
export function isPlaylistAnswer(targetUrl: string, contentType: string | null | undefined): boolean {
  if ((contentType || "").toLowerCase().includes("mpegurl")) return true;
  try {
    return new URL(targetUrl).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

/** A playlist body starts with #EXTM3U (after an optional byte-order mark and blank space). */
export function looksLikePlaylist(text: string): boolean {
  return /^﻿?\s*#EXTM3U/.test(text);
}
