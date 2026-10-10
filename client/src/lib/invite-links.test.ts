// Regression guard for the friend-invite capture bug: the inviter was dropped on the
// "/" route because capture was gated behind a non-"/" redirect branch. parseInviteParams
// is path-independent by construction — these tests lock that in (the "/" case is the
// one that was broken), plus the npub decode + outpost-relay extraction.
import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { parseInviteParams } from "./invite-links";

const HEX = "a".repeat(64);
const NPUB = nip19.npubEncode(HEX);

describe("parseInviteParams", () => {
  it("captures the inviter from ?inviter= even on the public '/' route", () => {
    expect(parseInviteParams(`?inviter=${NPUB}`, "/")).toEqual({ inviterHex: HEX, relayUrl: null });
  });

  it("extracts an outpost relay from an /outposts/<relay> path (channel invite)", () => {
    const relay = "wss://relay.example";
    const result = parseInviteParams(`?inviter=${NPUB}`, `/outposts/${encodeURIComponent(relay)}`);
    expect(result).toEqual({ inviterHex: HEX, relayUrl: relay });
  });

  it("returns null inviter for a malformed npub (never throws)", () => {
    expect(parseInviteParams("?inviter=not-an-npub", "/")).toEqual({ inviterHex: null, relayUrl: null });
  });

  it("returns nulls when there is no invite context", () => {
    expect(parseInviteParams("", "/feed")).toEqual({ inviterHex: null, relayUrl: null });
  });

  // An encrypted community lives at /outposts/c/<id>: "c" is a route segment,
  // not a relay. It used to be captured as the relay to join (owner audit,
  // 2026-10-10) and reached the say-hi join as "c".
  it("does not mistake an encrypted community's path for a relay", () => {
    expect(parseInviteParams(`?inviter=${NPUB}`, "/outposts/c/abc123")).toEqual({ inviterHex: HEX, relayUrl: null });
  });
});
