import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchProfilesCached, FAST_RELAYS } from "@/lib/nostr";
import { fetchTrendingFeed, searchUsers, primalStatsCache } from "@/lib/primal-cache";
import { MIN_FOLLOWERS_GLOBAL, type ReachDepth } from "@/lib/spam-filter";
import { VerifiedBadgeIcon } from "@/components/NostrPost";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { Radio, Plus, Settings2, Trash2, Lock, Hash, Users, Filter, Eye, EyeOff, Type, X, Search, Grape, Rss, ChevronDown, ChevronUp, Antenna, ShieldCheck, RotateCcw } from "lucide-react";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { type SignalTier, getSignalTierLabel, getSignalTierShortLabel } from "@/lib/graperank";
import { getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import { nip19 } from "nostr-tools";
import { useNostrFeeds, type NostrCustomFeed } from "@/hooks/use-nostr-feeds";
import { FeedIcon as FeedIconSvg, FEED_ICON_LIST, isValidFeedIconKey, type FeedIconKey } from "@/components/FeedIcons";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustTierDot } from "@/components/NostrPost";
import { Nip05Badge } from "@/components/Nip05Badge";
import { BrowsePacksDialog } from "@/components/BrowsePacksDialog";
import type { FeedMode, FeedSortMode, TopTimeWindow } from "./helpers";
import { TRENDING_SELECTORS, FEED_SORT_OPTIONS, TIME_WINDOW_SORT_MODES, TOP_TIME_WINDOWS, BUILT_IN_TABS, decodePubkey } from "./helpers";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Link } from "wouter";
import { PRESET_DEFS, type StrictnessPreset } from "@/lib/trust-preset";

export function FeedSkeletonCard() {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="glass-header rounded-t-xl px-3.5 sm:px-5 pt-3.5 sm:pt-4 pb-2.5 sm:pb-3">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <Skeleton className="w-9 h-9 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-2.5 w-16 sm:hidden" />
          </div>
          <Skeleton className="h-2.5 w-12 hidden sm:block" />
        </div>
      </div>
      <div className="px-3.5 sm:px-5 py-3 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="glass-footer rounded-b-xl px-3.5 sm:px-5 py-3 flex items-center gap-3">
        <Skeleton className="h-3.5 w-6" />
        <Skeleton className="h-3.5 w-6" />
        <Skeleton className="h-3.5 w-6" />
        <Skeleton className="h-3.5 w-6" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>
    </div>
  );
}

export function FeedSkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3" data-testid="container-feed-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <FeedSkeletonCard key={i} />
      ))}
    </div>
  );
}


export function ChipInput({
  chips, onAdd, onRemove, placeholder, icon: Icon, label, prefix, testId }: {
  chips: string[];
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
  placeholder: string;
  icon: typeof Hash;
  label: string;
  prefix?: string;
  testId: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commitValue = () => {
    const values = inputValue.split(",").map(s => s.trim().replace(/^#/, "")).filter(Boolean);
    for (const v of values) {
      if (!(chips || []).includes(v.toLowerCase())) onAdd(v.toLowerCase());
    }
    setInputValue("");
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-brand dark:text-brand/70 flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </Label>
      <div
        className="flex flex-wrap gap-1.5 min-h-[38px] p-2 rounded-md border text-sm bg-accent/40 dark:bg-white/[0.03] border-border dark:border-brand/20 focus-within:border-brand/40 cursor-text transition-colors"
        onClick={() => inputRef.current?.focus()}
        data-testid={`container-${testId}`}
      >
        {(chips || []).map((chip, i) => (
          <span
            key={`${chip}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent dark:bg-brand/15 text-brand text-xs border border-brand/20"
          >
            {prefix}{chip}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(i); }}
              className="hover:text-destructive transition-colors"
              data-testid={`button-remove-${testId}-${i}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitValue();
            }
            if (e.key === "Backspace" && !inputValue && (chips || []).length > 0) {
              onRemove((chips || []).length - 1);
            }
          }}
          onBlur={commitValue}
          placeholder={(chips || []).length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-muted-foreground/30"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          data-testid={`input-${testId}`}
        />
      </div>
    </div>
  );
}


export function PeopleSearch({
  selectedPubkeys, onAdd, onRemove }: {
  selectedPubkeys: { pubkey: string; name: string; picture?: string }[];
  onAdd: (person: { pubkey: string; name: string; picture?: string }) => void;
  onRemove: (index: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Event[]>([]);
  const [searching, setSearching] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set((selectedPubkeys || []).map(p => p.pubkey)), [selectedPubkeys]);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => {
      const threshold = window.innerHeight * 0.75;
      setKeyboardOpen(vv.height < threshold);
    };
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const handleFocus = useCallback(() => {
    if (!isMobile) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    });
  }, [isMobile]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const pk = decodePubkey(q);
      if (pk) {
        await fetchProfilesCached([pk]);
        const profileEvent = eventStore.getEvent({ kind: 0, pubkey: pk, identifier: "" });
        setResults(profileEvent ? [profileEvent] : []);
      } else {
        const found = await searchUsers(q, 8);
        setResults(found);
      }
    } catch {
      setResults([]);
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(query.trim()), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const getProfile = (event: Event) => {
    try { return JSON.parse(event.content); } catch { return {}; }
  };

  const showAbove = isMobile && keyboardOpen;

  const resultsContent = results.length > 0 && query.trim() ? (
    <div
      className={cn(
        "rounded-md border border-border dark:border-brand/20 bg-background dark:bg-[hsl(260,8%,6%)] overflow-y-auto",
        showAbove
          ? "mb-1 max-h-[35vh] shadow-[0_-4px_20px_rgba(109,40,217,0.15)]"
          : "mt-1 max-h-[180px]"
      )}
      data-testid="container-people-results"
    >
      {results.map((event) => {
        const profile = getProfile(event);
        const isSelected = selectedSet.has(event.pubkey);
        return (
          <button
            key={event.pubkey}
            type="button"
            disabled={isSelected}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
              isSelected ? "opacity-40 cursor-default" : "hover:bg-accent dark:hover:bg-brand/10 cursor-pointer"
            )}
            onClick={() => {
              if (!isSelected) {
                onAdd({
                  pubkey: event.pubkey,
                  name: profile.display_name || profile.name || "",
                  picture: profile.picture });
                setQuery("");
                setResults([]);
              }
            }}
            data-testid={`button-add-person-${event.pubkey.slice(0, 8)}`}
          >
            <Avatar className="w-7 h-7 shrink-0">
              <AvatarImage src={profile.picture} />
              <AvatarFallback className="text-[10px] bg-brand/15 dark:bg-brand/20">{(profile.display_name || profile.name || "?")[0]}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{profile.display_name || profile.name || event.pubkey.slice(0, 12) + "..."}</p>
              {profile.nip05 && <p className="text-[10px] text-muted-foreground/50 truncate">{profile.nip05}</p>}
            </div>
            {isSelected && <span className="text-[10px] text-brand shrink-0">Added</span>}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-brand dark:text-brand/70 flex items-center gap-1.5">
        <Users className="w-3 h-3" />
        People
      </Label>

      {(selectedPubkeys || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(selectedPubkeys || []).map((person, i) => (
            <span
              key={person.pubkey}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent dark:bg-brand/15 text-brand text-xs border border-brand/20"
            >
              <Avatar className="w-4 h-4">
                <AvatarImage src={person.picture} />
                <AvatarFallback className="text-[8px] bg-brand/15 dark:bg-brand/20">{(person.name || "?")[0]}</AvatarFallback>
              </Avatar>
              {person.name || person.pubkey.slice(0, 8) + "..."}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="hover:text-destructive transition-colors"
                data-testid={`button-remove-person-${i}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {showAbove && resultsContent}

      <div ref={containerRef}>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleFocus}
            placeholder="Search by name or paste npub..."
            className="pl-8 text-sm bg-accent/40 dark:bg-white/[0.03] border-border dark:border-brand/20 focus-visible:border-brand/40 placeholder:text-muted-foreground/30"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            data-testid="input-people-search"
          />
          {searching && <RelayOutpostInlineLoader className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand" />}
        </div>

        {!showAbove && resultsContent}
      </div>
    </div>
  );
}


export function TuneFrequencyFormContent({
  name, setName,
  hashtags, onAddHashtag, onRemoveHashtag,
  includeKeywords, onAddInclude, onRemoveInclude,
  excludeKeywords, onAddExclude, onRemoveExclude,
  selectedPeople, onAddPerson, onRemovePerson,
  contentType, setContentType,
  icon, setIcon }: {
  name: string; setName: (v: string) => void;
  hashtags: string[]; onAddHashtag: (v: string) => void; onRemoveHashtag: (i: number) => void;
  includeKeywords: string[]; onAddInclude: (v: string) => void; onRemoveInclude: (i: number) => void;
  excludeKeywords: string[]; onAddExclude: (v: string) => void; onRemoveExclude: (i: number) => void;
  selectedPeople: { pubkey: string; name: string; picture?: string }[]; onAddPerson: (p: { pubkey: string; name: string; picture?: string }) => void; onRemovePerson: (i: number) => void;
  contentType: string; setContentType: (v: string) => void;
  icon: FeedIconKey | undefined; setIcon: (v: FeedIconKey | undefined) => void;
}) {
  const inputClass = "text-sm bg-accent/40 dark:bg-white/[0.03] border-border dark:border-brand/20 focus-visible:border-primary/40 dark:focus-visible:border-brand/40 placeholder:text-muted-foreground/30";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="feed-name" className="text-xs text-brand dark:text-brand/70 flex items-center gap-1.5">
          <Radio className="w-3 h-3" />
          Feed Name
        </Label>
        <div className="flex gap-2">
          <Input
            id="feed-name"
            placeholder="e.g. Bitcoin Alpha, Art Feed..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(inputClass, "flex-1")}
            enterKeyHint="next"
            autoCorrect="off"
            data-testid="input-feed-name"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-brand dark:text-brand/70 flex items-center gap-1.5">
          <Antenna className="w-3 h-3" />
          Icon
        </Label>
        <div className="flex flex-wrap gap-1">
          {FEED_ICON_LIST.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setIcon(icon === key ? undefined : key)}
              className={cn(
                "p-1.5 rounded-md border transition-all",
                icon === key
                  ? "border-primary/50 bg-accent text-primary dark:border-brand/50 dark:bg-brand/15 dark:text-brand shadow-[0_0_8px_rgba(139,92,246,0.2)]"
                  : "border-border bg-card text-muted-foreground/60 hover:border-primary/25 hover:bg-accent dark:border-brand/10 dark:bg-white/[0.02] dark:hover:border-brand/25 dark:hover:bg-brand/5"
              )}
              data-testid={`icon-pick-${key}`}
            >
              <FeedIconSvg iconKey={key} className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-brand/15 to-transparent" />

      <PeopleSearch
        selectedPubkeys={selectedPeople}
        onAdd={onAddPerson}
        onRemove={onRemovePerson}
      />

      <ChipInput
        chips={hashtags}
        onAdd={onAddHashtag}
        onRemove={onRemoveHashtag}
        placeholder="Type a hashtag and press Enter"
        icon={Hash}
        label="Hashtags"
        prefix="#"
        testId="feed-hashtags"
      />

      <div className="space-y-1.5">
        <Label className="text-xs text-brand dark:text-brand/70 flex items-center gap-1.5">
          <Type className="w-3 h-3" />
          Content Type
        </Label>
        <Select value={contentType} onValueChange={setContentType}>
          <SelectTrigger data-testid="select-content-type" className={inputClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[300]">
            <SelectItem value="all">All Notes</SelectItem>
            <SelectItem value="text_only">Text Only</SelectItem>
            <SelectItem value="media">Media (Images/Video)</SelectItem>
            <SelectItem value="links">Links Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-brand/15 to-transparent" />

      <ChipInput
        chips={includeKeywords}
        onAdd={onAddInclude}
        onRemove={onRemoveInclude}
        placeholder="Words posts must contain"
        icon={Eye}
        label="Must contain"
        testId="feed-include"
      />

      <ChipInput
        chips={excludeKeywords}
        onAdd={onAddExclude}
        onRemove={onRemoveExclude}
        placeholder="Words to filter out"
        icon={EyeOff}
        label="Hide posts with"
        testId="feed-exclude"
      />
    </div>
  );
}


export function TuneFrequencyDialog({
  open,
  onOpenChange,
  onSave,
  isSaving,
  editFeed }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (feed: { name: string; hashtags: string[]; authorPubkeys: string[]; includeKeywords: string[]; excludeKeywords: string[]; contentType: string; icon?: FeedIconKey }) => void;
  isSaving: boolean;
  editFeed?: NostrCustomFeed | null;
}) {
  const [name, setName] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [includeKeywords, setIncludeKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<{ pubkey: string; name: string; picture?: string }[]>([]);
  const [contentType, setContentType] = useState("all");
  const [icon, setIcon] = useState<FeedIconKey | undefined>(undefined);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (open && editFeed) {
      setName(editFeed.name);
      setHashtags(editFeed.hashtags || []);
      setIncludeKeywords(editFeed.includeKeywords || []);
      setExcludeKeywords(editFeed.excludeKeywords || []);
      setContentType(editFeed.contentType);
      setIcon(isValidFeedIconKey(editFeed.icon) ? editFeed.icon : undefined);
      const people = (editFeed.authorPubkeys || []).map((pk) => {
        const profileEvent = eventStore.getEvent({ kind: 0, pubkey: pk, identifier: "" });
        let pName = pk.slice(0, 8) + "...";
        let picture: string | undefined;
        if (profileEvent) {
          try {
            const content = JSON.parse(profileEvent.content);
            pName = content.display_name || content.name || pName;
            picture = content.picture;
          } catch {}
        }
        return { pubkey: pk, name: pName, picture };
      });
      setSelectedPeople(people);
    } else if (open) {
      setName("");
      setHashtags([]);
      setIncludeKeywords([]);
      setExcludeKeywords([]);
      setSelectedPeople([]);
      setContentType("all");
      setIcon(undefined);
    }
  }, [open, editFeed]);

  const handleSave = () => {
    const authorPubkeys = selectedPeople.map(p => p.pubkey);
    onSave({ name: name.trim() || "Untitled Feed", hashtags, authorPubkeys, includeKeywords, excludeKeywords, contentType, icon });
  };

  const formProps = {
    name, setName,
    hashtags,
    onAddHashtag: (v: string) => setHashtags(prev => [...prev, v]),
    onRemoveHashtag: (i: number) => setHashtags(prev => prev.filter((_, idx) => idx !== i)),
    includeKeywords,
    onAddInclude: (v: string) => setIncludeKeywords(prev => [...prev, v]),
    onRemoveInclude: (i: number) => setIncludeKeywords(prev => prev.filter((_, idx) => idx !== i)),
    excludeKeywords,
    onAddExclude: (v: string) => setExcludeKeywords(prev => [...prev, v]),
    onRemoveExclude: (i: number) => setExcludeKeywords(prev => prev.filter((_, idx) => idx !== i)),
    selectedPeople,
    onAddPerson: (p: { pubkey: string; name: string; picture?: string }) => setSelectedPeople(prev => [...prev, p]),
    onRemovePerson: (i: number) => setSelectedPeople(prev => prev.filter((_, idx) => idx !== i)),
    contentType, setContentType,
    icon, setIcon };

  const titleText = editFeed ? "Edit Feed" : "Tune Feed";
  const saveLabel = isSaving ? "Locking..." : editFeed ? "Update Feed" : "Lock Feed";

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
        <DrawerContent className="border-border dark:border-brand/20 bg-background dark:bg-[hsl(260,8%,4%)]" onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
          <DrawerHeader className="pb-2">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-accent dark:bg-brand/10">
                <Settings2 className="w-4 h-4 text-brand" />
              </div>
              <div>
                <DrawerTitle className="text-sm font-semibold text-foreground">{titleText}</DrawerTitle>
                <p className="text-[11px] text-brand/60 dark:text-brand/40 mt-0.5">Configure your signal filters</p>
              </div>
            </div>
          </DrawerHeader>
          <div className="px-4 pb-3 overflow-y-auto max-h-[65vh]">
            <TuneFrequencyFormContent {...formProps} />
          </div>
          <DrawerFooter className="flex-row gap-2 pt-3 border-t border-border dark:border-brand/10">
            <Button variant="outline" className="flex-1 border-border dark:border-brand/20 text-muted-foreground" onClick={() => onOpenChange(false)} data-testid="button-cancel-feed">
              Cancel
            </Button>
            <Button className="flex-1 bg-primary text-primary-foreground dark:bg-brand dark:text-white" onClick={handleSave} disabled={isSaving} data-testid="button-save-feed">
              <Lock className="w-3.5 h-3.5 mr-1.5" />
              {saveLabel}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto border-border dark:border-brand/20 bg-background dark:bg-[hsl(260,8%,4%)]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-accent dark:bg-brand/10">
              <Settings2 className="w-4 h-4 text-brand" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">{titleText}</DialogTitle>
              <DialogDescription className="text-[11px] text-brand/60 dark:text-brand/40 mt-0.5">
                Configure your signal filters
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="py-1">
          <TuneFrequencyFormContent {...formProps} />
        </div>
        <DialogFooter className="gap-2 border-t border-border dark:border-brand/10 pt-4">
          <Button variant="outline" className="border-border dark:border-brand/20 text-muted-foreground" onClick={() => onOpenChange(false)} data-testid="button-cancel-feed">
            Cancel
          </Button>
          <Button className="bg-primary text-primary-foreground dark:bg-brand dark:text-white" onClick={handleSave} disabled={isSaving} data-testid="button-save-feed">
            <Lock className="w-3.5 h-3.5 mr-1.5" />
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export const REACH_DEPTH_STOPS: { value: ReachDepth; label: string; shortLabel: string; description: string }[] = [
  { value: "global", label: "Network", shortLabel: "Network", description: "Your follows + friends of friends + trusted strangers" },
  { value: "off", label: "Everyone", shortLabel: "Everyone", description: "No trust filter — full firehose" },
];

function abbreviateCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toString();
}

export function ReachDepthSlider({
  depth,
  onChange,
  follows,
  followsOfFollows,
  grapeRankScores,
  filteredPostCount,
  perStopPostCounts,
  loadingScores }: {
  depth: ReachDepth;
  onChange: (d: ReachDepth) => void;
  follows: Set<string>;
  followsOfFollows?: Set<string>;
  grapeRankScores: Map<string, number> | null;
  filteredPostCount?: number;
  perStopPostCounts?: Record<ReachDepth, number>;
  loadingScores?: boolean;
}) {
  const allTiersIdentical = useMemo(() => {
    if (!perStopPostCounts) return false;
    const tiers: ReachDepth[] = ["1hop", "2hops", "3hops", "global"];
    const vals = tiers.map(t => perStopPostCounts[t]).filter(v => v !== undefined);
    if (vals.length < 2) return false;
    return vals.every(v => v === vals[0]);
  }, [perStopPostCounts]);
  const activeIndex = REACH_DEPTH_STOPS.findIndex(s => s.value === depth);
  const activeStop = REACH_DEPTH_STOPS[activeIndex] ?? REACH_DEPTH_STOPS[4];

  const reachCount = useMemo(() => {
    if (depth === "off") return null;
    if (depth === "1hop") return follows.size;
    const fofSize = followsOfFollows ? followsOfFollows.size : 0;
    if (depth === "2hops") return follows.size + fofSize;
    if (depth === "3hops") {
      let extra = 0;
      if (grapeRankScores) {
        grapeRankScores.forEach((_score, pk) => {
          if (follows.has(pk)) return;
          if (followsOfFollows?.has(pk)) return;
          extra++;
        });
      }
      return follows.size + fofSize + extra;
    }
    let extra = 0;
    if (grapeRankScores) {
      grapeRankScores.forEach((score, pk) => {
        if (score <= 0) return;
        if (follows.has(pk)) return;
        if (followsOfFollows?.has(pk)) return;
        extra++;
      });
    }
    return follows.size + fofSize + extra;
  }, [depth, follows, followsOfFollows, grapeRankScores]);

  const depthDescription = depth === "off"
    ? "No trust filter · you'll see everything"
    : depth === "1hop"
    ? "Only people you follow"
    : depth === "2hops"
    ? "You + friends of friends"
    : depth === "3hops"
    ? "2 hops + anyone we have a trust signal for"
    : "2 hops + anyone with positive trust";

  return (
    <div className="mb-3 space-y-2" data-testid="container-reach-depth">
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-brand/70">
          <g clipPath="url(#reach-icon)">
            <path d="M15.0301 10.7697L20.6901 6.97973C21.2601 6.59973 21.4101 5.81973 21.0301 5.25973L19.2101 2.54971C18.8301 1.97971 18.0501 1.82971 17.4901 2.20971L11.8301 5.99972L15.0301 10.7697Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.1739 6.47981L7.39624 9.67969L9.95614 13.5018L14.7338 10.302L12.1739 6.47981Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5.83004 15.8999L9.78004 13.2599L7.54004 9.91992L3.59004 12.5599C3.13004 12.8699 3.01004 13.4899 3.32004 13.9499L4.45004 15.6299C4.75004 16.0799 5.37004 16.1999 5.83004 15.8999Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.0501 12.1992L7.56006 21.9992" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 12.1992L16.44 21.9992" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <defs>
            <clipPath id="reach-icon">
              <rect width="24" height="24" fill="white"/>
            </clipPath>
          </defs>
        </svg>
        <span className="text-[11px] font-medium text-foreground/70 dark:text-foreground/60 tracking-wide uppercase">
          Trust Reach
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Trust reach"
        className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-accent/50 dark:bg-brand/[0.06] border border-border dark:border-brand/10"
      >
        {REACH_DEPTH_STOPS.map((stop) => {
          const isActive = stop.value === depth;
          return (
            <button
              key={stop.value}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(stop.value)}
              className={cn(
                "flex items-center justify-center py-1.5 px-1 rounded-md transition-all duration-150",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:focus-visible:ring-brand/50",
                isActive
                  ? "bg-accent border border-primary/20 dark:border-transparent dark:bg-brand/15 dark:shadow-[inset_0_0_0_1px_rgba(192,132,252,0.3)]"
                  : "hover:bg-accent/60 dark:hover:bg-brand/[0.05]"
              )}
              data-testid={`button-reach-${stop.value}`}
              title={stop.description}
            >
              <span
                className={cn(
                  "text-[11px] leading-none font-medium transition-colors duration-150",
                  isActive
                    ? "text-accent-foreground dark:text-brand"
                    : "text-muted-foreground/60"
                )}
              >
                {stop.label}
              </span>
            </button>
          );
        })}
      </div>

      {reachCount !== null && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-[10px] text-brand/60 dark:text-brand/50 font-medium shrink-0 tabular-nums" data-testid="text-reach-count">
            {reachCount.toLocaleString()} accounts
          </span>
        </div>
      )}

      {loadingScores && (
        <div className="flex items-center gap-1.5 text-[10px] text-brand/70 dark:text-brand/60" data-testid="text-reach-loading-scores">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Loading trust scores…
        </div>
      )}

      {!loadingScores && allTiersIdentical && (
        <div className="text-[10px] text-muted-foreground/50 italic leading-tight" data-testid="text-reach-tiers-identical">
          Your loaded feed has the same posts at every reach level — try refreshing or scrolling for more variety.
        </div>
      )}
    </div>
  );
}


const PRESET_ORDER: Exclude<StrictnessPreset, "custom">[] = ["open", "balanced", "strict"];

/**
 * "How strict?" — the single headline trust control for the feed. Shows a
 * compact Open · Balanced · Strict segmented control (or a non-clickable
 * "Custom" pill when the raw knobs don't match any preset), the reach-count
 * for context, an "Adjust in Trust & Safety →" link, and a collapsible
 * "Customize" disclosure that holds the granular Network/Everyone + tier dots.
 */
export function StrictnessPresetControl({
  active,
  onSelect,
  reachCount,
  loadingScores,
  customizeOpen,
  onToggleCustomize,
  children }: {
  active: StrictnessPreset;
  onSelect: (name: Exclude<StrictnessPreset, "custom">) => void;
  reachCount?: number | null;
  loadingScores?: boolean;
  customizeOpen: boolean;
  onToggleCustomize: () => void;
  children?: ReactNode;
}) {
  const isCustom = active === "custom";

  return (
    <div className="mb-3 space-y-2" data-testid="container-strictness-preset">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-brand/70" />
          <span className="text-[11px] font-medium text-foreground/70 dark:text-foreground/60 tracking-wide uppercase">
            How strict?
          </span>
        </div>

        <div
          role="radiogroup"
          aria-label="Feed strictness"
          className="flex items-center gap-1 p-1 rounded-lg bg-accent/50 dark:bg-brand/[0.06] border border-border dark:border-brand/10"
        >
          {PRESET_ORDER.map((name) => {
            const def = PRESET_DEFS[name];
            const selected = active === name;
            return (
              <button
                key={name}
                role="radio"
                aria-checked={selected}
                aria-label={`${def.label} — ${def.blurb}`}
                title={def.blurb}
                onClick={() => onSelect(name)}
                className={cn(
                  "min-h-[40px] sm:min-h-0 flex items-center justify-center py-1.5 px-3 rounded-md transition-all duration-150",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:focus-visible:ring-brand/50",
                  selected
                    ? "bg-accent border border-primary/20 dark:border-transparent dark:bg-brand/15 dark:shadow-[inset_0_0_0_1px_rgba(192,132,252,0.3)]"
                    : "hover:bg-accent/60 dark:hover:bg-brand/[0.05]"
                )}
                data-testid={`button-preset-${name}`}
              >
                <span
                  className={cn(
                    "text-[11px] leading-none font-medium transition-colors duration-150",
                    selected ? "text-accent-foreground dark:text-brand" : "text-muted-foreground/60"
                  )}
                >
                  {def.label}
                </span>
              </button>
            );
          })}
          {isCustom && (
            <span
              className="min-h-[40px] sm:min-h-0 flex items-center justify-center py-1.5 px-3 rounded-md bg-accent border border-brand/20 dark:border-transparent dark:bg-brand/15 dark:shadow-[inset_0_0_0_1px_rgba(192,132,252,0.3)] text-[11px] leading-none font-medium text-accent-foreground dark:text-brand cursor-default select-none"
              aria-current="true"
              data-testid="indicator-preset-custom"
            >
              Custom
            </span>
          )}
        </div>

        {reachCount !== null && reachCount !== undefined && (
          <span className="text-[10px] text-brand/60 dark:text-brand/50 font-medium shrink-0 tabular-nums" data-testid="text-reach-count">
            {reachCount.toLocaleString()} accounts
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleCustomize}
          aria-expanded={customizeOpen}
          aria-controls="strictness-customize-panel"
          className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-0 py-1 text-[11px] font-medium text-brand/70 hover:text-brand transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
          data-testid="button-trust-customize"
        >
          {customizeOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Customize
        </button>

        <Link
          href="/shield-matrix"
          className="inline-flex items-center min-h-[40px] sm:min-h-0 py-1 text-[11px] font-medium text-brand/70 hover:text-brand hover:underline transition-colors"
          data-testid="link-adjust-trust-safety"
        >
          Adjust in Trust &amp; Safety&nbsp;&rarr;
        </Link>
      </div>

      {loadingScores && (
        <div className="flex items-center gap-1.5 text-[10px] text-brand/70 dark:text-brand/60" data-testid="text-reach-loading-scores">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Loading trust scores…
        </div>
      )}

      {customizeOpen && (
        <div id="strictness-customize-panel" className="space-y-2 pt-1" data-testid="container-trust-customize-panel">
          {children}
        </div>
      )}
    </div>
  );
}


export const FEED_FILTER_TIERS: SignalTier[] = ["strong", "moderate", "low", "weak", "none", "flagged"];

export function FeedTierFilter({ excludedTiers, onToggle, onClear }: {
  excludedTiers: Set<SignalTier>;
  onToggle: (tier: SignalTier) => void;
  onClear: () => void;
}) {
  const hasFilters = excludedTiers.size > 0;

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 mb-2 -mt-1 px-1.5 py-1 rounded-md bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06]">
      <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${hasFilters ? "text-brand/70 dark:text-brand/60" : "text-brand/40 dark:text-brand/30"}`} />
      <div className="flex items-center gap-0.5 flex-nowrap min-w-0">
        {FEED_FILTER_TIERS.map(tier => {
          const excluded = excludedTiers.has(tier);
          const fullLabel = getSignalTierLabel(tier);
          return (
            <button
              key={tier}
              onClick={() => onToggle(tier)}
              title={fullLabel}
              aria-label={fullLabel}
              className={`flex items-center gap-1 px-1 sm:px-2 py-0.5 rounded-sm text-[10px] font-medium transition-all duration-150 cursor-pointer ${
                excluded
                  ? "opacity-40 line-through text-muted-foreground dark:text-neutral-500 hover:opacity-60"
                  : hasFilters
                  ? "text-foreground dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  : "text-muted-foreground dark:text-neutral-400 hover:text-foreground dark:hover:text-neutral-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              }`}
            >
              <TrustTierGlyph tier={tier} size="w-2 h-2" decorative className={excluded ? "opacity-25" : ""} />
              <span className="sm:hidden">{getSignalTierShortLabel(tier)}</span>
              <span className="hidden sm:inline">{fullLabel}</span>
            </button>
          );
        })}
      </div>
      {hasFilters && (
        <button
          onClick={onClear}
          title="Reset filters"
          aria-label="Reset filters"
          className="flex items-center gap-1 ml-auto shrink-0 text-[10px] font-medium text-brand/70 hover:text-brand transition-colors"
        >
          <RotateCcw className="w-3 h-3 sm:hidden" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      )}
    </div>
  );
}

