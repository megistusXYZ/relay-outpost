/**
 * The management call, end to end: the console's nip86Call → our proxy
 * (/api/nip86) → a relay that checks the request the way newlay does
 * (code.relay.tools/opensauce/newlay docs/MANAGEMENT_API.md §2–§4, read
 * 2026-10-08). Newlay's own settings take an on/off value, a clear (null), a
 * number or a group of fields — not just text — and its NIP-98 check is
 * strict: the payload tag must be the sha256 of the exact body it receives.
 *
 * The fake relay below is written from that doc, not from our code: it is
 * the part of this test that can disagree with us.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from "nostr-tools/pure";
import { applyNip86Proxy } from "../../../server/nip86-proxy";
import { nip86Call } from "./nip86";
import { setGlobalSigner } from "./nip42-auth";

const ADMIN = generateSecretKey();
const STRANGER = generateSecretKey();
let relayBase = "";
let proxyBase = "";
const seen: Array<{ method: string; params: unknown[] }> = [];
let relay: http.Server;
let proxy: http.Server;

/** newlay's canonicalizer (§2.3): http(s)→ws(s), lowercase, no default port, no trailing slash. */
const canon = (u: string) => u.toLowerCase().replace(/^http/, "ws").replace(/:(80|443)(?=\/|$)/, "").replace(/\/+$/, "");

beforeAll(async () => {
  relay = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const send = (code: number, body: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.method !== "POST" || req.url !== "/") return send(404, { error: "not found" });
      if (req.headers["content-type"] !== "application/nostr+json+rpc") return send(415, { error: "content type" });
      const raw = Buffer.concat(chunks);
      const auth = String(req.headers.authorization || "");
      if (!auth.startsWith("Nostr ")) return send(401, { error: "missing auth" });
      let ev: any;
      try { ev = JSON.parse(Buffer.from(auth.slice(6), "base64").toString("utf8")); } catch { return send(401, { error: "bad auth" }); }
      const tag = (n: string) => ev.tags?.find((t: string[]) => t[0] === n)?.[1];
      if (ev.kind !== 27235) return send(401, { error: "auth event must be kind 27235" });
      if (Math.abs(ev.created_at - Math.floor(Date.now() / 1000)) > 60) return send(401, { error: "auth event too old" });
      if (canon(tag("u") || "") !== canon(relayBase)) return send(401, { error: "u tag does not match this relay's url" });
      if (String(tag("method")).toUpperCase() !== "POST") return send(401, { error: "method tag" });
      const p = tag("payload");
      if (p !== undefined && p !== createHash("sha256").update(raw).digest("hex")) return send(401, { error: "payload tag does not match body" });
      if (!verifyEvent(ev)) return send(401, { error: "bad signature on authorization event" });
      if (ev.pubkey !== getPublicKey(ADMIN)) return send(403, { error: "this pubkey is not allowed to manage this relay" });
      let body: any;
      try { body = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "body is not a {method, params} JSON object" }); }
      const params = body.params ?? [];
      seen.push({ method: body.method, params });
      const ok = (v: unknown) => send(200, { result: v });
      const bad = (m: string) => send(200, { error: m });
      switch (body.method) {
        case "setwotenabled": return typeof params[0] === "boolean" ? ok(true) : bad("params[0]: expected a boolean");
        case "setwotcutoff": return typeof params[0] === "number" ? ok(true) : bad("params[0]: expected a number");
        case "setwotobserver": return params[0] === null || /^[0-9a-f]{64}$/.test(params[0]) ? ok(true) : bad("params[0]: not a 64-char hex pubkey");
        case "listblobs": return params[0] && typeof params[0] === "object" && !Array.isArray(params[0]) ? ok({ blobs: [], next_cursor: null }) : bad("params[0]: expected a JSON object");
        case "getwotsettings": return ok({ enabled: false, computing: true, configured: true, cutoff: 0.05, gate_writes: false, gate_writes_exempt_kinds: [], observer: getPublicKey(ADMIN) });
        default: return bad(`unknown method: ${body.method}`);
      }
    });
  });
  await new Promise<void>((ok) => relay.listen(0, "127.0.0.1", () => ok()));
  relayBase = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;

  const app = express();
  app.use(express.json());
  // Production's fetcher refuses loopback by design (SSRF); the fake relay
  // lives on loopback, so the test hands the proxy a plain one.
  applyNip86Proxy(app, { fetcher: (u, o = {}) => fetch(u, { method: o.method, headers: o.headers, body: o.body as any, redirect: "manual" }) });
  await new Promise<void>((ok) => { proxy = app.listen(0, "127.0.0.1", () => ok()); });
  proxyBase = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  // The browser's fetch("/api/nip86") goes to our server; here, to the proxy.
  const real = globalThis.fetch;
  globalThis.fetch = ((url: any, init?: any) => real(typeof url === "string" && url.startsWith("/") ? proxyBase + url : url, init)) as typeof fetch;
});
afterAll(async () => {
  setGlobalSigner(null);
  await new Promise<void>((ok) => relay.close(() => ok()));
  await new Promise<void>((ok) => proxy.close(() => ok()));
});

const signAs = (sk: Uint8Array) => setGlobalSigner({
  getPublicKey: async () => getPublicKey(sk),
  signEvent: async (t: any) => finalizeEvent(t, sk),
} as any);
const relayWs = () => relayBase.replace(/^http/, "ws");

describe("newlay management calls reach the relay as sent", () => {
  it("an on/off setting arrives as a bare true", async () => {
    signAs(ADMIN);
    const r = await nip86Call(relayWs(), "setwotenabled", [true]);
    expect(r).toEqual({ result: true });
    expect(seen.at(-1)).toEqual({ method: "setwotenabled", params: [true] });
  });

  it("a number, a clear and a group of fields arrive as themselves", async () => {
    signAs(ADMIN);
    expect(await nip86Call(relayWs(), "setwotcutoff", [0.05])).toEqual({ result: true });
    expect(await nip86Call(relayWs(), "setwotobserver", [null])).toEqual({ result: true });
    expect(await nip86Call(relayWs(), "listblobs", [{ limit: 10 }])).toEqual({ result: { blobs: [], next_cursor: null } });
    expect(seen.slice(-3)).toEqual([
      { method: "setwotcutoff", params: [0.05] },
      { method: "setwotobserver", params: [null] },
      { method: "listblobs", params: [{ limit: 10 }] },
    ]);
  });

  it("a settings read comes back whole", async () => {
    signAs(ADMIN);
    const r = await nip86Call<{ enabled: boolean; cutoff: number }>(relayWs(), "getwotsettings", []);
    expect(r.result).toMatchObject({ enabled: false, cutoff: 0.05, configured: true });
  });

  it("a key that isn't the relay's admin hears so, not a generic failure", async () => {
    signAs(STRANGER);
    const r = await nip86Call(relayWs(), "getwotsettings", []);
    expect(r.error).toMatch(/not allowed to manage this relay/);
  });
});

describe("the proxy", () => {
  it("refuses params that aren't a list", async () => {
    const r = await fetch(proxyBase + "/api/nip86", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relayUrl: relayWs(), method: "setwotenabled", params: { on: true } }),
    });
    expect(r.status).toBe(400);
  });
});
