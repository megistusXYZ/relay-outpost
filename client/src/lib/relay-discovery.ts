/**
 * Relay discovery / curation — turns raw relay-activity data (NIP-66 monitoring
 * events + NIP-11 metadata) into a *curated* ranking. Activity informs the order
 * but does NOT decide inclusion: a relay must be healthy, free, native-nostr
 * (not an ActivityPub bridge or mirror), and language-compatible to be sampled
 * or recommended. Pure + dependency-free so it is unit-testable in isolation;
 * the impure adapters (NIP-11 fetch, health scoring, active-user counts) live at
 * the call sites (Home/Outposts) and populate a `RelayCandidate`.
 */
import type { Event } from "nostr-tools";

export interface RelayCandidate {
  url: string;
  /** Activity signal (e.g. NIP-66 active-user count or 24h event volume). Higher = busier. */
  activity: number;
  /** From relay-health. `undefined` = unknown (allowed); `false` = known-unhealthy (excluded). */
  healthy?: boolean;
  /** NIP-11 `limitation.payment_required === false`. `undefined` = unknown (allowed). */
  free?: boolean;
  /** NIP-11 `software`. */
  software?: string;
  /** NIP-11 `name`. */
  name?: string;
  /** NIP-11 `language_tags` (BCP-47-ish). */
  languageTags?: string[];
  /** NIP-11 `relay_countries`. */
  countries?: string[];
  /** Supported NIP numbers (NIP-66 `N` tags / NIP-11 `supported_nips`). */
  supportedNips?: number[];
}

export interface CurateOptions {
  /** Preferred language primary subtags, e.g. ["en","es"]. Empty = no language gate. */
  langs?: string[];
  /** Exclude ActivityPub bridges / mirrors. Default true. */
  excludeBridges?: boolean;
  /** Require the relay to be free (drop known-paid). Default true. Unknown is allowed. */
  requireFree?: boolean;
  /** Drop known-unhealthy relays. Default true. Unknown health is allowed. */
  requireHealthy?: boolean;
  /** Explicit URL denylist (known bad mirrors/spam relays the heuristics can't catch). */
  denylist?: string[];
  /** Cap the result length. */
  limit?: number;
}

/** Bridges/mirrors that republish non-nostr-native (often ActivityPub) content. */
const BRIDGE_PATTERNS = [/mostr/i, /momostr/i, /activitypub/i, /\bbridge\b/i, /fedi(?:verse|bridge)/i];

/** Normalize a relay URL for comparison: lowercase, no scheme differences, no trailing slash. */
export function normalizeRelayUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

export function isBridgeRelay(c: Pick<RelayCandidate, "url" | "software" | "name">): boolean {
  const hay = `${c.url ?? ""} ${c.software ?? ""} ${c.name ?? ""}`.toLowerCase();
  return BRIDGE_PATTERNS.some((re) => re.test(hay));
}

function langPrimary(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0];
}

type LangState = "match" | "unknown" | "mismatch";

/**
 * Language compatibility. Most relays don't declare `language_tags`, so an
 * undeclared relay is "unknown" (kept, ranked below explicit matches) rather
 * than excluded — excluding unknowns would empty the list.
 */
export function relayLanguageState(c: Pick<RelayCandidate, "languageTags">, langs: string[]): LangState {
  if (!langs || langs.length === 0) return "unknown";
  const tags = c.languageTags;
  if (!tags || tags.length === 0) return "unknown";
  const declared = new Set(tags.map(langPrimary));
  return langs.some((l) => declared.has(langPrimary(l))) ? "match" : "mismatch";
}

/**
 * Rank + filter relay candidates into a curated list. Deterministic: ordered by
 * language-match, then activity, then URL (tie-break) for stable output.
 */
export function rankCuratedRelays(candidates: RelayCandidate[], opts: CurateOptions = {}): RelayCandidate[] {
  const {
    langs = [],
    excludeBridges = true,
    requireFree = true,
    requireHealthy = true,
    denylist = [],
    limit,
  } = opts;

  const denySet = new Set(denylist.map(normalizeRelayUrl));
  const seen = new Set<string>();

  const kept = candidates.filter((c) => {
    if (!c.url) return false;
    const norm = normalizeRelayUrl(c.url);
    if (seen.has(norm)) return false; // dedupe
    if (denySet.has(norm)) return false;
    if (excludeBridges && isBridgeRelay(c)) return false;
    if (requireFree && c.free === false) return false;
    if (requireHealthy && c.healthy === false) return false;
    if (relayLanguageState(c, langs) === "mismatch") return false;
    seen.add(norm);
    return true;
  });

  kept.sort((a, b) => {
    const la = relayLanguageState(a, langs) === "match" ? 1 : 0;
    const lb = relayLanguageState(b, langs) === "match" ? 1 : 0;
    if (la !== lb) return lb - la;
    if (a.activity !== b.activity) return b.activity - a.activity;
    return normalizeRelayUrl(a.url).localeCompare(normalizeRelayUrl(b.url));
  });

  return typeof limit === "number" ? kept.slice(0, limit) : kept;
}

/**
 * Pure extraction of a partial candidate from a NIP-66 relay-discovery event
 * (kind 30166). Activity / NIP-11 / health are merged in by the caller.
 * Tags: `d`=relay url, `s`=software, `N`=supported NIP, `R`=requirement, `T`=type.
 */
export function parseNip66Event(event: Event): Partial<RelayCandidate> & { url: string } | null {
  const url = event.tags.find((t) => t[0] === "d")?.[1];
  if (!url) return null;
  const software = event.tags.find((t) => t[0] === "s")?.[1];
  const supportedNips = event.tags
    .filter((t) => t[0] === "N" && t[1])
    .map((t) => Number(t[1]))
    .filter((n) => Number.isFinite(n));
  const requirements = event.tags.filter((t) => t[0] === "R").map((t) => t[1]);
  // A relay flagged "payment"/"paid" via R/T tags is not free.
  const types = event.tags.filter((t) => t[0] === "T").map((t) => (t[1] || "").toLowerCase());
  const paid = requirements.includes("payment") || types.includes("paid");
  return {
    url,
    ...(software ? { software } : {}),
    ...(supportedNips.length ? { supportedNips } : {}),
    free: paid ? false : undefined,
  };
}
