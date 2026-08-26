// Personal "invite a friend" links. The receiving side reads `?inviter=<npub>` on any
// route (and an `/outposts/<relay>` path) into sessionStorage, so a brand-new account
// created from this link auto-follows the inviter — and auto-joins the outpost when one
// is included. This is the generate/share counterpart, mirroring buildChannelInviteLink()
// in nip29.ts.
import { decodeNpubToHex } from "@/helpers/nostr-helpers";
import { sendDM } from "@/lib/dm";
import { sayHiDefault } from "@/lib/invite-connect";

/**
 * Send the one-tap "say hi" DM from a just-arrived invitee back to their
 * inviter, via NIP-17 (lib/dm.ts sendDM). Reached from InviteAcceptCard, which
 * both invite rails now hand off to — a brand-new signup (already following its
 * inviter, so it opens straight at the hello) and a community-link arrival.
 * Returns sendDM's result so callers can toast success/failure.
 */
export async function sendSayHiDM(opts: {
  signer: any;
  senderPubkey: string;
  inviterHex: string;
  content?: string;
}): Promise<{ success: boolean; error?: string }> {
  const content = (opts.content ?? "").trim() || sayHiDefault();
  const res = await sendDM({
    signer: opts.signer,
    senderPubkey: opts.senderPubkey,
    recipientPubkey: opts.inviterHex,
    content,
  });
  return { success: res.success, error: res.error };
}

export interface ParsedInvite {
  /** Inviter pubkey (hex), or null if absent/invalid. */
  inviterHex: string | null;
  /** Outpost relay URL from an `/outposts/<relay>` path, or null. */
  relayUrl: string | null;
}

/**
 * Parse invite context out of a location. Path-INDEPENDENT by construction: the
 * `?inviter=` capture must work on every route including the public landing "/"
 * (a plain friend invite is `/?inviter=…`). Gating this behind a non-"/" branch is
 * exactly the bug that silently dropped friend invites.
 */
export function parseInviteParams(search: string, pathname: string): ParsedInvite {
  let inviterHex: string | null = null;
  let relayUrl: string | null = null;
  try {
    const inviterParam = new URLSearchParams(search).get("inviter");
    if (inviterParam) inviterHex = decodeNpubToHex(inviterParam);
  } catch {}
  const relayMatch = pathname.match(/^\/outposts\/([^/?]+)/);
  if (relayMatch) {
    try { relayUrl = decodeURIComponent(relayMatch[1]); } catch { relayUrl = relayMatch[1]; }
  }
  return { inviterHex, relayUrl };
}

export function buildFriendInviteLink(inviterNpub: string, relayUrl?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = relayUrl ? `${origin}/outposts/${encodeURIComponent(relayUrl)}` : `${origin}/`;
  return `${base}?inviter=${encodeURIComponent(inviterNpub)}`;
}
