/**
 * Deleting a post (owner, 2026-10-11, settled by grilling): one word,
 * "Delete". The confirmation tells the truth for where the post lives: inside
 * a Relay Outpost community it's a removal; on the wider network it's a
 * request most relays honour. Afterwards one toast says what the relays did.
 */
import { describe, it, expect } from "vitest";
import { buildDeletion, deletionHome, deletionWords, deletionReport } from "./deletion";

const base = { id: "e".repeat(64), pubkey: "p".repeat(64), sig: "", content: "", created_at: 1 };

describe("buildDeletion", () => {
  it("names the event and its kind for a post", () => {
    const d = buildDeletion({ ...base, kind: 1, tags: [] });
    expect(d.kind).toBe(5);
    expect(d.tags).toEqual([["e", "e".repeat(64)], ["k", "1"]]);
  });
  it("adds the address for an addressable event", () => {
    const d = buildDeletion({ ...base, kind: 30023, tags: [["d", "hello-k3x9pq"]] });
    expect(d.tags).toEqual([["e", "e".repeat(64)], ["a", `30023:${"p".repeat(64)}:hello-k3x9pq`], ["k", "30023"]]);
  });
});

describe("deletionHome", () => {
  const community = ["wss://night-market.relayop.xyz"];
  it("inside a community when every relay asked is a community relay", () => {
    expect(deletionHome(["wss://night-market.relayop.xyz"], community)).toBe("community");
  });
  it("the wider network when any relay asked is outside", () => {
    expect(deletionHome(["wss://night-market.relayop.xyz", "wss://relay.damus.io"], community)).toBe("wider");
    expect(deletionHome(["wss://relay.damus.io"], [])).toBe("wider");
  });
});

describe("deletionWords", () => {
  it("in a community: a removal, in the community's name", () => {
    expect(deletionWords("community", "Night Market")).toEqual({
      title: "Delete this post?",
      description: "This removes it from Night Market.",
      confirmLabel: "Delete",
    });
  });
  it("on the wider network: a request, honestly", () => {
    expect(deletionWords("wider")).toEqual({
      title: "Delete this post?",
      description: "Relays that honour deletions remove it. Copies elsewhere may remain.",
      confirmLabel: "Delete",
    });
  });
});

describe("deletionReport", () => {
  it("says how many of the relays asked have removed it", () => {
    expect(deletionReport({ asked: 6, removed: 4 })).toBe("Removed from 4 of 6 relays.");
  });
  it("says everywhere when every relay asked has removed it", () => {
    expect(deletionReport({ asked: 3, removed: 3 })).toBe("Removed from every relay asked.");
  });
  it("says so when no relay has removed it yet", () => {
    expect(deletionReport({ asked: 2, removed: 0 })).toBe("No relay has removed it yet. Some take a moment; some keep copies.");
  });
});
