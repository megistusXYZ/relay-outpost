import { nip19 } from "nostr-tools";

export type DecodedNostr = ReturnType<typeof nip19.decode>;

// How a decoded nostr entity should be rendered when it appears inside post
// content. This is the single source of truth shared by the top-level content
// renderer and the (nested) embedded-note renderer, so the two can never drift.
export type EmbedResolution =
  | { render: "mention"; pubkey: string }
  | { render: "address-card"; kind: number; pubkey: string; identifier: string; relays?: string[] }
  | { render: "note-embed"; eventId: string; relays?: string[] }
  | { render: "note-chip"; eventId: string; relays?: string[] }
  | { render: "unknown" };

/**
 * Pure mapping from a decoded nostr entity to how it should render, given depth.
 *
 * Depth guard (the whole point of the `nested` flag): an addressable embed
 * (naddr → an event / article / wiki card) is TERMINAL — the card renders its
 * own fetched data and never recurses — so it resolves to a full card at ANY
 * depth. A note/nevent, on the other hand, resolves to a full recursive
 * `EmbeddedNote` only at the TOP level; when it is quoted INSIDE an already
 * embedded note we must NOT expand it into another EmbeddedNote (that is the
 * infinite note-in-note nesting risk), so at nested depth it degrades to a
 * shallow, non-recursive "note-chip" that just links to the thread.
 */
export function resolveNostrEmbed(decoded: DecodedNostr, opts: { nested: boolean }): EmbedResolution {
  switch (decoded.type) {
    case "npub":
      return { render: "mention", pubkey: decoded.data as string };
    case "nprofile":
      return { render: "mention", pubkey: (decoded.data as { pubkey: string }).pubkey };
    case "naddr": {
      const d = decoded.data as { kind: number; pubkey: string; identifier: string; relays?: string[] };
      return { render: "address-card", kind: d.kind, pubkey: d.pubkey, identifier: d.identifier, relays: d.relays };
    }
    case "note":
      return opts.nested
        ? { render: "note-chip", eventId: decoded.data as string }
        : { render: "note-embed", eventId: decoded.data as string };
    case "nevent": {
      const d = decoded.data as { id: string; relays?: string[] };
      return opts.nested
        ? { render: "note-chip", eventId: d.id, relays: d.relays }
        : { render: "note-embed", eventId: d.id, relays: d.relays };
    }
    default:
      return { render: "unknown" };
  }
}

const NOSTR_TOKEN_RE = /nostr:(?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+/gi;

/**
 * Truncate content for an embedded-note preview WITHOUT ever slicing through a
 * `nostr:` token. A naddr (or nevent, note, …) is 100s of chars long; a naive
 * `slice(0, 200)` would cut it mid-token and make it unresolvable — the very bug
 * that left calendar-event naddr showing as raw text. Here the visible (non-token)
 * text is capped at `maxLen`, but every nostr token is preserved whole so it can
 * still resolve into its card/chip.
 */
export function truncatePreservingNostr(text: string, maxLen: number): string {
  NOSTR_TOKEN_RE.lastIndex = 0;
  let out = "";
  let visible = 0;
  let last = 0;
  let truncated = false;
  let m: RegExpExecArray | null;

  const takeText = (chunk: string) => {
    if (visible >= maxLen) {
      if (chunk.trim()) truncated = true;
      return;
    }
    const remaining = maxLen - visible;
    if (chunk.length > remaining) {
      out += chunk.slice(0, remaining);
      visible = maxLen;
      truncated = true;
    } else {
      out += chunk;
      visible += chunk.length;
    }
  };

  while ((m = NOSTR_TOKEN_RE.exec(text)) !== null) {
    takeText(text.slice(last, m.index));
    out += m[0]; // tokens always kept whole so they remain resolvable
    last = NOSTR_TOKEN_RE.lastIndex;
  }
  takeText(text.slice(last));

  return truncated ? out.replace(/\s+$/, "") + "…" : out;
}
