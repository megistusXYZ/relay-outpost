import { useState, useEffect, useRef } from "react";
import { eventStore, pool, FAST_RELAYS } from "@/lib/nostr";
import { fetchUserProfileStats } from "@/lib/primal-cache";

export interface ActivityData {
  lastSeen: number | null;
  noteCount: number;
}

export const activityCache = new Map<string, ActivityData>();

const MAX_CONCURRENT = 5;
let activeCount = 0;
const pendingQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    pendingQueue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function releaseSlot() {
  activeCount--;
  if (pendingQueue.length > 0) {
    const next = pendingQueue.shift()!;
    next();
  }
}

function formatLastSeen(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function getLastSeenFromStore(pubkey: string): number | null {
  try {
    const events = [...eventStore.getByFilters({ authors: [pubkey], kinds: [1, 6, 7] })];
    if (events.length === 0) return null;
    let latest = 0;
    for (const e of events) {
      if (e.created_at > latest) latest = e.created_at;
    }
    return latest > 0 ? latest : null;
  } catch {
    return null;
  }
}

async function fetchActivity(pubkey: string): Promise<ActivityData> {
  const cached = activityCache.get(pubkey);
  if (cached) return cached;

  const localLastSeen = getLastSeenFromStore(pubkey);

  await acquireSlot();
  try {
    const s = await fetchUserProfileStats(pubkey);
    let bestLastSeen = s.lastSeen ?? null;
    if (localLastSeen && (!bestLastSeen || localLastSeen > bestLastSeen)) {
      bestLastSeen = localLastSeen;
    }

    const result: ActivityData = { lastSeen: bestLastSeen, noteCount: s.noteCount };

    if (!bestLastSeen) {
      try {
        const relays = FAST_RELAYS.slice(0, 3);
        const events = await pool.querySync(relays, { authors: [pubkey], kinds: [1], limit: 1 });
        if (events.length > 0) {
          result.lastSeen = events[0].created_at;
        }
      } catch {}
    }

    activityCache.set(pubkey, result);
    return result;
  } catch {
    const fallback: ActivityData = { lastSeen: localLastSeen, noteCount: 0 };
    if (localLastSeen) activityCache.set(pubkey, fallback);
    return fallback;
  } finally {
    releaseSlot();
  }
}

export function ActivityIndicator({ pubkey, className }: { pubkey: string; className?: string }) {
  const [data, setData] = useState<ActivityData | null>(() => activityCache.get(pubkey) ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || activityCache.has(pubkey)) {
      if (!fetchedRef.current && activityCache.has(pubkey)) {
        setData(activityCache.get(pubkey)!);
        fetchedRef.current = true;
      }
      return;
    }

    const el = containerRef.current;
    if (!el) {
      fetchedRef.current = true;
      fetchActivity(pubkey).then(setData).catch(() => {});
      return;
    }

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetchedRef.current) {
          fetchedRef.current = true;
          observer.disconnect();
          fetchActivity(pubkey).then((r) => {
            if (!cancelled) setData(r);
          }).catch(() => {});
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pubkey]);

  if (!data) return <div ref={containerRef} className="h-4" />;

  const hasLastSeen = !!data.lastSeen;
  const hasNotes = data.noteCount > 0;
  if (!hasLastSeen && !hasNotes) return null;

  let dotColor = "bg-slate-400";
  let activityLabel = "";
  let textColor = "text-muted-foreground/40";

  if (hasLastSeen) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - data.lastSeen!;
    const isActive = diff < 86400;
    const isFading = diff < 604800;

    dotColor = isActive ? "bg-emerald-400" : isFading ? "bg-amber-400" : "bg-slate-400";
    activityLabel = `${isActive ? "Active" : isFading ? "Seen" : "Last seen"} ${formatLastSeen(data.lastSeen!)}`;
    textColor = isActive
      ? "text-emerald-600/70 dark:text-emerald-400/60"
      : isFading
      ? "text-amber-600/60 dark:text-amber-400/50"
      : "text-muted-foreground/40";
  }

  const notesStat = hasNotes
    ? `${data.noteCount >= 1000 ? `${(data.noteCount / 1000).toFixed(1)}k` : data.noteCount} notes`
    : null;

  return (
    <div ref={containerRef} className={`flex items-center gap-1.5 ${className ?? "mt-0.5"}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span className={`text-[10px] whitespace-nowrap truncate ${textColor}`}>
        {activityLabel}
        {activityLabel && notesStat && <span className="text-muted-foreground/30 mx-0.5">·</span>}
        {notesStat && <span className="text-muted-foreground/40">{notesStat}</span>}
      </span>
    </div>
  );
}
