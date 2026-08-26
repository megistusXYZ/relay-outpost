/**
 * The in-app history index — what makes Back safe in a PWA.
 *
 * THE BUG THIS REPLACES. Both back paths (the header button and the edge
 * swipe) decided with `window.history.length > 1`. Per MDN, `length` counts
 * the ENTIRE tab session — entries from before the app, and forward entries;
 * it never shrinks. So the app called history.back() when the previous entry
 * was not ours: in a browser tab that leaves to the referrer, and in a
 * standalone PWA it pops into the void — reported as "the screen glitches and
 * flickers and or goes blank on mobile pwa".
 *
 * THE MODEL (X-style, via History.state): every entry the app creates carries
 * a monotonically increasing index in history.state. pushState increments it;
 * replaceState carries it forward (a tab switch replaces, so tabs never
 * deepen the stack — same as X). Back is allowed ONLY when the index says the
 * previous entry is ours. The index survives reloads and bfcache because it
 * lives in the entry itself — exactly what history.state is for.
 */
import { describe, it, expect } from "vitest";
import {
  readAppIndex,
  stampState,
  installAppHistory,
  appHistoryIndex,
  canGoBackInApp,
  APP_HISTORY_KEY,
} from "./app-history";

/** A minimal history double that behaves like the real one for state. */
function fakeHistory(initialState: unknown = null) {
  const entries: unknown[] = [initialState];
  let cursor = 0;
  const h = {
    get state() { return entries[cursor]; },
    pushState(data: unknown) { entries.splice(cursor + 1); entries.push(data); cursor++; },
    replaceState(data: unknown) { entries[cursor] = data; },
    /** test-only: simulate the browser's Back (popstate) */
    _back() { if (cursor > 0) cursor--; },
    _entries: entries,
  };
  return h;
}

describe("stampState / readAppIndex (pure)", () => {
  it("stamps a null state without inventing other fields", () => {
    expect(stampState(null, 3)).toEqual({ [APP_HISTORY_KEY]: 3 });
    expect(readAppIndex(stampState(null, 3))).toBe(3);
  });

  it("preserves the caller's own state fields — scroll-restore's _scrollToken rides in the same object", () => {
    const s = stampState({ _scrollToken: "abc" }, 2) as Record<string, unknown>;
    expect(s._scrollToken).toBe("abc");
    expect(readAppIndex(s)).toBe(2);
  });

  it("reads null from foreign or unstamped state, never a fake zero", () => {
    // null means "not ours" — the boot stamp and canGoBack both hang on the
    // distinction between unstamped and genuinely index-zero.
    expect(readAppIndex(null)).toBeNull();
    expect(readAppIndex(undefined)).toBeNull();
    expect(readAppIndex({ other: 1 })).toBeNull();
    expect(readAppIndex("someString")).toBeNull();
    expect(readAppIndex(42)).toBeNull();
  });
});

describe("installAppHistory", () => {
  it("stamps the boot entry as index 0 — the entry BEFORE the app is never claimed", () => {
    const h = fakeHistory(null);
    installAppHistory(h as any);
    expect(readAppIndex(h.state)).toBe(0);
    expect(canGoBackInApp(h as any)).toBe(false);
  });

  it("increments on push, carries on replace — tabs replace, details push, like X", () => {
    const h = fakeHistory(null);
    installAppHistory(h as any);
    h.pushState({}, "", "/thread/abc");           // open a detail
    expect(appHistoryIndex(h as any)).toBe(1);
    h.replaceState(null, "", "/messages");        // switch a tab (replace)
    expect(appHistoryIndex(h as any)).toBe(1);    // no deeper
    h.pushState(null, "", "/profile/x");
    expect(appHistoryIndex(h as any)).toBe(2);
    expect(canGoBackInApp(h as any)).toBe(true);
  });

  it("a replaceState(null) — the strip-a-query-param idiom — does not destroy the index", () => {
    // RSSFeed and AudioFeed strip handled params with replaceState(null, "", url).
    // Before the patch that wiped history.state entirely; the index must survive.
    const h = fakeHistory(null);
    installAppHistory(h as any);
    h.pushState(null, "", "/news?item=x");
    h.replaceState(null, "", "/news");
    expect(appHistoryIndex(h as any)).toBe(1);
  });

  it("after going back to the boot entry, canGoBack is false again — Back never pops out of the app", () => {
    const h = fakeHistory(null);
    installAppHistory(h as any);
    h.pushState(null, "", "/a");
    h._back();
    expect(canGoBackInApp(h as any)).toBe(false);
  });

  it("replaceState(null) preserves the PREVIOUS entry's fields — _scrollToken must survive a param strip", () => {
    // The param-strip idiom (replaceState(null, "", url)) runs on entries that
    // scroll-restore has already stamped with _scrollToken. Stamping ONLY our
    // index onto the null state destroyed the token, and use-scroll-restore
    // hard-returns on a missing token — so back-to-that-entry landed at the
    // top. A replace is an edit of the SAME entry; its state carries forward.
    const h = fakeHistory(null);
    installAppHistory(h as any);
    h.pushState({ _scrollToken: "tok-1" }, "", "/news?item=x");
    h.replaceState(null, "", "/news");
    expect((h.state as Record<string, unknown>)._scrollToken).toBe("tok-1");
    expect(readAppIndex(h.state)).toBe(1);
  });

  it("replaceState with an EXPLICIT object still lets the caller win on their own keys", () => {
    const h = fakeHistory(null);
    installAppHistory(h as any);
    h.pushState({ _scrollToken: "tok-1", mine: 1 }, "", "/a");
    h.replaceState({ mine: 2 }, "", "/a");
    const st = h.state as Record<string, unknown>;
    expect(st.mine).toBe(2);
    expect(st._scrollToken).toBe("tok-1");
    expect(readAppIndex(st)).toBe(1);
  });

  it("respects an already-stamped entry on re-install (reload restores state) and does not double-patch", () => {
    const h = fakeHistory({ [APP_HISTORY_KEY]: 4, _scrollToken: "t" });
    installAppHistory(h as any);
    installAppHistory(h as any); // second install must be a no-op
    expect(appHistoryIndex(h as any)).toBe(4);   // reload kept the depth
    h.pushState(null, "", "/b");
    expect(appHistoryIndex(h as any)).toBe(5);   // +1, not +2 from double-patch
  });
});
