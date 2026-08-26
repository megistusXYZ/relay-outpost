import type { Filter } from "nostr-tools";

/**
 * Stable, order-independent keys for Nostr subscriptions, so identical
 * concurrent `(relays, filter)` subscriptions can be recognised as the same and
 * share a single underlying socket subscription (see subscription-registry).
 *
 * Pure — no pool, no network. Two subscriptions that differ only in the order of
 * their relay list, filter keys, or tag/author/kind arrays produce the SAME key;
 * any semantic difference (a different relay, kind, tag value, since/until/limit)
 * produces a different key.
 */

/** Match the app's relay normalization: lowercase, no trailing slash. */
export function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Canonical JSON for one filter: keys sorted, array values sorted. */
export function normalizeFilter(filter: Filter): string {
  const keys = Object.keys(filter).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (filter as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      // kinds/authors/ids/#tags — order is not semantically meaningful.
      canonical[k] = [...v].sort();
    } else {
      // since/until/limit/search — scalars.
      canonical[k] = v;
    }
  }
  return JSON.stringify(canonical);
}

/** Stable key for a whole subscription (relays + one or many filters). */
export function subscriptionKey(relays: string[], filters: Filter | Filter[]): string {
  const rels = [...new Set(relays.map(normalizeRelayUrl))].sort();
  const list = Array.isArray(filters) ? filters : [filters];
  // Filter order within an array doesn't change the subscription's meaning.
  const filterKeys = list.map(normalizeFilter).sort();
  return `${rels.join(",")}|${filterKeys.join(";")}`;
}
