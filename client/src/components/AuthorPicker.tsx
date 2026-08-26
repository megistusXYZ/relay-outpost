import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { X, UserPlus } from "lucide-react";
import { getCachedProfile, searchCachedProfiles } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

interface ProfileInfo {
  pubkey: string;
  displayName: string;
  nip05?: string;
  avatarUrl?: string;
}

interface AuthorPickerProps {
  value: string;
  onChange: (value: string) => void;
}

function parseProfileEvent(event: Event): ProfileInfo | null {
  try {
    const content = JSON.parse(event.content);
    return {
      pubkey: event.pubkey,
      displayName: content.display_name || content.name || shortenNpub(nip19.npubEncode(event.pubkey)),
      nip05: content.nip05,
      avatarUrl: content.picture };
  } catch {
    return null;
  }
}

function resolveProfileForPubkey(pubkey: string): ProfileInfo | null {
  const cached = getCachedProfile(pubkey);
  if (!cached || cached.kind !== 0) return null;
  return parseProfileEvent(cached as Event);
}

function parsePubkey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {}
  return null;
}

export function AuthorPicker({ value, onChange }: AuthorPickerProps) {
  const { follows } = useNostrAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ProfileInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentPubkeys = useMemo(() => {
    return value
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => parsePubkey(a))
      .filter((pk): pk is string => pk !== null);
  }, [value]);

  const authorChips = useMemo(() => {
    return currentPubkeys.map((pk) => {
      const profile = resolveProfileForPubkey(pk);
      return profile || {
        pubkey: pk,
        displayName: shortenNpub(formatNpub(pk)) };
    });
  }, [currentPubkeys]);

  const followProfileEvents = useMemo(() => {
    if (!follows || follows.length === 0) return [];
    const profiles: Event[] = [];
    for (const pk of follows) {
      const cached = getCachedProfile(pk);
      if (cached && cached.kind === 0) profiles.push(cached as Event);
    }
    return profiles;
  }, [follows]);

  const searchLocal = useCallback((q: string): ProfileInfo[] => {
    const lower = q.toLowerCase();
    const seen = new Set<string>(currentPubkeys);
    const matched: ProfileInfo[] = [];

    for (const event of followProfileEvents) {
      const result = parseProfileEvent(event);
      if (!result || seen.has(result.pubkey)) continue;
      const name = result.displayName.toLowerCase();
      const nip = result.nip05?.toLowerCase() || "";
      if (name.includes(lower) || nip.includes(lower)) {
        seen.add(result.pubkey);
        matched.push(result);
      }
      if (matched.length >= 8) return matched;
    }

    const cachedEvents = searchCachedProfiles(q, 8 - matched.length);
    for (const event of cachedEvents) {
      if (seen.has(event.pubkey)) continue;
      const result = parseProfileEvent(event);
      if (result) {
        seen.add(result.pubkey);
        matched.push(result);
      }
      if (matched.length >= 8) break;
    }

    return matched;
  }, [followProfileEvents, currentPubkeys]);

  useEffect(() => {
    if (!searchQuery || !showDropdown) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const pk = parsePubkey(searchQuery);
    if (pk) {
      setResults([]);
      return;
    }

    abortRef.current = false;
    const localResults = searchLocal(searchQuery);
    setResults(localResults);
    setSelectedIndex(0);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (localResults.length < 4 && searchQuery.length >= 2) {
      setIsSearching(true);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const remoteProfiles = await searchUsers(searchQuery, 8);
          if (abortRef.current) return;
          const localPubkeys = new Set([...currentPubkeys, ...localResults.map((r) => r.pubkey)]);
          const remoteResults: ProfileInfo[] = [];
          for (const event of remoteProfiles) {
            if (localPubkeys.has(event.pubkey)) continue;
            const parsed = parseProfileEvent(event);
            if (parsed) {
              remoteResults.push(parsed);
              localPubkeys.add(parsed.pubkey);
            }
            if (localResults.length + remoteResults.length >= 8) break;
          }
          if (!abortRef.current) {
            setResults([...localResults, ...remoteResults]);
          }
        } catch {
        } finally {
          if (!abortRef.current) setIsSearching(false);
        }
      }, 300);
    }

    return () => {
      abortRef.current = true;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, showDropdown, searchLocal, currentPubkeys]);

  const addPubkey = useCallback((pubkey: string) => {
    if (currentPubkeys.includes(pubkey)) return;
    const newList = [...currentPubkeys, pubkey];
    onChange(newList.join(","));
    setSearchQuery("");
    setShowDropdown(false);
    setResults([]);
    inputRef.current?.focus();
  }, [currentPubkeys, onChange]);

  const removePubkey = useCallback((pubkey: string) => {
    const newList = currentPubkeys.filter((pk) => pk !== pubkey);
    onChange(newList.join(","));
  }, [currentPubkeys, onChange]);

  const handleSelect = useCallback((profile: ProfileInfo) => {
    addPubkey(profile.pubkey);
  }, [addPubkey]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown && results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % results.length);
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + results.length) % results.length);
        return;
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelect(results[selectedIndex]);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowDropdown(false);
        setResults([]);
        return;
      }
    }

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const pk = parsePubkey(searchQuery);
      if (pk) {
        addPubkey(pk);
      }
    }

    if (e.key === "Backspace" && !searchQuery && currentPubkeys.length > 0) {
      removePubkey(currentPubkeys[currentPubkeys.length - 1]);
    }
  }, [showDropdown, results, selectedIndex, handleSelect, searchQuery, addPubkey, currentPubkeys, removePubkey]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.includes(",")) {
      const parts = val.split(",");
      const newPks: string[] = [];
      const existing = new Set(currentPubkeys);
      for (const part of parts) {
        const pk = parsePubkey(part);
        if (pk && !existing.has(pk)) {
          newPks.push(pk);
          existing.add(pk);
        }
      }
      if (newPks.length > 0) {
        onChange([...currentPubkeys, ...newPks].join(","));
      }
      setSearchQuery("");
      setShowDropdown(false);
      return;
    }
    setSearchQuery(val);
    setShowDropdown(val.length > 0);
  }, [currentPubkeys, onChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dropdownRef.current && selectedIndex >= 0) {
      const el = dropdownRef.current.children[selectedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1 min-h-[36px] px-2 py-1 rounded-md border border-input bg-background text-sm cursor-text"
        style={{ fontSize: "16px" }}
        onClick={() => inputRef.current?.focus()}
      >
        {authorChips.map((chip) => (
          <span
            key={chip.pubkey}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-brand/10 border border-brand/20 text-xs max-w-[200px]"
          >
            <Avatar className="w-4 h-4 shrink-0">
              {chip.avatarUrl && <AvatarImage src={chip.avatarUrl} alt={chip.displayName} />}
              <AvatarFallback className="text-[8px] bg-brand/10 text-brand">
                {chip.displayName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-foreground/80">{chip.displayName}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removePubkey(chip.pubkey); }}
              className="shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-brand/20 transition-colors cursor-pointer"
            >
              <X className="w-2.5 h-2.5 text-foreground/50" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onFocus={() => { if (searchQuery.length > 0) setShowDropdown(true); }}
          placeholder={currentPubkeys.length === 0 ? "Search by name, or paste hex/npub..." : "Add more..."}
          className="flex-1 min-w-[120px] bg-transparent text-xs font-mono outline-none placeholder:text-muted-foreground/50"
          style={{ fontSize: "16px" }}
          data-testid="input-authors"
        />
      </div>

      {showDropdown && (results.length > 0 || isSearching || (searchQuery.length > 0 && !parsePubkey(searchQuery))) && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full mt-1 z-[60] max-h-[240px] overflow-y-auto rounded-lg border border-white/10 bg-[#1a1625]/95 backdrop-blur-xl shadow-xl"
        >
          {results.length === 0 && !isSearching && searchQuery.length > 0 && !parsePubkey(searchQuery) && (
            <div className="px-3 py-3 text-xs text-white/30 text-center">
              No users found for "{searchQuery}"
            </div>
          )}

          {results.length === 0 && isSearching && (
            <div className="px-3 py-3 flex items-center justify-center gap-2 text-xs text-white/40">
              <RelayOutpostInlineLoader className="w-3 h-3" />
              Searching...
            </div>
          )}

          {results.map((result, idx) => (
            <button
              key={result.pubkey}
              type="button"
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer ${
                idx === selectedIndex
                  ? "bg-brand/20 text-white"
                  : "text-white/80 hover:bg-white/[0.06]"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(result);
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <Avatar className="w-7 h-7 border border-white/10 shrink-0">
                <AvatarImage src={result.avatarUrl} alt={result.displayName} />
                <AvatarFallback className="text-[10px] bg-brand/10 text-brand">
                  {result.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{result.displayName}</div>
                {result.nip05 && (
                  <div className="text-[11px] text-brand/60 truncate">{result.nip05}</div>
                )}
              </div>
              <UserPlus className="w-3 h-3 text-white/20 shrink-0" />
            </button>
          ))}

          {isSearching && results.length > 0 && (
            <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-white/25 border-t border-white/5">
              <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
              Searching more...
            </div>
          )}

          {results.length > 0 && (
            <div className="px-3 py-1 text-[10px] text-white/15 border-t border-white/5 hidden md:block">
              <span className="mr-2">↑↓ navigate</span>
              <span className="mr-2">↵ select</span>
              <span>esc dismiss</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
