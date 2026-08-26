import { useState, useEffect, useRef } from "react";
import { fetchEventCounts, primalStatsCache, type EventStats } from "@/lib/primal-cache";
import { eventStore, fetchInteractions } from "@/lib/nostr";

const BATCH_DELAY = 200;
const FALLBACK_DELAY = 1500;

let pendingIds: string[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchCallbacks: Array<() => void> = [];
let primalFailed = false;
let primalFailedAt = 0;
const PRIMAL_RETRY_INTERVAL = 30000;

function isDirectReply(event: { tags: string[][] }, targetEventId: string): boolean {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return false;

  const hasMarkers = eTags.some((t) => t[3] === "reply" || t[3] === "root" || t[3] === "mention");

  if (hasMarkers) {
    return eTags.some((t) => t[1] === targetEventId && t[3] === "reply");
  }

  const lastETag = eTags[eTags.length - 1];
  return lastETag[1] === targetEventId;
}

function countFromEventStore(eventId: string): EventStats {
  const replies = [...eventStore.getByFilters({ kinds: [1] })].filter(
    (e) => isDirectReply(e, eventId)
  ).length;
  const reposts = [...eventStore.getByFilters({ kinds: [6] })].filter(
    (e) => e.tags.some((t) => t[0] === "e" && t[1] === eventId)
  ).length;
  const likes = [...eventStore.getByFilters({ kinds: [7] })].filter(
    (e) => e.tags.some((t) => t[0] === "e" && t[1] === eventId)
  ).length;
  return { replies, reposts, likes, zaps: 0, zapAmount: 0 };
}

function scheduleBatch() {
  if (batchTimer) return;
  batchTimer = setTimeout(async () => {
    const ids = Array.from(new Set(pendingIds));
    const callbacks = [...batchCallbacks];
    pendingIds = [];
    batchCallbacks = [];
    batchTimer = null;

    if (ids.length === 0) return;

    const unfetched = ids.filter((id) => !primalStatsCache.has(id));
    if (unfetched.length > 0) {
      let primalSucceeded = false;

      if (primalFailed && Date.now() - primalFailedAt > PRIMAL_RETRY_INTERVAL) {
        primalFailed = false;
      }

      if (!primalFailed) {
        for (let attempt = 0; attempt < 2 && !primalSucceeded; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
            const batchSize = 20;
            for (let i = 0; i < unfetched.length; i += batchSize) {
              const batch = unfetched.slice(i, i + batchSize);
              const stats = await fetchEventCounts(batch);
              primalStatsCache.update(stats);
              primalSucceeded = true;
            }
          } catch (err) {
            if (attempt === 1) console.warn("Primal stats failed, using relay fallback:", err);
          }
        }
      }

      if (!primalSucceeded) {
        primalFailed = true;
        primalFailedAt = Date.now();
        fetchInteractions(unfetched);
        await new Promise((r) => setTimeout(r, FALLBACK_DELAY));
        for (const id of unfetched) {
          if (!primalStatsCache.has(id)) {
            const fallback = countFromEventStore(id);
            primalStatsCache.set(id, fallback);
          }
        }
      }
    }

    callbacks.forEach((cb) => cb());
  }, BATCH_DELAY);
}

export function usePrimalStats(eventId: string): EventStats | null {
  const [stats, setStats] = useState<EventStats | null>(() => {
    return primalStatsCache.get(eventId) ?? null;
  });
  const mountedRef = useRef(true);
  const updatingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const cached = primalStatsCache.get(eventId);
    if (cached) {
      setStats(cached);
      return;
    }

    pendingIds.push(eventId);
    batchCallbacks.push(() => {
      if (mountedRef.current) {
        const s = primalStatsCache.get(eventId);
        if (s) {
          setStats(s);
        }
      }
    });
    scheduleBatch();
  }, [eventId]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const processedInserts = new Set<string>();
    const sub = eventStore.insert$.subscribe((e) => {
      if (!mountedRef.current) return;
      if (processedInserts.has(e.id)) return;

      let field: "replies" | "reposts" | "likes" | null = null;

      if (e.kind === 1 && isDirectReply(e, eventId)) {
        field = "replies";
      } else if (e.kind === 6 && e.tags.some((t) => t[0] === "e" && t[1] === eventId)) {
        field = "reposts";
      } else if (e.kind === 7) {
        const eTags = e.tags.filter((t) => t[0] === "e");
        const lastETag = eTags[eTags.length - 1];
        if (lastETag && lastETag[1] === eventId) {
          field = "likes";
        }
      }

      if (field) {
        processedInserts.add(e.id);
        if (debounceTimer) clearTimeout(debounceTimer);
        const f = field;
        debounceTimer = setTimeout(() => {
          if (!mountedRef.current) return;
          const existing = primalStatsCache.get(eventId);
          const base = existing ?? { replies: 0, reposts: 0, likes: 0, zaps: 0, zapAmount: 0 };
          const updated = { ...base, [f]: base[f] + 1 };
          updatingRef.current = true;
          primalStatsCache.set(eventId, updated);
          updatingRef.current = false;
          setStats(updated);
        }, 100);
      }
    });
    return () => {
      sub.unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [eventId]);

  useEffect(() => {
    const unsub = primalStatsCache.subscribe(eventId, (updated) => {
      if (!mountedRef.current || updatingRef.current) return;
      setStats(updated);
    });
    return unsub;
  }, [eventId]);

  return stats;
}

export function usePrimalStatsBatch(eventIds: string[]): Record<string, EventStats> {
  const [statsMap, setStatsMap] = useState<Record<string, EventStats>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (eventIds.length === 0) return;

    const result: Record<string, EventStats> = {};
    const missing: string[] = [];

    for (const id of eventIds) {
      const cached = primalStatsCache.get(id);
      if (cached) {
        result[id] = cached;
      } else {
        missing.push(id);
      }
    }

    if (Object.keys(result).length > 0) {
      setStatsMap(result);
    }

    if (missing.length > 0) {
      pendingIds.push(...missing);
      batchCallbacks.push(() => {
        if (mountedRef.current) {
          const updated: Record<string, EventStats> = {};
          for (const id of eventIds) {
            const s = primalStatsCache.get(id);
            if (s) updated[id] = s;
          }
          setStatsMap(updated);
        }
      });
      scheduleBatch();
    }
  }, [eventIds.join(",")]);

  return statsMap;
}
