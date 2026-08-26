import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  listSentInvites,
  recordSentInvite,
  removeSentInvite,
  isInGroup,
  SENT_INVITES_CAP,
} from "./concord-sent-invites";

const OWNER = "a".repeat(64);
const COMM = "community-1";
const pk = (n: number) => n.toString(16).padStart(64, "0");

// Node env has no localStorage — same Map-backed shim the other concord stores test with.
const hadLocalStorage = "localStorage" in globalThis;
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});
afterEach(() => {
  if (!hadLocalStorage) delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe("concord-sent-invites store", () => {

  it("returns [] when nothing has been sent", () => {
    expect(listSentInvites(OWNER, COMM)).toEqual([]);
  });

  it("records a sent invite and reads it back (newest first)", () => {
    recordSentInvite(OWNER, COMM, { recipient: pk(1), at: 1000, name: "Alice" });
    recordSentInvite(OWNER, COMM, { recipient: pk(2), at: 2000 });
    const list = listSentInvites(OWNER, COMM);
    expect(list.map((s) => s.recipient)).toEqual([pk(2), pk(1)]);
    expect(list[1].name).toBe("Alice");
  });

  it("dedups by recipient — re-inviting the same person keeps ONE row with the latest time", () => {
    recordSentInvite(OWNER, COMM, { recipient: pk(1), at: 1000, name: "Alice" });
    recordSentInvite(OWNER, COMM, { recipient: pk(1), at: 5000 });
    const list = listSentInvites(OWNER, COMM);
    expect(list).toHaveLength(1);
    expect(list[0].at).toBe(5000);
  });

  it("namespaces by owner AND community (no cross-leak)", () => {
    recordSentInvite(OWNER, COMM, { recipient: pk(1), at: 1000 });
    expect(listSentInvites(OWNER, "other-community")).toEqual([]);
    expect(listSentInvites("b".repeat(64), COMM)).toEqual([]);
  });

  it("removes a specific recipient", () => {
    recordSentInvite(OWNER, COMM, { recipient: pk(1), at: 1000 });
    recordSentInvite(OWNER, COMM, { recipient: pk(2), at: 2000 });
    removeSentInvite(OWNER, COMM, pk(1));
    expect(listSentInvites(OWNER, COMM).map((s) => s.recipient)).toEqual([pk(2)]);
  });

  it("caps the log so it can't grow unbounded", () => {
    for (let i = 0; i < SENT_INVITES_CAP + 10; i++) {
      recordSentInvite(OWNER, COMM, { recipient: pk(i), at: i });
    }
    expect(listSentInvites(OWNER, COMM)).toHaveLength(SENT_INVITES_CAP);
  });

  it("NEVER persists anything but recipient/at/name (no invite secret material)", () => {
    recordSentInvite(OWNER, COMM, { recipient: pk(1), at: 1000, name: "Alice" });
    const raw = localStorage.getItem(`ro_concord_sent_invites_${OWNER}_${COMM}`) ?? "";
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(["at", "name", "recipient"]);
  });
});

describe("isInGroup — status derivation from the live roster", () => {
  it("true when the recipient is in the member set", () => {
    expect(isInGroup(pk(1), new Set([pk(1), pk(2)]))).toBe(true);
  });
  it("false when absent", () => {
    expect(isInGroup(pk(9), new Set([pk(1), pk(2)]))).toBe(false);
  });
  it("false for an empty roster", () => {
    expect(isInGroup(pk(1), new Set())).toBe(false);
  });
});
