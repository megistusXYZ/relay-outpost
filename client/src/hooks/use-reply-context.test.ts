import { describe, it, expect, beforeEach } from "vitest";
import { readReplyContext, setReplyContext } from "./use-reply-context";

const KEY = "relay-outpost-reply-context";

function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as { window?: unknown }).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return store;
}

describe("reply-context preference", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it("is ON with nothing stored", () => {
    // A reply without its context is a fragment; showing it is the default.
    expect(store.has(KEY)).toBe(false);
    expect(readReplyContext()).toBe(true);
  });

  it('only a literal "0" turns it off', () => {
    setReplyContext(false);
    expect(store.get(KEY)).toBe("0");
    expect(readReplyContext()).toBe(false);
  });

  it("round-trips back on", () => {
    setReplyContext(false);
    setReplyContext(true);
    expect(readReplyContext()).toBe(true);
  });

  it("fails OPEN on anything corrupt", () => {
    // An absent or damaged value is someone who never chose — not an opt-out.
    for (const junk of ["", "1", "true", "false", "off", "{}", " 0"]) {
      store.set(KEY, junk);
      expect(readReplyContext(), `stored ${JSON.stringify(junk)}`).toBe(true);
    }
  });

  it("treats unreadable storage as ON", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
    };
    expect(readReplyContext()).toBe(true);
  });
});
