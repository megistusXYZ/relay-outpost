/**
 * The line a visitor sees when they arrive from someone's invite link: the
 * landing used to look identical whether a friend sent you or not.
 */
import { describe, it, expect } from "vitest";
import { inviteGreeting } from "./invite-greeting";

describe("who invited you", () => {
  it("names the inviter by their display name, then their name, and falls back to 'A friend'", () => {
    expect(inviteGreeting({ display_name: "Maya Chen", name: "maya" })).toBe("Maya Chen invited you");
    expect(inviteGreeting({ name: "maya" })).toBe("maya invited you");
    // Profile not found (yet) or blank: never a raw key, never "undefined".
    expect(inviteGreeting(null)).toBe("A friend invited you");
    expect(inviteGreeting({ display_name: "   ", name: "" })).toBe("A friend invited you");
  });

  it("keeps a very long name from swallowing the landing", () => {
    const long = "M".repeat(80);
    expect(inviteGreeting({ display_name: long })).toBe(`${"M".repeat(40)}… invited you`);
  });
});
