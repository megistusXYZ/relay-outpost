/**
 * Tapping a notification (owner, 2026-10-06; client/public/sw.js): it brings
 * the app forward at the room or Chats, or opens it when it isn't open — and
 * only ever somewhere on this site. Run for real in a sandbox; a browser's
 * test hooks can deliver a push (ship/push-sw-e2e.cjs) but can't tap one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import vm from "vm";

const SRC = readFileSync(path.resolve(import.meta.dirname, "../public/sw.js"), "utf8");

function world(windows: Array<{ url: string }>) {
  const handlers: Record<string, Array<(e: any) => void>> = {};
  const did: string[] = [];
  const wins = windows.map((w) => ({
    ...w,
    focus: async () => { did.push(`focus ${w.url}`); },
    navigate: async (to: string) => { did.push(`navigate ${to}`); },
  }));
  const self: any = {
    addEventListener: (t: string, h: any) => { (handlers[t] ||= []).push(h); },
    skipWaiting: () => {},
    registration: { navigationPreload: { enable: async () => {} }, showNotification: async () => {} },
    location: { origin: "https://relayop.xyz" },
    clients: {
      claim: async () => {},
      matchAll: async () => wins,
      openWindow: async (to: string) => { did.push(`open ${to}`); },
    },
  };
  vm.runInContext(SRC, vm.createContext({ self, caches: {}, fetch: async () => new Response(""), Response, Request, Headers, URL, Promise, setTimeout, clearTimeout, console, Date }));
  const tap = async (open: unknown) => {
    const waits: Promise<unknown>[] = [];
    for (const h of handlers.notificationclick || []) h({ notification: { data: { open }, close: () => did.push("close") }, waitUntil: (p: any) => waits.push(p) });
    await Promise.all(waits);
    return did;
  };
  return { tap };
}

describe("tapping a notification", () => {
  it("brings the open app forward, at the call's room", async () => {
    expect(await world([{ url: "https://relayop.xyz/discover" }]).tap("/outposts/c/abc?channel=def"))
      .toEqual(["close", "focus https://relayop.xyz/discover", "navigate /outposts/c/abc?channel=def"]);
  });
  it("opens the app when it isn't open", async () => {
    expect(await world([]).tap("/messages")).toEqual(["close", "open /messages"]);
  });
  it("never opens somewhere off this site", async () => {
    expect(await world([]).tap("https://evil.example/")).toEqual(["close", "open /messages"]);
    expect(await world([]).tap("//evil.example/")).toEqual(["close", "open /messages"]);
  });
});
