import { describe, it, expect } from "vitest";
import {
  parseClientTag,
  lookupClient,
  getClientDisplay,
  normalizeClientName,
} from "./client-display";

const HEX = "a".repeat(64);

function ev(tags: string[][]): { tags: string[][] } {
  return { tags };
}

describe("parseClientTag", () => {
  it("returns null when there is no client tag", () => {
    expect(parseClientTag(ev([["p", HEX], ["t", "nostr"]]))).toBeNull();
  });

  it("returns null for a missing/empty tags array", () => {
    expect(parseClientTag(null)).toBeNull();
    expect(parseClientTag(undefined)).toBeNull();
    expect(parseClientTag({} as { tags?: string[][] })).toBeNull();
  });

  it("returns null when the client name is empty or whitespace", () => {
    expect(parseClientTag(ev([["client", ""]]))).toBeNull();
    expect(parseClientTag(ev([["client", "   "]]))).toBeNull();
    expect(parseClientTag(ev([["client"]]))).toBeNull();
  });

  it("parses a bare name (no handler coordinate)", () => {
    expect(parseClientTag(ev([["client", "Amethyst"]]))).toEqual({ name: "Amethyst" });
  });

  it("trims the reported name", () => {
    expect(parseClientTag(ev([["client", "  Damus  "]]))).toEqual({ name: "Damus" });
  });

  it("captures a well-formed handler coordinate at index 2", () => {
    const coord = `31990:${HEX}:web`;
    expect(parseClientTag(ev([["client", "Coracle", coord]]))).toEqual({
      name: "Coracle",
      handlerCoord: coord,
    });
  });

  it("accepts a handler coordinate with an empty d-identifier", () => {
    const coord = `31990:${HEX}:`;
    expect(parseClientTag(ev([["client", "App", coord]]))?.handlerCoord).toBe(coord);
  });

  it("ignores a malformed coordinate (not a 31990-style a-tag)", () => {
    expect(parseClientTag(ev([["client", "App", "not-a-coord"]]))).toEqual({ name: "App" });
    expect(parseClientTag(ev([["client", "App", "https://example.com"]]))).toEqual({ name: "App" });
    // pubkey too short → treated as absent
    expect(parseClientTag(ev([["client", "App", "31990:abc:web"]]))).toEqual({ name: "App" });
  });

  it("uses the FIRST client tag when several are present", () => {
    expect(parseClientTag(ev([["client", "First"], ["client", "Second"]]))).toEqual({ name: "First" });
  });
});

describe("lookupClient (registry)", () => {
  it("matches a known client exactly", () => {
    expect(lookupClient("Amethyst")?.label).toBe("Amethyst");
  });

  it("is case-insensitive", () => {
    expect(lookupClient("DAMUS")?.key).toBe("damus");
    expect(lookupClient("primal")?.label).toBe("Primal");
  });

  it("is space-insensitive / normalizes internal whitespace", () => {
    expect(lookupClient("  primal   web   app ")?.key).toBe("primal");
  });

  it("resolves aliases and domain-style names", () => {
    expect(lookupClient("snort.social")?.key).toBe("snort");
    expect(lookupClient("nostrudel.ninja")?.key).toBe("nostrudel");
  });

  it("resolves a distinctive substring via word boundary", () => {
    expect(lookupClient("Damus (iOS)")?.key).toBe("damus");
  });

  it("does NOT false-match a short token inside another name", () => {
    // "nos" must not swallow "nostur"
    expect(lookupClient("Nostur")?.key).toBe("nostur");
  });

  it("returns null for an unknown client", () => {
    expect(lookupClient("TotallyMadeUpClient")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(lookupClient("")).toBeNull();
    expect(lookupClient("   ")).toBeNull();
  });

  it("includes Relay Outpost's own mark", () => {
    expect(lookupClient("Relay Outpost")?.key).toBe("relay-outpost");
  });
});

describe("getClientDisplay (end to end)", () => {
  it("returns null when there is no client tag", () => {
    expect(getClientDisplay(ev([["p", HEX]]))).toBeNull();
  });

  it("maps a known client to its canonical label + iconKey + color", () => {
    const d = getClientDisplay(ev([["client", "amethyst"]]));
    expect(d).toMatchObject({ name: "Amethyst", iconKey: "amethyst" });
    expect(d?.color).toBeTruthy();
  });

  it("passes through an unknown client name with NO iconKey", () => {
    const d = getClientDisplay(ev([["client", "MysteryApp"]]));
    expect(d).toEqual({ name: "MysteryApp" });
    expect(d?.iconKey).toBeUndefined();
  });

  it("carries the handler coordinate through for best-effort icon resolution", () => {
    const coord = `31990:${HEX}:web`;
    const d = getClientDisplay(ev([["client", "SomeApp", coord]]));
    expect(d?.handlerCoord).toBe(coord);
  });

  it("normalizeClientName collapses case and whitespace", () => {
    expect(normalizeClientName("  Primal   Web  App ")).toBe("primal web app");
  });
});
