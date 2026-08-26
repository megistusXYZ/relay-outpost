import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import {
  getContentWarning,
  getSensitiveContentSetting,
  isCwRevealed,
  markCwRevealed,
} from "./sensitive-content";

const ev = (over: Partial<Event> = {}): Event =>
  ({ id: "e1", pubkey: "a", created_at: 1, kind: 1, tags: [], content: "hi", sig: "", ...over }) as Event;

describe("getContentWarning", () => {
  it("returns null for an untagged post", () => {
    expect(getContentWarning(ev())).toBe(null);
  });

  it("returns the reason when the content-warning tag carries one", () => {
    expect(getContentWarning(ev({ tags: [["content-warning", "nsfw"]] }))).toBe("nsfw");
  });

  it("returns a default label when the tag has no reason", () => {
    expect(getContentWarning(ev({ tags: [["content-warning"]] }))).toBe("Sensitive Content");
  });
});

describe("getSensitiveContentSetting", () => {
  it("defaults to hide (true) when the setting is unset / storage unavailable", () => {
    expect(getSensitiveContentSetting()).toBe(true);
  });
});

describe("the in-feed sensitive gate decision", () => {
  // The card is blurred iff it is CW-tagged AND the setting is hide AND it has
  // not been revealed this session. This mirrors NostrPost's composition.
  const isGated = (event: Event, key: string) =>
    !!getContentWarning(event) && getSensitiveContentSetting() && !isCwRevealed(key);

  it("a CW-tagged post with the default (hide) setting is gated", () => {
    const post = ev({ id: "cw1", tags: [["content-warning", "nsfw"]] });
    expect(isGated(post, "cw1")).toBe(true);
  });

  it("an untagged post is never gated", () => {
    const post = ev({ id: "plain1" });
    expect(isGated(post, "plain1")).toBe(false);
  });

  it("revealing a key clears the gate for that key for the rest of the session", () => {
    const post = ev({ id: "cw2", tags: [["content-warning", "nsfw"]] });
    expect(isGated(post, "cw2")).toBe(true);
    markCwRevealed("cw2");
    expect(isCwRevealed("cw2")).toBe(true);
    expect(isGated(post, "cw2")).toBe(false);
    // a different post's gate is unaffected
    expect(isCwRevealed("cw3")).toBe(false);
  });
});
