import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event as NostrEvent } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { getAuthStatus, onAuthChange } from "@/lib/nip42-auth";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { type SignalTier } from "@/lib/graperank";
import { computeEngagementScore } from "@/lib/engagement";
import { usePrimalStatsBatch } from "@/hooks/use-primal-stats";
import { Card } from "@/components/ui/card";
import { AddToFeaturedDialog } from "@/components/AddToFeaturedDialog";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Radio,
  Globe,
  Play,
  Pause,
  Trash2,
  Clock,
  Filter,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import {
  NostrFilter,
  SubCloser,
  ProfileInfo,
  ProfileName,
  resolveProfileBatch,
  formatTimestamp,
  getKindLabel,
  getKindBadgeClasses,
  getEngagementTarget,
  KindFilterSelect,
  AuthorSearchFilter,
  ContentPreviewText,
  RenderedEventPreview,
  EngagementTarget,
  tryParseRepostInner,
  npubToHex,
  LiveEvent,
  RelaySource,
  relaySourceLabel,
  relaySourceClasses,
  getOppositeRelays,
  checkEventPresenceOnRelays,
  determineRelaySource,
  ColumnFilters,
  EMPTY_COLUMN_FILTERS,
  hasActiveColumnFilters,
  applyColumnFilters,
  useColumnWidths,
  LIVE_DEFAULT_WIDTHS,
  gridTemplateStyle,
  ResizableFilterableHeader,
  FilterableHeader,
  CheckboxFilterContent,
  ProfileFilterContent,
  ContentFilterContent,
  DateRangeFilterContent,
  SortState,
  useEventStats,
  AnalyticsSummary,
  SavedViewsManager,
  SavedToolbarState,
  ExportDropdown,
  exportEventsAsCSV,
  exportEventsAsJSON,
  MobileFilterBar,
  WotBadge,
  WOT_TIER_OPTIONS,
  ScoreBadge,
  getScoreEventId,
  SCORE_TIER_OPTIONS,
} from "./shared";

const WOT_TIER_RANK: Record<string, number> = { strong: 0, moderate: 1, low: 2, weak: 3, flagged: 4, none: 5 };

export function LiveFeedTab({ relayUrl }: { relayUrl: string }) {
  const [, navigate] = useLocation();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [featureEvent, setFeatureEvent] = useState<NostrEvent | null>(null);
  const [paused, setPaused] = useState(false);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [authorFilter, setAuthorFilter] = useState("");
  const [timeRange, setTimeRange] = useState<string>("live");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<"rendered" | "raw">("rendered");
  const [totalCount, setTotalCount] = useState(0);
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [sortState, setSortState] = useState<SortState>(null);
  const { widths: liveColWidths, onResizeStart: liveResizeStart } = useColumnWidths(LIVE_DEFAULT_WIDTHS);
  const { getAuthorTier, isAuthorFlagged, wotEnabled } = useGrapeRankScores();
  const getEffectiveTier = useCallback((pk: string): SignalTier => isAuthorFlagged(pk) ? "flagged" : getAuthorTier(pk), [getAuthorTier, isAuthorFlagged]);
  const { pubkey: observerPubkey } = useNostrAuth();
  const eventsRef = useRef<LiveEvent[]>([]);
  const pausedRef = useRef(false);
  const mountedRef = useRef(true);
  const subRef = useRef<SubCloser | null>(null);
  const profileQueueRef = useRef<Set<string>>(new Set());
  const crossCheckCacheRef = useRef<Map<string, boolean>>(new Map());
  const crossCheckQueueRef = useRef<Set<string>>(new Set());

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const resolveNewProfiles = useCallback(async () => {
    const toResolve = [...profileQueueRef.current].filter(pk => !profiles.has(pk));
    if (toResolve.length === 0) return;
    profileQueueRef.current.clear();
    const resolved = await resolveProfileBatch(toResolve);
    if (resolved.size > 0) {
      setProfiles(prev => {
        const next = new Map(prev);
        resolved.forEach((v, k) => next.set(k, v));
        return next;
      });
    }
  }, [profiles]);

  useEffect(() => {
    const interval = setInterval(resolveNewProfiles, 3000);
    return () => clearInterval(interval);
  }, [resolveNewProfiles]);

  const crossCheckEvents = useCallback(async () => {
    const pending = [...crossCheckQueueRef.current];
    if (pending.length === 0) return;
    crossCheckQueueRef.current.clear();
    const unchecked = pending.filter((id) => !crossCheckCacheRef.current.has(id));
    if (unchecked.length === 0) return;
    const { type: currentType, oppositeUrls } = getOppositeRelays(relayUrl);
    if (oppositeUrls.length === 0) {
      for (const id of unchecked) crossCheckCacheRef.current.set(id, false);
      const src: RelaySource = currentType === "private" ? "private" : "public";
      setEvents((prev) =>
        prev.map((e) => unchecked.includes(e.id) ? { ...e, relaySource: e.relaySource ?? src } : e),
      );
      eventsRef.current = eventsRef.current.map((e) =>
        unchecked.includes(e.id) ? { ...e, relaySource: e.relaySource ?? src } : e,
      );
      return;
    }
    const found = await checkEventPresenceOnRelays(unchecked, oppositeUrls);
    for (const id of unchecked) crossCheckCacheRef.current.set(id, found.has(id));
    setEvents((prev) =>
      prev.map((e) => {
        if (!unchecked.includes(e.id)) return e;
        return { ...e, relaySource: determineRelaySource(currentType, found.has(e.id)) };
      }),
    );
    eventsRef.current = eventsRef.current.map((e) => {
      if (!unchecked.includes(e.id)) return e;
      return { ...e, relaySource: determineRelaySource(currentType, found.has(e.id)) };
    });
  }, [relayUrl]);

  useEffect(() => {
    const interval = setInterval(crossCheckEvents, 5000);
    crossCheckEvents();
    return () => clearInterval(interval);
  }, [crossCheckEvents]);

  useEffect(() => {
    mountedRef.current = true;
    eventsRef.current = [];
    setEvents([]);
    setTotalCount(0);
    crossCheckCacheRef.current.clear();
    crossCheckQueueRef.current.clear();

    const filter: NostrFilter = { limit: 50 };
    if (kindFilter !== "all") filter.kinds = [Number(kindFilter)];
    const authorHex = authorFilter ? npubToHex(authorFilter) : null;
    if (authorHex) filter.authors = [authorHex];
    if (timeRange !== "live") {
      const now = Math.floor(Date.now() / 1000);
      const ranges: Record<string, number> = { "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800 };
      if (ranges[timeRange]) filter.since = now - ranges[timeRange];
    }

    let cancelled = false;

    const startSubscription = () => {
      if (cancelled) return;
      subRef.current = pool.subscribeMany(
        [relayUrl],
        filter,
        {
          onevent(event: NostrEvent) {
            if (!mountedRef.current) return;
            setTotalCount(c => c + 1);
            if (pausedRef.current) return;
            const le: LiveEvent = {
              id: event.id,
              kind: event.kind,
              pubkey: event.pubkey,
              content: event.content,
              created_at: event.created_at,
              tags: event.tags,
              sig: (event as Record<string, unknown>).sig as string || "",
            };
            profileQueueRef.current.add(event.pubkey);
            if ((event.kind === 6 || event.kind === 16) && event.content) {
              const innerEvent = tryParseRepostInner(event.content);
              if (innerEvent?.pubkey) profileQueueRef.current.add(innerEvent.pubkey);
            }
            const engTarget = getEngagementTarget(event);
            if (engTarget) profileQueueRef.current.add(engTarget);
            if (!crossCheckCacheRef.current.has(event.id)) {
              crossCheckQueueRef.current.add(event.id);
            }
            const updated = [le, ...eventsRef.current];
            updated.sort((a, b) => b.created_at - a.created_at);
            eventsRef.current = updated.slice(0, 200);
            setEvents([...eventsRef.current]);
          },
        },
      );
    };

    const waitForAuth = () => {
      const s = getAuthStatus(relayUrl);
      if (s.status === "authenticated" || s.status === "failed" || s.status === "none") {
        startSubscription();
        return;
      }
      const unsub = onAuthChange(() => {
        const st = getAuthStatus(relayUrl);
        if (st.status === "authenticated" || st.status === "failed" || st.status === "none") {
          unsub();
          startSubscription();
        }
      });
    };

    pool.ensureRelay(relayUrl)
      .then(() => {
        if (cancelled) return;
        setTimeout(() => {
          if (cancelled) return;
          waitForAuth();
        }, 300);
      })
      .catch(() => {
        if (!cancelled) startSubscription();
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      subRef.current?.close();
    };
  }, [relayUrl, kindFilter, authorFilter, timeRange]);

  const clearFeed = useCallback(() => {
    eventsRef.current = [];
    setEvents([]);
    setTotalCount(0);
  }, []);

  const getLiveSource = useCallback((e: LiveEvent) => e.relaySource || "unknown", []);
  const preColumnFilteredEvents = useMemo(() => {
    if (sourceFilter === "all") return events;
    return events.filter(e => e.relaySource === sourceFilter);
  }, [events, sourceFilter]);
  const liveScoreIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of preColumnFilteredEvents) {
      ids.add(getScoreEventId(e));
    }
    return [...ids];
  }, [preColumnFilteredEvents]);
  const liveStatsMap = usePrimalStatsBatch(liveScoreIds);
  const liveScoreEventIdMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of preColumnFilteredEvents) m.set(e.id, getScoreEventId(e));
    return m;
  }, [preColumnFilteredEvents]);
  const getLiveScore = useCallback((eventId: string) => {
    const scoreId = liveScoreEventIdMap.get(eventId) ?? eventId;
    return computeEngagementScore(liveStatsMap[scoreId] ?? null);
  }, [liveStatsMap, liveScoreEventIdMap]);
  const baseFilteredEvents = useMemo(() => {
    return applyColumnFilters(preColumnFilteredEvents, columnFilters, getLiveSource, getEffectiveTier, getLiveScore, observerPubkey);
  }, [preColumnFilteredEvents, columnFilters, getLiveSource, getEffectiveTier, getLiveScore, observerPubkey]);

  const handleSort = useCallback((key: string) => {
    setSortState(prev => {
      if (prev?.key === key) {
        if (prev.direction === "asc") return { key, direction: "desc" };
        return null;
      }
      return { key, direction: "asc" };
    });
  }, []);

  const sortedEvents = useMemo(() => {
    if (!sortState) return baseFilteredEvents;
    const { key, direction } = sortState;
    const mult = direction === "asc" ? 1 : -1;
    const getProfileName = (pk: string) => {
      const p = profiles.get(pk);
      return (p?.displayName || p?.name || pk).toLowerCase();
    };
    return [...baseFilteredEvents].sort((a, b) => {
      switch (key) {
        case "date": return mult * (a.created_at - b.created_at);
        case "source": return mult * ((a.relaySource || "unknown").localeCompare(b.relaySource || "unknown"));
        case "kind": return mult * (a.kind - b.kind);
        case "author": return mult * getProfileName(a.pubkey).localeCompare(getProfileName(b.pubkey));
        case "wot": {
          const aRank = WOT_TIER_RANK[getEffectiveTier(a.pubkey)] ?? 6;
          const bRank = WOT_TIER_RANK[getEffectiveTier(b.pubkey)] ?? 6;
          return mult * (aRank - bRank);
        }
        case "score": return mult * (getLiveScore(a.id) - getLiveScore(b.id));
        case "engagement": {
          const aTarget = getEngagementTarget(a) || "";
          const bTarget = getEngagementTarget(b) || "";
          return mult * aTarget.localeCompare(bTarget);
        }
        case "content": return mult * (a.content || "").localeCompare(b.content || "");
        default: return 0;
      }
    });
  }, [baseFilteredEvents, sortState, profiles, getEffectiveTier, getLiveScore]);

  const liveOptionStats = useEventStats(preColumnFilteredEvents, profiles, getLiveSource);
  const liveStats = useEventStats(sortedEvents, profiles, getLiveSource);
  const liveToolbar = useMemo<SavedToolbarState>(() => ({ kindFilter, authorFilter, sourceFilter, timeRange }), [kindFilter, authorFilter, sourceFilter, timeRange]);
  const handleLoadView = useCallback((f: ColumnFilters, t?: SavedToolbarState) => {
    setColumnFilters({ ...EMPTY_COLUMN_FILTERS, ...f, wotTiers: f?.wotTiers ?? [], scoreTiers: f?.scoreTiers ?? [] });
    if (t) {
      if (t.kindFilter !== undefined) setKindFilter(t.kindFilter);
      if (t.authorFilter !== undefined) setAuthorFilter(t.authorFilter);
      if (t.sourceFilter !== undefined) setSourceFilter(t.sourceFilter);
      if (t.timeRange !== undefined) setTimeRange(t.timeRange);
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 min-h-[32px]">
        <Button variant={paused ? "default" : "ghost"} size="sm" onClick={() => setPaused(!paused)} className="text-[11px] h-7 px-2 shrink-0">
          {paused ? <><Play className="w-3 h-3 mr-1" />Resume</> : <><Pause className="w-3 h-3 mr-1" />Pause</>}
        </Button>
        <div className="hidden sm:contents">
          <KindFilterSelect value={kindFilter} onChange={setKindFilter} className="w-32 min-w-0" />
          <AuthorSearchFilter value={authorFilter} onChange={setAuthorFilter} className="w-36 min-w-0" placeholder="Author" />
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-24 h-7 text-[11px] min-w-0">
              <Globe className="w-3 h-3 mr-1 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-20 h-7 text-[11px] min-w-0">
              <Clock className="w-3 h-3 mr-1 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="1h">Last 1h</SelectItem>
              <SelectItem value="6h">Last 6h</SelectItem>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7d</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={clearFeed} className="text-[11px] h-7 px-2 shrink-0">
          <Trash2 className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">Clear</span>
        </Button>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <SavedViewsManager
            relayUrl={relayUrl}
            tab="livefeed"
            filters={columnFilters}
            toolbar={liveToolbar}
            onLoad={handleLoadView}
            onClearFilters={() => setColumnFilters(EMPTY_COLUMN_FILTERS)}
          />
          <ExportDropdown
            count={sortedEvents.length}
            onCSV={() => exportEventsAsCSV(sortedEvents, profiles, getLiveSource)}
            onJSON={() => exportEventsAsJSON(sortedEvents)}
          />
          <Badge variant="outline" className="text-[10px] border-brand/30 dark:border-brand/20 text-brand dark:text-brand/70 whitespace-nowrap">
            {sortedEvents.length}<span className="hidden sm:inline"> displayed</span>
          </Badge>
          <Badge variant="outline" className="text-[10px] border-black/10 dark:border-white/10 text-muted-foreground/70 whitespace-nowrap">
            {totalCount}<span className="hidden sm:inline"> total</span>
          </Badge>
        </div>
      </div>

      <AnalyticsSummary stats={liveStats} profiles={profiles} />
      <MobileFilterBar filters={columnFilters} onChange={setColumnFilters} profiles={profiles} stats={liveOptionStats} />

      <div className="max-h-[600px] overflow-y-auto pr-1">
        {sortedEvents.length === 0 ? (
          <Card className="glass-card border-brand/25 dark:border-brand/15 p-6">
            <div className="flex flex-col items-center text-center gap-2">
              <Radio className="w-6 h-6 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground/70">
                {paused ? "Feed paused. Click Resume to continue." : hasActiveColumnFilters(columnFilters) ? "No events match current filters." : "Waiting for events..."}
              </p>
            </div>
          </Card>
        ) : (
          <>
            <div className="hidden md:grid gap-x-0 px-3 py-1.5 mb-1 border-b border-black/[0.12] dark:border-white/[0.08] sticky top-0 bg-background/95 backdrop-blur-sm z-10" style={gridTemplateStyle(liveColWidths)}>
              <ResizableFilterableHeader label="Date / Time" active={columnFilters.dateRange.since !== null || columnFilters.dateRange.until !== null} borderClass="pr-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={0} onResizeStart={liveResizeStart} sortKey="date" sortState={sortState} onSort={handleSort}>
                {() => (
                  <DateRangeFilterContent
                    dateRange={columnFilters.dateRange}
                    onChange={v => setColumnFilters(f => ({ ...f, dateRange: v }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Source" active={columnFilters.sources.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={1} onResizeStart={liveResizeStart} sortKey="source" sortState={sortState} onSort={handleSort}>
                {() => (
                  <CheckboxFilterContent
                    label="Filter by Source"
                    options={[
                      { value: "public", label: "Public", count: liveOptionStats.pubCount },
                      { value: "private", label: "Private", count: liveOptionStats.pvtCount },
                      { value: "both", label: "Both", count: liveOptionStats.bothCount },
                    ]}
                    selected={columnFilters.sources}
                    onChange={v => setColumnFilters(f => ({ ...f, sources: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, sources: [] }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Kind" active={columnFilters.kinds.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={2} onResizeStart={liveResizeStart} sortKey="kind" sortState={sortState} onSort={handleSort}>
                {() => (
                  <CheckboxFilterContent
                    label="Filter by Kind"
                    options={liveOptionStats.uniqueKinds.map(([k, c]) => ({ value: String(k), label: getKindLabel(k), count: c }))}
                    selected={columnFilters.kinds.map(String)}
                    onChange={v => setColumnFilters(f => ({ ...f, kinds: v.map(Number) }))}
                    onClear={() => setColumnFilters(f => ({ ...f, kinds: [] }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Author" active={columnFilters.authors.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={3} onResizeStart={liveResizeStart} sortKey="author" sortState={sortState} onSort={handleSort}>
                {() => (
                  <ProfileFilterContent
                    label="Filter by Author"
                    options={liveOptionStats.uniqueAuthors.map(([pk, c]) => ({ pubkey: pk, count: c }))}
                    selected={columnFilters.authors}
                    onChange={v => setColumnFilters(f => ({ ...f, authors: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, authors: [] }))}
                    profiles={profiles}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label={wotEnabled ? "WoT" : ""} active={(columnFilters.wotTiers?.length || 0) > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={4} onResizeStart={liveResizeStart} sortKey="wot" sortState={sortState} onSort={handleSort}>
                {() => (
                  <CheckboxFilterContent
                    label="Filter by WoT Tier"
                    options={WOT_TIER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                    selected={columnFilters.wotTiers}
                    onChange={v => setColumnFilters(f => ({ ...f, wotTiers: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, wotTiers: [] }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Score" active={(columnFilters.scoreTiers?.length || 0) > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={5} onResizeStart={liveResizeStart} sortKey="score" sortState={sortState} onSort={handleSort}>
                {() => (
                  <CheckboxFilterContent
                    label="Filter by Score Tier"
                    options={SCORE_TIER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                    selected={columnFilters.scoreTiers ?? []}
                    onChange={v => setColumnFilters(f => ({ ...f, scoreTiers: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, scoreTiers: [] }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Engagement" active={columnFilters.engagement.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={6} onResizeStart={liveResizeStart} sortKey="engagement" sortState={sortState} onSort={handleSort}>
                {() => (
                  <ProfileFilterContent
                    label="Filter by Target"
                    options={liveOptionStats.uniqueEngagement.map(([pk, c]) => ({ pubkey: pk, count: c }))}
                    selected={columnFilters.engagement}
                    onChange={v => setColumnFilters(f => ({ ...f, engagement: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, engagement: [] }))}
                    profiles={profiles}
                    showNoneOption
                    noneCount={liveOptionStats.noEngagementCount}
                  />
                )}
              </ResizableFilterableHeader>
              <FilterableHeader label="Content" active={columnFilters.contentSearch !== "" || (columnFilters.contentTypes?.length || 0) > 0} borderClass="pl-2" sortKey="content" sortState={sortState} onSort={handleSort}>
                {() => (
                  <ContentFilterContent
                    value={columnFilters.contentSearch}
                    onChange={v => setColumnFilters(f => ({ ...f, contentSearch: v }))}
                    contentTypes={columnFilters.contentTypes || []}
                    onContentTypesChange={v => setColumnFilters(f => ({ ...f, contentTypes: v }))}
                    typeCounts={liveOptionStats.contentTypeCounts}
                  />
                )}
              </FilterableHeader>
            </div>
            <div className="space-y-1">
              {sortedEvents.map((event) => (
                <Card
                  key={event.id}
                  className="glass-card border-brand/20 dark:border-brand/10 cursor-pointer hover:border-brand/25 transition-colors overflow-hidden"
                  onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                >
                  <div className="hidden md:grid gap-x-0 items-center px-3 py-2 min-w-0" style={gridTemplateStyle(liveColWidths)}>
                    <span className="text-[10px] text-muted-foreground/70 font-mono truncate pr-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      {formatTimestamp(event.created_at)}
                    </span>
                    <span className="flex items-center justify-center px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      {event.relaySource && event.relaySource !== "unknown" ? (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${relaySourceClasses(event.relaySource)}`}>
                          {relaySourceLabel(event.relaySource)}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/25">···</span>
                      )}
                    </span>
                    <span className="flex items-center px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <Badge variant="outline" className={`text-[10px] truncate max-w-full ${getKindBadgeClasses(event.kind, event.tags)}`}>
                        {getKindLabel(event.kind, event.tags)}
                      </Badge>
                    </span>
                    <span className="min-w-0 overflow-hidden px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <ProfileName pubkey={event.pubkey} profiles={profiles} showCopy />
                    </span>
                    <span className="min-w-0 overflow-hidden px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <WotBadge pubkey={event.pubkey} observerPubkey={observerPubkey} event={event} getAuthorTier={getAuthorTier} isAuthorFlagged={isAuthorFlagged} />
                    </span>
                    <span className="min-w-0 overflow-hidden flex items-center px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <ScoreBadge eventId={getScoreEventId(event)} statsMap={liveStatsMap} />
                    </span>
                    <span className="min-w-0 overflow-hidden px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <EngagementTarget event={event} profiles={profiles} />
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 truncate min-w-0 pl-2">
                      <ContentPreviewText content={event.content} kind={event.kind} tags={event.tags} />
                    </span>
                  </div>
                  <div className="md:hidden px-3 py-2.5 space-y-2 active:bg-black/[0.02] dark:active:bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
                        {formatTimestamp(event.created_at)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {event.relaySource && event.relaySource !== "unknown" && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${relaySourceClasses(event.relaySource)}`}>
                            {relaySourceLabel(event.relaySource)}
                          </Badge>
                        )}
                        <Badge variant="outline" className={`text-[10px] ${getKindBadgeClasses(event.kind, event.tags)}`}>
                          {getKindLabel(event.kind, event.tags)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="min-w-0 flex-1">
                        <ProfileName pubkey={event.pubkey} profiles={profiles} showCopy />
                      </span>
                      <WotBadge pubkey={event.pubkey} observerPubkey={observerPubkey} event={event} getAuthorTier={getAuthorTier} isAuthorFlagged={isAuthorFlagged} />
                      <ScoreBadge eventId={getScoreEventId(event)} statsMap={liveStatsMap} />
                      {getEngagementTarget(event) && (
                        <div className="flex items-center gap-1 min-w-0 shrink">
                          <ArrowRight className="w-2.5 h-2.5 text-brand/50 shrink-0" />
                          <EngagementTarget event={event} profiles={profiles} />
                        </div>
                      )}
                    </div>
                    {(event.content || event.tags.length > 0) && (
                      <div className="text-[10px] text-muted-foreground/60 line-clamp-2 leading-relaxed">
                        <ContentPreviewText content={event.content} kind={event.kind} tags={event.tags} />
                      </div>
                    )}
                  </div>
                  {expandedId === event.id && (
                    <div className="mx-3 mb-2 pt-2 border-t border-black/[0.08] dark:border-white/[0.06]">
                      <div className="flex items-center gap-1 mb-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedView("rendered"); }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${expandedView === "rendered" ? "bg-brand/20 text-brand" : "text-muted-foreground/70 hover:text-muted-foreground/70"}`}
                        >
                          Rendered
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedView("raw"); }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${expandedView === "raw" ? "bg-brand/20 text-brand" : "text-muted-foreground/70 hover:text-muted-foreground/70"}`}
                        >
                          Raw JSON
                        </button>
                        <ScoreBadge eventId={getScoreEventId(event)} statsMap={liveStatsMap} />
                        <button
                          onClick={(e) => { e.stopPropagation(); setFeatureEvent(event); }}
                          className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors text-muted-foreground/70 hover:text-brand hover:bg-brand/10 ml-auto flex items-center gap-1"
                          data-testid={`button-livefeed-feature-${event.id.slice(0, 8)}`}
                          title="Add to this relay's Featured feeds"
                        >
                          <MagicStarIcon className="w-2.5 h-2.5" />
                          Feature
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/thread/${nip19.noteEncode(getScoreEventId(event))}`); }}
                          className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors text-muted-foreground/70 hover:text-brand hover:bg-brand/10 flex items-center gap-1"
                        >
                          View Post
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      {expandedView === "rendered" ? (
                        <RenderedEventPreview event={event} profiles={profiles} relayUrl={relayUrl} />
                      ) : (
                        <pre className="text-[10px] font-mono text-muted-foreground/60 whitespace-pre-wrap max-h-60 overflow-y-auto bg-black/[0.04] dark:bg-black/20 rounded p-2">
                          {JSON.stringify(event, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
      {featureEvent && (
        <AddToFeaturedDialog
          event={featureEvent}
          open={!!featureEvent}
          onOpenChange={(o) => { if (!o) setFeatureEvent(null); }}
          presetRelayUrl={relayUrl}
        />
      )}
    </div>
  );
}

