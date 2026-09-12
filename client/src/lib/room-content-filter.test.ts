/**
 * Found browsing a public NIP-29 relay (groups.0xchat.com): its room list
 * showed sexually explicit rooms by name to anyone who opened it, including
 * one whose name suggested minors. Room names and descriptions are the only
 * thing we can judge before anyone opens a room, so that is what this reads.
 *
 * Owner's call (2026-09-12): explicit rooms are left out, with an opt-in
 * reveal; a room that sexualises minors is hidden for good.
 */
import { describe, it, expect } from "vitest";
import { classifyRoom, screenRooms } from "./room-content-filter";

describe("judging a room by its name and description", () => {
  it("a room pairing a minor with sexual content is hidden for good", () => {
    expect(classifyRoom({ name: "teen nudes" })).toBe("minors");
  });

  it("a sexually explicit room is explicit, from its name or its description", () => {
    // As listed on the relay that prompted this.
    expect(classifyRoom({ name: "Slut Bedroom" })).toBe("explicit");
    expect(classifyRoom({ name: "Latinos", about: "Welcome all yall sexy latinos" })).toBe("explicit");
  });

  it("a word that itself means sexualised children needs no second word", () => {
    expect(classifyRoom({ name: "jailbait pics" })).toBe("minors");
    expect(classifyRoom({ name: "Loli lounge" })).toBe("minors");
  });

  it("sees through the usual disguises: digits for letters, accents", () => {
    expect(classifyRoom({ name: "p0rn swap" })).toBe("explicit");
    expect(classifyRoom({ name: "s3xy chat" })).toBe("explicit");
    expect(classifyRoom({ name: "nüdes" })).toBe("explicit");
  });
});

describe("a relay's room list", () => {
  const rooms = [
    { id: "a", name: "Bitcoin builders" },
    { id: "b", name: "Slut Bedroom" },
    { id: "c", name: "teen nudes" },
  ];

  it("leaves explicit rooms out, and counts what it left out", () => {
    const { shown, hidden } = screenRooms(rooms, { showExplicit: false });
    expect(shown.map((r) => r.id)).toEqual(["a"]);
    expect(hidden).toBe(2);
  });

  it("shows explicit rooms to someone who opted in, but never the ones that sexualise minors", () => {
    const { shown, hidden } = screenRooms(rooms, { showExplicit: true });
    expect(shown.map((r) => r.id)).toEqual(["a", "b"]);
    expect(hidden).toBe(1);
  });
});
