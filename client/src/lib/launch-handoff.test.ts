import { describe, it, expect } from "vitest";
import { createLaunchHandoff } from "./launch-handoff";

function rig() {
  let now = 0; const timers: { at: number; fn: () => void }[] = []; let hidden = 0;
  const h = createLaunchHandoff({
    hide: () => { hidden++; },
    capMs: 6000,
    now: () => now,
    setTimer: (fn, ms) => { timers.push({ at: now + ms, fn }); },
  });
  const advance = (ms: number) => { now += ms; for (const t of timers.splice(0)) { if (t.at <= now) t.fn(); else timers.push(t); } };
  return { h, advance, hidden: () => hidden };
}

describe("the launch screen hands over to the app", () => {
  it("lifts as soon as the app is up when nothing is still loading", () => {
    const r = rig();
    r.h.appReady();
    expect(r.hidden()).toBe(1);
  });

  it("stays up while the page shows only its loader, and lifts when the page arrives", () => {
    const r = rig();
    const off = r.h.loaderShown();
    r.h.appReady();
    expect(r.hidden()).toBe(0);
    r.advance(1500);
    off();
    expect(r.hidden()).toBe(1);
  });

  it("waits for every loader, not just the first", () => {
    const r = rig();
    const a = r.h.loaderShown();
    const b = r.h.loaderShown();
    r.h.appReady();
    a();
    expect(r.hidden()).toBe(0);
    b();
    expect(r.hidden()).toBe(1);
  });

  it("never holds longer than its cap — a page that never loads still gets the app's own error or loader", () => {
    const r = rig();
    r.h.loaderShown();
    r.h.appReady();
    r.advance(5999);
    expect(r.hidden()).toBe(0);
    r.advance(1);
    expect(r.hidden()).toBe(1);
  });

  it("lifts once, whatever happens after", () => {
    const r = rig();
    r.h.appReady();
    const off = r.h.loaderShown();
    off();
    r.h.appReady();
    r.advance(10000);
    expect(r.hidden()).toBe(1);
  });

  it("does nothing before the app says it is up", () => {
    const r = rig();
    const off = r.h.loaderShown();
    off();
    expect(r.hidden()).toBe(0);
  });
});
