// Pure, network-free helpers for DISPLAYING the NIP-89 `client` tag that other
// people's events carry (e.g. ["client", "Amethyst", "31990:<pubkey>:<d>"]).
//
// This is the READ side — showing "via [App]" on a focused post. It is a
// distinct concern from the WRITE side (`clientTags()` in nostr-helpers.ts,
// gated by `clientTagEnabled`), which STAMPS our own posts. Never wire this to
// trust, spam, or filtering: client tags are self-reported and trivially
// spoofable. Treat as purely informational.

export interface ParsedClientTag {
  /** The self-reported app name (tag index 1). */
  name: string;
  /** NIP-89 handler coordinate `31990:<pubkey>:<d>` (tag index 2), when present + well-formed. */
  handlerCoord?: string;
}

// A NIP-89 handler coordinate is `<kind>:<64-hex-pubkey>:<d-identifier>`. The
// d-identifier may be empty, so we only require the leading kind + pubkey.
const HANDLER_COORD_RE = /^\d+:[0-9a-f]{64}:/i;

/**
 * Parse the first `["client", ...]` tag off an event.
 * Returns null when the tag is absent or has no usable name.
 */
export function parseClientTag(event: { tags?: string[][] } | null | undefined): ParsedClientTag | null {
  const tags = event?.tags;
  if (!Array.isArray(tags)) return null;
  const tag = tags.find((t) => Array.isArray(t) && t[0] === "client");
  if (!tag) return null;
  const name = typeof tag[1] === "string" ? tag[1].trim() : "";
  if (!name) return null;
  const rawCoord = typeof tag[2] === "string" ? tag[2].trim() : "";
  const handlerCoord = rawCoord && HANDLER_COORD_RE.test(rawCoord) ? rawCoord : undefined;
  return handlerCoord ? { name, handlerCoord } : { name };
}

export interface KnownClient {
  /** Stable id used as the badge's iconKey. */
  key: string;
  /** Canonical display label. */
  label: string;
  /** Brand-ish accent for the monogram mark (no network needed). */
  color: string;
  /** Extra normalized name variants that map to this client. */
  aliases: string[];
}

// Static registry of well-known clients. Gives a consistent, offline "logo"
// (a brand-tinted monogram, or Relay Outpost's own mark) for the common cases.
// Unknown-but-tagged clients get NO icon in the badge (plain "via Name" text —
// never a generic placeholder glyph).
export const KNOWN_CLIENTS: KnownClient[] = [
  { key: "relay-outpost", label: "Relay Outpost", color: "#8b5cf6", aliases: ["relay-outpost"] },
  { key: "amethyst", label: "Amethyst", color: "#9333ea", aliases: [] },
  { key: "damus", label: "Damus", color: "#7c5cff", aliases: ["damus ios"] },
  { key: "primal", label: "Primal", color: "#ca079c", aliases: ["primal web app", "primal ios", "primal android"] },
  { key: "nostur", label: "Nostur", color: "#2f7bf6", aliases: [] },
  { key: "coracle", label: "Coracle", color: "#eb5e28", aliases: [] },
  { key: "snort", label: "Snort", color: "#ef4444", aliases: ["snort.social"] },
  { key: "iris", label: "Iris", color: "#5451ff", aliases: ["iris.to"] },
  { key: "nos", label: "Nos", color: "#10b981", aliases: ["nos.social"] },
  { key: "0xchat", label: "0xChat", color: "#00a3ff", aliases: [] },
  { key: "yakihonne", label: "YakiHonne", color: "#f5a623", aliases: [] },
  { key: "gossip", label: "Gossip", color: "#6b7280", aliases: [] },
  { key: "nostrudel", label: "noStrudel", color: "#a855f7", aliases: ["nostrudel.ninja"] },
  { key: "habla", label: "Habla", color: "#ff6b00", aliases: ["habla.news"] },
  { key: "highlighter", label: "Highlighter", color: "#f59e0b", aliases: ["highlighter.com"] },
  { key: "nostter", label: "Nostter", color: "#22c55e", aliases: [] },
  { key: "lume", label: "Lume", color: "#3b82f6", aliases: [] },
  { key: "satellite", label: "Satellite", color: "#0ea5e9", aliases: ["satellite.earth"] },
  { key: "zapstream", label: "Zap.Stream", color: "#f7931a", aliases: ["zap.stream"] },
  { key: "plebstr", label: "Plebstr", color: "#8b5cf6", aliases: [] },
  { key: "voyage", label: "Voyage", color: "#14b8a6", aliases: [] },
  { key: "flycat", label: "Flycat", color: "#f472b6", aliases: ["flycat.club"] },
];

/** Lowercase, collapse internal whitespace, trim — the normalized match key. */
export function normalizeClientName(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

const BY_NORMALIZED = new Map<string, KnownClient>();
for (const client of KNOWN_CLIENTS) {
  BY_NORMALIZED.set(normalizeClientName(client.label), client);
  for (const alias of client.aliases) {
    BY_NORMALIZED.set(normalizeClientName(alias), client);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a self-reported client name to a known-client registry entry.
 * Case- and space-insensitive: exact match first, then a word-boundary
 * substring pass so "Primal Web App" / "damus (iOS)" still resolve.
 */
export function lookupClient(name: string): KnownClient | null {
  const n = normalizeClientName(name);
  if (!n) return null;
  const exact = BY_NORMALIZED.get(n);
  if (exact) return exact;
  for (const [alias, client] of BY_NORMALIZED) {
    // Guard against short aliases producing false hits (e.g. "nos" in "nostur").
    if (alias.length >= 4 && new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(n)) {
      return client;
    }
  }
  return null;
}

export interface ClientDisplay {
  /** Canonical label for known clients; the raw self-reported name otherwise. */
  name: string;
  /** Registry key for a bundled logo/monogram. Absent for unknown clients. */
  iconKey?: string;
  /** Brand accent for the monogram mark (known clients only). */
  color?: string;
  /** NIP-89 handler coordinate, for best-effort icon resolution. */
  handlerCoord?: string;
}

/**
 * End-to-end: read the event's client tag and produce everything the badge
 * needs. Returns null when there is no client tag to show.
 */
export function getClientDisplay(event: { tags?: string[][] } | null | undefined): ClientDisplay | null {
  const parsed = parseClientTag(event);
  if (!parsed) return null;
  const known = lookupClient(parsed.name);
  if (known) {
    return { name: known.label, iconKey: known.key, color: known.color, handlerCoord: parsed.handlerCoord };
  }
  return { name: parsed.name, handlerCoord: parsed.handlerCoord };
}
