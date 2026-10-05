/**
 * A relay that refuses to connect is not dialed again moments later.
 *
 * Measured on production 2026-10-04: relay.primal.net was answering every
 * connection with a 502, and one guest visit dialed it 9 times in 15 s (no
 * request was ever sent on any of them) — different reads each asked the pool
 * for it, and the pool tried again every time. The cool-off in relay-health
 * only guarded throttledPoolSubscribe; querySync / subscribeMany / publish
 * dialed straight through. The pool itself now remembers.
 *
 * The real module, with the browser's WebSocket replaced: nostr-tools picks up
 * the global when it loads, so it's stubbed before lib/nostr is imported.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const mem = new Map<string, string>();
const shim = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
vi.stubGlobal("sessionStorage", shim);
vi.stubGlobal("localStorage", shim);

const dials = new Map<string, number>();
class RefusingSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  onopen: ((e?: unknown) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onmessage: ((e?: unknown) => void) | null = null;
  constructor(public url: string) {
    const host = new URL(url).host;
    dials.set(host, (dials.get(host) ?? 0) + 1);
    // What a 502 on the upgrade looks like from the page.
    setTimeout(() => { this.readyState = 3; this.onerror?.({}); this.onclose?.({ code: 1006, reason: "" }); }, 5);
  }
  send() {}
  close() { this.readyState = 3; }
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal("WebSocket", RefusingSocket);

let nostr: typeof import("@/lib/nostr");
beforeAll(async () => { nostr = await import("@/lib/nostr"); });

describe("a relay that refuses to connect", () => {
  it("four reads in a row dial it once", async () => {
    for (let i = 0; i < 4; i++) {
      const got = await nostr.pool.querySync(["wss://dead.qa.invalid"], { kinds: [1], limit: 1 }, { maxWait: 300 });
      expect(got).toEqual([]);
    }
    expect(dials.get("dead.qa.invalid")).toBe(1);
  }, 15_000);

  it("a publish to it doesn't dial it again either", async () => {
    const before = dials.get("dead.qa.invalid");
    const results = await Promise.allSettled(nostr.pool.publish(["wss://dead.qa.invalid"], { id: "a".repeat(64), pubkey: "b".repeat(64), created_at: 1, kind: 1, tags: [], content: "x", sig: "c".repeat(128) } as never));
    expect(results).toHaveLength(1);
    expect(dials.get("dead.qa.invalid")).toBe(before);
  }, 15_000);

  it("the network coming back lets it be tried again", async () => {
    const before = dials.get("dead.qa.invalid") ?? 0;
    nostr.forgetRefusedRelays(); // what the browser's \`online\` event does
    await nostr.pool.querySync(["wss://dead.qa.invalid"], { kinds: [1], limit: 1 }, { maxWait: 300 });
    expect(dials.get("dead.qa.invalid")).toBe(before + 1);
  }, 15_000);
});
