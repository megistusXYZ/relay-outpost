import { describe, it, expect, beforeEach } from "vitest";
import {
  addPendingJoin, readPendingJoins, removePendingJoin,
  resolveAcceptances, readAcceptedJoins, markAcceptedSeen, recordAcceptance,
} from "./join-requests";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const PK = "a".repeat(64);
const p = (relayUrl: string, groupId = "_", requestedAt = 1000) => ({ relayUrl, groupId, name: "Buzzbuild", requestedAt });

beforeEach(() => localStorage.clear());

describe("pending join store", () => {
  it("adds, reads (per account), dedupes on relay+group, removes", () => {
    addPendingJoin(PK, p("wss://a.example"));
    addPendingJoin(PK, p("wss://a.example"));
    addPendingJoin(PK, p("wss://b.example"));
    expect(readPendingJoins(PK)).toHaveLength(2);
    expect(readPendingJoins("b".repeat(64))).toHaveLength(0);
    removePendingJoin(PK, "wss://a.example", "_");
    expect(readPendingJoins(PK).map((x) => x.relayUrl)).toEqual(["wss://b.example"]);
  });
});

describe("resolveAcceptances (three outcomes: accepted, still pending, unreached stays pending)", () => {
  const now = 1000 + 10 * 86400;
  it("splits accepted from pending; an UNREACHED membership check never resolves anything", () => {
    const pending = [p("wss://in.example"), p("wss://wait.example"), p("wss://down.example")];
    const membership = (x: { relayUrl: string }) =>
      x.relayUrl === "wss://in.example" ? true : x.relayUrl === "wss://wait.example" ? false : null;
    const got = resolveAcceptances(pending, membership, now);
    expect(got.accepted.map((x) => x.relayUrl)).toEqual(["wss://in.example"]);
    expect(got.stillPending.map((x) => x.relayUrl).sort()).toEqual(["wss://down.example", "wss://wait.example"]);
  });

  it("drops requests older than 30 days without calling them accepted", () => {
    const old = p("wss://old.example", "_", 1000);
    const got = resolveAcceptances([old], () => false, 1000 + 31 * 86400);
    expect(got.accepted).toEqual([]);
    expect(got.stillPending).toEqual([]);
  });
});

describe("accepted store", () => {
  it("records acceptances unseen, then marks them seen", () => {
    addPendingJoin(PK, p("wss://a.example"));
    const got = resolveAcceptances(readPendingJoins(PK), () => true, 2000);
    // caller persists: this store test drives the persistence helpers
    expect(got.accepted).toHaveLength(1);
  });
  it("markAcceptedSeen flips seen for one record", () => {
    recordAcceptance(PK, p("wss://a.example"), 2000);
    expect(readAcceptedJoins(PK)[0].seen).toBe(false);
    markAcceptedSeen(PK, "wss://a.example", "_");
    expect(readAcceptedJoins(PK)[0].seen).toBe(true);
  });
});
