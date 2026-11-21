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
  // The real order (index.ts): every API route first, then the built app.
  app.get("/api/version", (_req, res) => { res.json({ version: "test" }); });
  app.post("/api/echo", (_req, res) => { res.json({ ok: true }); });
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

/**
 * An API path nobody registered is a miss, said as one: 404 with a small JSON
 * body. It used to fall through to index.html with status 200, so `res.ok` was
 * true and the caller only found out when the page failed to parse as JSON:
 * "we never got to ask" read as an answer (RELAY_REACHABILITY.md). A page
 * still running an older build asks for routes a later deploy removed.
 */
describe("serveStatic: an API path that isn't registered", () => {
  const MISSING = ["/api/nope", "/api/removed/in-a-later-build", "/api/nope/deeper?x=1", "/api", "/api/"];

  it("answers 404 with JSON, never the app's page", async () => {
    for (const p of MISSING) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(404);
      expect(res.ok, p).toBe(false);
      expect(res.headers.get("content-type"), p).toMatch(/^application\/json/);
      expect(res.headers.get("cache-control"), p).toBe("no-store");
      expect(await res.json(), p).toEqual({ error: "Not found" });
    }
  });

  it("…for every method, not only GET", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${base}/api/nope`, { method });
      expect(res.status, method).toBe(404);
      expect(res.headers.get("content-type"), method).toMatch(/^application\/json/);
      expect(res.headers.get("cache-control"), method).toBe("no-store");
      expect(await res.json(), method).toEqual({ error: "Not found" });
    }
    const head = await fetch(`${base}/api/nope`, { method: "HEAD" });
    expect(head.status).toBe(404);
    expect(head.headers.get("content-type")).toMatch(/^application\/json/);
    // A registered path asked with a method it doesn't have is a miss too.
    const wrongMethod = await fetch(`${base}/api/echo`);
    expect(wrongMethod.status).toBe(404);
    expect(await wrongMethod.json()).toEqual({ error: "Not found" });
  });

  it("a registered API route still answers for itself", async () => {
    const version = await fetch(`${base}/api/version`);
    expect(version.status).toBe(200);
    expect(await version.json()).toEqual({ version: "test" });
    const echo = await fetch(`${base}/api/echo`, { method: "POST" });
    expect(echo.status).toBe(200);
    expect(await echo.json()).toEqual({ ok: true });
  });

  it("a page whose path only starts with the letters still gets the page", async () => {
    for (const p of ["/apiary", "/api-docs", "/discover/api/nope"]) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(200);
      expect(await res.text(), p).toContain("the app");
    }
  });
});

/**
 * The dev server has its own fallback (vite.ts) and can't be mounted here
 * without starting Vite, so this is a backstop on the source: the same handler
 * is mounted on /api ahead of Vite and the page fallback. The behaviour itself
 * is checked on a running dev server.
 */
describe("the dev fallback", () => {
  it("refuses unregistered API paths before Vite or the page sees them", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "vite.ts"), "utf8");
    const guard = src.indexOf('app.use("/api", apiNotFound)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf("app.use(vite.middlewares)"));
    expect(guard).toBeLessThan(src.indexOf("transformIndexHtml"));
  });
});
