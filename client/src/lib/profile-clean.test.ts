/**
 * A stranger's profile is whatever they published (owner, 2026-10-07): a name
 * that's a number, a picture that's an object. Those took down every thread
 * they posted in, and their profile page — the profile library's helpers call
 * .trim() on them. Every standard text field is text, or absent.
 */
import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { getDisplayName, getRealName, getProfilePicture, getAvatarUrl, getProfileContent } from "./nostr-helpers";

const profile = (content: string) => finalizeEvent({ kind: 0, created_at: 1, tags: [], content }, generateSecretKey());

describe("a profile with the wrong kinds of values", () => {
  it("a name or display name that isn't text falls back to the short npub, never crashes", () => {
    for (const c of ['{"name":42}', '{"display_name":{"a":1}}', '{"name":["x"],"display_name":7}']) {
      const ev = profile(c);
      const name = getDisplayName(ev);
      expect(typeof name, c).toBe("string");
      expect(name, c).toMatch(/^npub1/);
      expect(getRealName(ev), c).toMatch(/^npub1/);
    }
  });
  it("a picture that isn't text means no picture", () => {
    const ev = profile('{"name":"Pat","picture":{"url":"https://x"}}');
    expect(getProfilePicture(ev)).toBeUndefined();
    expect(getAvatarUrl(ev)).toBeUndefined();
    expect(getDisplayName(ev)).toBe("Pat");
  });
  it("about, website, banner, nip05 and lightning addresses that aren't text are left out", () => {
    const c = getProfileContent(profile('{"name":"Pat","about":["x"],"website":9,"banner":3,"nip05":{"x":1},"lud16":7,"lud06":false}'));
    expect(c).toMatchObject({ name: "Pat" });
    for (const f of ["about", "website", "banner", "nip05", "lud16", "lud06"]) expect(c?.[f as keyof typeof c], f).toBeUndefined();
  });
  it("a well-formed profile is untouched", () => {
    const c = getProfileContent(profile('{"name":"Pat","about":"Hi","picture":"https://p.example/a.png","website":"https://pat.example","bot":true}'));
    expect(c).toMatchObject({ name: "Pat", about: "Hi", picture: "https://p.example/a.png", website: "https://pat.example" });
    expect((c as Record<string, unknown>).bot).toBe(true);
  });
});
