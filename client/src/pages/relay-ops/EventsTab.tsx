import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { createPortal } from "react-dom";
import { nip19 } from "nostr-tools";
import type { Event as NostrEvent } from "nostr-tools";
import { pool, searchCachedProfiles } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { type SignalTier } from "@/lib/graperank";
import { computeEngagementScore } from "@/lib/engagement";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { usePrimalStatsBatch } from "@/hooks/use-primal-stats";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { Card } from "@/components/ui/card";
import { OpsCard, OpsSectionHeader } from "./ops-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Globe,
  Copy,
  Check,
  Search,
  Trash2,
  UserX,
  Plus,
  Download,
  Upload,
  Clock,
  FileText,
  Filter,
  X,
  User,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import {
  NostrFilter,
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

export function EventsTab({ relayUrl }: { relayUrl: string }) {
  const [, navigate] = useLocation();
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [searchKind, setSearchKind] = useState("");
  const [searchAuthor, setSearchAuthor] = useState("");
  const [searchSince, setSearchSince] = useState("");
  const [searchUntil, setSearchUntil] = useState("");
  const [searchContent, setSearchContent] = useState("");
  const [searchEventId, setSearchEventId] = useState("");
  const [timePreset, setTimePreset] = useState<string>("none");
  const [showCustomTime, setShowCustomTime] = useState(false);
  const [results, setResults] = useState<NostrEvent[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<"rendered" | "raw">("rendered");
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [eventsSourceFilter, setEventsSourceFilter] = useState<string>("all");
  const [eventSources, setEventSources] = useState<Map<string, RelaySource>>(new Map());
  const [pendingBlock, setPendingBlock] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const { widths: evtColWidths, onResizeStart: evtResizeStart } = useColumnWidths(EVT_DEFAULT_WIDTHS);
  const { getAuthorTier, isAuthorFlagged, wotEnabled } = useGrapeRankScores();
  const getEffectiveTier = useCallback((pk: string): SignalTier => isAuthorFlagged(pk) ? "flagged" : getAuthorTier(pk), [getAuthorTier, isAuthorFlagged]);

  const applyTimePreset = useCallback((preset: string) => {
    setTimePreset(preset);
    if (preset === "none") {
      setSearchSince("");
      setSearchUntil("");
      setShowCustomTime(false);
      return;
    }
    if (preset === "custom") {
      setShowCustomTime(true);
      return;
    }
    setShowCustomTime(false);
    const now = new Date();
    const presetMs: Record<string, number> = {
      "1h": 3600000,
      "6h": 21600000,
      "24h": 86400000,
      "7d": 604800000,
      "30d": 2592000000,
    };
    if (presetMs[preset]) {
      const since = new Date(now.getTime() - presetMs[preset]);
      const pad = (n: number) => String(n).padStart(2, "0");
      const localStr = `${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}T${pad(since.getHours())}:${pad(since.getMinutes())}`;
      setSearchSince(localStr);
      setSearchUntil("");
    }
  }, []);

  const handleSearch = useCallback(async () => {
    setSearching(true);
    setResults([]);
    const filter: NostrFilter = { limit: 100 };

    const eventIdRaw = searchEventId.trim();
    if (eventIdRaw) {
      let hexId: string | null = null;
      if (/^[0-9a-fA-F]{64}$/.test(eventIdRaw)) {
        hexId = eventIdRaw.toLowerCase();
      } else {
        try {
          const decoded = nip19.decode(eventIdRaw);
          if (decoded.type === "note") hexId = decoded.data as string;
          else if (decoded.type === "nevent") hexId = (decoded.data as { id: string }).id;
        } catch {}
      }
      if (!hexId) {
        toast({ title: "Invalid event ID", description: "Enter a 64-character hex id, note1…, or nevent1… reference.", variant: "destructive" });
        setSearching(false);
        return;
      }
      filter.ids = [hexId];
      delete filter.limit;
    } else {
      if (searchKind) filter.kinds = [Number(searchKind)];
      if (searchAuthor) {
        const hex = npubToHex(searchAuthor);
        if (hex) filter.authors = [hex];
        else {
          toast({ title: "Invalid author", description: "Enter a valid npub or hex pubkey.", variant: "destructive" });
          setSearching(false);
          return;
        }
      }
    }
    if (searchSince) {
      const d = new Date(searchSince);
      if (!isNaN(d.getTime())) filter.since = Math.floor(d.getTime() / 1000);
    }
    if (searchUntil) {
      const d = new Date(searchUntil);
      if (!isNaN(d.getTime())) filter.until = Math.floor(d.getTime() / 1000);
    }
    if (filter.since && filter.until && filter.since > filter.until) {
      toast({ title: "Invalid range", description: "Start time must be before end time.", variant: "destructive" });
      setSearching(false);
      return;
    }

    const collected = await subscribeWithTimeout([relayUrl], [filter], 6000);
    let filtered = collected;
    if (searchContent) {
      const lowerQuery = searchContent.toLowerCase();
      filtered = collected.filter(e => e.content.toLowerCase().includes(lowerQuery));
    }
    const sorted = filtered.sort((a, b) => b.created_at - a.created_at);
    setResults(sorted);
    setSearching(false);
    const pubkeys = new Set(sorted.map(e => e.pubkey));
    for (const e of sorted) {
      if ((e.kind === 6 || e.kind === 16) && e.content) {
        const innerEvent = tryParseRepostInner(e.content);
        if (innerEvent?.pubkey) pubkeys.add(innerEvent.pubkey);
      }
      const engTarget = getEngagementTarget(e);
      if (engTarget) pubkeys.add(engTarget);
    }
    if (pubkeys.size > 0) {
      resolveProfileBatch([...pubkeys]).then(setProfiles);
    }
    const ids = sorted.map((e) => e.id);
    const { type: currentType, oppositeUrls } = getOppositeRelays(relayUrl);
    if (oppositeUrls.length === 0) {
      const src: RelaySource = currentType === "private" ? "private" : "public";
      setEventSources(new Map(ids.map((id) => [id, src])));
    } else {
      const found = await checkEventPresenceOnRelays(ids, oppositeUrls);
      const sources = new Map<string, RelaySource>();
      for (const id of ids) {
        sources.set(id, determineRelaySource(currentType, found.has(id)));
      }
      setEventSources(sources);
    }
  }, [relayUrl, searchKind, searchAuthor, searchSince, searchUntil, searchContent, searchEventId, toast]);

  const prevRelayUrl = useRef(relayUrl);
  useEffect(() => {
    if (prevRelayUrl.current !== relayUrl) {
      prevRelayUrl.current = relayUrl;
      setResults([]);
    }
    handleSearch();
  }, [relayUrl]);

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
      toast({ title: "Deletion requested", description: `Kind 5 event published for ${eventId.slice(0, 8)}...` });
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

  const confirmBlockAuthor = useCallback(() => {
    if (!pendingBlock) return;
    const blocklist = getStoredList(ADMIN_BLOCKLIST_KEY, relayUrl);
    if (blocklist.includes(pendingBlock)) {
      toast({ title: "Already blocked", description: `${pendingBlock.slice(0, 8)}... is already on the blocklist.` });
      setPendingBlock(null);
      return;
    }
    const updated = [...blocklist, pendingBlock];
    saveStoredList(ADMIN_BLOCKLIST_KEY, relayUrl, updated);
    addModLogEntry(relayUrl, { action: "block_author", targetPubkey: pendingBlock });
    toast({ title: "Author blocked", description: `${pendingBlock.slice(0, 8)}... added to blocklist.` });
    setPendingBlock(null);
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
    searchKind: searchKind,
    searchAuthor: searchAuthor,
    searchContent: searchContent,
    searchSince: searchSince,
    searchUntil: searchUntil,
    timePreset: timePreset,
    searchEventId: searchEventId,
  }), [eventsSourceFilter, searchKind, searchAuthor, searchContent, searchSince, searchUntil, timePreset, searchEventId]);
  const handleSearchRef = useRef(handleSearch);
  handleSearchRef.current = handleSearch;
  const pendingSearchRef = useRef(false);
  const handleEvtLoadView = useCallback((f: ColumnFilters, t?: SavedToolbarState) => {
    setColumnFilters({ ...EMPTY_COLUMN_FILTERS, ...f, wotTiers: f?.wotTiers ?? [], scoreTiers: f?.scoreTiers ?? [] });
    if (t) {
      if (t.sourceFilter !== undefined) setEventsSourceFilter(t.sourceFilter);
      if (t.searchKind !== undefined) setSearchKind(t.searchKind);
      if (t.searchAuthor !== undefined) setSearchAuthor(t.searchAuthor);
      if (t.searchContent !== undefined) setSearchContent(t.searchContent);
      if (t.searchSince !== undefined) setSearchSince(t.searchSince);
      if (t.searchUntil !== undefined) setSearchUntil(t.searchUntil);
      if (t.timePreset !== undefined) { setTimePreset(t.timePreset); applyTimePreset(t.timePreset); }
      if (t.searchEventId !== undefined) setSearchEventId(t.searchEventId);
    }
    pendingSearchRef.current = true;
  }, [applyTimePreset]);

  useEffect(() => {
    if (pendingSearchRef.current) {
      pendingSearchRef.current = false;
      handleSearchRef.current();
    }
  });

  return (
    <div className="space-y-4">
      <OpsCard>
        <OpsSectionHeader
          icon={Search}
          label="Search Events"
          action={
            <Button size="sm" onClick={handleSearch} disabled={searching} className="h-8 text-xs px-3">
              <Search className={`w-3 h-3 mr-1 ${searching ? "animate-pulse" : ""}`} />
              {searching ? "Searching..." : "Search"}
            </Button>
          }
        />

        <div className="mb-2">
          <Input
            placeholder="Event ID (hex, note1…, or nevent1…) — overrides other filters"
            value={searchEventId}
            onChange={(e) => setSearchEventId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            className="h-9 sm:h-8 text-xs font-mono"
          />
          {searchEventId.trim() && (
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Looking up by event ID — kind, author, content and time filters are ignored.
            </p>
          )}
        </div>
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 transition-opacity ${searchEventId.trim() ? "opacity-40 pointer-events-none" : ""}`}>
          <KindFilterSelect
            value={searchKind || "all"}
            onChange={(v) => setSearchKind(v === "all" ? "" : v)}
            className="[&_input]:h-9 [&_input]:sm:h-8 [&_input]:text-xs"
          />
          <AuthorSearchFilter
            value={searchAuthor}
            onChange={setSearchAuthor}
            className="[&_input]:h-9 [&_input]:sm:h-8 [&_input]:text-xs"
            placeholder="Author (name, npub, or hex)"
          />
          <Input
            placeholder="Content contains..."
            value={searchContent}
            onChange={(e) => setSearchContent(e.target.value)}
            className="h-9 sm:h-8 text-xs"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-muted-foreground/70 shrink-0" />
            <span className="text-[10px] text-muted-foreground/70 shrink-0">Time Range</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "none", label: "All Time" },
              { value: "1h", label: "1 Hour" },
              { value: "6h", label: "6 Hours" },
              { value: "24h", label: "24 Hours" },
              { value: "7d", label: "7 Days" },
              { value: "30d", label: "30 Days" },
              { value: "custom", label: "Custom" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => applyTimePreset(opt.value)}
                className={`h-8 sm:h-7 px-3 sm:px-2.5 rounded-md text-[11px] sm:text-[10px] font-medium transition-all ${
                  timePreset === opt.value
                    ? "bg-brand/20 text-brand border border-brand/30 shadow-[0_0_8px_rgba(168,85,247,0.15)]"
                    : "bg-black/[0.04] dark:bg-white/[0.03] text-muted-foreground/60 border border-black/[0.08] dark:border-white/[0.06] hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:text-muted-foreground/80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {showCustomTime && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground/60 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />Start
                </span>
                <input
                  type="datetime-local"
                  value={searchSince}
                  onChange={(e) => setSearchSince(e.target.value)}
                  className="w-full h-11 sm:h-9 px-3 rounded-md border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.04] dark:bg-white/[0.03] text-sm sm:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/30 transition-colors dark:[color-scheme:dark]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground/60 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />End
                </span>
                <input
                  type="datetime-local"
                  value={searchUntil}
                  onChange={(e) => setSearchUntil(e.target.value)}
                  className="w-full h-11 sm:h-9 px-3 rounded-md border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.04] dark:bg-white/[0.03] text-sm sm:text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/30 transition-colors dark:[color-scheme:dark]"
                />
              </label>
            </div>
          )}
        </div>
      </OpsCard>

      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1 min-h-[32px]">
            <span className="text-xs text-muted-foreground/70 whitespace-nowrap shrink-0">{evtFilteredResults.length} of {results.length}</span>
            <Select value={eventsSourceFilter} onValueChange={setEventsSourceFilter}>
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
                    className="ml-auto h-7 px-2.5 text-[11px] gap-1.5 text-red-600 dark:text-red-400/80 hover:text-red-500 dark:hover:text-red-300 hover:bg-red-500/10 dark:hover:bg-red-500/15 border border-transparent hover:border-red-500/20 dark:hover:border-red-400/20 shrink-0"
                    data-testid="button-bulk-delete-trigger"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span className="hidden sm:inline">Bulk delete</span>
                    <span className="sm:hidden">Delete</span>
                    <span className="text-[10px] font-mono text-muted-foreground/60 dark:text-muted-foreground/50">
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
                          onClick={(e) => { e.stopPropagation(); navigate(`/thread/${nip19.noteEncode(getScoreEventId(event))}`); }}
                          className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors text-muted-foreground/70 hover:text-brand hover:bg-brand/10 ml-auto flex items-center gap-1"
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
            <FileText className="w-6 h-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground/70">Search for events by kind, author, content, or time range.</p>
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

