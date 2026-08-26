/**
 * The three states, and the one that keeps getting collapsed.
 *
 * Sabotage that must turn these red: return "open" whenever `isClosed` is
 * false, ignoring `resolved`. That is the shape the app shipped with, and it is
 * what told a stranger they were already inside a room whose metadata the relay
 * had declined to serve.
 */
import { describe, it, expect } from "vitest";
import { joinDoor, readDoor, mayHaveWaitingMembers } from "./nip29-door";
import type { GroupMetadata } from "./nip29";

const meta = (over: Partial<GroupMetadata>): GroupMetadata =>
  ({
    id: "g1",
    isOpen: false, isClosed: false, isPublic: false, isPrivate: false,
    isRestricted: false, isHidden: false, resolved: true,
    ...over,
  }) as GroupMetadata;

describe("joinDoor — unresolved is not a setting", () => {
  it("is unknown when we never received the metadata", () => {
    // The whole point. No 39000 means we were told nothing, and nothing is not
    // "open" however convenient that would be.
    expect(joinDoor(meta({ resolved: false }))).toBe("unknown");
    expect(joinDoor(null)).toBe("unknown");
    expect(joinDoor(undefined)).toBe("unknown");
  });

  it("is unknown for an unresolved room even if flags happen to be set", () => {
    // CommsTab's placeholder sets isClosed:true defensively with no evidence.
    // `resolved` must dominate, or that guess becomes a reported fact.
    expect(joinDoor(meta({ resolved: false, isClosed: true }))).toBe("unknown");
  });
});

describe("joinDoor — reading a document we actually hold", () => {
  it("is closed on a stated closed tag", () => {
    expect(joinDoor(meta({ isClosed: true }))).toBe("closed");
  });

  it("is open on a stated open tag", () => {
    expect(joinDoor(meta({ isOpen: true }))).toBe("open");
  });

  it("is OPEN when resolved metadata carries neither tag", () => {
    // Measured on newlay 0.3.6: flipping a room open REMOVES `closed` and adds
    // no positive `open` — public/open are NIP-29 defaults and it omits them.
    // Without this line an admin who just opened their room is told we cannot
    // tell how people join it, and the toggle reads as broken.
    expect(joinDoor(meta({}))).toBe("open");
  });

  it("is unknown when the relay states BOTH", () => {
    // Self-contradiction is not a door. Do not pick a winner.
    expect(joinDoor(meta({ isOpen: true, isClosed: true }))).toBe("unknown");
  });
});

describe("readDoor — the other axis, same rules", () => {
  it("is unknown when unresolved", () => {
    expect(readDoor(meta({ resolved: false }))).toBe("unknown");
    expect(readDoor(meta({ resolved: false, isPrivate: true }))).toBe("unknown");
  });

  it("is private on a stated private tag", () => {
    expect(readDoor(meta({ isPrivate: true }))).toBe("private");
  });

  it("is public on a stated public tag, and by default", () => {
    expect(readDoor(meta({ isPublic: true }))).toBe("public");
    expect(readDoor(meta({}))).toBe("public");
  });

  it("is unknown when the relay states both", () => {
    expect(readDoor(meta({ isPublic: true, isPrivate: true }))).toBe("unknown");
  });

  it("does not let the join axis leak into the read axis", () => {
    // Two doors. A closed room can still be publicly readable, which is the
    // single most common NIP-29 configuration.
    expect(readDoor(meta({ isClosed: true }))).toBe("public");
    expect(joinDoor(meta({ isPrivate: true }))).toBe("open");
  });
});

describe("mayHaveWaitingMembers — stricter than joinDoor, on purpose", () => {
  it("asks an unknown room", () => {
    // #582: skipping on unknown hides real people from a moderator.
    expect(mayHaveWaitingMembers(meta({ resolved: false }))).toBe(true);
  });

  it("asks a closed room", () => {
    expect(mayHaveWaitingMembers(meta({ isClosed: true }))).toBe(true);
  });

  it("skips only a POSITIVELY open room", () => {
    expect(mayHaveWaitingMembers(meta({ isOpen: true }))).toBe(false);
  });

  it("still ASKS a default-open room, though joinDoor calls it open", () => {
    // The deliberate divergence. Saying "open" to a human is cheap to get
    // wrong; skipping the queue is not. One wasted round-trip beats a queue
    // nobody can see.
    const defaultOpen = meta({});
    expect(joinDoor(defaultOpen)).toBe("open");
    expect(mayHaveWaitingMembers(defaultOpen)).toBe(true);
  });

  it("asks a self-contradicting room", () => {
    expect(mayHaveWaitingMembers(meta({ isOpen: true, isClosed: true }))).toBe(true);
  });
});
