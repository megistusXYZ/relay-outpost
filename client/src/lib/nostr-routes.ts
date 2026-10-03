/**
 * Where a nostr id opens inside Relay Outpost: one mapping for every link,
 * card and click that needs it. `null` means we have no page for it (yet):
 * callers then leave the original link alone rather than send it nowhere.
 */
import { nip19 } from "nostr-tools";

/** naddr kinds with a page of their own. */
const ADDRESSABLE_PAGES: Record<number, string> = {
  30023: "/articles", // long-form article
  30311: "/live", // live stream
  34550: "/community", // NIP-72 community
};

/** `note1…`, `nevent1…`, `npub1…`, `nprofile1…`, `naddr1…`, bare or `nostr:`. */
export function nostrRouteFor(ref: string): string | null {
  const bech = ref.replace(/^nostr:/i, "").trim().toLowerCase();
  if (!bech) return null;
  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(bech);
  } catch {
    return null;
  }
  switch (decoded.type) {
    case "note":
    case "nevent":
      return `/thread/${bech}`;
    case "npub":
      return `/profile/${bech}`;
    case "nprofile":
      return `/profile/${nip19.npubEncode(decoded.data.pubkey)}`;
    case "naddr": {
      const base = ADDRESSABLE_PAGES[decoded.data.kind];
      return base ? `${base}/${bech}` : null;
    }
    default:
      return null;
  }
}

/** A path that is nothing but a nostr id: `/npub1…`, `/nevent1…`, `/nostr:naddr1…`. */
const BARE_NOSTR_PATH = /^\/(?:nostr:)?((?:npub1|nprofile1|note1|nevent1|naddr1)[^/?#]*)\/?$/i;

export interface BareNostrRoute {
  /** The page it opens, or null when we can't open it. */
  to: string | null;
  /** True when it decoded fine but has no page here (an naddr of a kind we don't show). */
  decodes: boolean;
}

/**
 * A nostr id pasted straight onto our domain (relayop.xyz/nevent1…), the way
 * people paste njump links. Returns the page it opens, `{ to: null }` when it
 * looks like an id but can't be opened, and `null` for any other path, so
 * ordinary routes and the 404 are untouched.
 */
export function bareNostrRoute(path: string): BareNostrRoute | null {
  let p = path;
  try { p = decodeURIComponent(path); } catch { /* keep it as typed */ }
  const m = BARE_NOSTR_PATH.exec(p.trim());
  if (!m) return null;
  const to = nostrRouteFor(m[1]);
  if (to) return { to, decodes: true };
  let decodes = false;
  try { nip19.decode(m[1].toLowerCase()); decodes = true; } catch { /* not an id */ }
  return { to: null, decodes };
}

/**
 * The event a /thread/:id path names, with any relay hints it carries:
 * `note1…`, `nevent1…` (bare or `nostr:`), or a 64-character hex id. `null`
 * when it names nothing, so the page says the link can't be opened instead of
 * asking every relay for an id that can't exist.
 */
export function decodeThreadRef(ref: string): { id: string; relays: string[] } | null {
  const raw = ref.replace(/^nostr:/i, "").trim();
  if (/^[0-9a-f]{64}$/i.test(raw)) return { id: raw.toLowerCase(), relays: [] };
  try {
    const decoded = nip19.decode(raw.toLowerCase());
    if (decoded.type === "note") return { id: decoded.data, relays: [] };
    if (decoded.type === "nevent") return { id: decoded.data.id, relays: decoded.data.relays ?? [] };
  } catch { /* not an id */ }
  return null;
}
