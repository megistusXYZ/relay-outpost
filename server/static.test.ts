/**
 * Serving the built app. One rule matters enough to pin: a build file that is
 * not there answers 404 — never the app's page with status 200.
 *
 * A deploy that changes the app renames nearly every file under /assets. A page still running
 * the previous build asks for the old names; answered with index.html, the
 * browser refuses the "script" and the service worker keeps the page under
 * the script's name (reported 2026-10-01 as a Feed page that stayed blank
 * until "Repair app").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { serveStatic } from "./static";

let server: Server;
let base = "";
let dir = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ro-static-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>the app</html>");
  fs.writeFileSync(path.join(dir, "sw.js"), "// worker");
  fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
  fs.writeFileSync(path.join(dir, "assets", "Home-abc123.js"), "export default 1;");
  const app = express();
  serveStatic(app, dir);
  await new Promise<void>((ok) => { server = app.listen(0, "127.0.0.1", ok); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("serveStatic", () => {
  it("a build file that exists is served as what it is, cacheable for good", async () => {
    const res = await fetch(`${base}/assets/Home-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
  });

  it("a build file that is gone answers 404, not the app's page", async () => {
    for (const p of ["/assets/Home-oldbuild.js", "/assets/index-oldbuild.css", "/assets/nested/x.js"]) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get("content-type"), p).not.toMatch(/html/);
      expect(res.headers.get("cache-control"), p).toBe("no-store");
      expect(await res.text(), p).not.toContain("the app");
    }
  });

  it("every app route still gets the page, never cached", async () => {
    for (const p of ["/", "/discover", "/profile/npub1abc", "/messages/xyz"]) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(200);
      expect(await res.text(), p).toContain("the app");
      expect(res.headers.get("cache-control"), p).toMatch(/no-store/);
    }
  });
});
