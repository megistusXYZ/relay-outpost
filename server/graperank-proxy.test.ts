/**
 * The trust-score proxy forwards a few requests to the scoring service. A key
 * in the path goes into the upstream URL, so only a 64-character hex key is
 * forwarded: an encoded slash or dots can't reach other upstream paths.
 * Run over real HTTP with a fake upstream that records what it was asked.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { registerGrapeRankProxy } from "./graperank-proxy";

const KEY = "ab".repeat(32);
const asked: Array<{ url: string; method: string; token?: string }> = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const h = (init?.headers ?? {}) as Record<string, string>;
  asked.push({ url, method: init?.method ?? "GET", token: h["access_token"] });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}) as unknown as typeof fetch;

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerGrapeRankProxy(app, { upstream: "https://scores.example", fetchImpl: fakeFetch });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/graperank`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("the trust-score proxy", () => {
  it("forwards a hex key to the matching upstream path, with the caller's token", async () => {
    asked.length = 0;
    expect((await fetch(`${base}/user/${KEY}`, { headers: { access_token: "t1" } })).status).toBe(200);
    expect((await fetch(`${base}/setup/${KEY.toUpperCase()}`)).status).toBe(200);
    expect((await fetch(`${base}/authChallenge/${KEY}`)).status).toBe(200);
    expect((await fetch(`${base}/authChallenge/${KEY}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(200);
    expect(asked).toEqual([
      { url: `https://scores.example/user/${KEY}`, method: "GET", token: "t1" },
      { url: `https://scores.example/setup/${KEY}`, method: "GET", token: undefined },
      { url: `https://scores.example/authChallenge/${KEY}`, method: "GET", token: undefined },
      { url: `https://scores.example/authChallenge/${KEY}/verify`, method: "POST", token: undefined },
    ]);
  });

  it("still answers /user/self", async () => {
    asked.length = 0;
    expect((await fetch(`${base}/user/self`, { headers: { access_token: "t2" } })).status).toBe(200);
    expect(asked).toEqual([{ url: "https://scores.example/user/self", method: "GET", token: "t2" }]);
  });

  it("refuses anything that isn't a hex key, without asking upstream", async () => {
    asked.length = 0;
    for (const bad of ["..%2Fuser%2Fgraperank", "npub1abc", "ab".repeat(31), `${KEY}%2F..`]) {
      expect((await fetch(`${base}/user/${bad}`)).status, bad).toBe(400);
      expect((await fetch(`${base}/setup/${bad}`)).status, bad).toBe(400);
      expect((await fetch(`${base}/authChallenge/${bad}`)).status, bad).toBe(400);
    }
    expect(asked).toEqual([]);
  });
});
