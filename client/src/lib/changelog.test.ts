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

  // Two releases on one day (1.10.0 and 1.11.0, 2026-08-27) shared a list key
  // on the What's New page while it was keyed by date.
  it("no two releases share a version, and the page keys its list by version", async () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const page = readFileSync(path.resolve(import.meta.dirname, "../pages/WhatsNew.tsx"), "utf8");
    expect(page).toMatch(/key=\{entry\.version\}/);
    expect(page).not.toMatch(/key=\{entry\.date\}/);
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

  it("dates never increase, so version order and date order agree", () => {
    // Non-strict: two releases can genuinely land on the same day (1.10.0 and
    // 1.11.0 both shipped 2026-08-27). Array order stays the authority; a date
    // may repeat but must never move backwards.
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date, `${CHANGELOG[i - 1].date} must not be before ${CHANGELOG[i].date}`).toBe(true);
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

/**
 * Owner, 2026-10-06: "we are giving too much away … condense in larger
 * rollouts … only add what's of value, they don't need to know all the extra
 * jazz." What's New is for the people using the app, not a build log.
 */
describe("What's New says only what's of value", () => {
  it("each release is a handful of short lines", () => {
    for (const e of CHANGELOG) {
      expect(e.changes.length, `${e.version} has ${e.changes.length} lines`).toBeLessThanOrEqual(5);
      for (const c of e.changes) expect(c.text.length, `${e.version}: "${c.text}"`).toBeLessThanOrEqual(140);
    }
  });

  it("says what works now — no tester quotes, no internals, no account of what broke", () => {
    const tooMuch = /\b(NIP-?\d+|kind[- ]\d+|wss:|relay\.[a-z]|Primal|nostr\.band|WebKit|Safari|memory|crash\w*|bugs?|leak\w*|exploit\w*|vulnerab\w*|security|broken|blank|regression|cache)\b/i;
    for (const e of CHANGELOG) {
      expect(e.feedback, `${e.version} carries tester quotes`).toBeUndefined();
      for (const c of [e.title ?? "", ...e.changes.map((x) => x.text)]) {
        expect(c, `${e.version}`).not.toMatch(tooMuch);
      }
    }
  });

  it("releases come as rollouts, not daily bits: from 1.18.0 on, at least 5 days apart", () => {
    const day = 86_400_000;
    for (let i = 0; i < CHANGELOG.length - 1; i++) {
      if (CHANGELOG[i].date <= "2026-10-06") break;
      const gap = (Date.parse(CHANGELOG[i].date) - Date.parse(CHANGELOG[i + 1].date)) / day;
      expect(gap, `${CHANGELOG[i].version} came ${gap} days after ${CHANGELOG[i + 1].version}`).toBeGreaterThanOrEqual(5);
    }
  });
});
