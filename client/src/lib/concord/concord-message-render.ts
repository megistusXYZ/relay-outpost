/**
 * Pure render-model helpers for Concord chat message bodies.
 *
 * RENDERING-ONLY: this module reshapes an already-DECRYPTED rumor for the
 * shared rich-content renderers. It must never import from (or feed back into)
 * the Concord crypto/publish path — concord-crypto / concord-events /
 * concord-stream stay untouched by the rich-render feature.
 *
 * Kept free of React and app singletons so it is unit-testable in a plain
 * node vitest environment (same contract as chat-render-items.ts).
 */
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { extractHashtags } from "@/lib/nostr-helpers";
import { classifyUrl } from "@/lib/media-utils";

/**
 * Wrap a decrypted rumor's fields in an event-shaped object for the shared
 * applesauce content renderer (same pseudo-event pattern as the NIP-29 chat's
 * ChatContentRenderer). The rumor is NOT a signed public event — sig stays
 * empty and nothing here is ever published.
 *
 * `t` tags are synthesized from the content because applesauce's hashtag
 * transformer only lights up hashtags that have a matching `t` tag on the
 * event — chat rumors (ours and Armada's) don't carry them.
 */
export function rumorRenderEvent(msg: { id: string; pubkey: string; content: string }): Event {
  return {
    id: msg.id,
    pubkey: msg.pubkey,
    created_at: 0,
    kind: 9,
    tags: extractHashtags(msg.content),
    content: msg.content,
    sig: "",
  };
}

/** How a bare URL in an encrypted room renders. */
export type ConcordLinkKind = "image" | "video" | "audio" | "link";

/**
 * PRIVACY GUARD: in an encrypted room, only directly-linked media files render
 * inline (same precedent as Concord's own encrypted attachments). Everything
 * else — YouTube/Vimeo/music/generic pages — degrades to a plain tappable
 * link: no third-party embed iframes and no link-preview/OG fetching, so the
 * room never announces its contents to an external service.
 */
export function concordLinkKind(url: string): ConcordLinkKind {
  const type = classifyUrl(url);
  return type === "image" || type === "video" || type === "audio" ? type : "link";
}

export type ReplyPreviewSegment =
  | { type: "text"; text: string }
  | { type: "mention"; pubkey: string };

// nostr:-prefixed token (any bech32ish payload, mirroring the old strip regex)
// OR a bare known-prefix bech32 token. Fresh instance per call — a module-level
// /g regex would leak lastIndex state between calls (non-idempotent parsing).
const tokenRegex = () =>
  /nostr:[a-z0-9]+|(?:npub|nprofile|note|nevent|naddr)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}/gi;

/**
 * Split reply-quote/preview text into segments: npub/nprofile tokens become
 * `mention` segments (the UI resolves them to @DisplayName), note/nevent/naddr
 * tokens are dropped but flagged via `hadRef` ("Shared a post" fallback), and
 * junk `nostr:` tokens are stripped like the old preview did. Whitespace is
 * collapsed for one-line rendering.
 */
export function replyPreviewSegments(content: string): {
  segments: ReplyPreviewSegment[];
  hadRef: boolean;
} {
  const re = tokenRegex();
  const segments: ReplyPreviewSegment[] = [];
  let hadRef = false;
  let last = 0;
  let match: RegExpExecArray | null;

  const pushText = (raw: string) => {
    const text = raw.replace(/\s+/g, " ");
    if (text.trim()) segments.push({ type: "text", text });
  };

  while ((match = re.exec(content)) !== null) {
    const token = match[0];
    const prefixed = token.toLowerCase().startsWith("nostr:");
    // A bare bech32 glued to a word ("xxnpub1…") is prose, not a token.
    const prev = match.index > 0 ? content[match.index - 1] : " ";
    if (!prefixed && /[a-z0-9]/i.test(prev)) continue;

    pushText(content.slice(last, match.index));
    last = match.index + token.length;

    const bech32 = prefixed ? token.slice(6) : token;
    try {
      const decoded = nip19.decode(bech32.toLowerCase());
      if (decoded.type === "npub") {
        segments.push({ type: "mention", pubkey: decoded.data as string });
      } else if (decoded.type === "nprofile") {
        segments.push({ type: "mention", pubkey: (decoded.data as { pubkey: string }).pubkey });
      } else {
        hadRef = true; // note/nevent/naddr — collapsed out of the one-liner
      }
    } catch {
      // Junk token: nostr:-prefixed → strip (old behavior); bare → keep as text.
      if (!prefixed) pushText(token);
    }
  }
  pushText(content.slice(last));

  // Trim the outer edges so the one-liner doesn't start/end with a space.
  if (segments.length > 0) {
    const first = segments[0];
    if (first.type === "text") first.text = first.text.replace(/^\s+/, "");
    const lastSeg = segments[segments.length - 1];
    if (lastSeg.type === "text") lastSeg.text = lastSeg.text.replace(/\s+$/, "");
  }

  return { segments, hadRef };
}
