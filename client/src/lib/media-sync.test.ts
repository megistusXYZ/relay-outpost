// "Sync my media" (Blossom Phase C): pure extraction from the user's events,
// localStorage checkpoint resume, and the bounded BUD-04 mirror loop.
// mirrorBlob itself is covered in blossom-media.test.ts — here it's injected.
import { describe, it, expect, vi, beforeEach } from "vitest";

// media-sync transitively imports the heavy nostr.ts graph via pool/outbox.
// Stub both so the pure logic runs in the node test env (same pattern as
// follow-list.test.ts).
vi.mock("@/lib/nostr", () => ({
  pool: { querySync: vi.fn() },
  DEFAULT_RELAYS: ["wss://relay.example"] as string[],
}));
vi.mock("@/lib/outbox", () => ({
  getUserNotesFetchRelays: () => ["wss://write.example"] as string[],
}));

// node env has no localStorage — back it with a Map (account-registry pattern).
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear(),
});

import {
  collectMediaFromEvents,
  enumerateMyMediaUrls,
  runMediaSync,
  readSyncCheckpoint,
  recordSyncResult,
  clearFailedSyncCheckpoints,
  syncCheckpointKey,
  isMirrorCapableTarget,
  mirrorFailureReason,
  MEDIA_SYNC_KINDS,
  MEDIA_SYNC_EVENT_CAP,
  type MediaSyncItem,
} from "./media-sync";
import { pool } from "@/lib/nostr";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const TARGET = "https://blossom.new-server.com";

const note = (content: string, tags: string[][] = [], kind = 1, created_at = 100): any => ({
  id: Math.random().toString(36).slice(2),
  kind,
  created_at,
  content,
  tags,
});

beforeEach(() => {
  storage.clear();
  vi.mocked(pool.querySync).mockReset();
});

// ── collectMediaFromEvents ───────────────────────────────────────────────────

describe("collectMediaFromEvents", () => {
  it("takes url + x from an imeta tag", () => {
    const ev = note("look", [["imeta", "url https://cdn.example.com/photos/cat.jpg", `x ${SHA_A}`]]);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([{ url: "https://cdn.example.com/photos/cat.jpg", sha256: SHA_A }]);
    expect(out.skippedNoHash).toBe(0);
  });

  it("derives the hash from a Blossom-style URL when imeta has no x", () => {
    const ev = note("", [["imeta", `url https://blossom.primal.net/${SHA_B}.png`]]);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([{ url: `https://blossom.primal.net/${SHA_B}.png`, sha256: SHA_B }]);
  });

  it("counts an imeta media URL with no derivable hash as skipped", () => {
    const ev = note("", [["imeta", "url https://legacy.host.com/pic.jpg"]]);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([]);
    expect(out.skippedNoHash).toBe(1);
  });

  it("includes bare content URLs with a media extension and a hash", () => {
    const ev = note(`gm https://cdn.satellite.earth/${SHA_A}.mp4`);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([{ url: `https://cdn.satellite.earth/${SHA_A}.mp4`, sha256: SHA_A }]);
  });

  it("includes extension-less content-addressed blob URLs (hash IS the media signal)", () => {
    const ev = note(`https://blossom.band/${SHA_C}`);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([{ url: `https://blossom.band/${SHA_C}`, sha256: SHA_C }]);
  });

  it("counts a media-extension content URL without a hash as skipped", () => {
    const ev = note("old pic https://i.imgur.com/abc123.jpg");
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([]);
    expect(out.skippedNoHash).toBe(1);
  });

  it("ignores non-media URLs entirely (not items, not skipped)", () => {
    const ev = note("read https://example.com/article and https://github.com/foo/bar");
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([]);
    expect(out.skippedNoHash).toBe(0);
  });

  it("reads NIP-94-style url tags paired with the event-level x tag", () => {
    const ev = note("", [["url", "https://files.example.com/download/blob"], ["x", SHA_B]], 1063);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([{ url: "https://files.example.com/download/blob", sha256: SHA_B }]);
  });

  it("dedupes by fingerprint across imeta and content, first (newest) URL wins", () => {
    const newest = note(`https://mirror.example.com/${SHA_A}.jpg`, [
      ["imeta", `url https://primary.example.com/${SHA_A}.jpg`, `x ${SHA_A}`],
    ]);
    const older = note(`repost https://third.example.com/${SHA_A}.jpg`);
    const out = collectMediaFromEvents([newest, older]);
    expect(out.items).toEqual([{ url: `https://primary.example.com/${SHA_A}.jpg`, sha256: SHA_A }]);
  });

  it("does not double-count a URL as skipped when another source fingerprinted it", () => {
    // Same URL: imeta provides x, content scan alone can't derive a hash.
    const ev = note("https://legacy.host.com/pic.jpg", [
      ["imeta", "url https://legacy.host.com/pic.jpg", `x ${SHA_A}`],
    ]);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toHaveLength(1);
    expect(out.skippedNoHash).toBe(0);
  });

  it("ignores an invalid x value and falls back to the URL hash", () => {
    const ev = note("", [["imeta", `url https://blossom.primal.net/${SHA_B}`, "x not-a-hash"]]);
    const out = collectMediaFromEvents([ev]);
    expect(out.items).toEqual([{ url: `https://blossom.primal.net/${SHA_B}`, sha256: SHA_B }]);
  });

  it("carries the capped flag through", () => {
    expect(collectMediaFromEvents([], { capped: true }).capped).toBe(true);
    expect(collectMediaFromEvents([]).capped).toBe(false);
  });
});

// ── enumerateMyMediaUrls ─────────────────────────────────────────────────────

describe("enumerateMyMediaUrls", () => {
  it("queries the media kinds, dedupes relay copies, sorts newest first", async () => {
    const evA = note(`https://blossom.band/${SHA_A}.jpg`, [], 1, 200);
    const evB = note(`https://blossom.band/${SHA_B}.jpg`, [], 1, 300);
    vi.mocked(pool.querySync).mockResolvedValue([evA, evB, { ...evA }] as any);

    const out = await enumerateMyMediaUrls("f".repeat(64));
    expect(out.scannedEvents).toBe(2);
    expect(out.items.map((i) => i.sha256)).toEqual([SHA_B, SHA_A]);
    expect(out.capped).toBe(false);

    const filter = vi.mocked(pool.querySync).mock.calls[0][1] as any;
    expect(filter.kinds).toEqual(MEDIA_SYNC_KINDS);
    expect(filter.limit).toBe(MEDIA_SYNC_EVENT_CAP);
  });

  it("marks the result capped when the event cap is hit", async () => {
    vi.mocked(pool.querySync).mockResolvedValue(
      Array.from({ length: 3 }, () => note("hi")) as any,
    );
    const out = await enumerateMyMediaUrls("f".repeat(64), { eventCap: 3 });
    expect(out.capped).toBe(true);
  });

  it("soft-fails to an empty enumeration when the pool throws", async () => {
    vi.mocked(pool.querySync).mockRejectedValue(new Error("relay down"));
    const out = await enumerateMyMediaUrls("f".repeat(64));
    expect(out.items).toEqual([]);
    expect(out.scannedEvents).toBe(0);
  });
});

// ── Checkpoints ──────────────────────────────────────────────────────────────

describe("sync checkpoints", () => {
  it("keys by normalized target origin (trailing slash / path ignored)", () => {
    expect(syncCheckpointKey("https://host.com/")).toBe(syncCheckpointKey("https://host.com"));
  });

  it("round-trips results and clears only failures on retry", () => {
    recordSyncResult(TARGET, SHA_A, { status: "ok", at: 1 });
    recordSyncResult(TARGET, SHA_B, { status: "failed", reason: "network error", at: 2 });
    expect(readSyncCheckpoint(TARGET)[SHA_A].status).toBe("ok");
    expect(readSyncCheckpoint(TARGET)[SHA_B].reason).toBe("network error");

    clearFailedSyncCheckpoints(TARGET);
    const after = readSyncCheckpoint(TARGET);
    expect(after[SHA_A]?.status).toBe("ok");
    expect(after[SHA_B]).toBeUndefined();
  });

  it("survives corrupted storage", () => {
    storage.set(syncCheckpointKey(TARGET), "{not json");
    expect(readSyncCheckpoint(TARGET)).toEqual({});
  });
});

// ── runMediaSync ─────────────────────────────────────────────────────────────

const items = (...shas: string[]): MediaSyncItem[] =>
  shas.map((sha) => ({ url: `https://source.example.com/${sha}.jpg`, sha256: sha }));

describe("runMediaSync", () => {
  it("mirrors every item and checkpoints ok results", async () => {
    const mirrorFn = vi.fn().mockResolvedValue({ ok: true });
    const result = await runMediaSync({ items: items(SHA_A, SHA_B), targetServer: TARGET, mirrorFn });
    expect(result).toMatchObject({ total: 2, ok: 2, failed: 0, alreadyDone: 0, aborted: false });
    expect(mirrorFn).toHaveBeenCalledTimes(2);
    const cp = readSyncCheckpoint(TARGET);
    expect(cp[SHA_A].status).toBe("ok");
    expect(cp[SHA_B].status).toBe("ok");
  });

  it("records failures with a short reason and keeps going", async () => {
    const mirrorFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true });
    const result = await runMediaSync({
      items: items(SHA_A, SHA_B),
      targetServer: TARGET,
      mirrorFn,
      concurrency: 1,
    });
    expect(result.ok).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      { url: `https://source.example.com/${SHA_A}.jpg`, sha256: SHA_A, reason: "server doesn't support mirroring" },
    ]);
    expect(readSyncCheckpoint(TARGET)[SHA_A]).toMatchObject({ status: "failed" });
  });

  it("resumes: checkpointed-ok blobs are skipped without calling the mirror", async () => {
    recordSyncResult(TARGET, SHA_A, { status: "ok", at: 1 });
    const mirrorFn = vi.fn().mockResolvedValue({ ok: true });
    const result = await runMediaSync({ items: items(SHA_A, SHA_B), targetServer: TARGET, mirrorFn });
    expect(mirrorFn).toHaveBeenCalledTimes(1);
    expect(mirrorFn).toHaveBeenCalledWith(
      `https://source.example.com/${SHA_B}.jpg`,
      SHA_B,
      TARGET,
      undefined,
    );
    expect(result).toMatchObject({ ok: 1, alreadyDone: 1, failed: 0, total: 2 });
  });

  it("re-attempts a previously failed blob (retry path after clearFailedSyncCheckpoints)", async () => {
    recordSyncResult(TARGET, SHA_A, { status: "failed", reason: "network error", at: 1 });
    clearFailedSyncCheckpoints(TARGET);
    const mirrorFn = vi.fn().mockResolvedValue({ ok: true });
    const result = await runMediaSync({ items: items(SHA_A), targetServer: TARGET, mirrorFn });
    expect(mirrorFn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(1);
  });

  it("skips blobs already hosted on the target origin", async () => {
    const mirrorFn = vi.fn();
    const result = await runMediaSync({
      items: [{ url: `${TARGET}/${SHA_A}.jpg`, sha256: SHA_A }],
      targetServer: TARGET,
      mirrorFn,
    });
    expect(mirrorFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ alreadyDone: 1, ok: 0, failed: 0 });
    expect(readSyncCheckpoint(TARGET)[SHA_A]).toMatchObject({ status: "ok", reason: "already on this server" });
  });

  it("reports monotonically increasing progress", async () => {
    const snapshots: number[] = [];
    const mirrorFn = vi.fn().mockResolvedValue({ ok: true });
    await runMediaSync({
      items: items(SHA_A, SHA_B, SHA_C),
      targetServer: TARGET,
      mirrorFn,
      concurrency: 1,
      onProgress: (p) => snapshots.push(p.done),
    });
    expect(snapshots[snapshots.length - 1]).toBe(3);
    for (let i = 1; i < snapshots.length; i++) expect(snapshots[i]).toBeGreaterThanOrEqual(snapshots[i - 1]);
  });

  it("stops launching new mirrors once aborted, and reports aborted", async () => {
    const controller = new AbortController();
    const mirrorFn = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { ok: true };
    });
    const result = await runMediaSync({
      items: items(SHA_A, SHA_B, SHA_C),
      targetServer: TARGET,
      mirrorFn,
      concurrency: 1,
      signal: controller.signal,
    });
    expect(mirrorFn).toHaveBeenCalledTimes(1);
    expect(result.aborted).toBe(true);
    expect(result.ok).toBe(1);
  });

  it("never throws, even when the mirror fn throws", async () => {
    const mirrorFn = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await runMediaSync({ items: items(SHA_A), targetServer: TARGET, mirrorFn });
    expect(result.failed).toBe(1);
    expect(result.failures[0].reason).toBe("network error");
  });
});

// ── Small helpers ────────────────────────────────────────────────────────────

describe("isMirrorCapableTarget", () => {
  it("rejects nostr.build (NIP-96, no /mirror) and invalid URLs", () => {
    expect(isMirrorCapableTarget("https://nostr.build")).toBe(false);
    expect(isMirrorCapableTarget("https://cdn.nostr.build")).toBe(false);
    expect(isMirrorCapableTarget("not a url")).toBe(false);
    expect(isMirrorCapableTarget("https://blossom.primal.net")).toBe(true);
  });
});

describe("mirrorFailureReason", () => {
  it("maps status codes to short human reasons", () => {
    expect(mirrorFailureReason({ ok: false, status: 404 })).toBe("server doesn't support mirroring");
    expect(mirrorFailureReason({ ok: false, status: 501 })).toBe("server doesn't support mirroring");
    expect(mirrorFailureReason({ ok: false, status: 403 })).toBe("server refused authorization");
    expect(mirrorFailureReason({ ok: false, status: 413 })).toBe("too large for this server");
    expect(mirrorFailureReason({ ok: false, status: 429 })).toBe("rate limited by server");
    expect(mirrorFailureReason({ ok: false, status: 500 })).toBe("server error (500)");
    expect(mirrorFailureReason({ ok: false })).toBe("network error");
  });
});
