import { describe, it, expect } from "vitest";
import { validateUsernameFormat, decodeCashuPriceSats, classifyUsernameCheck } from "./npubcash-username";

// A real NUT-18 payment request captured live from a 402 on npub.cash's
// /api/v2/user/username (2026-08-29): 5000 sats to mint.minibits.cash.
const REAL_CREQ = "creqAo2FhGROIYXVjc2F0YW2BeCJodHRwczovL21pbnQubWluaWJpdHMuY2FzaC9CaXRjb2lu";

describe("validateUsernameFormat — the client-side fast gate", () => {
  it("accepts lowercase alphanumeric names of 3+ chars", () => {
    expect(validateUsernameFormat("bob")).toEqual({ ok: true });
    expect(validateUsernameFormat("alice99")).toEqual({ ok: true });
  });

  it("rejects too-short, too-long, and non-[a-z0-9] names (hyphens, uppercase, spaces)", () => {
    expect(validateUsernameFormat("ab").ok).toBe(false);       // <3
    expect(validateUsernameFormat("a".repeat(31)).ok).toBe(false); // >30
    expect(validateUsernameFormat("ro-qa").ok).toBe(false);    // hyphen (confirmed 400 live)
    expect(validateUsernameFormat("Alice").ok).toBe(false);    // uppercase
    expect(validateUsernameFormat("hi there").ok).toBe(false); // space
  });

  it("trims surrounding whitespace before judging", () => {
    expect(validateUsernameFormat("  bob  ")).toEqual({ ok: true });
  });
});

describe("decodeCashuPriceSats — read the price out of the NUT-18 request", () => {
  it("decodes the live 402 payment request to 5000 sats + the mint", async () => {
    const got = await decodeCashuPriceSats(REAL_CREQ);
    expect(got).toEqual({ sats: 5000, mint: "https://mint.minibits.cash/Bitcoin" });
  });

  it("returns null (price unknown) for a missing or garbled header — never throws", async () => {
    expect(await decodeCashuPriceSats(null)).toBeNull();
    expect(await decodeCashuPriceSats("")).toBeNull();
    expect(await decodeCashuPriceSats("not-a-cashu-request")).toBeNull();
  });
});

describe("classifyUsernameCheck — map (status, header) to a decision", () => {
  it("402 → available, with the decoded price", async () => {
    expect(await classifyUsernameCheck(402, REAL_CREQ)).toEqual({
      status: "available",
      priceSats: 5000,
      mint: "https://mint.minibits.cash/Bitcoin",
    });
  });

  it("402 with no readable header → available, price unknown (not a failure)", async () => {
    expect(await classifyUsernameCheck(402, null)).toEqual({ status: "available", priceSats: null, mint: null });
  });

  it("409 → taken, 400 → invalid, anything else → unreachable", async () => {
    expect(await classifyUsernameCheck(409, null)).toEqual({ status: "taken" });
    expect(await classifyUsernameCheck(400, null)).toEqual({ status: "invalid" });
    expect(await classifyUsernameCheck(500, null)).toEqual({ status: "unreachable" });
    expect(await classifyUsernameCheck(0, null)).toEqual({ status: "unreachable" });
  });
});
