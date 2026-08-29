/**
 * npub.cash usernames — claim a human `name@npub.cash` lightning address.
 *
 * Contract measured live 2026-08-29 (throwaway key, prod npub.cash):
 *  - Auth: the same NIP-98 → JWT dance as npubcash-api.ts. The JWT is a session
 *    token, so we get it ONCE and reuse it for every availability check (one
 *    signer prompt, not one per keystroke).
 *  - `GET /api/v2/user/info` (Bearer) → `{data:{user:{pubkey,mintUrl,lockQuote,username?}}}`
 *    — `username` is absent until one is claimed.
 *  - `POST /api/v2/user/username` (Bearer, `{username}`), UNPAID, is a safe
 *    availability probe (it only sets the name on a PAID request):
 *      400 "Invalid username!"      → bad format (hyphens, <3 chars, …)
 *      409 "Username already taken" → taken
 *      402 "Payment required"       → available; the `x-cashu` RESPONSE header
 *          carries a NUT-18 Cashu payment request (creqA…) that decodes to the
 *          price (measured 5000 sats to mint.minibits.cash) — so we CAN show it.
 *
 * v1 pays by LINKING OUT to npub.cash (no in-app ecash handling). This module
 * covers everything else: display, live availability + price, and the JWT.
 */
import type { ISigner } from "applesauce-signers";
import type { Reached } from "./relay-reach";
import { signWithTimeout } from "./signer-timeout";
import { NPUB_CASH_BASE, buildNip98Template } from "./npubcash-api";

export interface NpubCashUserInfo {
  pubkey: string;
  mintUrl: string | null;
  lockQuote: boolean;
  /** The claimed username, or null when none is set. */
  username: string | null;
}

export type UsernameCheck =
  | { status: "available"; priceSats: number | null; mint: string | null }
  | { status: "taken" }
  | { status: "invalid" }
  | { status: "unreachable" };

/**
 * Client-side format gate so we don't probe the API on obviously-bad input and
 * can give instant feedback. The SERVER is authoritative (a name that passes
 * here can still come back 400) — this only rejects the clearly-invalid. Rules
 * confirmed live: lowercase alphanumeric, ≥3 chars, no hyphens.
 */
export function validateUsernameFormat(name: string): { ok: true } | { ok: false; reason: string } {
  const n = name.trim();
  if (n.length < 3) return { ok: false, reason: "At least 3 characters." };
  if (n.length > 30) return { ok: false, reason: "At most 30 characters." };
  if (!/^[a-z0-9]+$/.test(n)) return { ok: false, reason: "Lowercase letters and numbers only." };
  return { ok: true };
}

/**
 * The price from a 402's `x-cashu` NUT-18 payment request, or null if it can't
 * be read. Best-effort: a missing/garbled header just means "price unknown",
 * never an error.
 */
export async function decodeCashuPriceSats(
  header: string | null | undefined,
): Promise<{ sats: number; mint: string | null } | null> {
  if (!header) return null;
  try {
    const { PaymentRequest } = await import("@cashu/cashu-ts");
    const pr = PaymentRequest.fromEncodedRequest(header.trim());
    const sats = typeof pr.amount === "number" ? pr.amount : Number(pr.amount);
    if (!Number.isFinite(sats) || sats <= 0) return null;
    return { sats, mint: (Array.isArray(pr.mints) && pr.mints[0]) || null };
  } catch {
    return null;
  }
}

/** Map an availability-probe response to a decision. Pure over (status, header). */
export async function classifyUsernameCheck(
  status: number,
  xCashuHeader: string | null,
): Promise<UsernameCheck> {
  if (status === 402) {
    const price = await decodeCashuPriceSats(xCashuHeader);
    return { status: "available", priceSats: price?.sats ?? null, mint: price?.mint ?? null };
  }
  if (status === 409) return { status: "taken" };
  if (status === 400) return { status: "invalid" };
  return { status: "unreachable" };
}

// ── IO ───────────────────────────────────────────────────────────────────────

/**
 * One NIP-98 → JWT exchange. Reach-honest: null when the service didn't answer
 * with a token. Caches nothing — the caller holds the token for the session so
 * a signer is prompted at most once.
 */
export async function getNpubCashJwt(signer: ISigner): Promise<string | null> {
  try {
    const authUrl = `${NPUB_CASH_BASE}/api/v2/auth/nip98`;
    const authEvent = await signWithTimeout(signer, buildNip98Template(authUrl, "GET"));
    const res = await fetch(authUrl, { headers: { authorization: `Nostr ${btoa(JSON.stringify(authEvent))}` } });
    const body = (await res.json()) as { error?: boolean; data?: { token?: string } };
    if (body.error || !body.data?.token) return null;
    return body.data.token;
  } catch {
    return null;
  }
}

/** The account's current npub.cash info (incl. its username), reach-honestly. */
export async function fetchNpubCashUserInfo(jwt: string): Promise<Reached<NpubCashUserInfo | null>> {
  try {
    const res = await fetch(`${NPUB_CASH_BASE}/api/v2/user/info`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    const body = (await res.json()) as { error?: boolean; data?: { user?: { pubkey: string; mintUrl?: string; lockQuote?: boolean; username?: string } } };
    const user = body.data?.user;
    if (body.error || !user?.pubkey) return { data: null, reached: false };
    return {
      data: {
        pubkey: user.pubkey,
        mintUrl: user.mintUrl ?? null,
        lockQuote: !!user.lockQuote,
        username: user.username ?? null,
      },
      reached: true,
    };
  } catch {
    return { data: null, reached: false };
  }
}

/**
 * Probe a candidate name's availability (unpaid — no side effect). Returns the
 * classified decision, decoding the price from the 402's x-cashu header.
 */
export async function checkNpubCashUsername(jwt: string, name: string): Promise<UsernameCheck> {
  try {
    const res = await fetch(`${NPUB_CASH_BASE}/api/v2/user/username`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ username: name }),
    });
    return await classifyUsernameCheck(res.status, res.headers.get("x-cashu"));
  } catch {
    return { status: "unreachable" };
  }
}
