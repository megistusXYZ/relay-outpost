/**
 * Per-IP request limits, sized for how the app is really used (owner,
 * 2026-10-08; the post-deploy health check). One guest visit to Home made 38
 * API calls in 30 s — 19 handle checks, 12 link previews — against a general
 * limit of 120/min, and previews shared a 20/min bucket with text-to-speech.
 * Scrolling, or a few phones behind one carrier IP, tripped them: handles
 * stopped verifying, previews vanished, the update check failed. Same defect
 * class this file's comments record for RSS and the stream proxy.
 *
 * Exercised for real: the limits mounted on a server, requests fired at it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { applyApiLimits, crawlerPreviewLimit } from "./api-limits";

let server: Server;
let base = "";
beforeEach(async () => {
  const app = express();
  applyApiLimits(app);
  app.get("/api/version", (_q, r) => r.json({ v: 1 }));
  app.get("/api/nip05/verify", (_q, r) => r.json({ ok: true }));
  app.get("/api/og", (_q, r) => r.json({ ok: true }));
  app.get("/api/tts", (_q, r) => r.json({ ok: true }));
  app.post("/api/push/device", (_q, r) => r.status(204).end());
  app.get("/api/push/key", (_q, r) => r.json({ ok: true }));
  server = await new Promise<Server>((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((ok) => server.close(() => ok())));

async function hit(path: string, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await fetch(base + path)).status);
  return out;
}

describe("API limits", () => {
  it("the update check is never refused", async () => {
    const codes = await hit("/api/version", 700);
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it("a minute of real use fits: 600 everyday calls per IP, then a refusal", async () => {
    const codes = await hit("/api/nip05/verify", 601);
    expect(codes.slice(0, 600).every((c) => c === 200)).toBe(true);
    expect(codes[600]).toBe(429);
  });

  it("link previews have their own bucket, sized for scrolling (120/min)", async () => {
    const codes = await hit("/api/og", 121);
    expect(codes.slice(0, 120).every((c) => c === 200)).toBe(true);
    expect(codes[120]).toBe(429);
  });

  it("…and using them up doesn't take text-to-speech with it (still its own 20/min)", async () => {
    await hit("/api/og", 121);
    const tts = await hit("/api/tts", 21);
    expect(tts.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(tts[20]).toBe(429);
  });

  // A device signs up again only when its rooms or mutes change, but each
  // sign-up can carry 200 signature checks and a list of relays to watch.
  it("push sign-up has its own bucket: 60 an hour per IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await fetch(base + "/api/push/device", { method: "POST" })).status);
    expect(codes.slice(0, 60).every((c) => c === 204)).toBe(true);
    expect(codes[60]).toBe(429);
  });

  it("…and reading the push key is not counted against it", async () => {
    for (let i = 0; i < 61; i++) await fetch(base + "/api/push/device", { method: "POST" });
    expect((await fetch(base + "/api/push/key")).status).toBe(200);
  });
});

/**
 * Link previews for bots are page paths, not /api, so no limit applied, and
 * each one for a thread or profile it hadn't seen opened sockets to six
 * relays. Past the limit a bot still gets the page, just without the lookup.
 */
describe("bot link previews", () => {
  const BOT = { "User-Agent": "Mozilla/5.0 (compatible; Twitterbot/1.0)" };
  async function startPreviews() {
    const express = (await import("express")).default;
    const app = express();
    app.set("trust proxy", 1);
    app.use(crawlerPreviewLimit(/bot|crawler/i));
    // The real preview middleware (routes.ts) answers only when the limiter allowed it.
    app.get("/thread/:id", (_req, res, next) => (res.locals.crawlerPreview === true ? res.send("preview") : next()));
    app.use((_q, r) => r.send("page"));
    const s = await new Promise<Server>((ok) => { const x = app.listen(0, "127.0.0.1", () => ok(x)); });
    return { s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
  }

  it("a bot gets 30 previews a minute per IP, then the plain page", async () => {
    const { s, url } = await startPreviews();
    const got: string[] = [];
    for (let i = 0; i < 31; i++) got.push(await (await fetch(`${url}/thread/${i}`, { headers: BOT })).text());
    s.close();
    expect(got.slice(0, 30).every((t) => t === "preview")).toBe(true);
    expect(got[30]).toBe("page");
  });

  it("people are never counted", async () => {
    const { s, url } = await startPreviews();
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await fetch(`${url}/thread/${i}`)).status);
    const bot = await (await fetch(`${url}/thread/x`, { headers: BOT })).text();
    s.close();
    expect(codes.every((c) => c === 200)).toBe(true);
    expect(bot).toBe("preview");
  });
});
