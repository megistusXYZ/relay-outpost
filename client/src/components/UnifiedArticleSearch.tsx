import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Search, X, User, Hash, BookOpen, ShieldCheck } from "lucide-react";
import { searchUsers, searchArticles, getLastBrainstormWotScores } from "@/lib/primal-cache";
import { searchCachedProfiles, eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getProfileContent, KIND_METADATA } from "@/lib/nostr-helpers";
import { parseArticle } from "@/lib/nip23";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CURATED_TOPICS = [
  "ai", "alexandria", "amethyst", "bitcoin", "damus", "decentralization",
  "dvm", "entrepreneurship", "freedom", "gitcitadel", "lightning", "marmot",
  "nostr", "nostrrecap", "nostria", "opensource", "otherstuff", "praxeology",
  "primal", "privacy", "protocols", "saas", "security", "soapbox",
  "sovereignty", "verification", "war", "web of trust", "whitenoise",
  "wisp", "wot", "zap", "zapstore",
];

export type UnifiedSearchSelection =
  | { type: "author"; pubkey: string; displayName?: string; picture?: string }
  | { type: "hashtag"; tag: string }
  | { type: "article"; naddr: string };

interface UnifiedArticleSearchProps {
  onSelect: (selection: UnifiedSearchSelection) => void;
  popularTags?: Array<string | { tag: string; count?: number }>;
  placeholder?: string;
  initialValue?: string;
}

interface HashtagRow {
  tag: string;
  count?: number;
}

interface AuthorRow {
  pubkey: string;
  name: string;
  nip05: string;
  picture: string;
  wot: number | null;
}

interface ArticleRow {
  naddr: string;
  title: string;
  authorPubkey: string;
  publishedAt: number;
}

const DEBOUNCE_MS = 250;

function eventToAuthorRow(event: Event, wotScores: Map<string, number | null> | null): AuthorRow {
  const content = (() => { try { return JSON.parse(event.content); } catch { return {}; } })();
  return {
    pubkey: event.pubkey,
    name: content.display_name || content.name || "",
    nip05: content.nip05 || "",
    picture: content.picture || "",
    wot: wotScores?.get(event.pubkey) ?? null,
  };
}

function eventToArticleRow(event: Event): ArticleRow | null {
  try {
    const a = parseArticle(event);
    if (!a.title || a.title.trim().length < 3) return null;
    return {
      naddr: a.naddr,
      title: a.title,
      authorPubkey: a.event.pubkey,
      publishedAt: a.publishedAt,
    };
  } catch { return null; }
}

function ArticleAuthorLine({ pubkey }: { pubkey: string }) {
  const profileEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { if (!profileEvent) fetchProfilesCached([pubkey]); }, [pubkey, profileEvent]);
  const name = useMemo(() => {
    const c = profileEvent ? getProfileContent(profileEvent) : null;
    if (c?.display_name || c?.name) return c.display_name || c.name;
    try { return nip19.npubEncode(pubkey).slice(0, 14) + "…"; } catch { return pubkey.slice(0, 8); }
  }, [profileEvent, pubkey]);
  return <div className="text-[11px] text-muted-foreground/60 truncate">by {name}</div>;
}

export function UnifiedArticleSearch({
  onSelect,
  popularTags = [],
  placeholder,
  initialValue,
}: UnifiedArticleSearchProps) {
  const [query, setQuery] = useState(initialValue ?? "");
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [hashtags, setHashtags] = useState<HashtagRow[]>([]);
  const [isMobile, setIsMobile] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth < 640);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const requestIdRef = useRef(0);

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const isHashtagOnly = trimmed.startsWith("#");
  const isAuthorOnly = trimmed.startsWith("@") || lower.startsWith("npub1") || lower.startsWith("nprofile1");

  const flatItems = useMemo(() => {
    const items: { kind: "author" | "hashtag" | "article"; payload: AuthorRow | HashtagRow | ArticleRow }[] = [];
    if (!isAuthorOnly) {
      for (const h of hashtags) items.push({ kind: "hashtag", payload: h });
    }
    if (!isHashtagOnly) {
      for (const a of authors) items.push({ kind: "author", payload: a });
    }
    if (!isHashtagOnly && !isAuthorOnly) {
      for (const r of articles) items.push({ kind: "article", payload: r });
    }
    return items;
  }, [authors, hashtags, articles, isAuthorOnly, isHashtagOnly]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const computeHashtagSuggestions = useCallback((raw: string): HashtagRow[] => {
    const stripped = raw.replace(/^#/, "").toLowerCase().trim();
    if (!stripped) return [];
    const counts = new Map<string, number | undefined>();
    for (const t of CURATED_TOPICS) counts.set(t.toLowerCase(), counts.get(t.toLowerCase()));
    for (const entry of popularTags) {
      if (typeof entry === "string") {
        const k = entry.toLowerCase();
        if (!counts.has(k)) counts.set(k, undefined);
      } else {
        counts.set(entry.tag.toLowerCase(), entry.count);
      }
    }
    return Array.from(counts.entries())
      .filter(([t]) => t.includes(stripped))
      .sort((a, b) => {
        const aStart = a[0].startsWith(stripped) ? 0 : 1;
        const bStart = b[0].startsWith(stripped) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        const aCount = a[1] ?? 0;
        const bCount = b[1] ?? 0;
        if (aCount !== bCount) return bCount - aCount;
        return a[0].length - b[0].length;
      })
      .slice(0, 6)
      .map(([tag, count]) => ({ tag, count }));
  }, [popularTags]);

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    const reqId = ++requestIdRef.current;
    if (!q) {
      setAuthors([]); setArticles([]); setHashtags([]);
      setShowDropdown(false);
      setActiveIndex(-1);
      return;
    }

    const lowerQ = q.toLowerCase();
    const hashtagMode = q.startsWith("#");
    const authorMode = q.startsWith("@") || lowerQ.startsWith("npub1") || lowerQ.startsWith("nprofile1");

    if (hashtagMode) {
      const tags = computeHashtagSuggestions(q);
      if (reqId !== requestIdRef.current) return;
      setHashtags(tags); setAuthors([]); setArticles([]);
      setShowDropdown(tags.length > 0);
      setActiveIndex(tags.length > 0 ? 0 : -1);
      setIsSearching(false);
      return;
    }

    const cleaned = authorMode ? q.replace(/^@/, "") : q;

    setIsSearching(true);

    if (!authorMode) {
      const tags = computeHashtagSuggestions(cleaned);
      if (reqId === requestIdRef.current) setHashtags(tags);
    } else {
      setHashtags([]);
    }

    if (!authorMode) {
      const cached = searchCachedProfiles(cleaned, 6);
      if (cached.length > 0 && reqId === requestIdRef.current) {
        setAuthors(cached.map((e) => eventToAuthorRow(e, getLastBrainstormWotScores())));
        setShowDropdown(true);
      }
    }

    const tasks: Promise<void>[] = [];

    tasks.push((async () => {
      try {
        const events = await searchUsers(cleaned, 6);
        if (reqId !== requestIdRef.current) return;
        const wot = getLastBrainstormWotScores();
        const seen = new Set<string>();
        const rows: AuthorRow[] = [];
        for (const e of events) {
          if (seen.has(e.pubkey)) continue;
          seen.add(e.pubkey);
          rows.push(eventToAuthorRow(e, wot));
        }
        rows.sort((a, b) => (b.wot ?? -1) - (a.wot ?? -1));
        setAuthors(rows);
      } catch {}
    })());

    if (!authorMode) {
      tasks.push((async () => {
        try {
          const events = await searchArticles(cleaned, 6);
          if (reqId !== requestIdRef.current) return;
          const rows: ArticleRow[] = [];
          for (const e of events) {
            const r = eventToArticleRow(e);
            if (r) rows.push(r);
          }
          setArticles(rows);
        } catch {}
      })());
    } else {
      setArticles([]);
    }

    await Promise.all(tasks);
    if (reqId === requestIdRef.current) {
      setIsSearching(false);
      setShowDropdown(true);
      setActiveIndex((idx) => (idx < 0 ? 0 : idx));
    }
  }, [computeHashtagSuggestions]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      requestIdRef.current++;
      setAuthors([]); setArticles([]); setHashtags([]);
      setIsSearching(false);
      setShowDropdown(false);
      setActiveIndex(-1);
      return;
    }
    debounceRef.current = setTimeout(() => { runSearch(query); }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  const commit = useCallback((sel: UnifiedSearchSelection) => {
    onSelect(sel);
    setQuery("");
    setShowDropdown(false);
    setAuthors([]); setArticles([]); setHashtags([]);
    setActiveIndex(-1);
  }, [onSelect]);

  const tryDecodeNip19 = useCallback((raw: string): string | null => {
    const v = raw.trim().toLowerCase().replace(/^nostr:/, "");
    if (!v.startsWith("npub1") && !v.startsWith("nprofile1")) return null;
    try {
      const decoded = nip19.decode(v);
      if (decoded.type === "npub") return decoded.data as string;
      if (decoded.type === "nprofile") return (decoded.data as { pubkey: string }).pubkey;
    } catch {}
    return null;
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowDropdown(false);
      setActiveIndex(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      if (!showDropdown && flatItems.length > 0) setShowDropdown(true);
      e.preventDefault();
      setActiveIndex((idx) => Math.min(flatItems.length - 1, idx + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => Math.max(0, idx - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showDropdown && activeIndex >= 0 && activeIndex < flatItems.length) {
        const item = flatItems[activeIndex];
        if (item.kind === "author") {
          const a = item.payload as AuthorRow;
          commit({ type: "author", pubkey: a.pubkey, displayName: a.name || undefined, picture: a.picture || undefined });
        } else if (item.kind === "hashtag") {
          commit({ type: "hashtag", tag: (item.payload as HashtagRow).tag });
        } else {
          const r = item.payload as ArticleRow;
          commit({ type: "article", naddr: r.naddr });
        }
        return;
      }
      const v = query.trim();
      if (!v) return;
      const decodedPk = tryDecodeNip19(v);
      if (decodedPk) {
        commit({ type: "author", pubkey: decodedPk });
        return;
      }
      if (v.startsWith("#")) {
        const tag = v.replace(/^#/, "").toLowerCase();
        if (tag) commit({ type: "hashtag", tag });
      }
    }
  }, [showDropdown, activeIndex, flatItems, query, commit, tryDecodeNip19]);

  let cursor = -1;
  const itemIndex = () => { cursor++; return cursor; };

  return (
    <div className="relative flex-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (flatItems.length > 0) setShowDropdown(true); }}
          placeholder={placeholder ?? "Search"}
          className="pl-9 pr-9 h-10 bg-muted/20 border-border/30 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
          style={{ fontSize: 16 }}
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          data-testid="input-search-articles"
        />
        {(isSearching || query) && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isSearching && <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand" />}
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setShowDropdown(false); setActiveIndex(-1); }}
                className="p-1 rounded hover:bg-foreground/10 text-muted-foreground transition-colors"
                data-testid="button-clear-search"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {showDropdown && flatItems.length > 0 && (
        <>
          {isMobile && (
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setShowDropdown(false)}
              aria-hidden="true"
            />
          )}
          <div
            ref={dropdownRef}
            className={
              isMobile
                ? "fixed z-50 left-0 right-0 bottom-0 rounded-t-2xl shadow-2xl border-t border-border/40 max-h-[70vh] overflow-y-auto bg-popover"
                : "absolute z-50 top-full mt-1 left-0 right-0 rounded-lg overflow-hidden shadow-lg border border-border/30 max-h-[420px] overflow-y-auto bg-popover"
            }
            data-testid="dropdown-unified-search"
            role="listbox"
          >
          {isMobile && (
            <div className="sticky top-0 bg-popover border-b border-border/30 px-3 py-2 flex items-center justify-between">
              <div className="text-xs font-medium text-foreground/70">Search results</div>
              <button
                type="button"
                onClick={() => setShowDropdown(false)}
                className="-my-2 -mr-1.5 flex h-10 w-10 items-center justify-center rounded-full hover:bg-foreground/10"
                aria-label="Close search results"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {!isAuthorOnly && hashtags.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Hashtags</div>
              {hashtags.map((h) => {
                const idx = itemIndex();
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={`hashtag-${h.tag}`}
                    onClick={() => commit({ type: "hashtag", tag: h.tag })}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${
                      isActive ? "bg-brand/15" : "hover:bg-brand/8"
                    }`}
                    data-testid={`unified-hashtag-${h.tag}`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <Hash className="w-3.5 h-3.5 text-brand/80 shrink-0" />
                    <span className="text-foreground/90 flex-1 truncate">{h.tag}</span>
                    {typeof h.count === "number" && h.count > 0 && (
                      <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0">{h.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {!isHashtagOnly && authors.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Authors</div>
              {authors.map((a) => {
                const idx = itemIndex();
                const isActive = idx === activeIndex;
                const fallback = (() => { try { return nip19.npubEncode(a.pubkey).slice(0, 12) + "…"; } catch { return a.pubkey.slice(0, 8); } })();
                return (
                  <button
                    key={`author-${a.pubkey}`}
                    onClick={() => commit({ type: "author", pubkey: a.pubkey, displayName: a.name || undefined, picture: a.picture || undefined })}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${
                      isActive ? "bg-brand/15" : "hover:bg-brand/8"
                    }`}
                    data-testid={`unified-author-${a.pubkey.slice(0, 8)}`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <Avatar className="w-8 h-8 shrink-0">
                      {a.picture ? <AvatarImage src={a.picture} alt={a.name} /> : null}
                      <AvatarFallback className="bg-brand/20 text-brand">
                        <User className="w-3.5 h-3.5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 truncate">{a.name || fallback}</div>
                      {a.nip05 && (
                        <div className="text-[11px] text-muted-foreground/60 truncate">{a.nip05}</div>
                      )}
                    </div>
                    {a.wot !== null && (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-500/80 shrink-0" title="Web of Trust score">
                        <ShieldCheck className="w-3 h-3" />
                        <span className="font-mono">{Math.round((a.wot ?? 0) * 100)}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {!isHashtagOnly && !isAuthorOnly && articles.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Articles</div>
              {articles.map((r) => {
                const idx = itemIndex();
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={`article-${r.naddr}`}
                    onClick={() => commit({ type: "article", naddr: r.naddr })}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-sm transition-colors text-left ${
                      isActive ? "bg-brand/15" : "hover:bg-brand/8"
                    }`}
                    data-testid={`unified-article-${r.naddr.slice(0, 12)}`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <BookOpen className="w-3.5 h-3.5 text-brand/80 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground/90 line-clamp-2">{r.title}</div>
                      <ArticleAuthorLine pubkey={r.authorPubkey} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="px-3 py-1.5 text-[10px] text-muted-foreground/40 text-center font-brand uppercase tracking-wider border-t border-border/20">
            {isSearching ? "Searching Nostr…" : "Press ↑ ↓ to navigate · Enter to select"}
          </div>
          </div>
        </>
      )}
    </div>
  );
}
