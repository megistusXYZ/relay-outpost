// Pure parsing of the Event Console deep-link query params
// (`?filter=<url-encoded JSON>&relay=<wss url>`). Kept as a standalone,
// side-effect-free module so the hand-off contract (FeedbackDrawer / relay-ops
// FeedbackTab → `/console` → the embedded console at `/account?tab=console`) can
// be unit-tested without mounting the whole page.
//
// The App-level `/console` redirect preserves the incoming search string (and
// appends `tab=console`); EventConsole reads it on mount and pre-fills both the
// visual filter builder and the JSON editor, and selects the given relay.

export interface ParsedConsoleParams {
  /** Decoded Nostr filter object from `?filter=`, or null when absent/invalid. */
  filter: Record<string, unknown> | null;
  /** `wss://` (or `ws://`) relay URL from `?relay=`, or null when absent/invalid. */
  relay: string | null;
}

/**
 * Parse a URL search string (e.g. `"?filter=%7B...%7D&relay=wss%3A%2F%2F..."`)
 * into a console filter + relay. Never throws: malformed JSON or a
 * non-object/array filter yields `filter: null`; a non-`wss`/`ws` relay yields
 * `relay: null`. A leading `?` is tolerated, as is an extra `tab=console` param
 * (which the `/console` → `/account?tab=console` redirect prepends).
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

  const rawRelay = params.get("relay");
  if (rawRelay) {
    const trimmed = rawRelay.trim();
    if (/^wss?:\/\/\S+/i.test(trimmed)) relay = trimmed;
  }

  return { filter, relay };
}
