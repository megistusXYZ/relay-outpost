/**
 * Where a nostr id opens inside Relay Outpost. One mapping for everything
 * that needs it (owner, 2026-09-29: links to other Nostr clients should
 * always open natively). Before this, six places built their own /thread,
 * /profile, /articles and /live links, and articles sent EVERY naddr to the
 * article page whatever it was.
 */
import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { nostrRouteFor } from "./nostr-routes";

const PK = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const ID = "b".repeat(64);
const npub = nip19.npubEncode(PK);
const naddr = (kind: number) => nip19.naddrEncode({ kind, pubkey: PK, identifier: "x" });

describe("nostrRouteFor", () => {
  it("notes open the thread page", () => {
    const note = nip19.noteEncode(ID);
    const nevent = nip19.neventEncode({ id: ID, relays: ["wss://relay.damus.io"] });
    expect(nostrRouteFor(note)).toBe(`/thread/${note}`);
    expect(nostrRouteFor(nevent)).toBe(`/thread/${nevent}`);
  });

  it("people open their profile, by npub (the profile page doesn't take nprofile)", () => {
    expect(nostrRouteFor(npub)).toBe(`/profile/${npub}`);
    expect(nostrRouteFor(nip19.nprofileEncode({ pubkey: PK, relays: ["wss://nos.lol"] }))).toBe(`/profile/${npub}`);
  });

  it("addressable events open the page for their kind", () => {
    expect(nostrRouteFor(naddr(30023))).toBe(`/articles/${naddr(30023)}`);
    expect(nostrRouteFor(naddr(30311))).toBe(`/live/${naddr(30311)}`);
    expect(nostrRouteFor(naddr(34550))).toBe(`/community/${naddr(34550)}`);
  });

  it("kinds we have no page for yet have no route (they stay native cards; the link isn't hijacked)", () => {
    expect(nostrRouteFor(naddr(31922))).toBeNull(); // calendar event
    expect(nostrRouteFor(naddr(30402))).toBeNull(); // marketplace listing
  });

  it("accepts the nostr: form too", () => {
    expect(nostrRouteFor(`nostr:${npub}`)).toBe(`/profile/${npub}`);
  });

  it("anything that isn't a valid id has no route", () => {
    expect(nostrRouteFor("npub1notreal")).toBeNull();
    expect(nostrRouteFor("hello")).toBeNull();
    expect(nostrRouteFor("")).toBeNull();
  });
});
