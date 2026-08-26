/**
 * DEFAULT_RELAYS — broadcast/publish targets and the user-visible "active relays" set.
 *
 * Purpose: well-connected, general-purpose relays that reliably accept arbitrary
 * event kinds. Used for publishing notes, warming connections, and as a generic
 * fallback in pages that don't have a more specific list.
 *
 * Audit notes:
 *  - `purplepag.es` was removed: it is a profile/relay-list indexer that rejects
 *    most non-Kind-0/3/10002 events, so including it in publish broadcasts
 *    produced wasted writes and noisy errors. It still lives in PROFILE_RELAYS
 *    and RELAY_LIST_RELAYS where it belongs.
 *  - `nostr.mom` and `relay.ditto.pub` were removed: smaller relays with thin
 *    coverage that mostly added redundant connections without improving reach.
 *  - `nos.lol` is kept here even though it was trimmed from the read-side
 *    lists: relay rate-limit notices affect REQ subscriptions, not one-shot
 *    EVENT publishes, so it remains valuable as a write target.
 */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://nostr.land",
  "wss://relay.primal.net",
  "wss://nostr-01.yakihonne.com",
];
