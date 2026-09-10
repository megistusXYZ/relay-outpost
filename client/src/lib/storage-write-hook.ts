/**
 * Hear writes to one Storage object (in practice localStorage) without
 * assigning over its methods.
 *
 * Storage is a legacy platform object with a named property setter, so
 * `localStorage.setItem = fn` is, per WebIDL, a call to that setter: it stores
 * an ITEM named "setItem" holding the function's source and leaves the real
 * method in place. WebKit does exactly that, so a hook installed that way
 * silently never runs on Safari/iOS (Chromium defines an own property instead,
 * which hid it). Patching Storage.prototype is ordinary JavaScript on every
 * engine; the wrapper reports only writes made through a hooked instance, so
 * sessionStorage — same prototype — is untouched.
 */

export type StorageWriteOp = "set" | "remove";
export type StorageWriteListener = (op: StorageWriteOp, key: string) => void;

interface PrototypeHook {
  setItem: (this: Storage, key: string, value: string) => void;
  removeItem: (this: Storage, key: string) => void;
  listeners: Map<Storage, Map<string, StorageWriteListener>>;
}

/** What the old assignment-based hook left stored in every Safari profile. */
const LEFTOVER_ITEMS = ["setItem", "removeItem"];

// On globalThis so a hot reload re-evaluating this module finds the existing
// wrapper instead of wrapping the prototype a second time.
const REGISTRY_KEY = "__roStorageWriteHooks";

function registry(): WeakMap<object, PrototypeHook> {
  const g = globalThis as unknown as Record<string, WeakMap<object, PrototypeHook> | undefined>;
  return (g[REGISTRY_KEY] ??= new WeakMap());
}

function hookFor(storage: Storage): PrototypeHook {
  const proto = Object.getPrototypeOf(storage) as Storage;
  const existing = registry().get(proto);
  if (existing) return existing;

  const hook: PrototypeHook = { setItem: proto.setItem, removeItem: proto.removeItem, listeners: new Map() };
  const notify = (target: Storage, op: StorageWriteOp, key: string) => {
    const forTarget = hook.listeners.get(target);
    if (!forTarget) return;
    for (const listener of forTarget.values()) {
      try { listener(op, key); } catch {}
    }
  };
  proto.setItem = function (this: Storage, key: string, value: string) {
    hook.setItem.call(this, key, value);
    notify(this, "set", String(key));
  };
  proto.removeItem = function (this: Storage, key: string) {
    hook.removeItem.call(this, key);
    notify(this, "remove", String(key));
  };
  registry().set(proto, hook);
  return hook;
}

/**
 * Register (or replace, by `id`) a listener for writes through `storage`.
 * The first registration also clears the items the old hook left behind.
 */
export function setStorageWriteListener(storage: Storage, id: string, listener: StorageWriteListener): void {
  const hook = hookFor(storage);
  let forTarget = hook.listeners.get(storage);
  if (!forTarget) {
    forTarget = new Map();
    hook.listeners.set(storage, forTarget);
  }
  forTarget.set(id, listener);
  for (const name of LEFTOVER_ITEMS) {
    try {
      if (storage.getItem(name) !== null) hook.removeItem.call(storage, name);
    } catch {}
  }
}

/** Write without notifying listeners — for bookkeeping keys a listener must not react to. */
export function nativeSetItem(storage: Storage, key: string, value: string): void {
  const hook = registry().get(Object.getPrototypeOf(storage));
  (hook ? hook.setItem : storage.setItem).call(storage, key, value);
}
