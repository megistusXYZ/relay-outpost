// Pure parsing of the console's deep-link query params
// (`?filter=<url-encoded JSON>&relay=<wss url>[&relay=…]`). Kept as a standalone,
// side-effect-free module so the hand-off contract (FeedbackDrawer / relay-ops
// FeedbackTab / posts / profiles → `/my-relays/console`) can be unit-tested
// without mounting the whole page.
//
// Old `/console` and `/account?tab=console` links redirect to
// `/my-relays/console` with the search string intact; the console reads it on
// mount, opens the filter as given and asks every relay listed.

export interface ParsedConsoleParams {
  /** Decoded Nostr filter object from `?filter=`, or null when absent/invalid. */
  filter: Record<string, unknown> | null;
  /** `wss://` (or `ws://`) relay URL from `?relay=`, or null when absent/invalid. */
  relay: string | null;
  /** Every valid `?relay=` (a console share link can carry several). */
  relays: string[];
  /** `?filter=` exactly as given (it may be a list of filters, or use "now-3h" times). */
  filterText: string | null;
}

/**
 * Parse a URL search string (e.g. `"?filter=%7B...%7D&relay=wss%3A%2F%2F..."`)
 * into a console filter + relay. Never throws: malformed JSON or a
 * non-object/array filter yields `filter: null`; a non-`wss`/`ws` relay yields
 * `relay: null`. A leading `?` is tolerated, as is an extra `tab=console` param
 * (old `/account?tab=console` links carry one).
 */
export function parseConsoleQueryParams(search: string): ParsedConsoleParams {
  let filter: Record<string, unknown> | null = null;
  let relay: string | null = null;

  const params = new URLSearchParams(search || "");

  const rawFilter = params.get("filter");
  if (rawFilter) {
    try {
      const parsed = JSON.parse(rawFilter);
      // Only a plain object is a valid Nostr filter — reject arrays/primitives.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        filter = parsed as Record<string, unknown>;
      }
    } catch {
      /* malformed JSON — ignore, leave filter null */
    }
  }

  const relays = params.getAll("relay").map((r) => r.trim()).filter((r) => /^wss?:\/\/\S+/i.test(r));
  relay = relays[0] ?? null;

  return { filter, relay, relays, filterText: rawFilter };
}
