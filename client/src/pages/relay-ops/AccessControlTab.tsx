import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { useTechnicalDetails } from "@/lib/technical-details";
import { createPortal } from "react-dom";
import type { Event as NostrEvent } from "nostr-tools";
import { searchCachedProfiles } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { type Nip11Document } from "@/lib/nip11";
import { copyNostrId } from "@/lib/clipboard-bridge";
import {
  checkNip86Support,
  fetchRelayCapabilities,
  allowPubkey,
  banPubkey,
  unallowPubkey,
  unbanPubkey,
  listAllowedPubkeys,
  listBannedPubkeys,
  extractAddedAtMap,
  fetchNip86History,
  type PubkeyEntry,
  type Nip86SupportStatus,
} from "@/lib/nip86";
import { canDo, managedAt } from "@/lib/relay-capabilities";
import { notYetOn, readAccessList, readImportFile, type AccessList } from "@/lib/access-list";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { OpsCard, OpsSectionHeader, ManagedAtNote } from "./ops-ui";
import { setSetupFlag } from "./SetupChecklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  RefreshCw,
  Globe,
  Copy,
  Check,
  X,
  Search,
  Plus,
  User,
  Zap,
  AlertTriangle,
  Trash2,
  UserCheck,
  UserX,
  Download,
  Upload,
  Clock,
  ScrollText,
  Users,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { fetchConnectionScores, getActiveThresholds } from "@/lib/graperank";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import {
  addModLogEntry,
  ADMIN_ALLOWLIST_KEY,
  ADMIN_BLOCKLIST_KEY,
  ADMIN_READONLY_KEY,
  clearModLog,
  formatTimestamp,
  getModLog,
  getStoredList,
  MANUAL_TEAM_KEY,
  ModAction,
  ModerationLogEntry,
  npubToHex,
  profileCacheGlobal,
  ProfileInfo,
  pubkeyToNpub,
  saveStoredList,
  resolveProfileBatch,
  UserListToolbar,
  useUrlListControls,
  useDateAdded,
  useActivityProbe,
  applyUserListControls,
  recordDateAdded,
  recordDateAddedMany,
  recordDateAddedHistorical,
  removeDateAdded,
  formatRelativeMs,
  formatRelativeSec,
  type UserListControls,
  type UserListSort,
  type UserListFilter,
  type ActivityStatus,
} from "./shared";


type AccessLevel = "allow" | "readonly" | "block";

function PubkeyRow({ hex, type, profile, onRemove, addedAt, lastActiveSec, activityStatus, copies, selecting, selected, onToggle }: {
  hex: string;
  type: AccessLevel;
  profile?: ProfileInfo;
  onRemove: (hex: string, type: AccessLevel) => void;
  addedAt?: number;
  lastActiveSec?: number;
  activityStatus: ActivityStatus;
  /** How many rows the relay holds for this person, when more than one. */
  copies?: number;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const technical = useTechnicalDetails();
  const npub = pubkeyToNpub(hex);
  const [copied, setCopied] = useState(false);
  const copyNpub = useCallback(() => {
    copyNostrId(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [npub]);
  const addedLabel = addedAt
    ? `Added ${formatRelativeMs(addedAt)}`
    : "Added —";
  // "unreachable" sits beside "gated" deliberately: both mean we have no
  // reading, and neither may fall through to formatRelativeSec, which maps a
  // missing value to the confident "No activity seen" — on every row at once.
  const activityLabel = activityStatus === "loading"
    ? "Loading…"
    : activityStatus === "gated"
      ? "Activity not loaded"
      : activityStatus === "unreachable"
        ? "Couldn't reach your host"
        : formatRelativeSec(lastActiveSec);
  return (
    <div
      className={`flex items-center gap-2 sm:gap-2 rounded-md border px-2.5 sm:px-2 py-2.5 sm:py-1.5 ${selected ? "bg-brand/[0.06] border-brand/30" : "bg-black/[0.03] dark:bg-white/[0.02] border-black/[0.08] dark:border-white/[0.06]"} ${selecting ? "cursor-pointer" : ""}`}
      onClick={selecting ? onToggle : undefined}
      data-testid={`ops-access-row-${type}`}
      data-pubkey={hex}
    >
      {selecting && (
        <span className="inline-flex items-center justify-center w-8 h-8 -ml-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={!!selected} onCheckedChange={() => onToggle?.()} aria-label={`Select ${profile?.name || "this person"}`} data-testid={`ops-access-check-${type}`} />
        </span>
      )}
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
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 leading-tight">
          <span title={addedAt ? undefined : "We only started tracking add dates from now on."}>{addedLabel}</span>
          <span className="text-muted-foreground/30">·</span>
          <span>{activityLabel}</span>
          {copies && copies > 1 && (<>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-amber-700 dark:text-amber-400" data-testid="ops-access-copies">listed {copies} times</span>
          </>)}
        </div>
      </div>
      {!selecting && <>
      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-5 sm:w-5 shrink-0 text-muted-foreground/60 hover:text-muted-foreground" onClick={copyNpub} title={technical ? "Copy npub" : "Copy their key"}>
        {copied ? <Check className="w-3 h-3 sm:w-2.5 sm:h-2.5 text-green-800 dark:text-green-400" /> : <Copy className="w-3 h-3 sm:w-2.5 sm:h-2.5" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-5 sm:w-5 shrink-0 text-red-600 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-400" onClick={() => onRemove(hex, type)} aria-label={type === "block" ? "Lift ban" : "Remove from list"} data-testid={`ops-access-remove-${type}`}>
        <X className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
      </Button>
      </>}
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
  const technical = useTechnicalDetails();
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
            placeholder={technical ? "Search name, npub, or hex pubkey" : "Find someone, or paste their profile link"}
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

function PubkeyListSection({ type, icon, label, labelClass, description, borderClass, badgeClass, list, inputValue, setInput, buttonLabel, buttonClass, profileCache, onRemove, onAddDirect, onAdd, onExport, onImport, onProfileFound, relayUrl, listKey, controlsKey, onRemoveMany, relayList, onTidy, tidying }: {
  type: AccessLevel; icon: React.ReactNode; label: string; labelClass: string; description: string;
  borderClass: string; badgeClass: string;
  list: string[]; inputValue: string; setInput: (v: string) => void;
  buttonLabel: string; buttonClass?: string;
  profileCache: Record<string, ProfileInfo>;
  onRemove: (hex: string, type: AccessLevel) => void;
  onAddDirect: (type: AccessLevel, rawInput: string) => void;
  onAdd: (type: AccessLevel) => void;
  onExport: (type: AccessLevel) => void;
  /** Only where the relay keeps the list — an import must reach it. */
  onImport?: (type: AccessLevel) => void;
  onProfileFound?: (hex: string, profile: ProfileInfo) => void;
  relayUrl: string;
  listKey: string;
  controlsKey: string;
  onRemoveMany: (hexes: string[], type: AccessLevel, onProgress: (done: number) => void) => Promise<void>;
  /** What the relay holds for this list — its copies of the same person. */
  relayList?: AccessList;
  onTidy?: () => void;
  tidying?: { done: number; total: number } | null;
}) {
  const { controls, setQuery, setSort, setFilter } = useUrlListControls(controlsKey);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState<{ done: number; total: number } | null>(null);
  const toggle = (hex: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(hex)) n.delete(hex); else n.add(hex); return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  // Forget picks that left the list (removed elsewhere, or by this).
  useEffect(() => { setSelected((prev) => { const on = new Set(list); const n = new Set([...prev].filter((h) => on.has(h))); return n.size === prev.size ? prev : n; }); }, [list]);
  const removeSelected = async () => {
    const hexes = [...selected];
    setConfirming(false);
    setRemoving({ done: 0, total: hexes.length });
    await onRemoveMany(hexes, type, (done) => setRemoving({ done, total: hexes.length }));
    setRemoving(null);
    stopSelecting();
  };
  const what = type === "block" ? "ban list" : type === "readonly" ? "read-only list" : "allow list";
  const copiedPeople = relayList ? Object.keys(relayList.copies).length : 0;
  const addedAt = useDateAdded(relayUrl, listKey, list);
  const { lastActive, status: activityStatus, run: runActivity } = useActivityProbe(relayUrl, listKey, list);
  const { filtered, total } = useMemo(
    () => applyUserListControls({ list, controls, profileCache, addedAt, lastActive }),
    [list, controls, profileCache, addedAt, lastActive],
  );
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
            {onImport && (
              <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => onImport(type)} title="Import" aria-label={`Import ${label}`} data-testid={`ops-access-import-${type}`}>
                <Upload className="w-3.5 h-3.5" />
              </Button>
            )}
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
      <UserListToolbar
        controls={controls}
        setQuery={setQuery}
        setSort={setSort}
        setFilter={setFilter}
        total={total}
        matched={filtered.length}
        activityStatus={activityStatus}
        onLoadActivity={runActivity}
      />
      {copiedPeople > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-amber-700 dark:text-amber-400" data-testid={`ops-access-copies-note-${type}`}>
          <span>
            The relay lists {copiedPeople} {copiedPeople === 1 ? "person" : "people"} more than once ({relayList!.extraRows} extra {relayList!.extraRows === 1 ? "copy" : "copies"}) — it adds a copy each time someone is added again.
          </span>
          {onTidy && (tidying
            ? <span className="text-muted-foreground" role="status">Tidying {tidying.done} of {tidying.total}…</span>
            : <button type="button" onClick={onTidy} className="min-h-[36px] font-medium underline underline-offset-4" data-testid={`ops-access-tidy-${type}`}>Tidy up</button>)}
        </div>
      )}
      {list.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-2 min-h-[44px]" data-testid={`ops-access-select-bar-${type}`}>
          {!selecting ? (
            <Button variant="ghost" size="sm" className="h-11 sm:h-8 px-3 text-[12px]" onClick={() => setSelecting(true)} data-testid={`ops-access-select-${type}`}>Select</Button>
          ) : (<>
            <span className="text-[12px] font-medium tabular-nums" data-testid={`ops-access-selected-${type}`}>{selected.size} selected</span>
            {selected.size < filtered.length
              ? <Button variant="ghost" size="sm" className="h-11 sm:h-8 px-2 text-[12px] text-brand" onClick={() => setSelected(new Set(filtered))} data-testid={`ops-access-select-all-${type}`}>Select all {filtered.length}{filtered.length < list.length ? " shown" : ""}</Button>
              : <Button variant="ghost" size="sm" className="h-11 sm:h-8 px-2 text-[12px]" onClick={() => setSelected(new Set())}>Clear</Button>}
            <span className="ml-auto flex items-center gap-1">
              {removing
                ? <span className="text-[12px] text-muted-foreground" role="status">Removing {removing.done} of {removing.total}…</span>
                : <Button size="sm" variant="ghost" disabled={!selected.size} className="h-11 sm:h-8 px-3 text-[12px] text-red-600 dark:text-red-400" onClick={() => setConfirming(true)} data-testid={`ops-access-remove-selected-${type}`}><Trash2 className="w-3.5 h-3.5 mr-1" />{type === "block" ? "Lift" : "Remove"} {selected.size || ""}</Button>}
              <Button size="sm" variant="ghost" disabled={!!removing} className="h-11 sm:h-8 px-3 text-[12px]" onClick={stopSelecting}>Done</Button>
            </span>
          </>)}
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent data-testid={`ops-access-confirm-${type}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{type === "block" ? `Lift ${selected.size} ${selected.size === 1 ? "ban" : "bans"}?` : `Remove ${selected.size} ${selected.size === 1 ? "person" : "people"} from the ${what}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {type === "allow" ? "They won't be able to post here until they're added again." : type === "block" ? "They'll be able to post here again." : "They'll lose read-only access."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-[44px] bg-red-600 hover:bg-red-700 text-white" onClick={(e) => { e.preventDefault(); void removeSelected(); }} data-testid={`ops-access-confirm-go-${type}`}>
              {type === "block" ? "Lift" : "Remove"} {selected.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {list.length === 0 ? (
          <p className="text-[10px] text-muted-foreground/60 text-center py-3">No entries.</p>
        ) : filtered.length === 0 ? (
          <p className="text-[10px] text-muted-foreground/60 text-center py-3">No matches for the current search/filter.</p>
        ) : filtered.map(hex => (
          <PubkeyRow
            key={hex}
            hex={hex}
            type={type}
            profile={profileCache[hex]}
            onRemove={onRemove}
            addedAt={addedAt[hex]}
            lastActiveSec={lastActive[hex]}
            activityStatus={activityStatus}
            copies={relayList?.copies[hex]}
            selecting={selecting}
            selected={selected.has(hex)}
            onToggle={() => toggle(hex)}
          />
        ))}
      </div>
    </OpsCard>
  );
}



/**
 * Why an allow/ban stayed in this browser instead of reaching the relay.
 *
 * "Couldn't reach it" and "it doesn't do this" are different problems with
 * different next steps — the first is worth retrying, the second needs the
 * operator to go and edit the relay's own config. They used to share one
 * sentence, which named the wrong cause every time a relay was merely down.
 */
function unsyncedReason(status: Nip86SupportStatus | null): string {
  if (status === "unreachable") {
    return "couldn't be sent — we can't reach your host right now. The change is only in this browser; try again once it answers.";
  }
  return "was saved in this browser only. Your host doesn't let apps change this list, so change it at your host.";
}

/**
 * Two places share this (owner, 2026-10-04):
 * - "rules": Community › Who can post — who may post (read from the relay,
 *   set at the host), how many are approved and banned (they open People),
 *   and approving everyone your network trusts;
 * - "lists": People › Allowed / Banned — the list itself, with Import, Tidy
 *   up and removing many at once.
 */
export function AccessControlTab({ relayUrl, nip11, part = "rules", only, onOpenPeople }: {
  relayUrl: string; nip11: Nip11Document | null;
  part?: "rules" | "lists";
  /** The one list to show in "lists". */
  only?: "allow" | "block";
  /** Opens People on its Allowed or Banned filter. */
  onOpenPeople?: (filter: "allowed" | "banned") => void;
}) {
  const { toast } = useToast();
  const [allowlist, setAllowlist] = useState<string[]>(getStoredList(ADMIN_ALLOWLIST_KEY, relayUrl));
  const [readonlyList, setReadonlyList] = useState<string[]>(getStoredList(ADMIN_READONLY_KEY, relayUrl));
  const [blocklist, setBlocklist] = useState<string[]>(getStoredList(ADMIN_BLOCKLIST_KEY, relayUrl));
  const [newAllow, setNewAllow] = useState("");
  const [newReadonly, setNewReadonly] = useState("");
  const [newBlock, setNewBlock] = useState("");
  const [profileCache, setProfileCache] = useState<Record<string, ProfileInfo>>({});
  const [modLog, setModLog] = useState<ModerationLogEntry[]>(getModLog(relayUrl));
  const [modLogFilter, setModLogFilter] = useState<"all" | "deletes" | "access" | "health">("all");

  const [nip86Status, setNip86Status] = useState<Nip86SupportStatus | null>(null);
  const [nip86Syncing, setNip86Syncing] = useState(false);
  const [nip86Error, setNip86Error] = useState<string | null>(null);
  const [nip86LastSync, setNip86LastSync] = useState<number | null>(null);

  useEffect(() => {
    setAllowlist(getStoredList(ADMIN_ALLOWLIST_KEY, relayUrl));
    setReadonlyList(getStoredList(ADMIN_READONLY_KEY, relayUrl));
    setBlocklist(getStoredList(ADMIN_BLOCKLIST_KEY, relayUrl));
    setModLog(getModLog(relayUrl));
    setNip86Status(null);
    setNip86Error(null);
    setNip86LastSync(null);
  }, [relayUrl]);

  const syncRequestRef = useRef(0);
  // What the relay itself holds, per list: copies of the same person, and why each was added.
  const [relayCopies, setRelayCopies] = useState<{ allow?: AccessList; block?: AccessList }>({});

  const syncFromRelay = useCallback(async () => {
    const requestId = ++syncRequestRef.current;
    setNip86Syncing(true);
    setNip86Error(null);
    try {
      const [allowRes, banRes] = await Promise.all([
        listAllowedPubkeys(relayUrl),
        listBannedPubkeys(relayUrl),
      ]);

      if (allowRes.error && banRes.error) {
        setNip86Error(allowRes.error || banRes.error || "Failed to fetch lists");
        setNip86Syncing(false);
        return;
      }

      let allowedPubkeys: string[] = [];
      let bannedPubkeys: string[] = [];

      if (allowRes.result) {
        const rawEntries = allowRes.result as unknown[];
        // One entry per person: relay.tools stores a row each time someone is
        // allowed and lists them all (lib/access-list.ts).
        const read = readAccessList(rawEntries);
        allowedPubkeys = read.pubkeys;
        setRelayCopies((c) => ({ ...c, allow: read }));
        setAllowlist(allowedPubkeys);
        saveStoredList(ADMIN_ALLOWLIST_KEY, relayUrl, allowedPubkeys);
        const addedAtMap = extractAddedAtMap(rawEntries);
        if (Object.keys(addedAtMap).length > 0) {
          recordDateAddedHistorical(relayUrl, "allow", addedAtMap);
        }
      }
      if (banRes.result) {
        const rawEntries = banRes.result as unknown[];
        const read = readAccessList(rawEntries);
        bannedPubkeys = read.pubkeys;
        setRelayCopies((c) => ({ ...c, block: read }));
        setBlocklist(bannedPubkeys);
        saveStoredList(ADMIN_BLOCKLIST_KEY, relayUrl, bannedPubkeys);
        const addedAtMap = extractAddedAtMap(rawEntries);
        if (Object.keys(addedAtMap).length > 0) {
          recordDateAddedHistorical(relayUrl, "block", addedAtMap);
        }
      }
      setNip86LastSync(Date.now());

      if (allowedPubkeys.length > 0 || bannedPubkeys.length > 0) {
        const moderators: string[] = [];
        if (nip11?.pubkey && /^[0-9a-f]{64}$/i.test(nip11.pubkey)) moderators.push(nip11.pubkey.toLowerCase());
        if (nip11?.moderators) {
          for (const m of nip11.moderators) {
            if (typeof m === "string" && /^[0-9a-f]{64}$/i.test(m)) {
              const lower = m.toLowerCase();
              if (!moderators.includes(lower)) moderators.push(lower);
            }
          }
        }
        fetchNip86History(relayUrl, {
          moderators,
          allowPubkeys: allowedPubkeys,
          banPubkeys: bannedPubkeys,
        }).then(({ allow, ban }) => {
          if (syncRequestRef.current !== requestId) return;
          if (Object.keys(allow).length > 0) {
            recordDateAddedHistorical(relayUrl, "allow", allow);
          }
          if (Object.keys(ban).length > 0) {
            recordDateAddedHistorical(relayUrl, "block", ban);
          }
        }).catch(() => {});
      }
    } catch (err) {
      setNip86Error(err instanceof Error ? err.message : "Sync failed");
    }
    setNip86Syncing(false);
  }, [relayUrl, nip11]);

  const [probeRun, setProbeRun] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setNip86Status(null);
    checkNip86Support(relayUrl).then(status => {
      if (cancelled) return;
      setNip86Status(status);
      if (status === "supported") {
        syncFromRelay();
      }
    });
    return () => { cancelled = true; };
  }, [relayUrl, syncFromRelay, probeRun]);

  // (The team used to be merged into this list in this browser, inflating
  // "Allowed" with people the relay never allowed. Community › Team is the
  // team now; the allow list is only what the relay says — owner, 2026-10-04.)

  const handleProfileFound = useCallback((hex: string, profile: ProfileInfo) => {
    profileCacheGlobal.set(hex, profile);
    setProfileCache(prev => ({ ...prev, [hex]: profile }));
  }, []);

  const resolveProfile = useCallback(async (hex: string) => {
    if (profileCacheGlobal.has(hex)) {
      setProfileCache(prev => {
        if (prev[hex]) return prev;
        return { ...prev, [hex]: profileCacheGlobal.get(hex)! };
      });
      return;
    }
    const profiles = await resolveProfileBatch([hex]);
    const p = profiles.get(hex);
    if (p) {
      setProfileCache(prev => ({ ...prev, [hex]: p }));
    }
  }, []);

  useEffect(() => {
    [...allowlist, ...readonlyList, ...blocklist].forEach(hex => resolveProfile(hex));
  }, [allowlist, readonlyList, blocklist, resolveProfile]);

  const addToListDirect = useCallback(async (type: AccessLevel, rawInput: string) => {
    const hex = npubToHex(rawInput);
    if (!hex) {
      toast({ title: "Invalid input", description: "That doesn't look like someone's profile link.", variant: "destructive" });
      return;
    }
    const keyMap: Record<AccessLevel, string> = { allow: ADMIN_ALLOWLIST_KEY, readonly: ADMIN_READONLY_KEY, block: ADMIN_BLOCKLIST_KEY };
    const listMap: Record<AccessLevel, string[]> = { allow: allowlist, readonly: readonlyList, block: blocklist };
    const setterMap: Record<AccessLevel, React.Dispatch<React.SetStateAction<string[]>>> = { allow: setAllowlist, readonly: setReadonlyList, block: setBlocklist };
    const clearMap: Record<AccessLevel, React.Dispatch<React.SetStateAction<string>>> = { allow: setNewAllow, readonly: setNewReadonly, block: setNewBlock };
    if (listMap[type].includes(hex)) {
      toast({ title: "Already listed", description: "They're already on the list." });
      return;
    }

    let syncedToRelay = false;
    if (nip86Status === "supported" && (type === "allow" || type === "block")) {
      try {
        const apiFn = type === "allow" ? allowPubkey : banPubkey;
        const res = await apiFn(relayUrl, hex);
        if (res.error) {
          toast({ title: "Your host didn't take that", description: res.error, variant: "destructive" });
          return;
        }
        syncedToRelay = true;
      } catch (err) {
        toast({ title: "Your host didn't take that", description: err instanceof Error ? err.message : "We couldn't reach your host", variant: "destructive" });
        return;
      }
    }

    const updated = [...listMap[type], hex];
    setterMap[type](updated);
    saveStoredList(keyMap[type], relayUrl, updated);
    recordDateAdded(relayUrl, type, hex);
    clearMap[type]("");
    const actionMap: Record<AccessLevel, ModAction> = { allow: "add_allowlist", readonly: "add_readonly", block: "add_blocklist" };
    addModLogEntry(relayUrl, { action: actionMap[type], targetPubkey: hex });
    setModLog(getModLog(relayUrl));
    const labels: Record<AccessLevel, string> = { allow: "allowlist", readonly: "read-only list", block: "blocklist" };
    if (!syncedToRelay && (type === "allow" || type === "block")) {
      // This used to be a plain success toast. An operator banning someone
      // while the relay's HTTP endpoint was down was told "Added to blocklist"
      // and nothing had left the browser.
      toast({
        title: `Added locally — not synced`,
        description: `${hex.slice(0, 8)}... ${unsyncedReason(nip86Status)}`,
        variant: nip86Status === "unreachable" ? "destructive" : undefined,
      });
    } else {
      toast({ title: `Added to ${labels[type]}`, description: `${hex.slice(0, 8)}...${syncedToRelay ? " (your host has it)" : " added."}` });
    }
    if (profileCacheGlobal.has(hex)) {
      setProfileCache(prev => ({ ...prev, [hex]: profileCacheGlobal.get(hex)! }));
    } else {
      resolveProfile(hex);
    }
  }, [allowlist, readonlyList, blocklist, relayUrl, toast, resolveProfile, nip86Status]);

  const addToList = useCallback((type: AccessLevel) => {
    const inputMap: Record<AccessLevel, string> = { allow: newAllow, readonly: newReadonly, block: newBlock };
    addToListDirect(type, inputMap[type]);
  }, [newAllow, newReadonly, newBlock, addToListDirect]);

  /**
   * Remove many at once (select mode). One capability check, then one call
   * per person (relay.tools deletes all of a person's copies in one call),
   * a few at a time; the list updates once at the end with who actually went.
   */
  const removeMany = useCallback(async (hexes: string[], type: AccessLevel, onProgress: (done: number) => void): Promise<void> => {
    const keyMap: Record<AccessLevel, string> = { allow: ADMIN_ALLOWLIST_KEY, readonly: ADMIN_READONLY_KEY, block: ADMIN_BLOCKLIST_KEY };
    const setterMap: Record<AccessLevel, React.Dispatch<React.SetStateAction<string[]>>> = { allow: setAllowlist, readonly: setReadonlyList, block: setBlocklist };
    const remote = nip86Status === "supported" && (type === "allow" || type === "block");
    if (remote) {
      const caps = await fetchRelayCapabilities(relayUrl);
      if (!canDo(caps, type === "allow" ? "unallow" : "unban")) {
        const where = managedAt(relayUrl);
        toast({ title: type === "allow" ? "Your host can't remove people from the allow list here" : "Your host can't lift bans here", description: where.url ? `Do it at ${where.name}.` : `Do it in ${where.name}.` });
        return;
      }
    }
    const gone: string[] = [];
    const failed: string[] = [];
    let done = 0;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, hexes.length) }, async () => {
      while (next < hexes.length) {
        const hex = hexes[next++];
        let ok = true;
        if (remote) {
          try { const res = await (type === "allow" ? unallowPubkey : unbanPubkey)(relayUrl, hex); if (res.error) { ok = false; failed.push(res.error); } }
          catch (err) { ok = false; failed.push(err instanceof Error ? err.message : "couldn't reach your host"); }
        }
        if (ok) gone.push(hex);
        onProgress(++done);
      }
    }));
    const goneSet = new Set(gone);
    setterMap[type]((prev) => { const updated = prev.filter((p) => !goneSet.has(p)); saveStoredList(keyMap[type], relayUrl, updated); return updated; });
    for (const hex of gone) removeDateAdded(relayUrl, type, hex);
    const actionMap: Record<AccessLevel, ModAction> = { allow: "remove_allowlist", readonly: "remove_readonly", block: "remove_blocklist" };
    for (const hex of gone) addModLogEntry(relayUrl, { action: actionMap[type], targetPubkey: hex });
    setModLog(getModLog(relayUrl));
    if (remote) setRelayCopies((c) => {
      const key = type === "allow" ? "allow" : "block";
      const cur = c[key];
      if (!cur) return c;
      const copies = { ...cur.copies };
      for (const hex of gone) delete copies[hex];
      return { ...c, [key]: { ...cur, pubkeys: cur.pubkeys.filter((p) => !goneSet.has(p)), copies, extraRows: Object.values(copies).reduce((n, k) => n + k - 1, 0) } };
    });
    const labels: Record<AccessLevel, string> = { allow: "the allow list", readonly: "the read-only list", block: "the ban list" };
    if (failed.length) toast({ title: `Removed ${gone.length} of ${hexes.length}`, description: `Your host turned down ${failed.length}: ${failed[0]}`, variant: "destructive" });
    else toast({ title: `Removed ${gone.length} from ${labels[type]}`, description: remote ? "Your host has the change." : undefined });
  }, [relayUrl, nip86Status, toast]);

  /**
   * Leave one copy of each person the relay holds more than once: remove them
   * (which deletes every copy) and allow them again once, with their reason.
   */
  const [tidying, setTidying] = useState<{ done: number; total: number } | null>(null);
  const tidyCopies = useCallback(async (type: "allow" | "block") => {
    const read = relayCopies[type];
    if (!read) return;
    const people = Object.keys(read.copies);
    setTidying({ done: 0, total: people.length });
    let done = 0, lost = 0;
    for (const hex of people) {
      const out = await (type === "allow" ? unallowPubkey : unbanPubkey)(relayUrl, hex);
      if (!out.error) {
        const back = await (type === "allow" ? allowPubkey : banPubkey)(relayUrl, hex, read.reasons[hex] ?? "");
        if (back.error) lost++;
      }
      setTidying({ done: ++done, total: people.length });
    }
    setTidying(null);
    await syncFromRelay();
    if (lost) toast({ title: `Tidied ${people.length - lost} of ${people.length}`, description: `${lost} couldn't be added back — they're off the list now. Add them again from the search above.`, variant: "destructive" });
    else toast({ title: "Tidied up", description: `Each of ${people.length} ${people.length === 1 ? "person is" : "people are"} on your host's list once now.` });
  }, [relayCopies, relayUrl, toast, syncFromRelay]);

  const removeFromList = useCallback(async (hex: string, type: AccessLevel) => {
    let syncedToRelay = false;
    if (nip86Status === "supported" && (type === "allow" || type === "block")) {
      // Some relays can't lift a ban or an allow at all (pyramid); say where
      // it's done instead of sending a call that can only fail.
      const caps = await fetchRelayCapabilities(relayUrl);
      if (!canDo(caps, type === "allow" ? "unallow" : "unban")) {
        const where = managedAt(relayUrl);
        toast({
          title: type === "allow" ? "Your host can't remove people from the allow list here" : "Your host can't lift bans here",
          description: where.url ? `Do it at ${where.name}.` : `Do it in ${where.name}.`,
        });
        return;
      }
      try {
        const apiFn = type === "allow" ? unallowPubkey : unbanPubkey;
        const res = await apiFn(relayUrl, hex);
        if (res.error) {
          toast({ title: "Your host didn't take that", description: res.error, variant: "destructive" });
          return;
        }
        syncedToRelay = true;
      } catch (err) {
        toast({ title: "Your host didn't take that", description: err instanceof Error ? err.message : "We couldn't reach your host", variant: "destructive" });
        return;
      }
    }

    const keyMap: Record<AccessLevel, string> = { allow: ADMIN_ALLOWLIST_KEY, readonly: ADMIN_READONLY_KEY, block: ADMIN_BLOCKLIST_KEY };
    const listMap: Record<AccessLevel, string[]> = { allow: allowlist, readonly: readonlyList, block: blocklist };
    const setterMap: Record<AccessLevel, React.Dispatch<React.SetStateAction<string[]>>> = { allow: setAllowlist, readonly: setReadonlyList, block: setBlocklist };
    const updated = listMap[type].filter(p => p !== hex);
    setterMap[type](updated);
    saveStoredList(keyMap[type], relayUrl, updated);
    removeDateAdded(relayUrl, type, hex);
    const actionMap: Record<AccessLevel, ModAction> = { allow: "remove_allowlist", readonly: "remove_readonly", block: "remove_blocklist" };
    addModLogEntry(relayUrl, { action: actionMap[type], targetPubkey: hex });
    setModLog(getModLog(relayUrl));
    const labels: Record<AccessLevel, string> = { allow: "allowlist", readonly: "read-only list", block: "blocklist" };
    if (syncedToRelay) {
      toast({ title: `Removed from ${labels[type]}`, description: `${hex.slice(0, 8)}... removed (your host has it).` });
    } else if ((type === "allow" || type === "block") && nip86Status !== "supported") {
      toast({
        title: "Removed locally — not synced",
        description: `${hex.slice(0, 8)}... ${unsyncedReason(nip86Status)}`,
        variant: nip86Status === "unreachable" ? "destructive" : undefined,
      });
    } else {
      toast({ title: `Removed from ${labels[type]}`, description: `${hex.slice(0, 8)}... removed.` });
    }
  }, [allowlist, readonlyList, blocklist, relayUrl, nip86Status, toast]);

  const exportList = useCallback((type: AccessLevel) => {
    const listMap: Record<AccessLevel, string[]> = { allow: allowlist, readonly: readonlyList, block: blocklist };
    const npubs = listMap[type].map(hex => pubkeyToNpub(hex));
    const blob = new Blob([npubs.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}list.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [allowlist, readonlyList, blocklist]);

  // Import reaches the relay, after asking (owner, 2026-10-04): it used to
  // merge into this browser only, while the team log said it had happened.
  // The setup checklist's "Who can post" item: you looked, and it's right.
  const [wcpConfirmed, setWcpConfirmed] = useState(() => { try { return localStorage.getItem(`ro_setup_wcp_${relayUrl}`) === "1"; } catch { return false; } });
  const [pendingImport, setPendingImport] = useState<{ type: "allow" | "block"; add: string[]; already: number; unreadable: number } | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const importList = useCallback((type: AccessLevel) => {
    if (type === "readonly") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.csv";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const read = readImportFile(await file.text(), type === "allow" ? allowlist : blocklist);
      setPendingImport({ type, ...read });
    };
    input.click();
  }, [allowlist, blocklist]);

  const runImport = useCallback(async () => {
    const job = pendingImport;
    if (!job || job.add.length === 0) { setPendingImport(null); return; }
    setPendingImport(null);
    const apiFn = job.type === "allow" ? allowPubkey : banPubkey;
    const done: string[] = [];
    let refused = 0;
    let firstError = "";
    setImporting({ done: 0, total: job.add.length });
    for (const hex of job.add) {
      try {
        const res = await apiFn(relayUrl, hex);
        if (res.error) { refused++; firstError ||= res.error; } else done.push(hex);
      } catch (err) {
        refused++; firstError ||= err instanceof Error ? err.message : "Your host didn't answer";
      }
      setImporting({ done: done.length + refused, total: job.add.length });
    }
    setImporting(null);
    const keyMap = { allow: ADMIN_ALLOWLIST_KEY, block: ADMIN_BLOCKLIST_KEY } as const;
    const current = job.type === "allow" ? allowlist : blocklist;
    const merged = [...new Set([...current, ...done])];
    (job.type === "allow" ? setAllowlist : setBlocklist)(merged);
    saveStoredList(keyMap[job.type], relayUrl, merged);
    recordDateAddedMany(relayUrl, job.type, done);
    if (done.length) {
      addModLogEntry(relayUrl, { action: job.type === "allow" ? "import_allowlist" : "import_blocklist", count: done.length });
      setModLog(getModLog(relayUrl));
    }
    const what = job.type === "allow" ? "the allow list" : "the ban list";
    toast({
      title: refused === 0 ? `Added ${done.length} to ${what}` : `Added ${done.length} of ${job.add.length} to ${what}`,
      description: refused ? `Your host turned down ${refused}: ${firstError}` : undefined,
      variant: refused && !done.length ? "destructive" : undefined,
    });
  }, [pendingImport, relayUrl, allowlist, blocklist, toast]);

  // The read-only list was only ever kept in this browser — no relay used it.
  // It's gone; what was on it can be saved once, then it's cleared.
  const exportReadonly = useCallback(() => {
    const npubs = readonlyList.map((hex) => pubkeyToNpub(hex));
    const blob = new Blob([npubs.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "read-only-list.txt";
    a.click();
    URL.revokeObjectURL(url);
    saveStoredList(ADMIN_READONLY_KEY, relayUrl, []);
    setReadonlyList([]);
  }, [readonlyList, relayUrl]);

  // ── Web of Trust access control ──────────────────────────────────────
  // Build the relay's allowlist from the operator's web of trust (Brainstorm):
  // a snapshot of trusted pubkeys (≥ chosen tier), applied via NIP-86. Optionally
  // ban flagged accounts. Not a live filter — refreshable on demand.
  const { pubkey: operatorPubkey } = useNostrAuth();
  const [wotTier, setWotTier] = useState<"strong" | "moderate" | "low" | "weak">("moderate");
  const [wotBanFlagged, setWotBanFlagged] = useState(false);
  const [wotPreview, setWotPreview] = useState<{ trusted: string[]; flagged: string[]; alreadyAllowed: number; alreadyBanned: number } | null>(null);
  const [wotBusy, setWotBusy] = useState<null | "building" | "applying">(null);
  const [wotProgress, setWotProgress] = useState<{ done: number; total: number } | null>(null);
  const WOT_TIERS: { tier: "strong" | "moderate" | "low" | "weak"; label: string }[] = [
    { tier: "strong", label: "Highly trusted" },
    { tier: "moderate", label: "Trusted" },
    { tier: "low", label: "Neutral" },
    { tier: "weak", label: "Any score" },
  ];
  const WOT_CAP = 500;

  const buildWot = useCallback(async () => {
    if (!operatorPubkey) return;
    setWotBusy("building");
    setWotPreview(null);
    try {
      const res = await fetchConnectionScores(operatorPubkey);
      if (!res) {
        toast({ title: "Couldn't load your web of trust", description: "Approve the signing request with your key, then try again.", variant: "destructive" });
        return;
      }
      const cutoff = getActiveThresholds()[wotTier];
      const trusted = Array.from(res.scores.entries())
        .filter(([pk, inf]) => inf >= cutoff && pk !== operatorPubkey)
        .map(([pk]) => pk);
      const flagged = wotBanFlagged ? Array.from(res.flaggedPubkeys || []).filter((pk) => pk !== operatorPubkey) : [];
      // Only people not on the list yet. Allowing someone twice makes some
      // relays (relay.tools) store them twice — and a second build used to
      // resend the same first 500 every time.
      const [onAllow, onBan] = await Promise.all([listAllowedPubkeys(relayUrl), listBannedPubkeys(relayUrl)]);
      const allowedNow = onAllow.result ? readAccessList(onAllow.result as unknown[]).pubkeys : allowlist;
      const bannedNow = onBan.result ? readAccessList(onBan.result as unknown[]).pubkeys : blocklist;
      const newTrusted = notYetOn(trusted, allowedNow);
      const newFlagged = notYetOn(flagged, bannedNow);
      setWotPreview({ trusted: newTrusted, flagged: newFlagged, alreadyAllowed: trusted.length - newTrusted.length, alreadyBanned: flagged.length - newFlagged.length });
      if (trusted.length === 0) toast({ title: "No accounts at that tier", description: "Try a lower minimum tier." });
    } finally {
      setWotBusy(null);
    }
  }, [operatorPubkey, wotTier, wotBanFlagged, toast, relayUrl, allowlist, blocklist]);

  const applyWot = useCallback(async () => {
    if (!wotPreview) return;
    const trusted = wotPreview.trusted.slice(0, WOT_CAP);
    const flagged = wotPreview.flagged.slice(0, WOT_CAP);
    const total = trusted.length + flagged.length;
    if (total === 0) return;
    setWotBusy("applying");
    setWotProgress({ done: 0, total });
    let done = 0, allowed = 0, banned = 0, failed = 0;
    // Bounded concurrency — NIP-86 is one call per pubkey.
    const runLimited = async (items: string[], fn: (pk: string) => Promise<boolean>, conc = 5) => {
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
        while (i < items.length) {
          const ok = await fn(items[i++]);
          if (ok === false) failed++;
          done++;
          setWotProgress({ done, total });
        }
      }));
    };
    await runLimited(trusted, async (pk) => {
      const r = await allowPubkey(relayUrl, pk, `Web of Trust · ${wotTier}+`);
      if (r.error) return false;
      allowed++;
      return true;
    });
    if (flagged.length) {
      await runLimited(flagged, async (pk) => {
        const r = await banPubkey(relayUrl, pk, "Flagged by web of trust");
        if (r.error) return false;
        banned++;
        return true;
      });
    }
    if (allowed > 0) {
      const merged = Array.from(new Set([...getStoredList(ADMIN_ALLOWLIST_KEY, relayUrl), ...trusted]));
      setAllowlist(merged);
      saveStoredList(ADMIN_ALLOWLIST_KEY, relayUrl, merged);
      recordDateAddedMany(relayUrl, "allow", trusted);
      addModLogEntry(relayUrl, { action: "import_allowlist", count: allowed, note: `Web of Trust · tier ≥ ${wotTier}` });
    }
    if (banned > 0) {
      const merged = Array.from(new Set([...getStoredList(ADMIN_BLOCKLIST_KEY, relayUrl), ...flagged]));
      setBlocklist(merged);
      saveStoredList(ADMIN_BLOCKLIST_KEY, relayUrl, merged);
      recordDateAddedMany(relayUrl, "block", flagged);
      addModLogEntry(relayUrl, { action: "import_blocklist", count: banned, note: "Flagged by web of trust" });
    }
    setModLog(getModLog(relayUrl));
    setWotBusy(null);
    setWotProgress(null);
    setWotPreview(null);
    toast({ title: "Web of Trust applied", description: `${allowed} allowed${banned ? `, ${banned} banned` : ""}${failed ? `, ${failed} failed` : ""}.` });
  }, [wotPreview, relayUrl, wotTier, toast]);

  const modActionCount = useMemo(() => {
    const deletes = modLog.filter(e => e.action === "delete_event" || e.action === "bulk_delete").length;
    const blocks = modLog.filter(e => e.action === "block_author" || e.action === "add_blocklist").length;
    const healthIssues = modLog.filter(e => e.action === "relay_offline" || e.action === "relay_latency_spike").length;
    return { deletes, blocks, healthIssues, total: modLog.length };
  }, [modLog]);

  return (
    <div className="space-y-4">
      {/* Where the lists live, as one quiet line. A relay that answers its
          management API holds them; otherwise they stay in this browser, and
          the line says which — "couldn't reach" and "doesn't have one" are
          different facts with different next steps. */}
      {part === "rules" && <>
      {(() => {
        // Who may post is the host's setting; apps can only read it (NIP-11 limitation).
        const lim = nip11?.limitation;
        const rule = !nip11
          ? "We couldn't read your community's rules right now."
          : lim?.restricted_writes ? `Only approved people can post here${lim.auth_required ? ", after signing in" : ""}.`
          : lim?.payment_required ? `People pay to post here${lim.auth_required ? ", after signing in" : ""}.`
          : lim?.auth_required ? "Anyone who signs in can post here."
          : "Anyone can post here.";
        return (
          <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 space-y-1" data-testid="ops-who-can-post-status">
            <p className="text-[15px] font-medium">{rule}</p>
            <ManagedAtNote where={managedAt(relayUrl)} lead="Your host sets who may post." verb="Change it" testId="ops-who-can-post-host" />
            {nip11 && !wcpConfirmed && (
              <Button variant="outline" size="sm" className="mt-2 h-10 rounded-full px-4" onClick={() => { setSetupFlag("wcp", relayUrl); setWcpConfirmed(true); }} data-testid="ops-who-can-post-confirm">This is how I want it</Button>
            )}
          </div>
        );
      })()}

      <div className="flex flex-wrap gap-2" data-testid="ops-access-strip">
        <button type="button" onClick={() => onOpenPeople?.("allowed")} className="min-h-[44px] inline-flex items-center gap-2 rounded-full border border-black/[0.1] dark:border-white/[0.12] px-4 text-[14px] hover:border-brand/40" data-testid="ops-access-stat-allowed">
          Approved <span className="font-semibold tabular-nums text-success dark:text-emerald-400">{allowlist.length.toLocaleString()}</span>
        </button>
        <button type="button" onClick={() => onOpenPeople?.("banned")} className="min-h-[44px] inline-flex items-center gap-2 rounded-full border border-black/[0.1] dark:border-white/[0.12] px-4 text-[14px] hover:border-brand/40" data-testid="ops-access-stat-blocked">
          Banned <span className="font-semibold tabular-nums text-danger dark:text-red-400">{blocklist.length.toLocaleString()}</span>
        </button>
      </div>

      {nip86Status === "supported" && operatorPubkey && (
        <Card className="glass-card border-brand/25 dark:border-brand/15 p-3 sm:p-4">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-brand mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground/90">Web of Trust access</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/60">
                Build your allowlist from the people your network trusts (Brainstorm). A snapshot you can refresh — not a live filter.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">Minimum tier</span>
                {WOT_TIERS.map(({ tier, label }) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => { setWotTier(tier); setWotPreview(null); }}
                    className={`inline-flex items-center justify-center rounded-full border px-3 min-h-[40px] sm:min-h-0 sm:px-2.5 sm:py-1 text-[11px] font-medium transition-colors ${tier === wotTier ? "border-brand/40 bg-brand/15 text-brand" : "border-border/50 text-muted-foreground/70 hover:border-brand/30 hover:text-foreground"}`}
                    data-testid={`wot-tier-${tier}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="mt-1 flex w-fit items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0 sm:mt-2.5 text-[11px] text-muted-foreground/75">
                <input type="checkbox" checked={wotBanFlagged} onChange={(e) => { setWotBanFlagged(e.target.checked); setWotPreview(null); }} className="accent-brand w-4 h-4" data-testid="wot-ban-flagged" />
                Also ban flagged accounts
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={buildWot} disabled={wotBusy !== null} data-testid="wot-build">
                  {wotBusy === "building" ? (<><RelayOutpostInlineLoader className="w-3 h-3 mr-1.5" /> Reading…</>) : (<><ShieldCheck className="w-3 h-3 mr-1.5" /> Build from Web of Trust</>)}
                </Button>
                {wotPreview && wotBusy !== "applying" && (wotPreview.trusted.length + wotPreview.flagged.length) > 0 && (
                  <Button size="sm" className="h-7 text-xs bg-brand hover:bg-brand text-white" onClick={applyWot} data-testid="wot-apply">
                    Apply — allow {Math.min(wotPreview.trusted.length, WOT_CAP)}{wotPreview.flagged.length ? `, ban ${Math.min(wotPreview.flagged.length, WOT_CAP)}` : ""}
                  </Button>
                )}
                {wotBusy === "applying" && wotProgress && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                    <RelayOutpostInlineLoader className="w-3 h-3" /> Applying {wotProgress.done}/{wotProgress.total}…
                  </span>
                )}
              </div>
              {wotPreview && wotBusy === null && (
                <p className="mt-2 text-[11px] text-muted-foreground/55" data-testid="wot-preview">
                  {wotPreview.trusted.length + wotPreview.flagged.length === 0
                    ? "Everyone at this tier is already on your list."
                    : <>
                        {wotPreview.trusted.length} new trusted account{wotPreview.trusted.length === 1 ? "" : "s"} to allow
                        {wotPreview.alreadyAllowed ? ` · ${wotPreview.alreadyAllowed} already on your list` : ""}
                        {wotPreview.flagged.length ? ` · ${wotPreview.flagged.length} flagged to ban` : ""}
                        {(wotPreview.trusted.length > WOT_CAP || wotPreview.flagged.length > WOT_CAP) ? ` · applying the first ${WOT_CAP}; build again for the rest` : ""}.
                      </>}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {readonlyList.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-4 py-3" data-testid="ops-readonly-retired">
          <p className="text-[13px] flex-1 min-w-[200px]">Your read-only list ({readonlyList.length}) was only kept in this browser — no relay used it, so it's gone. Save it if you want it.</p>
          <Button variant="outline" className="h-11 rounded-full" onClick={exportReadonly} data-testid="ops-readonly-export">Save the list</Button>
        </div>
      )}

      </>}

      {part === "lists" && <>
      {nip86Status && (
        <p
          className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground leading-snug"
          data-testid="ops-access-status"
          data-state={nip86Status}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              nip86Status === "supported" ? (nip86Error ? "bg-amber-400" : "bg-emerald-500") : nip86Status === "unreachable" ? "bg-amber-400" : "bg-muted-foreground/40"
            }`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            {nip86Status === "supported" && (
              <>
                Kept by your host
                {nip86Syncing ? " · checking…" : nip86Error ? ` · ${nip86Error}` : nip86LastSync ? ` · checked ${new Date(nip86LastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
              </>
            )}
            {nip86Status === "advertised_but_nonfunctional" && "Your host says apps can manage these lists but didn't answer, so they're kept in this browser."}
            {nip86Status === "not_supported" && "Your host doesn't let apps manage these lists, so they're kept in this browser."}
            {nip86Status === "unreachable" && "Couldn't reach your host. Changes stay in this browser until it answers."}
          </span>
          {nip86Status === "supported" && (
            <button
              type="button"
              onClick={syncFromRelay}
              disabled={nip86Syncing}
              className="shrink-0 inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-2 py-1 rounded-full text-[13px] text-brand hover:bg-brand/[0.06] disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${nip86Syncing ? "animate-spin" : ""}`} aria-hidden="true" />Refresh
            </button>
          )}
          {nip86Status === "unreachable" && (
            <button
              type="button"
              onClick={() => setProbeRun((n) => n + 1)}
              className="shrink-0 inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-2 py-1 rounded-full text-[13px] text-brand hover:bg-brand/[0.06]"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />Try again
            </button>
          )}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4">
        {only !== "block" && <PubkeyListSection
          type="allow"
          icon={<UserCheck className="w-3.5 h-3.5 text-green-600 dark:text-green-400/70" />}
          label="Allowed to post"
          labelClass="text-success dark:text-green-300/80"
          description="Where only approved people can post, these are the approved people."
          borderClass="border-green-400/25 dark:border-green-400/15"
          badgeClass="border-green-400/30 dark:border-green-400/20 text-success dark:text-green-400/70"
          list={allowlist}
          inputValue={newAllow}
          setInput={setNewAllow}
          buttonLabel="Add"
          profileCache={profileCache}
          onRemove={removeFromList}
          onRemoveMany={removeMany}
          relayList={relayCopies.allow}
          onTidy={nip86Status === "supported" ? () => void tidyCopies("allow") : undefined}
          tidying={tidying}
          onAddDirect={addToListDirect}
          onAdd={addToList}
          onExport={exportList}
          onImport={nip86Status === "supported" ? importList : undefined}
          onProfileFound={handleProfileFound}
          relayUrl={relayUrl}
          listKey="allow"
          controlsKey="access-allow"
        />}
      </div>
      {only !== "allow" && <PubkeyListSection
        type="block"
        icon={<UserX className="w-3.5 h-3.5 text-red-600/80 dark:text-red-400/70" />}
        label="Banned"
        labelClass="text-red-700 dark:text-red-300/80"
        description="Can't post here. What they posted before stays unless you remove it."
        borderClass="border-red-400/25 dark:border-red-400/15"
        badgeClass="border-red-400/30 dark:border-red-400/20 text-red-600 dark:text-red-400/70"
        list={blocklist}
        inputValue={newBlock}
        setInput={setNewBlock}
        buttonLabel="Block"
        buttonClass="bg-red-500/20 text-red-700 dark:text-red-300 hover:bg-red-500/30 border border-red-400/40 dark:border-red-400/20"
        profileCache={profileCache}
        onRemove={removeFromList}
        onRemoveMany={removeMany}
        relayList={relayCopies.block}
        onTidy={nip86Status === "supported" ? () => void tidyCopies("block") : undefined}
        tidying={tidying}
        onAddDirect={addToListDirect}
        onAdd={addToList}
        onExport={exportList}
        onImport={nip86Status === "supported" ? importList : undefined}
        onProfileFound={handleProfileFound}
        relayUrl={relayUrl}
        listKey="block"
        controlsKey="access-block"
      />}
      {importing && (
        <p className="text-[13px] text-muted-foreground" role="status" data-testid="ops-import-progress">Adding {importing.done} of {importing.total}…</p>
      )}
      <AlertDialog open={!!pendingImport} onOpenChange={(o) => { if (!o) setPendingImport(null); }}>
        <AlertDialogContent data-testid="ops-import-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingImport && (pendingImport.add.length === 0
                ? "Nobody new in this file"
                : `${pendingImport.type === "allow" ? "Allow" : "Ban"} ${pendingImport.add.length} ${pendingImport.add.length === 1 ? "person" : "people"} on ${nip11?.name?.trim() || relayUrl.replace(/^wss?:\/\//, "")}?`)}
            </AlertDialogTitle>
            <AlertDialogDescription data-testid="ops-import-summary">
              {pendingImport && [
                pendingImport.add.length ? `Each is sent to your host${pendingImport.type === "block" ? " — they won't be able to post" : ""}.` : "",
                pendingImport.already ? `${pendingImport.already} already on the list.` : "",
                pendingImport.unreadable ? `${pendingImport.unreadable} ${pendingImport.unreadable === 1 ? "line" : "lines"} couldn't be read.` : "",
              ].filter(Boolean).join(" ")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">{pendingImport?.add.length ? "Cancel" : "Close"}</AlertDialogCancel>
            {!!pendingImport?.add.length && (
              <AlertDialogAction className="min-h-[44px]" onClick={() => void runImport()} data-testid="ops-import-go">
                {pendingImport.type === "allow" ? "Allow" : "Ban"} {pendingImport.add.length}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* The moderation log is one screen: Community › Moderation log (owner, 2026-10-04). */}
      </>}
    </div>
  );
}
