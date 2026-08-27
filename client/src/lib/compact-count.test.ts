import { describe, it, expect } from "vitest";
import { compactCount } from "./compact-count";

describe("compactCount (landing star count — dependency-free on purpose)", () => {
  it("keeps small numbers whole", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(999)).toBe("999");
  });
  it("compacts thousands with one decimal, trimming .0", () => {
    expect(compactCount(1000)).toBe("1k");
    expect(compactCount(1234)).toBe("1.2k");
    expect(compactCount(25400)).toBe("25.4k");
  });
  it("compacts millions", () => {
    expect(compactCount(1_500_000)).toBe("1.5M");
  });
})
