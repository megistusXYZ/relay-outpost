/**
 * Owner, 2026-10-03, twice in a row: "dont make these pills". A small status
 * word — "New here" on a profile, "3 new" on a Discover tile — sits in its
 * line as plain coloured text, not in a rounded, filled badge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = (rel: string) => readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");
const classOf = (code: string, testId: string): string => {
  const at = code.indexOf(`data-testid="${testId}"`);
  expect(at, `${testId} is rendered`).toBeGreaterThan(-1);
  const open = code.lastIndexOf("<span", at);
  const tag = code.slice(open, at);
  return /className="([^"]*)"/.exec(tag)?.[1] ?? "";
};

describe("status words are words, not pills", () => {
  it("New here on a profile", () => {
    const cls = classOf(src("components/profile/IdentityPresence.tsx"), "identity-new-here");
    expect(cls).not.toMatch(/rounded-full|\bbg-|uppercase/);
  });
  it("N new on a Discover tile", () => {
    const cls = classOf(src("pages/Discover.tsx"), "fresh-chip");
    expect(cls).not.toMatch(/rounded-full|\bbg-|uppercase/);
  });
});
