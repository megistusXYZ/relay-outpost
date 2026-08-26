import { describe, it, expect } from "vitest";
import { deriveGroupId } from "./nip29";

/**
 * A group id is the one field in the create form with a rule enforced on the
 * OTHER side of the wire: `invalid: a group event must carry an "h" tag`. These
 * tests pin the shape so a create button can never again offer an action that
 * only the relay knows is impossible.
 */
describe("deriveGroupId", () => {
  it("slugifies a human name", () => {
    expect(deriveGroupId("Moderation Test")).toMatch(/^moderation-test-[a-z0-9]{1,6}$/);
  });

  it("never returns empty, whatever it is given", () => {
    // The whole bug: an empty id produced a signed event no relay can accept.
    for (const input of ["", "   ", "!!!", "😀😀", "---"]) {
      expect(deriveGroupId(input).length).toBeGreaterThan(0);
      expect(deriveGroupId(input)).not.toMatch(/^-/);
    }
  });

  it("falls back to a legal stem when the name slugs to nothing", () => {
    // Emoji-only names are real. Without the stem this produced a bare "-x7f2q3",
    // which is a legal string but a nonsense address.
    expect(deriveGroupId("🎉🎉🎉")).toMatch(/^group-[a-z0-9]{1,6}$/);
  });

  it("collapses punctuation runs instead of stacking separators", () => {
    expect(deriveGroupId("Dev // Chat")).toMatch(/^dev-chat-[a-z0-9]{1,6}$/);
  });

  it("trims leading and trailing separators", () => {
    const id = deriveGroupId("  -- Hello --  ");
    expect(id).toMatch(/^hello-[a-z0-9]{1,6}$/);
  });

  it("is URL-safe: lowercase alphanumerics and hyphens only", () => {
    const id = deriveGroupId("Ünicode Ströße & Symbols!");
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id).toBe(encodeURIComponent(id));
  });

  it("caps the slug so a pasted paragraph can't become an id", () => {
    const id = deriveGroupId("x".repeat(500));
    // 40-char slug + "-" + up to 6 of suffix.
    expect(id.length).toBeLessThanOrEqual(47);
  });

  it("gives two rooms of the same name different ids", () => {
    // NIP-29 ids are unique per relay. Without the suffix the second person to
    // create a "General" silently collides with the first one's room.
    const ids = new Set(Array.from({ length: 50 }, () => deriveGroupId("General")));
    expect(ids.size).toBeGreaterThan(45);
  });
});
