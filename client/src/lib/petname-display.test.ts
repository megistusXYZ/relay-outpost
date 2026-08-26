/**
 * Petnames become the person everywhere (owner report: renaming someone left
 * the real name/avatar primary with only a small caption). getDisplayName and
 * getAvatarUrl — the choke points nearly every surface renders through — are
 * petname-aware: your name and photo for someone replace theirs app-wide,
 * the session "show real names" flip reveals the originals, and getRealName
 * stays raw for the surfaces that must never petname (the rename dialog's
 * "Real name:" line, text that enters PUBLISHED content).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

import { getDisplayName, getAvatarUrl, getRealName } from "./nostr-helpers";
import { setPetname, clearPetname, isShowingRealNames, toggleShowRealNames } from "./petnames";
import { seedPetnameImageUrl } from "./petname-images";
import type { Event } from "nostr-tools";

const PK = "ab".repeat(32);
const profile = {
  kind: 0,
  pubkey: PK,
  content: JSON.stringify({ name: "Damus Airdrop Notice", picture: "https://real.example/pic.jpg" }),
  tags: [],
  created_at: 1,
  id: "cd".repeat(32),
  sig: "",
} as unknown as Event;

beforeEach(() => {
  backing.clear();
  clearPetname("person", PK);
  if (isShowingRealNames()) toggleShowRealNames();
});

describe("petname-aware display name", () => {
  it("without a petname, the real name passes through untouched", () => {
    expect(getDisplayName(profile)).toBe("Damus Airdrop Notice");
  });

  it("your name for them replaces theirs", () => {
    setPetname("person", PK, { name: "Fake Account" });
    expect(getDisplayName(profile)).toBe("Fake Account");
  });

  it("the session reveal flips every surface back to real names", () => {
    setPetname("person", PK, { name: "Fake Account" });
    toggleShowRealNames();
    expect(getDisplayName(profile)).toBe("Damus Airdrop Notice");
    toggleShowRealNames();
    expect(getDisplayName(profile)).toBe("Fake Account");
  });

  it("getRealName never petnames — the dialog and publish paths depend on it", () => {
    setPetname("person", PK, { name: "Fake Account" });
    expect(getRealName(profile)).toBe("Damus Airdrop Notice");
  });
});

describe("petname-aware avatar", () => {
  it("a petname photo replaces the real avatar", () => {
    seedPetnameImageUrl("person", PK, "blob:fake-account-photo");
    setPetname("person", PK, { name: "Fake Account" });
    expect(getAvatarUrl(profile)).toBe("blob:fake-account-photo");
  });

  it("the reveal flip restores the real avatar too", () => {
    seedPetnameImageUrl("person", PK, "blob:fake-account-photo");
    toggleShowRealNames();
    expect(getAvatarUrl(profile)).toContain("real.example");
    toggleShowRealNames();
  });

  it("no photo petname leaves the real avatar alone", () => {
    seedPetnameImageUrl("person", PK, undefined);
    setPetname("person", PK, { name: "Fake Account" });
    expect(getAvatarUrl(profile)).toContain("real.example");
  });
});
