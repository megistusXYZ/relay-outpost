import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { detectGroupInvite, parseInviteUrl } from "./invite-detect";
import { parseInviteUrl as reExported } from "./concord-invites";

const PUBKEY = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NADDR = nip19.naddrEncode({ kind: 33301, pubkey: PUBKEY, identifier: "" });
const WRONG_KIND_NADDR = nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier: "post" });
const FRAG = "BAEAqof2xw5uNJZ2WJa1oxUq3g";

describe("detectGroupInvite", () => {
  it("recognizes an invite minted by ANOTHER Concord client (armada.buzz)", () => {
    const t = detectGroupInvite(`https://armada.buzz/invite/${NADDR}#${FRAG}`);
    expect(t).toEqual({
      naddr: NADDR,
      fragment: FRAG,
      host: "armada.buzz",
      path: `/invite/${NADDR}#${FRAG}`,
    });
  });

  it("recognizes our own host too (host-agnostic by design)", () => {
    const t = detectGroupInvite(`https://relayop.xyz/invite/${NADDR}#${FRAG}`);
    expect(t?.host).toBe("relayop.xyz");
    expect(t?.path).toBe(`/invite/${NADDR}#${FRAG}`);
  });

  it("strips a www. prefix from the displayed host", () => {
    expect(detectGroupInvite(`https://www.armada.buzz/invite/${NADDR}#${FRAG}`)?.host).toBe("armada.buzz");
  });

  it("accepts http and nested /invite paths", () => {
    const t = detectGroupInvite(`http://armada.buzz/app/invite/${NADDR}#${FRAG}`);
    expect(t?.path).toBe(`/invite/${NADDR}#${FRAG}`);
  });

  it("accepts a bare naddr#fragment with no host", () => {
    const t = detectGroupInvite(`${NADDR}#${FRAG}`);
    expect(t).toEqual({ naddr: NADDR, fragment: FRAG, host: null, path: `/invite/${NADDR}#${FRAG}` });
  });

  it("accepts a nostr:-prefixed bare naddr#fragment", () => {
    expect(detectGroupInvite(`nostr:${NADDR}#${FRAG}`)?.path).toBe(`/invite/${NADDR}#${FRAG}`);
  });

  it("normalizes uppercase bech32 (QR alphanumeric mode)", () => {
    const t = detectGroupInvite(`https://armada.buzz/invite/${NADDR.toUpperCase()}#${FRAG}`);
    expect(t?.naddr).toBe(NADDR);
    expect(t?.fragment).toBe(FRAG); // fragment case is preserved — it's the secret
  });

  it("tolerates a URL-form invite with a missing fragment (accept page reports it)", () => {
    const t = detectGroupInvite(`https://armada.buzz/invite/${NADDR}`);
    expect(t).toEqual({ naddr: NADDR, fragment: "", host: "armada.buzz", path: `/invite/${NADDR}` });
  });

  it("rejects a bare naddr WITHOUT a fragment (no way to join)", () => {
    expect(detectGroupInvite(NADDR)).toBeNull();
  });

  it("rejects a corrupted naddr (bad checksum)", () => {
    const bad = NADDR.slice(0, -4) + "qqqq";
    expect(detectGroupInvite(`https://armada.buzz/invite/${bad}#${FRAG}`)).toBeNull();
  });

  it("rejects an naddr of the wrong kind (not an invite bundle)", () => {
    expect(detectGroupInvite(`https://armada.buzz/invite/${WRONG_KIND_NADDR}#${FRAG}`)).toBeNull();
  });

  it("rejects ordinary URLs, relay URLs, garbage, and empty input", () => {
    expect(detectGroupInvite("https://armada.buzz/some/page")).toBeNull();
    expect(detectGroupInvite("wss://relay.damus.io")).toBeNull();
    expect(detectGroupInvite("javascript:alert(1)")).toBeNull();
    expect(detectGroupInvite("hello world")).toBeNull();
    expect(detectGroupInvite("naddr1notreal#frag")).toBeNull();
    expect(detectGroupInvite("")).toBeNull();
    expect(detectGroupInvite("   ")).toBeNull();
  });

  it("never produces a path outside our internal /invite route", () => {
    const t = detectGroupInvite(`https://evil.example/invite/${NADDR}#${FRAG}`);
    expect(t?.path.startsWith("/invite/naddr1")).toBe(true);
    expect(t?.path).not.toContain("evil.example");
  });
});

describe("parseInviteUrl (moved here; still re-exported from concord-invites)", () => {
  it("keeps its lenient shape-only behavior", () => {
    expect(parseInviteUrl("https://app.example/invite/naddr1abc#frag123")).toEqual({ naddr: "naddr1abc", fragment: "frag123" });
    expect(parseInviteUrl("naddr1xyz#tok")).toEqual({ naddr: "naddr1xyz", fragment: "tok" });
    expect(parseInviteUrl("https://app.example/outposts")).toBeNull();
  });

  it("is the same function callers get from concord-invites", () => {
    expect(reExported).toBe(parseInviteUrl);
  });
});
