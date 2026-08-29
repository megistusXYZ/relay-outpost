/**
 * Joining a Buzz community — Block's hosted NIP-29 relays at
 * *.communities.buzz.xyz — happens over HTTP, not Nostr.
 *
 * Measured live 2026-08-28 (and confirmed in github.com/block/buzz,
 * crates/buzz-relay/src/api/invites.rs): these relays refuse EVENTs from
 * unauthenticated sockets ("auth-required") AND refuse NIP-42 AUTH from
 * non-members ("restricted: not a relay member") — so the kind-9021 knock
 * that works on other NIP-29 relays can never land here. The actual door is
 * `POST /api/invites/claim` with an invite code, NIP-98-signed; membership is
 * immediate, after which NIP-42 AUTH passes and the relay opens up.
 *
 * When the community configures a join policy (Block's ToS/privacy + an age
 * attestation), the claim requires a receipt from
 * `POST /api/invites/accept-policy`. Consent is the USER's to give — callers
 * must show the policy and collect the acceptance; this module never invents
 * one.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { resolveSessionSigner } from "./session-signer";

export function isBuzzCommunityHost(relayUrl: string): boolean {
  try {
    const host = new URL(relayUrl).hostname;
    return /^[a-z0-9-]+\.communities\.buzz\.xyz$/i.test(host);
  } catch {
    return false;
  }
}

function httpsBase(relayUrl: string): string {
  return `https://${new URL(relayUrl).hostname}`;
}

export interface BuzzJoinPolicy {
  version: string;
  termsMarkdown: string;
  privacyMarkdown: string;
  ageAttestationRequired: boolean;
}

interface ClaimIO {
  fetchFn?: typeof fetch;
  signer?: { signEvent: (event: any) => Promise<any> } | null;
}

/**
 * The community's join policy, or null when none is configured. Reach-honest:
 * `reached: false` means the question was never answered — not "no policy".
 */
export async function fetchBuzzJoinPolicy(
  relayUrl: string,
  io: ClaimIO = {},
): Promise<{ reached: true; policy: BuzzJoinPolicy | null } | { reached: false }> {
  // Only ever talk to a recognized Buzz community host (defense-in-depth: the
  // caller's relayUrl is route-controlled).
  if (!isBuzzCommunityHost(relayUrl)) return { reached: false };
  const fetchFn = io.fetchFn ?? fetch;
  try {
    const r = await fetchFn(`${httpsBase(relayUrl)}/api/join-policy`, {
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404) return { reached: true, policy: null };
    if (!r.ok) return { reached: false };
    const body = await r.json();
    const p = body?.policy;
    if (!p?.version) return { reached: true, policy: null };
    return {
      reached: true,
      policy: {
        version: p.version,
        termsMarkdown: p.terms_markdown || "",
        privacyMarkdown: p.privacy_markdown || "",
        ageAttestationRequired: !!p.age_attestation_required,
      },
    };
  } catch {
    return { reached: false };
  }
}

const CLAIM_ERRORS: Record<string, string> = {
  invite_invalid: "That invite isn't valid anymore — ask the community for a fresh one.",
  invite_expired: "That invite has expired — ask the community for a fresh one.",
  invite_exhausted: "That invite has been used up — ask the community for a fresh one.",
};

export type ClaimResult =
  | { ok: true }
  | { ok: false; error: string; policyRequired?: boolean };

export async function claimBuzzInvite(opts: {
  relayUrl: string;
  code: string;
  /** The user's explicit policy acceptance, when the community requires one. */
  acceptance?: { policyVersion: string; ageConfirmed: boolean };
  io?: ClaimIO;
}): Promise<ClaimResult> {
  // Enforce the Buzz-host restriction at the SIGNING boundary, not just in the
  // UI: this POSTs a NIP-98 event signed with the user's key, so a caller that
  // reached here with an attacker-controlled relayUrl must never send that proof
  // to a non-Buzz host.
  if (!isBuzzCommunityHost(opts.relayUrl)) {
    return { ok: false, error: "That community relay isn't recognized." };
  }
  const fetchFn = opts.io?.fetchFn ?? fetch;
  const signer = opts.io?.signer !== undefined ? opts.io.signer : resolveSessionSigner();
  if (!signer) return { ok: false, error: "No signer available — sign in again." };
  const base = httpsBase(opts.relayUrl);

  try {
    let receipt: string | undefined;
    if (opts.acceptance) {
      const ar = await fetchFn(`${base}/api/invites/accept-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: opts.code,
          policy_version: opts.acceptance.policyVersion,
          age_confirmed: opts.acceptance.ageConfirmed,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const abody = await ar.json().catch(() => ({}));
      if (!ar.ok || !abody?.receipt) {
        return { ok: false, error: "The community didn't accept the policy confirmation — try again." };
      }
      receipt = abody.receipt;
    }

    const claimUrl = `${base}/api/invites/claim`;
    const body = JSON.stringify({ code: opts.code, ...(receipt ? { policy_receipt: receipt } : {}) });
    // NIP-98 over the exact body bytes — the relay verifies the payload tag.
    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", claimUrl],
        ["method", "POST"],
        ["payload", bytesToHex(sha256(new TextEncoder().encode(body)))],
      ],
      content: "",
    };
    const signed = await signer.signEvent(authEvent);
    const r = await fetchFn(claimUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Nostr " + btoa(JSON.stringify(signed)),
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const rbody = await r.json().catch(() => ({}));
    if (r.ok && (rbody?.status === "joined" || rbody?.status === "already_member")) {
      return { ok: true };
    }
    const code = typeof rbody?.error === "string" ? rbody.error : "";
    if (code === "join_policy_required") {
      return { ok: false, error: "This community asks you to accept its policy first.", policyRequired: true };
    }
    return {
      ok: false,
      error: CLAIM_ERRORS[code] || (code ? code.replace(/_/g, " ") : `The community answered ${r.status} — try again.`),
    };
  } catch {
    return { ok: false, error: "Couldn't reach the community — it may be offline. Try again in a moment." };
  }
}
