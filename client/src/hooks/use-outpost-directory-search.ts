// Shared data hook for the Communities directory search. It powers BOTH the
// Outposts page command bar and the desktop rail's Communities flyout so they
// read the exact same directory (saved + other relays) with zero duplicated
// logic. The pure filter/sort/paste-detection lives in `@/lib/outpost-directory`
// (unit-tested there); this file owns the live data — the NIP-66 discovery
// subscription and the joined-relay NIP-11 fetches.
//
// The discovery subscription is a MODULE-LEVEL singleton: one subscription
// app-wide regardless of how many consumers mount, started lazily the first
// time any consumer is `active`. So opening the flyout OR visiting the page
// kicks it off once, results are shared, and a page + flyout open together
// never double-fetch. It's never triggered just by the rail existing — only
// when a consumer opts in (`active`), preserving the previous behavior where
// discovery ran only on the Outposts page.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { fetchNip11, type Nip11Document } from "@/lib/nip11";
import { getOutpostRelays, type OutpostRelay } from "@/lib/outpost-relays";
import { type GroupInviteTarget } from "@/lib/concord/invite-detect";
import {
  type DiscoveredOutpost,
  type OutpostSearchMatch,
  detectPasteLink,
  filterDirectory,
  filterJoinedMatches,
  joinedUrlSet,
  toDirMatches,
} from "@/lib/outpost-directory";

/** Exported for reachability gating: a consumer claiming "the directory is
 *  empty" must first prove one of these monitors actually answered. */
export const NIP_66_MONITOR_RELAYS = ["wss://relaypag.es", "wss://monitorlizard.nostr1.com"];

// ---------------------------------------------------------------------------
// Module-level discovery store (one NIP-66 subscription for the whole app).
// ---------------------------------------------------------------------------

interface DiscoveryState {
  relays: DiscoveredOutpost[];
  loading: boolean;
}

let discoveryState: DiscoveryState = { relays: [], loading: true };
let discoveryStarted = false;
/** True only while the one-shot NIP-66 subscription is actually open —
 *  distinguishes "ran and settled" from "running", so restartDiscovery can
 *  refuse to double-subscribe. */
let discoveryRunning = false;
const discoveryListeners = new Set<() => void>();

function setDiscovery(next: Partial<DiscoveryState>) {
  discoveryState = { ...discoveryState, ...next };
  discoveryListeners.forEach((l) => l());
}

function updateDiscoveredRelays(fn: (prev: DiscoveredOutpost[]) => DiscoveredOutpost[]) {
  setDiscovery({ relays: fn(discoveryState.relays) });
}

/**
 * Idempotently kick off the NIP-66 relay-directory discovery. Safe to call from
 * any consumer, any number of times — only the first call runs. The
 * subscription self-closes after EOSE or a 15s cap, then enriches the top
 * relays with NIP-11 metadata + a rough active-user count. Results persist for
 * the app's lifetime (never torn down on unmount), so later consumers see them
 * instantly.
 */
export function ensureDiscoveryStarted(): void {
  if (discoveryStarted) return;
  discoveryStarted = true;
  setDiscovery({ loading: true });
  discoveryRunning = true;

  const relayMap = new Map<string, DiscoveredOutpost>();
  let closed = false;

  const sub = pool.subscribeMany(
    NIP_66_MONITOR_RELAYS,
    { kinds: [30166], limit: 2000 },
    {
      onevent(e: NostrEvent) {
        if (closed) return;
        const dTag = e.tags.find((t) => t[0] === "d")?.[1];
        if (!dTag) return;

        const relayUrl =
          dTag.startsWith("wss://") || dTag.startsWith("ws://") ? dTag : "wss://" + dTag;
        const originalUrl = relayUrl.replace(/\/+$/, "");
        const normalizedUrl = originalUrl.toLowerCase();

        const existing = relayMap.get(normalizedUrl);
        if (existing && existing.lastSeen >= e.created_at) return;

        const supportedNips = e.tags
          .filter((t) => t[0] === "N")
          .map((t) => parseInt(t[1], 10))
          .filter((n) => !isNaN(n));

        const requirements = e.tags
          .filter((t) => t[0] === "R")
          .map((t) => t[1]?.toLowerCase())
          .filter(Boolean) as string[];

        const software = e.tags.find((t) => t[0] === "s")?.[1] || "";
        const relayType = e.tags.find((t) => t[0] === "T")?.[1] || "";

        relayMap.set(normalizedUrl, {
          url: originalUrl,
          supportedNips,
          requirements,
          software,
          relayType,
          lastSeen: e.created_at,
          nip11: null,
          nip11Loading: false,
          activeUserCount: null,
        });
      },
      oneose() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        sub.close();
        finalize(relayMap);
      },
    },
  );

  const timer = setTimeout(() => {
    if (!closed) {
      closed = true;
      sub.close();
      finalize(relayMap);
    }
  }, 15000);

  function finalize(map: Map<string, DiscoveredOutpost>) {
    discoveryRunning = false;
    const results = Array.from(map.values()).sort(
      (a, b) => b.supportedNips.length - a.supportedNips.length,
    );
    setDiscovery({ relays: results, loading: false });

    // Enrichment is bounded to what any consumer actually renders. The Outposts
    // dropdown shows ≤6 rows, the Discover Communities tile ≤3 names — nothing
    // renders past the first several. Enriching all 30 (a NIP-11 fetch AND a
    // fresh kind-1 WebSocket PER relay) put ~30 extra sockets and ~30 HTTP
    // requests on the landing screen — for rows nobody sees. The active-user
    // WS probe (the socket cost) is trimmed hardest because only the dropdown
    // renders a count at all; names come from the cheaper cached NIP-11 read.
    const NAME_ENRICH = 12;
    const ACTIVITY_PROBE = 8;
    results.slice(0, NAME_ENRICH).forEach((r) => {
      fetchNip11(r.url).then((doc) => {
        if (doc) {
          updateDiscoveredRelays((prev) =>
            prev.map((relay) =>
              relay.url === r.url ? { ...relay, nip11: doc, nip11Loading: false } : relay,
            ),
          );
        }
      });
    });

    const topRelays = results.slice(0, ACTIVITY_PROBE);
    for (const r of topRelays) {
      const authors = new Set<string>();
      let subClosed = false;
      const countSub = pool.subscribeMany(
        [r.url],
        { kinds: [1], limit: 20 },
        {
          onevent(e: NostrEvent) {
            if (!subClosed) authors.add(e.pubkey);
          },
          oneose() {
            if (subClosed) return;
            subClosed = true;
            countSub.close();
            updateDiscoveredRelays((prev) =>
              prev.map((relay) =>
                relay.url === r.url ? { ...relay, activeUserCount: authors.size } : relay,
              ),
            );
          },
        },
      );
      setTimeout(() => {
        if (!subClosed) {
          subClosed = true;
          countSub.close();
          if (authors.size > 0) {
            updateDiscoveredRelays((prev) =>
              prev.map((relay) =>
                relay.url === r.url ? { ...relay, activeUserCount: authors.size } : relay,
              ),
            );
          }
        }
      }, 5000);
    }
  }
}

/**
 * Re-run a settled discovery pass. Exists for the Discover tile's honest
 * "Couldn't reach — retry": without it the `discoveryStarted` latch makes a
 * retry button a silent no-op — the exact dead-control shape this repo keeps
 * finding. A pass that is still RUNNING is left alone (no double-subscribe);
 * retry only means anything after the previous attempt settled.
 */
export function restartDiscovery(): void {
  if (discoveryRunning) return;
  discoveryStarted = false;
  setDiscovery({ relays: [], loading: true });
  ensureDiscoveryStarted();
}

/**
 * The full directory, no query — what a browse surface (the Discover
 * communities tile) reads. `useOutpostDirectorySearch` deliberately returns
 * nothing for an empty query, so this is the only sanctioned reader of the
 * unfiltered store.
 */
export function useOutpostDirectory(active = true): DiscoveryState {
  return useDiscovery(active);
}

/** Subscribe a component to the shared discovery store. */
function useDiscovery(active: boolean): DiscoveryState {
  const [state, setState] = useState<DiscoveryState>(discoveryState);
  useEffect(() => {
    if (active) ensureDiscoveryStarted();
    const cb = () => setState(discoveryState);
    discoveryListeners.add(cb);
    cb(); // sync any state that arrived before this listener attached
    return () => {
      discoveryListeners.delete(cb);
    };
  }, [active]);
  return state;
}

/** Joined communities (localStorage) + their (cached) NIP-11 docs. */
function useJoinedData(): {
  joinedRelays: OutpostRelay[];
  nip11For: (url: string) => Nip11Document | null;
} {
  const [joinedRelays, setJoinedRelays] = useState<OutpostRelay[]>(() => getOutpostRelays());
  const [nip11Map, setNip11Map] = useState<Map<string, Nip11Document | null>>(new Map());

  useEffect(() => {
    const sync = () => setJoinedRelays(getOutpostRelays());
    window.addEventListener("outpost-relays-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("outpost-relays-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    for (const relay of joinedRelays) {
      fetchNip11(relay.url).then((doc) => {
        if (cancelled) return;
        setNip11Map((prev) => {
          const next = new Map(prev);
          next.set(relay.url, doc);
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [joinedRelays]);

  const nip11For = useCallback((url: string) => nip11Map.get(url) ?? null, [nip11Map]);
  return { joinedRelays, nip11For };
}

export interface OutpostDirectorySearch {
  /** Joined communities matching the query (compact, row-ready). */
  joinedMatches: OutpostSearchMatch[];
  /** Directory relays matching the query (top slice, row-ready). */
  dirMatches: OutpostSearchMatch[];
  /** True while the directory subscription is still gathering relays. */
  loading: boolean;
  /** How many directory matches are hidden beyond the shown slice. */
  moreCount: number;
  /** The query parses as a bare relay URL to open directly. */
  looksLikeUrl: boolean;
  /** The `wss://…` url to open when `looksLikeUrl`. */
  urlToOpen: string;
  /** The query parses as a Concord group-chat invite link. */
  groupInvite: GroupInviteTarget | null;
}

/**
 * Directory search shared by the Outposts page command bar and the rail flyout.
 *
 * @param query   the raw search text (trimmed internally)
 * @param opts.active  whether to trigger/keep the discovery subscription. The
 *   page passes `true` (eager, as before). The flyout passes `true` only while
 *   its search results are mounted, so hovering the rail never fetches.
 */
export function useOutpostDirectorySearch(
  query: string,
  opts?: { active?: boolean },
): OutpostDirectorySearch {
  const active = opts?.active ?? true;
  const { relays, loading } = useDiscovery(active);
  const { joinedRelays, nip11For } = useJoinedData();
  const raw = query.trim();

  const joinedUrls = useMemo(() => joinedUrlSet(joinedRelays), [joinedRelays]);
  const paste = useMemo(() => detectPasteLink(raw), [raw]);
  const joinedMatches = useMemo(
    () => filterJoinedMatches(joinedRelays, nip11For, raw),
    [joinedRelays, nip11For, raw],
  );
  const sorted = useMemo(
    () => (raw ? filterDirectory(relays, raw, joinedUrls) : []),
    [relays, raw, joinedUrls],
  );
  const dirMatches = useMemo(() => toDirMatches(sorted, 6), [sorted]);
  const moreCount = raw ? Math.max(0, sorted.length - dirMatches.length) : 0;

  return {
    joinedMatches,
    dirMatches,
    loading,
    moreCount,
    looksLikeUrl: paste.looksLikeUrl,
    urlToOpen: paste.urlToOpen,
    groupInvite: paste.groupInvite,
  };
}
