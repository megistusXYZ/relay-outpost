/**
 * The branded "back in a moment" page, client/public/maintenance.html.
 *
 * Production runs one pod with a Recreate rollout, so every deploy has a gap
 * where the ingress has no app to send traffic to, and visitors got nginx's
 * bare "502 Bad Gateway". The F5 NGINX Ingress Controller now serves this
 * file for 502/503/504 on page routes (relay-op-ops, charts/relay-outpost,
 * VirtualServer errorPages). So it must work with the app DOWN, and it must
 * pass NIC's body validation, `([^"$\\]|\\[^$])*`: no double quotes, no
 * dollar signs, no backslashes.
 *
 * And it must fit in ONE nginx config parameter: the whole body is the
 * argument of a `return` directive, and nginx refuses a parameter over its
 * 4096-byte config buffer. A 6.8KB first version was rejected on a trial
 * VirtualServer ("too long parameter") — shipped, it would have blocked every
 * ingress reload on the cluster. The chart serves the page with every
 * whitespace run collapsed to one space; `served` below is exactly that, and
 * the behaviour tests run the served script.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(join(__dirname, "../../public/maintenance.html"), "utf8");
const served = html.replace(/\s+/g, " ");

function inlineScript(): string {
  const scripts = [...served.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(scripts).toHaveLength(1);
  return scripts[0];
}

class FakeElement {
  textContent = "";
  onclick: (() => void) | null = null;
  private handlers: Array<() => void> = [];
  addEventListener(_type: string, fn: () => void) { this.handlers.push(fn); }
  click() { this.onclick?.(); for (const h of this.handlers) h(); }
}

type Answer = { ok: boolean; status: number };

function boot(answer: () => Promise<Answer>) {
  const els: Record<string, FakeElement> = { status: new FakeElement(), retry: new FakeElement() };
  const document = { getElementById: (id: string) => els[id] ?? null };
  const location = { reload: vi.fn() };
  const calls: Array<{ url: string; at: number }> = [];
  const fetch = (url: string) => { calls.push({ url, at: Date.now() }); return answer(); };
  new Function("document", "fetch", "location", "setTimeout", "clearTimeout", inlineScript())(
    document, fetch, location, setTimeout, clearTimeout,
  );
  return { els, calls, location };
}

const down = () => Promise.resolve({ ok: false, status: 502 });
const up = () => Promise.resolve({ ok: true, status: 200 });

describe("maintenance page — behaviour while the app is down", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it("reloads by itself once the app answers again", async () => {
    let n = 0;
    const { calls, location } = boot(() => (++n < 3 ? down() : up()));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(calls.every((c) => c.url === "/api/version")).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("keeps checking no more often than every 5 seconds, easing off to at most 30", async () => {
    const { calls, location } = boot(down);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300_000);
    const gaps = calls.map((c, i) => c.at - (i === 0 ? 0 : calls[i - 1].at));
    expect(gaps[0]).toBe(5_000);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(5_000);
    expect(Math.max(...gaps)).toBe(30_000);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("Try again checks right away", async () => {
    const { els, calls } = boot(down);
    els.retry.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
  });

  it("says what it is doing in a live status line", async () => {
    const { els } = boot(down);
    expect(els.status.textContent).toMatch(/\d+s/);
    expect(html).toMatch(/<[^>]*id='status'[^>]*aria-live='polite'|<[^>]*aria-live='polite'[^>]*id='status'/);
  });
});

describe("maintenance page — safe to serve from the ingress", () => {
  it("loads nothing from our server (it is down) or anyone else's", () => {
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*'(?!#|data:)/);
    expect(html).not.toMatch(/url\(\s*'?(?!data:)/);
    expect(html).not.toMatch(/<link\b|@import|https?:/);
  });

  it("passes the ingress body validation: no double quotes, dollar signs or backslashes", () => {
    expect(html).not.toMatch(/["$\\]/);
  });

  it("fits in one nginx config parameter once served, with room to spare", () => {
    // ~10% under nginx's 4096-byte buffer; the trial VirtualServer is the real proof.
    expect(Buffer.byteLength(served, "utf8")).toBeLessThan(3700);
  });

  it("survives whitespace collapsing: no comments anywhere, no line comments in the script", () => {
    expect(html).not.toMatch(/<!--/);
    expect(inlineScript()).not.toMatch(/\/\/|\/\*/);
  });

  it("can't be indexed, declares its language and a mobile viewport, and is named for the brand", () => {
    expect(html).toMatch(/<meta name='robots' content='noindex'>/);
    expect(html).toMatch(/<html lang='en'>/);
    expect(html).toMatch(/<meta name='viewport' content='width=device-width, initial-scale=1'>/);
    expect(html).toMatch(/<title>[^<]*Relay Outpost[^<]*<\/title>/);
  });
});
