import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { AtSign } from "lucide-react";
import { getCachedProfile, searchCachedProfiles } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { KIND_METADATA } from "@/lib/nostr-helpers";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

interface MentionResult {
  pubkey: string;
  displayName: string;
  nip05?: string;
  avatarUrl?: string;
}

interface MentionSearchProps {
  query: string;
  visible: boolean;
  onSelect: (result: MentionResult) => void;
  onClose: () => void;
  position?: "above" | "below" | "static";
}

function parseProfile(event: Event): MentionResult | null {
  try {
    const content = JSON.parse(event.content);
    return {
      pubkey: event.pubkey,
      displayName: content.display_name || content.name || nip19.npubEncode(event.pubkey).slice(0, 12),
      nip05: content.nip05,
      avatarUrl: content.picture };
  } catch {
    return null;
  }
}

export function MentionSearch({ query, visible, onSelect, onClose, position = "above" }: MentionSearchProps) {
  const { follows } = useNostrAuth();
  const [results, setResults] = useState<MentionResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  const followProfileEvents = useMemo(() => {
    if (!follows || follows.length === 0) return [];
    const profiles: Event[] = [];
    for (const pk of follows) {
      const cached = getCachedProfile(pk);
      if (cached && cached.kind === 0) profiles.push(cached as Event);
    }
    return profiles;
  }, [follows]);

  const searchLocal = useCallback((q: string): MentionResult[] => {
    const lower = q.toLowerCase();
    const seen = new Set<string>();
    const matched: MentionResult[] = [];

    for (const event of followProfileEvents) {
      const result = parseProfile(event);
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
      const result = parseProfile(event);
      if (result) {
        seen.add(result.pubkey);
        matched.push(result);
      }
      if (matched.length >= 8) break;
    }

    return matched;
  }, [followProfileEvents]);

  useEffect(() => {
    if (!visible || !query) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    abortRef.current = false;
    const localResults = searchLocal(query);
    setResults(localResults);
    setSelectedIndex(0);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (localResults.length < 4 && query.length >= 2) {
      setIsSearching(true);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const remoteProfiles = await searchUsers(query, 8);
          if (abortRef.current) return;
          const localPubkeys = new Set(localResults.map((r) => r.pubkey));
          const remoteResults: MentionResult[] = [];
          for (const event of remoteProfiles) {
            if (localPubkeys.has(event.pubkey)) continue;
            const parsed = parseProfile(event);
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
  }, [query, visible, searchLocal]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onSelect(results[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [visible, results, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    if (visible) {
      document.addEventListener("keydown", handleKeyDown, true);
      return () => document.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [visible, handleKeyDown]);

  useEffect(() => {
    if (containerRef.current && selectedIndex >= 0) {
      const el = containerRef.current.children[selectedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      className={`${
        position === "static"
          ? "relative z-[60] max-h-[240px] overflow-y-auto rounded-lg border border-white/10 bg-[#1a1625]/95 backdrop-blur-xl shadow-xl"
          : `absolute left-0 right-0 z-[60] max-h-[240px] overflow-y-auto rounded-lg border border-white/10 bg-[#1a1625]/95 backdrop-blur-xl shadow-xl ${
              position === "above" ? "bottom-full mb-1" : "top-full mt-1"
            }`
      }`}
      data-testid="container-mention-search"
    >
      {results.length === 0 && !isSearching && query.length > 0 && (
        <div className="px-3 py-3 text-xs text-white/30 text-center" data-testid="text-mention-no-results">
          No users found for "{query}"
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
            onSelect(result);
          }}
          onMouseEnter={() => setSelectedIndex(idx)}
          data-testid={`button-mention-result-${idx}`}
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
          <AtSign className="w-3 h-3 text-white/20 shrink-0" />
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
  );
}

export type { MentionResult };
