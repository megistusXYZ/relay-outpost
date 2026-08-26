import { describe, it, expect } from "vitest";
import { normalizeBlossomUrl } from "./blossom-url";

describe("normalizeBlossomUrl", () => {
  it("rejects empty / whitespace-only input", () => {
    expect(normalizeBlossomUrl("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeBlossomUrl("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("defaults a bare host to https://", () => {
    expect(normalizeBlossomUrl("blossom.example.com")).toEqual({
      ok: true,
      url: "https://blossom.example.com",
    });
  });

  it("preserves an explicit https:// scheme", () => {
    expect(normalizeBlossomUrl("https://cdn.example.com")).toEqual({
      ok: true,
      url: "https://cdn.example.com",
    });
  });

  it("preserves an explicit http:// scheme (does not force https)", () => {
    expect(normalizeBlossomUrl("http://localhost:3000")).toEqual({
      ok: true,
      url: "http://localhost:3000",
    });
  });

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeBlossomUrl("  blossom.example.com  ")).toEqual({
      ok: true,
      url: "https://blossom.example.com",
    });
  });

  it("rejects a scheme with no host", () => {
    expect(normalizeBlossomUrl("https://")).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps a path/port on the normalized url", () => {
    expect(normalizeBlossomUrl("media.example.com:8080/upload")).toEqual({
      ok: true,
      url: "https://media.example.com:8080/upload",
    });
  });
});
