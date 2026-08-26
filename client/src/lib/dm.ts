import type { Event } from "nostr-tools";
import { generateSecretKey, finalizeEvent, getEventHash, verifyEvent } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { publishEvent } from "@/lib/nostr";
import { fetchDMRelayList, hasDMRelayList, getDMRelaysForContact, getDMRelayListCached, getLocalDMRelays, getMyDMReceiveRelays, DM_FALLBACK_RELAYS } from "@/lib/outbox";

// Single source of truth lives in outbox.ts; re-export for existing import sites
// (HolidayManager, ContentCalendar) that import it from here.
export { getDMRelaysForContact };
import { signWithTimeout, withSignerTimeout, SIGNER_CRYPTO_TIMEOUT } from "@/lib/signer-timeout";

const KIND_GIFT_WRAP = 1059;
const KIND_SEAL = 13;
const KIND_RUMOR = 14;
const KIND_FILE_MESSAGE = 15;
const SIGNER_TIMEOUT = SIGNER_CRYPTO_TIMEOUT;

// NIP-17: randomize created_at "up to two days in the PAST" — never the future
// (future-dated events are rejected by many relays). 0 .. -172800 seconds.
function randomTimeOffset(): number {
  return -Math.floor(Math.random() * 172800);
}

// NIP-17 p-tags SHOULD carry a relay-url hint: ["p", pubkey, relayUrl].
function pTag(pubkey: string, relayHint?: string): string[] {
  return relayHint ? ["p", pubkey, relayHint] : ["p", pubkey];
}

/**
 * Publish a NIP-17 gift wrap through the AUTH-aware publish path (publishEvent),
 * so relays that require NIP-42 AUTH get the wait-for-AUTH-then-retry treatment
 * instead of timing out silently. userSelected=true keeps the caller's
 * carefully-chosen DM relay set intact (no health-pruning / read-relay merge).
 * Pass skipFallbacks when the recipient has a published kind-10050 inbox.
 */
export async function publishWithFallback(relays: string[], event: Event, skipFallbacks?: boolean): Promise<void> {
  const targets = skipFallbacks
    ? relays
    : Array.from(new Set([...relays, ...DM_FALLBACK_RELAYS]));
  // suppressAuthToast: DM callers (deliverMessage) decide whether to warn, based on
  // whether the recipient's actual inbox got it — not per-relay auth failures.
  const ok = await publishEvent(event, targets, undefined, true, undefined, true);
  if (!ok) {
    throw new Error("Could not reach any relay. Check your connection and try again.");
  }
}

// Canonical NIP-17 gift-wrap builders (single source of truth — Messages.tsx imports
// these rather than keeping its own copies, which had drifted in signature/return type).
// Options object on purpose: positional rumorKind vs rumorCreatedAt is exactly what drifted.
export interface GiftWrapOptions {
  rumorKind?: number;
  rumorCreatedAt?: number;
  extraTags?: string[][];
  /** Extra tags on the OUTER 1059 wrap (e.g. Concord's ["k","3313"] so
   *  recipients can filter invites without decrypting every gift wrap). */
  outerTags?: string[][];
}

export async function createGiftWrap(
  signer: any,
  senderPubkey: string,
  recipientPubkey: string,
  content: string,
  opts: GiftWrapOptions = {},
): Promise<{ wrap: Event; rumorId: string } | null> {
  if (!signer.nip44) return null;

  try {
    const relayHint = getDMRelayListCached(recipientPubkey)[0];
    const tags: string[][] = [pTag(recipientPubkey, relayHint), ...(opts.extraTags || [])];
    const rumorTemplate = {
      kind: opts.rumorKind ?? KIND_RUMOR,
      created_at: opts.rumorCreatedAt ?? Math.floor(Date.now() / 1000),
      tags,
      content,
      pubkey: senderPubkey,
    };
    const rumor = { ...rumorTemplate, id: getEventHash(rumorTemplate as any) };

    const sealContent = await withSignerTimeout(signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor)), SIGNER_TIMEOUT);
    const sealTemplate = {
      kind: KIND_SEAL,
      created_at: Math.floor(Date.now() / 1000) + randomTimeOffset(),
      tags: [],
      content: sealContent,
    };
    const signedSeal = await withSignerTimeout(signer.signEvent(sealTemplate), SIGNER_TIMEOUT);

    const wrapPrivkey = generateSecretKey();
    const conversationKey = nip44v2.utils.getConversationKey(wrapPrivkey, recipientPubkey);
    const wrapContent = nip44v2.encrypt(JSON.stringify(signedSeal), conversationKey);

    const wrapEvent = finalizeEvent({
      kind: KIND_GIFT_WRAP,
      created_at: Math.floor(Date.now() / 1000) + randomTimeOffset(),
      tags: [pTag(recipientPubkey, relayHint), ...(opts.outerTags || [])],
      content: wrapContent,
    }, wrapPrivkey);

    return { wrap: wrapEvent as unknown as Event, rumorId: rumor.id };
  } catch (err) {
    console.error("Failed to create gift wrap:", err);
    return null;
  }
}

export async function createGiftWrapForSelf(
  signer: any,
  senderPubkey: string,
  recipientPubkey: string,
  content: string,
  opts: GiftWrapOptions = {},
): Promise<Event | null> {
  if (!signer.nip44) return null;

  try {
    const recipientHint = getDMRelayListCached(recipientPubkey)[0];
    const tags: string[][] = [pTag(recipientPubkey, recipientHint), ...(opts.extraTags || [])];
    const rumorTemplate = {
      kind: opts.rumorKind ?? KIND_RUMOR,
      created_at: opts.rumorCreatedAt ?? Math.floor(Date.now() / 1000),
      tags,
      content,
      pubkey: senderPubkey,
    };
    const rumor = { ...rumorTemplate, id: getEventHash(rumorTemplate as any) };

    const sealContent = await withSignerTimeout(signer.nip44.encrypt(senderPubkey, JSON.stringify(rumor)), SIGNER_TIMEOUT);
    const sealTemplate = {
      kind: KIND_SEAL,
      created_at: Math.floor(Date.now() / 1000) + randomTimeOffset(),
      tags: [],
      content: sealContent,
    };
    const signedSeal = await withSignerTimeout(signer.signEvent(sealTemplate), SIGNER_TIMEOUT);

    const wrapPrivkey = generateSecretKey();
    const conversationKey = nip44v2.utils.getConversationKey(wrapPrivkey, senderPubkey);
    const wrapContent = nip44v2.encrypt(JSON.stringify(signedSeal), conversationKey);

    const selfHint = getDMRelayListCached(senderPubkey)[0] || getLocalDMRelays()[0];
    const wrapEvent = finalizeEvent({
      kind: KIND_GIFT_WRAP,
      created_at: Math.floor(Date.now() / 1000) + randomTimeOffset(),
      tags: [pTag(senderPubkey, selfHint)],
      content: wrapContent,
    }, wrapPrivkey);

    return wrapEvent as unknown as Event;
  } catch (err) {
    console.error("Failed to create self gift wrap:", err);
    return null;
  }
}

export interface UnwrappedRumor {
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
  id: string;
}

/**
 * Unwrap a NIP-17 gift wrap to its raw inner rumor, preserving kind + tags.
 * Unlike the DM-specific unwrap in gift-wrap.ts (which only accepts chat kinds
 * 14/15), this returns any rumor — used to carry private feedback tickets
 * (issue kind 1621, comment kind 1111) inside gift wraps.
 */
export async function unwrapGiftWrapRumor(
  signer: any,
  myPubkey: string,
  wrap: Event,
): Promise<UnwrappedRumor | null> {
  if (!signer?.nip44) return null;
  try {
    const wrapPTag = wrap.tags?.find((t) => t[0] === "p");
    if (wrapPTag && wrapPTag[1] !== myPubkey) return null;
    const sealJson = await withSignerTimeout<string>(signer.nip44.decrypt(wrap.pubkey, wrap.content), SIGNER_TIMEOUT);
    const seal = JSON.parse(sealJson);
    if (seal.kind !== KIND_SEAL) return null;
    // NIP-17: seal MUST be a validly-signed kind:13 (else sender attribution is
    // forgeable). Reject unsigned/forged seals before trusting seal.pubkey.
    if (!seal.id || !seal.pubkey || !seal.sig || !verifyEvent(seal)) return null;
    const rumorJson = await withSignerTimeout<string>(signer.nip44.decrypt(seal.pubkey, seal.content), SIGNER_TIMEOUT);
    const rumor = JSON.parse(rumorJson);
    if (rumor.pubkey && rumor.pubkey !== seal.pubkey) return null;
    return {
      pubkey: seal.pubkey,
      kind: rumor.kind,
      tags: Array.isArray(rumor.tags) ? rumor.tags : [],
      content: rumor.content || "",
      created_at: rumor.created_at,
      id: rumor.id || wrap.id,
    };
  } catch {
    return null;
  }
}

export interface SendDMOptions {
  signer: any;
  senderPubkey: string;
  recipientPubkey: string;
  content: string;
  rumorKind?: number;
  extraTags?: string[][];
  /**
   * Extra relays the recipient's gift wrap MUST also be published to, on top of
   * the recipient's discovered kind-10050 inbox. Folded into the recipient
   * target set so they're honored even when the recipient has a published inbox
   * (which otherwise pins the target set to that inbox alone, skipping fallbacks).
   * Used by the crash reporter to guarantee delivery to the operator's own relay.
   */
  extraRelays?: string[];
}

export interface SendDMResult {
  success: boolean;
  method: "nip17";
  error?: string;
  /** The kind-14 rumor id of the sent message (stable across the recipient
   *  wrap and the self-copy), so callers outside the Messages page can write
   *  the message to the DM cache without minting a synthetic id that would
   *  later duplicate when the self-copy wrap decrypts. */
  rumorId?: string;
}

export async function sendDM({ signer, senderPubkey, recipientPubkey, content, rumorKind, extraTags, extraRelays }: SendDMOptions): Promise<SendDMResult> {
  if (!signer.nip44) {
    return { success: false, method: "nip17", error: "Your signer does not support NIP-44 encryption. Please use a Nostr extension that supports NIP-44 (e.g. Alby, nos2x, Nostore)." };
  }

  try {
    // force: an explicit send must re-check for a freshly-published kind-10050,
    // never serve a stale "no DM relays" from the negative cache.
    await fetchDMRelayList(recipientPubkey, { force: true }).catch(() => {});
    const recipientHas10050 = hasDMRelayList(recipientPubkey);
    // NIP-17: the recipient's wrap goes to THEIR relays only; the self-copy goes
    // to MY relays. (No myPubkey arg → recipient-only target set.)
    // extraRelays are unioned in here (not appended at publish time) so they
    // survive the skipFallbacks pin below — when the recipient HAS a kind-10050
    // inbox, publishWithFallback publishes to exactly `recipientRelays`, so an
    // extra relay only lands if it's part of this set.
    const recipientRelays = extraRelays?.length
      ? Array.from(new Set([...getDMRelaysForContact(recipientPubkey), ...extraRelays]))
      : getDMRelaysForContact(recipientPubkey);
    const selfRelays = getMyDMReceiveRelays(senderPubkey);

    // Pin one created_at for both copies so the recipient wrap and the
    // self-copy carry the SAME rumor id (they hash created_at; two calls can
    // straddle a second boundary and drift).
    const rumorCreatedAt = Math.floor(Date.now() / 1000);
    const wrapForRecipient = await createGiftWrap(signer, senderPubkey, recipientPubkey, content, { rumorKind, extraTags, rumorCreatedAt });
    const wrapForSelf = await createGiftWrapForSelf(signer, senderPubkey, recipientPubkey, content, { rumorKind, extraTags, rumorCreatedAt });

    if (!wrapForRecipient) {
      return { success: false, method: "nip17", error: "Failed to create encrypted message. Please try again." };
    }

    await publishWithFallback(recipientRelays, wrapForRecipient.wrap, recipientHas10050);
    if (wrapForSelf) {
      publishWithFallback(selfRelays, wrapForSelf, true).catch(() => {});
    }

    return { success: true, method: "nip17", rumorId: wrapForRecipient.rumorId };
  } catch (err) {
    const isRelayError = err instanceof AggregateError || (err instanceof Error && err.message.includes("All promises were rejected"));
    const errorMessage = isRelayError
      ? "Could not reach any relay. Check your connection and try again."
      : err instanceof Error ? err.message : "Could not encrypt or publish message.";
    return { success: false, method: "nip17", error: errorMessage };
  }
}
