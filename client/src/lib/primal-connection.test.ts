/**
 * A refused Primal host must not hang every Primal-backed read.
 *
 * Found in the 2026-09-28 performance QA: on production the Discover Feed tile
 * stayed on its skeleton for 4+ minutes for every visitor. cache.primal.net
 * was refusing connections (503), and a refused WebSocket fires `error` then
 * `close`. The error handler cleared the connect timeout and the close handler
 * never settled the connect promise, so ensureConnection() waited forever and
 * never reached cache2.primal.net, the host the list exists to fall back to.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const REFUSING = "wss://cache.primal.net/v1";

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) {
    setTimeout(() => {
      if (url === REFUSING) {
        // What a 503 on the upgrade looks like from the page.
        this.readyState = 3;
        this.onerror?.();
        this.onclose?.();
      } else {
        this.readyState = 1;
        this.onopen?.();
      }
    }, 5);
  }
  send(raw: string) {
    const msg = JSON.parse(raw);
    if (msg[0] !== "REQ") return;
    const subId = msg[1];
    const post = { id: "a".repeat(64), kind: 1, pubkey: "b".repeat(64), created_at: 1_790_000_000, content: "hello from the second host", tags: [], sig: "c".repeat(128) };
    setTimeout(() => {
      this.onmessage?.({ data: JSON.stringify(["EVENT", subId, post]) });
      this.onmessage?.({ data: JSON.stringify(["EOSE", subId]) });
    }, 5);
  }
  close() { this.readyState = 3; }
}

describe("Primal cache connection", () => {
  beforeAll(() => { vi.stubGlobal("WebSocket", FakeSocket); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it("a refused first host falls through to the next one instead of hanging", async () => {
    const { fetchGlobalFeed } = await import("./primal-cache");
    const outcome = await Promise.race([
      fetchGlobalFeed(10).then((r) => r.posts.map((p) => p.content)),
      new Promise<string>((r) => setTimeout(() => r("still waiting after 6s"), 6000)),
    ]);
    expect(outcome).toEqual(["hello from the second host"]);
  }, 10_000);
});
