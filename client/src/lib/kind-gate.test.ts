import { describe, it, expect } from "vitest";
import { describeKindPolicy, GATE_KIND_OPTIONS, formatKindList } from "./kind-gate";

describe("describeKindPolicy (three outcomes: answered-with-list, answered-empty, never-answered)", () => {
  it("an allowlist means only those kinds get in", () => {
    expect(describeKindPolicy([1, 30023], [])).toEqual({ mode: "allowlist", kinds: [1, 30023] });
  });

  it("a blocklist means everything except those kinds", () => {
    expect(describeKindPolicy([], [4, 1059])).toEqual({ mode: "blocklist", kinds: [4, 1059] });
  });

  it("both lists empty = the relay answered and declared no restriction", () => {
    expect(describeKindPolicy([], [])).toEqual({ mode: "unrestricted", kinds: [] });
  });

  it("null means we never got an answer — NOT unrestricted", () => {
    expect(describeKindPolicy(null, null)).toEqual({ mode: "unknown", kinds: [] });
    expect(describeKindPolicy(null, [])).toEqual({ mode: "unknown", kinds: [] });
  });

  it("an allowlist wins when both are somehow populated (allow is the narrower claim)", () => {
    expect(describeKindPolicy([1], [4])).toEqual({ mode: "allowlist", kinds: [1] });
  });
});

describe("GATE_KIND_OPTIONS", () => {
  it("offers reader vocabulary with the kinds it governs", () => {
    const posts = GATE_KIND_OPTIONS.find((o) => o.label === "Short posts");
    expect(posts?.kinds).toContain(1);
    for (const o of GATE_KIND_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.kinds.length).toBeGreaterThan(0);
    }
  });
});

describe("formatKindList (one label per category, kinds grouped)", () => {
  it("groups kinds under their shared label", () => {
    expect(formatKindList([4, 1059])).toBe("Private messages (4, 1059)");
    expect(formatKindList([1, 4, 1059])).toBe("Short posts (1), Private messages (4, 1059)");
  });
  it("falls back to the bare kind for unknown numbers", () => {
    expect(formatKindList([31337])).toBe("Kind 31337");
  });
});
