/**
 * safeFetch is the one way the server fetches a URL someone else chose.
 * These tests run it against a real local server, with name resolution
 * stubbed: "public.test" resolves to the local server, "private.test" is
 * refused. Neither name exists in real DNS, so a fetch that reaches the server
 * proves the connection was pinned to the vetted address.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

vi.mock("./net-safety", () => ({
  resolveVettedAddresses: async (host: string) => (host === "public.test" ? ["127.0.0.1"] : null),
}));

import { safeFetch, readBodyCapped, readJsonCapped, SafeFetchBlocked } from "./safe-fetch";

const BOMB_EXPANDED = 32 * 1024 * 1024;
const BOMB = gzipSync(Buffer.alloc(BOMB_EXPANDED, 0x20), { level: 9 });

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end("ok");
    }
    if (req.url === "/to-ok") {
      res.writeHead(302, { location: "/ok" });
      return res.end();
    }
    if (req.url === "/to-private") {
      res.writeHead(302, { location: `http://private.test:${port}/ok` });
      return res.end();
    }
    if (req.url === "/referer") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(String(req.headers.referer ?? ""));
    }
    if (req.url === "/big") {
      // No content-length: the cap has to be enforced while reading.
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const chunk = Buffer.alloc(16 * 1024, 1);
      let sent = 0;
      const pump = () => {
        while (sent < 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return res.once("drain", pump);
        }
        res.end();
      };
      return pump();
    }
    if (req.url === "/slow-body") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("a");
      setTimeout(() => res.end("b"), 400);
      return;
    }
    if (req.url === "/gzip-bomb") {
      // A few dozen KB on the wire that expand to 32 MB, with an honest
      // (small) content-length: only counting expanded bytes stops it.
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": String(BOMB.length) });
      return res.end(BOMB);
    }
    if (req.url === "/small-json") {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      return res.end(gzipSync(JSON.stringify({ callback: "https://pay.example/cb", minSendable: 1000 })));
    }
    if (req.url === "/declared-big") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(10 * 1024 * 1024) });
      return res.end(Buffer.alloc(10));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://public.test:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

describe("safeFetch", () => {
  it("connects to the vetted address and keeps the response headers readable", async () => {
    const res = await safeFetch(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("ok");
  });

  it("refuses a host that fails the check", async () => {
    await expect(safeFetch(base.replace("public.test", "private.test") + "/ok")).rejects.toBeInstanceOf(SafeFetchBlocked);
  });

  it("refuses anything but http(s)", async () => {
    await expect(safeFetch("file:///etc/hosts")).rejects.toBeInstanceOf(SafeFetchBlocked);
  });

  it("follows a redirect to a safe place", async () => {
    const res = await safeFetch(`${base}/to-ok`);
    expect(await res.text()).toBe("ok");
  });

  it("checks every redirect hop, not just the first", async () => {
    await expect(safeFetch(`${base}/to-private`)).rejects.toBeInstanceOf(SafeFetchBlocked);
  });

  it("with maxRedirects 0 hands back the redirect instead of following it", async () => {
    const res = await safeFetch(`${base}/to-ok`, { maxRedirects: 0 });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/ok");
  });

  it("by default the timeout covers the body too", async () => {
    const res = await safeFetch(`${base}/slow-body`, { timeoutMs: 200 });
    await expect(res.text()).rejects.toThrow();
  });

  it("with timeoutCovers 'headers' a slow body still arrives", async () => {
    const res = await safeFetch(`${base}/slow-body`, { timeoutMs: 200, timeoutCovers: "headers" });
    expect(await res.text()).toBe("ab");
  });

  it("can set headers per hop", async () => {
    const res = await safeFetch(`${base}/referer`, { headers: (u) => ({ Referer: `${u.origin}/` }) });
    expect(await res.text()).toBe(`${base}/`);
  });
});

describe("readBodyCapped", () => {
  it("returns the body when it fits", async () => {
    const buf = await readBodyCapped(await safeFetch(`${base}/ok`), 1024);
    expect(buf?.toString()).toBe("ok");
  });

  it("stops reading and returns null once the cap is passed", async () => {
    expect(await readBodyCapped(await safeFetch(`${base}/big`), 64 * 1024)).toBeNull();
  });

  it("with truncate, returns the first maxBytes instead of null", async () => {
    const buf = await readBodyCapped(await safeFetch(`${base}/big`), 64 * 1024, { truncate: true });
    expect(buf?.length).toBe(64 * 1024);
    const declared = await readBodyCapped(await safeFetch(`${base}/declared-big`), 4, { truncate: true });
    expect(declared?.length).toBe(4);
  });

  it("returns null without reading when the declared length is over the cap", async () => {
    expect(await readBodyCapped(await safeFetch(`${base}/declared-big`), 1024)).toBeNull();
  });

  // A reply that is small on the wire and huge once inflated. The declared
  // length is honest and tiny, so only counting inflated bytes stops it.
  it("the compressed reply really inflates when read whole (or the next check proves nothing)", async () => {
    expect(BOMB.length).toBeLessThan(256 * 1024);
    const whole = await (await safeFetch(`${base}/gzip-bomb`)).arrayBuffer();
    expect(whole.byteLength).toBe(BOMB_EXPANDED);
  });

  it("counts inflated bytes: a compressed reply that expands past the cap returns null", async () => {
    expect(await readBodyCapped(await safeFetch(`${base}/gzip-bomb`), 1024 * 1024)).toBeNull();
  });
});

describe("readJsonCapped", () => {
  it("parses a reply that fits", async () => {
    expect(await readJsonCapped(await safeFetch(`${base}/small-json`), 64 * 1024)).toEqual({ callback: "https://pay.example/cb", minSendable: 1000 });
  });

  it("returns null for a reply over the cap, counting inflated bytes", async () => {
    expect(await readJsonCapped(await safeFetch(`${base}/gzip-bomb`), 1024 * 1024)).toBeNull();
  });

  it("throws on a reply that isn't JSON, like response.json() does", async () => {
    await expect(readJsonCapped(await safeFetch(`${base}/ok`), 1024)).rejects.toThrow();
  });
});
