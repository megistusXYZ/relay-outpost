/**
 * What an operator decided about reports, kept per account and synced to their
 * other devices: whose reports they ignore (on every relay they run), and when
 * they dismissed each row (newer reports bring it back). Undo must survive a
 * sync, so each entry carries its own time and the newer decision wins.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readIgnoreMap, setReporterIgnored, ignoredReporterSet, mergeIgnoreMaps,
  readDismissMap, recordDismissal, dismissedAtFor, mergeDismissMaps,
} from "./report-moderation-prefs";

const ME = "a".repeat(64);
const R1 = "1".repeat(64), R2 = "2".repeat(64);

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear(),
  };
}

beforeEach(() => { (globalThis as any).localStorage = memoryStorage(); });

describe("ignored reporters", () => {
  it("ignoring and un-ignoring are remembered per account", () => {
    setReporterIgnored(ME, R1, true, 100);
    setReporterIgnored(ME, R2, true, 100);
    setReporterIgnored(ME, R2, false, 200);
    expect([...ignoredReporterSet(readIgnoreMap(ME))]).toEqual([R1]);
    expect(ignoredReporterSet(readIgnoreMap("b".repeat(64))).size).toBe(0);
  });

  it("merging keeps each person's newest decision, so an undo isn't undone by an older device", () => {
    const here = { [R1]: { on: false, at: 300 } };
    const there = { [R1]: { on: true, at: 100 }, [R2]: { on: true, at: 150 } };
    expect(mergeIgnoreMaps(here, there)).toEqual({ [R1]: { on: false, at: 300 }, [R2]: { on: true, at: 150 } });
  });
});

describe("dismissed rows", () => {
  it("records when a row was dismissed, per relay", () => {
    recordDismissal(ME, "wss://relay.example/", "p:" + R1, 500);
    const map = readDismissMap(ME);
    expect(dismissedAtFor(map, "wss://RELAY.example", "p:" + R1)).toBe(500);
    expect(dismissedAtFor(map, "wss://other.example", "p:" + R1)).toBeUndefined();
  });

  it("merging keeps the later dismissal", () => {
    expect(mergeDismissMaps({ a: 10, b: 50 }, { a: 30, c: 5 })).toEqual({ a: 30, b: 50, c: 5 });
  });

  it("carries over rows dismissed before this existed, still dismissed", () => {
    localStorage.setItem("ro_relay_reports_dismissed_wss://old.example", JSON.stringify(["e:" + "f".repeat(64)]));
    const map = readDismissMap(ME, 1000);
    expect(dismissedAtFor(map, "wss://old.example", "e:" + "f".repeat(64))).toBe(1000);
    expect(localStorage.getItem("ro_relay_reports_dismissed_wss://old.example")).toBeNull();
  });
});
