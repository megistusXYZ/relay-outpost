/**
 * When to remind someone to back up their key. The backup is the only thing
 * that moves an account between devices (we keep no copy), so a key that lives
 * only in this browser is one cleared cache away from gone.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { backupNudge, backupFacts, markAccountCreated, markBackedUp, snoozeBackupNudge } from "./key-backup";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = 1_790_000_000_000; // the account was created here

const fresh = { keyInThisBrowser: true, createdHere: true, createdAt: T0, backedUpAt: undefined, snoozedUntil: undefined };

describe("key backup reminders", () => {
  it("never bothers someone who brought their own key (pasted nsec, key file): they already have it", () => {
    // Reported 2026-09-29: "Not backed up" showed for people who signed in
    // with their own nsec. Only an account made HERE has a key nobody else
    // has seen yet.
    const imported = { ...fresh, createdHere: false, createdAt: undefined };
    expect(backupNudge(imported, T0 + HOUR)).toBe("none");
    expect(backupNudge(imported, T0 + 30 * DAY)).toBe("none");
  });

  it("lists it on the Account page right away, and nudges once the account is a day old", () => {
    expect(backupNudge(fresh, T0 + HOUR)).toBe("row");
    expect(backupNudge(fresh, T0 + DAY + HOUR)).toBe("nudge");
  });

  it("says nothing once a backup is made, or when the key isn't kept in this browser", () => {
    expect(backupNudge({ ...fresh, backedUpAt: T0 + HOUR }, T0 + 5 * DAY)).toBe("none");
    // A signer app, extension or bunker holds the key elsewhere: nothing to back up here.
    expect(backupNudge({ ...fresh, keyInThisBrowser: false }, T0 + 5 * DAY)).toBe("none");
  });

  it("holds the nudge back while snoozed, and never nudges accounts older than this record", () => {
    const day2 = T0 + 2 * DAY;
    expect(backupNudge({ ...fresh, snoozedUntil: day2 + DAY }, day2)).toBe("row");
    expect(backupNudge({ ...fresh, snoozedUntil: day2 + DAY }, day2 + DAY + HOUR)).toBe("nudge");
    // No creation date: they may well have backed up already, so no nudge, just the row.
    expect(backupNudge({ ...fresh, createdAt: undefined }, T0 + 30 * DAY)).toBe("row");
  });
});

describe("what this device remembers about backups", () => {
  const ME = "a".repeat(64);
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it("nudges a day after sign-up, backs off for three days on Later, and stops for good after a backup", () => {
    markAccountCreated(ME, T0);
    expect(backupNudge(backupFacts(ME, true, true), T0 + DAY + HOUR)).toBe("nudge");
    snoozeBackupNudge(ME, T0 + DAY + HOUR);
    expect(backupNudge(backupFacts(ME, true, true), T0 + 3 * DAY)).toBe("row");
    expect(backupNudge(backupFacts(ME, true, true), T0 + 4 * DAY + 2 * HOUR)).toBe("nudge");
    markBackedUp(ME, T0 + 5 * DAY);
    expect(backupNudge(backupFacts(ME, true, true), T0 + 30 * DAY)).toBe("none");
  });
});
