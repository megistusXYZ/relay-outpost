import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { pipeUpstream } from "./stream-proxy";

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
