/**
 * Follower counts for a screenful of authors come from Primal in a few
 * batched asks, not one ask per person.
 *
 * Measured on production 2026-10-04: one guest visit sent 262 separate
 * `user_profile` requests in 15 s (one per author the Discover ranking wanted
 * a follower count for), queued 8 at a time in front of every other Primal
 * read. `user_infos` takes many pubkeys and answers with one kind-10000133
 * event mapping each to its follower count.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const pk = (i: number) => i.toString(16).padStart(64, "0");
const sent: any[] = [];

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) {
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 1);
  }
  send(raw: string) {
    const msg = JSON.parse(raw);
    if (msg[0] !== "REQ") return;
    sent.push(msg[2]);
    const [verb, args] = msg[2].cache ?? [];
    const reply = (ev: object) => this.onmessage?.({ data: JSON.stringify(["EVENT", msg[1], ev]) });
    setTimeout(() => {
      if (verb === "user_infos") {
        // Primal answers for who it knows; pubkey 7 it has never seen.
        const counts = Object.fromEntries((args.pubkeys as string[]).filter((p) => p !== pk(7)).map((p) => [p, parseInt(p, 16) * 10]));
        reply({ kind: 10000133, content: JSON.stringify(counts), tags: [], created_at: 1, pubkey: "", id: "", sig: "" });
      }
      this.onmessage?.({ data: JSON.stringify(["EOSE", msg[1]]) });
    }, 2);
  }
  close() { this.readyState = 3; }
}

describe("follower counts from Primal", () => {
  beforeAll(() => { vi.stubGlobal("WebSocket", FakeSocket); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it("120 authors take three asks, and every count Primal gave is there", async () => {
    const { requestFollowerCounts, getCachedFollowerCount, onFollowerCountUpdate } = await import("./primal-cache");
    const authors = Array.from({ length: 120 }, (_, i) => pk(i + 1));
    let updates = 0;
    onFollowerCountUpdate(() => { updates++; });
    requestFollowerCounts(authors);
    await new Promise((r) => setTimeout(r, 2500));

    const asks = sent.filter((f) => f.cache);
    expect(asks.length).toBe(3);
    expect(asks.every((f) => f.cache[0] === "user_infos")).toBe(true);
    expect(getCachedFollowerCount(pk(1))).toBe(10);
    expect(getCachedFollowerCount(pk(120))).toBe(1200);
    expect(updates).toBeGreaterThan(0);
  }, 10_000);

  it("someone Primal didn't answer for has no count — not a made-up zero — and isn't asked again at once", async () => {
    const { getCachedFollowerCount, requestFollowerCounts } = await import("./primal-cache");
    expect(getCachedFollowerCount(pk(7))).toBeUndefined();
    const before = sent.length;
    requestFollowerCounts([pk(7), pk(8)]);
    await new Promise((r) => setTimeout(r, 800));
    expect(sent.length).toBe(before);
  });
});
