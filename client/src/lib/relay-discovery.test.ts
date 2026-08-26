import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import {
  rankCuratedRelays,
  isBridgeRelay,
  normalizeRelayUrl,
  relayLanguageState,
  parseNip66Event,
  type RelayCandidate,
} from "./relay-discovery";

const cand = (over: Partial<RelayCandidate> & { url: string; activity: number }): RelayCandidate => over;

describe("normalizeRelayUrl", () => {
  it("strips scheme, trailing slash, and lowercases", () => {
    expect(normalizeRelayUrl("wss://Relay.Example.com/")).toBe("relay.example.com");
    expect(normalizeRelayUrl("ws://relay.example.com")).toBe("relay.example.com");
  });
});

describe("isBridgeRelay", () => {
  it("flags ActivityPub bridges by url/software/name", () => {
    expect(isBridgeRelay({ url: "wss://relay.mostr.pub" })).toBe(true);
    expect(isBridgeRelay({ url: "wss://x.io", software: "momostr" })).toBe(true);
    expect(isBridgeRelay({ url: "wss://x.io", name: "ActivityPub Bridge" })).toBe(true);
  });
  it("does not flag native relays", () => {
    expect(isBridgeRelay({ url: "wss://relay.damus.io" })).toBe(false);
    expect(isBridgeRelay({ url: "wss://nos.lol", software: "strfry" })).toBe(false);
  });
});

describe("relayLanguageState", () => {
  it("is unknown when no langs requested or none declared", () => {
    expect(relayLanguageState({ languageTags: ["en"] }, [])).toBe("unknown");
    expect(relayLanguageState({}, ["en"])).toBe("unknown");
  });
  it("matches on primary subtag, ignoring region", () => {
    expect(relayLanguageState({ languageTags: ["en-US"] }, ["en"])).toBe("match");
    expect(relayLanguageState({ languageTags: ["es"] }, ["en", "es"])).toBe("match");
  });
  it("mismatches when a declared language is not requested", () => {
    expect(relayLanguageState({ languageTags: ["ja"] }, ["en"])).toBe("mismatch");
  });
});

describe("rankCuratedRelays", () => {
  it("excludes bridges, paid, and unhealthy; keeps unknowns", () => {
    const out = rankCuratedRelays([
      cand({ url: "wss://relay.mostr.pub", activity: 9999 }),        // bridge → out
      cand({ url: "wss://paid.example", activity: 500, free: false }), // paid → out
      cand({ url: "wss://down.example", activity: 500, healthy: false }), // unhealthy → out
      cand({ url: "wss://good.example", activity: 100 }),            // unknown free/health → kept
    ]);
    expect(out.map((r) => r.url)).toEqual(["wss://good.example"]);
  });

  it("orders language matches first, then by activity", () => {
    const out = rankCuratedRelays(
      [
        cand({ url: "wss://busy.example", activity: 1000 }),                       // unknown lang
        cand({ url: "wss://en.example", activity: 10, languageTags: ["en"] }),      // match, low activity
        cand({ url: "wss://quiet.example", activity: 5 }),                          // unknown lang
      ],
      { langs: ["en"] },
    );
    // language match wins despite lower activity; unknowns follow by activity desc
    expect(out.map((r) => r.url)).toEqual(["wss://en.example", "wss://busy.example", "wss://quiet.example"]);
  });

  it("drops relays that declare a mismatched language", () => {
    const out = rankCuratedRelays(
      [
        cand({ url: "wss://ja.example", activity: 1000, languageTags: ["ja"] }),
        cand({ url: "wss://en.example", activity: 1, languageTags: ["en"] }),
      ],
      { langs: ["en"] },
    );
    expect(out.map((r) => r.url)).toEqual(["wss://en.example"]);
  });

  it("dedupes by normalized url and honors denylist + limit", () => {
    const out = rankCuratedRelays(
      [
        cand({ url: "wss://a.example/", activity: 3 }),
        cand({ url: "wss://A.example", activity: 99 }), // dup of a.example (first wins)
        cand({ url: "wss://bad.example", activity: 50 }),
        cand({ url: "wss://b.example", activity: 2 }),
      ],
      { denylist: ["bad.example"], limit: 2 },
    );
    expect(out.map((r) => normalizeRelayUrl(r.url))).toEqual(["a.example", "b.example"]);
  });
});

describe("parseNip66Event", () => {
  const ev = (tags: string[][]): Event =>
    ({ id: "x", pubkey: "p", created_at: 0, kind: 30166, tags, content: "", sig: "" }) as Event;

  it("extracts url, software, supported nips", () => {
    const c = parseNip66Event(ev([["d", "wss://relay.example"], ["s", "strfry"], ["N", "1"], ["N", "50"]]));
    expect(c).toMatchObject({ url: "wss://relay.example", software: "strfry", supportedNips: [1, 50] });
  });
  it("marks paid relays not-free via R/T tags", () => {
    expect(parseNip66Event(ev([["d", "wss://p.example"], ["R", "payment"]]))?.free).toBe(false);
    expect(parseNip66Event(ev([["d", "wss://p.example"], ["T", "paid"]]))?.free).toBe(false);
  });
  it("returns null without a d-tag url", () => {
    expect(parseNip66Event(ev([["s", "strfry"]]))).toBeNull();
  });
});
