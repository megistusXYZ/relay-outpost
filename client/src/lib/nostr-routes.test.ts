/**
 * Where a nostr id opens inside Relay Outpost. One mapping for everything
 * that needs it (owner, 2026-09-29: links to other Nostr clients should
 * always open natively). Before this, six places built their own /thread,
 * /profile, /articles and /live links, and articles sent EVERY naddr to the
 * article page whatever it was.
 */
import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { nostrRouteFor, bareNostrRoute, decodeThreadRef } from "./nostr-routes";

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

/**
 * relayop.xyz/nevent1… (an id pasted straight onto our domain, the way people
 * paste njump links) used to be a 404 for members and a bounce to the front
 * page for visitors.
 */
describe("bareNostrRoute", () => {
  const note = nip19.noteEncode(ID);
  const nevent = nip19.neventEncode({ id: ID, relays: ["wss://relay.damus.io"] });
  const nprofile = nip19.nprofileEncode({ pubkey: PK, relays: ["wss://nos.lol"] });

  it("sends each kind of id to its page", () => {
    expect(bareNostrRoute(`/${note}`)).toEqual({ to: `/thread/${note}`, decodes: true });
    expect(bareNostrRoute(`/${nevent}`)).toEqual({ to: `/thread/${nevent}`, decodes: true });
    expect(bareNostrRoute(`/${npub}`)).toEqual({ to: `/profile/${npub}`, decodes: true });
    expect(bareNostrRoute(`/${nprofile}`)).toEqual({ to: `/profile/${npub}`, decodes: true });
    expect(bareNostrRoute(`/${naddr(30023)}`)).toEqual({ to: `/articles/${naddr(30023)}`, decodes: true });
    expect(bareNostrRoute(`/${naddr(30311)}`)).toEqual({ to: `/live/${naddr(30311)}`, decodes: true });
    expect(bareNostrRoute(`/${naddr(34550)}`)).toEqual({ to: `/community/${naddr(34550)}`, decodes: true });
  });

  it("takes the nostr: form, raw or percent-encoded, a trailing slash, and capitals", () => {
    expect(bareNostrRoute(`/nostr:${npub}`)?.to).toBe(`/profile/${npub}`);
    expect(bareNostrRoute(`/nostr%3A${npub}`)?.to).toBe(`/profile/${npub}`);
    expect(bareNostrRoute(`/${npub}/`)?.to).toBe(`/profile/${npub}`);
    expect(bareNostrRoute(`/${npub.toUpperCase()}`)?.to).toBe(`/profile/${npub}`);
  });

  it("an id that doesn't decode can't be opened (and says it isn't an id)", () => {
    expect(bareNostrRoute("/npub1notreal")).toEqual({ to: null, decodes: false });
    expect(bareNostrRoute(`/${note.slice(0, -1)}x`)).toEqual({ to: null, decodes: false });
    expect(bareNostrRoute("/nevent1")).toEqual({ to: null, decodes: false });
  });

  it("an id we have no page for decodes but can't be opened", () => {
    expect(bareNostrRoute(`/${naddr(31922)}`)).toEqual({ to: null, decodes: true });
  });

  it("leaves every other path alone", () => {
    for (const p of ["/", "/search", "/notifications", "/notes", "/npub", "/thread/" + note, "/profile/" + npub, `/${npub}/extra`, "/hello"]) {
      expect(bareNostrRoute(p), p).toBeNull();
    }
  });
});

describe("decodeThreadRef", () => {
  it("reads note, nevent (with relay hints), nostr: and hex", () => {
    expect(decodeThreadRef(nip19.noteEncode(ID))).toEqual({ id: ID, relays: [] });
    expect(decodeThreadRef(nip19.neventEncode({ id: ID, relays: ["wss://relay.damus.io"] }))).toEqual({ id: ID, relays: ["wss://relay.damus.io"] });
    expect(decodeThreadRef(`nostr:${nip19.noteEncode(ID)}`)).toEqual({ id: ID, relays: [] });
    expect(decodeThreadRef(ID.toUpperCase())).toEqual({ id: ID, relays: [] });
  });

  it("anything else names no post: the thread page says the link can't be opened instead of searching relays", () => {
    // These used to come back as { id: <the junk> } and send a relay search for it.
    expect(decodeThreadRef("note1notreal")).toBeNull();
    expect(decodeThreadRef("hello")).toBeNull();
    expect(decodeThreadRef("abc123")).toBeNull();
    expect(decodeThreadRef(npub)).toBeNull();
    expect(decodeThreadRef("")).toBeNull();
  });
});
