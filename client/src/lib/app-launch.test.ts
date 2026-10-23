/**
 * Has the installed app had a session yet (lib/app-launch.ts)? The first
 * time it opens without one, the sign-in screen starts at "reconnect" (on
 * iOS the app keeps its own storage, apart from Safari) instead of looking
 * like a stranger's first visit. Once it has had a session, signing out
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
  it("true in the installed app until a session has been seen there", () => {
    expect(isFirstAppLaunch({ standalone: true, storage: store })).toBe(true);
    markAppSignedIn({ standalone: true, storage: store });
    expect(isFirstAppLaunch({ standalone: true, storage: store })).toBe(false);
  });
  it("never in a browser tab, and a session in a tab doesn't count for the app", () => {
    expect(isFirstAppLaunch({ standalone: false, storage: store })).toBe(false);
    markAppSignedIn({ standalone: false, storage: store });
    expect(isFirstAppLaunch({ standalone: true, storage: store })).toBe(true);
  });
  it("blocked storage: treat it as a first launch, never throw", () => {
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } as unknown as Storage;
    expect(isFirstAppLaunch({ standalone: true, storage: blocked })).toBe(true);
    expect(() => markAppSignedIn({ standalone: true, storage: blocked })).not.toThrow();
  });
});
