/**
 * Media on your relay — newlay's Blossom store (MANAGEMENT_API.md §3.14) in
 * plain words. Shapes come from the doc's listblobs / getblobstats examples.
 */
import { describe, it, expect } from "vitest";
import { describeMediaStats, readMediaPage, mediaIsOff, fileSize } from "./relay-media";
import { canDo, readSupportedMethods, UNKNOWN_CAPABILITIES } from "./relay-capabilities";

const A = "aa".repeat(32), B = "bb".repeat(32);
const SHA1 = "11".repeat(32), SHA2 = "22".repeat(32);

describe("file sizes", () => {
  it("read like a phone's storage screen", () => {
    expect(fileSize(0)).toBe("0 B");
    expect(fileSize(900)).toBe("900 B");
    expect(fileSize(1536)).toBe("1.5 KB");
    expect(fileSize(5 * 1024 * 1024)).toBe("5 MB");
    expect(fileSize(1288490189)).toBe("1.2 GB");
  });
});

describe("the summary", () => {
  const STATS = { count: 286, bytes: 1288490189, owners: 40, sealed_claims: 0, sealed_bytes: 0, media_claims: 0, media_bytes: 0, top_owners: [{ pubkey: A, count: 120, bytes: 734003200 }, { pubkey: B, count: 1, bytes: 2048 }] };
  it("says how much, and from how many people", () => {
    expect(describeMediaStats(STATS)!.summary).toBe("286 files · 1.2 GB · from 40 people");
    expect(describeMediaStats({ ...STATS, count: 1, owners: 1 })!.summary).toBe("1 file · 1.2 GB · from 1 person");
  });
  it("lists who uploads most, biggest first, in words", () => {
    expect(describeMediaStats(STATS)!.top).toEqual([
      { pubkey: A, line: "120 files · 700 MB" },
      { pubkey: B, line: "1 file · 2 KB" },
    ]);
  });
  it("is an empty store, not nothing, when there are no files", () => {
    expect(describeMediaStats({ ...STATS, count: 0, bytes: 0, owners: 0, top_owners: [] })).toEqual({ summary: "No files yet", top: [] });
  });
  it("is null for a refusal or a malformed answer", () => {
    expect(describeMediaStats(undefined)).toBeNull();
    expect(describeMediaStats({ count: "286" })).toBeNull();
  });
});

describe("a page of files", () => {
  const PAGE = {
    blobs: [
      { sha256: SHA1, size: 1234, type: "image/png", uploaded: 1700000000, url: `https://relay.example/${SHA1}.png`, owners: [{ pubkey: A, uploaded: 1700000000 }] },
      { sha256: SHA2, size: 9_000_000, type: "video/mp4", uploaded: 1700000100, url: `https://relay.example/${SHA2}.mp4`, owners: [{ pubkey: A, uploaded: 1700000100 }, { pubkey: B, uploaded: 1700000200 }] },
    ],
    next_cursor: SHA2,
  };
  it("gives each file what the screen shows: a picture or not, size, who uploaded it", () => {
    const page = readMediaPage(PAGE)!;
    expect(page.files.map((f) => ({ sha: f.sha256, kind: f.kind, size: f.size, owners: f.owners }))).toEqual([
      { sha: SHA1, kind: "image", size: "1.2 KB", owners: [A] },
      { sha: SHA2, kind: "video", size: "8.6 MB", owners: [A, B] },
    ]);
    expect(page.next).toBe(SHA2);
  });
  it("has no next page when the relay says so", () => {
    expect(readMediaPage({ ...PAGE, next_cursor: null })!.next).toBeNull();
  });
  it("keeps only web links for previews — never a data: or javascript: URL", () => {
    const page = readMediaPage({ blobs: [{ ...PAGE.blobs[0], url: "javascript:alert(1)" }], next_cursor: null })!;
    expect(page.files[0].url).toBeNull();
  });
  it("is null for a malformed answer", () => {
    expect(readMediaPage({ blobs: "x" })).toBeNull();
  });
});

describe("when the host hasn't switched media storage on", () => {
  it("is recognised from newlay's own error", () => {
    expect(mediaIsOff("blossom is disabled ([blossom] enabled = false)")).toBe(true);
    expect(mediaIsOff("unknown method: listblobs")).toBe(false);
  });
});

describe("whether to offer it", () => {
  it("only on a relay that lists reading and removing files", () => {
    const all = ["supportedmethods", "listblobs", "getblobstats", "deleteblob", "deleteblobsbyowner"];
    expect(canDo(readSupportedMethods({ result: all }), "media")).toBe(true);
    expect(canDo(readSupportedMethods({ result: all.filter((m) => m !== "deleteblob") }), "media")).toBe(false);
    expect(canDo(UNKNOWN_CAPABILITIES, "media")).toBe(false);
  });
});
