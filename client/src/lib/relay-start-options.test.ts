import { describe, it, expect } from "vitest";
import { START_OPTIONS } from "./relay-start-options";

describe("ways to start a community space", () => {
  it("leads with the one we recommend, and recommends exactly one", () => {
    expect(START_OPTIONS.filter((o) => o.recommended)).toHaveLength(1);
    expect(START_OPTIONS[0].recommended).toBe(true);
  });

  it("links out plainly — no referral codes, no tracking, nothing in between", () => {
    for (const o of START_OPTIONS) {
      const u = new URL(o.href);
      expect(u.protocol).toBe("https:");
      expect(u.search).toBe("");
      expect(u.hash).toBe("");
      expect(u.hostname).not.toMatch(/relayop|relay-outpost/);
    }
  });

  it("says who each one is for, in a sentence", () => {
    for (const o of START_OPTIONS) {
      expect(o.title.length).toBeGreaterThan(0);
      expect(o.forWho).toMatch(/\.$/);
      expect(o.points.length).toBeGreaterThan(0);
    }
  });

  it("each choice goes somewhere different", () => {
    const hosts = START_OPTIONS.map((o) => new URL(o.href).hostname);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});
