/**
 * The services Relay Outpost can't work without, checked from the server
 * (server/service-health.ts): the default relays, the search relays, the
 * profile directories, and outside services (Primal, Brainstorm, translate,
 * podcasts, the bitcoin price). Learned the hard way: Brainstorm's search
 * API turned into a web page and the translate endpoint got blocked, and
 * nobody knew until someone noticed a feature had gone quiet.
 *
 * Three states, never two: up; EMPTY (answered, but with nothing where we
 * know there is something: the directory that answered empty for most
 * people, the API that answers with a web page); DOWN (no answer).
 */
import { describe, it, expect } from "vitest";
import { foldHealth, type Dependency, type CheckResult } from "./service-health";

const relay: Dependency = { id: "relay:damus", label: "relay.damus.io", group: "Default relays", kind: "relay", target: "wss://relay.damus.io" };
const dir: Dependency = { id: "dir:kindpag", label: "user.kindpag.es", group: "Profile directories", kind: "directory", target: "wss://user.kindpag.es" };
const up: CheckResult = { state: "up", ms: 120 };
const down: CheckResult = { state: "down", ms: 6000, detail: "no answer" };
const empty: CheckResult = { state: "empty", ms: 300, detail: "answered with nothing" };
const T0 = 1_700_000_000_000;
const MIN = 60_000;

describe("foldHealth", () => {
  it("first check: each dependency in the state it answered, since now", () => {
    const s = foldHealth([], [[relay, up], [dir, empty]], T0);
    expect(s.map((d) => [d.id, d.state, d.since])).toEqual([["dir:kindpag", "empty", T0], ["relay:damus", "up", T0]]);
  });

  it("the same state again keeps when it started; a change starts a new since", () => {
    const first = foldHealth([], [[relay, down]], T0);
    const second = foldHealth(first, [[relay, down]], T0 + 15 * MIN);
    expect(second[0]).toMatchObject({ state: "down", since: T0, lastChecked: T0 + 15 * MIN });
    const back = foldHealth(second, [[relay, up]], T0 + 30 * MIN);
    expect(back[0]).toMatchObject({ state: "up", since: T0 + 30 * MIN });
  });

  it("keeps what went wrong, for the card", () => {
    const s = foldHealth([], [[relay, down]], T0);
    expect(s[0].detail).toBe("no answer");
  });

  it("anything not up is listed first, longest-broken first", () => {
    const a = foldHealth([], [[relay, up], [dir, down]], T0);
    const other: Dependency = { ...relay, id: "relay:nos", label: "nos.lol", target: "wss://nos.lol" };
    const b = foldHealth(a, [[relay, up], [dir, down], [other, empty]], T0 + 15 * MIN);
    expect(b.map((d) => d.id)).toEqual(["dir:kindpag", "relay:nos", "relay:damus"]);
  });
});

import express from "express";
import type { Server } from "node:http";
import { registerServiceHealth } from "./service-health";

describe("/api/service-health", () => {
  async function mount(probe: (d: Dependency) => Promise<CheckResult>) {
    const app = express();
    const health = registerServiceHealth(app, { targets: [relay, dir], probe, everyMs: 0, retryAfterMs: 0 });
    const server = await new Promise<Server>((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    return { health, base, close: () => server.close() };
  }

  it("before the first check it says so, never \"all fine\"", async () => {
    const m = await mount(async () => up);
    const body = await (await fetch(m.base + "/api/service-health")).json();
    expect(body).toEqual({ checkedAt: null, items: [] });
    m.close();
  });

  it("after a check: every dependency, what isn't up first, with what went wrong", async () => {
    const m = await mount(async (d) => (d.kind === "directory" ? empty : up));
    await m.health.runNow();
    const body = await (await fetch(m.base + "/api/service-health")).json();
    expect(typeof body.checkedAt).toBe("number");
    expect(body.items.map((i: any) => [i.id, i.state])).toEqual([["dir:kindpag", "empty"], ["relay:damus", "up"]]);
    expect(body.items[0].detail).toBe("answered with nothing");
    m.close();
  });

  it("one refused connection isn't an outage: a down is asked once more before it counts", async () => {
    let tries = 0;
    const m = await mount(async (d) => { if (d.kind === "relay") { tries++; return tries === 1 ? down : up; } return up; });
    await m.health.runNow();
    const body = await (await fetch(m.base + "/api/service-health")).json();
    expect(body.items.find((i: any) => i.id === "relay:damus").state).toBe("up");
    expect(tries).toBe(2);
    m.close();
  });

  it("a probe that throws counts as down, and the rest are still checked", async () => {
    const m = await mount(async (d) => { if (d.kind === "relay") throw new Error("boom"); return up; });
    await m.health.runNow();
    const body = await (await fetch(m.base + "/api/service-health")).json();
    expect(body.items.map((i: any) => [i.id, i.state])).toEqual([["relay:damus", "down"], ["dir:kindpag", "up"]]);
    m.close();
  });
});
