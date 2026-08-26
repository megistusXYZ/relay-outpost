// Regression: the Trust Reviews "By you" tab white-screened (React ErrorBoundary)
// when a vouch subject's kind-0 profile was malformed. applesauce's
// getDisplayName/getProfilePicture call `(...)?.trim()` on the raw metadata
// fields and npubEncode() on the event pubkey, so a numeric `name`/`picture` (or
// a non-hex pubkey) threw inside a render-phase useMemo and took down the whole
// tab. resolveProfileDisplay must resolve those to a fallback WITHOUT throwing.

import { describe, it, expect } from "vitest";
import { resolveProfileDisplay } from "./nostr-helpers";
import type { Event } from "nostr-tools";

const VALID_PK = "0".repeat(64);
const FALLBACK = "npub1abc…xyz";

const mkKind0 = (content: string, pubkey = VALID_PK): Event =>
  ({ id: "a".repeat(64), pubkey, kind: 0, tags: [], content, created_at: 0, sig: "b".repeat(128) } as Event);

describe("resolveProfileDisplay", () => {
  it("resolves a well-formed profile", () => {
    const r = resolveProfileDisplay(mkKind0(JSON.stringify({ name: "Alice", picture: "https://example.com/a.png" })), FALLBACK);
    expect(r.name).toBe("Alice");
    expect(r.avatar).toContain("a.png");
  });

  it("uses the fallback when there is no event", () => {
    expect(resolveProfileDisplay(undefined, FALLBACK)).toEqual({ name: FALLBACK, avatar: "" });
  });

  it("stays graceful when a valid profile has no usable name", () => {
    // applesauce's getDisplayName supplies its own shortened-npub when a parseable
    // profile has no name — the point here is simply that nothing throws and we
    // never surface an empty name.
    let r!: ReturnType<typeof resolveProfileDisplay>;
    expect(() => { r = resolveProfileDisplay(mkKind0(JSON.stringify({ about: "hi" })), FALLBACK); }).not.toThrow();
    expect(r.name.length).toBeGreaterThan(0);
  });

  // The exact crash: `123?.trim()` is not a function.
  it("does not throw on a numeric name — falls back", () => {
    let r!: ReturnType<typeof resolveProfileDisplay>;
    expect(() => { r = resolveProfileDisplay(mkKind0(JSON.stringify({ name: 123 })), FALLBACK); }).not.toThrow();
    expect(r.name).toBe(FALLBACK);
  });

  it("does not throw on a numeric picture — keeps the name, empty avatar", () => {
    let r!: ReturnType<typeof resolveProfileDisplay>;
    expect(() => { r = resolveProfileDisplay(mkKind0(JSON.stringify({ name: "Bob", picture: 42 })), FALLBACK); }).not.toThrow();
    expect(r.name).toBe("Bob");
    expect(r.avatar).toBe("");
  });

  // getDisplayName runs npubEncode(pubkey) when no fallback is passed.
  it("does not throw on a non-hex pubkey — falls back", () => {
    let r!: ReturnType<typeof resolveProfileDisplay>;
    expect(() => { r = resolveProfileDisplay(mkKind0("{}", "not-valid-hex"), FALLBACK); }).not.toThrow();
    expect(r.name).toBe(FALLBACK);
  });

  it("does not throw on non-JSON profile content", () => {
    let r!: ReturnType<typeof resolveProfileDisplay>;
    expect(() => { r = resolveProfileDisplay(mkKind0("this is not json"), FALLBACK); }).not.toThrow();
    expect(r.name.length).toBeGreaterThan(0);
  });
});
