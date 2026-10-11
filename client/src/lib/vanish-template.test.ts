/**
 * The account-wide vanish (NIP-62) names the relays it is for (owner,
 * 2026-10-11): without `relay` tags a relay that follows the spec may ignore
 * it, so the request also carries ALL_RELAYS for any relay that only ever
 * sees a copy.
 */
import { describe, it, expect } from "vitest";
import { buildVanishTemplate } from "./vanish-template";

describe("buildVanishTemplate", () => {
  it("names every relay asked, plus ALL_RELAYS, and carries the reason", () => {
    const t = buildVanishTemplate(["wss://relay.damus.io", "wss://nos.lol"], "Leaving");
    expect(t.kind).toBe(62);
    expect(t.content).toBe("Leaving");
    expect(t.tags).toEqual([["relay", "wss://relay.damus.io"], ["relay", "wss://nos.lol"], ["relay", "ALL_RELAYS"]]);
  });
  it("an empty reason is an empty content, never undefined", () => {
    expect(buildVanishTemplate(["wss://nos.lol"]).content).toBe("");
  });
});
