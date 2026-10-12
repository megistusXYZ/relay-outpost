/**
 * The merge guard reads CI's answer, not a local run (CLAUDE.md). Its verdict
 * is per check name, from that name's latest run: GitHub cancels a duplicate
 * run when two triggers land on the same commit a second apart, and a
 * cancelled run that a later run superseded is not a failure (2026-10-11,
 * #446: refused with "CANCELLED build-and-test / SUCCESS build-and-test").
 * A re-run after a real failure counts the same way: the latest answer wins.
 */
import { describe, it, expect } from "vitest";
import { verdict } from "./merge-verdict.mjs";

const run = (conclusion: string | null, startedAt: string, name = "build-and-test") =>
  ({ name, status: conclusion ? "COMPLETED" : "IN_PROGRESS", conclusion, startedAt });

describe("merge verdict", () => {
  it("#446: a cancelled duplicate superseded by a passing run on the same commit is not a failure", () => {
    const v = verdict([run("SUCCESS", "2026-10-11T23:00:00Z"), run("CANCELLED", "2026-10-11T22:59:59Z")]);
    expect(v.ok).toBe(true);
    expect(v.failed).toEqual([]);
    expect(v.superseded).toEqual(["build-and-test (CANCELLED at 2026-10-11T22:59:59Z)"]);
  });
  it("a real failure refuses", () => {
    const v = verdict([run("FAILURE", "2026-10-11T23:00:00Z")]);
    expect(v.ok).toBe(false);
    expect(v.failed).toEqual(["build-and-test"]);
  });
  it("a failure that was re-run and then passed is a pass; a pass later cancelled is not", () => {
    expect(verdict([run("FAILURE", "2026-10-11T23:00:00Z"), run("SUCCESS", "2026-10-11T23:20:00Z")]).ok).toBe(true);
    const later = verdict([run("SUCCESS", "2026-10-11T23:00:00Z"), run("CANCELLED", "2026-10-11T23:20:00Z")]);
    expect(later.ok).toBe(false);
    expect(later.failed).toEqual(["build-and-test"]);
  });
  it("a check still running means wait, even when an older run of it passed", () => {
    const v = verdict([run("SUCCESS", "2026-10-11T23:00:00Z"), run(null, "2026-10-11T23:20:00Z")]);
    expect(v.ok).toBe(false);
    expect(v.pending).toEqual(["build-and-test"]);
  });
  it("every named check must pass, not just one of them", () => {
    const v = verdict([run("SUCCESS", "2026-10-11T23:00:00Z", "build-and-test"), run("FAILURE", "2026-10-11T23:00:00Z", "lint")]);
    expect(v.ok).toBe(false);
    expect(v.failed).toEqual(["lint"]);
  });
  it("neutral and skipped count as passing", () => {
    expect(verdict([run("NEUTRAL", "2026-10-11T23:00:00Z"), run("SKIPPED", "2026-10-11T23:00:00Z", "docs")]).ok).toBe(true);
  });
});
