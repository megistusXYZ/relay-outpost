/**
 * Relays › Content — everything on the relay, findable and actionable
 * (owner, 2026-10-03: "fetch all content, search through what it is they
 * want, curate, find and delete any type of kind event nip user").
 *
 * Desktop: the list and, beside it, the post you picked with what you can do
 * to it. Phone: the list; a post opens over it. One search field reads what
 * you type (words, an npub, kind:N, an event id); type views narrow by what
 * things ARE. Select turns on checkboxes and an action bar. Removing many, or
 * by a whole search, asks for a reason; a big batch asks you to type the
 * count. Every action is one the relay itself carries out (NIP-86) — none is
 * offered when the relay can't do it. The list says how much it searched.
 *
 * Rules live in content-model.ts; relay calls in lib/nip86.ts and
 * lib/relay-moderation.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event as NostrEvent, Filter as RelayFilter } from "nostr-tools";
import {
  ArrowDown, ArrowUp, Ban, ChevronLeft, Copy, Download, Keyboard, MessageSquare,
  Pause, Play, Search, SlidersHorizontal, Trash2, Undo2, X,
} from "lucide-react";
import { pool } from "@/lib/nostr";
import { getAuthStatus, onAuthChange } from "@/lib/nip42-auth";
import { supportsNip, type Nip11Document } from "@/lib/nip11";
import {
  banPubkey, fetchRelayCapabilities, listRemovedEvents, removeEventByAction, restoreEvent, type RemovedEntry,
} from "@/lib/nip86";
import { canDo, managedAt, UNKNOWN_CAPABILITIES, type RelayCapabilities } from "@/lib/relay-capabilities";
import { runBatch } from "@/lib/relay-moderation";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { AddToFeaturedDialog } from "@/components/AddToFeaturedDialog";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import { ManagedAtNote } from "./ops-ui";
import {
  ADMIN_BLOCKLIST_KEY, addModLogEntry, getStoredList, pubkeyToNpub, resolveProfileBatch, saveStoredList,
  subscribeWithReach, type NostrFilter, type ProfileInfo,
} from "./shared";
import { parseEventQuery, TIME_RANGES, type RangeId, type TimeWindow } from "./event-query";
import {
  confirmPhrase, contentFilter, countByType, exportable, isPrivateKind, mergePage, reasonRequired, removalReason,
  REMOVAL_REASONS, rowPreview, scopeLine, sortEvents, toCsv, typeOf, TYPE_VIEWS, typeWord, typedConfirmRequired,
  type SortDir, type SortKey, type TypeViewId,
} from "./content-model";

const PAGE = 200;
const LIVE_CAP = 500;
/** "Select all matching" pages back this far, at most, then says it stopped. */
const RULE_CAP = 2000;

function localToSec(s: string): number | undefined {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(min-width: 1024px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

function relTime(sec: number, nowSec: number): string {
  const d = nowSec - sec;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d`;
  return new Date(sec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

type PendingAction =
  | { kind: "remove"; ids: string[]; rule: boolean }
  | { kind: "ban"; pubkeys: string[]; rule: boolean };

export function ContentTab({ relayUrl, nip11, initialLive = false }: { relayUrl: string; nip11: Nip11Document | null; initialLive?: boolean }) {
  const { toast } = useToast();
  const wide = useWide();
  const relayName = nip11?.name?.trim() || relayUrl.replace(/^wss?:\/\//, "");
  const relaySearches = !!nip11 && supportsNip(nip11, 50);

  // ---- what the relay lets us do ----
  const [caps, setCaps] = useState<RelayCapabilities>(UNKNOWN_CAPABILITIES);
  useEffect(() => {
    let off = false;
    setCaps(UNKNOWN_CAPABILITIES);
    fetchRelayCapabilities(relayUrl).then((c) => { if (!off) setCaps(c); });
    return () => { off = true; };
  }, [relayUrl]);
  const speaks86 = !!nip11 && supportsNip(nip11, 86);
  const canRemove = speaks86 && canDo(caps, "removeEvent");
  const canBan = speaks86 && canDo(caps, "ban");
  const canSeeRemoved = canDo(caps, "listRemoved");
  const canRestore = canDo(caps, "restoreEvent");
  const where = managedAt(relayUrl);

  // ---- the question ----
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [view, setView] = useState<TypeViewId | "removed">("all");
  const [range, setRange] = useState<RangeId | "custom">("any");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "time", dir: "desc" });
  const parsed = useMemo(() => parseEventQuery(submitted), [submitted]);
  const window_ = useMemo<TimeWindow>(
    () => range === "custom" ? { range, since: localToSec(customSince), until: localToSec(customUntil) } : { range },
    [range, customSince, customUntil],
  );
  const typeView: TypeViewId = view === "removed" ? "all" : view;
  const askRelayToSearch = relaySearches && !!parsed.text;
  const matches = useCallback((e: NostrEvent) => {
    if (typeView === "other" && typeOf(e.kind) !== "other") return false;
    if (parsed.kind === undefined && typeView !== "all" && typeOf(e.kind) !== typeView) return false;
    if (parsed.text && !askRelayToSearch) {
      if (isPrivateKind(e.kind)) return false;
      if (!e.content.toLowerCase().includes(parsed.text.toLowerCase())) return false;
    }
    return true;
  }, [typeView, parsed.kind, parsed.text, askRelayToSearch]);
  const filterFor = useCallback((until?: number) => contentFilter(parsed, window_, typeView, Math.floor(Date.now() / 1000), {
    search: askRelayToSearch, limit: PAGE, until,
  }), [parsed, window_, typeView, askRelayToSearch]);

  // ---- the answer ----
  const [results, setResults] = useState<NostrEvent[]>([]);
  const [reached, setReached] = useState(true);
  const [searching, setSearching] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [live, setLive] = useState(initialLive);
  const [paused, setPaused] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const nameOf = useCallback((pk: string) => profiles.get(pk)?.name, [profiles]);

  const knownProfiles = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = [...new Set(results.map((e) => e.pubkey))].filter((pk) => !knownProfiles.current.has(pk));
    if (!fresh.length) return;
    fresh.forEach((pk) => knownProfiles.current.add(pk));
    resolveProfileBatch(fresh).then((m) => {
      if (m.size) setProfiles((prev) => { const next = new Map(prev); m.forEach((v, k) => next.set(k, v)); return next; });
    }).catch(() => {});
  }, [results]);

  const runSearch = useCallback(async () => {
    if (window_.range === "custom" && window_.since && window_.until && window_.since > window_.until) {
      toast({ title: "Start is after end", description: "Pick a start time before the end time.", variant: "destructive" });
      return;
    }
    setSearching(true);
    setExhausted(false);
    const res = await subscribeWithReach([relayUrl], [filterFor() as NostrFilter], 6000);
    setReached(res.reached);
    setResults(res.events.filter(matches).sort((a, b) => b.created_at - a.created_at));
    setExhausted(res.reached && res.events.length === 0);
    setSearching(false);
  }, [relayUrl, filterFor, matches, window_, toast]);
  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;
  useEffect(() => {
    if (live || view === "removed") return;
    void runSearchRef.current();
  }, [live, relayUrl, submitted, window_, view]);

  /** One more page, older than what's loaded. Returns how many new came back. */
  const loadOlder = useCallback(async (from: NostrEvent[]): Promise<{ events: NostrEvent[]; added: number }> => {
    const oldest = from.length ? from[from.length - 1].created_at : undefined;
    const res = await subscribeWithReach([relayUrl], [filterFor(oldest) as NostrFilter], 6000);
    if (!res.reached) setReached(false);
    return mergePage(from, res.events.filter(matches));
  }, [relayUrl, filterFor, matches]);
  const searchFurther = useCallback(async () => {
    setLoadingMore(true);
    const r = await loadOlder(results);
    setResults(r.events);
    if (r.added === 0) setExhausted(true);
    setLoadingMore(false);
  }, [loadOlder, results]);

  // Live: the same question, left open — new posts arrive at the top.
  const pausedRef = useRef(false);
  const heldRef = useRef<NostrEvent[]>([]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const mergeLive = useCallback((incoming: NostrEvent[]) => {
    if (!incoming.length) return;
    setResults((prev) => mergePage(incoming, prev).events.slice(0, LIVE_CAP));
  }, []);
  useEffect(() => {
    if (!live || view === "removed") return;
    let cancelled = false;
    let sub: { close: () => void } | null = null;
    setResults([]);
    setExhausted(false);
    heldRef.current = [];
    setHeldCount(0);
    const filter = filterFor();
    const start = () => {
      if (cancelled) return;
      sub = pool.subscribeMany([relayUrl], filter as RelayFilter, {
        onevent(event: NostrEvent) {
          if (cancelled || !matches(event)) return;
          if (pausedRef.current) { heldRef.current.push(event); setHeldCount(heldRef.current.length); return; }
          mergeLive([event]);
        },
      });
    };
    const ready = (s: string) => s === "authenticated" || s === "failed" || s === "none";
    pool.ensureRelay(relayUrl)
      .then(() => {
        if (cancelled) return;
        setReached(true);
        setTimeout(() => {
          if (ready(getAuthStatus(relayUrl).status)) { start(); return; }
          const unsub = onAuthChange(() => { if (ready(getAuthStatus(relayUrl).status)) { unsub(); start(); } });
        }, 300);
      })
      .catch(() => { if (!cancelled) { setReached(false); start(); } });
    return () => { cancelled = true; sub?.close(); };
  }, [live, view, relayUrl, filterFor, matches, mergeLive]);
  const resume = useCallback(() => {
    setPaused(false);
    const held = heldRef.current;
    heldRef.current = [];
    setHeldCount(0);
    mergeLive(held);
  }, [mergeLive]);

  // ---- what's shown ----
  const counts = useMemo(() => countByType(results), [results]);
  // The chips come from what "All" found, so picking one view doesn't make the
  // others vanish (each view loads only its own kinds).
  const [allCounts, setAllCounts] = useState<Record<TypeViewId, number> | null>(null);
  useEffect(() => { setAllCounts(null); }, [relayUrl, submitted, range, customSince, customUntil]);
  useEffect(() => {
    if (view === "all" && !searching) setAllCounts(counts);
  }, [view, searching, counts]);
  const chipCount = (id: TypeViewId) => (view === id ? counts[id] : (allCounts ?? counts)[id]);
  const rows = useMemo(() => sortEvents(results, sort.key, sort.dir, nameOf), [results, sort, nameOf]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => rows.find((e) => e.id === selectedId) ?? null, [rows, selectedId]);
  useEffect(() => {
    if (wide && !selectedId && rows.length) setSelectedId(rows[0].id);
  }, [wide, rows, selectedId]);

  // ---- choosing many ----
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rule, setRule] = useState(false);
  const [gathering, setGathering] = useState<number | null>(null);
  const toggleCheck = useCallback((id: string) => {
    setRule(false);
    setChecked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const endSelect = useCallback(() => { setSelectMode(false); setChecked(new Set()); setRule(false); }, []);
  /** "Everything this search finds": pages back until the relay has no more (or the cap). */
  const selectAllMatching = useCallback(async () => {
    let all = results;
    if (!live && !exhausted && !(askRelayToSearch)) {
      setGathering(all.length);
      for (let guard = 0; guard < 40 && all.length < RULE_CAP; guard++) {
        const r = await loadOlder(all);
        all = r.events;
        setGathering(all.length);
        if (r.added === 0) { setExhausted(true); break; }
      }
      setResults(all);
      setGathering(null);
    }
    const capped = all.slice(0, RULE_CAP);
    setChecked(new Set(capped.map((e) => e.id)));
    setRule(true);
  }, [results, live, exhausted, askRelayToSearch, loadOlder]);

  // ---- acting ----
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [featureEvent, setFeatureEvent] = useState<NostrEvent | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const askRemove = useCallback((ids: string[], asRule = false) => {
    if (!canRemove || !ids.length) return;
    setPending({ kind: "remove", ids, rule: asRule });
  }, [canRemove]);
  const askBan = useCallback((pubkeys: string[], asRule = false) => {
    if (!canBan || !pubkeys.length) return;
    setPending({ kind: "ban", pubkeys: [...new Set(pubkeys)], rule: asRule });
  }, [canBan]);

  const carryOut = useCallback(async (reason: string | undefined) => {
    if (!pending) return;
    const action = pending;
    const items = action.kind === "remove" ? action.ids : action.pubkeys;
    setProgress({ done: 0, total: items.length });
    const out = await runBatch(
      items,
      (id) => action.kind === "remove" ? removeEventByAction(relayUrl, id, reason) : banPubkey(relayUrl, id, reason),
      (done, total) => setProgress({ done, total }),
    );
    setProgress(null);
    setPending(null);
    if (action.kind === "remove") {
      const gone = new Set(out.done);
      setResults((prev) => prev.filter((e) => !gone.has(e.id)));
      setChecked((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      if (out.done.length === 1) {
        const e = results.find((x) => x.id === out.done[0]);
        addModLogEntry(relayUrl, { action: "delete_event", targetEventId: out.done[0], targetPubkey: e?.pubkey, targetKind: e?.kind, note: reason });
      } else if (out.done.length > 1) {
        addModLogEntry(relayUrl, { action: "bulk_delete", count: out.done.length, note: reason });
      }
    } else {
      const list = getStoredList(ADMIN_BLOCKLIST_KEY, relayUrl);
      saveStoredList(ADMIN_BLOCKLIST_KEY, relayUrl, [...new Set([...list, ...out.done])]);
      for (const pk of out.done) addModLogEntry(relayUrl, { action: "block_author", targetPubkey: pk, note: reason });
    }
    const noun = action.kind === "remove" ? (n: number) => (n === 1 ? "post" : "posts") : (n: number) => (n === 1 ? "person" : "people");
    if (out.stopped || out.done.length === 0) {
      toast({ title: "The relay turned this down", description: out.stopped ?? out.failed[0]?.error, variant: "destructive" });
    } else if (out.failed.length === 0) {
      toast({
        title: action.kind === "remove" ? `Removed ${out.done.length} ${noun(out.done.length)} from ${relayName}` : `Banned ${out.done.length} ${noun(out.done.length)} from ${relayName}`,
        description: action.kind === "remove" && canRestore ? `You can bring ${out.done.length === 1 ? "it" : "them"} back from Removed.` : undefined,
      });
      if (action.kind === "remove") endSelect();
    } else {
      toast({
        title: `${out.done.length} done, ${out.failed.length} didn't go through`,
        description: out.failed[0].error,
        variant: "destructive",
      });
    }
  }, [pending, relayUrl, relayName, results, toast, canRestore, endSelect]);

  // ---- Removed ----
  const [removed, setRemoved] = useState<RemovedEntry[] | null>(null);
  const [removedError, setRemovedError] = useState<string | null>(null);
  const loadRemoved = useCallback(async () => {
    setRemoved(null);
    setRemovedError(null);
    const res = await listRemovedEvents(relayUrl);
    if (res.error) setRemovedError(res.error);
    else setRemoved(res.result ?? []);
  }, [relayUrl]);
  useEffect(() => { if (view === "removed") void loadRemoved(); }, [view, loadRemoved]);
  const restore = useCallback(async (id: string) => {
    const res = await restoreEvent(relayUrl, id);
    if (res.error) { toast({ title: "The relay didn't bring it back", description: res.error, variant: "destructive" }); return; }
    setRemoved((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    toast({ title: "Restored", description: "People using this relay can see it again." });
  }, [relayUrl, toast]);

  // ---- exporting ----
  const exportNow = useCallback((format: "csv" | "json") => {
    const pick = checked.size ? rows.filter((e) => checked.has(e.id)) : rows;
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "csv") download(toCsv(pick, nameOf), `relay-content-${stamp}.csv`, "text/csv");
    else download(JSON.stringify(exportable(pick), null, 2), `relay-content-${stamp}.json`, "application/json");
  }, [checked, rows, nameOf]);

  // ---- keyboard (desktop) ----
  const searchRef = useRef<HTMLInputElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || pending || featureEvent) return;
      const i = rows.findIndex((r) => r.id === selectedId);
      const current = i >= 0 ? rows[i] : null;
      switch (e.key) {
        case "j": if (rows.length) setSelectedId(rows[Math.min(rows.length - 1, i + 1)].id); break;
        case "k": if (rows.length) setSelectedId(rows[Math.max(0, i - 1)].id); break;
        case "x": if (current) { setSelectMode(true); toggleCheck(current.id); } break;
        case "r": if (checked.size) askRemove([...checked], rule); else if (current) askRemove([current.id]); break;
        case "b": if (checked.size) askBan(rows.filter((r) => checked.has(r.id)).map((r) => r.pubkey), rule); else if (current) askBan([current.pubkey]); break;
        case "f": if (current && !isPrivateKind(current.kind)) setFeatureEvent(current); break;
        case "/": searchRef.current?.focus(); break;
        case "?": setShortcutsOpen(true); break;
        case "Escape": if (selectMode) endSelect(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, rows, selectedId, checked, rule, selectMode, pending, featureEvent, toggleCheck, askRemove, askBan, endSelect]);

  const windowActive = range !== "any";
  const rangeLabel = range === "custom" ? "Custom" : TIME_RANGES.find((r) => r.id === range)?.label ?? "Any time";
  const nowSec = Math.floor(Date.now() / 1000);
  const oldest = results.length ? results[results.length - 1].created_at : undefined;
  const scope = live ? null : scopeLine({ reached, loaded: results.length, relaySearched: askRelayToSearch, exhausted, oldest });
  const checkedRows = useMemo(() => rows.filter((e) => checked.has(e.id)), [rows, checked]);
  const checkedAuthors = useMemo(() => [...new Set(checkedRows.map((e) => e.pubkey))], [checkedRows]);
  const sortBy = (key: SortKey) => setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "time" ? "desc" : "asc" });

  const detail = selected ? (
    <ContentDetail
      event={selected}
      profile={profiles.get(selected.pubkey)}
      relayName={relayName}
      canRemove={canRemove}
      canBan={canBan}
      where={where}
      onRemove={() => askRemove([selected.id])}
      onBan={() => askBan([selected.pubkey])}
      onFeature={() => setFeatureEvent(selected)}
      onEverythingFrom={() => { const n = pubkeyToNpub(selected.pubkey); setQuery(n); setSubmitted(n); setView("all"); }}
      onClose={wide ? undefined : () => setSelectedId(null)}
    />
  ) : null;

  return (
    <div className="space-y-3" data-testid="ops-content">
      {/* One field · Live · Filter */}
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim()); if (view === "removed") setView("all"); }} role="search">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" aria-hidden="true" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={wide ? "Search — words, an npub, kind:1, or an event id" : "Search"}
            title="Words, an npub, kind:1, or an event id"
            aria-label="Search this relay"
            enterKeyHint="search"
            className="h-11 sm:h-10 pl-10 pr-10 rounded-full text-sm"
            data-testid="ops-events-search"
          />
          {query && (
            <button type="button" onClick={() => { setQuery(""); setSubmitted(""); }} className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground" aria-label="Clear search">
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
            <Button type="button" variant="outline" className="relative h-11 w-11 p-0 sm:h-10 sm:w-auto sm:px-3.5 rounded-full shrink-0 text-[13px]" aria-label={windowActive ? `Filter — ${rangeLabel}` : "Filter"} data-active={windowActive} data-testid="ops-events-filter">
              <SlidersHorizontal className="w-4 h-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">{windowActive ? rangeLabel : "Filter"}</span>
              {windowActive && <span className="absolute top-1.5 right-1.5 sm:hidden w-2 h-2 rounded-full bg-brand" aria-hidden="true" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-[min(22rem,calc(100vw-1.5rem))] p-3 space-y-3">
            <div>
              <p className="text-[12px] font-medium text-muted-foreground mb-1.5">Time</p>
              <div className="flex flex-wrap gap-1.5">
                {[...TIME_RANGES, { id: "custom" as const, label: "Custom" }].map((r) => (
                  <button key={r.id} type="button" onClick={() => setRange(r.id)} aria-pressed={range === r.id} data-testid={`ops-events-range-${r.id}`}
                    className={`h-10 px-3.5 rounded-full text-[13px] font-medium transition-colors ${range === r.id ? "bg-brand text-white" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
                    {r.label}
                  </button>
                ))}
              </div>
              {range === "custom" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  <label className="block space-y-1"><span className="text-[12px] text-muted-foreground">From</span>
                    <input type="datetime-local" value={customSince} onChange={(e) => setCustomSince(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm dark:[color-scheme:dark]" />
                  </label>
                  <label className="block space-y-1"><span className="text-[12px] text-muted-foreground">To</span>
                    <input type="datetime-local" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm dark:[color-scheme:dark]" />
                  </label>
                </div>
              )}
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted-foreground mb-1.5">Sort</p>
              <div className="flex flex-wrap gap-1.5">
                {([["time", "desc", "Newest"], ["time", "asc", "Oldest"], ["who", "asc", "Who"], ["type", "asc", "Type"]] as const).map(([key, dir, label]) => (
                  <button key={label} type="button" onClick={() => setSort({ key, dir })} aria-pressed={sort.key === key && sort.dir === dir} data-testid={`ops-content-sort-${label.toLowerCase()}`}
                    className={`h-10 px-3.5 rounded-full text-[13px] font-medium transition-colors ${sort.key === key && sort.dir === dir ? "bg-brand text-white" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </form>

      {/* What things are */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="What to show" data-testid="ops-content-views">
        {TYPE_VIEWS.filter((v) => v.id === "all" || chipCount(v.id) > 0 || view === v.id).map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} data-testid={`ops-content-view-${v.id}`}
            className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${view === v.id ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
            {v.label}<span className="ml-1.5 tabular-nums opacity-60">{chipCount(v.id)}</span>
          </button>
        ))}
        {canSeeRemoved && (
          <button type="button" role="tab" aria-selected={view === "removed"} onClick={() => { setView("removed"); endSelect(); }} data-testid="ops-content-view-removed"
            className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${view === "removed" ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
            Removed
          </button>
        )}
      </div>

      {view === "removed" ? (
        <RemovedList entries={removed} error={removedError} canRestore={canRestore} where={where} onRestore={restore} onRetry={loadRemoved} />
      ) : (
        <>
          {/* What the list covers, and what you can do with it */}
          <div className="flex items-center gap-x-2 gap-y-1 px-1 min-h-[36px] flex-wrap">
            <span className="text-[13px] text-muted-foreground inline-flex items-center gap-1.5" data-testid="ops-events-count">
              {live && <span className={`w-2 h-2 rounded-full ${paused ? "bg-muted-foreground/50" : "bg-emerald-500 animate-pulse"}`} aria-hidden="true" />}
              {searching ? "Looking…" : `${rows.length} ${rows.length === 1 ? "post" : "posts"}`}
              {live && paused && heldCount > 0 && <span className="text-brand">· {heldCount} new</span>}
            </span>
            {scope && !searching && (
              <span className={`text-[13px] ${reached ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`} data-testid="ops-content-scope">· {scope}</span>
            )}
            {!live && !searching && reached && !exhausted && !askRelayToSearch && results.length >= PAGE && (
              <button type="button" onClick={searchFurther} disabled={loadingMore} className="text-[13px] font-medium text-brand hover:underline underline-offset-4 min-h-[36px]" data-testid="ops-content-further">
                {loadingMore ? "Looking further back…" : "Search further back"}
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {live && (
                <Button variant="ghost" size="sm" onClick={paused ? resume : () => setPaused(true)} className="h-9 px-2.5 text-[13px]" data-testid="ops-events-pause">
                  {paused ? <><Play className="w-3.5 h-3.5 mr-1" />Resume</> : <><Pause className="w-3.5 h-3.5 mr-1" />Pause</>}
                </Button>
              )}
              {wide && (
                <Button variant="ghost" size="sm" onClick={() => setShortcutsOpen(true)} className="h-9 w-9 p-0" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
                  <Keyboard className="w-4 h-4" />
                </Button>
              )}
              <Button variant={selectMode ? "secondary" : "ghost"} size="sm" onClick={() => (selectMode ? endSelect() : setSelectMode(true))} className="h-9 px-3 text-[13px]" data-testid="ops-content-select" disabled={!rows.length && !selectMode}>
                {selectMode ? "Done" : "Select"}
              </Button>
            </div>
          </div>

          <div className={wide ? "grid grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-4 items-start" : selectMode ? "pb-28" : ""}>
            <div className="min-w-0">
              {rows.length === 0 && !searching ? (
                <p className="px-1 py-10 text-center text-sm text-muted-foreground" data-testid="ops-content-empty">
                  {!reached ? "We couldn't reach this relay to look." : submitted || windowActive || view !== "all" ? "Nothing on this relay matches." : "Nothing on this relay yet."}
                </p>
              ) : (
                <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden">
                  {wide && (
                    <div className={`grid ${selectMode ? "grid-cols-[36px_64px_minmax(0,9rem)_6.5rem_minmax(0,1fr)]" : "grid-cols-[64px_minmax(0,9rem)_6.5rem_minmax(0,1fr)]"} items-center gap-3 px-3 h-9 border-b border-black/[0.08] dark:border-white/[0.08] text-[12px] font-medium text-muted-foreground bg-black/[0.02] dark:bg-white/[0.02]`}>
                      {selectMode && <span />}
                      <SortHeader label="Time" active={sort.key === "time"} dir={sort.dir} onClick={() => sortBy("time")} />
                      <SortHeader label="Who" active={sort.key === "who"} dir={sort.dir} onClick={() => sortBy("who")} />
                      <SortHeader label="Type" active={sort.key === "type"} dir={sort.dir} onClick={() => sortBy("type")} />
                      <span>Post</span>
                    </div>
                  )}
                  <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-content-list">
                    {rows.map((e) => (
                      <ContentRow
                        key={e.id}
                        event={e}
                        profile={profiles.get(e.pubkey)}
                        wide={wide}
                        nowSec={nowSec}
                        current={e.id === selectedId}
                        selectMode={selectMode}
                        checked={checked.has(e.id)}
                        onOpen={() => (selectMode ? toggleCheck(e.id) : setSelectedId(e.id))}
                        onCheck={() => toggleCheck(e.id)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {wide && (
              <aside className="sticky top-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] min-h-[240px] max-h-[calc(100dvh-7rem)] overflow-y-auto" data-testid="ops-content-detail-pane">
                {detail ?? <p className="p-6 text-sm text-muted-foreground">Pick a post to see it here.</p>}
              </aside>
            )}
          </div>
        </>
      )}

      {/* Phone: a post opens over the list */}
      {!wide && (
        <Sheet open={!!selected && !selectMode} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
          <SheetContent side="bottom" className="h-[92dvh] p-0 rounded-t-2xl overflow-y-auto" data-testid="ops-content-detail-sheet">
            <SheetTitle className="sr-only">Post</SheetTitle>
            {detail}
          </SheetContent>
        </Sheet>
      )}

      {/* Many at once */}
      {selectMode && view !== "removed" && (
        <div
          className={`${wide ? "sticky bottom-3" : "fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-40"} rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-background/95 backdrop-blur shadow-lg px-3 py-2`}
          data-testid="ops-content-actionbar"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium tabular-nums" data-testid="ops-content-selected-count">
              {gathering !== null ? `Gathering… ${gathering}` : rule ? `All ${checked.size} matching` : `${checked.size} selected`}
            </span>
            {!rule && gathering === null && rows.length > 0 && (
              <button type="button" onClick={selectAllMatching} className="text-[13px] font-medium text-brand hover:underline underline-offset-4 min-h-[36px]" data-testid="ops-content-select-all">
                Select everything this search finds
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {canRemove && (
                <Button size="sm" variant="ghost" disabled={!checked.size} onClick={() => askRemove([...checked], rule)} className="h-10 px-3 text-[13px] text-red-600 dark:text-red-400" data-testid="ops-content-bulk-remove">
                  <Trash2 className="w-4 h-4 mr-1.5" />Remove
                </Button>
              )}
              {canBan && (
                <Button size="sm" variant="ghost" disabled={!checked.size} onClick={() => askBan(checkedAuthors, rule)} className="h-10 px-3 text-[13px]" data-testid="ops-content-bulk-ban">
                  <Ban className="w-4 h-4 mr-1.5" />Ban {checkedAuthors.length > 1 ? `${checkedAuthors.length} people` : "author"}
                </Button>
              )}
              <ExportButton onExport={exportNow} disabled={!checked.size} />
            </div>
          </div>
          {!canRemove && !canBan && <ManagedAtNote where={where} lead="This relay doesn't let apps remove posts or ban people." verb="Do it" testId="ops-content-cant-act" />}
        </div>
      )}
      {!selectMode && view !== "removed" && rows.length > 0 && (
        <div className="flex justify-end"><ExportButton onExport={exportNow} label={`Export ${rows.length}`} /></div>
      )}

      {pending && (
        <ConfirmAction
          pending={pending}
          relayName={relayName}
          canRestore={canRestore}
          progress={progress}
          onCancel={() => { if (!progress) setPending(null); }}
          onConfirm={carryOut}
          nameOf={nameOf}
        />
      )}
      {featureEvent && (
        <AddToFeaturedDialog event={featureEvent} open={!!featureEvent} onOpenChange={(o) => { if (!o) setFeatureEvent(null); }} presetRelayUrl={relayUrl} />
      )}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm" data-testid="ops-content-shortcuts">
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {[["J / K", "Next / previous post"], ["X", "Select the post"], ["R", "Remove"], ["B", "Ban the author"], ["F", "Feature"], ["/", "Search"], ["Esc", "Stop selecting"]].map(([k, v]) => (
              <div key={k} className="contents"><dt><kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[12px]">{k}</kbd></dt><dd className="text-muted-foreground">{v}</dd></div>
            ))}
          </dl>
          <p className="text-[12px] text-muted-foreground">Removing and banning still ask before anything happens.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={`inline-flex items-center gap-1 text-left hover:text-foreground ${active ? "text-foreground" : ""}`} data-testid={`ops-content-sort-head-${label.toLowerCase()}`}>
      {label}
      {active && (dir === "asc" ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />)}
    </button>
  );
}

function ContentRow({ event, profile, wide, nowSec, current, selectMode, checked, onOpen, onCheck }: {
  event: NostrEvent; profile?: ProfileInfo; wide: boolean; nowSec: number; current: boolean;
  selectMode: boolean; checked: boolean; onOpen: () => void; onCheck: () => void;
}) {
  const who = profile?.name || `${pubkeyToNpub(event.pubkey).slice(0, 12)}…`;
  const preview = rowPreview(event);
  const sealed = isPrivateKind(event.kind);
  const box = selectMode ? (
    <span className="flex items-center justify-center w-9 h-11 -my-2 -ml-1" onClick={(e) => { e.stopPropagation(); onCheck(); }}>
      <Checkbox checked={checked} aria-label={`Select ${preview}`} data-testid="ops-content-check" />
    </span>
  ) : null;
  const base = `cursor-pointer transition-colors ${current && !selectMode ? "bg-brand/[0.07]" : checked ? "bg-brand/[0.05]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"}`;
  if (wide) {
    return (
      <li
        className={`grid ${selectMode ? "grid-cols-[36px_64px_minmax(0,9rem)_6.5rem_minmax(0,1fr)]" : "grid-cols-[64px_minmax(0,9rem)_6.5rem_minmax(0,1fr)]"} items-center gap-3 px-3 min-h-[44px] text-[13px] ${base}`}
        onClick={onOpen}
        aria-current={current ? "true" : undefined}
        data-testid="ops-event-row"
        data-event-id={event.id}
      >
        {box}
        <span className="tabular-nums text-muted-foreground" title={new Date(event.created_at * 1000).toLocaleString()}>{relTime(event.created_at, nowSec)}</span>
        <span className="flex items-center gap-2 min-w-0">
          <Avatar className="w-6 h-6 shrink-0">{profile?.picture && <AvatarImage src={profile.picture} alt="" />}<AvatarFallback className="text-[10px] bg-brand/10 text-brand">{who.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
          <span className="truncate font-medium">{who}</span>
        </span>
        <span className="truncate text-muted-foreground">{typeWord(event.kind)}</span>
        <span className={`truncate ${sealed ? "italic text-muted-foreground" : ""}`}>{preview}</span>
      </li>
    );
  }
  return (
    <li className={`flex items-start gap-2.5 px-3 py-2.5 min-h-[56px] ${base}`} onClick={onOpen} data-testid="ops-event-row" data-event-id={event.id}>
      {box}
      <Avatar className="w-8 h-8 shrink-0 mt-0.5">{profile?.picture && <AvatarImage src={profile.picture} alt="" />}<AvatarFallback className="text-[11px] bg-brand/10 text-brand">{who.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 text-[13px]">
          <span className="font-medium truncate">{who}</span>
          <span className="text-muted-foreground shrink-0">· {typeWord(event.kind)} · {relTime(event.created_at, nowSec)}</span>
        </span>
        <span className={`block text-[14px] leading-snug truncate ${sealed ? "italic text-muted-foreground" : ""}`}>{preview}</span>
      </span>
    </li>
  );
}

function ContentDetail({ event, profile, relayName, canRemove, canBan, where, onRemove, onBan, onFeature, onEverythingFrom, onClose }: {
  event: NostrEvent; profile?: ProfileInfo; relayName: string; canRemove: boolean; canBan: boolean;
  where: { name: string; url?: string };
  onRemove: () => void; onBan: () => void; onFeature: () => void; onEverythingFrom: () => void; onClose?: () => void;
}) {
  const [raw, setRaw] = useState(false);
  const [all, setAll] = useState(false);
  const sealed = isPrivateKind(event.kind);
  const npub = pubkeyToNpub(event.pubkey);
  const who = profile?.name || `${npub.slice(0, 16)}…`;
  const threadable = [1, 1111, 30023, 20, 21, 22].includes(event.kind);
  const ref = event.kind === 30023
    ? (() => { const d = event.tags.find((t) => t[0] === "d")?.[1]; return d !== undefined ? nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d }) : nip19.neventEncode({ id: event.id, author: event.pubkey }); })()
    : nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind });
  const text = event.content.length > 4000 && !all ? event.content.slice(0, 4000) + "…" : event.content;
  const rawJson = JSON.stringify(sealed ? { ...event, content: "(sealed)" } : event, null, 2);
  return (
    <div className="p-4 space-y-4" data-testid="ops-content-detail" data-event-id={event.id}>
      {onClose && (
        <button type="button" onClick={onClose} className="inline-flex items-center gap-0.5 min-h-[44px] -ml-2 pl-1 pr-2.5 rounded-full text-sm text-brand" data-testid="ops-content-detail-back">
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />All posts
        </button>
      )}
      <div className="flex items-center gap-3">
        <Avatar className="w-11 h-11 shrink-0">{profile?.picture && <AvatarImage src={profile.picture} alt="" />}<AvatarFallback className="bg-brand/10 text-brand">{who.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight truncate">{who}</p>
          <p className="text-[12px] text-muted-foreground truncate font-mono">{npub.slice(0, 20)}…</p>
        </div>
      </div>
      <button type="button" onClick={onEverythingFrom} className="w-full min-h-[44px] rounded-full border border-black/[0.1] dark:border-white/[0.12] text-[14px] font-medium hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" data-testid="ops-content-everything-from">
        Everything from {profile?.name || "this person"}
      </button>
      <p className="text-[13px] text-muted-foreground">
        {typeWord(event.kind)} · {new Date(event.created_at * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · kind {event.kind}
      </p>
      {sealed ? (
        <p className="text-[14px] leading-relaxed text-muted-foreground italic" data-testid="ops-content-sealed">
          A private message. Its contents are sealed between the people in it; Relay Outpost never opens them.
        </p>
      ) : (
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words" data-testid="ops-content-text">
          {text || <span className="text-muted-foreground">{rowPreview(event)}</span>}
          {event.content.length > 4000 && !all && <button type="button" onClick={() => setAll(true)} className="block mt-1 text-brand text-[13px]">Show all</button>}
        </div>
      )}

      <div className="grid gap-2">
        {canRemove ? (
          <Button variant="outline" onClick={onRemove} className="h-11 rounded-full justify-center text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/10" data-testid="ops-content-remove">
            <Trash2 className="w-4 h-4 mr-2" />Remove from {relayName}
          </Button>
        ) : null}
        {canBan ? (
          <Button variant="outline" onClick={onBan} className="h-11 rounded-full justify-center" data-testid="ops-content-ban">
            <Ban className="w-4 h-4 mr-2" />Ban {profile?.name || "this person"}
          </Button>
        ) : null}
        {!canRemove && !canBan && <ManagedAtNote where={where} lead="This relay doesn't let apps remove posts or ban people." verb="Do it" testId="ops-content-cant-act" />}
        {!sealed && (
          <Button variant="outline" onClick={onFeature} className="h-11 rounded-full justify-center" data-testid="ops-content-feature">
            <MagicStarIcon className="w-4 h-4 mr-2" />Feature
          </Button>
        )}
        <div className="flex gap-2">
          {threadable && !sealed && (
            <Button asChild variant="ghost" className="h-11 flex-1 rounded-full">
              <Link href={event.kind === 30023 ? `/articles/${ref}` : `/thread/${ref}`} data-testid="ops-content-open-conversation"><MessageSquare className="w-4 h-4 mr-2" />Open in conversation</Link>
            </Button>
          )}
          <Button variant="ghost" className="h-11 flex-1 rounded-full" onClick={() => copyNostrId(nip19.noteEncode(event.id))}>
            <Copy className="w-4 h-4 mr-2" />Copy ID
          </Button>
        </div>
      </div>

      <div>
        <button type="button" onClick={() => setRaw((r) => !r)} className="min-h-[44px] text-[13px] font-medium text-muted-foreground hover:text-foreground" aria-expanded={raw}>
          {raw ? "Hide raw event" : "Show raw event"}
        </button>
        {raw && <pre className="mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">{rawJson}</pre>}
      </div>
    </div>
  );
}

function ExportButton({ onExport, disabled, label = "Export" }: { onExport: (f: "csv" | "json") => void; disabled?: boolean; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} className="h-10 px-3 text-[13px]" data-testid="ops-content-export">
          <Download className="w-4 h-4 mr-1.5" />{label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <button type="button" onClick={() => onExport("csv")} className="w-full text-left min-h-[44px] px-3 rounded-md text-sm hover:bg-muted" data-testid="ops-content-export-csv">Spreadsheet (CSV)</button>
        <button type="button" onClick={() => onExport("json")} className="w-full text-left min-h-[44px] px-3 rounded-md text-sm hover:bg-muted" data-testid="ops-content-export-json">Nostr events (JSON)</button>
        <p className="px-3 pt-1 pb-1.5 text-[11px] text-muted-foreground">Private messages are exported without their contents.</p>
      </PopoverContent>
    </Popover>
  );
}

function RemovedList({ entries, error, canRestore, where, onRestore, onRetry }: {
  entries: RemovedEntry[] | null; error: string | null; canRestore: boolean; where: { name: string; url?: string };
  onRestore: (id: string) => void; onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="py-10 text-center space-y-2" data-testid="ops-content-removed-error">
        <p className="text-sm">The relay didn't give us its removed list.</p>
        <p className="text-[13px] text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={onRetry} className="h-10 rounded-full">Try again</Button>
      </div>
    );
  }
  if (!entries) return <div className="py-10 flex justify-center"><RelayOutpostInlineLoader className="w-5 h-5" /></div>;
  if (!entries.length) return <p className="py-10 text-center text-sm text-muted-foreground" data-testid="ops-content-removed-empty">Nothing has been removed from this relay.</p>;
  return (
    <div className="space-y-2">
      {!canRestore && <ManagedAtNote where={where} lead="This relay doesn't let apps bring removed posts back." verb="Do it" testId="ops-content-cant-restore" />}
      <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-content-removed">
        {entries.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 min-h-[56px]" data-testid="ops-content-removed-row">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-mono truncate">{nip19.noteEncode(r.id).slice(0, 24)}…</span>
              <span className="block text-[13px] text-muted-foreground truncate">{r.reason || "No reason given"}</span>
            </span>
            {canRestore && (
              <Button variant="ghost" onClick={() => onRestore(r.id)} className="h-10 px-3 text-[13px]" data-testid="ops-content-restore">
                <Undo2 className="w-4 h-4 mr-1.5" />Restore
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="px-1 text-[12px] text-muted-foreground">The relay no longer serves these, so only their IDs and reasons are shown.</p>
    </div>
  );
}

function ConfirmAction({ pending, relayName, canRestore, progress, onCancel, onConfirm, nameOf }: {
  pending: PendingAction; relayName: string; canRestore: boolean; progress: { done: number; total: number } | null;
  onCancel: () => void; onConfirm: (reason: string | undefined) => void; nameOf: (pk: string) => string | undefined;
}) {
  const [pick, setPick] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const removing = pending.kind === "remove";
  const count = removing ? pending.ids.length : pending.pubkeys.length;
  const needReason = reasonRequired(count, pending.rule);
  const needTyping = typedConfirmRequired(count, pending.rule);
  const phrase = removing ? confirmPhrase(count) : `ban ${count}`;
  const reason = removalReason(pick, note);
  const ready = (!needReason || !!reason) && (!needTyping || typed.trim().toLowerCase() === phrase);
  const one = removing ? "this post" : (nameOf(pending.pubkeys[0]) ?? "this person");
  const title = removing
    ? count === 1 ? `Remove ${one} from ${relayName}?` : `Remove ${count} posts from ${relayName}?`
    : count === 1 ? `Ban ${one} from ${relayName}?` : `Ban ${count} people from ${relayName}?`;
  const body = removing
    ? `People using ${relayName} won't see ${count === 1 ? "it" : "them"}. ${canRestore ? "You can bring them back from Removed." : "This relay can't bring removed posts back from here."}`
    : `They won't be able to post on ${relayName}. What they've already posted stays unless you remove it.`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md" data-testid="ops-content-confirm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Reason {needReason ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}</p>
          <div className="flex flex-wrap gap-1.5">
            {REMOVAL_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setPick(pick === r ? undefined : r)} aria-pressed={pick === r} data-testid={`ops-content-reason-${r.toLowerCase().replace(/\s+/g, "-")}`}
                className={`h-9 px-3 rounded-full text-[13px] font-medium ${pick === r ? "bg-brand text-white" : "bg-black/[0.05] dark:bg-white/[0.06]"}`}>
                {r}
              </button>
            ))}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="h-10" data-testid="ops-content-reason-note" />
          {pending.rule && <p className="text-[12px] text-muted-foreground">This covers everything your search found, not just what you picked.</p>}
        </div>
        {needTyping && (
          <label className="block space-y-1.5">
            <span className="text-[13px]">Type <strong className="font-mono">{phrase}</strong> to confirm</span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="h-10" data-testid="ops-content-confirm-typed" />
          </label>
        )}
        {progress && (
          <p className="text-[13px] text-muted-foreground" role="status" data-testid="ops-content-progress">
            {removing ? "Removing" : "Banning"} {progress.done} of {progress.total}…
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={!!progress} className="h-11 rounded-full">Cancel</Button>
          <Button onClick={() => onConfirm(reason)} disabled={!ready || !!progress} className={`h-11 rounded-full ${removing ? "bg-red-600 hover:bg-red-700 text-white" : ""}`} data-testid="ops-content-confirm-go">
            {progress ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : removing ? <Trash2 className="w-4 h-4 mr-2" /> : <Ban className="w-4 h-4 mr-2" />}
            {removing ? (count === 1 ? "Remove" : `Remove ${count}`) : (count === 1 ? "Ban" : `Ban ${count}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ContentTab;
