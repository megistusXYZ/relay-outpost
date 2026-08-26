// Pure, network-free logic for the Communities directory search — the fuzzy
// filter/sort pipeline, the joined-community match filter, and paste-a-link
// detection. Extracted from the Outposts page so BOTH the page command bar and
// the desktop rail's Communities flyout run the exact same directory logic (no
// duplication, no drift). Kept dependency-light (fuzzy matcher + invite
// detector + types only, NO `@/lib/nostr` pool) so it stays unit-testable in a
// plain node environment.

import { fuzzyScoreFields } from "@/lib/fuzzy-match";
import { detectGroupInvite, type GroupInviteTarget } from "@/lib/concord/invite-detect";
import type { Nip11Document } from "@/lib/nip11";
import type { OutpostRelay } from "@/lib/outpost-relays";

/** A relay surfaced by the NIP-66 directory subscription. */
export interface DiscoveredOutpost {
  url: string;
  supportedNips: number[];
  requirements: string[];
  software: string;
  relayType: string;
  lastSeen: number;
  nip11: Nip11Document | null;
  nip11Loading: boolean;
  activeUserCount: number | null;
}

/** A row-ready match, uniform across joined + directory results. */
export interface OutpostSearchMatch {
  url: string;
  name: string;
  /** Raw NIP-11 icon; render with a DEFAULT fallback. `null` = use default. */
  icon: string | null;
  /** Directory rows only; joined rows leave this `null`. */
  activeUserCount: number | null;
}

export interface PasteLinkDetection {
  groupInvite: GroupInviteTarget | null;
  looksLikeUrl: boolean;
  urlToOpen: string;
}

/** Human name for a relay row: NIP-11 name → saved label → host from url. */
export function relayDisplayName(
  url: string,
  nip11: Nip11Document | null,
  label?: string,
): string {
  return nip11?.name || label || url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

/**
 * Detect what a pasted/typed query "is": a Concord group-chat invite link, or a
 * bare relay URL to open directly. Mirrors the page command bar exactly:
 * - group invites are checked FIRST so the generic URL branch can't swallow them
 * - a link copied from a hub card (`…/outposts/<encoded-relay>`) is unwrapped
 * - anything host-shaped becomes a `wss://…` url to open
 * `raw` should already be trimmed by the caller (detectGroupInvite trims too).
 */
export function detectPasteLink(raw: string): PasteLinkDetection {
  const groupInvite = detectGroupInvite(raw);
  const shareMatch = raw.match(/\/outposts\/([^/?#]+)/i);
  const candidate = shareMatch
    ? decodeURIComponent(shareMatch[1])
    : raw.replace(/^https?:\/\//i, "");
  const looksLikeUrl =
    !groupInvite && /^(wss?:\/\/)?[a-z0-9.-]+(\.[a-z]{2,})(\/.*)?$/i.test(candidate);
  const urlToOpen = (
    candidate.startsWith("ws://") || candidate.startsWith("wss://")
      ? candidate
      : `wss://${candidate}`
  ).replace(/\/+$/, "");
  return { groupInvite, looksLikeUrl, urlToOpen };
}

/**
 * The directory filter/sort pipeline, byte-for-byte from the page:
 *   fuzzy-filter → drop joined → free/paid filter → sort (bypassed while
 *   searching, which keeps the fuzzy best-match order).
 * `discoverFilter`/`discoverSort` default to the page's defaults ("all" /
 * "active"), which are the only values the command bar ever uses.
 */
export function filterDirectory(
  discoveredRelays: DiscoveredOutpost[],
  query: string,
  joinedUrls: Set<string>,
  opts?: {
    discoverFilter?: "all" | "free" | "paid";
    discoverSort?: "active" | "newest";
  },
): DiscoveredOutpost[] {
  const raw = query.trim();
  const discoverFilter = opts?.discoverFilter ?? "all";
  const discoverSort = opts?.discoverSort ?? "active";

  // Typo-tolerant fuzzy match across name/description/tags/url/software so a
  // query like "bitcon" still surfaces "bitcoin" relays. Empty query = passthru.
  const filtered = !raw
    ? discoveredRelays
    : discoveredRelays
        .map((r) => ({
          r,
          score: fuzzyScoreFields(raw, [
            r.nip11?.name,
            r.nip11?.description,
            r.nip11?.tags?.join(" "),
            r.url,
            r.software,
          ]),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);

  const discovered = filtered.filter((r) => {
    if (joinedUrls.has(r.url.toLowerCase())) return false;
    const paid = !!r.nip11?.limitation?.payment_required;
    if (discoverFilter === "paid") return paid;
    if (discoverFilter === "free") return !paid;
    return true;
  });

  const arr = [...discovered];
  // While searching, keep the fuzzy best-match order.
  if (raw) return arr;
  if (discoverSort === "newest") {
    arr.sort(
      (a, b) =>
        (b.lastSeen || 0) - (a.lastSeen || 0) ||
        (b.activeUserCount ?? 0) - (a.activeUserCount ?? 0),
    );
  } else {
    arr.sort(
      (a, b) =>
        (b.activeUserCount ?? 0) - (a.activeUserCount ?? 0) ||
        (b.lastSeen || 0) - (a.lastSeen || 0),
    );
  }
  return arr;
}

/** Top directory matches shaped for rendering. */
export function toDirMatches(
  sorted: DiscoveredOutpost[],
  limit = 6,
): OutpostSearchMatch[] {
  return sorted.slice(0, limit).map((o) => ({
    url: o.url,
    name: relayDisplayName(o.url, o.nip11),
    icon: o.nip11?.icon ?? null,
    activeUserCount: o.activeUserCount,
  }));
}

/**
 * Joined communities that match the query, shaped for rendering. The match
 * predicate is byte-for-byte from the page: NIP-11 name OR saved label OR url
 * substring (empty-string fallback so a nameless relay only matches on url).
 */
export function filterJoinedMatches(
  joinedRelays: OutpostRelay[],
  nip11For: (url: string) => Nip11Document | null,
  query: string,
  limit = 3,
): OutpostSearchMatch[] {
  const raw = query.trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  return joinedRelays
    .filter((r) => {
      const name = nip11For(r.url)?.name || r.label || "";
      return name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);
    })
    .slice(0, limit)
    .map((r) => {
      const nip11 = nip11For(r.url);
      return {
        url: r.url,
        name: relayDisplayName(r.url, nip11, r.label),
        icon: nip11?.icon ?? null,
        activeUserCount: null,
      };
    });
}

/** Normalized joined-url set used to drop already-joined relays from directory. */
export function joinedUrlSet(joinedRelays: OutpostRelay[]): Set<string> {
  return new Set(joinedRelays.map((r) => r.url.replace(/\/+$/, "").toLowerCase()));
}
