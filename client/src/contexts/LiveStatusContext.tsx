import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { Event } from "nostr-tools";
import { throttledPoolSubscribe } from "@/lib/nostr";
import { LIVE_STREAM_RELAYS, KIND_LIVE_EVENT } from "@/lib/nostr-helpers";
import { parseLiveEvent } from "@/lib/live-events";
import { indexLiveByPubkey, dedupeByAddress } from "@/lib/live-index";
import type { LiveEventData } from "@/lib/live-events";

interface LiveStatusContextType {
  isUserLive: (pubkey: string) => boolean;
  getLiveStream: (pubkey: string) => LiveEventData | undefined;
  livePubkeys: Set<string>;
}

const LiveStatusContext = createContext<LiveStatusContextType>({
  isUserLive: () => false,
  getLiveStream: () => undefined,
  livePubkeys: new Set(),
});

export function useLiveStatus() {
  return useContext(LiveStatusContext);
}

const REFRESH_INTERVAL = 3 * 60 * 1000;
const QUERY_TIMEOUT = 8000;
const MAX_AGE_NO_URL = 2 * 60 * 60;
/** Only ask for 30311s from the recent past. Live streams re-publish their
 *  event every few minutes (viewer counts, status), so anything current is
 *  inside this window — while a bare `limit` with no `since` let 34 ended
 *  events crowd a 50-slot page (measured on the live relays). */
const LIVE_LOOKBACK = 6 * 60 * 60;
/** Throttle for the focus/online catch-up — a tab being switched to rapidly
 *  must not storm the relays. */
const CATCHUP_MIN_GAP = 30_000;

export function LiveStatusProvider({ children }: { children: React.ReactNode }) {
  const [livePubkeys, setLivePubkeys] = useState<Set<string>>(new Set());
  const liveStreamsRef = useRef<Map<string, LiveEventData>>(new Map());
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  /**
   * Collect 30311s and settle with WHATEVER ARRIVED when time is up.
   *
   * The old shape was `Promise.race([querySync, reject-in-6s])` — an
   * all-or-nothing read across 8 relays where one slow relay cost every event
   * the fast ones had already delivered, and the app then showed nobody live
   * until the next interval THREE MINUTES later. That was the "buggy /
   * inconsistent" live status reported from a phone: liveness that came and
   * went with the slowest relay's mood. A slow relay must cost nothing but its
   * own answer.
   */
  const collectLiveEvents = useCallback(() => {
    return new Promise<Event[]>((resolve) => {
      const collected: Event[] = [];
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try { sub.close(); } catch { /* already closed */ }
        resolve(collected);
      };
      const sub = throttledPoolSubscribe(LIVE_STREAM_RELAYS, {
        kinds: [KIND_LIVE_EVENT],
        since: Math.floor(Date.now() / 1000) - LIVE_LOOKBACK,
        limit: 100,
      }, {
        onevent(event: Event) { collected.push(event); },
        oneose() { settle(); },
      });
      timer = setTimeout(settle, QUERY_TIMEOUT);
    });
  }, []);

  const applyStreams = useCallback((streams: LiveEventData[]) => {
    if (!mountedRef.current) return;
    const indexed = indexLiveByPubkey(streams);
    liveStreamsRef.current = indexed;
    setLivePubkeys(new Set(indexed.keys()));
  }, []);

  const fetchLiveUsers = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const events = await collectLiveEvents();
      if (!mountedRef.current) return;

      // Dedupe by ADDRESS (author + d), not by author. Kind 30311 is
      // addressable, and a publishing platform fronts many concurrent streams —
      // collapsing them per author threw away every one but the last, which is
      // most of what is live at any moment. See lib/live-index.ts.
      const parsedLive = dedupeByAddress(
        events
          .map((event) => parseLiveEvent(event))
          .filter((p): p is LiveEventData => !!p && p.status === "live"),
      );

      const now = Math.floor(Date.now() / 1000);
      const freshEnough = (stream: LiveEventData) => {
        const eventAge = now - stream.event.created_at;
        const startsAge = stream.starts ? now - stream.starts : eventAge;
        return Math.min(eventAge, startsAge) <= MAX_AGE_NO_URL;
      };

      // PHASE 1 — paint from tag semantics immediately. The old pipeline held
      // ALL liveness back until every health-check batch had round-tripped the
      // server, so even a good run showed everyone offline for ~10 seconds
      // after app open ("slow to be noticed"). A relay-published status:live
      // updated minutes ago is strong evidence; act on it now, refine below.
      applyStreams(parsedLive.filter(freshEnough));

      // PHASE 2 — health refinement, which can only ever REMOVE a stream whose
      // media URL answers "dead", or RESTORE an old-but-checkably-alive one.
      const urlsToCheck: string[] = [];
      for (const parsed of parsedLive) {
        const streamUrl = parsed.streamUrl || parsed.hlsUrl;
        if (streamUrl) urlsToCheck.push(streamUrl);
      }

      const healthResults: Record<string, { alive: boolean | null }> = {};
      if (urlsToCheck.length > 0) {
        const CHUNK_SIZE = 20;
        const chunks: string[][] = [];
        for (let i = 0; i < urlsToCheck.length; i += CHUNK_SIZE) {
          chunks.push(urlsToCheck.slice(i, i + CHUNK_SIZE));
        }
        try {
          // Chunks in parallel — they were sequential, which multiplied the
          // server's own 6s-per-URL worst case into the paint delay above.
          const responses = await Promise.all(chunks.map(async (chunk) => {
            const resp = await fetch("/api/stream/health-check-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ urls: chunk }),
            });
            return resp.ok ? (await resp.json()).results || {} : {};
          }));
          for (const r of responses) Object.assign(healthResults, r);
        } catch { /* no health answers — phase 1's freshness verdicts stand */ }
      }

      if (!mountedRef.current) return;

      const alive = parsedLive.filter((stream) => {
        const streamUrl = stream.streamUrl || stream.hlsUrl;
        const health = streamUrl ? healthResults[streamUrl] : undefined;
        if (health?.alive === false) return false;
        if (health?.alive === true) return true;
        // No usable health answer — "we could not check" is not "it is dead",
        // so an unhealth-checkable stream stays live until it is simply too
        // old to believe.
        return freshEnough(stream);
      });

      applyStreams(alive);
    } catch (err) {
      console.error("Live status check failed:", err);
    } finally {
      fetchingRef.current = false;
    }
  }, [collectLiveEvents, applyStreams]);

  useEffect(() => {
    mountedRef.current = true;

    // Short breath for boot-critical work, not the old 2s — a broadcast is the
    // most time-sensitive thing on any screen, so it earns an early slot.
    const timer = setTimeout(() => {
      fetchLiveUsers();
    }, 300);

    const interval = setInterval(fetchLiveUsers, REFRESH_INTERVAL);

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchLiveUsers]);

  // Focus/online catch-up: a phone resuming from background sat on stale
  // "nobody is live" until the 3-minute interval fired — the exact case the
  // owner screenshotted. Same throttled pattern as the DM catch-up.
  useEffect(() => {
    let lastRun = 0;
    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const nowMs = Date.now();
      if (nowMs - lastRun < CATCHUP_MIN_GAP) return;
      lastRun = nowMs;
      fetchLiveUsers();
    };
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchLiveUsers]);

  const isUserLive = useCallback((pubkey: string) => {
    return liveStreamsRef.current.has(pubkey);
  }, []);

  const getLiveStream = useCallback((pubkey: string) => {
    return liveStreamsRef.current.get(pubkey);
  }, []);

  return (
    <LiveStatusContext.Provider value={{ isUserLive, getLiveStream, livePubkeys }}>
      {children}
    </LiveStatusContext.Provider>
  );
}
