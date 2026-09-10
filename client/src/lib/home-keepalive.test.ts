/**
 * The Home keep-alive rules (lib/home-keepalive.ts) — the decidable half of
 * "back returns to the exact timeline position".
 *
 * Measured 2026-09-10 before this existed: every back REMOUNTED the feed and
 * rebuilt an approximation of it — desktop painted a wrong first frame (up to
 * 857px off) and intermittently settled 43px off; the iPhone path (plain list)
 * settled 42px off and lurched up to 660px per scroll-up step (remounted rows
 * lose their remembered content-visibility sizes; WebKit has no scroll
 * anchoring to hide it). Keeping Home mounted while its history entry is
 * below the current one means nothing is rebuilt, so there is nothing to
 * approximate.
 */
import { describe, expect, it } from "vitest";
import { nextHomeLayer, shouldGenericRestoreStandDown, MAX_KEEPALIVE_DEPTH, type NavPoint } from "./home-keepalive";

const at = (path: string, token: string | null, idx: number): NavPoint => ({ path, token, idx });

describe("nextHomeLayer — which Home instance exists, and is it visible", () => {
  it("a Home entry survives a push to a thread and is revealed — same instance — on back", () => {
    const onHome = nextHomeLayer(null, at("/", "home", 3));
    expect(onHome.instance).not.toBeNull();
    expect(onHome.visible).toBe(true);

    const onThread = nextHomeLayer(onHome.instance, at("/thread/note1x", "thread", 4));
    expect(onThread.instance?.key).toBe(onHome.instance!.key);
    expect(onThread.visible).toBe(false);

    const backHome = nextHomeLayer(onThread.instance, at("/", "home", 3));
    expect(backHome.instance?.key).toBe(onHome.instance!.key);
    expect(backHome.visible).toBe(true);
  });

  it("the scroll token arriving a render late adopts it — it must not remount Home", () => {
    // _scrollToken is minted in a layout effect AFTER Home's first render, so
    // the first render sees null; the next render at the same entry sees it.
    const first = nextHomeLayer(null, at("/", null, 0));
    const second = nextHomeLayer(first.instance, at("/", "minted", 0));
    expect(second.instance?.key).toBe(first.instance!.key);
    expect(second.instance?.token).toBe("minted");
    // …and the adopted token is what a later back matches against.
    const away = nextHomeLayer(second.instance, at("/thread/note1x", "t", 1));
    expect(nextHomeLayer(away.instance, at("/", "minted", 0)).instance?.key).toBe(first.instance!.key);
  });

  it("a drill-in deeper than the cap lets Home go — the generic restorer covers that return", () => {
    const home = nextHomeLayer(null, at("/", "home", 2)).instance;
    expect(nextHomeLayer(home, at("/thread/a", "t1", 2 + MAX_KEEPALIVE_DEPTH)).instance?.key).toBe(home!.key);
    expect(nextHomeLayer(home, at("/thread/b", "t2", 3 + MAX_KEEPALIVE_DEPTH)).instance).toBeNull();
  });
});

describe("shouldGenericRestoreStandDown — one writer per return", () => {
  it("stands down only for a back onto the kept-alive, still-hidden Home entry", () => {
    const home = nextHomeLayer(null, at("/", "home", 3));
    const hiddenUnderThread = nextHomeLayer(home.instance, at("/thread/note1x", "thread", 4));
    // Back to Home's own entry: the layer reveals the same DOM — a second writer would only fight it.
    expect(shouldGenericRestoreStandDown(hiddenUnderThread, at("/", "home", 3))).toBe(true);
    // A fresh push to "/" (new token) is a new Home — the generic path owns it, as before.
    expect(shouldGenericRestoreStandDown(hiddenUnderThread, at("/", "fresh", 5))).toBe(false);
    // Moving between other pages: nothing to reveal.
    expect(shouldGenericRestoreStandDown(hiddenUnderThread, at("/profile/npub1x", "profile", 5))).toBe(false);
    // Home already showing (a same-URL modal guard entry): nothing to hand over.
    expect(shouldGenericRestoreStandDown(home, at("/", "home", 4))).toBe(false);
    // Nothing kept alive (reload, cap exceeded): the generic restorer is the only restorer.
    expect(shouldGenericRestoreStandDown(null, at("/", "home", 3))).toBe(false);
  });
});
