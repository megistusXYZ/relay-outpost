/**
 * The hand-off that lets an invited person arrive already connected to a human.
 *
 * Two different links can bring someone here, and until now only one of them
 * carried a person:
 *  - a friend link (`?inviter=<npub>`), which App.tsx captures on arrival, and
 *  - a Concord community link, whose bundle has always carried `creator_npub`
 *    but never read it — so a friend invited to a group followed nobody.
 *
 * Both now leave the same small record behind, and InviteAcceptCard picks it up:
 * a brand-new signup already follows their inviter (the anchor follow), so it
 * opens straight at "say hi"; a community arrival still gets the follow step
 * first, because a community link can be forwarded or scanned off a QR and must
 * never silently follow someone on the reader's behalf.
 */

import { decodeNpubToHex } from "@/helpers/nostr-helpers";

/** Which link they came through — decides the card's wording. */
export type InviteSource = "friend" | "link";

export interface InviteConnect {
  /** Inviter pubkey, hex. */
  inviter: string;
  /** Where the card opens. "sayhi" means the follow already happened. */
  step: "follow" | "sayhi";
  source: InviteSource;
  /** Community name, when they came through a community invite. */
  context?: string;
  /**
   * The relay to join, when the invite landed the person in a community. Carried
   * here (rather than auto-joined at signup) so the join is CONSENTED: an invite
   * link's relay is attacker-controllable, and a silently-joined relay becomes a
   * default publish target and a NIP-42 auto-AUTH target. The invite-accept card
   * joins it only when the person engages, never on dismiss.
   */
  relay?: string;
}

/**
 * A community name long enough to swamp the message is dropped rather than
 * truncated — a half-cut group name reads worse than no name at all.
 */
const MAX_CONTEXT = 50;

/** The prefilled first message. Written as the invitee would write it. */
export function sayHiDefault(context?: string): string {
  const name = context?.trim();
  if (!name || name.length > MAX_CONTEXT) return "👋 Just joined — thanks for the invite!";
  return `👋 Just joined ${name} — thanks for the invite!`;
}

/** Storage key for the hand-off. */
export const INVITE_CONNECT_KEY = "relay-outpost-invite-connect";

const isHexPubkey = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/**
 * The person who minted a community invite, from the bundle's `creator_npub`.
 *
 * That field has been written into every minted link since the beginning and
 * never read, which is why joining a group connected you to nobody. It lives
 * inside the encrypted bundle, so reading it reveals nothing the invitee
 * couldn't already see. Null whenever there's nobody to connect to: an older
 * link, a direct invite (which passes no creator), a malformed value, or your
 * own link handed back to you.
 */
export function inviterFromCreator(creator: string | undefined | null, selfHex?: string | null): string | null {
  if (!creator) return null;
  let hex: string | null = null;
  if (isHexPubkey(creator)) hex = creator;
  else {
    try { hex = decodeNpubToHex(creator); } catch { return null; }
  }
  if (!isHexPubkey(hex)) return null;
  return hex === selfHex ? null : hex;
}

export function encodeInviteConnect(rec: InviteConnect): string {
  return JSON.stringify(rec);
}

/**
 * Parse a stored hand-off, or null if it is anything other than a record we
 * wrote. The inviter goes on to be followed and DM'd, so an unvalidated value
 * here would hand an arbitrary string to those paths — every field is checked,
 * and a merely odd `context` is dropped rather than voiding the whole record.
 */
export function decodeInviteConnect(raw: string | null | undefined): InviteConnect | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { inviter, step, source, context, relay } = parsed as Record<string, unknown>;
  if (!isHexPubkey(inviter)) return null;
  if (step !== "follow" && step !== "sayhi") return null;
  if (source !== "friend" && source !== "link") return null;
  const rec: InviteConnect = { inviter, step, source };
  if (typeof context === "string" && context.trim()) rec.context = context;
  // Only a well-formed relay websocket URL survives — a malformed value is
  // dropped (like context) rather than voiding the whole hand-off, and can
  // never reach the join path.
  if (typeof relay === "string" && /^wss?:\/\/[^\s]+$/i.test(relay)) rec.relay = relay;
  return rec;
}

export function readInviteConnect(): InviteConnect | null {
  try { return decodeInviteConnect(sessionStorage.getItem(INVITE_CONNECT_KEY)); } catch { return null; }
}

export function setInviteConnect(rec: InviteConnect): void {
  try { sessionStorage.setItem(INVITE_CONNECT_KEY, encodeInviteConnect(rec)); } catch { /* best-effort */ }
}

export function clearInviteConnect(): void {
  try { sessionStorage.removeItem(INVITE_CONNECT_KEY); } catch { /* ignore */ }
}
