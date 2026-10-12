/**
 * The Relay Outpost review overlay proves it works the way code-architect's
 * own fixture does: a cold reviewer must catch the defects planted in a
 * known-bad component and must not invent any in its clean twin. This scorer
 * reads a review in the contract shape (ID first, then pass / flag / fail /
 * n/a, then the reason) against the sealed answer key.
 */
import { describe, it, expect } from "vitest";
import { parseReport, score } from "../.agents/skills/relay-outpost-review/eval/score-review.mjs";

const KEY = { fails: ["R1", "R3", "R8"], flags: ["R10"], traps: ["C7"] };

describe("parseReport", () => {
  it("reads one verdict per line, ID first, in any of the accepted spellings", () => {
    const r = parseReport([
      "R1 — fail — treats an unanswered query as empty",
      "R3: pass",
      "**R8** · FAIL · publishes a filtered list",
      "R10 - flag - is the icon button named?",
      "C7 — pass — a cohesive switch, not a gate",
      "a line that is not a verdict",
    ].join("\n"));
    expect(r).toEqual({ R1: "fail", R3: "pass", R8: "fail", R10: "flag", C7: "pass" });
  });
});

describe("score", () => {
  it("known-bad: every planted fail caught, the trap not failed → pass", () => {
    const s = score("bad", KEY, { R1: "fail", R3: "fail", R8: "fail", R10: "flag", C7: "flag" });
    expect(s.ok).toBe(true);
    expect(s.missed).toEqual([]);
  });
  it("known-bad: a planted fail reported as a flag is a miss; the trap failed is a violation", () => {
    const s = score("bad", KEY, { R1: "fail", R3: "flag", R8: "fail", R10: "flag", C7: "fail" });
    expect(s.ok).toBe(false);
    expect(s.missed).toEqual(["R3"]);
    expect(s.trapViolations).toEqual(["C7"]);
  });
  it("known-good: any fail is a false alarm; flags are fine", () => {
    expect(score("good", KEY, { R1: "pass", R3: "flag", R8: "pass" }).ok).toBe(true);
    const s = score("good", KEY, { R1: "fail", R3: "pass" });
    expect(s.ok).toBe(false);
    expect(s.falseFails).toEqual(["R1"]);
  });
  it("a row the review never mentions counts as missed on the known-bad", () => {
    expect(score("bad", KEY, { R1: "fail", R3: "fail" }).missed).toEqual(["R8"]);
  });
});
