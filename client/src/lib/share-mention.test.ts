import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { createShareMention } from "./share-mention";

const PUBKEY = "64431ecb2249877590b0e71105d6dc00437f40c2015f0555a29d44ec160bdef0";
const NPUB = nip19.npubEncode(PUBKEY);

describe("createShareMention", () => {
  it("shows a friendly @Name in the prefill, no raw npub", () => {
    const mention = createShareMention(PUBKEY, "Alice Writer")!;
    const prefill = `My Village\n\nby ${mention.display}\n\nhttps://example.com/a`;
    expect(prefill).not.toContain("npub1");
    // Visible text (invisible marker stripped) reads as a plain @mention.
    expect(prefill.replace(/[\u200B\u200C]/g, "")).toBe(
      "My Village\n\nby @Alice Writer\n\nhttps://example.com/a"
    );
  });

  it("resolves the prefilled mention to a nostr:npub token at publish time", () => {
    const mention = createShareMention(PUBKEY, "Alice Writer")!;
    const content = `My Village\n\nby ${mention.display}\n\nhttps://example.com/a`;
    expect(mention.resolve(content)).toBe(
      `My Village\n\nby nostr:${NPUB}\n\nhttps://example.com/a`
    );
  });

  it("leaves user-typed text alone when the mention was deleted or coincides with the name", () => {
    const mention = createShareMention(PUBKEY, "Alice Writer")!;
    // User removed the mention and typed the same name manually.
    expect(mention.resolve("I met @Alice Writer today")).toBe("I met @Alice Writer today");
    // Coincidental same-name text survives while the prefilled mention resolves.
    const mixed = `ask @Alice Writer — by ${mention.display}`;
    expect(mention.resolve(mixed)).toBe(`ask @Alice Writer — by nostr:${NPUB}`);
  });

  it("strips leftover invisible markers even if the mention text was edited", () => {
    const mention = createShareMention(PUBKEY, "Alice")!;
    const edited = `by ${mention.display}`.replace("@Alice", "@Alicia");
    const resolved = mention.resolve(edited);
    expect(resolved).toBe("by @Alicia");
    expect(resolved).not.toMatch(/[\u200B\u200C]/);
  });

  it("returns null for an invalid pubkey", () => {
    expect(createShareMention("not-a-pubkey", "X")).toBeNull();
  });

  it("gives each mention a distinct marker so it never rewrites another mention's text", () => {
    // Each share dialog creates exactly one mention; distinct markers ensure a
    // dialog's resolve() can't accidentally rewrite same-name text that came
    // from anywhere else.
    const a = createShareMention(PUBKEY, "Same Name")!;
    const b = createShareMention("82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2", "Same Name")!;
    expect(a.display).not.toBe(b.display);
    const resolved = a.resolve(`${a.display} and ${b.display}`);
    expect(resolved).toBe(`nostr:${NPUB} and @Same Name`);
  });
});
