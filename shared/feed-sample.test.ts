/**
 * The Feed tile's recent sample: the newest notes from anyone on the fast
 * relays, of which only trusted people's are ever shown. Measured 2026-09-30:
 * 300 notes per relay (0.6 MB on snort, 3 MB on primal) held about 40 notes
 * by trusted people, and with Primal's trending down those were the only
 * source of the tile's three posts. So the sample stays as wide as it was;
 * the server takes it once and keeps the trusted part (server/feed-sample.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { trustedNotes, isNote, FEED_SAMPLE_RELAYS, FEED_SAMPLE_MAX_NOTES } from "./feed-sample";

const hex = (c: string, n = 64) => c.repeat(n);
const ALICE = hex("a");
const BOB = hex("b");
const note = (id: string, pubkey: string, created_at: number, over: Record<string, unknown> = {}) =>
  ({ id: hex(id), pubkey, created_at, kind: 1, tags: [], content: "hello", sig: hex("f", 128), ...over });

describe("trustedNotes", () => {
  it("keeps notes by trusted people, newest first", () => {
    const out = trustedNotes([note("1", ALICE, 100), note("2", BOB, 300), note("3", ALICE, 200)], new Set([ALICE]));
    expect(out.map((e) => e.id)).toEqual([hex("3"), hex("1")]);
  });

  it("one copy of a note two relays both sent", () => {
    expect(trustedNotes([note("1", ALICE, 100), note("1", ALICE, 100)], new Set([ALICE]))).toHaveLength(1);
  });

  it("drops anything that isn't a well-formed note", () => {
    const bad = [
      note("1", ALICE, 100, { kind: 6 }),
      note("2", ALICE, 100, { sig: "short" }),
      note("3", ALICE, 100, { tags: "nope" }),
      note("4", ALICE, 100, { tags: [["e", 5]] }),
      note("5", ALICE, 100, { content: null }),
      note("6", ALICE, "now" as any),
      { ...note("7", ALICE, 100), id: "xyz" },
      null,
      "note",
    ];
    expect(trustedNotes(bad as any, new Set([ALICE]))).toEqual([]);
  });

  it("keeps the newest when there are more than the cap", () => {
    const many = Array.from({ length: FEED_SAMPLE_MAX_NOTES + 20 }, (_, i) => ({ ...note("0", ALICE, i), id: i.toString(16).padStart(64, "0") }));
    const out = trustedNotes(many, new Set([ALICE]));
    expect(out).toHaveLength(FEED_SAMPLE_MAX_NOTES);
    expect(out[0].created_at).toBe(FEED_SAMPLE_MAX_NOTES + 19);
  });
});

describe("isNote", () => {
  it("accepts a signed kind-1 note", () => {
    expect(isNote(note("1", ALICE, 100, { tags: [["t", "nostr"], ["p", BOB]] }))).toBe(true);
  });
});

describe("the relays the server samples", () => {
  it("are the app's fast relays, without damus (its read budget is per IP)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../client/src/lib/nostr.ts"), "utf8");
    const block = src.match(/export const FAST_RELAYS = \[([^\]]*)\]/)?.[1] ?? "";
    const fast = [...block.matchAll(/"(wss:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(fast.length).toBeGreaterThan(1);
    expect(FEED_SAMPLE_RELAYS).toEqual(fast.filter((r) => r !== "wss://relay.damus.io"));
  });
});
