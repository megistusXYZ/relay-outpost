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
import { badgeDefinitionTemplate, profileBadgesTemplates, withAcceptedBadge, pickProfileBadgesEvent, badgesWaiting } from "./badge-events";

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
