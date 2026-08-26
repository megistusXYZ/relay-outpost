import { nip19 } from "nostr-tools";

// Author mentions for share-sheet prefills.
//
// Share dialogs (article, track, stream, artist/album) prefill an editable
// textarea. Raw "nostr:npub1..." tokens are user-hostile there, so we show a
// friendly "@Name" instead and swap it back to a proper NIP-27 nostr:npub
// mention token at publish time. Other clients then render the published note
// with a tappable @mention, and the p-tag each dialog adds still notifies the
// author.
//
// The "@Name" is suffixed with an invisible zero-width marker (same trick as
// the interactive composer's use-mention.ts) so resolve() only rewrites the
// prefilled mention — never coincidental "@Name" text the user typed — and
// still works if the user moved the mention around. If the user edits or
// deletes the mention itself, resolve() leaves their text alone and just
// strips the invisible characters.

const ZWS = "\u200B";
const ZWNJ = "\u200C";

let shareMentionIdCounter = 0;

function encodeId(id: number): string {
  return id
    .toString(2)
    .split("")
    .map((b) => (b === "0" ? ZWS : ZWNJ))
    .join("");
}

export interface ShareMention {
  /** Embed this in the prefilled textarea content: "@Name" + invisible marker. */
  display: string;
  /** Rewrite surviving display mentions to "nostr:npub..." for the published event. */
  resolve: (content: string) => string;
}

export function createShareMention(pubkey: string, name: string): ShareMention | null {
  let npub: string;
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    return null;
  }
  const token = `${ZWS}${encodeId(++shareMentionIdCounter)}${ZWNJ}`;
  const display = `@${name}${token}`;
  return {
    display,
    resolve: (content: string) =>
      content.split(display).join(`nostr:${npub}`).replace(/[\u200B\u200C]/g, ""),
  };
}
