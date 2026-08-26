import { useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { useLocation } from "wouter";
import { Megaphone, Pin, FileText, Radio, BookOpen, CalendarDays, ExternalLink } from "lucide-react";
import { pool, getCachedProfile, fetchProfilesCached } from "@/lib/nostr";
import { Linkify } from "@/components/Linkify";
import {
  KIND_APP_DATA,
  APP_DATA_RELAYS,
  featuredDTag,
  parseFeaturedDoc,
  isFeaturedDocEmpty,
  featuredItemKey,
  kindLabel,
  type FeaturedDoc,
  type FeaturedItem,
} from "@/lib/featured";

function iconForKind(kind: number) {
  if (kind === 11) return Radio;
  if (kind === 30023) return BookOpen;
  if (kind === 31922 || kind === 31923 || kind === 30311) return CalendarDays;
  return FileText;
}

function titleOf(ev: NostrEvent): string {
  const t = ev.tags.find((x) => x[0] === "title")?.[1] || ev.tags.find((x) => x[0] === "name")?.[1];
  if (t) return t;
  const firstLine = (ev.content || "").split("\n").find((l) => l.trim());
  return (firstLine || "").slice(0, 120);
}

/** Operator-curated announcement + pinned highlights shown atop an Outpost's
 *  Timeline. Renders nothing when the operator hasn't featured anything. */
export function FeaturedStrip({ relayUrl, operatorPubkey }: { relayUrl: string; operatorPubkey?: string }) {
  const [doc, setDoc] = useState<FeaturedDoc | null>(null);
  const [resolved, setResolved] = useState<Map<string, NostrEvent>>(new Map());
  const [, setProfileTick] = useState(0);
  const [, navigate] = useLocation();
  const collapsedRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);

  // 1) Read the operator's featured doc (single replaceable event).
  useEffect(() => {
    if (!operatorPubkey) { setDoc(null); return; }
    let done = false;
    const sub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [operatorPubkey], "#d": [featuredDTag(relayUrl)], limit: 1 },
      {
        onevent(e: NostrEvent) {
          if (done) return;
          setDoc(parseFeaturedDoc(e.content, relayUrl));
        },
        oneose() { if (!done) { done = true; sub.close(); clearTimeout(timer); } },
      },
    );
    const timer = setTimeout(() => { done = true; sub.close(); }, 6000);
    return () => { done = true; sub.close(); clearTimeout(timer); };
  }, [operatorPubkey, relayUrl]);

  const items: FeaturedItem[] = useMemo(() => doc?.items ?? [], [doc]);

  // 2) Resolve referenced events in a bounded pass (ids + coordinates). The
  //    pool takes one filter per query, so notes/waves resolve via an ids query
  //    and each replaceable coord via its own short query, run in parallel.
  useEffect(() => {
    if (items.length === 0) { setResolved(new Map()); return; }
    let cancelled = false;
    const relays = Array.from(new Set([relayUrl, ...APP_DATA_RELAYS]));
    const ids = items.filter((it) => it.id).map((it) => it.id!) as string[];
    const coordItems = items.filter((it) => !it.id && it.coord);
    (async () => {
      const queries: Promise<NostrEvent[]>[] = [];
      if (ids.length) queries.push(pool.querySync(relays, { ids }, { maxWait: 4000 }));
      for (const it of coordItems) {
        const [k, pk, d] = (it.coord || "").split(":");
        if (k && pk) queries.push(pool.querySync(relays, { kinds: [Number(k)], authors: [pk], "#d": [d || ""], limit: 1 }, { maxWait: 4000 }));
      }
      const map = new Map<string, NostrEvent>();
      try {
        const results = await Promise.all(queries);
        for (const evs of results) {
          for (const e of evs) {
            map.set(e.id, e);
            const dTag = e.tags.find((t) => t[0] === "d")?.[1];
            if (dTag) map.set(`${e.kind}:${e.pubkey}:${dTag}`, e);
          }
        }
      } catch { /* best-effort */ }
      if (!cancelled) setResolved(map);
    })();
    return () => { cancelled = true; };
  }, [items, relayUrl]);

  // 3) Hydrate author profiles for the resolved items.
  useEffect(() => {
    const pks = Array.from(new Set(Array.from(resolved.values()).map((e) => e.pubkey)));
    if (pks.length === 0) return;
    fetchProfilesCached(pks);
    const t = setTimeout(() => setProfileTick((n) => n + 1), 800);
    return () => clearTimeout(t);
  }, [resolved]);

  if (!doc || isFeaturedDocEmpty(doc)) return null;

  const announcement = doc.announcement?.text?.trim();

  const openItem = (it: FeaturedItem, ev?: NostrEvent) => {
    try {
      if (it.kind === 30023 && it.coord) {
        const [k, pk, d] = it.coord.split(":");
        navigate(`/articles/${nip19.naddrEncode({ kind: Number(k), pubkey: pk, identifier: d || "" })}`);
        return;
      }
      // A live stream opens THE STREAM. Sending kind-30311 to /calendar was a
      // recorded dead end (POSITIONING_AND_IA.md's calendar audit): the calendar
      // has no player, so a featured broadcast landed on a date grid.
      if (it.kind === 30311 && it.coord) {
        const [k, pk, d] = it.coord.split(":");
        navigate(`/live/${nip19.naddrEncode({ kind: Number(k), pubkey: pk, identifier: d || "" })}`);
        return;
      }
      if ((it.kind === 31922 || it.kind === 31923 || it.kind === 30311)) {
        navigate("/calendar");
        return;
      }
      if (ev) {
        navigate(`/thread/${ev.id}`);
      }
    } catch { /* best-effort navigation */ }
  };

  return (
    <div className="rounded-lg border border-amber-500/25 dark:border-amber-500/15 bg-amber-500/[0.04] dark:bg-amber-500/[0.05] overflow-hidden" data-testid="featured-strip">
      <button
        onClick={() => { collapsedRef.current = !collapsedRef.current; setCollapsed(collapsedRef.current); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <Pin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 rotate-45 shrink-0" />
        <span className="text-[11px] font-brand tracking-wider uppercase text-amber-700 dark:text-amber-300">Featured</span>
        <span className="text-[10px] text-muted-foreground/40 ml-auto">{collapsed ? "show" : "hide"}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {announcement && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/[0.06] border border-amber-500/15 px-2.5 py-2" data-testid="featured-announcement">
              <Megaphone className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                <Linkify text={announcement} />
              </p>
            </div>
          )}

          {items.map((it) => {
            const ev = it.id ? resolved.get(it.id) : (it.coord ? resolved.get(it.coord) : undefined);
            const Icon = iconForKind(it.kind);
            const title = ev ? titleOf(ev) : (it.label || "Pinned item");
            const author = ev ? getCachedProfile(ev.pubkey) : undefined;
            const authorName = author?.display_name || author?.name || "";
            return (
              <button
                key={featuredItemKey(it)}
                onClick={() => openItem(it, ev)}
                className="w-full flex items-start gap-2.5 rounded-md border border-border/30 bg-background/40 px-2.5 py-2 text-left hover:bg-background/70 transition-colors"
                data-testid="featured-item"
              >
                <Icon className="w-3.5 h-3.5 text-amber-600/70 dark:text-amber-400/70 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-medium uppercase tracking-wide text-amber-600/70 dark:text-amber-400/60">{kindLabel(it.kind)}</span>
                    {authorName && <span className="text-[10px] text-muted-foreground/50 truncate">· {authorName}</span>}
                  </div>
                  <p className="text-xs text-foreground/80 line-clamp-2 leading-snug break-words">{title || "Pinned item"}</p>
                </div>
                <ExternalLink className="w-3 h-3 text-muted-foreground/30 mt-0.5 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
