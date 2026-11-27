/**
 * Has the iPhone home-screen app had a session yet (lib/app-launch.ts)? The
 * first time it opens without one, the sign-in screen starts at "reconnect"
 * (that app keeps its own storage, apart from Safari) instead of looking
 * like a stranger's first visit. A desktop or Android installed app shares
 * the browser's storage and is treated as the tab. Once it has had a session, signing out
 * leads to the usual choice.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { isFirstAppLaunch, markAppSignedIn } from "./app-launch";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
  };
}

let store: Storage;
beforeEach(() => { store = memoryStorage(); });

describe("isFirstAppLaunch", () => {
  it("true in the home-screen app until a session has been seen there", () => {
    expect(isFirstAppLaunch({ iosApp: true, storage: store })).toBe(true);
    markAppSignedIn({ iosApp: true, storage: store });
    expect(isFirstAppLaunch({ iosApp: true, storage: store })).toBe(false);
  });
  it("never in a browser tab or a desktop installed app, and a session there doesn't count for the home-screen app", () => {
    expect(isFirstAppLaunch({ iosApp: false, storage: store })).toBe(false);
    markAppSignedIn({ iosApp: false, storage: store });
    expect(isFirstAppLaunch({ iosApp: true, storage: store })).toBe(true);
  });
  it("blocked storage: treat it as a first launch, never throw", () => {
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } as unknown as Storage;
    expect(isFirstAppLaunch({ iosApp: true, storage: blocked })).toBe(true);
    expect(() => markAppSignedIn({ iosApp: true, storage: blocked })).not.toThrow();
  });
});
