/**
 * How a person looks to you, everywhere (owner, 2026-10-12: "custom names and
 * images don't work across the solution"). Your name for them, then your
 * photo for them; failing a photo, your icon tile; failing that, their real
 * picture; failing that, initials. One answer every surface renders from.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

import { personLook } from "./person-look";
import { setPetname, clearPetname, isShowingRealNames, toggleShowRealNames } from "./petnames";
import { seedPetnameImageUrl } from "./petname-images";
import type { Event } from "nostr-tools";

const PK = "ab".repeat(32);
const profile = { kind: 0, pubkey: PK, content: JSON.stringify({ name: "HyperCool", picture: "https://real.example/pic.jpg" }), tags: [], created_at: 1, id: "cd".repeat(32), sig: "" } as unknown as Event;

beforeEach(() => { backing.clear(); clearPetname("person", PK); if (isShowingRealNames()) toggleShowRealNames(); });

describe("personLook", () => {
  it("no custom name: their real name and picture, no tile", () => {
    const look = personLook(profile, PK);
    expect(look.name).toBe("HyperCool");
    expect(look.avatarUrl).toContain("real.example");
    expect(look.tile).toBeUndefined();
  });
  it("your name and icon for them, no photo: the tile replaces their picture entirely", () => {
    setPetname("person", PK, { name: "3d", emoji: "🛠️", color: "#334" });
    const look = personLook(profile, PK);
    expect(look.name).toBe("3d");
    expect(look.tile).toEqual({ emoji: "🛠️", color: "#334" });
    expect(look.avatarUrl).toBeUndefined();
  });
  it("with no profile loaded yet, your name and tile still show", () => {
    setPetname("person", PK, { name: "3d", color: "#334" });
    const look = personLook(undefined, PK);
    expect(look.name).toBe("3d");
    expect(look.tile).toEqual({ emoji: undefined, color: "#334" });
  });
  it("the show-real-names flip reveals the originals", () => {
    setPetname("person", PK, { name: "3d", emoji: "🛠️" });
    toggleShowRealNames();
    const look = personLook(profile, PK);
    expect(look.name).toBe("HyperCool");
    expect(look.tile).toBeUndefined();
    expect(look.avatarUrl).toContain("real.example");
  });
  // Last: the seeded photo URL stays in the module cache.
  it("your photo for them wins over the tile", () => {
    setPetname("person", PK, { name: "3d", emoji: "🛠️" });
    seedPetnameImageUrl("person", PK, "blob:mine");
    const look = personLook(profile, PK);
    expect(look.avatarUrl).toBe("blob:mine");
    expect(look.tile).toBeUndefined();
  });
});
