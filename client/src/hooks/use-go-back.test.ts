import { describe, it, expect, afterEach, vi } from "vitest";
import { performGoBack } from "./use-go-back";
import { installAppHistory, APP_HISTORY_KEY } from "@/lib/app-history";

// performGoBack is the pure decision the useGoBack() hook delegates to. Testing
// it here (node env, no renderer) locks in the contract that replaced the PWA
// blank-screen bug: Back pops real history ONLY when the previous entry is
// provably the app's own (history.state index — see lib/app-history.ts), and a
// wouter PUSH is only ever the deep-link fallback — never used AS the back.
//
// `history.length` appears nowhere: it counts the whole tab session (pre-app
// entries, forward entries) and was exactly why Back popped into the void.

let back: ReturnType<typeof vi.fn>;

function stubWindow(state: unknown, pathname = "/thread/abc") {
  back = vi.fn();
  (globalThis as any).window = {
    history: {
      state,
      back,
      // Long tab session on purpose: length must not influence the decision.
      length: 50,
      pushState: () => {},
      replaceState: () => {},
    },
    location: { pathname },
  };
}

afterEach(() => {
  delete (globalThis as any).window;
  vi.restoreAllMocks();
});

describe("performGoBack", () => {
  it("pops real history (never PUSHes) when the previous entry is ours", () => {
    stubWindow({ [APP_HISTORY_KEY]: 2 });
    const navigate = vi.fn();

    performGoBack(navigate, "/messages");

    expect(back).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("falls back to the deep-link parent on the app's FIRST entry — even in a long tab session", () => {
    // The old `history.length > 1` check called history.back() here and left
    // the app (blank screen in a PWA). Index 0 = the boot entry; behind it is
    // not ours, whatever length says.
    stubWindow({ [APP_HISTORY_KEY]: 0 });
    const navigate = vi.fn();

    performGoBack(navigate, "/messages");

    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/messages");
  });

  it("treats an unstamped (foreign) entry like the boot entry", () => {
    stubWindow(null);
    const navigate = vi.fn();

    performGoBack(navigate, "/messages");

    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/messages");
  });

  it("defaults the fallback to \"/\" when no parent is given", () => {
    stubWindow(null);
    const navigate = vi.fn();

    performGoBack(navigate);

    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("does nothing at the app's own root — Back never pushes a page onto itself", () => {
    stubWindow(null, "/messages");
    const navigate = vi.fn();

    performGoBack(navigate, "/messages");

    expect(back).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("composes with installAppHistory end to end: push → back allowed, boot → fallback", () => {
    // The integration the header button actually lives: stamp, navigate, ask.
    const entries: unknown[] = [null];
    let cursor = 0;
    const h = {
      get state() { return entries[cursor]; },
      pushState(d: unknown) { entries.splice(cursor + 1); entries.push(d); cursor++; },
      replaceState(d: unknown) { entries[cursor] = d; },
      back: () => { if (cursor > 0) cursor--; },
      length: 50,
    };
    installAppHistory(h as any);
    (globalThis as any).window = { history: h, location: { pathname: "/thread/x" } };

    h.pushState(null, "", "/thread/x"); // detail opened from the feed
    const navigate = vi.fn();
    performGoBack(navigate, "/");       // → pops to the boot entry
    expect(cursor).toBe(0);
    expect(navigate).not.toHaveBeenCalled();

    performGoBack(navigate, "/");       // at boot → fallback, never the void
    expect(cursor).toBe(0);
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
