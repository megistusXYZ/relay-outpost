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
