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
// Lives in shared/ so the server's trust-map reader applies the same rule.
import { isJunkRelay } from "@shared/relay-junk";
export { isJunkRelay };

export function selectRelaysByMode(
  prefs: RelayPreference[] | undefined,
  mode: "read" | "write",
  limit = 5,
  /** false for the viewer's own list: it's where they publish, keep it whole. */
  { dropJunk = true }: { dropJunk?: boolean } = {},
): string[] {
  if (!prefs || prefs.length === 0) return [];
  return prefs
    .filter((p) => p.mode === mode || p.mode === "both")
    .map((p) => p.url)
    .filter((url) => !dropJunk || !isJunkRelay(url))
    .slice(0, limit);
}
