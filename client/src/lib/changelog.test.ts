import { describe, it, expect } from "vitest";
import { CHANGELOG, APP_VERSION, LATEST_CHANGELOG_DATE } from "./changelog";

const SEMVER = /^\d+\.\d+\.\d+$/;

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

describe("changelog is the single source of truth for the app version", () => {
  it("APP_VERSION is the newest entry's semver version", () => {
    expect(APP_VERSION).toBe(CHANGELOG[0].version);
    expect(APP_VERSION).toMatch(SEMVER);
  });

  it("every release carries a valid semver version", () => {
    for (const e of CHANGELOG) {
      expect(e.version, `entry ${e.date} has a valid semver`).toMatch(SEMVER);
    }
  });

  it("versions strictly decrease down the list (newest first) — no dupes, no regressions", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(
        cmpSemver(CHANGELOG[i - 1].version, CHANGELOG[i].version),
        `${CHANGELOG[i - 1].version} must be > ${CHANGELOG[i].version}`,
      ).toBeGreaterThan(0);
    }
  });

  it("dates strictly decrease too, so version order and date order agree", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i - 1].date > CHANGELOG[i].date, `${CHANGELOG[i - 1].date} must be after ${CHANGELOG[i].date}`).toBe(true);
    }
    expect(LATEST_CHANGELOG_DATE).toBe(CHANGELOG[0].date);
  });
});

describe("package.json follows the changelog", () => {
  it("pkg.version === APP_VERSION — the Docker build stamps /api/version from package.json when git is absent, so an unbumped package lies about every deploy", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf-8"));
    expect(pkg.version).toBe(APP_VERSION);
  });
});
