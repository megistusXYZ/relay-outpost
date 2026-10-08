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
import { applyApiLimits } from "./api-limits";

let server: Server;
let base = "";
beforeEach(async () => {
  const app = express();
  applyApiLimits(app);
  app.get("/api/version", (_q, r) => r.json({ v: 1 }));
  app.get("/api/nip05/verify", (_q, r) => r.json({ ok: true }));
  app.get("/api/og", (_q, r) => r.json({ ok: true }));
  app.get("/api/tts", (_q, r) => r.json({ ok: true }));
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
});
