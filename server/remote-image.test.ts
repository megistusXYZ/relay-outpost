/**
 * fetchRemoteRaster is how the server picks up a picture someone else chose
 * (a profile photo or a post image for a share card) before decoding it. Run
 * against a real local server with name resolution stubbed, like safe-fetch.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("./net-safety", () => ({
  resolveVettedAddresses: async (host: string) => (host === "public.test" ? ["127.0.0.1"] : null),
}));

import { fetchRemoteRaster } from "./remote-image";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    if (req.url === "/a.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG); }
    // Claims to be a PNG; is an SVG.
    if (req.url === "/fake.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); }
    if (req.url === "/big.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.concat([PNG, Buffer.alloc(4096)])); }
    if (req.url === "/to-private") { res.writeHead(302, { location: `http://private.test:${port}/a.png` }); return res.end(); }
    if (req.url === "/gone") { res.writeHead(404); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://public.test:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

describe("fetchRemoteRaster", () => {
  it("returns a raster picture's bytes", async () => {
    expect((await fetchRemoteRaster(`${base}/a.png`, 1024, 3000))?.equals(PNG)).toBe(true);
  });

  it("refuses an SVG whatever its declared type", async () => {
    expect(await fetchRemoteRaster(`${base}/fake.png`, 1024, 3000)).toBeNull();
  });

  it("refuses a picture over the size cap", async () => {
    expect(await fetchRemoteRaster(`${base}/big.png`, 1024, 3000)).toBeNull();
  });

  it("refuses a redirect to a private host, a refused host, and an error answer", async () => {
    expect(await fetchRemoteRaster(`${base}/to-private`, 1024, 3000)).toBeNull();
    expect(await fetchRemoteRaster(base.replace("public.test", "private.test") + "/a.png", 1024, 3000)).toBeNull();
    expect(await fetchRemoteRaster(`${base}/gone`, 1024, 3000)).toBeNull();
  });
});
