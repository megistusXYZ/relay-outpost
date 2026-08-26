import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { resolveNostrEmbed, truncatePreservingNostr } from "./embed-resolution";

const PK = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const EVENT_ID = "a".repeat(64);

const naddr = nip19.decode(
  nip19.naddrEncode({ kind: 31923, pubkey: PK, identifier: "michigan-bitcoin-57", relays: [] })
);
const nevent = nip19.decode(nip19.neventEncode({ id: EVENT_ID }));
const note = nip19.decode(nip19.noteEncode(EVENT_ID));
const npub = nip19.decode(nip19.npubEncode(PK));

describe("resolveNostrEmbed — depth guard for embedded content", () => {
  it("naddr resolves to a (terminal) address-card at TOP level", () => {
    const r = resolveNostrEmbed(naddr, { nested: false });
    expect(r).toEqual({ render: "address-card", kind: 31923, pubkey: PK, identifier: "michigan-bitcoin-57", relays: [] });
  });

  it("naddr STILL resolves to an address-card when NESTED (terminal + safe)", () => {
    const r = resolveNostrEmbed(naddr, { nested: true });
    expect(r.render).toBe("address-card");
    if (r.render === "address-card") expect(r.kind).toBe(31923);
  });

  it("nevent resolves to a full recursive note-embed at TOP level", () => {
    expect(resolveNostrEmbed(nevent, { nested: false })).toMatchObject({ render: "note-embed", eventId: EVENT_ID });
  });

  it("nevent DOWNGRADES to a shallow note-chip when NESTED (no recursive EmbeddedNote)", () => {
    expect(resolveNostrEmbed(nevent, { nested: true })).toMatchObject({ render: "note-chip", eventId: EVENT_ID });
  });

  it("note resolves to note-embed at top level and note-chip when nested", () => {
    expect(resolveNostrEmbed(note, { nested: false })).toMatchObject({ render: "note-embed", eventId: EVENT_ID });
    expect(resolveNostrEmbed(note, { nested: true })).toMatchObject({ render: "note-chip", eventId: EVENT_ID });
  });

  it("npub is a mention at both depths", () => {
    expect(resolveNostrEmbed(npub, { nested: false })).toEqual({ render: "mention", pubkey: PK });
    expect(resolveNostrEmbed(npub, { nested: true })).toEqual({ render: "mention", pubkey: PK });
  });
});

describe("truncatePreservingNostr — never slice through a nostr token", () => {
  const naddrUri = "nostr:" + nip19.naddrEncode({ kind: 31923, pubkey: PK, identifier: "michigan-bitcoin-57", relays: [] });

  it("keeps a naddr token whole even past the visible-text cap", () => {
    const text = `Handled · Michigan Bitcoin Meetup #57 · ${naddrUri}`;
    const out = truncatePreservingNostr(text, 20);
    expect(out).toContain(naddrUri); // token intact and resolvable
  });

  it("does not truncate short content", () => {
    const text = "just a short note";
    expect(truncatePreservingNostr(text, 200)).toBe(text);
  });

  it("caps long plain text with an ellipsis", () => {
    const text = "x".repeat(500);
    const out = truncatePreservingNostr(text, 200);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(210);
  });
});
