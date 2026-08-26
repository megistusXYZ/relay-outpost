import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { classifyScannedValue } from "./qr-scan";

const ORIGIN = "https://relayop.xyz";
const PUBKEY = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NPUB = nip19.npubEncode(PUBKEY);
const NPROFILE = nip19.nprofileEncode({ pubkey: PUBKEY, relays: ["wss://relay.damus.io"] });
const NADDR = nip19.naddrEncode({ kind: 33301, pubkey: PUBKEY, identifier: "" });

describe("classifyScannedValue", () => {
  it("navigates a same-origin invite URL, preserving the secret fragment", () => {
    const r = classifyScannedValue(`${ORIGIN}/invite/${NADDR}#BAEAqof2xw5uNJZ2WJa1oxUq3g`, ORIGIN);
    expect(r).toEqual({ kind: "invite", path: `/invite/${NADDR}#BAEAqof2xw5uNJZ2WJa1oxUq3g` });
  });

  it("re-roots a FOREIGN-host invite URL onto our internal /invite route (never the foreign origin)", () => {
    const r = classifyScannedValue(`https://armada.buzz/invite/${NADDR}#frag`, ORIGIN);
    expect(r).toEqual({ kind: "invite", path: `/invite/${NADDR}#frag` });
  });

  it("normalizes a foreign invite's uppercase naddr and drops foreign query params", () => {
    const r = classifyScannedValue(`https://armada.buzz/invite/${NADDR.toUpperCase()}?utm_source=x#frag`, ORIGIN);
    expect(r).toEqual({ kind: "invite", path: `/invite/${NADDR}#frag` });
  });

  it("still confirms a foreign /invite URL whose naddr is corrupted", () => {
    const bad = NADDR.slice(0, -4) + "qqqq";
    const r = classifyScannedValue(`https://armada.buzz/invite/${bad}#frag`, ORIGIN);
    expect(r.kind).toBe("other");
  });

  it("still confirms foreign non-invite paths and /invite with extra segments", () => {
    expect(classifyScannedValue("https://armada.buzz/join/whatever", ORIGIN).kind).toBe("other");
    expect(classifyScannedValue(`https://armada.buzz/invite/${NADDR}/extra`, ORIGIN).kind).toBe("other");
  });

  it("accepts a bare naddr with fragment", () => {
    expect(classifyScannedValue(`${NADDR}#BAEAfrag`, ORIGIN)).toEqual({ kind: "invite", path: `/invite/${NADDR}#BAEAfrag` });
  });

  it("accepts a bare naddr without fragment", () => {
    expect(classifyScannedValue(NADDR, ORIGIN)).toEqual({ kind: "invite", path: `/invite/${NADDR}` });
  });

  it("rejects a corrupted naddr (bad checksum) as other", () => {
    const bad = NADDR.slice(0, -4) + "qqqq";
    expect(classifyScannedValue(bad, ORIGIN).kind).toBe("other");
  });

  it("routes an npub to the profile page", () => {
    expect(classifyScannedValue(NPUB, ORIGIN)).toEqual({ kind: "profile", path: `/profile/${NPUB}` });
  });

  it("strips a nostr: prefix and handles uppercase bech32", () => {
    expect(classifyScannedValue(`nostr:${NPUB.toUpperCase()}`, ORIGIN)).toEqual({ kind: "profile", path: `/profile/${NPUB}` });
  });

  it("normalizes an nprofile to the npub profile route", () => {
    expect(classifyScannedValue(NPROFILE, ORIGIN)).toEqual({ kind: "profile", path: `/profile/${NPUB}` });
  });

  it("rejects an invalid npub as other", () => {
    expect(classifyScannedValue("npub1invalidinvalidinvalid", ORIGIN).kind).toBe("other");
  });

  it("returns foreign http(s) URLs as other WITH an openable url", () => {
    const r = classifyScannedValue("https://example.com/some/page", ORIGIN);
    expect(r).toEqual({ kind: "other", value: "https://example.com/some/page", url: "https://example.com/some/page" });
  });

  it("same-origin non-invite paths still require confirmation", () => {
    const r = classifyScannedValue(`${ORIGIN}/settings`, ORIGIN);
    expect(r.kind).toBe("other");
  });

  it("never marks non-http schemes as openable", () => {
    const js = classifyScannedValue("javascript:alert(1)", ORIGIN);
    expect(js).toEqual({ kind: "other", value: "javascript:alert(1)", url: null });
    const ln = classifyScannedValue("lightning:lnbc10n1p...", ORIGIN);
    expect(ln.kind).toBe("other");
    if (ln.kind === "other") expect(ln.url).toBeNull();
  });

  it("plain text and empty values are other with no url", () => {
    expect(classifyScannedValue("hello world", ORIGIN)).toEqual({ kind: "other", value: "hello world", url: null });
    expect(classifyScannedValue("   ", ORIGIN)).toEqual({ kind: "other", value: "", url: null });
  });
});
