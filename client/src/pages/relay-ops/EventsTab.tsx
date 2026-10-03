import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { createPortal } from "react-dom";
import { nip19 } from "nostr-tools";
import type { Event as NostrEvent, Filter as RelayFilter } from "nostr-tools";
import { pool, searchCachedProfiles } from "@/lib/nostr";
import { getAuthStatus, onAuthChange } from "@/lib/nip42-auth";
import { searchUsers } from "@/lib/primal-cache";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { type SignalTier } from "@/lib/graperank";
import { computeEngagementScore } from "@/lib/engagement";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { usePrimalStatsBatch } from "@/hooks/use-primal-stats";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { blockAuthorOnRelay, removeEventOnRelay } from "@/lib/relay-moderation";
import { Card } from "@/components/ui/card";
import { OpsCard, OpsSectionHeader } from "./ops-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { AddToFeaturedDialog } from "@/components/AddToFeaturedDialog";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import {
  Copy,
  Check,
  Search,
  Trash2,
  UserX,
  Plus,
  Download,
  Upload,
  Clock,
  Filter,
  X,
  User,
  ExternalLink,
  ArrowRight,
  SlidersHorizontal,
  Pause,
  Play,
  Radio,
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
  ContentPreviewText,
  RenderedEventPreview,
  EngagementTarget,
  tryParseRepostInner,
  pubkeyToNpub,
  subscribeWithTimeout,
  addModLogEntry,
  ADMIN_BLOCKLIST_KEY,
  getStoredList,
  saveStoredList,
  RelaySource,
  relaySourceLabel,
  relaySourceClasses,
  getOppositeRelays,
  checkEventPresenceOnRelays,
  determineRelaySource,
  ColumnFilters,
  EMPTY_COLUMN_FILTERS,
  applyColumnFilters,
  useColumnWidths,
  EVT_DEFAULT_WIDTHS,
  gridTemplateStyle,
  ResizableFilterableHeader,
  FilterableHeader,
  CheckboxFilterContent,
  ProfileFilterContent,
  ContentFilterContent,
  DateRangeFilterContent,
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
import { parseEventQuery, queryFilter, queryFromSavedToolbar, TIME_RANGES, type RangeId, type TimeWindow } from "./event-query";

const LIVE_CAP = 300;

function localToSec(s: string): number | undefined {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  return isNaN(t) ? undefined : Math.floor(t / 1000);
}

/**
 * The Events section: one list of what is on the relay.
 *
 * One field reads what you type for what it is (see event-query.ts); the
 * time window and source sit behind Filter; the Live switch keeps the same
 * list open on the relay so new events arrive at the top. Live Feed used to
 * be a second tab with a second table and its own four boxes.
 */
export function EventsTab({ relayUrl, initialLive = false }: { relayUrl: string; initialLive?: boolean }) {
  const [, navigate] = useLocation();
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [range, setRange] = useState<RangeId | "custom">("any");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [eventsSourceFilter, setEventsSourceFilter] = useState<string>("all");
  const [live, setLive] = useState(initialLive);
  const [paused, setPaused] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [results, setResults] = useState<NostrEvent[]>([]);
  const [searching, setSearching] = useState(false);
  const [featureEvent, setFeatureEvent] = useState<NostrEvent | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<"rendered" | "raw">("rendered");
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [eventSources, setEventSources] = useState<Map<string, RelaySource>>(new Map());
  const [pendingBlock, setPendingBlock] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const { widths: evtColWidths, onResizeStart: evtResizeStart } = useColumnWidths(EVT_DEFAULT_WIDTHS);
  const { getAuthorTier, isAuthorFlagged, wotEnabled } = useGrapeRankScores();
  const getEffectiveTier = useCallback((pk: string): SignalTier => isAuthorFlagged(pk) ? "flagged" : getAuthorTier(pk), [getAuthorTier, isAuthorFlagged]);

  const parsed = useMemo(() => parseEventQuery(submitted), [submitted]);
  const window = useMemo<TimeWindow>(
    () => range === "custom" ? { range, since: localToSec(customSince), until: localToSec(customUntil) } : { range },
    [range, customSince, customUntil],
  );
  const windowActive = range !== "any";
  const matchesText = useCallback((e: NostrEvent) => {
    if (!parsed.text) return true;
    return e.content.toLowerCase().includes(parsed.text.toLowerCase());
  }, [parsed.text]);

  // Names and sources for events as they arrive — a search result set at once,
  // a live trickle a few at a time. Both go through one queue.
  const profileQueueRef = useRef<Set<string>>(new Set());
  const sourceQueueRef = useRef<Set<string>>(new Set());
  const sourceCacheRef = useRef<Map<string, RelaySource>>(new Map());
  const absorb = useCallback((events: NostrEvent[]) => {
    for (const e of events) {
      profileQueueRef.current.add(e.pubkey);
      if ((e.kind === 6 || e.kind === 16) && e.content) {
        const inner = tryParseRepostInner(e.content);
        if (inner?.pubkey) profileQueueRef.current.add(inner.pubkey);
      }
      const target = getEngagementTarget(e);
      if (target) profileQueueRef.current.add(target);
      if (!sourceCacheRef.current.has(e.id)) sourceQueueRef.current.add(e.id);
    }
  }, []);
  const flush = useCallback(async () => {
    const pks = [...profileQueueRef.current];
    profileQueueRef.current.clear();
    if (pks.length) {
      const resolved = await resolveProfileBatch(pks);
      if (resolved.size) setProfiles((prev) => { const next = new Map(prev); resolved.forEach((v, k) => next.set(k, v)); return next; });
    }
    const ids = [...sourceQueueRef.current];
    sourceQueueRef.current.clear();
    if (ids.length) {
      const { type: currentType, oppositeUrls } = getOppositeRelays(relayUrl);
      const found = oppositeUrls.length ? await checkEventPresenceOnRelays(ids, oppositeUrls) : new Set<string>();
      for (const id of ids) sourceCacheRef.current.set(id, oppositeUrls.length ? determineRelaySource(currentType, found.has(id)) : (currentType === "private" ? "private" : "public"));
      setEventSources(new Map(sourceCacheRef.current));
    }
  }, [relayUrl]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const t = setInterval(() => { flushRef.current(); }, 2500);
    return () => clearInterval(t);
  }, []);

  const relayFilter = useCallback(() => queryFilter(parsed, window, Math.floor(Date.now() / 1000)), [parsed, window]);

  // One-shot: the list as it stands now.
  const runSearch = useCallback(async () => {
    if (window.range === "custom" && window.since && window.until && window.since > window.until) {
      toast({ title: "Start is after end", description: "Pick a start time before the end time.", variant: "destructive" });
      return;
    }
    setSearching(true);
    const collected = await subscribeWithTimeout([relayUrl], [relayFilter()], 6000);
    const sorted = collected.filter(matchesText).sort((a, b) => b.created_at - a.created_at);
    setResults(sorted);
    setSearching(false);
    absorb(sorted);
    flushRef.current();
  }, [relayUrl, relayFilter, matchesText, window, toast, absorb]);
  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;

  useEffect(() => {
    if (live) return;
    runSearchRef.current();
  }, [live, relayUrl, submitted, window]);

  // Live: the same question, left open. Stored events arrive first, then
  // whatever the relay accepts from now on, at the top.
  const pausedRef = useRef(false);
  const heldRef = useRef<NostrEvent[]>([]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const merge = useCallback((incoming: NostrEvent[]) => {
    if (!incoming.length) return;
    setResults((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const fresh = incoming.filter((e) => !seen.has(e.id));
      if (!fresh.length) return prev;
      return [...fresh, ...prev].sort((a, b) => b.created_at - a.created_at).slice(0, LIVE_CAP);
    });
    absorb(incoming);
  }, [absorb]);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let sub: SubCloser | null = null;
    setResults([]);
    heldRef.current = [];
    setHeldCount(0);
    const filter = relayFilter();
    const start = () => {
      if (cancelled) return;
      sub = pool.subscribeMany([relayUrl], filter as RelayFilter, {
        onevent(event: NostrEvent) {
          if (cancelled || !matchesText(event)) return;
          if (pausedRef.current) { heldRef.current.push(event); setHeldCount(heldRef.current.length); return; }
          merge([event]);
        },
      });
    };
    const ready = (s: string) => s === "authenticated" || s === "failed" || s === "none";
    const whenAuthSettled = () => {
      if (ready(getAuthStatus(relayUrl).status)) { start(); return; }
      const unsub = onAuthChange(() => {
        if (ready(getAuthStatus(relayUrl).status)) { unsub(); start(); }
      });
    };
    pool.ensureRelay(relayUrl)
      .then(() => { if (!cancelled) setTimeout(whenAuthSettled, 300); })
      .catch(() => { if (!cancelled) start(); });
    return () => { cancelled = true; sub?.close(); };
  }, [live, relayUrl, relayFilter, matchesText, merge]);
  const resume = useCallback(() => {
    setPaused(false);
    const held = heldRef.current;
    heldRef.current = [];
    setHeldCount(0);
    merge(held);
  }, [merge]);
  const clearList = useCallback(() => { setResults([]); heldRef.current = []; setHeldCount(0); }, []);

  const extractPublishError = useCallback((err: unknown): { reason: string; needsAuth: boolean } => {
    const messages: string[] = [];
    if (err instanceof AggregateError) {
      for (const e of err.errors) {
        if (e instanceof Error && e.message) messages.push(e.message);
        else if (typeof e === "string") messages.push(e);
      }
    } else if (err instanceof Error) {
      messages.push(err.message);
    } else if (typeof err === "string") {
      messages.push(err);
    }
    const joined = messages.join(" | ").trim();
    const lower = joined.toLowerCase();
    const needsAuth = lower.includes("auth-required") || lower.includes("restricted: not authenticated");
    return { reason: joined || "No reason returned by relay.", needsAuth };
  }, []);
  const requestDeletion = useCallback(async (eventId: string) => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to delete events.", variant: "destructive" });
      return;
    }
    // Through the relay's management API when it has one (lib/relay-moderation.ts):
    // a kind-5 deletion is honoured only from the post's own author.
    const viaRelay = await removeEventOnRelay(relayUrl, eventId);
    if (viaRelay.onRelay) {
      const targetEvt = results.find(e => e.id === eventId);
      addModLogEntry(relayUrl, { action: "delete_event", targetEventId: eventId, targetPubkey: targetEvt?.pubkey, targetKind: targetEvt?.kind });
      setResults(prev => prev.filter(e => e.id !== eventId));
      toast({ title: "Removed from the relay", description: `${eventId.slice(0, 8)}… is gone from this relay.` });
      return;
    }
    if (viaRelay.reason === "error") {
      toast({ title: "The relay refused", description: viaRelay.message, variant: "destructive" });
      return;
    }
    try {
      const deleteEvent = {
        kind: 5 as const,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["e", eventId]],
        content: "Deleted by relay operator",
      };
      const signed = await signWithTimeout(signer, deleteEvent);
      await Promise.any(pool.publish([relayUrl], signed));
      const targetEvt = results.find(e => e.id === eventId);
      addModLogEntry(relayUrl, {
        action: "delete_event",
        targetEventId: eventId,
        targetPubkey: targetEvt?.pubkey,
        targetKind: targetEvt?.kind,
      });
      toast({
        title: "Deletion requested",
        description: viaRelay.reason === "unreachable"
          ? "We couldn't reach this relay's management API, so a deletion request was sent instead. Relays usually honour those only from the post's author."
          : "This relay has no management API, so a deletion request was sent instead. Relays usually honour those only from the post's author.",
      });
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.warn("[RelayOps] Deletion failed:", err);
        const { reason, needsAuth } = extractPublishError(err);
        if (needsAuth) {
          toast({
            title: "Deletion blocked: relay requires AUTH",
            description: "This relay rejected the deletion because NIP-42 authentication isn't enabled. Open Auth settings for this relay, enable AUTH, then retry.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Deletion failed", description: `Relay said: ${reason}`, variant: "destructive" });
        }
      }
    }
  }, [relayUrl, signer, pubkey, toast, results, attemptReconnect, extractPublishError]);

  const bulkDeleteByKind = useCallback(async (kind: number) => {
    if (!signer || !pubkey) return;
    const toDelete = results.filter(e => e.kind === kind);
    if (toDelete.length === 0) return;
    let success = 0;
    let lastError: unknown = null;
    for (const event of toDelete) {
      try {
        const delEvent = {
          kind: 5 as const,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["e", event.id]],
          content: "Bulk deletion by relay operator",
        };
        const signed = await signWithTimeout(signer, delEvent);
        await Promise.any(pool.publish([relayUrl], signed));
        success++;
      } catch (err) {
        lastError = err;
        console.warn("[RelayOps] Bulk delete item failed:", event.id, err);
      }
    }
    addModLogEntry(relayUrl, {
      action: "bulk_delete",
      targetKind: kind,
      count: success,
    });
    if (success === 0 && lastError) {
      const { reason, needsAuth } = extractPublishError(lastError);
      toast({
        title: "Bulk deletion failed",
        description: needsAuth
          ? "Relay requires AUTH. Enable NIP-42 in Auth settings and retry."
          : `Relay said: ${reason}`,
        variant: "destructive",
      });
    } else {
      toast({ title: "Bulk deletion", description: `Sent ${success}/${toDelete.length} deletion requests for kind ${kind}.` });
    }
  }, [results, signer, pubkey, relayUrl, toast, extractPublishError]);

  const confirmBlockAuthor = useCallback(async () => {
    if (!pendingBlock) return;
    const who = pendingBlock;
    setPendingBlock(null);
    // On the relay when it has a management API (lib/relay-moderation.ts); this
    // used to write only a list kept in this browser and call it blocked.
    const viaRelay = await blockAuthorOnRelay(relayUrl, who);
    if (!viaRelay.onRelay && viaRelay.reason === "error") {
      toast({ title: "The relay refused", description: viaRelay.message, variant: "destructive" });
      return;
    }
    const blocklist = getStoredList(ADMIN_BLOCKLIST_KEY, relayUrl);
    if (!blocklist.includes(who)) saveStoredList(ADMIN_BLOCKLIST_KEY, relayUrl, [...blocklist, who]);
    addModLogEntry(relayUrl, { action: "block_author", targetPubkey: who });
    if (viaRelay.onRelay) {
      toast({ title: "Blocked on the relay", description: `${who.slice(0, 8)}… can no longer post here.` });
    } else {
      toast({
        title: "Added locally — not synced",
        description: viaRelay.reason === "unreachable"
          ? `${who.slice(0, 8)}… couldn't be sent: we can't reach this relay's management API right now.`
          : `${who.slice(0, 8)}… is on your local list only. This relay has no management API, so ask its host to block them.`,
        variant: viaRelay.reason === "unreachable" ? "destructive" : undefined,
      });
    }
  }, [pendingBlock, relayUrl, toast]);

  const kindStats = useMemo(() => {
    const m = new Map<number, { count: number; sampleTags: string[][] }>();
    for (const e of results) {
      const cur = m.get(e.kind);
      if (cur) cur.count++;
      else m.set(e.kind, { count: 1, sampleTags: e.tags });
    }
    return m;
  }, [results]);
  const uniqueKinds = useMemo(() => [...kindStats.keys()].sort((a, b) => a - b), [kindStats]);

  const getEvtSource = useCallback((e: NostrEvent) => eventSources.get(e.id) || "unknown", [eventSources]);
  const preColumnFilteredResults = useMemo(() => {
    if (eventsSourceFilter === "all") return results;
    return results.filter(e => eventSources.get(e.id) === eventsSourceFilter);
  }, [results, eventsSourceFilter, eventSources]);
  const evtScoreIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of preColumnFilteredResults) {
      ids.add(getScoreEventId(e));
    }
    return [...ids];
  }, [preColumnFilteredResults]);
  const evtStatsMap = usePrimalStatsBatch(evtScoreIds);
  const evtScoreEventIdMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of preColumnFilteredResults) m.set(e.id, getScoreEventId(e));
    return m;
  }, [preColumnFilteredResults]);
  const getEvtScore = useCallback((eventId: string) => {
    const scoreId = evtScoreEventIdMap.get(eventId) ?? eventId;
    return computeEngagementScore(evtStatsMap[scoreId] ?? null);
  }, [evtStatsMap, evtScoreEventIdMap]);
  const evtFilteredResults = useMemo(() => {
    return applyColumnFilters(preColumnFilteredResults, columnFilters, getEvtSource, getEffectiveTier, getEvtScore, pubkey);
  }, [preColumnFilteredResults, columnFilters, getEvtSource, getEffectiveTier, getEvtScore, pubkey]);
  const evtOptionStats = useEventStats(preColumnFilteredResults, profiles, getEvtSource);
  const evtStats = useEventStats(evtFilteredResults, profiles, getEvtSource);
  const evtToolbar = useMemo<SavedToolbarState>(() => ({
    sourceFilter: eventsSourceFilter,
    searchContent: submitted,
    searchSince: customSince,
    searchUntil: customUntil,
    timePreset: range === "any" ? "none" : range,
  }), [eventsSourceFilter, submitted, customSince, customUntil, range]);
  const handleEvtLoadView = useCallback((f: ColumnFilters, t?: SavedToolbarState) => {
    setColumnFilters({ ...EMPTY_COLUMN_FILTERS, ...f, wotTiers: f?.wotTiers ?? [], scoreTiers: f?.scoreTiers ?? [] });
    if (t) {
      if (t.sourceFilter !== undefined) setEventsSourceFilter(t.sourceFilter);
      const q = queryFromSavedToolbar(t);
      setQuery(q);
      setSubmitted(q);
      const preset = t.timePreset;
      if (!preset || preset === "none") setRange("any");
      else if (preset === "custom") { setRange("custom"); setCustomSince(t.searchSince ?? ""); setCustomUntil(t.searchUntil ?? ""); }
      else if (TIME_RANGES.some((r) => r.id === preset)) setRange(preset as RangeId);
    }
  }, []);

  const shown = evtFilteredResults.length;
  const rangeLabel = range === "custom" ? "Custom" : TIME_RANGES.find((r) => r.id === range)?.label ?? "Any time";

  return (
    <div className="space-y-3">
      {/* One field · Live · Filter */}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim()); }}
        role="search"
      >
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isMobile ? "Search events" : "Search — words, an npub, kind:1, or an event id"}
            title="Words, an npub, kind:1, or an event id"
            aria-label="Search events"
            enterKeyHint="search"
            className="h-11 sm:h-10 pl-10 pr-10 rounded-full text-sm"
            data-testid="ops-events-search"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setSubmitted(""); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <label className="inline-flex items-center gap-2 h-11 sm:h-10 px-1.5 shrink-0 cursor-pointer select-none text-sm font-medium">
          <Switch checked={live} onCheckedChange={(v) => { setLive(v); setPaused(false); }} aria-label="Live" data-testid="ops-events-live" />
          <span className={live ? "text-foreground" : "text-muted-foreground"}>Live</span>
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="relative h-11 w-11 p-0 sm:h-10 sm:w-auto sm:px-3.5 rounded-full shrink-0 text-[13px]"
              aria-label={windowActive ? `Filter — ${rangeLabel}` : "Filter"}
              data-active={windowActive}
              data-testid="ops-events-filter"
            >
              <SlidersHorizontal className="w-4 h-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">{windowActive ? rangeLabel : "Filter"}</span>
              {windowActive && <span className="absolute top-1.5 right-1.5 sm:hidden w-2 h-2 rounded-full bg-brand" aria-hidden="true" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-[min(22rem,calc(100vw-1.5rem))] p-3 space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-1.5">Time</p>
              <div className="flex flex-wrap gap-1.5">
                {[...TIME_RANGES, { id: "custom" as const, label: "Custom" }].map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRange(r.id)}
                    className={`h-10 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
                      range === r.id ? "bg-brand text-white" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"
                    }`}
                    aria-pressed={range === r.id}
                    data-testid={`ops-events-range-${r.id}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {range === "custom" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground/70 flex items-center gap-1"><Clock className="w-3 h-3" />From</span>
                    <input type="datetime-local" value={customSince} onChange={(e) => setCustomSince(e.target.value)} className="w-full h-10 px-3 rounded-md border border-black/[0.1] dark:border-white/[0.08] bg-background text-sm focus:outline-none focus:ring-1 focus:ring-brand/40 dark:[color-scheme:dark]" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground/70 flex items-center gap-1"><Clock className="w-3 h-3" />To</span>
                    <input type="datetime-local" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} className="w-full h-10 px-3 rounded-md border border-black/[0.1] dark:border-white/[0.08] bg-background text-sm focus:outline-none focus:ring-1 focus:ring-brand/40 dark:[color-scheme:dark]" />
                  </label>
                </div>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-1.5">Source</p>
              <Select value={eventsSourceFilter} onValueChange={setEventsSourceFilter}>
                <SelectTrigger className="h-10 text-sm" aria-label="Source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
      </form>

      {/* What the list is showing, and what you can do with it */}
      <div className="flex items-center gap-1.5 px-1 min-h-[32px] flex-wrap">
        <span className="text-xs text-muted-foreground/80 whitespace-nowrap shrink-0 inline-flex items-center gap-1.5" data-testid="ops-events-count">
          {live && <Radio className={`w-3.5 h-3.5 ${paused ? "text-muted-foreground/60" : "text-emerald-500 animate-pulse"}`} aria-hidden="true" />}
          {searching ? "Looking…" : shown === results.length ? `${results.length} ${results.length === 1 ? "event" : "events"}` : `${shown} of ${results.length}`}
          {live && paused && heldCount > 0 && <span className="text-brand">· {heldCount} new</span>}
        </span>
        {live && (
          <>
            <Button variant="ghost" size="sm" onClick={paused ? resume : () => setPaused(true)} className="h-8 px-2 text-xs" data-testid="ops-events-pause">
              {paused ? <><Play className="w-3.5 h-3.5 mr-1" />Resume</> : <><Pause className="w-3.5 h-3.5 mr-1" />Pause</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={clearList} className="h-8 px-2 text-xs" aria-label="Clear the list">
              <Trash2 className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Clear</span>
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <SavedViewsManager
            relayUrl={relayUrl}
            tab="events"
            filters={columnFilters}
            toolbar={evtToolbar}
            onLoad={handleEvtLoadView}
            onClearFilters={() => setColumnFilters(EMPTY_COLUMN_FILTERS)}
          />
          <ExportDropdown
            count={evtFilteredResults.length}
            onCSV={() => exportEventsAsCSV(evtFilteredResults, profiles, getEvtSource)}
            onJSON={() => exportEventsAsJSON(evtFilteredResults)}
          />
          {uniqueKinds.length > 0 && signer && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-xs gap-1.5 text-red-600 dark:text-red-400/80 hover:text-red-500 dark:hover:text-red-300 hover:bg-red-500/10 dark:hover:bg-red-500/15 border border-transparent hover:border-red-500/20 dark:hover:border-red-400/20 shrink-0"
                  data-testid="button-bulk-delete-trigger"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Bulk delete</span>
                  <span className="sm:hidden">Delete</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/60 dark:text-muted-foreground/50">
                    {uniqueKinds.length}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={6}
                className="w-[min(20rem,calc(100vw-1.5rem))] p-2"
              >
                <div className="px-2 pt-1 pb-2 mb-1 border-b border-border/40">
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                    Delete by kind
                  </p>
                  <p className="text-[10px] text-muted-foreground/55 mt-0.5 leading-snug">
                    Removes every event of the chosen kind from this relay. This cannot be undone.
                  </p>
                </div>
                <div className="space-y-0.5 max-h-[260px] overflow-y-auto">
                  {uniqueKinds.map(k => {
                    const stat = kindStats.get(k)!;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => bulkDeleteByKind(k)}
                        className="group w-full flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-red-500/[0.08] dark:hover:bg-red-500/[0.12] focus-visible:outline-none focus-visible:bg-red-500/[0.08] dark:focus-visible:bg-red-500/[0.12]"
                        data-testid={`button-bulk-delete-kind-${k}`}
                      >
                        <Badge variant="outline" className={`text-[10px] shrink-0 max-w-[55%] truncate ${getKindBadgeClasses(k, stat.sampleTags)}`}>
                          {getKindLabel(k, stat.sampleTags)}
                        </Badge>
                        <span className="flex-1 min-w-0 text-[11px] font-mono tabular-nums text-muted-foreground/70 text-right">
                          {stat.count.toLocaleString()} {stat.count === 1 ? "event" : "events"}
                        </span>
                        <Trash2 className="w-3.5 h-3.5 shrink-0 text-red-500/40 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" />
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          <AnalyticsSummary stats={evtStats} profiles={profiles} />
          <MobileFilterBar filters={columnFilters} onChange={setColumnFilters} profiles={profiles} stats={evtOptionStats} />
          <div className="max-h-[500px] overflow-y-auto pr-1">
            <div className="hidden md:grid gap-x-0 px-3 py-1.5 mb-1 border-b border-black/[0.12] dark:border-white/[0.08] sticky top-0 bg-background/95 backdrop-blur-sm z-10" style={gridTemplateStyle(evtColWidths, true)}>
              <ResizableFilterableHeader label="Date / Time" active={columnFilters.dateRange.since !== null || columnFilters.dateRange.until !== null} borderClass="pr-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={0} onResizeStart={evtResizeStart}>
                {() => (
                  <DateRangeFilterContent
                    dateRange={columnFilters.dateRange}
                    onChange={v => setColumnFilters(f => ({ ...f, dateRange: v }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Source" active={columnFilters.sources.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={1} onResizeStart={evtResizeStart}>
                {() => (
                  <CheckboxFilterContent
                    label="Filter by Source"
                    options={[
                      { value: "public", label: "Public", count: evtOptionStats.pubCount },
                      { value: "private", label: "Private", count: evtOptionStats.pvtCount },
                      { value: "both", label: "Both", count: evtOptionStats.bothCount },
                    ]}
                    selected={columnFilters.sources}
                    onChange={v => setColumnFilters(f => ({ ...f, sources: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, sources: [] }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Kind" active={columnFilters.kinds.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={2} onResizeStart={evtResizeStart}>
                {() => (
                  <CheckboxFilterContent
                    label="Filter by Kind"
                    options={evtOptionStats.uniqueKinds.map(([k, c]) => ({ value: String(k), label: getKindLabel(k), count: c }))}
                    selected={columnFilters.kinds.map(String)}
                    onChange={v => setColumnFilters(f => ({ ...f, kinds: v.map(Number) }))}
                    onClear={() => setColumnFilters(f => ({ ...f, kinds: [] }))}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label="Author" active={columnFilters.authors.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={3} onResizeStart={evtResizeStart}>
                {() => (
                  <ProfileFilterContent
                    label="Filter by Author"
                    options={evtOptionStats.uniqueAuthors.map(([pk, c]) => ({ pubkey: pk, count: c }))}
                    selected={columnFilters.authors}
                    onChange={v => setColumnFilters(f => ({ ...f, authors: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, authors: [] }))}
                    profiles={profiles}
                  />
                )}
              </ResizableFilterableHeader>
              <ResizableFilterableHeader label={wotEnabled ? "WoT" : ""} active={(columnFilters.wotTiers?.length || 0) > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={4} onResizeStart={evtResizeStart}>
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
              <ResizableFilterableHeader label="Score" active={(columnFilters.scoreTiers?.length || 0) > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={5} onResizeStart={evtResizeStart}>
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
              <ResizableFilterableHeader label="Engagement" active={columnFilters.engagement.length > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]" colIndex={6} onResizeStart={evtResizeStart}>
                {() => (
                  <ProfileFilterContent
                    label="Filter by Target"
                    options={evtOptionStats.uniqueEngagement.map(([pk, c]) => ({ pubkey: pk, count: c }))}
                    selected={columnFilters.engagement}
                    onChange={v => setColumnFilters(f => ({ ...f, engagement: v }))}
                    onClear={() => setColumnFilters(f => ({ ...f, engagement: [] }))}
                    profiles={profiles}
                    showNoneOption
                    noneCount={evtOptionStats.noEngagementCount}
                  />
                )}
              </ResizableFilterableHeader>
              <FilterableHeader label="Content" active={columnFilters.contentSearch !== "" || (columnFilters.contentTypes?.length || 0) > 0} borderClass="px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                {() => (
                  <ContentFilterContent
                    value={columnFilters.contentSearch}
                    onChange={v => setColumnFilters(f => ({ ...f, contentSearch: v }))}
                    contentTypes={columnFilters.contentTypes || []}
                    onContentTypesChange={v => setColumnFilters(f => ({ ...f, contentTypes: v }))}
                    typeCounts={evtOptionStats.contentTypeCounts}
                  />
                )}
              </FilterableHeader>
              <span></span>
            </div>
            <div className="space-y-1">
              {evtFilteredResults.map((event) => (
                <Card
                  key={event.id}
                  className="glass-card border-brand/20 dark:border-brand/10 cursor-pointer hover:border-brand/25 transition-colors overflow-hidden"
                  onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                  data-testid="ops-event-row"
                  data-kind={event.kind}
                >
                  <div className="hidden md:grid gap-x-0 items-center px-3 py-2 min-w-0" style={gridTemplateStyle(evtColWidths, true)}>
                    <span className="text-[10px] text-muted-foreground/70 font-mono truncate pr-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      {formatTimestamp(event.created_at)}
                    </span>
                    <span className="flex items-center justify-center px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      {eventSources.get(event.id) ? (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${relaySourceClasses(eventSources.get(event.id)!)}`}>
                          {relaySourceLabel(eventSources.get(event.id)!)}
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
                      <WotBadge pubkey={event.pubkey} observerPubkey={pubkey} event={event} getAuthorTier={getAuthorTier} isAuthorFlagged={isAuthorFlagged} />
                    </span>
                    <span className="min-w-0 overflow-hidden flex items-center px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <ScoreBadge eventId={getScoreEventId(event)} statsMap={evtStatsMap} />
                    </span>
                    <span className="min-w-0 overflow-hidden px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <EngagementTarget event={event} profiles={profiles} />
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 truncate min-w-0 px-2 border-r border-black/[0.06] dark:border-white/[0.04]">
                      <ContentPreviewText content={event.content} kind={event.kind} tags={event.tags} />
                    </span>
                    <span className="flex items-center justify-center gap-0.5 pl-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-amber-600 dark:text-amber-400/70 hover:text-amber-800 dark:hover:text-amber-400"
                        title="Block author"
                        onClick={(e) => { e.stopPropagation(); setPendingBlock(event.pubkey); }}
                      >
                        <UserX className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-red-600 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-400"
                        title="Delete event"
                        onClick={(e) => { e.stopPropagation(); requestDeletion(event.id); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </span>
                  </div>
                  <div className="md:hidden px-3 py-2.5 space-y-2 active:bg-black/[0.02] dark:active:bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
                        {formatTimestamp(event.created_at)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {eventSources.get(event.id) && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${relaySourceClasses(eventSources.get(event.id)!)}`}>
                            {relaySourceLabel(eventSources.get(event.id)!)}
                          </Badge>
                        )}
                        <Badge variant="outline" className={`text-[10px] ${getKindBadgeClasses(event.kind, event.tags)}`}>
                          {getKindLabel(event.kind, event.tags)}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-amber-600 dark:text-amber-400/70 active:text-amber-800 dark:active:text-amber-400 active:bg-amber-500/10"
                          title="Block author"
                          onClick={(e) => { e.stopPropagation(); setPendingBlock(event.pubkey); }}
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-600 dark:text-red-400/70 active:text-red-700 dark:active:text-red-400 active:bg-red-500/10"
                          title="Delete event"
                          onClick={(e) => { e.stopPropagation(); requestDeletion(event.id); }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="min-w-0 flex-1">
                        <ProfileName pubkey={event.pubkey} profiles={profiles} showCopy />
                      </span>
                      <WotBadge pubkey={event.pubkey} observerPubkey={pubkey} event={event} getAuthorTier={getAuthorTier} isAuthorFlagged={isAuthorFlagged} />
                      <ScoreBadge eventId={getScoreEventId(event)} statsMap={evtStatsMap} />
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
                        <ScoreBadge eventId={getScoreEventId(event)} statsMap={evtStatsMap} />
                        <button
                          onClick={(e) => { e.stopPropagation(); setFeatureEvent(event); }}
                          className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors text-muted-foreground/70 hover:text-brand hover:bg-brand/10 ml-auto flex items-center gap-1"
                          data-testid={`button-event-feature-${event.id.slice(0, 8)}`}
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
          </div>
        </div>
      )}

      {results.length === 0 && !searching && (
        <Card className="glass-card border-brand/25 dark:border-brand/15 p-6">
          <div className="flex flex-col items-center text-center gap-2">
            {live ? <Radio className="w-6 h-6 text-emerald-500/70 animate-pulse" /> : <Search className="w-6 h-6 text-muted-foreground/50" />}
            <p className="text-xs text-muted-foreground/70">
              {live ? "Open on the relay — new events will appear here." : submitted || windowActive ? "Nothing matches. Try fewer words, or a wider time window." : "Nothing stored on this relay yet."}
            </p>
          </div>
        </Card>
      )}

      <AlertDialog open={!!pendingBlock} onOpenChange={(open) => { if (!open) setPendingBlock(null); }}>
        <AlertDialogContent className="glass-dialog-card border-brand/15">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <UserX className="w-4 h-4 text-amber-500" />
              Block Author
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-xs">
              <span className="block">This will add the author to your relay's blocklist. They will no longer be able to publish events to this relay.</span>
              {pendingBlock && (
                <span className="flex items-center gap-2 rounded-md bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.06] px-2.5 py-2">
                  <Avatar className="w-6 h-6 shrink-0">
                    {profiles.get(pendingBlock)?.picture ? <AvatarImage src={profiles.get(pendingBlock)!.picture!} /> : null}
                    <AvatarFallback className="bg-brand/20 text-brand text-[10px]">
                      <User className="w-3 h-3" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 min-w-0">
                    <span className="text-[11px] text-foreground block truncate">
                      {profiles.get(pendingBlock)?.name || `${pubkeyToNpub(pendingBlock).slice(0, 20)}...${pubkeyToNpub(pendingBlock).slice(-6)}`}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 block truncate font-mono">
                      {pubkeyToNpub(pendingBlock).slice(0, 24)}...
                    </span>
                  </span>
                </span>
              )}
              <span className="block text-muted-foreground/60">You can remove them from the blocklist later in the Access Control tab.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBlockAuthor}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8"
            >
              <UserX className="w-3 h-3 mr-1" />
              Block Author
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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


type AccessLevel = "allow" | "readonly" | "block";

function PubkeyRow({ hex, type, profile, onRemove }: {
  hex: string; type: AccessLevel; profile?: ProfileInfo; onRemove: (hex: string, type: AccessLevel) => void;
}) {
  const npub = pubkeyToNpub(hex);
  const [copied, setCopied] = useState(false);
  const copyNpub = useCallback(() => {
    copyNostrId(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [npub]);
  return (
    <div className="flex items-center gap-2 sm:gap-2 rounded-md bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.08] dark:border-white/[0.06] px-2.5 sm:px-2 py-2.5 sm:py-1.5">
      <Avatar className="w-8 h-8 sm:w-6 sm:h-6 shrink-0">
        {profile?.picture ? <AvatarImage src={profile.picture} alt={profile.name || ""} /> : null}
        <AvatarFallback className="bg-brand/20 text-brand text-[10px]">
          <User className="w-3 h-3" />
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <span className="text-xs sm:text-[11px] text-foreground block truncate">
          {profile?.name || `${npub.slice(0, 16)}...${npub.slice(-6)}`}
        </span>
        {profile?.nip05 && <span className="text-[10px] sm:text-[10px] text-muted-foreground/70 truncate block">{profile.nip05}</span>}
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-5 sm:w-5 shrink-0 text-muted-foreground/60 hover:text-muted-foreground" onClick={copyNpub} title="Copy npub">
        {copied ? <Check className="w-3 h-3 sm:w-2.5 sm:h-2.5 text-green-800 dark:text-green-400" /> : <Copy className="w-3 h-3 sm:w-2.5 sm:h-2.5" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-5 sm:w-5 shrink-0 text-red-600 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-400" onClick={() => onRemove(hex, type)}>
        <X className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
      </Button>
    </div>
  );
}

function PubkeySearchInput({ type, inputValue, setInput, buttonLabel, buttonClass, onAddDirect, onAdd, onProfileFound }: {
  type: AccessLevel; inputValue: string; setInput: (v: string) => void;
  buttonLabel: string; buttonClass?: string;
  onAddDirect: (type: AccessLevel, rawInput: string) => void;
  onAdd: (type: AccessLevel) => void;
  onProfileFound?: (hex: string, profile: ProfileInfo) => void;
}) {
  const [searchResults, setSearchResults] = useState<NostrEvent[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!showResults || !inputAreaRef.current) return;
    const rect = inputAreaRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const dropUp = spaceBelow < 260 && rect.top > spaceBelow;
    setDropdownStyle({
      position: "fixed" as const,
      left: rect.left,
      width: rect.width,
      ...(dropUp
        ? { bottom: viewportH - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      zIndex: 9999,
    });
  }, [showResults, searchResults]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showResults) return;
    const handleScroll = () => {
      if (!inputAreaRef.current) return;
      const rect = inputAreaRef.current.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const spaceBelow = viewportH - rect.bottom;
      const dropUp = spaceBelow < 260 && rect.top > spaceBelow;
      setDropdownStyle(prev => ({
        ...prev,
        left: rect.left,
        width: rect.width,
        ...(dropUp
          ? { bottom: viewportH - rect.top + 4, top: undefined }
          : { top: rect.bottom + 4, bottom: undefined }),
      }));
    };
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [showResults]);

  const handleChange = useCallback((value: string) => {
    setInput(value);
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("npub") || /^[0-9a-f]{10,}$/i.test(trimmed)) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cached = searchCachedProfiles(trimmed, 5);
      if (cached.length > 0) {
        setSearchResults(cached);
        setShowResults(true);
      }
      setSearching(true);
      try {
        const remote = await searchUsers(trimmed, 6);
        const seen = new Set<string>();
        const merged: NostrEvent[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) {
            seen.add(e.pubkey);
            merged.push(e);
          }
        }
        setSearchResults(merged.slice(0, 6));
        if (merged.length > 0) setShowResults(true);
      } catch {}
      setSearching(false);
    }, 300);
  }, [setInput]);

  const selectProfile = useCallback((pubkey: string) => {
    const event = searchResults.find(e => e.pubkey === pubkey);
    if (event && onProfileFound) {
      try {
        const p = JSON.parse(event.content);
        onProfileFound(pubkey, {
          name: p.display_name || p.name,
          picture: p.picture,
          nip05: p.nip05,
        });
      } catch {}
    }
    setShowResults(false);
    setSearchResults([]);
    setInput("");
    onAddDirect(type, pubkey);
  }, [type, setInput, onAddDirect, searchResults, onProfileFound]);

  const dropdown = showResults && searchResults.length > 0 ? createPortal(
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="rounded-lg overflow-hidden shadow-2xl border border-border/40 max-h-[240px] overflow-y-auto bg-popover backdrop-blur-xl"
    >
      {searchResults.map((event) => {
        let content: Record<string, string> = {};
        try { content = JSON.parse(event.content); } catch {}
        const name = content.display_name || content.name || "";
        const picture = content.picture || "";
        const nip05 = content.nip05 || "";
        return (
          <div
            key={event.pubkey}
            className="flex items-center gap-2.5 sm:gap-2.5 px-3 py-3 sm:py-2 cursor-pointer transition-colors hover:bg-brand/10 active:bg-brand/20"
            onClick={() => selectProfile(event.pubkey)}
          >
            <Avatar className="w-8 h-8 sm:w-6 sm:h-6 shrink-0">
              {picture ? <AvatarImage src={picture} alt={name} /> : null}
              <AvatarFallback className="bg-brand/20 text-brand text-[10px]">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-sm sm:text-xs font-medium text-foreground/90 truncate">
                {name || `${event.pubkey.slice(0, 12)}...`}
              </div>
              {nip05 && <div className="text-xs sm:text-[10px] text-muted-foreground/70 truncate">{nip05}</div>}
            </div>
          </div>
        );
      })}
      <div className="px-3 py-1.5 sm:py-1 text-[10px] sm:text-[10px] text-muted-foreground/50 text-center">
        {searching ? "Searching..." : "Select a profile"}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef}>
      <div className="flex gap-2 mb-3" ref={inputAreaRef}>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60 pointer-events-none" />
          <Input
            placeholder="Search name, npub, or hex pubkey"
            value={inputValue}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            className="flex-1 h-9 sm:h-7 text-sm sm:text-xs pl-7"
            onKeyDown={(e) => e.key === "Enter" && onAdd(type)}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
          />
          {searching && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <RelayOutpostInlineLoader className="w-3 h-3 text-brand" />
            </div>
          )}
        </div>
        <Button size="sm" className={`h-9 sm:h-7 text-sm sm:text-xs shrink-0 ${buttonClass || ""}`} onClick={() => onAdd(type)}>
          <Plus className="w-3 h-3 mr-0.5" />{buttonLabel}
        </Button>
      </div>
      {dropdown}
    </div>
  );
}

function PubkeyListSection({ type, icon, label, labelClass, description, borderClass, badgeClass, list, inputValue, setInput, buttonLabel, buttonClass, profileCache, onRemove, onAddDirect, onAdd, onExport, onImport, onProfileFound }: {
  type: AccessLevel; icon: React.ReactNode; label: string; labelClass: string; description: string;
  borderClass: string; badgeClass: string;
  list: string[]; inputValue: string; setInput: (v: string) => void;
  buttonLabel: string; buttonClass?: string;
  profileCache: Record<string, ProfileInfo>;
  onRemove: (hex: string, type: AccessLevel) => void;
  onAddDirect: (type: AccessLevel, rawInput: string) => void;
  onAdd: (type: AccessLevel) => void;
  onExport: (type: AccessLevel) => void;
  onImport: (type: AccessLevel) => void;
  onProfileFound?: (hex: string, profile: ProfileInfo) => void;
}) {
  return (
    <OpsCard className={`${borderClass} overflow-visible`}>
      <OpsSectionHeader
        icon={icon}
        label={label}
        labelClassName={labelClass}
        action={
          <>
            <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => onExport(type)} title="Export" aria-label={`Export ${label}`}>
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => onImport(type)} title="Import" aria-label={`Import ${label}`}>
              <Upload className="w-3.5 h-3.5" />
            </Button>
          </>
        }
      >
        <Badge variant="outline" className={`text-[10px] ${badgeClass}`}>{list.length}</Badge>
      </OpsSectionHeader>
      <p className="text-[10px] text-muted-foreground/60 mb-2">{description}</p>
      <PubkeySearchInput
        type={type}
        inputValue={inputValue}
        setInput={setInput}
        buttonLabel={buttonLabel}
        buttonClass={buttonClass}
        onAddDirect={onAddDirect}
        onAdd={onAdd}
        onProfileFound={onProfileFound}
      />
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {list.length === 0 ? (
          <p className="text-[10px] text-muted-foreground/60 text-center py-3">No entries.</p>
        ) : list.map(hex => <PubkeyRow key={hex} hex={hex} type={type} profile={profileCache[hex]} onRemove={onRemove} />)}
      </div>
    </OpsCard>
  );
}

