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
