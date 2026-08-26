// Shared NIP-17 gift-wrap unwrapping.
//
// Single source of truth for turning a kind:1059 gift wrap into a readable
// message. Both the Messages page and the notification context use this so the
// decrypt-once ledger + serialized signer queue apply everywhere — the fix for
// "too many decryption prompts" on paranoid (NIP-46) signers.

import type { Event } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import { withSignerTimeout, SIGNER_CRYPTO_TIMEOUT, isSignerError } from "@/lib/signer-timeout";
import { decryptionQueue } from "@/lib/decryption-queue";
import {
  getProcessedWrapIds,
  markProcessed,
  type WrapStatus,
  type CachedFileMetadata,
} from "@/lib/dm-cache";
import { extractPrivateReplyRef } from "@/lib/private-reply";
import { parseFileMessage } from "@/lib/dm-file";

export const KIND_SEAL = 13;
export const KIND_RUMOR = 14;
export const KIND_FILE_MESSAGE = 15;
/** Concord direct invite (CORD-05) — rides the same NIP-59 gift-wrap pipe as DMs. */
export const KIND_DIRECT_INVITE_RUMOR = 3313;

export interface UnwrappedGiftWrap {
  senderPubkey: string;
  recipientPubkey: string;
  content: string;
  timestamp: number;
  rumorId: string;
  /** The decrypted rumor's kind — 14/15 are DMs; 3313 is a Concord invite. */
  rumorKind: number;
  fileMetadata?: CachedFileMetadata;
  /** Set when this DM is a "private reply": the kind-14 rumor carries a `q`
   *  quote tag referencing a public note. Holds that note's event id so the
   *  Chats view can render the quoted post above the reply text. */
  quotedNoteId?: string;
}

export function extractFileMetadata(rumor: any): CachedFileMetadata | undefined {
  if (rumor.kind !== KIND_FILE_MESSAGE) return undefined;
  const ref = parseFileMessage(rumor.tags, rumor.content);
  if (!ref) return undefined;
  const getTag = (name: string) => rumor.tags?.find((t: string[]) => t[0] === name)?.[1];
  return {
    url: ref.url,
    mimeType: ref.mime,
    size: ref.size,
    dim: ref.dim,
    blurhash: getTag("blurhash"),
    originalHash: ref.sha256,
    encAlgo: ref.algo,
    encKey: ref.key,
    encNonce: ref.nonce,
  };
}

// Session-memory set of wrap ids already attempted (any outcome). Backed by the
// persistent processed_wraps ledger via seedProcessedWraps(). Checked
// synchronously so the hot path never re-sends a known wrap to the signer.
const processedWrapIds = new Set<string>();

/** Hydrate the in-memory processed set from IndexedDB for an owner. Idempotent;
 *  safe to call from multiple mount points. */
export async function seedProcessedWraps(ownerPubkey: string): Promise<void> {
  if (!ownerPubkey) return;
  const ids = await getProcessedWrapIds(ownerPubkey);
  ids.forEach((id) => processedWrapIds.add(id));
}

/** True if this wrap has already been attempted this session / per the ledger. */
export function isWrapProcessed(wrapId: string): boolean {
  return processedWrapIds.has(wrapId);
}

/** Drop the in-memory processed set. Call on logout / account switch so one
 *  account's attempted-wrap ids can't gate another account's decrypt path. The
 *  persistent ledger is per-owner and re-seeded via seedProcessedWraps(). */
export function clearProcessedWraps(): void {
  processedWrapIds.clear();
}

/**
 * Unwrap a gift wrap to its inner message. Returns null if it can't be read
 * (not for us, malformed, signer unavailable, or already processed).
 *
 * Routes the two nip44 decrypts through the global decryption queue so that:
 *  - duplicate wraps (same id from multiple relays) coalesce to one decrypt,
 *  - calls hit the signer serially rather than in a burst.
 * Records the outcome in the persistent ledger so it is never decrypted again.
 */
export async function unwrapGiftWrap(
  signer: any,
  myPubkey: string,
  wrapEvent: Event,
  opts?: { force?: boolean },
): Promise<UnwrappedGiftWrap | null> {
  if (!signer?.nip44) return null;
  // Already attempted (this session or a previous one) — don't prompt again.
  // `force` overrides this so a thread whose decrypted body was never persisted
  // (e.g. a wrap decrypted before we cached messages) can self-heal by
  // re-decrypting when its conversation is opened with an empty cache.
  if (!opts?.force && processedWrapIds.has(wrapEvent.id)) return null;

  return decryptionQueue.enqueue(wrapEvent.id, async () => {
    // Re-check inside the task in case it was processed while queued.
    if (!opts?.force && processedWrapIds.has(wrapEvent.id)) return null;

    let status: WrapStatus = "failed";
    let retryable = false;
    try {
      const wrapPTag = wrapEvent.tags?.find((t: string[]) => t[0] === "p");
      if (wrapPTag && wrapPTag[1] !== myPubkey) {
        status = "foreign";
        return null;
      }

      const sealJson = await withSignerTimeout<string>(
        signer.nip44.decrypt(wrapEvent.pubkey, wrapEvent.content),
        SIGNER_CRYPTO_TIMEOUT,
      );
      const seal = JSON.parse(sealJson);
      if (seal.kind !== KIND_SEAL) return null;

      // NIP-17: the seal MUST be a validly-signed kind:13. Without verifying the
      // signature, the seal.pubkey === rumor.pubkey check below is bypassable and
      // a sender could impersonate anyone. Reject unsigned/forged seals.
      if (!seal.id || !seal.pubkey || !seal.sig || !verifyEvent(seal)) return null;

      const rumorJson = await withSignerTimeout<string>(
        signer.nip44.decrypt(seal.pubkey, seal.content),
        SIGNER_CRYPTO_TIMEOUT,
      );
      const rumor = JSON.parse(rumorJson);
      if (rumor.kind !== KIND_RUMOR && rumor.kind !== KIND_FILE_MESSAGE && rumor.kind !== KIND_DIRECT_INVITE_RUMOR) return null;
      if (rumor.pubkey && rumor.pubkey !== seal.pubkey) return null;

      const recipientTag = rumor.tags?.find((t: string[]) => t[0] === "p");
      const recipientPubkey = recipientTag?.[1] || "";

      status = "decrypted";
      return {
        senderPubkey: seal.pubkey,
        recipientPubkey,
        content: rumor.content,
        timestamp: rumor.created_at,
        rumorId: rumor.id || wrapEvent.id,
        rumorKind: rumor.kind,
        fileMetadata: extractFileMetadata(rumor),
        quotedNoteId: extractPrivateReplyRef(rumor.tags)?.noteId,
      } as UnwrappedGiftWrap;
    } catch (err) {
      status = "failed";
      // A signer timeout / signer-unavailable is transient. Persisting it would
      // permanently retire a wrap we never actually read — a flaky remote signer
      // (NIP-46/bunker) would then silently drop real incoming DMs forever. Leave
      // these unprocessed so they're retried on the next pass. Genuinely
      // undecryptable wraps (wrong key, malformed) still get retired below.
      retryable = isSignerError(err);
      return null;
    } finally {
      if (!retryable) {
        processedWrapIds.add(wrapEvent.id);
        void markProcessed(myPubkey, wrapEvent.id, status);
      }
    }
  });
}
