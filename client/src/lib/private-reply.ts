// Private replies — reply privately to a PUBLIC post. The reply is delivered as a
// NIP-17 gift-wrapped DM (kind-14 chat rumor) that QUOTES the post, so it lands in
// the recipient's Chats and interoperates with other NIP-17 clients.
//
// INTEROP CONVENTION (pinned to Nostur, the reference client):
//   Nostur's DM composer quotes an event inside a kind-14 chat message with a
//   `q` tag — `DMConversationVM.swift`: `tags.append(Tag(["q", quoted.id]))`,
//   rendered back via `BalloonView.swift` / `NRChatMessage.swift`
//   (`nEvent.tags.first(where: { $0.type == "q" })`). For PUBLIC quotes Nostur
//   uses the fuller NIP-18/NIP-27 form
//   `["q", <id>, <relayHint>, <authorPubkey>]` (`NewPostModel.swift`), and it
//   only reads index [1], so the hint + author are safe extra context.
//   This is also exactly what NIP-17 permits on a kind-14 rumor:
//   "`q` tags MAY be used when citing events ... ["q", "<event-id>",
//   "<relay-url>", "<pubkey-if-a-regular-event>"]".
//
//   We DELIBERATELY do NOT add an `e` tag pointing at the public note: in a
//   kind-14 rumor an `e` tag means "the direct parent DM this replies to"
//   (NIP-17), so Nostur/other clients would misrender it as an in-thread DM
//   reply to a message that doesn't exist. The `q` tag alone is the correct,
//   sufficient reference and is what the reference clients actually read.
//
// See: https://github.com/nostr-protocol/nips/blob/master/17.md
//      https://github.com/nostur-com/nostur-ios-public (DMs/DMConversationVM.swift,
//      DMs/BalloonView.swift, Post/PostComposer/NewPostModel.swift)

/** The reply rides the standard NIP-17 chat rumor kind so every DM client threads it. */
export const PRIVATE_REPLY_RUMOR_KIND = 14;

const HEX64 = /^[0-9a-f]{64}$/i;

export interface PrivateReplyRef {
  /** The quoted public note's event id (64-hex). */
  noteId: string;
  /** Optional author pubkey of the quoted note (q-tag index 3). */
  authorPubkey?: string;
  /** Optional relay hint for the quoted note (q-tag index 2). */
  relayHint?: string;
}

/**
 * The `q` quote tag for a private reply. Matches Nostur's public-quote form
 * `["q", <noteId>, <relayHint>, <authorPubkey>]`. Empty strings are kept as
 * positional placeholders so a present author still lands at index 3.
 */
export function buildPrivateReplyQuoteTag(
  noteId: string,
  authorPubkey?: string,
  relayHint?: string,
): string[] {
  return ["q", noteId, relayHint || "", authorPubkey || ""];
}

/**
 * The `extraTags` to hand to `createGiftWrap` / `sendDM` for a private reply.
 * The recipient `p` tag (to the post's author) is added by the gift-wrap builder
 * itself, so we only contribute the quote tag here — no duplicate `p`.
 */
export function buildPrivateReplyExtraTags(
  noteId: string,
  authorPubkey?: string,
  relayHint?: string,
): string[][] {
  return [buildPrivateReplyQuoteTag(noteId, authorPubkey, relayHint)];
}

/**
 * The full kind-14 rumor TEMPLATE for a private reply. This is the single source
 * of truth for the pinned convention (kind + p + q + content) and is what the
 * unit tests assert against. The gift-wrap pipeline (createGiftWrap) reconstructs
 * the same shape from `senderPubkey` + the recipient `p` tag + `extraTags`.
 */
export function buildPrivateReplyRumor(params: {
  senderPubkey: string;
  authorPubkey: string;
  noteId: string;
  content: string;
  relayHint?: string;
  createdAt?: number;
}): {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
} {
  const { senderPubkey, authorPubkey, noteId, content, relayHint, createdAt } = params;
  return {
    kind: PRIVATE_REPLY_RUMOR_KIND,
    pubkey: senderPubkey,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    content,
    tags: [
      relayHint ? ["p", authorPubkey, relayHint] : ["p", authorPubkey],
      buildPrivateReplyQuoteTag(noteId, authorPubkey, relayHint),
    ],
  };
}

/**
 * Receive-side classifier. Given a decrypted rumor's tags, return the quoted
 * public-note reference if this DM is a private reply, else null.
 *
 * A private reply carries a `q` tag whose value is a 64-hex event id. Addressable
 * `q` coordinates ("kind:pubkey:d") and malformed values are ignored (they aren't
 * private replies to a plain post), so normal DMs classify as null and render
 * exactly as before.
 */
export function extractPrivateReplyRef(tags: string[][] | undefined): PrivateReplyRef | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== "q") continue;
    const noteId = t[1];
    if (typeof noteId !== "string" || !HEX64.test(noteId)) continue;
    const relayHint = typeof t[2] === "string" && t[2] ? t[2] : undefined;
    const authorPubkey = typeof t[3] === "string" && HEX64.test(t[3]) ? t[3] : undefined;
    return { noteId, authorPubkey, relayHint };
  }
  return null;
}

/** True when the rumor's tags mark it as a private reply (has a valid quote ref). */
export function isPrivateReply(tags: string[][] | undefined): boolean {
  return extractPrivateReplyRef(tags) !== null;
}
