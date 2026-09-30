/**
 * Where the app gets the relay directory. The server hands over one small
 * shared list; reading the monitors directly (6.5 MB, measured 2026-09-30)
 * is what's left for when the server can't answer. An answer the server
 * couldn't give is never an empty directory: the monitors get asked.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fetchServerDirectory, readDirectory } from "./relay-directory-source";

const entry = (url: string) => ({ url, supportedNips: [1, 11], requirements: [], software: "strfry", relayType: "", lastSeen: 100 });
const respond = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any);

describe("fetchServerDirectory", () => {
  it("asks the server and returns its list", async () => {
    const f = respond(200, { relays: [entry("wss://one.example"), entry("wss://two.example")] });
    const got = await fetchServerDirectory(f);
    expect(f.mock.calls[0][0]).toBe("/api/relay-directory");
    expect(got?.map((r) => r.url)).toEqual(["wss://one.example", "wss://two.example"]);
  });

  it("drops entries that aren't relays", async () => {
    const got = await fetchServerDirectory(respond(200, { relays: [entry("wss://one.example"), entry("https://not-a-relay.example"), { url: 5 }, null] }));
    expect(got?.map((r) => r.url)).toEqual(["wss://one.example"]);
  });

  it("no usable answer is null, never an empty directory", async () => {
    expect(await fetchServerDirectory(respond(503, { relays: [], error: "Couldn't read" }))).toBeNull();
    expect(await fetchServerDirectory(respond(200, { relays: [] }))).toBeNull();
    expect(await fetchServerDirectory(respond(200, { relays: [{ url: "nope" }] }))).toBeNull();
    expect(await fetchServerDirectory(respond(200, "<html>"))).toBeNull();
    expect(await fetchServerDirectory(respond(200, null))).toBeNull();
    expect(await fetchServerDirectory(vi.fn(async () => { throw new Error("offline"); }))).toBeNull();
    expect(await fetchServerDirectory(vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }) as any))).toBeNull();
  });
});

describe("readDirectory", () => {
  it("the server's list is enough: the monitors aren't read", async () => {
    const monitors = vi.fn(async () => [entry("wss://from-monitors.example")]);
    const got = await readDirectory({ server: async () => [entry("wss://from-server.example")], monitors });
    expect(got.map((r) => r.url)).toEqual(["wss://from-server.example"]);
    expect(monitors).not.toHaveBeenCalled();
  });

  it("the server couldn't answer: the monitors are read", async () => {
    const got = await readDirectory({ server: async () => null, monitors: async () => [entry("wss://from-monitors.example")] });
    expect(got.map((r) => r.url)).toEqual(["wss://from-monitors.example"]);
  });

  it("the server failed outright: the monitors are read", async () => {
    const got = await readDirectory({ server: async () => { throw new Error("boom"); }, monitors: async () => [entry("wss://from-monitors.example")] });
    expect(got.map((r) => r.url)).toEqual(["wss://from-monitors.example"]);
  });
});

describe("the shared directory store uses it", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "../hooks/use-outpost-directory-search.ts"), "utf8");

  it("discovery goes through readDirectory, server first", () => {
    expect(src).toMatch(/readDirectory\(\{\s*server: \(\) => fetchServerDirectory\(\)/);
  });

  it("the monitors are only read inside the fallback", () => {
    const subscribes = src.match(/pool\.subscribeMany\(\s*NIP_66_MONITOR_RELAYS/g) ?? [];
    expect(subscribes).toHaveLength(1);
    const fallback = src.slice(src.indexOf("function readMonitors("));
    expect(fallback).toMatch(/pool\.subscribeMany\(\s*NIP_66_MONITOR_RELAYS/);
    expect(src.slice(0, src.indexOf("function readMonitors("))).not.toMatch(/pool\.subscribeMany\(\s*NIP_66_MONITOR_RELAYS/);
  });
});
