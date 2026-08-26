import { describe, it, expect } from "vitest";
import { parseGtxResponse } from "./translate";

describe("parseGtxResponse — the unofficial gtx wire shape, defensively", () => {
  it("joins multi-segment translations and reads the detected language", () => {
    const wire = [
      [
        ["Hello, world. ", "Hallo, Welt. ", null, null],
        ["How are you?", "Wie geht's?", null, null],
      ],
      null,
      "de",
    ];
    expect(parseGtxResponse(wire)).toEqual({ text: "Hello, world. How are you?", from: "de" });
  });

  it("falls back to 'und' when no detected language is present", () => {
    expect(parseGtxResponse([[["Hi", "Salut"]]])).toEqual({ text: "Hi", from: "und" });
  });

  it("returns null on unexpected shapes (unofficial endpoint may change)", () => {
    expect(parseGtxResponse(null)).toBeNull();
    expect(parseGtxResponse({})).toBeNull();
    expect(parseGtxResponse([])).toBeNull();
    expect(parseGtxResponse(["nope"])).toBeNull();
    expect(parseGtxResponse([[["", ""]], null, "de"])).toBeNull(); // empty translation
  });

  it("skips malformed segments instead of crashing", () => {
    expect(parseGtxResponse([[["Good ", "Gut "], null, ["morning", "Morgen"]], null, "de"]))
      .toEqual({ text: "Good morning", from: "de" });
  });
});
