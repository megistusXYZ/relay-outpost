import { describe, it, expect } from "vitest";
import { pickHomeRelay } from "./operated-relays";

const A = { url: "wss://a.example" }, B = { url: "wss://b.example" };

describe("which relay Relays opens on", () => {
  it("the one you managed last, if you still run it", () => {
    expect(pickHomeRelay([A, B], "wss://b.example/")).toBe("wss://b.example");
  });

  it("the first you run, when the last one is no longer yours", () => {
    expect(pickHomeRelay([A, B], "wss://gone.example")).toBe("wss://a.example");
    expect(pickHomeRelay([A, B], null)).toBe("wss://a.example");
  });

  it("none, when you run none — the welcome shows instead", () => {
    expect(pickHomeRelay([], "wss://a.example")).toBeNull();
  });
});
