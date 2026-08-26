import { describe, it, expect } from "vitest";
import { nostrRefFromUrl, normalizeNostrClientLinks } from "./nostr-client-links";

// Valid bech32 fixtures (checksummed; generated via nostr-tools nip19).
const NOTE = "note1424242424242424242424242424242424242424242424242424sesga3f";
const NEVENT = "nevent1qqs242424242424242424242424242424242424242424242424242cqv48sh";
const NADDR = "naddr1qvzqqqr4gupzpnxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxdqq9x67fdv9e8g6trd3jskqk5tm";
const NPUB = "npub1enxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxsxtfw73";

describe("nostrRefFromUrl", () => {
  it("pulls a note out of an njump path link", () => {
    expect(nostrRefFromUrl(`https://njump.me/${NOTE}`)).toBe(`nostr:${NOTE}`);
  });

  it("pulls an nevent out of a nostrudel hash-route link", () => {
    expect(nostrRefFromUrl(`https://nostrudel.ninja/#/n/${NEVENT}`)).toBe(`nostr:${NEVENT}`);
  });

  it("pulls an naddr out of a primal /e/ link", () => {
    expect(nostrRefFromUrl(`https://primal.net/e/${NADDR}`)).toBe(`nostr:${NADDR}`);
  });

  it("pulls an npub out of a profile link (becomes a mention)", () => {
    expect(nostrRefFromUrl(`https://njump.me/${NPUB}`)).toBe(`nostr:${NPUB}`);
  });

  it("returns null for an ordinary link with no nostr entity", () => {
    expect(nostrRefFromUrl("https://example.com/blog/hello-world")).toBeNull();
  });

  it("returns null for an image URL (no false positive)", () => {
    expect(nostrRefFromUrl("https://nostr.build/i/abc123.jpg")).toBeNull();
  });

  it("returns null for a path segment that looks bech32-ish but fails the checksum", () => {
    // 'note1' prefix but garbage body — must not decode.
    expect(nostrRefFromUrl("https://njump.me/note1thisisnotarealchecksum")).toBeNull();
  });

  it("ignores non-http(s) protocols", () => {
    expect(nostrRefFromUrl(`ftp://njump.me/${NOTE}`)).toBeNull();
  });
});

describe("normalizeNostrClientLinks", () => {
  it("rewrites a web-client link in prose to its nostr: form", () => {
    const input = `look at this https://njump.me/${NEVENT} great post`;
    expect(normalizeNostrClientLinks(input)).toBe(`look at this nostr:${NEVENT} great post`);
  });

  it("preserves trailing sentence punctuation outside the rewritten ref", () => {
    const input = `see https://nostrudel.ninja/#/n/${NOTE}.`;
    expect(normalizeNostrClientLinks(input)).toBe(`see nostr:${NOTE}.`);
  });

  it("leaves ordinary links untouched", () => {
    const input = "read https://example.com/article and https://foo.dev";
    expect(normalizeNostrClientLinks(input)).toBe(input);
  });

  it("leaves content with no links untouched (fast path)", () => {
    expect(normalizeNostrClientLinks("just some plain text")).toBe("just some plain text");
  });

  it("rewrites multiple client links in one post", () => {
    const input = `a https://njump.me/${NOTE} b https://primal.net/e/${NEVENT} c`;
    expect(normalizeNostrClientLinks(input)).toBe(`a nostr:${NOTE} b nostr:${NEVENT} c`);
  });
});
