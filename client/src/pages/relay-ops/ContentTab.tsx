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
import { useTechnicalDetails } from "@/lib/technical-details";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event as NostrEvent, Filter as RelayFilter } from "nostr-tools";
import {
  ArrowDown, ArrowUp, Ban, Copy, Download, Keyboard, MessageSquare,
  Pause, Play, ScanSearch, Search, SlidersHorizontal, Trash2, Undo2, X,
} from "lucide-react";
import { pool, DEFAULT_RELAYS } from "@/lib/nostr";
import { CommentContent } from "@/components/CommentContent";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { AddToFeaturedDialog } from "@/components/AddToFeaturedDialog";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import { ManagedAtNote } from "./ops-ui";
import { ConfirmAction, type PendingAction } from "./ConfirmAction";
import { RefusedNotice } from "./RefusedNotice";
import { EventInspector, type InspectedEvent } from "./EventInspector";
import { parsePastedEvent } from "./inspector-model";
import { FilterPanel, ViewsMenu } from "./ContentFilterPanel";
import { EMPTY_FILTERS, deleteView, filterChips, isEmpty, readSavedViews, removeChip, saveView, withFilters, type ContentFilters, type SavedView } from "./content-filters";
import { countLine, type CountState } from "./count-line";
import { getSignInPolicy, signInAsChosen } from "@/lib/nip42-auth";
import { scrollRootFor } from "@/lib/scroll-root";
import {
  ADMIN_BLOCKLIST_KEY, addModLogEntry, countWithNip45, getStoredList, pubkeyToNpub, resolveProfileBatch, saveStoredList,
  subscribeWithReach, type NostrFilter, type ProfileInfo,
} from "./shared";
import { parseEventQuery, TIME_RANGES, type RangeId, type TimeWindow } from "./event-query";
import {
  aboutEvent, aboutId, contentFilter, countByType, exportable, featureWhat, isPrivateKind, mergePage, rowPreview, scopeLine, sortEvents, toCsv,
  looksEncrypted, typeOf, TYPE_VIEWS, typeWord, type PreviewContext, type SortDir, type SortKey, type TypeViewId,
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

export function ContentTab({ relayUrl, nip11, initialLive = false, initialQuery = "" }: {
  relayUrl: string; nip11: Nip11Document | null; initialLive?: boolean;
  /** Opened from People's "See their posts": the search starts with their npub. */
  initialQuery?: string;
}) {
  const technical = useTechnicalDetails();
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
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
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
  // The Filter panel: kinds, people, hashtags — applied by the relay itself.
  const [filters, setFiltersRaw] = useState<ContentFilters>(EMPTY_FILTERS);
  const setFilters = useCallback((f: ContentFilters) => {
    setFiltersRaw(f);
    // Chosen kinds replace the type views, so the views step aside.
    if (f.kinds.length) setView("all");
  }, []);
  const matches = useCallback((e: NostrEvent) => {
    if (typeView === "other" && typeOf(e.kind) !== "other") return false;
    if (parsed.kind === undefined && !filters.kinds.length && typeView !== "all" && typeOf(e.kind) !== typeView) return false;
    if (parsed.text && !askRelayToSearch) {
      if (isPrivateKind(e.kind)) return false;
      if (!e.content.toLowerCase().includes(parsed.text.toLowerCase())) return false;
    }
    return true;
  }, [typeView, parsed.kind, parsed.text, askRelayToSearch, filters.kinds.length]);
  const filterFor = useCallback((until?: number) => withFilters(contentFilter(parsed, window_, typeView, Math.floor(Date.now() / 1000), {
    search: askRelayToSearch, limit: PAGE, until,
  }), filters), [parsed, window_, typeView, askRelayToSearch, filters]);

  // ---- the answer ----
  const [results, setResults] = useState<NostrEvent[]>([]);
  const [reached, setReached] = useState(true);
  /** The relay answered "sign in first" instead of results — not the same as empty. */
  const [refused, setRefused] = useState<string | null>(null);
  const [count, setCount] = useState<CountState | null>(null);
  const [searching, setSearching] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [live, setLive] = useState(initialLive);
  const [paused, setPaused] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const nameOf = useCallback((pk: string) => profiles.get(pk)?.name, [profiles]);

  // The posts likes, reposts, thanks and delete requests are about, so a row
  // can say what was liked, thanked or asked to go.
  const [targets, setTargets] = useState<Map<string, NostrEvent>>(new Map());
  const askedTargets = useRef<Set<string>>(new Set());
  const byId = useMemo(() => new Map(results.map((e) => [e.id, e])), [results]);
  useEffect(() => {
    const want: string[] = [];
    for (const e of results) {
      if (![5, 6, 7, 16, 9735].includes(e.kind)) continue;
      const id = aboutId(e);
      if (id && !byId.has(id) && !askedTargets.current.has(id)) { askedTargets.current.add(id); want.push(id); }
    }
    if (!want.length) return;
    pool.querySync([relayUrl, ...DEFAULT_RELAYS.slice(0, 3)], { ids: want.slice(0, 150) }, { maxWait: 5000 } as never)
      .then((evs) => { if (evs.length) setTargets((prev) => { const n = new Map(prev); evs.forEach((ev) => n.set(ev.id, ev)); return n; }); })
      .catch(() => {});
  }, [results, byId, relayUrl]);
  const previewCtx = useMemo(() => ({ nameOf, targetOf: (id: string) => byId.get(id) ?? targets.get(id) }), [nameOf, byId, targets]);

  const knownProfiles = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Authors, and anyone their posts mention by nostr: link.
    const mentioned: string[] = [];
    for (const e of [...results, ...targets.values()]) {
      for (const m of e.content.matchAll(/nostr:((?:npub|nprofile)1[02-9ac-hj-np-z]+)/gi)) {
        try { const d = nip19.decode(m[1]); mentioned.push(d.type === "npub" ? (d.data as string) : (d.data as { pubkey: string }).pubkey); } catch {}
      }
    }
    const fresh = [...new Set([...results.map((e) => e.pubkey), ...mentioned])].filter((pk) => !knownProfiles.current.has(pk));
    if (!fresh.length) return;
    fresh.forEach((pk) => knownProfiles.current.add(pk));
    resolveProfileBatch(fresh).then((m) => {
      if (m.size) setProfiles((prev) => { const next = new Map(prev); m.forEach((v, k) => next.set(k, v)); return next; });
    }).catch(() => {});
  }, [results, targets]);

  const runSearch = useCallback(async () => {
    if (window_.range === "custom" && window_.since && window_.until && window_.since > window_.until) {
      toast({ title: "Start is after end", description: "Pick a start time before the end time.", variant: "destructive" });
      return;
    }
    setSearching(true);
    setExhausted(false);
    const res = await subscribeWithReach([relayUrl], [filterFor() as NostrFilter], 6000);
    setReached(res.reached);
    setRefused(res.events.length === 0 && res.refused ? res.refused : null);
    setResults(res.events.filter(matches).sort((a, b) => b.created_at - a.created_at));
    setExhausted(res.reached && !res.refused && res.events.length === 0);
    setSearching(false);
  }, [relayUrl, filterFor, matches, window_, toast]);
  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;
  useEffect(() => {
    if (live || view === "removed") return;
    void runSearchRef.current();
  }, [live, relayUrl, submitted, window_, view, filters]);

  // How many match on the whole relay (NIP-45), where it can count. Not for
  // a word search the relay can't do itself — that count would be of
  // something else.
  const relayCounts = !!nip11 && supportsNip(nip11, 45);
  useEffect(() => {
    if (live || view === "removed" || parsed.id || (parsed.text && !askRelayToSearch)) { setCount(null); return; }
    if (!relayCounts) { setCount({ status: "unsupported" }); return; }
    let off = false;
    setCount({ status: "counting" });
    const { limit: _l, ...f } = filterFor();
    countWithNip45(relayUrl, f as NostrFilter).then((r) => {
      if (off) return;
      setCount(r.supported && r.count !== null ? { status: "counted", count: r.count, approximate: r.approximate } : { status: "refused" });
    });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, relayUrl, submitted, window_, view, filters, relayCounts]);

  // Saved views (this device).
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => { try { return readSavedViews(relayUrl, localStorage); } catch { return []; } });
  useEffect(() => { try { setSavedViews(readSavedViews(relayUrl, localStorage)); } catch {} }, [relayUrl]);

  /** One more page, older than what's loaded. Returns how many new came back. */
  const loadOlder = useCallback(async (from: NostrEvent[]): Promise<{ events: NostrEvent[]; added: number }> => {
    const oldest = from.length ? from[from.length - 1].created_at : undefined;
    const res = await subscribeWithReach([relayUrl], [filterFor(oldest) as NostrFilter], 6000);
    if (!res.reached) setReached(false);
    return mergePage(from, res.events.filter(matches));
  }, [relayUrl, filterFor, matches]);
  const searchFurther = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const r = await loadOlder(results);
    setResults(r.events);
    if (r.added === 0) setExhausted(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, [loadOlder, results]);

  // Reaching the end of the list loads the next page — no button hunting on
  // a relay that takes hundreds of posts a minute.
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const canLoadMore = !live && !searching && reached && !exhausted && !askRelayToSearch && results.length >= PAGE;
  const searchFurtherRef = useRef(searchFurther);
  searchFurtherRef.current = searchFurther;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canLoadMore || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) void searchFurtherRef.current(); }, { root: scrollRootFor(el), rootMargin: "0px 0px 600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, results.length]);

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
    // On a wide screen something is always open beside the list — including
    // after a filter takes the open post away.
    if (wide && rows.length && !rows.some((r) => r.id === selectedId)) setSelectedId(rows[0].id);
    // On a phone the pop-up closes when its post leaves the list — and is
    // forgotten, so it can't spring open again when the post comes back (a
    // filter switched back, Live, a fresh search).
    else if (!wide && selectedId && !rows.some((r) => r.id === selectedId)) setSelectedId(null);
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
  const [inspecting, setInspecting] = useState<InspectedEvent | null>(null);
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
      toast({ title: "Your host turned this down", description: out.stopped ?? out.failed[0]?.error, variant: "destructive" });
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
    if (res.error) { toast({ title: "Your host didn't bring it back", description: res.error, variant: "destructive" }); return; }
    setRemoved((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    toast({ title: "Restored", description: "Members can see it again." });
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
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || pending || featureEvent || inspecting) return;
      const i = rows.findIndex((r) => r.id === selectedId);
      const current = i >= 0 ? rows[i] : null;
      switch (e.key) {
        case "j": if (rows.length) setSelectedId(rows[Math.min(rows.length - 1, i + 1)].id); break;
        case "k": if (rows.length) setSelectedId(rows[Math.max(0, i - 1)].id); break;
        case "x": if (current) { setSelectMode(true); toggleCheck(current.id); } break;
        case "r": if (checked.size) askRemove([...checked], rule); else if (current) askRemove([current.id]); break;
        case "b": if (checked.size) askBan(rows.filter((r) => checked.has(r.id)).map((r) => r.pubkey), rule); else if (current) askBan([current.pubkey]); break;
        case "f": { const f = current && featurable(current); if (f) setFeatureEvent(f); break; }
        case "i": if (current) setInspecting(current); break;
        case "/": searchRef.current?.focus(); break;
        case "?": setShortcutsOpen(true); break;
        case "Escape": if (selectMode) endSelect(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, rows, selectedId, checked, rule, selectMode, pending, featureEvent, inspecting, toggleCheck, askRemove, askBan, endSelect]);

  const windowActive = range !== "any";
  const chips = useMemo(() => [
    ...filterChips(filters, nameOf),
    ...(range !== "any" ? [{ key: "time", label: range === "custom" ? "Custom time" : TIME_RANGES.find((r) => r.id === range)?.label ?? "" }] : []),
  ], [filters, nameOf, range]);
  const rangeLabel = range === "custom" ? "Custom" : TIME_RANGES.find((r) => r.id === range)?.label ?? "Any time";
  const nowSec = Math.floor(Date.now() / 1000);
  const oldest = results.length ? results[results.length - 1].created_at : undefined;
  const scope = live ? null : scopeLine({ reached, loaded: results.length, relaySearched: askRelayToSearch, exhausted, oldest });
  const checkedRows = useMemo(() => rows.filter((e) => checked.has(e.id)), [rows, checked]);
  const checkedAuthors = useMemo(() => [...new Set(checkedRows.map((e) => e.pubkey))], [checkedRows]);
  const sortBy = (key: SortKey) => setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "time" ? "desc" : "asc" });

  // What Feature puts in a featured feed: the post itself, or — for a like or
  // repost — the post it's about, when we have it (content-model featureWhat).
  const featurable = (e: NostrEvent): NostrEvent | null => {
    const what = featureWhat(e);
    if (!what) return null;
    return what.own ? e : (aboutEvent(e, previewCtx) as NostrEvent | undefined) ?? null;
  };
  const featureOf = selected ? featurable(selected) : null;

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
      feature={featureOf ? (featureOf.id === selected.id ? "Feature" : "Feature the post") : null}
      onFeature={() => { if (featureOf) setFeatureEvent(featureOf); }}
      onInspect={() => setInspecting(selected)}
      // The list becomes theirs; on a phone the pop-up gets out of its way.
      onEverythingFrom={() => { const n = pubkeyToNpub(selected.pubkey); setQuery(n); setSubmitted(n); setView("all"); if (!wide) setSelectedId(null); }}
      preview={previewCtx}
    />
  ) : null;

  return (
    <div className="space-y-3" data-testid="ops-content">
      {/* One field · Live · Filter */}
      <form className="flex items-center gap-2" onSubmit={(e) => {
        e.preventDefault();
        // A pasted event is something to inspect, not words to search for.
        const pasted = parsePastedEvent(query);
        if (pasted) { setInspecting(pasted); return; }
        setSubmitted(query.trim()); if (view === "removed") setView("all");
      }} role="search">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" aria-hidden="true" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={wide ? (technical ? "Search — words, an npub, kind:1, an event id, or paste an event" : "Search posts — words, a person, or a link to a post") : "Search"}
            title={technical ? "Words, an npub, kind:1, an event id, or a pasted event to inspect" : "Words, a person, or a link to a post"}
            aria-label="Search this community"
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
        <FilterPanel
          wide={wide}
          filters={filters}
          setFilters={setFilters}
          range={range}
          setRange={setRange}
          customSince={customSince}
          customUntil={customUntil}
          setCustomSince={setCustomSince}
          setCustomUntil={setCustomUntil}
          sort={sort}
          setSort={setSort}
          profiles={profiles}
          activeCount={chips.length}
        />
      </form>

      {/* What you're looking at, as chips you can take off */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="ops-content-chips">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => { if (c.key === "time") setRange("any"); else setFilters(removeChip(filters, c.key)); }} className="inline-flex items-center gap-1 min-h-[36px] pl-3 pr-2 rounded-full bg-brand/10 text-brand text-[13px] font-medium" aria-label={`Remove ${c.label}`} data-testid="ops-content-chip">
              {c.label}<X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          ))}
          <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setRange("any"); }} className="min-h-[36px] px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground" data-testid="ops-content-chips-clear">Clear all</button>
        </div>
      )}

      {/* What things are */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="What to show" data-testid="ops-content-views">
        {TYPE_VIEWS.filter((v) => v.id === "all" || chipCount(v.id) > 0 || view === v.id).map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} data-testid={`ops-content-view-${v.id}`}
            className={`shrink-0 h-11 sm:h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${view === v.id ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
            {v.label}<span className="ml-1.5 tabular-nums opacity-60">{chipCount(v.id)}</span>
          </button>
        ))}
        {canSeeRemoved && (
          <button type="button" role="tab" aria-selected={view === "removed"} onClick={() => { setView("removed"); endSelect(); }} data-testid="ops-content-view-removed"
            className={`shrink-0 h-11 sm:h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${view === "removed" ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
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
            {count && !live && (
              <span className={`text-[13px] ${count.status === "counted" ? "text-foreground" : "text-muted-foreground"}`} data-testid="ops-content-count">· {countLine(count)}</span>
            )}
            {scope && !searching && !refused && count?.status !== "counted" && (
              <span className={`text-[13px] ${reached ? "text-muted-foreground" : "text-warning dark:text-amber-300"}`} data-testid="ops-content-scope">· {scope}</span>
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
              <ViewsMenu
                views={savedViews}
                canSave={chips.length > 0 || !!submitted || view !== "all"}
                onOpen={(v) => { setQuery(v.query); setSubmitted(v.query); setFiltersRaw(v.filters); setView(v.view); }}
                onSave={(name) => { try { setSavedViews(saveView(relayUrl, name, { query: submitted, view, filters }, localStorage)); toast({ title: `Saved “${name.trim()}”` }); } catch {} }}
                onDelete={(id) => { try { setSavedViews(deleteView(relayUrl, id, localStorage)); } catch {} }}
              />
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
              {rows.length === 0 && !searching && refused ? (
                <RefusedNotice relayName={relayName} reason={refused}
                  never={getSignInPolicy(relayUrl).policy === "never"}
              onSignIn={() => { if (!signInAsChosen(relayUrl)) return; try { pool.close([relayUrl]); } catch {} setTimeout(() => void runSearchRef.current(), 300); }} />
              ) : rows.length === 0 && !searching ? (
                <p className="px-1 py-10 text-center text-sm text-muted-foreground" data-testid="ops-content-empty">
                  {!reached ? "We couldn't reach your community to look." : submitted || windowActive || view !== "all" || chips.length ? "Nothing here matches." : "Nothing here yet."}
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
                        preview={previewCtx}
                      />
                    ))}
                  </ul>
                </div>
              )}
              {rows.length > 0 && (
                <div ref={sentinelRef} className="flex justify-center py-3 min-h-[44px]" data-testid="ops-content-sentinel">
                  {loadingMore && <span className="text-[13px] text-muted-foreground" role="status">Loading more…</span>}
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
          {!canRemove && !canBan && <ManagedAtNote where={where} lead="Your host doesn't let apps remove posts or ban people." verb="Do it" testId="ops-content-cant-act" />}
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
      <EventInspector event={inspecting} relayUrl={relayUrl} relayName={relayName} onClose={() => setInspecting(null)} />

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm" data-testid="ops-content-shortcuts">
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {[["J / K", "Next / previous post"], ["X", "Select the post"], ["R", "Remove"], ["B", "Ban the author"], ["F", "Feature"], ["I", "Inspect"], ["/", "Search"], ["Esc", "Stop selecting"]].map(([k, v]) => (
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

function ContentRow({ event, profile, wide, nowSec, current, selectMode, checked, onOpen, onCheck, preview: previewCtx }: {
  event: NostrEvent; profile?: ProfileInfo; wide: boolean; nowSec: number; current: boolean;
  selectMode: boolean; checked: boolean; onOpen: () => void; onCheck: () => void;
  preview: PreviewContext;
}) {
  const who = profile?.name || `${pubkeyToNpub(event.pubkey).slice(0, 12)}…`;
  const preview = rowPreview(event, previewCtx);
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

function ContentDetail({ event, profile, relayName, canRemove, canBan, where, feature, onRemove, onBan, onFeature, onInspect, onEverythingFrom, preview }: {
  event: NostrEvent; profile?: ProfileInfo; relayName: string; canRemove: boolean; canBan: boolean;
  /** The Feature button's words, or null where there's nothing to feature. */
  feature: string | null;
  where: { name: string; url?: string };
  onRemove: () => void; onBan: () => void; onFeature: () => void; onInspect: () => void; onEverythingFrom: () => void;
  preview: PreviewContext;
}) {
  const technical = useTechnicalDetails();
  const [all, setAll] = useState(false);
  const sealed = isPrivateKind(event.kind);
  const npub = pubkeyToNpub(event.pubkey);
  const who = profile?.name || `${npub.slice(0, 16)}…`;
  const threadable = [1, 1111, 30023, 20, 21, 22].includes(event.kind);
  const ref = event.kind === 30023
    ? (() => { const d = event.tags.find((t) => t[0] === "d")?.[1]; return d !== undefined ? nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: d }) : nip19.neventEncode({ id: event.id, author: event.pubkey }); })()
    : nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind });
  const text = event.content.length > 4000 && !all ? event.content.slice(0, 4000) + "…" : event.content;
  return (
    <div className="p-4 space-y-4" data-testid="ops-content-detail" data-event-id={event.id}>
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
        {typeWord(event.kind)} · {new Date(event.created_at * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{technical ? ` · kind ${event.kind}` : ""}
      </p>
      {sealed ? (
        <p className="text-[14px] leading-relaxed text-muted-foreground italic" data-testid="ops-content-sealed">
          A private message. Its contents are sealed between the people in it; Relay Outpost never opens them.
        </p>
      ) : (
        <PostBody event={event} preview={preview} text={text} showAll={() => setAll(true)} clipped={event.content.length > 4000 && !all} />
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
        {!canRemove && !canBan && <ManagedAtNote where={where} lead="Your host doesn't let apps remove posts or ban people." verb="Do it" testId="ops-content-cant-act" />}
        {feature && (
          <Button variant="outline" onClick={onFeature} className="h-11 rounded-full justify-center" data-testid="ops-content-feature">
            <MagicStarIcon className="w-4 h-4 mr-2" />{feature}
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
        <Button variant="ghost" className="h-11 rounded-full justify-center text-muted-foreground" onClick={onInspect} data-testid="ops-content-inspect">
          <ScanSearch className="w-4 h-4 mr-2" />Inspect
        </Button>
      </div>
    </div>
  );
}

/**
 * The post itself, as people see it everywhere else in the app: the feed's own
 * renderer draws pictures, GIFs, video, link previews, @names, quoted posts and
 * hashtags. A reaction or repost shows what it's about.
 */
function PostBody({ event, preview, text, clipped, showAll }: { event: NostrEvent; preview: PreviewContext; text: string; clipped: boolean; showAll: () => void }) {
  if (event.kind === 0) return <div data-testid="ops-content-text"><ProfileFields content={event.content} /></div>;
  const view = typeOf(event.kind);
  // About another post: say what was done, then show that post.
  if (view === "reactions" || view === "reposts" || view === "thanks" || event.kind === 5) {
    const target = aboutEvent(event, preview);
    return (
      <div className="space-y-2" data-testid="ops-content-text">
        <p className="text-[15px]">{rowPreview(event, { nameOf: preview.nameOf }).replace(/:.*$/, "")}{target ? ":" : ""}</p>
        {event.kind === 5 && target && event.content.trim() && <p className="text-[14px] text-muted-foreground">“{event.content.trim().slice(0, 300)}”</p>}
        {target && (
          <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] p-3 text-[14px]" data-testid="ops-content-target">
            <CommentContent event={target as NostrEvent} />
          </div>
        )}
      </div>
    );
  }
  if (view === "notes" || view === "media" || (view === "other" && event.content && !looksEncrypted(event.content))) {
    return (
      <div className="text-[15px] leading-relaxed break-words [&_img]:rounded-xl [&_video]:rounded-xl" data-testid="ops-content-text" data-rendered="true">
        <CommentContent event={event} />
      </div>
    );
  }
  if (view === "articles") {
    const title = event.tags.find((t) => t[0] === "title")?.[1];
    const summary = event.tags.find((t) => t[0] === "summary")?.[1];
    return (
      <div className="space-y-1.5" data-testid="ops-content-text">
        {title && <p className="text-[17px] font-semibold leading-snug">{title}</p>}
        <p className="text-[14px] leading-relaxed text-muted-foreground line-clamp-6">{summary || text.slice(0, 600)}</p>
      </div>
    );
  }
  return (
    <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words" data-testid="ops-content-text">
      {text || <span className="text-muted-foreground">{rowPreview(event, preview)}</span>}
      {clipped && <button type="button" onClick={showAll} className="block mt-1 text-brand text-[13px]">Show all</button>}
    </div>
  );
}

/** A profile update, as the fields people read — not its JSON. */
function ProfileFields({ content }: { content: string }) {
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(content); } catch { return <>{content}</>; }
  const rows = ([["Name", p.display_name || p.name], ["About", p.about], ["Address", p.nip05], ["Website", p.website], ["Lightning", p.lud16]] as const)
    .filter(([, v]) => typeof v === "string" && v.trim());
  if (!rows.length) return <span className="text-muted-foreground">An empty profile</span>;
  return (
    <dl className="space-y-1.5" data-testid="ops-content-profile">
      {rows.map(([k, v]) => (
        <div key={k}><dt className="text-[12px] text-muted-foreground">{k}</dt><dd className="text-[15px]">{String(v)}</dd></div>
      ))}
    </dl>
  );
}

function ExportButton({ onExport, disabled, label = "Export" }: { onExport: (f: "csv" | "json") => void; disabled?: boolean; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} className="min-h-[44px] px-3 text-[13px]" data-testid="ops-content-export">
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
        <p className="text-sm">Your host didn't share what's been removed.</p>
        <p className="text-[13px] text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={onRetry} className="h-10 rounded-full">Try again</Button>
      </div>
    );
  }
  if (!entries) return <div className="py-10 flex justify-center"><RelayOutpostInlineLoader className="w-5 h-5" /></div>;
  if (!entries.length) return <p className="py-10 text-center text-sm text-muted-foreground" data-testid="ops-content-removed-empty">Nothing has been removed here.</p>;
  return (
    <div className="space-y-2">
      {!canRestore && <ManagedAtNote where={where} lead="Your host doesn't let apps bring removed posts back." verb="Do it" testId="ops-content-cant-restore" />}
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
      <p className="px-1 text-[12px] text-muted-foreground">These aren't served any more, so only why they were removed is shown.</p>
    </div>
  );
}

export default ContentTab;
