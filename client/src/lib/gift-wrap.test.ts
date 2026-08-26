// Covers the pure NIP-17 helpers: file-metadata extraction (NIP-15 tags) and the
// in-memory decrypt-once ledger that stops paranoid (NIP-46) signers being re-prompted.

import { describe, it, expect, beforeEach, vi } from "vitest";

// gift-wrap.ts imports dm-cache, which touches IndexedDB at load. Stub it.
vi.mock("@/lib/dm-cache", () => ({
  getProcessedWrapIds: vi.fn(async () => ["wrap-a", "wrap-b"]),
  markProcessed: vi.fn(async () => {}),
}));

import {
  extractFileMetadata,
  isWrapProcessed,
  seedProcessedWraps,
  clearProcessedWraps,
  KIND_FILE_MESSAGE,
  KIND_RUMOR,
} from "./gift-wrap";

describe("extractFileMetadata", () => {
  it("returns undefined for a non-file rumor (kind 14 chat)", () => {
    expect(extractFileMetadata({ kind: KIND_RUMOR, content: "hi", tags: [] })).toBeUndefined();
  });

  it("returns undefined for a file rumor with no url/content", () => {
    expect(extractFileMetadata({ kind: KIND_FILE_MESSAGE, content: "", tags: [] })).toBeUndefined();
  });

  it("parses NIP-15 tags (mime, size→int, dim, blurhash, hash)", () => {
    const md = extractFileMetadata({
      kind: KIND_FILE_MESSAGE,
      content: "https://cdn.example/x.jpg",
      tags: [
        ["m", "image/jpeg"],
        ["size", "20480"],
        ["dim", "800x600"],
        ["blurhash", "LKO2"],
        ["x", "deadbeef"],
      ],
    });
    expect(md).toEqual({
      url: "https://cdn.example/x.jpg",
      mimeType: "image/jpeg",
      size: 20480,
      dim: "800x600",
      blurhash: "LKO2",
      originalHash: "deadbeef",
    });
  });

  it("falls back to the file-type tag when m is absent", () => {
    const md = extractFileMetadata({
      kind: KIND_FILE_MESSAGE,
      content: "https://cdn.example/x.webp",
      tags: [["file-type", "image/webp"]],
    });
    expect(md?.mimeType).toBe("image/webp");
  });

  it("is robust to a missing tags array (only url set)", () => {
    const md = extractFileMetadata({ kind: KIND_FILE_MESSAGE, content: "https://cdn.example/x.png" });
    expect(md?.url).toBe("https://cdn.example/x.png");
    expect(md?.mimeType).toBeUndefined();
    expect(md?.size).toBeUndefined();
  });
});

describe("decrypt-once ledger", () => {
  beforeEach(() => clearProcessedWraps());

  it("starts empty", () => {
    expect(isWrapProcessed("wrap-a")).toBe(false);
  });

  it("marks ids processed after seeding from the persistent ledger", async () => {
    await seedProcessedWraps("owner-pubkey");
    expect(isWrapProcessed("wrap-a")).toBe(true);
    expect(isWrapProcessed("wrap-b")).toBe(true);
    expect(isWrapProcessed("wrap-unknown")).toBe(false);
  });

  it("clearProcessedWraps drops the in-memory set (account switch)", async () => {
    await seedProcessedWraps("owner-pubkey");
    clearProcessedWraps();
    expect(isWrapProcessed("wrap-a")).toBe(false);
  });

  it("seedProcessedWraps is a no-op for an empty owner", async () => {
    await seedProcessedWraps("");
    expect(isWrapProcessed("wrap-a")).toBe(false);
  });
});
