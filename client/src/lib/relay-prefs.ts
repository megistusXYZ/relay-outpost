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
const JUNK_LABELS = new Set(["staging", "stage", "dev", "devel", "test", "testing", "sandbox", "localhost"]);

/**
 * Relays in someone's list that no reader should connect to: test, staging and
 * local/private hosts, plain ws:// (mixed content from our https page), and
 * anything that isn't a relay address. Each would cost a socket, a handshake
 * and a timeout for nothing (performance QA, 2026-09-28: a session opened
 * wss://top.testrelay.top and wss://relay.staging.dvines.org from author lists).
 */
export function isJunkRelay(url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "wss:") return true;
    host = u.hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".onion") || host.endsWith(".localhost")) return true;
  const ip = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return true;
  }
  if (host.startsWith("[")) return true; // IPv6 literal: loopback/private in practice
  const labels = host.split(".").slice(0, -1); // the TLD says nothing
  return labels.some((l) => JUNK_LABELS.has(l) || l.startsWith("test"));
}

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
