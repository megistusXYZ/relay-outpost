/**
 * lib/storage-write-hook.ts — hear localStorage writes on every engine.
 *
 * Found 2026-09-10 in real WebKit (iOS Simulator Safari): nip78-settings.ts
 * replaced the methods by ASSIGNMENT (`localStorage.setItem = fn`). Storage
 * has a named property setter, so per WebIDL that assignment stores an ITEM
 * called "setItem" holding the function's source and leaves the real method
 * in place. WebKit did exactly that — every origin had "setItem"/"removeItem"
 * items — so settings changes never triggered cross-device sync on Safari.
 * Chromium defines an own property instead, which hid it.
 *
 * `specStorageClass` models the spec: a string-keyed assignment on an instance
 * is the named setter, never an own property.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nativeSetItem, setStorageWriteListener } from "./storage-write-hook";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function specStorageClass() {
  const itemsOf = new WeakMap<object, Map<string, string>>();
  const items = (s: object) => itemsOf.get(s)!;
  class SpecStorage {
    get length() { return items(this).size; }
    key(i: number) { return [...items(this).keys()][i] ?? null; }
    getItem(k: string) { return items(this).get(String(k)) ?? null; }
    setItem(k: string, v: string) { items(this).set(String(k), String(v)); }
    removeItem(k: string) { items(this).delete(String(k)); }
  }
  return function make(): { storage: Storage; items: Map<string, string> } {
    const map = new Map<string, string>();
    const storage = new Proxy(new SpecStorage(), {
      set(_target, prop, value) {
        if (typeof prop !== "string") return false;
        map.set(prop, String(value));
        return true;
      },
    });
    itemsOf.set(storage, map);
    return { storage: storage as unknown as Storage, items: map };
  };
}

describe("storage-write-hook — writes are heard without assigning over Storage methods", () => {
  it("the model reproduces the Safari failure: assignment stores an item and the hook never runs", () => {
    const { storage, items } = specStorageClass()();
    let calls = 0;
    (storage as unknown as Record<string, unknown>).setItem = () => { calls++; };
    storage.setItem("relay-outpost-theme", "dark");
    expect(calls).toBe(0);
    expect(items.has("setItem")).toBe(true);
    expect(storage.getItem("relay-outpost-theme")).toBe("dark");
  });

  it("a listener hears setItem and removeItem, and the writes still land", () => {
    const { storage } = specStorageClass()();
    const heard: string[] = [];
    setStorageWriteListener(storage, "test", (op, key) => heard.push(`${op}:${key}`));
    storage.setItem("relay-outpost-theme", "dark");
    expect(storage.getItem("relay-outpost-theme")).toBe("dark");
    storage.removeItem("relay-outpost-theme");
    expect(storage.getItem("relay-outpost-theme")).toBeNull();
    expect(heard).toEqual(["set:relay-outpost-theme", "remove:relay-outpost-theme"]);
  });

  it("another Storage sharing the prototype (sessionStorage) is not reported", () => {
    const make = specStorageClass();
    const local = make().storage;
    const session = make().storage;
    const heard: string[] = [];
    setStorageWriteListener(local, "test", (_op, key) => heard.push(key));
    session.setItem("draft", "x");
    local.setItem("relay-outpost-theme", "dark");
    expect(heard).toEqual(["relay-outpost-theme"]);
    expect(session.getItem("draft")).toBe("x");
  });

  it("re-registering the same id replaces the listener — a hot reload never double-fires", () => {
    const { storage } = specStorageClass()();
    let first = 0;
    let second = 0;
    setStorageWriteListener(storage, "nip78", () => { first++; });
    setStorageWriteListener(storage, "nip78", () => { second++; });
    storage.setItem("k", "v");
    expect([first, second]).toEqual([0, 1]);
  });

  it("clears the junk items the old assignment left behind, and nothing else", () => {
    const { storage, items } = specStorageClass()();
    items.set("setItem", "function (key, value) {…}");
    items.set("removeItem", "function (key) {…}");
    items.set("relay-outpost-theme", "dark");
    setStorageWriteListener(storage, "test", () => {});
    expect([...items.keys()]).toEqual(["relay-outpost-theme"]);
  });

  it("no client code assigns over a Storage method (the pattern that failed on Safari)", () => {
    const files = sourceFiles(join(__dirname, ".."));
    expect(files.length).toBeGreaterThan(300);
    const assignment = /\b(?:localStorage|sessionStorage|Storage\.prototype)\.(?:setItem|removeItem|getItem|clear|key)\s*=(?!=)/;
    const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
    const offenders = files.filter((f) => assignment.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("nativeSetItem writes without notifying", () => {
    const { storage } = specStorageClass()();
    let calls = 0;
    setStorageWriteListener(storage, "test", () => { calls++; });
    nativeSetItem(storage, "relay-outpost-settings-ts:abc", "123");
    expect(storage.getItem("relay-outpost-settings-ts:abc")).toBe("123");
    expect(calls).toBe(0);
  });
});
