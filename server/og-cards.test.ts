import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { excerptForCard, profileCardMeta, followingCountFromTags, firstPostImageUrl, resolveMentions } from "./og-cards";

describe("excerptForCard", () => {
  it("returns short content unchanged", () => {
    expect(excerptForCard("Hello Nostr")).toBe("Hello Nostr");
  });

  it("returns empty string for empty/undefined-ish content", () => {
    expect(excerptForCard("")).toBe("");
    expect(excerptForCard("   \n  ")).toBe("");
  });

  it("strips http(s) URLs", () => {
    expect(excerptForCard("check this https://example.com/a.png out")).toBe("check this out");
  });

  it("strips nostr: references", () => {
    expect(excerptForCard("quoting nostr:nevent1qqsabc123 here")).toBe("quoting here");
  });

  it("collapses whitespace and newlines", () => {
    expect(excerptForCard("line one\n\nline   two\tend")).toBe("line one line two end");
  });

  it("truncates at a word boundary with an ellipsis", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = excerptForCard(words, 200);
    expect(out.length).toBeLessThanOrEqual(201); // 200 + ellipsis char
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/); // no dangling space before ellipsis
    // cut lands between words, not mid-word
    const body = out.slice(0, -1);
    expect(words.startsWith(body)).toBe(true);
    expect(words[body.length]).toBe(" ");
  });

  it("hard-truncates a single unbroken run rather than returning nothing", () => {
    const long = "a".repeat(400);
    const out = excerptForCard(long, 200);
    expect(out.length).toBe(201);
    expect(out.endsWith("…")).toBe(true);
  });

  it("content that is only links collapses to empty (renderer supplies fallback copy)", () => {
    expect(excerptForCard("https://a.example/img.jpg https://b.example/img2.jpg")).toBe("");
  });
});

describe("profileCardMeta", () => {
  const pubkey = "b0635d6a9851d3aed0cd6c495b282167acf761729078d975fc341b22650b07b9";

  it("prefers display_name over name", () => {
    const meta = profileCardMeta(JSON.stringify({ display_name: "Alice", name: "alice99", picture: "https://x.example/a.jpg" }), pubkey);
    expect(meta.name).toBe("Alice");
    expect(meta.picture).toBe("https://x.example/a.jpg");
  });

  it("falls back to name, then shortened pubkey", () => {
    expect(profileCardMeta(JSON.stringify({ name: "bob" }), pubkey).name).toBe("bob");
    expect(profileCardMeta(JSON.stringify({}), pubkey).name).toBe("b0635d6a…07b9");
  });

  it("survives malformed JSON and missing content", () => {
    expect(profileCardMeta("not-json{{", pubkey).name).toBe("b0635d6a…07b9");
    expect(profileCardMeta(undefined, pubkey).name).toBe("b0635d6a…07b9");
    expect(profileCardMeta(undefined, "").name).toBe("A Relay Outpost user");
  });

  it("rejects non-http picture values", () => {
    expect(profileCardMeta(JSON.stringify({ name: "eve", picture: "javascript:alert(1)" }), pubkey).picture).toBe("");
    expect(profileCardMeta(JSON.stringify({ name: "eve", picture: 42 }), pubkey).picture).toBe("");
  });

  it("caps absurdly long names", () => {
    const meta = profileCardMeta(JSON.stringify({ name: "x".repeat(100) }), pubkey);
    expect(meta.name.length).toBeLessThanOrEqual(40);
    expect(meta.name.endsWith("…")).toBe(true);
  });

  it("extracts nip05, collapsing _@domain shorthand to the bare domain", () => {
    expect(profileCardMeta(JSON.stringify({ name: "a", nip05: "alice@example.com" }), pubkey).nip05).toBe("alice@example.com");
    expect(profileCardMeta(JSON.stringify({ name: "a", nip05: " _@example.com " }), pubkey).nip05).toBe("example.com");
  });

  it("ignores non-string nip05 and caps overlong values", () => {
    expect(profileCardMeta(JSON.stringify({ name: "a", nip05: 42 }), pubkey).nip05).toBe("");
    expect(profileCardMeta(JSON.stringify({ name: "a" }), pubkey).nip05).toBe("");
    const long = profileCardMeta(JSON.stringify({ name: "a", nip05: `${"x".repeat(80)}@example.com` }), pubkey).nip05;
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("…")).toBe(true);
  });

  it("passes about through raw (excerpting happens at render) and defaults it empty", () => {
    expect(profileCardMeta(JSON.stringify({ name: "a", about: "I build relays.\n\nhttps://x.example" }), pubkey).about)
      .toBe("I build relays.\n\nhttps://x.example");
    expect(profileCardMeta(JSON.stringify({ name: "a", about: 7 }), pubkey).about).toBe("");
    expect(profileCardMeta(undefined, pubkey).about).toBe("");
  });
});

describe("followingCountFromTags", () => {
  const pk = (n: number) => n.toString(16).padStart(64, "0");

  it("counts valid p tags", () => {
    expect(followingCountFromTags([["p", pk(1)], ["p", pk(2)], ["p", pk(3)]])).toBe(3);
  });

  it("dedupes repeated pubkeys, case-insensitively", () => {
    const upper = "AB".repeat(32);
    expect(followingCountFromTags([["p", upper], ["p", upper.toLowerCase()], ["p", pk(9)]])).toBe(2);
  });

  it("ignores non-p tags and malformed entries", () => {
    expect(followingCountFromTags([
      ["e", pk(1)],
      ["p"],                      // missing value
      ["p", "not-hex"],
      ["p", pk(1).slice(0, 60)],  // wrong length
      ["p", 123 as unknown as string],
      "junk" as unknown as string[],
      ["p", pk(4)],
    ])).toBe(1);
  });

  it("returns 0 for missing/malformed tag arrays", () => {
    expect(followingCountFromTags(undefined)).toBe(0);
    expect(followingCountFromTags(null)).toBe(0);
    expect(followingCountFromTags("nope")).toBe(0);
    expect(followingCountFromTags([])).toBe(0);
  });
});

describe("excerptForCard as profile about-excerpt (140 cap)", () => {
  it("caps a long bio at ~140 chars on a word boundary", () => {
    const bio = Array.from({ length: 40 }, (_, i) => `bio${i}`).join(" ");
    const out = excerptForCard(bio, 140);
    expect(out.length).toBeLessThanOrEqual(141);
    expect(out.endsWith("…")).toBe(true);
    expect(bio.startsWith(out.slice(0, -1))).toBe(true);
  });
});

describe("firstPostImageUrl", () => {
  it("returns null for a text-only post", () => {
    expect(firstPostImageUrl({ content: "just words here", tags: [] })).toBeNull();
  });

  it("finds an image URL in the content", () => {
    expect(firstPostImageUrl({ content: "look https://cdn.example/pic.jpg nice", tags: [] }))
      .toBe("https://cdn.example/pic.jpg");
  });

  it("ignores a non-image link in content but uses an imeta image tag", () => {
    const ev = { content: "see https://example.com/article", tags: [["imeta", "url https://blossom.example/abc", "m image/webp"]] };
    expect(firstPostImageUrl(ev)).toBe("https://blossom.example/abc");
  });

  it("skips a non-image imeta (e.g. video)", () => {
    expect(firstPostImageUrl({ content: "clip", tags: [["imeta", "url https://x/v.mp4", "m video/mp4"]] })).toBeNull();
  });
});

describe("resolveMentions", () => {
  const PK = "1".repeat(63) + "a";
  const npub = nip19.npubEncode(PK);
  const stub = (name: string) => async () => ({ content: JSON.stringify({ display_name: name }) });

  it("replaces a nostr:npub mention with @DisplayName", async () => {
    const out = await resolveMentions(`nostr:${npub} testing`, stub("Nathan Day"));
    expect(out).toBe("@Nathan Day testing");
  });

  it("leaves content with no mentions untouched (no fetch)", async () => {
    let called = false;
    const out = await resolveMentions("plain text, no mentions", async () => { called = true; return null; });
    expect(out).toBe("plain text, no mentions");
    expect(called).toBe(false);
  });

  it("falls back to a short id when the profile can't be resolved", async () => {
    const out = await resolveMentions(`hi nostr:${npub}`, async () => null);
    expect(out).toContain("@");
    expect(out).not.toContain("nostr:");
  });
});
