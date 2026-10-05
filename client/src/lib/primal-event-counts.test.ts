/**
 * Like/reply/repost/zap counts for a screenful of posts come from Primal in
 * one ask per 50 posts, sent together — not five posts at a time, one after
 * another.
 *
 * Measured on production 2026-10-04 (after 1.17.0 unclogged Primal's queue):
 * 106 `events` asks of 5 ids in one guest visit's first 15 s. Measured against
 * the live cache the same day: 5 ids answer in ~0.84 s, 50 in ~1.1 s — so 50
 * posts took ~8 s as ten asks in a row, against ~1 s as one.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const id = (i: number) => i.toString(16).padStart(64, "0");
const asks: { ids: string[]; at: number }[] = [];
let answered = 0;

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 1); }
  send(raw: string) {
    const msg = JSON.parse(raw);
    if (msg[0] !== "REQ" || msg[2]?.cache?.[0] !== "events") return;
    const ids: string[] = msg[2].cache[1].event_ids;
    asks.push({ ids, at: answered });
    setTimeout(() => {
      for (const e of ids) this.onmessage?.({ data: JSON.stringify(["EVENT", msg[1], { kind: 10000100, content: JSON.stringify({ event_id: e, likes: parseInt(e, 16), replies: 1 }), tags: [], id: "", pubkey: "", created_at: 1, sig: "" }]) });
      this.onmessage?.({ data: JSON.stringify(["EOSE", msg[1]]) });
      answered++;
    }, 20);
  }
  close() { this.readyState = 3; }
}

describe("post counts from Primal", () => {
  beforeAll(() => { vi.stubGlobal("WebSocket", FakeSocket); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it("fifty posts are one ask", async () => {
    const { fetchEventCounts } = await import("./primal-cache");
    asks.length = 0;
    const got = await fetchEventCounts(Array.from({ length: 50 }, (_, i) => id(i + 1)));
    expect(asks).toHaveLength(1);
    expect(got[id(7)]).toMatchObject({ likes: 7, replies: 1 });
  });

  it("more than fifty are asked for together, not one batch after another", async () => {
    const { fetchEventCounts } = await import("./primal-cache");
    asks.length = 0; answered = 0;
    const got = await fetchEventCounts(Array.from({ length: 120 }, (_, i) => id(i + 1000)));
    expect(asks).toHaveLength(3);
    expect(asks.every((a) => a.at === 0)).toBe(true); // all sent before the first answer came back
    expect(Object.keys(got)).toHaveLength(120);
  });
});
