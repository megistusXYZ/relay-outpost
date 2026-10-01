import { describe, it, expect } from "vitest";
import { isCallActive, setCallActive } from "./call-presence";

describe("call presence", () => {
  it("is off until a room is joined, and off again once it is left", () => {
    expect(isCallActive()).toBe(false);
    setCallActive(true);
    expect(isCallActive()).toBe(true);
    setCallActive(false);
    expect(isCallActive()).toBe(false);
  });
});
