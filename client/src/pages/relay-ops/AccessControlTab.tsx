import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { Event as NostrEvent } from "nostr-tools";
import { searchCachedProfiles } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { type Nip11Document } from "@/lib/nip11";
import { copyNostrId } from "@/lib/clipboard-bridge";
import {
  checkNip86Support,
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
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { OpsCard, OpsSectionHeader } from "./ops-ui";
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
import { BadgeManagementPanel } from "@/components/BadgeManagement";
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

function PubkeyRow({ hex, type, profile, onRemove, addedAt, lastActiveSec, activityStatus }: {
  hex: string;
  type: AccessLevel;
  profile?: ProfileInfo;
  onRemove: (hex: string, type: AccessLevel) => void;
  addedAt?: number;
  lastActiveSec?: number;
  activityStatus: ActivityStatus;
}) {
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
        ? "Relay unreachable"
        : formatRelativeSec(lastActiveSec);
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
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 leading-tight">
          <span title={addedAt ? undefined : "We only started tracking add dates from now on."}>{addedLabel}</span>
          <span className="text-muted-foreground/30">·</span>
          <span>{activityLabel}</span>
        </div>
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

function PubkeyListSection({ type, icon, label, labelClass, description, borderClass, badgeClass, list, inputValue, setInput, buttonLabel, buttonClass, profileCache, onRemove, onAddDirect, onAdd, onExport, onImport, onProfileFound, relayUrl, listKey, controlsKey }: {
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
  relayUrl: string;
  listKey: string;
  controlsKey: string;
}) {
  const { controls, setQuery, setSort, setFilter } = useUrlListControls(controlsKey);
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
    return "couldn't be sent — we can't reach this relay's management API right now. The change is only in your local view; try again once the relay is back.";
  }
  return "was saved to your local view only. This relay doesn't expose a NIP-86 management API, so ask its operator to make the change server-side.";
}

export function AccessControlTab({ relayUrl, nip11 }: { relayUrl: string; nip11: Nip11Document | null }) {
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
        allowedPubkeys = rawEntries
          .map(e => typeof e === "string" ? e : (e as PubkeyEntry).pubkey)
          .filter((p): p is string => typeof p === "string" && /^[0-9a-f]{64}$/i.test(p))
          .map(p => p.toLowerCase());
        setAllowlist(allowedPubkeys);
        saveStoredList(ADMIN_ALLOWLIST_KEY, relayUrl, allowedPubkeys);
        const addedAtMap = extractAddedAtMap(rawEntries);
        if (Object.keys(addedAtMap).length > 0) {
          recordDateAddedHistorical(relayUrl, "allow", addedAtMap);
        }
      }
      if (banRes.result) {
        const rawEntries = banRes.result as unknown[];
        bannedPubkeys = rawEntries
          .map(e => typeof e === "string" ? e : (e as PubkeyEntry).pubkey)
          .filter((p): p is string => typeof p === "string" && /^[0-9a-f]{64}$/i.test(p))
          .map(p => p.toLowerCase());
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

  useEffect(() => {
    let cancelled = false;
    checkNip86Support(relayUrl).then(status => {
      if (cancelled) return;
      setNip86Status(status);
      if (status === "supported") {
        syncFromRelay();
      }
    });
    return () => { cancelled = true; };
  }, [relayUrl, syncFromRelay]);

  useEffect(() => {
    const teamPubkeys: string[] = [];
    if (nip11?.pubkey && /^[0-9a-f]{64}$/i.test(nip11.pubkey)) teamPubkeys.push(nip11.pubkey);
    if (nip11?.moderators) {
      for (const m of nip11.moderators) {
        if (/^[0-9a-f]{64}$/i.test(m) && !teamPubkeys.includes(m)) teamPubkeys.push(m);
      }
    }
    const manualMembers = getStoredList(MANUAL_TEAM_KEY, relayUrl);
    for (const pk of manualMembers) {
      if (/^[0-9a-f]{64}$/i.test(pk) && !teamPubkeys.includes(pk)) teamPubkeys.push(pk);
    }
    if (teamPubkeys.length === 0) return;

    setAllowlist(prev => {
      const merged = [...prev];
      let changed = false;
      for (const pk of teamPubkeys) {
        if (!merged.includes(pk)) {
          merged.push(pk);
          changed = true;
        }
      }
      if (changed) {
        saveStoredList(ADMIN_ALLOWLIST_KEY, relayUrl, merged);
      }
      return changed ? merged : prev;
    });
  }, [nip11, relayUrl]);

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
      toast({ title: "Invalid input", description: "Enter a valid npub address or hex pubkey.", variant: "destructive" });
      return;
    }
    const keyMap: Record<AccessLevel, string> = { allow: ADMIN_ALLOWLIST_KEY, readonly: ADMIN_READONLY_KEY, block: ADMIN_BLOCKLIST_KEY };
    const listMap: Record<AccessLevel, string[]> = { allow: allowlist, readonly: readonlyList, block: blocklist };
    const setterMap: Record<AccessLevel, React.Dispatch<React.SetStateAction<string[]>>> = { allow: setAllowlist, readonly: setReadonlyList, block: setBlocklist };
    const clearMap: Record<AccessLevel, React.Dispatch<React.SetStateAction<string>>> = { allow: setNewAllow, readonly: setNewReadonly, block: setNewBlock };
    if (listMap[type].includes(hex)) {
      toast({ title: "Already listed", description: "This pubkey is already in the list." });
      return;
    }

    let syncedToRelay = false;
    if (nip86Status === "supported" && (type === "allow" || type === "block")) {
      try {
        const apiFn = type === "allow" ? allowPubkey : banPubkey;
        const res = await apiFn(relayUrl, hex);
        if (res.error) {
          toast({ title: "Relay API error", description: res.error, variant: "destructive" });
          return;
        }
        syncedToRelay = true;
      } catch (err) {
        toast({ title: "Relay API error", description: err instanceof Error ? err.message : "Failed to reach relay", variant: "destructive" });
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
      toast({ title: `Added to ${labels[type]}`, description: `${hex.slice(0, 8)}...${syncedToRelay ? " (synced to relay)" : " added."}` });
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

  const removeFromList = useCallback(async (hex: string, type: AccessLevel) => {
    let syncedToRelay = false;
    if (nip86Status === "supported" && (type === "allow" || type === "block")) {
      try {
        const apiFn = type === "allow" ? unallowPubkey : unbanPubkey;
        const res = await apiFn(relayUrl, hex);
        if (res.error) {
          toast({ title: "Relay API error", description: res.error, variant: "destructive" });
          return;
        }
        syncedToRelay = true;
      } catch (err) {
        toast({ title: "Relay API error", description: err instanceof Error ? err.message : "Failed to reach relay", variant: "destructive" });
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
      toast({ title: `Removed from ${labels[type]}`, description: `${hex.slice(0, 8)}... removed (synced to relay).` });
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

  const importList = useCallback((type: AccessLevel) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.csv";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const lines = text.split(/[\n,]/).map(l => l.trim()).filter(Boolean);
      const hexKeys = lines.map(l => npubToHex(l)).filter((h): h is string => h !== null);
      const keyMap: Record<AccessLevel, string> = { allow: ADMIN_ALLOWLIST_KEY, readonly: ADMIN_READONLY_KEY, block: ADMIN_BLOCKLIST_KEY };
      const listMap: Record<AccessLevel, string[]> = { allow: allowlist, readonly: readonlyList, block: blocklist };
      const setterMap: Record<AccessLevel, React.Dispatch<React.SetStateAction<string[]>>> = { allow: setAllowlist, readonly: setReadonlyList, block: setBlocklist };
      const merged = [...new Set([...listMap[type], ...hexKeys])];
      setterMap[type](merged);
      saveStoredList(keyMap[type], relayUrl, merged);
      recordDateAddedMany(relayUrl, type, hexKeys);
      const actionMap: Record<AccessLevel, ModAction> = { allow: "import_allowlist", readonly: "import_readonly", block: "import_blocklist" };
      addModLogEntry(relayUrl, { action: actionMap[type], count: hexKeys.length });
      setModLog(getModLog(relayUrl));
      toast({ title: "Imported", description: `${hexKeys.length} entries imported.` });
    };
    input.click();
  }, [allowlist, readonlyList, blocklist, relayUrl, toast]);

  // ── Web of Trust access control ──────────────────────────────────────
  // Build the relay's allowlist from the operator's web of trust (Brainstorm):
  // a snapshot of trusted pubkeys (≥ chosen tier), applied via NIP-86. Optionally
  // ban flagged accounts. Not a live filter — refreshable on demand.
  const { pubkey: operatorPubkey } = useNostrAuth();
  const [wotTier, setWotTier] = useState<"strong" | "moderate" | "low" | "weak">("moderate");
  const [wotBanFlagged, setWotBanFlagged] = useState(false);
  const [wotPreview, setWotPreview] = useState<{ trusted: string[]; flagged: string[] } | null>(null);
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
      setWotPreview({ trusted, flagged });
      if (trusted.length === 0) toast({ title: "No accounts at that tier", description: "Try a lower minimum tier." });
    } finally {
      setWotBusy(null);
    }
  }, [operatorPubkey, wotTier, wotBanFlagged, toast]);

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
      {nip86Status === "supported" && (
        <Card className="glass-card border-emerald-400/30 dark:border-emerald-400/15 p-2.5 sm:p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] sm:text-xs font-medium text-emerald-700 dark:text-emerald-400">
                NIP-86 Live Management
              </span>
              {nip86Syncing && (
                <RefreshCw className="w-3 h-3 text-emerald-500/70 animate-spin" />
              )}
              {nip86Error && (
                <span className="text-[10px] text-red-500 dark:text-red-400/80">{nip86Error}</span>
              )}
              {nip86LastSync && !nip86Syncing && !nip86Error && (
                <span className="text-[10px] text-muted-foreground/60">
                  synced {new Date(nip86LastSync).toLocaleTimeString()}
                </span>
              )}
            </div>
            <button
              onClick={syncFromRelay}
              disabled={nip86Syncing}
              className="text-[10px] px-2 py-0.5 rounded border border-emerald-400/30 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
            >
              {nip86Syncing ? "Syncing..." : "Refresh"}
            </button>
          </div>
        </Card>
      )}
      {nip86Status === "advertised_but_nonfunctional" && (
        <Card className="glass-card border-amber-400/30 dark:border-amber-400/15 p-2.5 sm:p-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] sm:text-xs font-medium text-amber-700 dark:text-amber-400 block">
                NIP-86 advertised but not responding
              </span>
              <span className="text-[10px] sm:text-[10px] text-amber-700/60 dark:text-amber-400/50 block leading-tight mt-0.5">
                Relay lists NIP-86 in its capabilities but returned HTML instead of JSON-RPC. The relay software may need a separate NIP-86 HTTP handler. Using local-only mode.
              </span>
            </div>
          </div>
        </Card>
      )}
      {nip86Status === "not_supported" && (
        <Card className="glass-card border-amber-400/20 dark:border-amber-400/10 p-2.5 sm:p-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500/70" />
            <span className="text-[10px] sm:text-xs text-amber-700 dark:text-amber-400/80">
              Local-only mode — relay does not support NIP-86 management API
            </span>
          </div>
        </Card>
      )}
      {nip86Status === "unreachable" && (
        // Deliberately NOT the amber "local-only" card above. That one states a
        // fact about the relay; this one admits we don't have one, and the
        // difference matters because both silently route changes to
        // localStorage.
        <Card className="glass-card border-red-400/20 dark:border-red-400/10 p-2.5 sm:p-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500/70" />
            <span className="text-[10px] sm:text-xs text-red-700 dark:text-red-400/80">
              Can't reach this relay's management API — we don't know whether it supports NIP-86. Changes stay local until it answers.
            </span>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <Card className="glass-card border-green-400/20 dark:border-green-400/10 p-2.5 sm:p-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <UserCheck className="w-3 h-3 text-green-600 dark:text-green-400/70" />
            <span className="text-[10px] sm:text-[10px] text-muted-foreground/70 uppercase tracking-wide">Allowed</span>
          </div>
          <span className="text-base sm:text-lg font-mono font-semibold text-green-700 dark:text-green-400">{allowlist.length}</span>
        </Card>
        <Card className="glass-card border-blue-400/20 dark:border-blue-400/10 p-2.5 sm:p-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Globe className="w-3 h-3 text-blue-600 dark:text-blue-400/70" />
            <span className="text-[10px] sm:text-[10px] text-muted-foreground/70 uppercase tracking-wide">Read-Only</span>
          </div>
          <span className="text-base sm:text-lg font-mono font-semibold text-blue-700 dark:text-blue-400">{readonlyList.length}</span>
        </Card>
        <Card className="glass-card border-red-400/20 dark:border-red-400/10 p-2.5 sm:p-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <UserX className="w-3 h-3 text-red-600 dark:text-red-400/70" />
            <span className="text-[10px] sm:text-[10px] text-muted-foreground/70 uppercase tracking-wide">Blocked</span>
          </div>
          <span className="text-base sm:text-lg font-mono font-semibold text-red-700 dark:text-red-400">{blocklist.length}</span>
        </Card>
        <Card className="glass-card border-brand/20 dark:border-brand/10 p-2.5 sm:p-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Users className="w-3 h-3 text-brand dark:text-brand/70" />
            <span className="text-[10px] sm:text-[10px] text-muted-foreground/70 uppercase tracking-wide">Total</span>
          </div>
          <span className="text-base sm:text-lg font-mono font-semibold text-brand">{allowlist.length + readonlyList.length + blocklist.length}</span>
          {modActionCount.total > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
              <span className="text-[10px] text-amber-600/70 dark:text-amber-400/60">{modActionCount.total} actions</span>
            </div>
          )}
        </Card>
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
                <p className="mt-2 text-[11px] text-muted-foreground/55">
                  {wotPreview.trusted.length} trusted account{wotPreview.trusted.length === 1 ? "" : "s"} at this tier
                  {wotPreview.flagged.length ? ` · ${wotPreview.flagged.length} flagged` : ""}
                  {(wotPreview.trusted.length > WOT_CAP || wotPreview.flagged.length > WOT_CAP) ? ` · applying first ${WOT_CAP}` : ""}.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PubkeyListSection
          type="allow"
          icon={<UserCheck className="w-3.5 h-3.5 text-green-600 dark:text-green-400/70" />}
          label="Allowlist (Read + Write)"
          labelClass="text-green-700 dark:text-green-300/80"
          description="Full access — these users can read events from and publish events to the relay."
          borderClass="border-green-400/25 dark:border-green-400/15"
          badgeClass="border-green-400/30 dark:border-green-400/20 text-green-600 dark:text-green-400/70"
          list={allowlist}
          inputValue={newAllow}
          setInput={setNewAllow}
          buttonLabel="Add"
          profileCache={profileCache}
          onRemove={removeFromList}
          onAddDirect={addToListDirect}
          onAdd={addToList}
          onExport={exportList}
          onImport={importList}
          onProfileFound={handleProfileFound}
          relayUrl={relayUrl}
          listKey="allow"
          controlsKey="access-allow"
        />
        <PubkeyListSection
          type="readonly"
          icon={<Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400/70" />}
          label="Read-Only"
          labelClass="text-blue-700 dark:text-blue-300/80"
          description="Read access only — these users can read events but cannot publish to the relay."
          borderClass="border-blue-400/25 dark:border-blue-400/15"
          badgeClass="border-blue-400/30 dark:border-blue-400/20 text-blue-600 dark:text-blue-400/60"
          list={readonlyList}
          inputValue={newReadonly}
          setInput={setNewReadonly}
          buttonLabel="Add"
          buttonClass="bg-blue-500/20 text-blue-700 dark:text-blue-300 hover:bg-blue-500/30 border border-blue-400/30 dark:border-blue-400/20"
          profileCache={profileCache}
          onRemove={removeFromList}
          onAddDirect={addToListDirect}
          onAdd={addToList}
          onExport={exportList}
          onImport={importList}
          onProfileFound={handleProfileFound}
          relayUrl={relayUrl}
          listKey="readonly"
          controlsKey="access-readonly"
        />
      </div>
      <PubkeyListSection
        type="block"
        icon={<UserX className="w-3.5 h-3.5 text-red-600/80 dark:text-red-400/70" />}
        label="Blocklist (No Access)"
        labelClass="text-red-700 dark:text-red-300/80"
        description="Denied all access — these users cannot read from or publish to the relay."
        borderClass="border-red-400/25 dark:border-red-400/15"
        badgeClass="border-red-400/30 dark:border-red-400/20 text-red-600 dark:text-red-400/70"
        list={blocklist}
        inputValue={newBlock}
        setInput={setNewBlock}
        buttonLabel="Block"
        buttonClass="bg-red-500/20 text-red-700 dark:text-red-300 hover:bg-red-500/30 border border-red-400/40 dark:border-red-400/20"
        profileCache={profileCache}
        onRemove={removeFromList}
        onAddDirect={addToListDirect}
        onAdd={addToList}
        onExport={exportList}
        onImport={importList}
        onProfileFound={handleProfileFound}
        relayUrl={relayUrl}
        listKey="block"
        controlsKey="access-block"
      />
      <ModerationLogSection
        relayUrl={relayUrl}
        modLog={modLog}
        setModLog={setModLog}
        modLogFilter={modLogFilter}
        setModLogFilter={setModLogFilter}
        profileCache={profileCache}
      />
      <BadgeManagementPanel />
    </div>
  );
}

const MOD_ACTION_META: Record<ModAction, { label: string; color: string; icon: typeof Trash2 }> = {
  delete_event: { label: "Deleted event", color: "text-red-600 dark:text-red-400/80", icon: Trash2 },
  bulk_delete: { label: "Bulk deleted", color: "text-red-600 dark:text-red-400/80", icon: Trash2 },
  block_author: { label: "Blocked author", color: "text-orange-600 dark:text-orange-400/80", icon: UserX },
  add_allowlist: { label: "Added to allowlist", color: "text-green-600 dark:text-green-400/80", icon: UserCheck },
  add_readonly: { label: "Added to read-only", color: "text-blue-600 dark:text-blue-400/80", icon: Globe },
  add_blocklist: { label: "Added to blocklist", color: "text-red-600 dark:text-red-400/80", icon: UserX },
  remove_allowlist: { label: "Removed from allowlist", color: "text-amber-600 dark:text-amber-400/80", icon: UserCheck },
  remove_readonly: { label: "Removed from read-only", color: "text-amber-600 dark:text-amber-400/80", icon: Globe },
  remove_blocklist: { label: "Unblocked", color: "text-green-600 dark:text-green-400/80", icon: UserX },
  import_allowlist: { label: "Imported allowlist", color: "text-green-600 dark:text-green-400/80", icon: Upload },
  import_readonly: { label: "Imported read-only", color: "text-blue-600 dark:text-blue-400/80", icon: Upload },
  import_blocklist: { label: "Imported blocklist", color: "text-red-600 dark:text-red-400/80", icon: Upload },
  relay_offline: { label: "Relay went offline", color: "text-red-600 dark:text-red-400/80", icon: AlertTriangle },
  relay_online: { label: "Relay back online", color: "text-green-600 dark:text-green-400/80", icon: Zap },
  relay_latency_spike: { label: "Latency spike", color: "text-amber-600 dark:text-amber-400/80", icon: Clock },
};

function ModerationLogSection({
  relayUrl,
  modLog,
  setModLog,
  modLogFilter,
  setModLogFilter,
  profileCache,
}: {
  relayUrl: string;
  modLog: ModerationLogEntry[];
  setModLog: React.Dispatch<React.SetStateAction<ModerationLogEntry[]>>;
  modLogFilter: "all" | "deletes" | "access" | "health";
  setModLogFilter: React.Dispatch<React.SetStateAction<"all" | "deletes" | "access" | "health">>;
  profileCache: Record<string, ProfileInfo>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const modLogRef = useRef(modLog);
  modLogRef.current = modLog;

  useEffect(() => {
    const interval = setInterval(() => {
      const fresh = getModLog(relayUrl);
      const cur = modLogRef.current;
      if (fresh.length !== cur.length || (fresh.length > 0 && cur.length > 0 && fresh[fresh.length - 1].id !== cur[cur.length - 1].id)) {
        setModLog(fresh);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [relayUrl, setModLog]);

  const filteredLog = useMemo(() => {
    const deleteActions: ModAction[] = ["delete_event", "bulk_delete"];
    const accessActions: ModAction[] = ["block_author", "add_allowlist", "add_readonly", "add_blocklist", "remove_allowlist", "remove_readonly", "remove_blocklist", "import_allowlist", "import_readonly", "import_blocklist"];
    const healthActions: ModAction[] = ["relay_offline", "relay_online", "relay_latency_spike"];
    let filtered = modLog;
    if (modLogFilter === "deletes") filtered = modLog.filter(e => deleteActions.includes(e.action));
    if (modLogFilter === "access") filtered = modLog.filter(e => accessActions.includes(e.action));
    if (modLogFilter === "health") filtered = modLog.filter(e => healthActions.includes(e.action));
    return [...filtered].reverse();
  }, [modLog, modLogFilter]);

  const handleExportLog = useCallback(() => {
    const lines = [...modLog].reverse().map(entry => {
      const meta = MOD_ACTION_META[entry.action];
      const parts = [new Date(entry.ts).toISOString(), meta.label];
      if (entry.targetPubkey) parts.push(`pubkey:${entry.targetPubkey}`);
      if (entry.targetEventId) parts.push(`event:${entry.targetEventId}`);
      if (entry.targetKind !== undefined) parts.push(`kind:${entry.targetKind}`);
      if (entry.count !== undefined) parts.push(`count:${entry.count}`);
      if (entry.note) parts.push(`note:${entry.note}`);
      return parts.join(" | ");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moderation-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${modLog.length} log entries exported.` });
  }, [modLog, toast]);

  const handleClearLog = useCallback(() => {
    clearModLog(relayUrl);
    setModLog([]);
    setConfirmClear(false);
    toast({ title: "Log cleared", description: "Moderation log has been cleared." });
  }, [relayUrl, setModLog, toast]);

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60_000) return "just now";
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Card className="glass-card border border-amber-400/20 dark:border-amber-400/10 p-3">
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => { if ((e.target as HTMLElement).closest("[data-mod-action]")) return; setOpen(!open); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } }}
        className="flex items-center gap-2 w-full text-left cursor-pointer"
      >
        <ScrollText className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400/70" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300/80">Moderation Log</span>
        <Badge variant="outline" className="text-[10px] border-amber-300/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70 ml-1">{modLog.length}</Badge>
        <div className="ml-auto flex items-center gap-1">
          {modLog.length > 0 && (
            <>
              <button
                data-mod-action
                onClick={handleExportLog}
                className="p-1 rounded hover:bg-amber-500/10 text-muted-foreground/50 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                title="Export log"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                data-mod-action
                onClick={() => setConfirmClear(true)}
                className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                title="Clear log"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {open ? <ChevronUp className="w-3 h-3 text-muted-foreground/50 shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/50 shrink-0" />}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] text-muted-foreground/60">
            Tracks all moderation actions — deletions, blocks, access list changes. Stored locally per relay (last 500 entries).
          </p>

          {modLog.length > 0 && (
            <div className="flex gap-1 mb-2 flex-wrap">
              {(["all", "deletes", "access", "health"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setModLogFilter(f)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    modLogFilter === f
                      ? "bg-amber-500/15 border-amber-400/40 dark:border-amber-400/25 text-amber-700 dark:text-amber-300/90 font-medium"
                      : "border-border/40 text-muted-foreground/60 hover:text-muted-foreground/80 hover:border-border/60"
                  }`}
                >
                  {f === "all" ? "All" : f === "deletes" ? "Deletions" : f === "access" ? "Access" : "Health"}
                </button>
              ))}
            </div>
          )}

          {filteredLog.length === 0 ? (
            <div className="text-center py-6">
              <ScrollText className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/50">
                {modLog.length === 0 ? "No moderation actions recorded yet." : "No matching entries."}
              </p>
              <p className="text-[10px] text-muted-foreground/40 mt-1">
                Actions like deleting events, blocking authors, and managing access lists will appear here.
              </p>
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto space-y-0 border border-border/30 rounded-lg">
              {filteredLog.map(entry => {
                const meta = MOD_ACTION_META[entry.action];
                const Icon = meta.icon;
                return (
                  <div key={entry.id} className="flex items-start gap-2 px-3 py-2 border-b border-border/20 last:border-b-0 hover:bg-muted/30 transition-colors group">
                    <div className={`mt-0.5 shrink-0 ${meta.color}`}>
                      <Icon className="w-3 h-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-[11px] font-medium ${meta.color}`}>{meta.label}</span>
                        {entry.targetKind !== undefined && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">{`kind ${entry.targetKind}`}</Badge>
                        )}
                        {entry.count !== undefined && (
                          <span className="text-[10px] text-muted-foreground/60">{entry.count} {entry.count === 1 ? "entry" : "entries"}</span>
                        )}
                      </div>
                      {entry.targetPubkey && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {profileCache[entry.targetPubkey]?.picture ? (
                            <Avatar className="w-3 h-3">
                              <AvatarImage src={profileCache[entry.targetPubkey].picture!} />
                              <AvatarFallback className="text-[10px]">?</AvatarFallback>
                            </Avatar>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground/70 font-mono truncate">
                            {profileCache[entry.targetPubkey]?.name || pubkeyToNpub(entry.targetPubkey).slice(0, 20) + "..."}
                          </span>
                        </div>
                      )}
                      {entry.targetEventId && (
                        <span className="text-[10px] text-muted-foreground/50 font-mono block truncate mt-0.5">
                          event: {entry.targetEventId.slice(0, 16)}...
                        </span>
                      )}
                      {entry.note && (
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic">{entry.note}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground/40 shrink-0 whitespace-nowrap mt-0.5">{formatTimestamp(entry.ts)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Trash2 className="w-4 h-4 text-red-500" />Clear Moderation Log</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {modLog.length} log entries for this relay. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearLog}
              className="bg-red-500/20 text-red-700 dark:text-red-300 hover:bg-red-500/30 border border-red-400/40 dark:border-red-400/20"
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

