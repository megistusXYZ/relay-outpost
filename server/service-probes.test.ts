/**
 * The probes behind the service health check (server/service-probes.ts),
 * against real sockets: a relay that answers is up; a host that refuses or
 * never answers is down; a directory that answers but holds nobody we know
 * is EMPTY (user.kindpag.es did that for most people); an API that answers
 * with a web page is EMPTY (brainstorm.world did); a rate-limit is down.
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { probeRelay, probeDirectory, probeHttp } from "./service-probes";

let server: WebSocketServer | null = null;
afterEach(() => { server?.close(); server = null; });

/** A local relay: `events(filter)` is what it holds for a REQ. */
function relay(events: (filter: any) => any[], opts: { silent?: boolean } = {}): Promise<string> {
  return new Promise((ready) => {
    server = new WebSocketServer({ port: 0 }, () => ready(`ws://127.0.0.1:${(server!.address() as any).port}`));
    server.on("connection", (ws) => {
      ws.on("message", (raw) => {
        if (opts.silent) return;
        const m = JSON.parse(String(raw));
        if (m[0] !== "REQ") return;
        for (const e of events(m[2])) ws.send(JSON.stringify(["EVENT", m[1], e]));
        ws.send(JSON.stringify(["EOSE", m[1]]));
      });
    });
  });
}

const KNOWN = ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)];
const profile = (pubkey: string) => ({ id: pubkey.slice(0, 8), pubkey, kind: 0, content: "{}", tags: [], created_at: 1, sig: "" });

describe("probeRelay", () => {
  it("a relay that answers is up", async () => {
    const url = await relay(() => []);
    expect((await probeRelay(url, { timeoutMs: 2000 })).state).toBe("up");
  });
  it("a host that refuses is down", async () => {
    const r = await probeRelay("ws://127.0.0.1:1", { timeoutMs: 2000 });
    expect(r.state).toBe("down");
  });
  it("a relay that connects but never answers is down", async () => {
    const url = await relay(() => [], { silent: true });
    const r = await probeRelay(url, { timeoutMs: 500 });
    expect(r).toMatchObject({ state: "down", detail: "no answer" });
  });
});

describe("probeDirectory", () => {
  it("holds the well-known profiles: up", async () => {
    const url = await relay((f) => (f.authors ?? []).map(profile));
    expect((await probeDirectory(url, KNOWN, { timeoutMs: 2000 })).state).toBe("up");
  });
  it("answers, but holds fewer than half of them: empty", async () => {
    const url = await relay(() => [profile(KNOWN[0])]);
    const r = await probeDirectory(url, KNOWN, { timeoutMs: 2000 });
    expect(r).toMatchObject({ state: "empty", detail: "held 1 of 4 well-known profiles" });
  });
  it("no answer: down", async () => {
    const r = await probeDirectory("ws://127.0.0.1:1", KNOWN, { timeoutMs: 1000 });
    expect(r.state).toBe("down");
  });
});

describe("probeHttp", () => {
  const answer = (status: number, type: string, body: string) => async () =>
    new Response(body, { status, headers: { "content-type": type } });
  it("JSON as asked: up", async () => {
    expect((await probeHttp("https://x.test", { fetcher: answer(200, "application/json", "{\"ok\":1}") })).state).toBe("up");
  });
  it("a web page where JSON should be: empty", async () => {
    const r = await probeHttp("https://x.test", { fetcher: answer(200, "text/html", "<html></html>") });
    expect(r).toMatchObject({ state: "empty", detail: "answered text/html, not JSON" });
  });
  it("rate-limited or failing: down", async () => {
    expect(await probeHttp("https://x.test", { fetcher: answer(429, "text/plain", "slow down") })).toMatchObject({ state: "down", detail: "HTTP 429" });
  });
  it("no answer: down", async () => {
    const r = await probeHttp("https://x.test", { fetcher: async () => { throw new TypeError("fetch failed"); } });
    expect(r.state).toBe("down");
  });
  it("a body check can say an answer is empty", async () => {
    const r = await probeHttp("https://x.test", { fetcher: answer(200, "application/json", "[]"), check: (j) => Array.isArray(j) && j.length > 0 });
    expect(r.state).toBe("empty");
  });
});
