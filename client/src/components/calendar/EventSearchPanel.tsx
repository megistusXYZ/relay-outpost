import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { nip19, type Event } from "nostr-tools";
import { searchUsers } from "@/lib/primal-cache";
import { searchCachedProfiles } from "@/lib/nostr";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchPill } from "@/components/SearchPill";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Search, Pin, PinOff, MapPin, Clock, Calendar, Users, ChevronRight, X, User as UserIcon, Video, Radio, ExternalLink } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { cn } from "@/lib/utils";
import { Linkify } from "@/components/Linkify";
import {
  searchCalendarEvents,
  getCalendarEventDate,
  getCalendarEventEndDate,
  isEventPinned,
  pinEvent,
  unpinEvent,
  getMeetingLink,
  type CalendarEventData,
} from "@/lib/calendar-events";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getCachedProfile } from "@/lib/nostr";

interface EventSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followedPubkeys?: string[];
  onPinChange: () => void;
}

function getProfileInfo(pubkey: string): { name: string; avatar?: string } {
  const cached = getCachedProfile(pubkey);
  if (cached) {
    try {
      const content = JSON.parse(cached.content);
      return {
        name: content.display_name || content.name || pubkey.slice(0, 8) + "...",
        avatar: content.picture || undefined,
      };
    } catch {}
  }
  return { name: pubkey.slice(0, 8) + "..." };
}

function formatEventDate(ce: CalendarEventData): string {
  const start = getCalendarEventDate(ce);
  if (!start) return "No date";

  const end = getCalendarEventEndDate(ce);
  const dateStr = start.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

  if (ce.startTime) {
    const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (end && ce.endTime) {
      const endTimeStr = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `${dateStr} · ${timeStr} – ${endTimeStr}`;
    }
    return `${dateStr} · ${timeStr}`;
  }

  if (end && ce.endDate && ce.endDate !== ce.startDate) {
    const endDateStr = end.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${dateStr} – ${endDateStr}`;
  }

  return dateStr;
}

function tryDecodeAuthor(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^npub1[02-9ac-hj-np-z]+$/i.test(trimmed)) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data;
      }
    } catch {}
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

export function EventSearchPanel({ open, onOpenChange, followedPubkeys, onPinChange }: EventSearchPanelProps) {
  const { pubkey } = useNostrAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CalendarEventData[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [searchMode, setSearchMode] = useState<"all" | "following">("all");
  const [showPast, setShowPast] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const lastFetchSeq = useRef(0);
  const [authorFilter, setAuthorFilter] = useState<{ pubkey: string; name: string; picture?: string } | null>(null);
  const [suggestions, setSuggestions] = useState<Event[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSeqRef = useRef(0);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const authorFromQuery = useMemo(() => tryDecodeAuthor(query), [query]);

  const handleSearch = useCallback(async () => {
    const seq = ++lastFetchSeq.current;
    setLoading(true);
    setSearched(true);
    setShowPast(false);
    try {
      let authors: string[] | undefined;
      let textQuery = query.trim();
      if (authorFilter) {
        // A user picked a creator from the suggestions — show only their events.
        authors = [authorFilter.pubkey];
        textQuery = "";
      } else if (authorFromQuery) {
        // Treat npub/hex as a creator filter — search ALL their events,
        // ignore the npub itself as a text query.
        authors = [authorFromQuery];
        textQuery = "";
      } else if (searchMode === "following") {
        authors = followedPubkeys;
      }
      const data = await searchCalendarEvents(textQuery, authors);
      // Drop stale responses if a newer fetch started while this was in flight.
      if (seq !== lastFetchSeq.current) return;
      data.sort((a, b) => {
        const aDate = getCalendarEventDate(a);
        const bDate = getCalendarEventDate(b);
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate.getTime() - bDate.getTime();
      });
      setResults(data);
    } catch (err) {
      console.error("Calendar event search failed:", err);
    } finally {
      if (seq === lastFetchSeq.current) setLoading(false);
    }
  }, [query, authorFromQuery, authorFilter, searchMode, followedPubkeys]);

  // Debounced profile suggestions: when the user types something that looks
  // like a name (not empty, not an npub/hex, no creator already locked in),
  // show matching profiles so they can filter by author without copy/pasting.
  useEffect(() => {
    if (suggestDebounceRef.current) {
      clearTimeout(suggestDebounceRef.current);
      suggestDebounceRef.current = null;
    }
    const trimmed = query.trim();
    if (authorFilter || authorFromQuery || trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSuggestLoading(false);
      return;
    }
    const cached = searchCachedProfiles(trimmed, 6);
    if (cached.length > 0) {
      setSuggestions(cached);
      setShowSuggestions(true);
    }
    setSuggestLoading(true);
    const seq = ++suggestSeqRef.current;
    suggestDebounceRef.current = setTimeout(async () => {
      try {
        const remote = await searchUsers(trimmed, 6);
        if (seq !== suggestSeqRef.current) return;
        const seen = new Set<string>();
        const merged: Event[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) {
            seen.add(e.pubkey);
            merged.push(e);
          }
        }
        setSuggestions(merged.slice(0, 6));
        if (merged.length > 0) setShowSuggestions(true);
      } catch (err) {
        console.warn("[EventSearch] profile suggest failed:", err);
      } finally {
        if (seq === suggestSeqRef.current) setSuggestLoading(false);
      }
    }, 280);
    return () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }
    };
  }, [query, authorFilter, authorFromQuery]);

  const pickAuthor = useCallback((event: Event) => {
    let name = "";
    let picture: string | undefined;
    try {
      const c = JSON.parse(event.content);
      name = c.display_name || c.name || "";
      picture = c.picture || undefined;
    } catch {}
    if (!name) name = event.pubkey.slice(0, 8) + "...";
    setAuthorFilter({ pubkey: event.pubkey, name, picture });
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
  }, []);

  const clearAuthorFilter = useCallback(() => {
    setAuthorFilter(null);
  }, []);

  // Re-run the event search whenever the picked author changes (set or cleared)
  // so the list updates without the user having to hit search again.
  useEffect(() => {
    if (!open) return;
    void handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorFilter]);

  // Auto-discover upcoming events the first time the panel opens so it
  // never feels empty or "dead". Re-runs if the user toggles All/Following
  // before typing anything.
  useEffect(() => {
    if (!open) {
      setAutoLoaded(false);
      return;
    }
    if (autoLoaded) return;
    setAutoLoaded(true);
    void handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-run the discovery feed when the user flips between All/Following
  // while the panel is open and they haven't typed a custom query yet.
  useEffect(() => {
    if (!open || !autoLoaded) return;
    if (query.trim()) return;
    void handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMode]);

  // Live keyword search: re-run the event search (debounced) as the user types,
  // so "austin" filters events by title/description/location/hashtags without
  // pressing Enter. Clearing the box restores the broad upcoming list. The
  // author-filtered path and the initial auto-load are handled by the effects
  // above, so we skip those cases here.
  useEffect(() => {
    if (!open || authorFilter || !autoLoaded) return;
    const t = setTimeout(() => { void handleSearch(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleTogglePin = (ce: CalendarEventData) => {
    if (!pubkey) return;
    if (isEventPinned(pubkey, ce.id, ce)) {
      unpinEvent(pubkey, ce.id, ce);
    } else {
      pinEvent(pubkey, ce.id, ce);
    }
    setResults([...results]);
    onPinChange();
  };

  const { pastEvents, upcomingEvents } = useMemo(() => {
    const now = Date.now();
    const past = results.filter((ce) => {
      const d = getCalendarEventDate(ce);
      return d ? d.getTime() < now : false;
    });
    const upcoming = results.filter((ce) => {
      const d = getCalendarEventDate(ce);
      return d ? d.getTime() >= now : true;
    });
    return { pastEvents: past, upcomingEvents: upcoming };
  }, [results]);

  const renderEventCard = (ce: CalendarEventData, isPast: boolean) => {
    const isPinned = pubkey ? isEventPinned(pubkey, ce.id, ce) : false;
    const meeting = getMeetingLink(ce);
    const MeetingIcon = meeting?.kind === "stream" ? Radio : meeting?.kind === "video" ? Video : ExternalLink;
    return (
      <div
        key={ce.id}
        className={cn(
          "border border-border/50 rounded-lg p-3 sm:p-3 bg-card/50 hover:bg-card/80 active:bg-card/90 transition-colors",
          isPast && "opacity-50"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground/90 mb-1 leading-snug">{ce.title}</p>
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-2 text-[11px] sm:text-[10px] text-muted-foreground/50 mb-1.5">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 shrink-0" />
                {formatEventDate(ce)}
              </span>
              {ce.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate"><Linkify text={ce.location} /></span>
                </span>
              )}
            </div>
            {ce.description && (
              <p className="text-xs text-foreground/60 line-clamp-2 mb-1.5 leading-relaxed">
                <Linkify text={ce.description.slice(0, 150)} />
              </p>
            )}
            {meeting && !isPast && (
              <a
                href={meeting.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "inline-flex items-center gap-1.5 mb-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                  meeting.kind === "stream"
                    ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                    : "bg-sky-500/15 text-sky-400 hover:bg-sky-500/25"
                )}
                data-testid="event-meeting-link"
              >
                <MeetingIcon className="w-3 h-3" />
                {meeting.label}
              </a>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const info = getProfileInfo(ce.pubkey);
                return (
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
                    <Avatar className="w-4 h-4 border border-border/30">
                      <AvatarImage src={info.avatar} alt={info.name} />
                      <AvatarFallback className="text-[6px] bg-muted">{info.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {info.name}
                  </span>
                );
              })()}
              {ce.hashtags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {ce.hashtags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[8px] px-1.5 py-0">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-9 w-9 sm:h-8 sm:w-8 p-0 flex-shrink-0 touch-manipulation",
              isPinned ? "text-sky-400 hover:text-red-700 dark:hover:text-red-400" : "text-muted-foreground/40 hover:text-sky-400"
            )}
            onClick={() => handleTogglePin(ce)}
            title={isPinned ? "Unpin" : "Pin to calendar"}
          >
            {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "!gap-0 !p-0 flex flex-col",
          isMobile
            ? "h-[85vh] max-h-[85vh] rounded-t-2xl"
            : "w-full sm:max-w-md h-full"
        )}
      >
        <div className="shrink-0 px-5 pt-5 pb-3 space-y-3">
          <SheetHeader className="mb-1">
            <SheetTitle className="text-sm font-brand uppercase tracking-widest flex items-center gap-2">
              <Calendar className="w-4 h-4 text-sky-400" />
              Discover Events
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground/50">
              Browse upcoming Nostr events, search by topic, or look up a creator by name.
            </SheetDescription>
          </SheetHeader>

          {authorFilter ? (
            <div className="flex items-center gap-2 rounded-md border border-sky-500/20 bg-sky-500/[0.06] px-2.5 py-1.5">
              <Avatar className="w-6 h-6 shrink-0 border border-border/30">
                <AvatarImage src={authorFilter.picture} alt={authorFilter.name} />
                <AvatarFallback className="text-[9px] bg-muted">
                  {authorFilter.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-sky-400/70">Events by</div>
                <div className="text-xs font-medium text-foreground/90 truncate">{authorFilter.name}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground/60 hover:text-foreground"
                onClick={clearAuthorFilter}
                title="Clear creator filter"
                data-testid="button-clear-author-filter"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex gap-2">
                <SearchPill
                  containerClassName="flex-1 min-w-0"
                  placeholder="Search events, names, or paste an npub…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  data-testid="input-event-search"
                />
                <Button
                  size="sm"
                  className="h-11 px-4 rounded-full shrink-0 bg-sky-600 hover:bg-sky-700"
                  onClick={handleSearch}
                  disabled={loading}
                >
                  <Search className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                </Button>
              </div>
              {showSuggestions && suggestions.length > 0 && (
                <div
                  className="absolute z-50 top-full mt-1 left-0 right-0 rounded-lg overflow-hidden shadow-lg border border-border/30 max-h-[260px] overflow-y-auto bg-popover"
                  data-testid="dropdown-author-suggestions"
                >
                  {suggestions.map((ev) => {
                    let name = "";
                    let nip05 = "";
                    let picture = "";
                    try {
                      const c = JSON.parse(ev.content);
                      name = c.display_name || c.name || "";
                      nip05 = c.nip05 || "";
                      picture = c.picture || "";
                    } catch {}
                    if (!name) name = `npub1...${ev.pubkey.slice(-6)}`;
                    return (
                      <button
                        key={ev.pubkey}
                        type="button"
                        onMouseDown={(e) => {
                          // Prevent the input's onBlur from firing before the click registers.
                          e.preventDefault();
                        }}
                        onClick={() => pickAuthor(ev)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-sky-500/10 transition-colors"
                        data-testid={`suggest-author-${ev.pubkey.slice(0, 8)}`}
                      >
                        <Avatar className="w-7 h-7 shrink-0 border border-border/30">
                          <AvatarImage src={picture} alt={name} />
                          <AvatarFallback className="bg-muted text-foreground/60">
                            <UserIcon className="w-3.5 h-3.5" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-foreground/90 truncate">{name}</div>
                          {nip05 && (
                            <div className="text-[10px] text-muted-foreground/60 truncate">{nip05}</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  <div className="px-3 py-1 text-[9px] text-muted-foreground/40 text-center font-brand uppercase tracking-wider border-t border-border/20">
                    {suggestLoading ? "Searching…" : "Tap a creator to see their events"}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={searchMode === "all" ? "default" : "ghost"}
              className="h-7 sm:h-6 text-xs sm:text-[10px] px-3 sm:px-2"
              onClick={() => setSearchMode("all")}
            >
              All Relays
            </Button>
            {followedPubkeys && followedPubkeys.length > 0 && (
              <Button
                size="sm"
                variant={searchMode === "following" ? "default" : "ghost"}
                className="h-7 sm:h-6 text-xs sm:text-[10px] px-3 sm:px-2"
                onClick={() => setSearchMode("following")}
              >
                <Users className="w-3.5 h-3.5 sm:w-3 sm:h-3 mr-1" />
                Following
              </Button>
            )}
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 overscroll-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RelayOutpostInlineLoader className="w-6 h-6 text-sky-400" />
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="text-center py-8">
              <Calendar className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/40">No events found</p>
              <p className="text-[10px] text-muted-foreground/30 mt-1">
                Try different keywords or search all relays
              </p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-2 pb-4">
              <p className="text-[10px] text-muted-foreground/40">
                {results.length} event{results.length !== 1 ? "s" : ""} found
              </p>

              {pastEvents.length > 0 && (
                <div>
                  <button
                    className="flex items-center gap-1.5 w-full text-left py-2 sm:py-1.5 px-2 rounded-md hover:bg-muted/30 active:bg-muted/40 transition-colors group"
                    onClick={() => setShowPast(!showPast)}
                  >
                    <ChevronRight className={`w-3.5 h-3.5 sm:w-3 sm:h-3 text-muted-foreground/40 transition-transform ${showPast ? "rotate-90" : ""}`} />
                    <span className="text-xs sm:text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                      Past
                    </span>
                    <span className="text-xs sm:text-[10px] text-muted-foreground/30">
                      ({pastEvents.length})
                    </span>
                  </button>

                  {showPast && (
                    <div className="space-y-2 mt-1.5 pl-1">
                      {pastEvents.map((ce) => renderEventCard(ce, true))}
                    </div>
                  )}
                </div>
              )}

              {upcomingEvents.length > 0 && (
                <div className="space-y-2">
                  {pastEvents.length > 0 && (
                    <p className="text-xs sm:text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-2 pt-1">
                      Upcoming ({upcomingEvents.length})
                    </p>
                  )}
                  {upcomingEvents.map((ce) => renderEventCard(ce, false))}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
