/**
 * Sweep core — the decidable half of the in-app npub.cash sweep.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: between "quotes minted into
 * ecash proofs" and "melt landed on the user's lightning invoice", the proofs
 * in this stash are the ONLY copy of the user's money (the quotes are ISSUED
 * server-side the moment minting succeeds). So the stash:
 *
 *  - write-then-verifies every append (a storage that accepts-and-drops, the
 *    private-mode/quota class, must THROW before the caller proceeds to melt);
 *  - dedupes by proof secret so a retried mint can never double-count;
 *  - only ever shrinks by explicit removal of NAMED spent secrets — there is
 *    deliberately no clear-all;
 *  - is keyed per pubkey (multi-account) and grouped per mint (proofs are
 *    only spendable at their own mint).
 *
 * The orchestration that talks to npub.cash and the mint lives in
 * npubcash-sweep.ts; UI in Wallet.tsx. Tests: npubcash-sweep-core.test.ts.
 */

/** The subset of a Cashu proof we persist. Bearer data — treat like money. */
export interface StashProof {
  id: string;
  amount: number;
  secret: string;
  C: string;
  [key: string]: unknown;
}

export type Stash = Record<string, StashProof[]>;

const STASH_KEY_BASE = "ro_npc_ecash_stash_v1";

function stashKey(pubkey: string): string {
  return `${STASH_KEY_BASE}:${pubkey}`;
}

/**
 * Invoice amount for a sweep of `totalSats`: leave max(2 sats, 1%) as fee
 * headroom for the mint's melt fee reserve. Never negative, never planned at
 * zero — a 1–2 sat balance is honestly unsweepable over lightning.
 */
export function invoiceAmountFor(totalSats: number): number {
  if (totalSats <= 0) return 0;
  const headroom = Math.max(2, Math.ceil(totalSats * 0.01));
  return Math.max(0, totalSats - headroom);
}

/** Can this melt quote be paid from `availableSats` of proofs? */
export function meltFits(quote: { amount: number; fee_reserve: number }, availableSats: number): boolean {
  return quote.amount + quote.fee_reserve <= availableSats;
}

/**
 * Proof amounts must be PLAIN NUMBERS in the stash. cashu-ts v4 proofs carry
 * `Amount` objects that JSON-serialize as strings ("16"), and JS sums strings
 * by concatenation — which is how a 63-sat sweep once asked the owner for a
 * 32,493,424-sat invoice (live-fire 2026-08-18). Normalize at BOTH stash
 * boundaries: writes refuse garbage (fail closed before money moves), reads
 * heal any string amounts a previous build already persisted.
 */
function toSatNumber(amount: unknown): number {
  if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  const maybe = amount as { toNumber?: () => number } | null;
  if (maybe && typeof maybe.toNumber === "function") return maybe.toNumber();
  const n = Number(amount);
  return Number.isFinite(n) ? n : NaN;
}

export function readStash(pubkey: string): Stash {
  try {
    const raw = localStorage.getItem(stashKey(pubkey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Stash;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Heal-on-read: a stash written before amount normalization holds string
    // amounts. The proofs are real money either way — repair the metadata.
    for (const proofs of Object.values(parsed)) {
      for (const p of proofs) {
        const n = toSatNumber(p.amount);
        p.amount = Number.isFinite(n) ? n : 0;
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

export function stashTotalSats(stash: Stash): number {
  let total = 0;
  for (const proofs of Object.values(stash)) {
    for (const p of proofs) total += p.amount;
  }
  return total;
}

/**
 * Sum proof amounts as NUMBERS regardless of spelling. Every sum over proofs
 * that came straight from cashu-ts (not through the stash's heal-on-read)
 * must go through here: melt change carries Amount objects, and a bare
 * `s + p.amount` reduce concatenates — which is how a 1-sat change once
 * rendered as "01 sats" (live-fire 2026-08-26).
 */
export function sumProofSats(proofs: readonly { amount: unknown }[]): number {
  let total = 0;
  for (const p of proofs) {
    const n = toSatNumber(p.amount);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Append proofs for one mint, deduped by secret, then VERIFY the write by
 * reading it back. Throws when the verify fails — the caller must treat that
 * as "do not proceed to spend the originals", because a stash that silently
 * dropped the write is a stash that loses money on the next crash.
 */
export function appendToStash(pubkey: string, mintUrl: string, proofs: readonly StashProof[]): void {
  const stash = readStash(pubkey);
  const existing = stash[mintUrl] ?? [];
  const seen = new Set(existing.map((p) => p.secret));
  const merged = [...existing];
  for (const p of proofs) {
    const amount = toSatNumber(p.amount);
    if (!Number.isFinite(amount)) {
      throw new Error("Ecash proof has an unreadable amount — refusing to stash it. Nothing was spent.");
    }
    if (seen.has(p.secret)) continue;
    seen.add(p.secret);
    merged.push({ ...p, amount });
  }
  stash[mintUrl] = merged;
  localStorage.setItem(stashKey(pubkey), JSON.stringify(stash));
  // Write-then-verify: every appended secret must be readable back.
  const verify = readStash(pubkey)[mintUrl] ?? [];
  const verifySecrets = new Set(verify.map((p) => p.secret));
  for (const p of proofs) {
    if (!verifySecrets.has(p.secret)) {
      throw new Error("Ecash stash write could not be verified — storage is not persisting. Aborting before any funds move.");
    }
  }
}

/** Remove exactly the named spent secrets for one mint. Everything else survives. */
export function removeSpentFromStash(pubkey: string, mintUrl: string, spentSecrets: readonly string[]): void {
  const stash = readStash(pubkey);
  const spent = new Set(spentSecrets);
  stash[mintUrl] = (stash[mintUrl] ?? []).filter((p) => !spent.has(p.secret));
  if (stash[mintUrl].length === 0) delete stash[mintUrl];
  localStorage.setItem(stashKey(pubkey), JSON.stringify(stash));
}

/**
 * Issued-quote memory — which npub.cash quote ids this device knows are
 * already ISSUED at the mint (claimed by us, now or in a past session).
 *
 * Why it exists (live-fire 2026-08-26): the mint issues a quote's ecash
 * exactly once, but npub.cash never learns that — its /wallet/quotes keeps
 * answering PAID, so the claimable count re-lists money the user already has,
 * forever, and every sweep re-fails on it with "Quote already issued".
 * Remembering the ids lets the UI subtract them and the sweep skip them.
 * Losing this memory is harmless: the worst case is the phantom count comes
 * back until the next sweep re-discovers the ISSUED state from the mint.
 */
const ISSUED_KEY_BASE = "ro_npc_issued_quotes_v1";
const ISSUED_CAP = 500;

function issuedKey(pubkey: string): string {
  return `${ISSUED_KEY_BASE}:${pubkey}`;
}

export function readIssuedQuotes(pubkey: string): Set<string> {
  try {
    const raw = localStorage.getItem(issuedKey(pubkey));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function rememberIssuedQuotes(pubkey: string, quoteIds: readonly string[]): void {
  try {
    const merged = [...readIssuedQuotes(pubkey)];
    const seen = new Set(merged);
    for (const id of quoteIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    localStorage.setItem(issuedKey(pubkey), JSON.stringify(merged.slice(-ISSUED_CAP)));
  } catch {
    // Memory only — never let bookkeeping break a sweep.
  }
}

/**
 * The NUT-20 witness key for a claim — or undefined when the claim must be
 * sent UNSIGNED.
 *
 * Live-fire lesson (2026-08-18, a real 63-sat sweep): npub.cash only
 * pubkey-locks quotes when the user has opted in (`lockQuote` defaults to
 * false server-side), and CDK mints (cdk/src/mint/issue/mod.rs) reject any
 * mint request that carries a signature for an UNLOCKED quote with the same
 * 20008 "Signature missing or invalid" they use for a bad signature on a
 * locked one. Signing unconditionally therefore bricks the claim for the
 * default npub.cash user. Decide from the mint's own quote record: a
 * non-empty `pubkey` on the quote is the positive claim that a witness is
 * required.
 */
export function witnessKeyFor(quotePubkey: string | null | undefined, privkeyHex: string): string | undefined {
  return typeof quotePubkey === "string" && quotePubkey.length > 0 ? privkeyHex : undefined;
}
