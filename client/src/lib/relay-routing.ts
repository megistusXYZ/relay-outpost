// Pure helpers for editing a user's NIP-65 relay list (kind 10002).
// Kept free of React / network so the high-consequence tag-building logic
// (a wrong list silently hurts reach) is unit-testable in isolation.

export interface RelayRoute {
  url: string;
  read: boolean; // appears in the user's inbox (others reach them here)
  write: boolean; // appears in the user's outbox (others fetch their posts here)
}

/** Normalize to a bare wss:// url with no trailing slash. Returns "" for empty input. */
export function normalizeRouteUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const withProto = v.startsWith("ws://") || v.startsWith("wss://") ? v : `wss://${v}`;
  return withProto.replace(/\/+$/, "");
}

/**
 * Build NIP-65 (kind-10002) `r` tags from a set of routes.
 * - merges duplicate urls (case-insensitive), OR-ing their read/write roles
 * - drops entries with no role and blank urls
 * - emits `["r", url]` for read+write, else `["r", url, "read"|"write"]`
 * Insertion order of first occurrence is preserved.
 */
export function buildRelayListTags(routes: RelayRoute[]): string[][] {
  const byKey = new Map<string, { url: string; read: boolean; write: boolean }>();
  for (const r of routes) {
    const url = normalizeRouteUrl(r.url);
    if (!url || (!r.read && !r.write)) continue;
    const key = url.toLowerCase();
    const prev = byKey.get(key);
    if (prev) {
      prev.read = prev.read || r.read;
      prev.write = prev.write || r.write;
    } else {
      byKey.set(key, { url, read: r.read, write: r.write });
    }
  }
  return Array.from(byKey.values()).map(({ url, read, write }) =>
    read && write ? ["r", url] : ["r", url, read ? "read" : "write"],
  );
}
