/**
 * npub.cash detection + zap-receipt accounting (lib/npubcash.ts).
 *
 * npub.cash gives EVERY npub a lightning address that works with no signup:
 * zaps sent to it settle at their Cashu mint and sit there, credited to the
 * npub, until the key-holder claims them. A profile can carry such an address
 * without its owner ever knowing (another client's onboarding, a copied
 * profile) — which is exactly how "how did this account get zapped, it has no
 * wallet?" happens. The Wallet card this lib powers exists to answer that
 * before the owner has to ask.
 *
 * The receipt-sum parse mirrors the zap notification's (amount tag in msats →
 * bolt11 human-readable amount → the zap request stashed in `description`),
 * pinned here so the card and the notification can never learn to disagree.
 */
import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { isNpubCashAddress, zapReceiptSats, sumZapSats } from "./npubcash";

function receipt(tags: string[][], id = Math.random().toString(36).slice(2)): Event {
  return { id, pubkey: "zapper", kind: 9735, tags, content: "", created_at: 1_700_000_000, sig: "" };
}

describe("isNpubCashAddress", () => {
  it("matches only the npub.cash domain, case-insensitively", () => {
    expect(isNpubCashAddress("npub1abc@npub.cash")).toBe(true);
    expect(isNpubCashAddress("NPUB1ABC@NPUB.CASH")).toBe(true);
    expect(isNpubCashAddress("ben@getalby.com")).toBe(false);
    expect(isNpubCashAddress("someone@notnpub.cash")).toBe(false);
    expect(isNpubCashAddress(null)).toBe(false);
    expect(isNpubCashAddress(undefined)).toBe(false);
    expect(isNpubCashAddress("")).toBe(false);
    expect(isNpubCashAddress("no-at-sign-npub.cash")).toBe(false);
  });
});

describe("zapReceiptSats", () => {
  it("prefers the amount tag (msats)", () => {
    expect(zapReceiptSats([["amount", "21000"]])).toBe(21);
  });

  it("falls back to the bolt11 human-readable amount", () => {
    // lnbc210n = 210 * 10^-9 BTC = 21 sats
    expect(zapReceiptSats([["bolt11", "lnbc210n1pjxyz"]])).toBe(21);
  });

  it("falls back to the zap request stashed in description", () => {
    const desc = JSON.stringify({ tags: [["amount", "42000"]] });
    expect(zapReceiptSats([["description", desc]])).toBe(42);
  });

  it("returns 0 when no amount is recoverable — never a guess", () => {
    expect(zapReceiptSats([["p", "someone"]])).toBe(0);
    expect(zapReceiptSats([["description", "not json"]])).toBe(0);
  });
});

describe("sumZapSats", () => {
  it("sums across receipts and dedupes by event id", () => {
    const a = receipt([["amount", "21000"]], "same");
    const b = receipt([["amount", "21000"]], "same");
    const c = receipt([["amount", "42000"]], "other");
    expect(sumZapSats([a, b, c])).toEqual({ sats: 63, count: 2 });
  });

  it("counts a receipt with an unparseable amount but adds nothing for it", () => {
    const known = receipt([["amount", "21000"]]);
    const unknown = receipt([["p", "x"]]);
    expect(sumZapSats([known, unknown])).toEqual({ sats: 21, count: 2 });
  });

  it("empty in, zeros out", () => {
    expect(sumZapSats([])).toEqual({ sats: 0, count: 0 });
  });
});
