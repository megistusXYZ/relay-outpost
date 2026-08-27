/**
 * npub.cash v2 API client — the service's OWN answer to "what's waiting for
 * this account", replacing the zap-receipt heuristic wherever it's reachable.
 *
 * Contract, measured live 2026-08-18 (throwaway key, zero balance — see
 * npubcash-api.test.ts header): NIP-98 auth event → JWT → Bearer → quotes.
 * The v1 endpoints in npubcash-server's README are dead on the deployed
 * service; only /api/v2/auth/nip98 and /api/v2/wallet/quotes answer.
 *
 * How npub.cash v2 holds funds (why this is only a READ client): incoming
 * zaps become mint quotes LOCKED to the recipient's pubkey (NUT-20) at the
 * mint. npub.cash itself cannot spend them; issuing the ecash requires a
 * signature by the account key over the mint request. That signature is NOT
 * a nostr event, so NIP-07/NIP-46 signers cannot produce it — a full in-app
 * sweep is only possible for local-key accounts and is deliberately out of
 * scope here (owner decision pending; see the Wallet card copy).
 *
 * NIP-98 IS a nostr event (kind 27235), so the balance read below works for
 * every signer type without any key ever leaving its signer.
 */
import type { EventTemplate } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import type { Reached } from "./relay-reach";
import { signWithTimeout } from "./signer-timeout";

export const NPUB_CASH_BASE = "https://npub.cash";

/** One mint quote as /api/v2/wallet/quotes returns it (@npubcash/types). */
export interface NpcQuote {
  createdAt: number;
  paidAt: number;
  expiresAt: number;
  mintUrl: string;
  quoteId: string;
  request: string;
  amount: number;
  state: string;
  locked: boolean;
  zapRequest?: string;
}

/** NIP-98 HTTP-auth event template for one request. */
export function buildNip98Template(url: string, method: string): EventTemplate {
  return {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["u", url], ["method", method]],
    content: "",
  };
}

/**
 * PAID = settled by the sender, not yet issued to the owner: the claimable
 * set. `knownIssued` subtracts quotes this device has already seen ISSUED at
 * the mint — npub.cash never learns about issuance, so its ledger re-lists
 * claimed money as PAID forever (live-fire 2026-08-26).
 */
export function claimableFromQuotes(
  quotes: readonly NpcQuote[],
  knownIssued?: ReadonlySet<string>,
): { sats: number; count: number } {
  let sats = 0;
  let count = 0;
  for (const q of quotes) {
    if (q.state !== "PAID") continue;
    if (knownIssued?.has(q.quoteId)) continue;
    count++;
    sats += q.amount;
  }
  return { sats, count };
}

/**
 * The account's claimable balance, from npub.cash's own ledger. Reach-honest:
 * `reached` is true only when the API actually answered JSON — any network
 * failure, auth refusal, or SPA-shell response is "we never got to ask", and
 * the caller falls back to its receipt-derived floor rather than showing a
 * confident zero.
 */
export async function fetchNpubCashClaimable(
  signer: ISigner,
  knownIssued?: ReadonlySet<string>,
): Promise<Reached<{ sats: number; count: number } | null>> {
  const quotes = await fetchNpubCashQuotes(signer);
  if (!quotes.reached || !quotes.data) return { data: null, reached: false };
  return { data: claimableFromQuotes(quotes.data, knownIssued), reached: true };
}

/** The raw quote history — the sweep needs quote ids and mint urls, not sums. */
export async function fetchNpubCashQuotes(signer: ISigner): Promise<Reached<NpcQuote[] | null>> {
  try {
    const authUrl = `${NPUB_CASH_BASE}/api/v2/auth/nip98`;
    const authEvent = await signWithTimeout(signer, buildNip98Template(authUrl, "GET"));
    const authRes = await fetch(authUrl, {
      headers: { authorization: `Nostr ${btoa(JSON.stringify(authEvent))}` },
    });
    const auth = (await authRes.json()) as { error: boolean; data?: { token: string } };
    if (auth.error || !auth.data?.token) return { data: null, reached: false };

    const quotesRes = await fetch(`${NPUB_CASH_BASE}/api/v2/wallet/quotes?limit=1000`, {
      headers: { authorization: `Bearer ${auth.data.token}` },
    });
    const body = (await quotesRes.json()) as { error: boolean; data?: { quotes: NpcQuote[] } };
    if (body.error || !body.data) return { data: null, reached: false };
    return { data: body.data.quotes, reached: true };
  } catch {
    return { data: null, reached: false };
  }
}
