/**
 * Badges, step 1 (owner, 2026-10-06 — badges-plan): a badge keeps one
 * identity for life, and the badges you show are written so every Nostr app
 * sees the same list in the same order.
 *
 * Today a badge's identity was its name turned into a slug, so making a
 * second "Helper" silently replaced the first one — for everyone who held it.
 * And accepting wrote only the deprecated kind-30008 list (NIP-58 now names
 * kind 10008 as the profile list and asks clients to treat both as one).
 */
import { describe, it, expect } from "vitest";
import { badgeDefinitionTemplate, profileBadgesTemplates, withAcceptedBadge, pickProfileBadgesEvent, badgesWaiting, badgeDeletionTemplate, withoutDeleted, badgeAwardTemplate, moveShownBadge, hideShownBadge, besideName } from "./badge-events";

const dOf = (t: { tags: string[][] }) => t.tags.find((x) => x[0] === "d")?.[1];
const pairs = (t: { tags: string[][] }) => t.tags.filter((x) => x[0] === "a" || x[0] === "e").map((x) => `${x[0]}:${x[1]}`);

describe("a badge keeps one identity", () => {
  it("two badges with the same name never overwrite each other", () => {
    const a = badgeDefinitionTemplate({ name: "Helper", description: "", image: "https://x/a.png" });
    const b = badgeDefinitionTemplate({ name: "Helper", description: "", image: "https://x/b.png" });
    expect(dOf(a)).toBeTruthy();
    expect(dOf(a)).not.toBe(dOf(b));
  });

  it("a name with no letters still gets an identity", () => {
    expect(dOf(badgeDefinitionTemplate({ name: "⭐⭐⭐", description: "", image: "" }))).toBeTruthy();
  });

  it("editing a badge keeps its identity, so everyone who holds it sees the change", () => {
    const made = badgeDefinitionTemplate({ name: "Helper", description: "", image: "https://x/a.png" });
    const edited = badgeDefinitionTemplate({ id: dOf(made), name: "Super helper", description: "Above and beyond", image: "https://x/c.png" });
    expect(dOf(edited)).toBe(dOf(made));
    expect(edited.tags).toContainEqual(["name", "Super helper"]);
  });

  it("is published as a badge with its name, description and pictures", () => {
    const t = badgeDefinitionTemplate({ name: "Founding member", description: "Here from day one", image: "https://x/full.png", imageSize: "1024x1024", thumb: "https://x/small.png", thumbSize: "256x256" });
    expect(t.kind).toBe(30009);
    expect(t.tags).toContainEqual(["name", "Founding member"]);
    expect(t.tags).toContainEqual(["description", "Here from day one"]);
    expect(t.tags).toContainEqual(["image", "https://x/full.png", "1024x1024"]);
    expect(t.tags).toContainEqual(["thumb", "https://x/small.png", "256x256"]);
  });

  it("a picture of unknown size says no size, rather than a wrong one", () => {
    const t = badgeDefinitionTemplate({ name: "Helper", description: "", image: "https://x/pasted.png" });
    expect(t.tags).toContainEqual(["image", "https://x/pasted.png"]);
  });
});

describe("the badges you show", () => {
  const helper = { badgeRef: "30009:alice:h1", awardEventId: "e1" };
  const founder = { badgeRef: "30009:bob:f1", awardEventId: "e2" };

  it("are written in both list formats, in the same order", () => {
    const [current, legacy] = profileBadgesTemplates([founder, helper]);
    expect(current.kind).toBe(10008);
    expect(legacy.kind).toBe(30008);
    expect(dOf(legacy)).toBe("profile_badges");
    expect(pairs(current)).toEqual(["a:30009:bob:f1", "e:e2", "a:30009:alice:h1", "e:e1"]);
    expect(pairs(legacy)).toEqual(pairs(current));
  });

  it("accepting a badge adds it after the ones you already show, once", () => {
    const list = withAcceptedBadge(withAcceptedBadge([founder], helper), helper);
    expect(list).toEqual([founder, helper]);
  });

  it("the newer of the two lists is the one that counts", () => {
    const older = { kind: 30008, created_at: 100, tags: [["d", "profile_badges"]] };
    const newer = { kind: 10008, created_at: 200, tags: [] };
    expect(pickProfileBadgesEvent([older, newer])).toBe(newer);
    const newerLegacy = { kind: 30008, created_at: 300, tags: [["d", "profile_badges"]] };
    expect(pickProfileBadgesEvent([newer, newerLegacy])).toBe(newerLegacy);
    // A kind-30008 set with another name is a labelled group, not the profile list.
    const aSet = { kind: 30008, created_at: 400, tags: [["d", "favourites"]] };
    expect(pickProfileBadgesEvent([newer, aSet])).toBe(newer);
  });
});

describe("badges waiting for you", () => {
  const award = (id: string, from: string, ref = `30009:${from}:x`) => ({ id, pubkey: from, badgeRef: ref, createdAt: 1 });

  it("lists badges you were given and don't show yet, newest first", () => {
    const r = badgesWaiting({
      awards: [award("old", "ana"), { ...award("new", "ana", "30009:ana:y"), createdAt: 9 }],
      shown: [], notNow: new Set(), follows: new Set(["ana"]),
    });
    expect(r.waiting.map((a) => a.id)).toEqual(["new", "old"]);
  });

  it("leaves out badges already on your profile, and ones you said Not now to", () => {
    const r = badgesWaiting({
      awards: [award("a1", "ana", "30009:ana:shown"), award("a2", "ana", "30009:ana:later"), award("a3", "ana", "30009:ana:fresh")],
      shown: [{ badgeRef: "30009:ana:shown", awardEventId: "a1" }],
      notNow: new Set(["a2"]), follows: new Set(["ana"]),
    });
    expect(r.waiting.map((a) => a.id)).toEqual(["a3"]);
  });

  it("badges from people you don't follow are folded away, not shown", () => {
    const r = badgesWaiting({
      awards: [award("f", "ana"), award("s1", "stranger"), award("s2", "other")],
      shown: [], notNow: new Set(), follows: new Set(["ana"]),
    });
    expect(r.waiting.map((a) => a.id)).toEqual(["f"]);
    expect(r.fromStrangers.map((a) => a.id).sort()).toEqual(["s1", "s2"]);
  });
});

describe("deleting a badge", () => {
  it("asks relays to remove that one badge and nothing else", () => {
    const t = badgeDeletionTemplate({ pubkey: "alice", id: "b-1", eventId: "ev1" });
    expect(t.kind).toBe(5);
    expect(t.tags).toEqual([["a", "30009:alice:b-1"], ["e", "ev1"], ["k", "30009"]]);
  });
});

describe("your badges after deleting one", () => {
  const def = (d: string, at: number) => ({ pubkey: "alice", dTag: d, createdAt: at });
  const del = (d: string, at: number) => ({ kind: 5, created_at: at, tags: [["a", `30009:alice:${d}`]] });

  it("a deleted badge leaves the list, even from relays that ignore deletions", () => {
    expect(withoutDeleted([def("keep", 10), def("gone", 10)], [del("gone", 20)]).map((x) => x.dTag)).toEqual(["keep"]);
  });

  it("a badge remade after it was deleted comes back", () => {
    expect(withoutDeleted([def("again", 30)], [del("again", 20)]).map((x) => x.dTag)).toEqual(["again"]);
  });
});

describe("giving a badge", () => {
  it("names the badge, every chosen person once, and carries your note", () => {
    const t = badgeAwardTemplate({ badgeRef: "30009:alice:b-1", recipients: ["bob", "carol", "bob"], note: "For running the meetup" });
    expect(t.kind).toBe(8);
    expect(t.tags).toEqual([["a", "30009:alice:b-1"], ["p", "bob"], ["p", "carol"]]);
    expect(t.content).toBe("For running the meetup");
  });

  it("no note means no note", () => {
    expect(badgeAwardTemplate({ badgeRef: "30009:alice:b-1", recipients: ["bob"] }).content).toBe("");
  });
});

describe("arranging the badges you show", () => {
  const a = { badgeRef: "30009:x:a", awardEventId: "ea" };
  const b = { badgeRef: "30009:x:b", awardEventId: "eb" };
  const c = { badgeRef: "30009:x:c", awardEventId: "ec" };

  it("moves a badge up or down, and not past either end", () => {
    expect(moveShownBadge([a, b, c], 2, -1)).toEqual([a, c, b]);
    expect(moveShownBadge([a, b, c], 0, -1)).toEqual([a, b, c]);
    expect(moveShownBadge([a, b, c], 2, 1)).toEqual([a, b, c]);
  });

  it("hiding one takes it off your profile and keeps the rest in order", () => {
    expect(hideShownBadge([a, b, c], 1)).toEqual([a, c]);
  });
});

describe("beside a name", () => {
  it("shows the first badge and counts the rest — never more than one icon", () => {
    expect(besideName(["first", "second", "third"])).toEqual({ first: "first", more: 2 });
    expect(besideName(["only"])).toEqual({ first: "only", more: 0 });
    expect(besideName([])).toEqual({ first: undefined, more: 0 });
  });
});
