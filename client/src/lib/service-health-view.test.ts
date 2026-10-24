/**
 * The team's card about the services the app depends on (relay-ops
 * Overview), worded from /api/service-health (server/service-health.ts):
 * one quiet line when everything answers, and when something doesn't, what,
 * since when, and why, in plain words.
 */
import { describe, it, expect } from "vitest";
import { serviceHealthView } from "./service-health-view";

const NOW = Date.UTC(2026, 9, 23, 22, 0);
const MIN = 60_000;
const item = (o: Record<string, unknown>) => ({ id: "x", label: "x", group: "Default relays", kind: "relay", target: "wss://x", state: "up", since: NOW - 60 * MIN, lastChecked: NOW - 3 * MIN, ms: 100, ...o });

describe("serviceHealthView", () => {
  it("before the first check: says so, never \"all fine\"", () => {
    expect(serviceHealthView({ checkedAt: null, items: [] }, NOW)).toEqual({ kind: "waiting", line: "The first check runs shortly after the server starts." });
  });

  it("everything answering: one line, with how many and when", () => {
    const v = serviceHealthView({ checkedAt: NOW - 3 * MIN, items: [item({ id: "a" }), item({ id: "b" })] }, NOW);
    expect(v).toEqual({ kind: "ok", line: "All 2 services we depend on are answering · checked 3 min ago" });
  });

  it("anything not answering: listed with what's wrong and since when", () => {
    const v = serviceHealthView({
      checkedAt: NOW - 3 * MIN,
      items: [
        item({ id: "p", label: "cache.primal.net", group: "Primal", state: "down", since: NOW - 125 * MIN, detail: "can't connect" }),
        item({ id: "b", label: "Profile search API (Brainstorm)", group: "Outside services", state: "empty", since: NOW - 3 * MIN, detail: "answered text/html, not JSON" }),
        item({ id: "d" }),
      ],
    }, NOW);
    expect(v.kind).toBe("problems");
    if (v.kind !== "problems") return;
    expect(v.line).toBe("2 of 3 services need a look · checked 3 min ago");
    expect(v.rows).toEqual([
      { id: "p", name: "cache.primal.net", group: "Primal", word: "Not answering", since: "for 2 h", why: "can't connect", severity: "down" },
      { id: "b", name: "Profile search API (Brainstorm)", group: "Outside services", word: "Answering with nothing", since: "for 3 min", why: "answered text/html, not JSON", severity: "empty" },
    ]);
  });

  it("an old answer is called old: the check itself may have stopped", () => {
    const v = serviceHealthView({ checkedAt: NOW - 50 * MIN, items: [item({})] }, NOW);
    expect(v).toEqual({ kind: "stale", line: "The last check was 50 min ago; the server may not be checking." });
  });
});
