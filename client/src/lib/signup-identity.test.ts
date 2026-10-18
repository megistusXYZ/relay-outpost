/**
 * A new account starts with a name, a photo and a banner already chosen
 * (owner, 2026-10-17): "make it seamless for users to create an account — if
 * they care they will update it then or change it later". Nothing on the
 * first step has to be typed; everything can be shuffled or replaced; and
 * what was chosen is what the profile publishes, so other apps show it too.
 */
import { describe, it, expect } from "vitest";
import {
  friendlyName,
  seededRandom,
  avatarSvg,
  SIGNUP_BANNERS,
  nextBanner,
  signupMetadata,
} from "./signup-identity";

describe("friendlyName", () => {
  it("is two capitalised words, an adjective then a noun", () => {
    const name = friendlyName(seededRandom(7));
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("is the same for the same seed and varies across seeds", () => {
    expect(friendlyName(seededRandom(42))).toBe(friendlyName(seededRandom(42)));
    const names = new Set(Array.from({ length: 60 }, (_, i) => friendlyName(seededRandom(i + 1))));
    expect(names.size).toBeGreaterThan(40);
  });

  it("fits the 50-character name field", () => {
    for (let i = 1; i <= 200; i++) expect(friendlyName(seededRandom(i)).length).toBeLessThanOrEqual(50);
  });
});

describe("avatarSvg", () => {
  it("is a self-contained square picture: no links to anything outside it", () => {
    const svg = avatarSvg(11);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).not.toMatch(/href=|url\(http|<image|<script/);
  });

  it("is the same for the same seed and differs between seeds", () => {
    expect(avatarSvg(5)).toBe(avatarSvg(5));
    const pictures = new Set(Array.from({ length: 20 }, (_, i) => avatarSvg(i + 1)));
    expect(pictures.size).toBe(20);
  });
});

describe("the banner set", () => {
  it("offers several banners, all served by the app", () => {
    expect(SIGNUP_BANNERS.length).toBeGreaterThanOrEqual(4);
    for (const b of SIGNUP_BANNERS) expect(b.src).toMatch(/^\/images\/banners\/[a-z-]+\.jpg$/);
    expect(new Set(SIGNUP_BANNERS.map((b) => b.src)).size).toBe(SIGNUP_BANNERS.length);
  });

  it("cycles: the next after the last is the first", () => {
    expect(nextBanner(0)).toBe(1);
    expect(nextBanner(SIGNUP_BANNERS.length - 1)).toBe(0);
  });
});

describe("signupMetadata", () => {
  it("uses the suggested name when nothing was typed", () => {
    const m = signupMetadata({ typedName: "  ", suggestedName: "Quiet Otter", username: "" });
    expect(m.display_name).toBe("Quiet Otter");
    expect(m.name).toBe("Quiet Otter");
  });

  it("prefers what the person typed, and a username when they gave one", () => {
    const m = signupMetadata({ typedName: " Mara ", suggestedName: "Quiet Otter", username: "mara_q" });
    expect(m.display_name).toBe("Mara");
    expect(m.name).toBe("mara_q");
  });

  it("publishes the photo and banner it was given, and omits empty fields", () => {
    const m = signupMetadata({
      typedName: "", suggestedName: "Quiet Otter", username: "",
      photoUrl: "https://media.example/a.png", bannerUrl: "https://media.example/b.jpg", bio: " ", website: "",
    });
    expect(m.picture).toBe("https://media.example/a.png");
    expect(m.banner).toBe("https://media.example/b.jpg");
    expect("about" in m).toBe(false);
    expect("website" in m).toBe(false);
  });
});
