/**
 * npub.cash v2 API contract (lib/npubcash-api.ts) — the decidable parts.
 *
 * The live service was measured before this was written (2026-08-18, probed
 * with a throwaway key): `GET /api/v2/auth/nip98` answers a NIP-98-signed
 * kind-27235 event (header `Nostr <base64(event)>`) with a JWT; `GET
 * /api/v2/wallet/quotes` answers `Bearer <jwt>` with the account's mint-quote
 * history. The older documented v1 endpoints (balance/claim) are DEAD on the
 * deployed service — they serve the SPA shell — so nothing here may use them.
 *
 * Claimable = quotes in state "PAID": paid by a sender, not yet issued as
 * ecash to the owner. ISSUED is already claimed; UNPAID never settled.
 */
import { describe, expect, it } from "vitest";
import { buildNip98Template, claimableFromQuotes, type NpcQuote } from "./npubcash-api";

const quote = (state: string, amount: number, id = Math.random().toString(36).slice(2)): NpcQuote => ({
  createdAt: 0, paidAt: 0, expiresAt: 0, mintUrl: "https://mint.example",
  quoteId: id, request: "lnbc...", amount, state, locked: true,
});

describe("buildNip98Template", () => {
  it("is a kind-27235 event carrying exactly the url and method", () => {
    const t = buildNip98Template("https://npub.cash/api/v2/auth/nip98", "GET");
    expect(t.kind).toBe(27235);
    expect(t.tags).toContainEqual(["u", "https://npub.cash/api/v2/auth/nip98"]);
    expect(t.tags).toContainEqual(["method", "GET"]);
    expect(t.content).toBe("");
    expect(typeof t.created_at).toBe("number");
  });
});

describe("claimableFromQuotes", () => {
  it("sums only PAID quotes — ISSUED is already claimed, UNPAID never settled", () => {
    const out = claimableFromQuotes([
      quote("PAID", 21),
      quote("PAID", 42),
      quote("ISSUED", 1000),
      quote("UNPAID", 7),
    ]);
    expect(out).toEqual({ sats: 63, count: 2 });
  });

  it("empty history claims nothing", () => {
    expect(claimableFromQuotes([])).toEqual({ sats: 0, count: 0 });
  });

  it("excludes quotes this device knows are already issued — npub.cash re-lists them as PAID forever", () => {
    const out = claimableFromQuotes(
      [quote("PAID", 21, "q-old"), quote("PAID", 42, "q-old2"), quote("PAID", 7, "q-new")],
      new Set(["q-old", "q-old2"]),
    );
    expect(out).toEqual({ sats: 7, count: 1 });
  });
});
