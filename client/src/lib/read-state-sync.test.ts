// Guards the cross-device read-state MERGE. Read-state is monotonic: you can
// never un-read something, and an older/empty remote doc must NEVER lower or
// wipe a local marker (same footgun class as the follow-list wipe).

import { describe, it, expect, beforeEach, vi } from "vitest";

// read-state-sync.ts keeps its top-level imports pure (type-only + the
// dependency-free dm-read) and lazy-imports the heavy relay graph inside its
// async I/O helpers, so the merge/collect/apply logic here imports with NO
// mocking. (The repo's vi.mock hoisting is currently broken — see
// follow-list.test.ts / gift-wrap.test.ts collection failures.)
import {
  mergeReadState,
  collectLocalState,
  applyRemoteToLocal,
  hasAnyReadMarkers,
  isReadStateDoc,
  type ReadState,
} from "./read-state-sync";
import { DM_READ_PREFIX } from "./dm-read";

// Deterministic localStorage (node env has none).
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
  key: (i: number) => Array.from(__store.keys())[i] ?? null,
  get length() { return __store.size; },
});

const PK = "a".repeat(64);
const SLUG = PK.slice(0, 16);
const NOTIF_KEY = `nostr_notif_lastseen_${SLUG}`;

function doc(partial: Partial<ReadState>): ReadState {
  return {
    version: 1,
    lastModified: 1000,
    notifLastSeen: 0,
    dmRead: {},
    ...partial,
  };
}

beforeEach(() => {
  __store.clear();
});

describe("mergeReadState — notifLastSeen is MAX", () => {
  it("raises when remote is higher", () => {
    const out = mergeReadState(doc({ notifLastSeen: 100 }), doc({ notifLastSeen: 500 }));
    expect(out.notifLastSeen).toBe(500);
  });

  it("ignores a lower remote (never regresses)", () => {
    const out = mergeReadState(doc({ notifLastSeen: 500 }), doc({ notifLastSeen: 100 }));
    expect(out.notifLastSeen).toBe(500);
  });

  it("keeps local when remote is null", () => {
    const out = mergeReadState(doc({ notifLastSeen: 500 }), null);
    expect(out.notifLastSeen).toBe(500);
  });
});

describe("mergeReadState — dmRead per-key MAX + union", () => {
  it("takes the max per key", () => {
    const out = mergeReadState(
      doc({ dmRead: { bob: 100, carol: 900 } }),
      doc({ dmRead: { bob: 500, carol: 200 } }),
    );
    expect(out.dmRead).toEqual({ bob: 500, carol: 900 });
  });

  it("unions keys present on only one side", () => {
    const out = mergeReadState(
      doc({ dmRead: { bob: 100 } }),
      doc({ dmRead: { carol: 300 } }),
    );
    expect(out.dmRead).toEqual({ bob: 100, carol: 300 });
  });

  it("NEVER deletes a local key absent from remote", () => {
    const out = mergeReadState(
      doc({ dmRead: { bob: 100, carol: 200 } }),
      doc({ dmRead: {} }),
    );
    expect(out.dmRead).toEqual({ bob: 100, carol: 200 });
  });
});

describe("mergeReadState — never-wipe / idempotent", () => {
  it("empty remote leaves everything untouched", () => {
    const local = doc({ notifLastSeen: 500, dmRead: { bob: 100 } });
    const out = mergeReadState(local, doc({ notifLastSeen: 0, dmRead: {} }));
    expect(out.notifLastSeen).toBe(500);
    expect(out.dmRead).toEqual({ bob: 100 });
  });

  it("null remote leaves everything untouched", () => {
    const local = doc({ notifLastSeen: 500, dmRead: { bob: 100 } });
    const out = mergeReadState(local, null);
    expect(out.notifLastSeen).toBe(500);
    expect(out.dmRead).toEqual({ bob: 100 });
  });

  it("is idempotent — merging the result again changes nothing", () => {
    const local = doc({ notifLastSeen: 500, dmRead: { bob: 100 } });
    const remote = doc({ notifLastSeen: 200, dmRead: { bob: 300, carol: 400 } });
    const once = mergeReadState(local, remote);
    const twice = mergeReadState(once, remote);
    expect(twice).toEqual(once);
  });
});

describe("collectLocalState — reflects current localStorage", () => {
  it("reads notif last-seen and all dm-read keys", () => {
    localStorage.setItem(NOTIF_KEY, "777");
    localStorage.setItem(`${DM_READ_PREFIX}bob`, "100");
    localStorage.setItem(`${DM_READ_PREFIX}carol`, "200");
    localStorage.setItem("unrelated-key", "999");

    const state = collectLocalState(PK);
    expect(state.notifLastSeen).toBe(777);
    expect(state.dmRead).toEqual({ bob: 100, carol: 200 });
  });

  it("is empty when nothing is stored", () => {
    const state = collectLocalState(PK);
    expect(state.notifLastSeen).toBe(0);
    expect(state.dmRead).toEqual({});
  });
});

describe("hasAnyReadMarkers — never-clobber guard", () => {
  it("is false with no markers (do not publish an empty doc)", () => {
    expect(hasAnyReadMarkers(PK)).toBe(false);
  });
  it("is true once a dm marker exists", () => {
    localStorage.setItem(`${DM_READ_PREFIX}bob`, "100");
    expect(hasAnyReadMarkers(PK)).toBe(true);
  });
  it("is true once a notif marker exists", () => {
    localStorage.setItem(NOTIF_KEY, "5");
    expect(hasAnyReadMarkers(PK)).toBe(true);
  });
});

describe("applyRemoteToLocal — hydrate as a FLOOR (raise only)", () => {
  it("raises a lower local notif value", () => {
    localStorage.setItem(NOTIF_KEY, "100");
    const changed = applyRemoteToLocal(doc({ notifLastSeen: 500 }), PK);
    expect(changed).toBe(true);
    expect(localStorage.getItem(NOTIF_KEY)).toBe("500");
  });

  it("NEVER lowers a higher local notif value", () => {
    localStorage.setItem(NOTIF_KEY, "500");
    const changed = applyRemoteToLocal(doc({ notifLastSeen: 100 }), PK);
    expect(changed).toBe(false);
    expect(localStorage.getItem(NOTIF_KEY)).toBe("500");
  });

  it("raises lower dm keys and introduces new ones, never lowering", () => {
    localStorage.setItem(`${DM_READ_PREFIX}bob`, "500");
    localStorage.setItem(`${DM_READ_PREFIX}carol`, "100");
    applyRemoteToLocal(doc({ dmRead: { bob: 200, carol: 900, dave: 50 } }), PK);
    expect(localStorage.getItem(`${DM_READ_PREFIX}bob`)).toBe("500");   // not lowered
    expect(localStorage.getItem(`${DM_READ_PREFIX}carol`)).toBe("900"); // raised
    expect(localStorage.getItem(`${DM_READ_PREFIX}dave`)).toBe("50");   // introduced
  });

  it("empty/null remote leaves local untouched (never wipes)", () => {
    localStorage.setItem(NOTIF_KEY, "500");
    localStorage.setItem(`${DM_READ_PREFIX}bob`, "100");

    expect(applyRemoteToLocal(null, PK)).toBe(false);
    expect(applyRemoteToLocal(doc({ notifLastSeen: 0, dmRead: {} }), PK)).toBe(false);

    expect(localStorage.getItem(NOTIF_KEY)).toBe("500");
    expect(localStorage.getItem(`${DM_READ_PREFIX}bob`)).toBe("100");
  });

  it("is idempotent — re-applying the same remote changes nothing", () => {
    const remote = doc({ notifLastSeen: 500, dmRead: { bob: 300 } });
    expect(applyRemoteToLocal(remote, PK)).toBe(true);
    expect(applyRemoteToLocal(remote, PK)).toBe(false);
    expect(localStorage.getItem(NOTIF_KEY)).toBe("500");
    expect(localStorage.getItem(`${DM_READ_PREFIX}bob`)).toBe("300");
  });
});

describe("collect → apply round-trip preserves the union (device A → B)", () => {
  it("device B ends up with the max of both devices", () => {
    // Device A state, captured into a doc.
    localStorage.setItem(NOTIF_KEY, "800");
    localStorage.setItem(`${DM_READ_PREFIX}bob`, "300");
    const deviceA = collectLocalState(PK);

    // Device B has different local markers.
    __store.clear();
    localStorage.setItem(NOTIF_KEY, "400");
    localStorage.setItem(`${DM_READ_PREFIX}carol`, "700");

    // B fetches A's doc and applies it as a floor.
    applyRemoteToLocal(deviceA, PK);

    const merged = collectLocalState(PK);
    expect(merged.notifLastSeen).toBe(800);          // A was higher
    expect(merged.dmRead).toEqual({ bob: 300, carol: 700 }); // union
  });
});

describe("isReadStateDoc — validation", () => {
  it("accepts a well-formed doc", () => {
    expect(isReadStateDoc(doc({}))).toBe(true);
  });
  it("rejects junk", () => {
    expect(isReadStateDoc(null)).toBe(false);
    expect(isReadStateDoc({})).toBe(false);
    expect(isReadStateDoc({ version: 1, lastModified: 1 })).toBe(false);
    expect(isReadStateDoc({ version: 1, lastModified: 1, notifLastSeen: 0, dmRead: null })).toBe(false);
  });
});
