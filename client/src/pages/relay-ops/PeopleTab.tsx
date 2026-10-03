/**
 * Relays › People — everyone on your relay, person by person (owner,
 * 2026-10-03: "what a real community manager would need").
 *
 * The directory comes from the relay itself: who has posted (from what's
 * loaded, with a line saying how far back that is) and its allow and ban
 * lists. Each person shows how much and how recently they post, what your
 * network thinks of them (in words, never a number), and whether they're
 * allowed or banned. Ban, lift a ban, allow — only where the relay can.
 * Desktop: list and person side by side. Phone: a person opens over the list.
 *
 * Rules live in people-model.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import type { Event as NostrEvent } from "nostr-tools";
import { Ban, Copy, Download, MessageCircle, Search, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react";
import { supportsNip, type Nip11Document } from "@/lib/nip11";
import {
  allowPubkey, banPubkey, fetchRelayCapabilities, listAllowedPubkeys, listBannedPubkeys, unallowPubkey, unbanPubkey,
  type Nip86Response, type PubkeyEntry,
} from "@/lib/nip86";
import { canDo, managedAt, UNKNOWN_CAPABILITIES, type RelayCapabilities } from "@/lib/relay-capabilities";
import { runBatch } from "@/lib/relay-moderation";
import { getTrustPhrase } from "@/lib/trust-words";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ManagedAtNote } from "./ops-ui";
import { ConfirmAction, type PendingAction } from "./ConfirmAction";
import { addModLogEntry, pubkeyToNpub, resolveProfileBatch, subscribeWithReach, type NostrFilter, type ProfileInfo } from "./shared";
import { mergePage, scopeLine } from "./content-model";
import {
  activityLine, buildDirectory, filterPeople, knowsNewcomers, peopleCsv, PEOPLE_FILTERS, sortPeople,
  type PeopleFilter, type PeopleSort, type Person,
} from "./people-model";

const PAGE = 500;

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(min-width: 1024px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

function hexes(entries: PubkeyEntry[] | undefined): string[] {
  return (entries ?? [])
    .map((e) => (typeof e === "string" ? e : (e as PubkeyEntry).pubkey))
    .filter((p): p is string => typeof p === "string" && /^[0-9a-f]{64}$/i.test(p))
    .map((p) => p.toLowerCase());
}

export function PeopleTab({ relayUrl, nip11, onSeePosts }: {
  relayUrl: string;
  nip11: Nip11Document | null;
  /** Opens Content searching for this person. */
  onSeePosts: (npub: string) => void;
}) {
  const { toast } = useToast();
  const wide = useWide();
  const { getAuthorTier, isAuthorFlagged, wotEnabled } = useGrapeRankScores();
  const tierOf = useCallback((pk: string) => (isAuthorFlagged(pk) ? "flagged" as const : getAuthorTier(pk)), [getAuthorTier, isAuthorFlagged]);
  const relayName = nip11?.name?.trim() || relayUrl.replace(/^wss?:\/\//, "");
  const speaks86 = !!nip11 && supportsNip(nip11, 86);

  const [caps, setCaps] = useState<RelayCapabilities>(UNKNOWN_CAPABILITIES);
  useEffect(() => {
    let off = false;
    setCaps(UNKNOWN_CAPABILITIES);
    fetchRelayCapabilities(relayUrl).then((c) => { if (!off) setCaps(c); });
    return () => { off = true; };
  }, [relayUrl]);
  const can = {
    ban: speaks86 && canDo(caps, "ban"),
    unban: speaks86 && canDo(caps, "unban"),
    allow: speaks86 && canDo(caps, "allow"),
    unallow: speaks86 && canDo(caps, "unallow"),
    lists: speaks86 && (canDo(caps, "listBanned") || canDo(caps, "listAllowed")),
  };
  const where = managedAt(relayUrl);

  // ---- who posts here ----
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [reached, setReached] = useState(true);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    let off = false;
    setLoading(true);
    setExhausted(false);
    subscribeWithReach([relayUrl], [{ limit: PAGE } as NostrFilter], 7000).then((res) => {
      if (off) return;
      setReached(res.reached);
      setEvents(res.events.sort((a, b) => b.created_at - a.created_at));
      setExhausted(res.reached && res.events.length === 0);
      setLoading(false);
    });
    return () => { off = true; };
  }, [relayUrl]);
  const lookFurther = useCallback(async () => {
    setLoadingMore(true);
    const oldest = events.length ? events[events.length - 1].created_at : undefined;
    const res = await subscribeWithReach([relayUrl], [{ limit: PAGE, ...(oldest ? { until: oldest } : {}) } as NostrFilter], 7000);
    if (!res.reached) setReached(false);
    const merged = mergePage(events, res.events);
    setEvents(merged.events);
    if (merged.added === 0) setExhausted(true);
    setLoadingMore(false);
  }, [relayUrl, events]);

  // ---- the relay's own lists ----
  const [allowed, setAllowed] = useState<string[]>([]);
  const [banned, setBanned] = useState<string[]>([]);
  const [listsNote, setListsNote] = useState<string | null>(null);
  const loadLists = useCallback(async () => {
    if (!can.lists) return;
    const [a, b] = await Promise.all([
      canDo(caps, "listAllowed") ? listAllowedPubkeys(relayUrl) : Promise.resolve<Nip86Response<PubkeyEntry[]>>({ result: [] }),
      canDo(caps, "listBanned") ? listBannedPubkeys(relayUrl) : Promise.resolve<Nip86Response<PubkeyEntry[]>>({ result: [] }),
    ]);
    if (a.error && b.error) { setListsNote(`The relay didn't share its allow and ban lists: ${b.error}`); return; }
    setListsNote(null);
    setAllowed(hexes(a.result));
    setBanned(hexes(b.result));
  }, [can.lists, caps, relayUrl]);
  useEffect(() => { void loadLists(); }, [loadLists]);

  // ---- the directory ----
  const [touched, setTouched] = useState<string[]>([]);
  const people = useMemo(() => buildDirectory(events, { allowed, banned, also: touched }), [events, allowed, banned, touched]);
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = people.map((p) => p.pubkey).filter((pk) => !known.current.has(pk));
    if (!fresh.length) return;
    fresh.forEach((pk) => known.current.add(pk));
    resolveProfileBatch(fresh).then((m) => {
      if (m.size) setProfiles((prev) => { const next = new Map(prev); m.forEach((v, k) => next.set(k, v)); return next; });
    }).catch(() => {});
  }, [people]);
  const nameOf = useCallback((pk: string) => profiles.get(pk)?.name, [profiles]);

  const nowSec = Math.floor(Date.now() / 1000);
  const oldest = events.length ? events[events.length - 1].created_at : undefined;
  const newcomersKnown = knowsNewcomers(oldest, nowSec, exhausted);
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PeopleSort>("active");
  const shown = useMemo(
    () => sortPeople(filterPeople(people, filter, query, { nowSec, newcomersKnown, nameOf, tierOf }), sort, nameOf),
    [people, filter, query, nowSec, newcomersKnown, nameOf, tierOf, sort],
  );
  const filters = PEOPLE_FILTERS.filter((f) =>
    (f.id !== "new" || newcomersKnown) && (f.id !== "concerns" || wotEnabled) && (f.id !== "allowed" || allowed.length > 0 || filter === "allowed") && (f.id !== "banned" || banned.length > 0 || filter === "banned"));

  const [selected, setSelected] = useState<string | null>(null);
  const person = useMemo(() => people.find((p) => p.pubkey === selected) ?? null, [people, selected]);
  useEffect(() => { if (wide && !selected && shown.length) setSelected(shown[0].pubkey); }, [wide, selected, shown]);

  // ---- acting ----
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const toggle = (pk: string) => setChecked((prev) => { const n = new Set(prev); if (n.has(pk)) n.delete(pk); else n.add(pk); return n; });
  const endSelect = () => { setSelectMode(false); setChecked(new Set()); };

  const carryOutBan = useCallback(async (reason: string | undefined) => {
    if (!pending || pending.kind !== "ban") return;
    const ids = pending.pubkeys;
    setProgress({ done: 0, total: ids.length });
    const out = await runBatch(ids, (pk) => banPubkey(relayUrl, pk, reason), (done, total) => setProgress({ done, total }));
    setProgress(null);
    setPending(null);
    setBanned((prev) => [...new Set([...prev, ...out.done])]);
    for (const pk of out.done) addModLogEntry(relayUrl, { action: "block_author", targetPubkey: pk, note: reason });
    if (out.stopped || out.done.length === 0) toast({ title: "The relay turned this down", description: out.stopped ?? out.failed[0]?.error, variant: "destructive" });
    else if (out.failed.length) toast({ title: `${out.done.length} banned, ${out.failed.length} didn't go through`, description: out.failed[0].error, variant: "destructive" });
    else { toast({ title: `Banned ${out.done.length} ${out.done.length === 1 ? "person" : "people"} from ${relayName}` }); endSelect(); }
  }, [pending, relayUrl, relayName, toast]);

  const quick = useCallback(async (kind: "unban" | "allow" | "unallow", pubkeys: string[]) => {
    const call = kind === "unban" ? unbanPubkey : kind === "allow" ? allowPubkey : unallowPubkey;
    setTouched((prev) => [...new Set([...prev, ...pubkeys])]);
    const out = await runBatch(pubkeys, (pk) => call(relayUrl, pk));
    if (kind === "unban") setBanned((prev) => prev.filter((pk) => !out.done.includes(pk)));
    if (kind === "allow") setAllowed((prev) => [...new Set([...prev, ...out.done])]);
    if (kind === "unallow") setAllowed((prev) => prev.filter((pk) => !out.done.includes(pk)));
    for (const pk of out.done) addModLogEntry(relayUrl, { action: kind === "unban" ? "remove_blocklist" : kind === "allow" ? "add_allowlist" : "remove_allowlist", targetPubkey: pk });
    const n = out.done.length;
    const who = n === 1 ? (nameOf(out.done[0]) ?? `${pubkeyToNpub(out.done[0]).slice(0, 12)}…`) : `${n} people`;
    if (!n) toast({ title: "The relay turned this down", description: out.stopped ?? out.failed[0]?.error, variant: "destructive" });
    else toast({ title: kind === "unban" ? `Lifted the ban on ${who}` : kind === "allow" ? `${who} can post on ${relayName}` : `Took ${who} off the allow list` });
    if (n) endSelect();
  }, [relayUrl, relayName, nameOf, toast]);

  const exportCsv = () => {
    const pick = checked.size ? shown.filter((p) => checked.has(p.pubkey)) : shown;
    const url = URL.createObjectURL(new Blob([peopleCsv(pick, nameOf)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `relay-people-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const scope = scopeLine({ reached, loaded: events.length, exhausted, oldest }).replace(/^Searched the latest (\d+)/, "From the latest $1 posts");

  const detail = person ? (
    <PersonDetail
      person={person}
      profile={profiles.get(person.pubkey)}
      trust={wotEnabled ? getTrustPhrase(tierOf(person.pubkey)) : ""}
      nowSec={nowSec}
      relayName={relayName}
      can={can}
      where={where}
      onBan={() => setPending({ kind: "ban", pubkeys: [person.pubkey], rule: false })}
      onUnban={() => quick("unban", [person.pubkey])}
      onAllow={() => quick("allow", [person.pubkey])}
      onUnallow={() => quick("unallow", [person.pubkey])}
      onSeePosts={() => onSeePosts(pubkeyToNpub(person.pubkey))}
    />
  ) : null;

  return (
    <div className="space-y-3" data-testid="ops-people">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={wide ? "Find someone — a name or an npub" : "Find someone"} aria-label="Find someone" className="h-11 sm:h-10 pl-10 pr-10 rounded-full text-sm" data-testid="ops-people-search" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground" aria-label="Clear">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="h-11 w-11 p-0 sm:h-10 sm:w-auto sm:px-3.5 rounded-full shrink-0 text-[13px]" aria-label="Sort" data-testid="ops-people-sort">
              <SlidersHorizontal className="w-4 h-4 sm:mr-1.5" aria-hidden="true" /><span className="hidden sm:inline">Sort</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1.5">
            {([["active", "Most recently active"], ["posts", "Most posts"], ["name", "Name"]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setSort(id)} aria-pressed={sort === id} className={`w-full text-left min-h-[44px] px-3 rounded-md text-sm hover:bg-muted ${sort === id ? "font-semibold text-brand" : ""}`} data-testid={`ops-people-sort-${id}`}>{label}</button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="Who to show">
        {filters.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`ops-people-filter-${f.id}`}
            className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${filter === f.id ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-x-2 gap-y-1 px-1 min-h-[36px] flex-wrap">
        <span className="text-[13px] text-muted-foreground" data-testid="ops-people-count">{loading ? "Looking…" : `${shown.length} ${shown.length === 1 ? "person" : "people"}`}</span>
        {!loading && <span className={`text-[13px] ${reached ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`} data-testid="ops-people-scope">· {scope}</span>}
        {!loading && reached && !exhausted && events.length >= PAGE && (
          <button type="button" onClick={lookFurther} disabled={loadingMore} className="text-[13px] font-medium text-brand hover:underline underline-offset-4 min-h-[36px]" data-testid="ops-people-further">
            {loadingMore ? "Looking further back…" : "Look further back"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={!shown.length} className="h-9 px-3 text-[13px]" data-testid="ops-people-export"><Download className="w-4 h-4 mr-1.5" />Export</Button>
          <Button variant={selectMode ? "secondary" : "ghost"} size="sm" onClick={() => (selectMode ? endSelect() : setSelectMode(true))} disabled={!shown.length && !selectMode} className="h-9 px-3 text-[13px]" data-testid="ops-people-select">{selectMode ? "Done" : "Select"}</Button>
        </div>
      </div>
      {listsNote && <p className="px-1 text-[13px] text-amber-700 dark:text-amber-300" data-testid="ops-people-lists-note">{listsNote}</p>}
      {!can.lists && !loading && speaks86 === false && (
        <ManagedAtNote where={where} lead="This relay doesn't share who it allows or bans with apps." verb="See them" testId="ops-people-no-lists" />
      )}

      <div className={wide ? "grid grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-4 items-start" : selectMode ? "pb-28" : ""}>
        <div className="min-w-0">
          {shown.length === 0 && !loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="ops-people-empty">
              {!reached ? "We couldn't reach this relay to look." : query || filter !== "all" ? "Nobody matches." : "Nobody has posted here yet."}
            </p>
          ) : (
            <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] overflow-hidden" data-testid="ops-people-list">
              {shown.map((p) => {
                const prof = profiles.get(p.pubkey);
                const name = prof?.name || `${pubkeyToNpub(p.pubkey).slice(0, 14)}…`;
                const trust = wotEnabled ? getTrustPhrase(tierOf(p.pubkey)) : "";
                const current = p.pubkey === selected && !selectMode;
                return (
                  <li key={p.pubkey} onClick={() => (selectMode ? toggle(p.pubkey) : setSelected(p.pubkey))} aria-current={current ? "true" : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 min-h-[60px] cursor-pointer transition-colors ${current ? "bg-brand/[0.07]" : checked.has(p.pubkey) ? "bg-brand/[0.05]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"}`}
                    data-testid="ops-person-row" data-pubkey={p.pubkey}>
                    {selectMode && (
                      <span className="flex items-center justify-center w-8 -ml-1" onClick={(e) => { e.stopPropagation(); toggle(p.pubkey); }}>
                        <Checkbox checked={checked.has(p.pubkey)} aria-label={`Select ${name}`} data-testid="ops-person-check" />
                      </span>
                    )}
                    <Avatar className="w-10 h-10 shrink-0">{prof?.picture && <AvatarImage src={prof.picture} alt="" />}<AvatarFallback className="bg-brand/10 text-brand">{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-medium truncate">{name}</span>
                        {p.status === "banned" && <span className="shrink-0 text-[13px] font-medium text-red-600 dark:text-red-400">Banned</span>}
                        {p.status === "allowed" && <span className="shrink-0 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">Allowed</span>}
                      </span>
                      <span className="block text-[13px] text-muted-foreground truncate">{activityLine(p, nowSec)}{trust ? ` · ${trust}` : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {wide && (
          <aside className="sticky top-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] min-h-[240px]" data-testid="ops-people-detail-pane">
            {detail ?? <p className="p-6 text-sm text-muted-foreground">Pick someone to see them here.</p>}
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet open={!!person && !selectMode} onOpenChange={(o) => { if (!o) setSelected(null); }}>
          <SheetContent side="bottom" className="h-[88dvh] p-0 rounded-t-2xl overflow-y-auto" data-testid="ops-people-detail-sheet">
            <SheetTitle className="sr-only">Person</SheetTitle>
            {detail}
          </SheetContent>
        </Sheet>
      )}

      {selectMode && (
        <div className={`${wide ? "sticky bottom-3" : "fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-40"} rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-background/95 backdrop-blur shadow-lg px-3 py-2`} data-testid="ops-people-actionbar">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium tabular-nums" data-testid="ops-people-selected-count">{checked.size} selected</span>
            <div className="ml-auto flex items-center gap-1">
              {can.ban && <Button size="sm" variant="ghost" disabled={!checked.size} onClick={() => setPending({ kind: "ban", pubkeys: [...checked], rule: false })} className="h-10 px-3 text-[13px]" data-testid="ops-people-bulk-ban"><Ban className="w-4 h-4 mr-1.5" />Ban</Button>}
              {can.allow && <Button size="sm" variant="ghost" disabled={!checked.size} onClick={() => quick("allow", [...checked])} className="h-10 px-3 text-[13px]" data-testid="ops-people-bulk-allow"><ShieldCheck className="w-4 h-4 mr-1.5" />Allow</Button>}
              <Button size="sm" variant="ghost" disabled={!checked.size} onClick={exportCsv} className="h-10 px-3 text-[13px]"><Download className="w-4 h-4 mr-1.5" />Export</Button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <ConfirmAction pending={pending} relayName={relayName} canRestore={false} progress={progress}
          onCancel={() => { if (!progress) setPending(null); }} onConfirm={carryOutBan} nameOf={nameOf} />
      )}
    </div>
  );
}

function PersonDetail({ person, profile, trust, nowSec, relayName, can, where, onBan, onUnban, onAllow, onUnallow, onSeePosts }: {
  person: Person; profile?: ProfileInfo; trust: string; nowSec: number; relayName: string;
  can: { ban: boolean; unban: boolean; allow: boolean; unallow: boolean };
  where: { name: string; url?: string };
  onBan: () => void; onUnban: () => void; onAllow: () => void; onUnallow: () => void; onSeePosts: () => void;
}) {
  const npub = pubkeyToNpub(person.pubkey);
  const name = profile?.name || `${npub.slice(0, 16)}…`;
  const nothingToDo = !(person.status === "banned" ? can.unban : can.ban) && !can.allow;
  return (
    <div className="p-4 space-y-4" data-testid="ops-person-detail" data-pubkey={person.pubkey}>
      <div className="flex items-center gap-3">
        <Avatar className="w-14 h-14 shrink-0">{profile?.picture && <AvatarImage src={profile.picture} alt="" />}<AvatarFallback className="bg-brand/10 text-brand text-lg">{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-tight truncate">{name}</p>
          {profile?.nip05 && <p className="text-[13px] text-muted-foreground truncate">{profile.nip05}</p>}
          <button type="button" onClick={() => copyNostrId(npub)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-mono text-muted-foreground hover:text-foreground min-h-[28px]">
            {npub.slice(0, 18)}…<Copy className="w-3 h-3" aria-label="Copy npub" />
          </button>
        </div>
      </div>

      <dl className="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-3.5 py-3 space-y-2 text-[14px]">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">On {relayName}</dt><dd className="text-right" data-testid="ops-person-activity">{activityLine(person, nowSec)}</dd></div>
        {trust && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Your network</dt><dd className="text-right" data-testid="ops-person-trust">{trust}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Status</dt>
          <dd className={`text-right font-medium ${person.status === "banned" ? "text-red-600 dark:text-red-400" : person.status === "allowed" ? "text-emerald-700 dark:text-emerald-400" : ""}`} data-testid="ops-person-status">
            {person.status === "banned" ? "Banned" : person.status === "allowed" ? "Allowed to post" : "No rule for them"}
          </dd>
        </div>
      </dl>

      <div className="grid gap-2">
        <Button variant="outline" onClick={onSeePosts} className="h-11 rounded-full" data-testid="ops-person-see-posts">See their posts</Button>
        {person.status === "banned"
          ? can.unban && <Button variant="outline" onClick={onUnban} className="h-11 rounded-full" data-testid="ops-person-unban">Lift the ban</Button>
          : can.ban && <Button variant="outline" onClick={onBan} className="h-11 rounded-full text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/10" data-testid="ops-person-ban"><Ban className="w-4 h-4 mr-2" />Ban from {relayName}</Button>}
        {person.status !== "banned" && (person.status === "allowed"
          ? can.unallow && <Button variant="ghost" onClick={onUnallow} className="h-11 rounded-full" data-testid="ops-person-unallow">Take off the allow list</Button>
          : can.allow && <Button variant="ghost" onClick={onAllow} className="h-11 rounded-full" data-testid="ops-person-allow"><ShieldCheck className="w-4 h-4 mr-2" />Allow to post</Button>)}
        {person.status === "banned" && !can.unban && <ManagedAtNote where={where} lead="This relay can't lift bans from here." verb="Do it" testId="ops-person-cant-unban" />}
        {nothingToDo && person.status !== "banned" && <ManagedAtNote where={where} lead="This relay doesn't let apps ban or allow people." verb="Do it" testId="ops-person-cant-act" />}
        <div className="flex gap-2">
          <Button asChild variant="ghost" className="h-11 flex-1 rounded-full"><Link href={`/messages/${npub}`} data-testid="ops-person-message"><MessageCircle className="w-4 h-4 mr-2" />Message</Link></Button>
          <Button asChild variant="ghost" className="h-11 flex-1 rounded-full"><Link href={`/profile/${npub}`} data-testid="ops-person-profile"><UserRound className="w-4 h-4 mr-2" />Profile</Link></Button>
        </div>
      </div>
    </div>
  );
}

export default PeopleTab;
