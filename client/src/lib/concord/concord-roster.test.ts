import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { otherMemberFor, saveRosterSnapshot, getRosterSnapshot, facepileMembers, joinMemberNames, resolveGroupName } from "./concord-roster";

const ME = "me-pubkey";
const ALICE = "alice-pubkey";
const BOB = "bob-pubkey";
const CAROL = "carol-pubkey";

describe("otherMemberFor (present-as-person rule)", () => {
  it("returns the other member for a 2-person roster that includes me", () => {
    expect(otherMemberFor([ME, ALICE], ME)).toBe(ALICE);
    expect(otherMemberFor([ALICE, ME], ME)).toBe(ALICE); // order-independent
  });

  it("falls back (null) for 3+ members — group presentation returns", () => {
    expect(otherMemberFor([ME, ALICE, BOB], ME)).toBeNull();
  });

  it("falls back for a solo roster (owner only, second member not folded yet)", () => {
    expect(otherMemberFor([ME], ME)).toBeNull();
    expect(otherMemberFor([ALICE], ME)).toBeNull();
  });

  it("falls back for an unknown/empty roster", () => {
    expect(otherMemberFor(null, ME)).toBeNull();
    expect(otherMemberFor(undefined, ME)).toBeNull();
    expect(otherMemberFor([], ME)).toBeNull();
  });

  it("falls back when I'm not on the roster (can't tell which member is 'other')", () => {
    expect(otherMemberFor([ALICE, BOB], ME)).toBeNull();
  });

  it("falls back without a signed-in pubkey", () => {
    expect(otherMemberFor([ME, ALICE], null)).toBeNull();
    expect(otherMemberFor([ME, ALICE], undefined)).toBeNull();
  });

  it("dedupes the roster before counting members", () => {
    expect(otherMemberFor([ME, ALICE, ALICE, ME], ME)).toBe(ALICE); // 2 distinct
    expect(otherMemberFor([ME, ME], ME)).toBeNull(); // 1 distinct
    expect(otherMemberFor([ME, ALICE, BOB, ALICE], ME)).toBeNull(); // 3 distinct
  });

  it("flips presentation at the 2 → 3 member boundary", () => {
    const twoPerson = [ME, ALICE];
    expect(otherMemberFor(twoPerson, ME)).toBe(ALICE);
    expect(otherMemberFor([...twoPerson, BOB], ME)).toBeNull();
  });
});

describe("roster snapshots (localStorage round-trip)", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("round-trips a saved roster (deduped + sorted)", () => {
    saveRosterSnapshot("c1", [BOB, ME, ALICE, ME]);
    expect(getRosterSnapshot("c1")).toEqual([ALICE, BOB, ME].sort());
  });

  it("returns null for an unknown community", () => {
    expect(getRosterSnapshot("nope")).toBeNull();
  });

  it("ignores empty rosters so a still-loading fold can't clobber a snapshot", () => {
    saveRosterSnapshot("c1", [ME, ALICE]);
    saveRosterSnapshot("c1", []);
    expect(getRosterSnapshot("c1")).toEqual([ME, ALICE].sort());
  });

  it("rejects corrupt stored values", () => {
    store.set("ro_concord_roster_c1", "{not json");
    expect(getRosterSnapshot("c1")).toBeNull();
    store.set("ro_concord_roster_c2", JSON.stringify([1, 2]));
    expect(getRosterSnapshot("c2")).toBeNull();
  });
});

describe("facepileMembers (group avatar face selection)", () => {
  it("shows two faces for a 2-person group so it can't read as a 1:1 DM", () => {
    // Other member first, me last — but both present.
    expect(facepileMembers([ME, ALICE], ME)).toEqual([ALICE, ME]);
    expect(facepileMembers([ALICE, ME], ME)).toEqual([ALICE, ME]); // order-independent
  });

  it("dedupes and drops empty pubkeys", () => {
    expect(facepileMembers([ALICE, ALICE, "", ME, ME], ME)).toEqual([ALICE, ME]);
  });

  it("favours OTHER members when capped, dropping self first", () => {
    // 4 distinct incl. me, cap 3 → the three others (sorted), me excluded.
    const faces = facepileMembers([ME, CAROL, ALICE, BOB], ME, 3);
    expect(faces).toEqual([ALICE, BOB, CAROL].sort());
    expect(faces).not.toContain(ME);
  });

  it("includes self only when there's room under the cap", () => {
    // 3 distinct incl. me, cap 3 → others sorted then me.
    expect(facepileMembers([ME, BOB, ALICE], ME, 3)).toEqual([ALICE, BOB, ME]);
  });

  it("is deterministic (sorted others) regardless of input order", () => {
    expect(facepileMembers([CAROL, ALICE, BOB], null)).toEqual([ALICE, BOB, CAROL]);
    expect(facepileMembers([BOB, CAROL, ALICE], null)).toEqual([ALICE, BOB, CAROL]);
  });

  it("handles an unknown pubkey and empty rosters", () => {
    expect(facepileMembers([ALICE, BOB], undefined)).toEqual([ALICE, BOB]);
    expect(facepileMembers([], ME)).toEqual([]);
    expect(facepileMembers(null, ME)).toEqual([]);
  });
});

describe("joinMemberNames (unnamed-group fallback label)", () => {
  it("joins sorted names deterministically", () => {
    expect(joinMemberNames(["Bob", "Alice"])).toBe("Alice, Bob");
    expect(joinMemberNames(["Alice", "Bob"])).toBe("Alice, Bob"); // same for everyone
  });

  it("caps with an ellipsis past the max", () => {
    expect(joinMemberNames(["Dan", "Alice", "Carol", "Bob"], 3)).toBe("Alice, Bob, Carol, …");
  });

  it("trims and drops blanks", () => {
    expect(joinMemberNames(["  Alice ", "", "   "])).toBe("Alice");
    expect(joinMemberNames([])).toBe("");
  });
});

describe("resolveGroupName (shared name resolution)", () => {
  it("prefers the folded metadata name (an owner's rename wins)", () => {
    expect(resolveGroupName({ foldedName: "Renamed", recordName: "Old", memberNames: ["Alice"] })).toBe("Renamed");
  });

  it("falls back to the local record name when there's no folded name", () => {
    expect(resolveGroupName({ foldedName: "", recordName: "Design Crew", memberNames: ["Alice"] })).toBe("Design Crew");
    expect(resolveGroupName({ recordName: "Design Crew" })).toBe("Design Crew");
  });

  it("falls back to a deterministic member-name join for a truly unnamed group", () => {
    expect(resolveGroupName({ memberNames: ["Bob", "Alice"] })).toBe("Alice, Bob");
    // Same members ⇒ same name for every viewer.
    expect(resolveGroupName({ foldedName: "  ", recordName: "  ", memberNames: ["Alice", "Bob"] })).toBe("Alice, Bob");
  });

  it("last-resorts to a generic label with no name and no members", () => {
    expect(resolveGroupName({})).toBe("Group chat");
    expect(resolveGroupName({ memberNames: [] })).toBe("Group chat");
  });
});
