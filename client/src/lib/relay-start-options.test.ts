import { describe, it, expect } from "vitest";
import { START_OPTIONS } from "./relay-start-options";

const plain = (href: string) => {
  const u = new URL(href);
  expect(u.protocol).toBe("https:");
  expect(u.search).toBe("");
  expect(u.hash).toBe("");
  expect(u.hostname).not.toMatch(/relayop|relay-outpost/);
};

describe("ways to start a community space", () => {
  it("leads with the one we recommend, and recommends exactly one", () => {
    expect(START_OPTIONS.filter((o) => o.recommended)).toHaveLength(1);
    expect(START_OPTIONS[0].recommended).toBe(true);
  });

  it("each way either links to a provider or offers a choice of software — plain links either way", () => {
    for (const o of START_OPTIONS) {
      expect(Boolean(o.href) !== Boolean(o.software?.length)).toBe(true);
      if (o.href) plain(o.href);
      for (const s of o.software ?? []) plain(s.href);
    }
  });

  it("says who each one is for, in a sentence", () => {
    for (const o of START_OPTIONS) {
      expect(o.title.length).toBeGreaterThan(0);
      expect(o.forWho).toMatch(/\.$/);
      expect(o.points.length).toBeGreaterThan(0);
    }
  });

  it("running it yourself offers several real choices, each with what it's best for", () => {
    const self = START_OPTIONS.find((o) => o.id === "self")!;
    expect(self.software!.length).toBeGreaterThanOrEqual(3);
    for (const s of self.software!) {
      expect(s.bestFor.length).toBeGreaterThan(0);
      expect(s.line).toMatch(/\.$/);
    }
    expect(new Set(self.software!.map((s) => s.href)).size).toBe(self.software!.length);
    expect(new Set(self.software!.map((s) => s.bestFor)).size).toBe(self.software!.length);
  });

  it("never promises every tool works where it doesn't", () => {
    const self = START_OPTIONS.find((o) => o.id === "self")!;
    expect(self.points.join(" ")).not.toMatch(/every tool/i);
  });
});
