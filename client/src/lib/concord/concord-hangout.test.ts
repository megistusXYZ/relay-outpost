import { describe, it, expect } from "vitest";
import { newHangoutUrl, hangoutCustom, hangoutOf, HANGOUT_KEY } from "./concord-hangout";
import { audioSpaceFromUrl } from "@/lib/audio-space";

describe("Hangout rooms: a voice room that lives inside a group's room", () => {
  it("a new hangout is a fresh, unguessable Corny Chat room that opens in the app", () => {
    const a = newHangoutUrl(), b = newHangoutUrl();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^https:\/\/cornychat\.com\/ro-[a-z0-9]{16}$/);
    expect(audioSpaceFromUrl(a)).toMatchObject({ service: "Corny Chat", embeddable: true });
  });

  it("is kept under this app's own key in the room's custom fields, and read back from there", () => {
    const url = newHangoutUrl();
    expect(Object.keys(hangoutCustom(url))).toEqual([HANGOUT_KEY]);
    expect(HANGOUT_KEY).toBe("relayoutpost/hangout");
    expect(hangoutOf({ custom: hangoutCustom(url) })).toMatchObject({ joinUrl: url, service: "Corny Chat", embeddable: true });
  });

  it("opens only a Corny Chat room, never another site someone put there", () => {
    for (const url of [
      "https://evil.example/ro-abc", "http://cornychat.com/ro-abc", "https://cornychat.com/", "https://cornychat.com.evil.example/x",
      "https://sub.cornychat.com/x", "https://nostrnests.com/ro-abc", "javascript:alert(1)", 42, null,
    ]) {
      expect(hangoutOf({ custom: { [HANGOUT_KEY]: { url } } })).toBeNull();
    }
  });

  it("a plain room has no hangout", () => {
    expect(hangoutOf(undefined)).toBeNull();
    expect(hangoutOf({})).toBeNull();
    expect(hangoutOf({ custom: { rules: "be kind" } })).toBeNull();
    expect(hangoutOf({ custom: { [HANGOUT_KEY]: "https://cornychat.com/ro-abc" } })).toBeNull();
  });
});
