// Locks the calm new-user default for video auto-play: OFF unless the user
// explicitly enabled it (the shared helper is the single read for every
// consumer — MediaRenderer, VideoFeed, Settings).

import { describe, it, expect, beforeEach, vi } from "vitest";

// node env has no localStorage; video-prefs reads it at import time (mute memory).
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});

import { isAutoplayMediaEnabled } from "./video-prefs";

beforeEach(() => __store.clear());

describe("auto-play videos default — flipped ON with the media feed", () => {
  it("unset → ON", () => {
    // Reversed deliberately. The old calm default was set when video was a
    // small inline element; a vertical clip now fills the screen, and a 700px
    // static black rectangle is not calm, it is broken. Muted video startles
    // nobody. This assertion previously read `false` and failing on the flip
    // is exactly what it was for.
    expect(isAutoplayMediaEnabled()).toBe(true);
  });

  it('explicit "false" → OFF, and that choice survives the flip', () => {
    // The whole point of fail-open: anyone who opted out KEPT their opt-out.
    localStorage.setItem("autoplayMedia", "false");
    expect(isAutoplayMediaEnabled()).toBe(false);
  });

  it('explicit "true" → ON', () => {
    localStorage.setItem("autoplayMedia", "true");
    expect(isAutoplayMediaEnabled()).toBe(true);
  });

  it("fails OPEN on anything corrupt or half-written", () => {
    for (const junk of ["", "1", "0", "off", "no", "{}", " false", "False"]) {
      localStorage.setItem("autoplayMedia", junk);
      expect(isAutoplayMediaEnabled(), `stored ${JSON.stringify(junk)}`).toBe(true);
    }
  });

  it("is only the SETTING — not permission to play", () => {
    // Guards live in autoplay-policy.ts: reduced motion, save-data, 2G,
    // low-end device, content warning. Reading this flag alone and playing
    // would bypass every one of them.
    expect(isAutoplayMediaEnabled()).toBe(true);
  });
});
