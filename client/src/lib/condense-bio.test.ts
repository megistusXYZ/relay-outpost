/**
 * Profile bios on a phone show collapsed to three lines (owner, 2026-09-29:
 * some bios ran a screen long, with blank lines and one app per line, others
 * one line). Collapsed, blank lines are squeezed out so the three lines carry
 * words, not spacing; "Show more" gives back the author's own layout.
 */
import { describe, it, expect } from "vitest";
import { condenseBio } from "./condense-bio";

describe("condenseBio", () => {
  it("squeezes blank lines out, keeping one line per line of text", () => {
    const derek = "The purple pill helps the orange pill go down. \n\nDeveloper Relations at Soapbox.\n\n🪺 NostrNests.com\n🎙️ YakBak.app ";
    expect(condenseBio(derek)).toBe("The purple pill helps the orange pill go down.\nDeveloper Relations at Soapbox.\n🪺 NostrNests.com\n🎙️ YakBak.app");
  });

  it("handles Windows line ends and lines of only spaces", () => {
    expect(condenseBio("one\r\n   \r\ntwo")).toBe("one\ntwo");
  });

  it("leaves a one-line bio alone, and trims the ends", () => {
    expect(condenseBio("  bitcoin, nostr, coffee  ")).toBe("bitcoin, nostr, coffee");
  });
});
