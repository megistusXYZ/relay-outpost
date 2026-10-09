/**
 * Team on the relay itself (newlay, MANAGEMENT_API.md §3.5–3.6). Today our
 * Team is a roster the relay never sees, so a teammate's ban is refused. On a
 * relay with tiers, "can act here" means: assigned to a tier whose profile has
 * can_admin. The tier and assignment objects are shaped from the doc.
 */
import { describe, it, expect } from "vitest";
import { adminTierNames, moderatorTierPlan, whoActs, callsToSetActing } from "./team-powers";
import { canDo, readSupportedMethods, UNKNOWN_CAPABILITIES } from "./relay-capabilities";
import { isNip86Method } from "@shared/nip86-methods";

const ANN = "aa".repeat(32), BOB = "bb".repeat(32), OWNER = "0f".repeat(32);
const TIERS = [
  { name: "anon", rank: 0 },
  { name: "admin", rank: 100, can_admin: true },
  { name: "banned", rank: -1, can_read: false, can_write: false },
  { name: "allowed", rank: 1 },
];

describe("which roles act", () => {
  it("are the tiers whose profile says can_admin", () => {
    expect(adminTierNames(TIERS)).toEqual(["admin"]);
    expect(adminTierNames([...TIERS, { name: "vip", rank: 50, can_admin: true }])).toEqual(["admin", "vip"]);
    expect(adminTierNames([{ name: "anon", rank: 0 }])).toEqual([]);
  });
  it("is nothing for a refusal or a malformed answer", () => {
    expect(adminTierNames(undefined)).toEqual([]);
    expect(adminTierNames([{ rank: 1 }, "x"])).toEqual([]);
  });
});

describe("the role to give a teammate", () => {
  it("reuses the host's own acting role — the lowest-ranked one, never the built-in banned", () => {
    expect(moderatorTierPlan(TIERS)).toEqual({ tier: "admin", create: null });
    expect(moderatorTierPlan([...TIERS, { name: "mods", rank: 50, can_admin: true }])).toEqual({ tier: "mods", create: null });
  });
  it("creates one plain 'moderator' role when the host has none", () => {
    expect(moderatorTierPlan([{ name: "anon", rank: 0 }, { name: "banned", rank: -1 }])).toEqual({
      tier: "moderator",
      create: { method: "createtier", params: [{ name: "moderator", rank: 50, can_read: true, can_write: true, can_admin: true }] },
    });
  });
});

describe("who acts here today", () => {
  const ASSIGNMENTS = [
    { pubkey: OWNER, tier: "admin", source: "config" },
    { pubkey: ANN, tier: "admin", source: "admin", reason: "team" },
    { pubkey: BOB, tier: "allowed", source: "admin" },
  ];
  it("is anyone assigned an acting role, and says whether the host set it (then we can't take it away)", () => {
    expect(whoActs(ASSIGNMENTS, ["admin"])).toEqual(new Map([[OWNER, { byHost: true }], [ANN, { byHost: false }]]));
  });
  it("a ban beats everything: a banned admin doesn't act", () => {
    expect(whoActs([...ASSIGNMENTS, { pubkey: ANN, tier: "banned", source: "ban" }], ["admin"]).has(ANN)).toBe(false);
  });
  it("is empty for a refusal or a malformed answer", () => {
    expect(whoActs(undefined, ["admin"]).size).toBe(0);
    expect(whoActs([{ pubkey: "nope", tier: "admin", source: "admin" }], ["admin"]).size).toBe(0);
  });
});

describe("switching it", () => {
  it("on: creates the role only if needed, then assigns, with our reason", () => {
    expect(callsToSetActing(true, ANN, { tier: "admin", create: null })).toEqual([
      { method: "assigntier", params: [ANN, "admin", "Relay Outpost team"] },
    ]);
    const plan = moderatorTierPlan([{ name: "anon", rank: 0 }]);
    expect(callsToSetActing(true, ANN, plan).map((c) => c.method)).toEqual(["createtier", "assigntier"]);
  });
  it("off: takes the assignment away", () => {
    expect(callsToSetActing(false, ANN, { tier: "admin", create: null })).toEqual([{ method: "unassigntier", params: [ANN] }]);
  });
  it("every call is a method our proxy forwards", () => {
    const plan = moderatorTierPlan([{ name: "anon", rank: 0 }]);
    const all = [...callsToSetActing(true, ANN, plan), ...callsToSetActing(false, ANN, plan)].map((c) => c.method);
    expect(all.filter((m) => !isNip86Method(m))).toEqual([]);
  });
});

describe("whether to offer it", () => {
  it("only on a relay that lists every call it needs", () => {
    const all = ["supportedmethods", "assigntier", "unassigntier", "listassignments", "listtiers", "createtier"];
    expect(canDo(readSupportedMethods({ result: all }), "teamPowers")).toBe(true);
    expect(canDo(readSupportedMethods({ result: all.filter((m) => m !== "listtiers") }), "teamPowers")).toBe(false);
    expect(canDo(UNKNOWN_CAPABILITIES, "teamPowers")).toBe(false);
  });
});
