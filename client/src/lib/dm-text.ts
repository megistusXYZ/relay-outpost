/**
 * A private message as ONE readable line: the chat list's preview, the quote
 * above a reply, a search result.
 *
 * A mention travels as an address (`nostr:npub1…`, NIP-27), and so does a
 * shared post or article. The message body draws those as a name chip or a
 * card (Messages.tsx, with the shared renderers). A one-line surface cannot
 * hold a chip, and used to show the address itself — sixty characters of code
 * where a name belongs. Here each becomes words.
 *
 * Pure: who is called what is the caller's to say.
 */
import { nip19 } from "nostr-tools";

// A nostr: address, or one pasted bare. Bare ones must stand alone — not be
// the tail of a link or the head of an email address.
const TOKEN = /(?:nostr:)((?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+)|(?<![\w/.:@-])((?:npub|nprofile|note|nevent|naddr)1[02-9ac-hj-np-z]{20,})(?![\w@])/g;

function decode(bech32: string): { kind: "person"; pubkey: string } | { kind: "post" } | { kind: "article" } | null {
  try {
    const d = nip19.decode(bech32);
    if (d.type === "npub") return { kind: "person", pubkey: d.data };
    if (d.type === "nprofile") return { kind: "person", pubkey: d.data.pubkey };
    if (d.type === "note" || d.type === "nevent") return { kind: "post" };
    if (d.type === "naddr") return { kind: "article" };
  } catch { /* not an address after all */ }
  return null;
}

/** The message with every address said in words. */
export function readableLine(text: string, nameOf: (pubkey: string) => string | null | undefined): string {
  if (!text || !text.includes("1")) return text;
  return text.replace(TOKEN, (whole, prefixed: string | undefined, bare: string | undefined) => {
    const ref = decode(prefixed ?? bare ?? "");
    if (!ref) return prefixed ? "a link" : whole;
    if (ref.kind === "person") return `@${nameOf(ref.pubkey) || "someone"}`;
    return ref.kind === "post" ? "a post" : "an article";
  });
}

/** The people a message mentions, each once, in order. */
export function mentionedPubkeys(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  for (const m of text.matchAll(TOKEN)) {
    const ref = decode(m[1] ?? m[2] ?? "");
    if (ref?.kind === "person" && !out.includes(ref.pubkey)) out.push(ref.pubkey);
  }
  return out;
}

/**
 * A message body in two parts: the text (mentions kept, as `nostr:` addresses
 * the renderer turns into names) and the posts and articles it shares, which
 * are drawn as cards under the text and not as code inside it.
 */
export function splitMessage(text: string): { text: string; shared: string[] } {
  const shared: string[] = [];
  if (!text || !text.includes("1")) return { text, shared };
  let touched = false;
  const out = text.replace(TOKEN, (whole, prefixed: string | undefined, bare: string | undefined) => {
    const bech32 = prefixed ?? bare ?? "";
    const ref = decode(bech32);
    if (!ref) { if (!prefixed) return whole; touched = true; return ""; }
    touched = true;
    if (ref.kind === "person") return `nostr:${bech32}`;
    const uri = `nostr:${bech32}`;
    if (!shared.includes(uri)) shared.push(uri);
    return "";
  });
  if (!touched) return { text, shared };
  // Taking something out leaves the spaces that were around it.
  return { text: out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim(), shared };
}
