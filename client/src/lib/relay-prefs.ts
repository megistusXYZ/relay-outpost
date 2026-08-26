// Pure NIP-65 relay-preference helpers. Kept dependency-free (no eventStore / pool /
// relay graph) so the selection logic is unit-testable in isolation. outbox.ts owns
// the cache + relay fetching and delegates the actual read/write split to here.

export interface RelayPreference {
  url: string;
  mode: "read" | "write" | "both";
}

/**
 * Select the relays usable for `mode` from a NIP-65 (kind 10002) preference list.
 * A `"both"` relay counts for read AND write. Capped at `limit`. Returns `[]` for an
 * empty/undefined list so callers can apply their own fallback.
 */
export function selectRelaysByMode(
  prefs: RelayPreference[] | undefined,
  mode: "read" | "write",
  limit = 5,
): string[] {
  if (!prefs || prefs.length === 0) return [];
  return prefs
    .filter((p) => p.mode === mode || p.mode === "both")
    .map((p) => p.url)
    .slice(0, limit);
}
