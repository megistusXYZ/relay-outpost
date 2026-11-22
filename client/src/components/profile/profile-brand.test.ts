/**
 * A profile's website gets a brand label (GitHub, X, YouTube, Telegram,
 * Fountain) only when the address is really that brand's site. The label was
 * matched by substring, so "github.evil.example" showed the GitHub mark and
 * name on a link to someone else's page.
 */
import { describe, expect, it } from "vitest";
import { brandFor } from "./ProfileDetailLink";

describe("brandFor", () => {
  it("names the brand for its own site and its subdomains", () => {
    expect(brandFor("https://github.com/alice").label).toBe("GitHub");
    expect(brandFor("https://gist.github.com/alice").label).toBe("GitHub");
    expect(brandFor("x.com/alice").label).toBe("X");
    expect(brandFor("https://twitter.com/alice").label).toBe("X");
    expect(brandFor("https://www.youtube.com/@alice").label).toBe("YouTube");
    expect(brandFor("https://youtu.be/abc").label).toBe("YouTube");
    expect(brandFor("https://t.me/alice").label).toBe("Telegram");
    expect(brandFor("https://telegram.me/alice").label).toBe("Telegram");
    expect(brandFor("https://fountain.fm/show/1").label).toBe("Fountain");
  });

  it("gives no brand to a look-alike address", () => {
    for (const u of [
      "https://github.evil.example/login",
      "https://my-github.com/alice",
      "https://twitter.com.evil.example",
      "https://youtube.example.net",
      "https://t.me.evil.example",
      "https://chat.telegram.evil.example",
      "https://notfountain.fm",
      "https://evil.example/github.com",
    ]) {
      expect(brandFor(u).label, u).toBeNull();
    }
  });
});
