/**
 * npub.cash detection + zap-receipt accounting for the Wallet's claim card.
 *
 * npub.cash is a Cashu-mint lightning-address provider that answers for EVERY
 * npub with no signup: zaps to `<npub>@npub.cash` settle at their mint and
 * accumulate, credited to the npub, until the key-holder signs in and sweeps
 * them. That means an account can be genuinely, successfully zapped while its
 * owner has no wallet connected anywhere — the sats are real and parked. The
 * Wallet card built on this module surfaces that state instead of leaving the
 * owner to discover it from a confusing notification (measured live
 * 2026-08-18: a profile carrying an npub.cash lud16 it never knowingly set,
 * with 63 sats waiting).
 *
 * The amount parse deliberately mirrors the zap notification's three-step
 * fallback (amount tag msats → bolt11 human-readable → the zap request JSON
 * in `description`); npubcash.test.ts pins them together.
 */
import type { Event } from "nostr-tools";

export const NPUB_CASH_CLAIM_URL = "https://npub.cash";

/** Is this lud16 an npub.cash address? Domain match only, case-insensitive. */
export function isNpubCashAddress(lud16: string | null | undefined): boolean {
  if (!lud16) return false;
  const at = lud16.lastIndexOf("@");
  if (at < 0) return false;
  return lud16.slice(at + 1).trim().toLowerCase() === "npub.cash";
}

/** Sats carried by one kind-9735 receipt's tags; 0 when unrecoverable. */
export function zapReceiptSats(tags: readonly string[][]): number {
  const amountTag = tags.find((t) => t[0] === "amount");
  if (amountTag?.[1]) {
    const msats = parseInt(amountTag[1], 10);
    if (!isNaN(msats) && msats > 0) return Math.floor(msats / 1000);
  }
  const bolt11 = tags.find((t) => t[0] === "bolt11")?.[1];
  if (bolt11) {
    const match = bolt11.match(/lnbc(\d+)([munp]?)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      const unit = match[2] || "";
      const btc =
        unit === "m" ? num / 1e3 :
        unit === "u" ? num / 1e6 :
        unit === "n" ? num / 1e9 :
        unit === "p" ? num / 1e12 : num;
      const sats = Math.round(btc * 100_000_000);
      if (sats > 0) return sats;
    }
  }
  const desc = tags.find((t) => t[0] === "description")?.[1];
  if (desc) {
    try {
      const zapReq = JSON.parse(desc) as { tags?: string[][] };
      const amt = zapReq.tags?.find((t) => t[0] === "amount")?.[1];
      if (amt) {
        const msats = parseInt(amt, 10);
        if (!isNaN(msats) && msats > 0) return Math.floor(msats / 1000);
      }
    } catch { /* not a zap request — no amount to recover */ }
  }
  return 0;
}

/**
 * Total sats + receipt count across a set of kind-9735s, deduped by id.
 * A receipt whose amount can't be parsed still COUNTS (someone zapped) but
 * adds nothing to the sum — an honest floor, never a guess.
 */
export function sumZapSats(receipts: readonly Event[]): { sats: number; count: number } {
  const seen = new Set<string>();
  let sats = 0;
  let count = 0;
  for (const r of receipts) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    count++;
    sats += zapReceiptSats(r.tags);
  }
  return { sats, count };
}
