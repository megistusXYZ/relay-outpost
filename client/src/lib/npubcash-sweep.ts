/**
 * The in-app npub.cash sweep: locked mint quotes → ecash proofs → the user's
 * own lightning wallet, without any key or fund ever touching a website.
 *
 * WHY LOCAL-KEY ONLY: npub.cash v2 locks each quote to the recipient's nostr
 * pubkey (NUT-20). Issuing the ecash requires a BIP-340 signature over the
 * MINT request — not a nostr event — so NIP-07/NIP-46 signers cannot produce
 * it anywhere, including npub.cash's own site. `localSweepKey` below is the
 * gate: it yields a key only for PrivateKeySigner sessions, and that key is
 * passed to cashu-ts as the NUT-20 witness and nowhere else.
 *
 * SAFETY ORDER (the part that must never be reordered):
 *  1. mint a quote → proofs;
 *  2. STASH the proofs with write-verify (npubcash-sweep-core) — from this
 *     moment the quote is ISSUED server-side and the stash is the money;
 *  3. only then melt. A failed melt leaves the stash intact and resumable;
 *     spent proofs are removed by NAME after a successful melt, and change
 *     proofs are re-stashed before the function returns.
 *
 * Each mint group sweeps independently (proofs only spend at their own mint):
 * one invoice per mint via `getInvoice`. Fee handling: plan with headroom
 * (invoiceAmountFor), verify with the mint's own melt quote (meltFits), and
 * retry ONCE with the quoted fee reserve before giving an honest error.
 */
import { Wallet } from "@cashu/cashu-ts";
import { PrivateKeySigner, type ISigner } from "applesauce-signers";
import { bytesToHex } from "nostr-tools/utils";
import { fetchNpubCashQuotes, type NpcQuote } from "./npubcash-api";
import {
  appendToStash,
  invoiceAmountFor,
  meltFits,
  readStash,
  rememberIssuedQuotes,
  removeSpentFromStash,
  sumProofSats,
  witnessKeyFor,
  type StashProof,
} from "./npubcash-sweep-core";

export interface SweepProgress {
  stage: "quotes" | "minting" | "invoice" | "melting" | "done";
  detail?: string;
}

export interface MintSweepResult {
  mintUrl: string;
  sweptSats: number;
  feeSats: number;
  changeSats: number;
}

export interface SweepOutcome {
  results: MintSweepResult[];
  /** Sats claimed into the local stash but NOT swept (too small / no invoice / melt failed). */
  strandedSats: number;
  /** Human-readable problems, one per quote or mint that couldn't complete. */
  problems: string[];
  /**
   * Sats npub.cash still lists as claimable but whose quotes the mint says
   * are already ISSUED — money the user claimed before (this or an earlier
   * session), not money that's stuck. Reported so the UI can reassure
   * instead of alarming.
   */
  alreadyClaimedSats: number;
}

/** NUT-20 witness key — only a local-key session has one. The UI gates on this. */
export function localSweepKey(signer: ISigner | null): string | null {
  return signer instanceof PrivateKeySigner ? bytesToHex(signer.key) : null;
}

export async function sweepNpubCash(opts: {
  pubkey: string;
  signer: ISigner;
  privkeyHex: string;
  /** Produce a bolt11 invoice for the given amount (NWC makeInvoice, or a paste). */
  getInvoice: (amountSats: number, mintUrl: string) => Promise<string | null>;
  onProgress?: (p: SweepProgress) => void;
}): Promise<SweepOutcome> {
  const { pubkey, signer, privkeyHex, getInvoice, onProgress } = opts;
  const problems: string[] = [];
  const results: MintSweepResult[] = [];
  let alreadyClaimedSats = 0;

  onProgress?.({ stage: "quotes" });
  const quotesRes = await fetchNpubCashQuotes(signer);
  if (!quotesRes.reached || !quotesRes.data) {
    throw new Error("Couldn't reach npub.cash — nothing was claimed and nothing moved.");
  }
  const paid = quotesRes.data.filter((q) => q.state === "PAID");

  // Every mint that has claimable quotes OR already-stashed proofs from an
  // earlier interrupted run.
  const byMint = new Map<string, NpcQuote[]>();
  for (const q of paid) {
    const list = byMint.get(q.mintUrl) ?? [];
    list.push(q);
    byMint.set(q.mintUrl, list);
  }
  for (const mintUrl of Object.keys(readStash(pubkey))) {
    if (!byMint.has(mintUrl)) byMint.set(mintUrl, []);
  }
  if (byMint.size === 0) {
    return { results, strandedSats: 0, problems: ["Nothing to sweep."], alreadyClaimedSats: 0 };
  }

  for (const [mintUrl, quotes] of byMint) {
    try {
      const wallet = new Wallet(mintUrl, { unit: "sat" });
      await wallet.loadMint();

      // 1+2 · Mint each paid quote and stash IMMEDIATELY (write-verified).
      for (const q of quotes) {
        onProgress?.({ stage: "minting", detail: `${q.amount} sats` });
        try {
          // Sign ONLY when the mint's own quote record says the quote is
          // locked. npub.cash leaves quotes unlocked unless the user opted
          // in, and CDK mints reject a signature on an unlocked quote with
          // the same 20008 as a bad signature — signing unconditionally
          // bricked the claim (live-fire 2026-08-18). Asking the mint is the
          // positive claim; if we can't ask, we don't guess — the quote is
          // skipped and stays claimable.
          const mq = await wallet.mint.checkMintQuoteBolt11(q.quoteId);
          // ISSUED = this quote's ecash was already minted (by us, in this or
          // an earlier session — a mint issues exactly once). npub.cash never
          // learns that, so it re-lists the quote as PAID forever. Not an
          // error and not money: remember the id so the claimable count stops
          // including it, and move on.
          if ((mq as { state?: string }).state === "ISSUED") {
            rememberIssuedQuotes(pubkey, [q.quoteId]);
            alreadyClaimedSats += q.amount;
            continue;
          }
          const witness = witnessKeyFor((mq as { pubkey?: string | null }).pubkey, privkeyHex);
          const builder = wallet.ops.mintBolt11(q.amount, q.quoteId);
          const proofs = await (witness ? builder.privkey(witness) : builder).run();
          appendToStash(pubkey, mintUrl, proofs as unknown as StashProof[]);
          // Minted = issued from this moment; future claimable counts must
          // not re-list it even before npub.cash's own state catches up.
          rememberIssuedQuotes(pubkey, [q.quoteId]);
        } catch (e) {
          problems.push(`Couldn't claim a ${q.amount}-sat payment: ${e instanceof Error ? e.message : "mint refused"}`);
        }
      }

      // 3 · Melt everything stashed at this mint to the user's invoice.
      const stashed = readStash(pubkey)[mintUrl] ?? [];
      const total = stashed.reduce((s, p) => s + p.amount, 0);
      if (total === 0) continue;
      const target = invoiceAmountFor(total);
      if (target === 0) {
        problems.push(`${total} sats at ${mintUrl} are too small to sweep over lightning — kept safe locally.`);
        continue;
      }

      onProgress?.({ stage: "invoice", detail: `${target} sats` });
      let invoice = await getInvoice(target, mintUrl);
      if (!invoice) {
        problems.push(`No invoice for ${target} sats — ${total} sats stay safe locally.`);
        continue;
      }
      let meltQuote = await wallet.createMeltQuoteBolt11(invoice);
      // cashu-ts v4 wraps sats in Amount; normalize once at this boundary.
      const quoteNums = (q: typeof meltQuote) => ({ amount: q.amount.toNumber(), fee_reserve: q.fee_reserve.toNumber() });
      if (!meltFits(quoteNums(meltQuote), total)) {
        // One honest retry with the mint's OWN fee reserve.
        const retryTarget = total - quoteNums(meltQuote).fee_reserve - (quoteNums(meltQuote).amount - target);
        if (retryTarget > 0) {
          onProgress?.({ stage: "invoice", detail: `${retryTarget} sats (fee-adjusted)` });
          invoice = await getInvoice(retryTarget, mintUrl);
          if (invoice) meltQuote = await wallet.createMeltQuoteBolt11(invoice);
        }
      }
      if (!invoice || !meltFits(quoteNums(meltQuote), total)) {
        problems.push(`The mint's fee reserve doesn't fit ${total} sats — kept safe locally.`);
        continue;
      }

      const paidSats = meltQuote.amount.toNumber();
      onProgress?.({ stage: "melting", detail: `${paidSats} sats` });
      const melt = await wallet.ops.meltBolt11(meltQuote, stashed).run();

      // Success: retire exactly the spent proofs, keep any change. Change
      // amounts come straight from cashu-ts as Amount objects — sum through
      // sumProofSats, never a bare reduce (the "01 sats" concat bug).
      removeSpentFromStash(pubkey, mintUrl, stashed.map((p) => p.secret));
      const change = (melt.change ?? []) as unknown as StashProof[];
      if (change.length > 0) appendToStash(pubkey, mintUrl, change);
      const changeSats = sumProofSats(change);
      results.push({
        mintUrl,
        sweptSats: paidSats,
        feeSats: total - paidSats - changeSats,
        changeSats,
      });
    } catch (e) {
      problems.push(`Sweep at ${mintUrl} stopped: ${e instanceof Error ? e.message : "unexpected error"}. Any claimed sats are safe in the local stash.`);
    }
  }

  onProgress?.({ stage: "done" });
  const strandedSats = Object.values(readStash(pubkey)).flat().reduce((s, p) => s + p.amount, 0);
  return { results, strandedSats, problems, alreadyClaimedSats };
}
