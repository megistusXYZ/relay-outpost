/**
 * The limit on trust-score lookups protects the score relay: 30 a minute per
 * IP. Since the server keeps every score in memory (score-cards.ts), almost
 * every lookup is answered without asking the relay, and those cost nothing.
 * Counting them anyway made this the tightest limit a visitor met: a cold
 * Discover load makes 6-9 lookups, so the fourth load in a minute from one IP
 * (people behind one phone network share one) was refused, and tiles said
 * "Couldn't reach". Only lookups that will ask the relay count now.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { createScoreLookupGate } from "./score-lookup-gate";

function setup(max = 3) {
  let t = 1_000_000;
  const gate = createScoreLookupGate({ max, windowMs: 60_000, now: () => t });
  return { gate, advance: (ms: number) => { t += ms; } };
}

describe("score lookup gate", () => {
  it("a lookup answered from memory is always let through and never counted", () => {
    const { gate } = setup(3);
    for (let i = 0; i < 50; i++) expect(gate.allow("1.2.3.4", { needsRelay: false })).toBe(true);
    // The budget for relay lookups is untouched.
    for (let i = 0; i < 3; i++) expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(true);
  });

  it("lookups that will ask the relay are limited per IP", () => {
    const { gate } = setup(3);
    for (let i = 0; i < 3; i++) expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(true);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(false);
  });

  it("an IP over the limit still gets lookups that need no relay", () => {
    const { gate } = setup(1);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(true);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(false);
    expect(gate.allow("1.2.3.4", { needsRelay: false })).toBe(true);
  });

  it("a refused lookup doesn't use up budget", () => {
    const { gate, advance } = setup(2);
    gate.allow("1.2.3.4", { needsRelay: true });
    gate.allow("1.2.3.4", { needsRelay: true });
    for (let i = 0; i < 10; i++) gate.allow("1.2.3.4", { needsRelay: true }); // all refused
    advance(60_001);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(true);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(true);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(false);
  });

  it("the window slides: a minute later the budget is back", () => {
    const { gate, advance } = setup(2);
    gate.allow("1.2.3.4", { needsRelay: true });
    advance(30_000);
    gate.allow("1.2.3.4", { needsRelay: true });
    advance(30_001); // the first is now over a minute old
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(true);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(false);
  });

  it("each IP has its own budget", () => {
    const { gate } = setup(1);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(true);
    expect(gate.allow("5.6.7.8", { needsRelay: true })).toBe(true);
    expect(gate.allow("1.2.3.4", { needsRelay: true })).toBe(false);
  });

  it("forgets IPs that have gone quiet", () => {
    const { gate, advance } = setup(3);
    for (let i = 0; i < 500; i++) gate.allow("10.0.0." + i, { needsRelay: true });
    expect(gate.tracked()).toBe(500);
    advance(60_001);
    gate.allow("1.2.3.4", { needsRelay: true });
    expect(gate.tracked()).toBe(1);
  });
});

describe("the score lookup route uses it", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "routes.ts"), "utf8");
  const route = src.slice(src.indexOf('app.post("/api/brainstorm/wot-batch"'), src.indexOf('app.post("/api/brainstorm/profiles-bulk"'));

  it("asks the gate, telling it whether this lookup needs the relay", () => {
    expect(route).toMatch(/scoreLookupGate\.allow\(req\.ip \|\| "unknown", \{ needsRelay: scoreCards\.needsRelay\(batch\) \}\)/);
  });

  it("decides before the lookup runs, and refuses with 429", () => {
    expect(route.indexOf("scoreLookupGate.allow")).toBeGreaterThan(-1);
    expect(route.indexOf("scoreLookupGate.allow")).toBeLessThan(route.indexOf("scoreCards.scores(batch)"));
    expect(route).toMatch(/status\(429\)/);
  });

  it("keeps the limit at 30 a minute for lookups that do ask the relay", () => {
    expect(src).toMatch(/createScoreLookupGate\(\{ max: 30, windowMs: 60_000 \}\)/);
  });

  it("the old count-everything limiter is gone", () => {
    expect(src).not.toMatch(/wotBatchRateLimit/);
  });
});
