/**
 * Petnames — private, local names for people, groups and communities.
 *
 * The owner's framing (2026-08-15): "specialized for the user… only show for
 * them… simple way to see the real name." The un-gameable half matters most:
 * a name YOU assigned can't be spoofed by a profile rename — the petname
 * pattern Nostr grew up with, kept PRIVATE (synced via NIP-78, never
 * published).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});
vi.stubGlobal("window", { dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} });

import {
  getPetname,
  setPetname,
  clearPetname,
  displayNameWith,
  matchesQueryWith,
  isShowingRealNames,
  toggleShowRealNames,
  hasAnyPetnames,
  PETNAMES_MAX_ENTRIES,
} from "./petnames";

describe("petnames store", () => {
  beforeEach(() => backing.clear());

  it("stores and reads a nickname per subject, namespaced by kind", () => {
    setPetname("person", "pk1", { name: "Design Team" });
    setPetname("group", "pk1", { name: "Not the same subject" });
    expect(getPetname("person", "pk1")?.name).toBe("Design Team");
    expect(getPetname("group", "pk1")?.name).toBe("Not the same subject");
  });

  it("clears a petname without touching its neighbours", () => {
    setPetname("person", "a", { name: "A" });
    setPetname("person", "b", { name: "B" });
    clearPetname("person", "a");
    expect(getPetname("person", "a")).toBeUndefined();
    expect(getPetname("person", "b")?.name).toBe("B");
  });

  it("an empty write IS a clear — no ghost entries", () => {
    setPetname("person", "a", { name: "A" });
    setPetname("person", "a", { name: "  " });
    expect(getPetname("person", "a")).toBeUndefined();
  });

  it("keeps emoji/color without a name, and name without emoji", () => {
    setPetname("community", "wss://r.example", { emoji: "🚀" });
    expect(getPetname("community", "wss://r.example")?.emoji).toBe("🚀");
    expect(getPetname("community", "wss://r.example")?.name).toBeUndefined();
  });

  it("community keys normalize relay-url spelling", () => {
    setPetname("community", "wss://R.Example/", { name: "Home" });
    expect(getPetname("community", "wss://r.example")?.name).toBe("Home");
  });

  it("caps the map — oldest entry gives way, the rest survive", () => {
    for (let i = 0; i < PETNAMES_MAX_ENTRIES + 1; i++) {
      setPetname("person", `pk${i}`, { name: `N${i}` });
    }
    expect(getPetname("person", "pk0")).toBeUndefined();
    expect(getPetname("person", `pk${PETNAMES_MAX_ENTRIES}`)?.name).toBe(`N${PETNAMES_MAX_ENTRIES}`);
  });
});

describe("display + search", () => {
  beforeEach(() => backing.clear());

  it("displayNameWith prefers the petname, falls back to the real name", () => {
    setPetname("person", "pk1", { name: "Design Team" });
    expect(displayNameWith("person", "pk1", "Duck 2 PWA")).toBe("Design Team");
    expect(displayNameWith("person", "pk2", "Duck 2 PWA")).toBe("Duck 2 PWA");
  });

  it("cover crop takes the largest centered square — both orientations", async () => {
    const { coverCropRect } = await import("./petname-images");
    expect(coverCropRect(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 });   // landscape
    expect(coverCropRect(300, 400)).toEqual({ sx: 0, sy: 50, size: 300 });   // portrait
    expect(coverCropRect(256, 256)).toEqual({ sx: 0, sy: 0, size: 256 });    // square
    expect(coverCropRect(401, 300).sx).toBe(50);                              // odd → floor, stays in bounds
  });

  it("search matches BOTH the petname and the real name", () => {
    // Renaming something must not make it unfindable by the name everyone
    // else uses in conversation — the search-hides-what-you-asked-for trap.
    setPetname("group", "g1", { name: "Design Team" });
    expect(matchesQueryWith("group", "g1", "Duck 2 PWA", "design")).toBe(true);
    expect(matchesQueryWith("group", "g1", "Duck 2 PWA", "duck")).toBe(true);
    expect(matchesQueryWith("group", "g1", "Duck 2 PWA", "zebra")).toBe(false);
  });

  it("the real-names flip shows real names everywhere, and flips back", () => {
    setPetname("person", "pk1", { name: "Design Team" });
    expect(displayNameWith("person", "pk1", "Duck 2 PWA")).toBe("Design Team");
    toggleShowRealNames();
    expect(isShowingRealNames()).toBe(true);
    expect(displayNameWith("person", "pk1", "Duck 2 PWA")).toBe("Duck 2 PWA");
    toggleShowRealNames();
    expect(displayNameWith("person", "pk1", "Duck 2 PWA")).toBe("Design Team");
  });

  it("hasAnyPetnames gates the toggle — no dead control for the unrenamed", () => {
    expect(hasAnyPetnames()).toBe(false);
    setPetname("person", "pk1", { name: "X" });
    expect(hasAnyPetnames()).toBe(true);
    clearPetname("person", "pk1");
    expect(hasAnyPetnames()).toBe(false);
  });
});
