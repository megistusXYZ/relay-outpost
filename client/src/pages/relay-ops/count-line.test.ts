import { describe, it, expect } from "vitest";
import { countLine } from "./count-line";

describe("how many match, said honestly", () => {
  it("an exact count", () => {
    expect(countLine({ status: "counted", count: 48210 })).toBe("48,210 match");
    expect(countLine({ status: "counted", count: 1 })).toBe("1 match");
    expect(countLine({ status: "counted", count: 0 })).toBe("None match");
  });

  it("an estimate says it's an estimate", () => {
    expect(countLine({ status: "counted", count: 48210, approximate: true })).toBe("About 48,210 match");
  });

  it("a relay that can't count says so — never a zero", () => {
    expect(countLine({ status: "unsupported" })).toBe("Totals aren't available here");
    expect(countLine({ status: "refused", reason: "auth-required: you must auth" })).toBe("Your host wouldn't count this: you must auth");
    expect(countLine({ status: "unreached" })).toBe("Couldn't reach your community to count");
  });

  it("while it's asking", () => {
    expect(countLine({ status: "counting" })).toBe("Counting…");
  });
});
