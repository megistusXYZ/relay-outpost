import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import {
  Rss,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Check,
  Loader2,
  Radio,
  Search,
  Bell,
} from "lucide-react";
import {
  FEED_CATEGORIES,
  getAllCatalogFeeds,
  type FeedCatalogEntry,
} from "@/lib/calendar-feeds-catalog";
import {
  getSubscribedFeeds,
  subscribeFeed,
  unsubscribeFeed,
  catalogEntryToSubscribedFeed,
  parseIcal,
  getFeedReminderSettings,
  saveFeedReminderSettings,
  getFeedReminderEnabledFeeds,
  saveFeedReminderEnabledFeeds,
  toggleFeedReminderForFeed,
  FEED_REMINDER_OPTIONS,
  type SubscribedFeed,
  type FeedReminderInterval,
} from "@/lib/calendar-feeds";
import { searchUsers } from "@/lib/primal-cache";
import { searchCachedProfiles } from "@/lib/nostr";
import {
  getSubscribedCreators,
  subscribeCreator,
  unsubscribeCreator,
  type SubscribedCreator,
} from "@/lib/creator-subscriptions";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { nip19 } from "nostr-tools";

interface SubscriptionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pubkey: string;
  onChanged: () => void;
  onCreatorsChanged?: () => void;
}

function CreatorRow({ creatorPubkey, onRemove }: { creatorPubkey: string; onRemove: (pubkey: string, name: string) => void }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, creatorPubkey), [creatorPubkey]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(creatorPubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-brand dark:bg-brand/10 group">
      <Avatar className="w-6 h-6 border border-brand/30 dark:border-brand/20">
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className="text-[9px] bg-brand/60 dark:bg-brand/50 text-brand">
          {displayName?.charAt(0)?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-brand font-medium truncate">{displayName}</p>
        <p className="text-[9px] text-gray-400 dark:text-gray-500 truncate font-mono">
          {shortenNpub(formatNpub(creatorPubkey))}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 reveal-on-hover touch-target"
        aria-label={`Unsubscribe from ${displayName}`}
        title="Unsubscribe"
        onClick={() => onRemove(creatorPubkey, displayName)}
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}

export function SubscriptionManager({ open, onOpenChange, pubkey, onChanged, onCreatorsChanged }: SubscriptionManagerProps) {
  const { toast } = useToast();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [customUrl, setCustomUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [validatingUrl, setValidatingUrl] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creatorInput, setCreatorInput] = useState("");
  const [creatorSearchResults, setCreatorSearchResults] = useState<any[]>([]);
  const [creatorSearching, setCreatorSearching] = useState(false);
  const [showCreatorDropdown, setShowCreatorDropdown] = useState(false);
  const creatorDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const creatorInputRef = useRef<HTMLInputElement>(null);
  const creatorDropdownRef = useRef<HTMLDivElement>(null);
  const [creatorRefreshKey, setCreatorRefreshKey] = useState(0);

  const subscribedFeeds = useMemo(() => getSubscribedFeeds(pubkey), [pubkey, refreshKey]);
  const subscribedIds = useMemo(() => new Set(subscribedFeeds.map((f) => f.id)), [subscribedFeeds]);
  const subscribedCreators = useMemo(() => getSubscribedCreators(pubkey), [pubkey, creatorRefreshKey]);
  const [feedReminders, setFeedReminders] = useState<FeedReminderInterval[]>(() => getFeedReminderSettings(pubkey));
  const [reminderEnabledFeeds, setReminderEnabledFeeds] = useState<Set<string>>(() => {
    const existing = getFeedReminderEnabledFeeds(pubkey);
    if (existing.size === 0 && getFeedReminderSettings(pubkey).length > 0) {
      const allFeedIds = new Set(getSubscribedFeeds(pubkey).map(f => f.id));
      if (allFeedIds.size > 0) {
        saveFeedReminderEnabledFeeds(pubkey, allFeedIds);
        return allFeedIds;
      }
    }
    return existing;
  });

  const toggleFeedReminder = useCallback((interval: FeedReminderInterval) => {
    setFeedReminders((prev) => {
      const next = prev.includes(interval) ? prev.filter((r) => r !== interval) : [...prev, interval];
      saveFeedReminderSettings(pubkey, next);
      onChanged();
      return next;
    });
  }, [pubkey, onChanged]);

  const handleToggleFeedReminder = useCallback((feedId: string) => {
    toggleFeedReminderForFeed(pubkey, feedId);
    setReminderEnabledFeeds(getFeedReminderEnabledFeeds(pubkey));
    onChanged();
  }, [pubkey, onChanged]);

  useEffect(() => {
    if (open && subscribedCreators.length > 0) {
      fetchProfilesCached(subscribedCreators.map((c) => c.pubkey));
    }
  }, [open, subscribedCreators]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onChanged();
  }, [onChanged]);

  const refreshCreators = useCallback(() => {
    setCreatorRefreshKey((k) => k + 1);
    if (onCreatorsChanged) onCreatorsChanged();
  }, [onCreatorsChanged]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleToggleFeed = (entry: FeedCatalogEntry) => {
    if (subscribedIds.has(entry.id)) {
      unsubscribeFeed(pubkey, entry.id);
      toast({ title: "Unsubscribed", description: `${entry.name} removed from your calendar.` });
    } else {
      subscribeFeed(pubkey, catalogEntryToSubscribedFeed(entry));
      toast({ title: "Subscribed", description: `${entry.name} added to your calendar.` });
    }
    refresh();
  };

  const handleAddCustom = async () => {
    const url = customUrl.trim();
    const name = customName.trim();
    if (!url || !name) return;

    try {
      new URL(url);
    } catch {
      toast({ title: "Invalid URL", description: "Please enter a valid URL.", variant: "destructive" });
      return;
    }

    setValidatingUrl(true);
    try {
      const response = await fetch(`/api/ical-proxy?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Failed to fetch feed" }));
        toast({ title: "Invalid Feed", description: data.error || "Could not fetch the calendar feed.", variant: "destructive" });
        return;
      }
      const text = await response.text();
      const events = parseIcal(text);
      if (events.length === 0) {
        toast({ title: "No Events", description: "The feed was fetched but contains no events.", variant: "destructive" });
        return;
      }

      const customId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const feed: SubscribedFeed = {
        id: customId,
        name,
        emoji: "📅",
        url,
        isCatalog: false,
      };
      subscribeFeed(pubkey, feed);
      toast({ title: "Added", description: `${name} added with ${events.length} events.` });
      setCustomUrl("");
      setCustomName("");
      setShowCustomForm(false);
      refresh();
    } catch {
      toast({ title: "Error", description: "Failed to validate the feed. Please check the URL.", variant: "destructive" });
    } finally {
      setValidatingUrl(false);
    }
  };

  const handleRemoveCustom = (feed: SubscribedFeed) => {
    unsubscribeFeed(pubkey, feed.id);
    toast({ title: "Removed", description: `${feed.name} removed from your calendar.` });
    refresh();
  };

  const [creatorResolving, setCreatorResolving] = useState(false);

  const finishAddCreator = (creatorPubkey: string) => {
    if (creatorPubkey === pubkey) {
      toast({ title: "That's you!", description: "You can't subscribe to your own streams.", variant: "destructive" });
      return;
    }

    if (subscribedCreators.some((c) => c.pubkey === creatorPubkey)) {
      toast({ title: "Already subscribed", description: "You're already subscribed to this creator." });
      setCreatorInput("");
      setShowCreatorDropdown(false);
      setCreatorSearchResults([]);
      return;
    }

    subscribeCreator(pubkey, creatorPubkey);
    fetchProfilesCached([creatorPubkey]);
    toast({ title: "Subscribed", description: "Creator's planned streams will appear on your calendar." });
    setCreatorInput("");
    setShowCreatorDropdown(false);
    setCreatorSearchResults([]);
    refreshCreators();
  };

  const handleCreatorInputChange = useCallback((value: string) => {
    setCreatorInput(value);
    const trimmed = value.trim();

    if (!trimmed) {
      setCreatorSearchResults([]);
      setShowCreatorDropdown(false);
      return;
    }

    if (trimmed.startsWith("npub1") || /^[0-9a-f]{64}$/i.test(trimmed) || trimmed.includes("@") || trimmed.includes(".")) {
      setCreatorSearchResults([]);
      setShowCreatorDropdown(false);
      return;
    }

    if (creatorDebounceRef.current) clearTimeout(creatorDebounceRef.current);
    creatorDebounceRef.current = setTimeout(async () => {
      const cached = searchCachedProfiles(trimmed, 6);
      if (cached.length > 0) {
        setCreatorSearchResults(cached);
        setShowCreatorDropdown(true);
      }

      setCreatorSearching(true);
      try {
        const remote = await searchUsers(trimmed, 8);
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) {
            seen.add(e.pubkey);
            merged.push(e);
          }
        }
        setCreatorSearchResults(merged.slice(0, 6));
        if (merged.length > 0) setShowCreatorDropdown(true);
      } catch {}
      setCreatorSearching(false);
    }, 300);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        creatorDropdownRef.current && !creatorDropdownRef.current.contains(e.target as Node) &&
        creatorInputRef.current && !creatorInputRef.current.contains(e.target as Node)
      ) {
        setShowCreatorDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAddCreator = async () => {
    const input = creatorInput.trim();
    if (!input) return;

    let creatorPubkey: string | null = null;
    try {
      if (input.startsWith("npub1")) {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") creatorPubkey = decoded.data as string;
      } else if (/^[0-9a-f]{64}$/i.test(input)) {
        creatorPubkey = input.toLowerCase();
      }
    } catch {}

    if (creatorPubkey) {
      finishAddCreator(creatorPubkey);
      return;
    }

    if (input.includes("@") || input.includes(".")) {
      setCreatorResolving(true);
      try {
        const resp = await fetch(`/api/nip05/resolve?identifier=${encodeURIComponent(input)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.pubkey) {
            finishAddCreator(data.pubkey);
            return;
          }
        }
        toast({ title: "Not Found", description: "Could not resolve that NIP-05 identifier.", variant: "destructive" });
      } catch {
        toast({ title: "Error", description: "Failed to resolve NIP-05 identifier.", variant: "destructive" });
      } finally {
        setCreatorResolving(false);
      }
      return;
    }

    toast({ title: "Invalid Input", description: "Enter a valid npub, hex pubkey, or NIP-05 identifier.", variant: "destructive" });
  };

  const handleRemoveCreator = (creatorPubkey: string, displayName: string) => {
    unsubscribeCreator(pubkey, creatorPubkey);
    toast({ title: "Unsubscribed", description: `${displayName} removed from your stream subscriptions.` });
    refreshCreators();
  };

  const customFeeds = subscribedFeeds.filter((f) => !f.isCatalog);
  const catalogIds = useMemo(() => new Set(getAllCatalogFeeds().map((f) => f.id)), []);
  const orphanedFeeds = subscribedFeeds.filter((f) => f.isCatalog && !catalogIds.has(f.id));

  const subscribedCount = subscribedFeeds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-brand uppercase tracking-wider">
            <Rss className="w-4 h-4 text-rose-400" />
            Feed Subscriptions
            {subscribedCount > 0 && (
              <Badge variant="outline" className="text-[9px] bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20 ml-1">
                {subscribedCount} active
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
          {FEED_CATEGORIES.map((category) => {
            const isExpanded = expandedCategories.has(category.id);
            const subCount = category.feeds.filter((f) => subscribedIds.has(f.id)).length;

            const subcategories = new Map<string, FeedCatalogEntry[]>();
            for (const feed of category.feeds) {
              const sub = feed.subcategory || "General";
              const arr = subcategories.get(sub) || [];
              arr.push(feed);
              subcategories.set(sub, arr);
            }

            return (
              <div key={category.id}>
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors text-left"
                >
                  <span className="text-base">{category.emoji}</span>
                  <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">{category.name}</span>
                  {subCount > 0 && (
                    <Badge variant="outline" className="text-[8px] bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20">
                      {subCount}
                    </Badge>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                  )}
                </button>

                {isExpanded && (
                  <div className="ml-2 border-l border-gray-200 dark:border-white/10 pl-3 mb-2 space-y-0.5">
                    {[...subcategories.entries()].map(([subName, feeds]) => (
                      <div key={subName}>
                        {subcategories.size > 1 && (
                          <p className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium px-2 pt-2 pb-1">{subName}</p>
                        )}
                        {feeds.map((feed) => {
                          const isSubscribed = subscribedIds.has(feed.id);
                          return (
                            <button
                              key={feed.id}
                              onClick={() => handleToggleFeed(feed)}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left ${
                                isSubscribed
                                  ? "bg-rose-50 dark:bg-rose-500/10"
                                  : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                              }`}
                            >
                              <span className="text-sm">{feed.emoji}</span>
                              <span className={`flex-1 text-xs ${
                                isSubscribed ? "text-rose-700 dark:text-rose-300 font-medium" : "text-gray-700 dark:text-gray-300"
                              }`}>
                                {feed.name}
                              </span>
                              {isSubscribed ? (
                                <Check className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                              ) : (
                                <Plus className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {orphanedFeeds.length > 0 && (
            <div className="border-t border-gray-200 dark:border-white/10 pt-3 mt-3">
              <div className="flex items-center gap-2 px-1 mb-2">
                <span className="text-[10px] uppercase tracking-wider text-amber-500 dark:text-amber-400 font-medium">Inactive Feeds</span>
                <Badge variant="outline" className="text-[8px] bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20">
                  {orphanedFeeds.length}
                </Badge>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pb-2">
                These feeds are no longer available in the catalog. Remove them and subscribe to updated feeds.
              </p>
              <div className="space-y-1">
                {orphanedFeeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-50 dark:bg-amber-500/10 group"
                  >
                    <span className="text-sm">{feed.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-amber-700 dark:text-amber-300 font-medium truncate">{feed.name}</p>
                      <p className="text-[9px] text-gray-400 dark:text-gray-500 truncate font-mono">{feed.url}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-amber-800 dark:text-amber-500 hover:text-red-500 dark:hover:text-red-400"
                      onClick={() => {
                        unsubscribeFeed(pubkey, feed.id);
                        toast({ title: "Removed", description: `${feed.name} removed from your calendar.` });
                        refresh();
                      }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 dark:border-white/10 pt-3 mt-3">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">Custom Feeds</span>
              {!showCustomForm && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                  onClick={() => setShowCustomForm(true)}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              )}
            </div>

            {showCustomForm && (
              <div className="border border-rose-500/20 rounded-lg p-3 bg-rose-500/5 space-y-2 mb-2">
                <Input
                  placeholder="Feed name (e.g. My Team)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="h-8 text-sm"
                  autoFocus
                />
                <Input
                  placeholder="iCal URL (https://...)"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setShowCustomForm(false);
                      setCustomUrl("");
                      setCustomName("");
                    }}
                    disabled={validatingUrl}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-rose-600 hover:bg-rose-700"
                    onClick={handleAddCustom}
                    disabled={!customUrl.trim() || !customName.trim() || validatingUrl}
                  >
                    {validatingUrl ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      <>
                        <Check className="w-3 h-3 mr-1" />
                        Add Feed
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {customFeeds.length === 0 && !showCustomForm ? (
              <div className="px-1 pb-2 space-y-2">
                <p className="text-[10px] text-gray-400 dark:text-gray-500">
                  Add any public iCal/ICS feed URL to show events on your calendar.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {customFeeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-rose-50 dark:bg-rose-500/10 group"
                  >
                    <span className="text-sm">{feed.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-rose-700 dark:text-rose-300 font-medium truncate">{feed.name}</p>
                      <p className="text-[9px] text-gray-400 dark:text-gray-500 truncate font-mono">{feed.url}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 reveal-on-hover touch-target"
                      aria-label="Remove this calendar feed"
                      title="Remove feed"
                      onClick={() => handleRemoveCustom(feed)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 dark:border-white/10 pt-3 mt-3">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-brand" />
                Creator Streams
              </span>
              {subscribedCreators.length > 0 && (
                <Badge variant="outline" className="text-[8px] bg-brand dark:bg-brand/10 text-brand border-brand dark:border-brand/20">
                  {subscribedCreators.length}
                </Badge>
              )}
            </div>

            <div className="relative mb-2 px-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-gray-500 pointer-events-none" />
                  <Input
                    ref={creatorInputRef}
                    placeholder="Search by name or handle…"
                    value={creatorInput}
                    onChange={(e) => handleCreatorInputChange(e.target.value)}
                    className="h-7 text-xs pl-7 pr-2 flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddCreator(); }}
                    onFocus={() => creatorSearchResults.length > 0 && setShowCreatorDropdown(true)}
                    disabled={creatorResolving}
                    autoComplete="off"
                  />
                  {creatorSearching && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-3 h-3 animate-spin text-brand" />
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-brand hover:bg-brand px-3"
                  onClick={handleAddCreator}
                  disabled={!creatorInput.trim() || creatorResolving}
                >
                  {creatorResolving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
                  {creatorResolving ? "Resolving" : "Add"}
                </Button>
              </div>
              {showCreatorDropdown && creatorSearchResults.length > 0 && (
                <div
                  ref={creatorDropdownRef}
                  className="absolute z-50 top-full mt-1 left-1 right-1 rounded-lg overflow-hidden shadow-lg border border-gray-200 dark:border-white/10 max-h-[200px] overflow-y-auto bg-white dark:bg-gray-900"
                >
                  {creatorSearchResults.map((event: any) => {
                    let content: any = {};
                    try { content = JSON.parse(event.content); } catch {}
                    const name = content.display_name || content.name || "";
                    const nip05 = content.nip05 || "";
                    const picture = content.picture || "";
                    return (
                      <button
                        key={event.pubkey}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-brand/10 dark:hover:bg-brand/8 transition-colors"
                        onClick={() => finishAddCreator(event.pubkey)}
                      >
                        <Avatar className="w-7 h-7 shrink-0">
                          {picture ? <AvatarImage src={picture} alt={name} /> : null}
                          <AvatarFallback className="bg-brand/20 text-brand text-[10px]">
                            {name ? name[0].toUpperCase() : "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                            {name || `${event.pubkey.slice(0, 12)}...`}
                          </p>
                          {nip05 && (
                            <p className="text-[9px] text-gray-400 dark:text-gray-500 truncate">{nip05}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  <div className="px-3 py-1.5 text-[9px] text-gray-400 dark:text-gray-500 text-center uppercase tracking-wider">
                    {creatorSearching ? "Searching..." : "Select a creator"}
                  </div>
                </div>
              )}
            </div>

            {subscribedCreators.length === 0 ? (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 px-1 pb-2">
                Subscribe to creators to see their planned streams on your calendar.
              </p>
            ) : (
              <div className="space-y-1">
                {subscribedCreators.map((creator) => (
                  <CreatorRow
                    key={creator.pubkey}
                    creatorPubkey={creator.pubkey}
                    onRemove={handleRemoveCreator}
                  />
                ))}
              </div>
            )}
          </div>

          {subscribedFeeds.length > 0 && (
            <div className="border-t border-gray-200 dark:border-white/10 pt-3 mt-3">
              <div className="flex items-center gap-2 px-1 mb-2">
                <Bell className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">Event Reminders</span>
              </div>

              <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.03] mb-2">
                <span className="text-[11px] text-gray-600 dark:text-gray-300 flex-shrink-0">Notify me</span>
                <div className="flex items-center gap-1 flex-1 justify-end">
                  {FEED_REMINDER_OPTIONS.map((opt) => {
                    const active = feedReminders.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => toggleFeedReminder(opt.value)}
                        className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors touch-manipulation ${
                          active
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-500 dark:text-rose-400"
                            : "border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {feedReminders.length > 0 && (
                <>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 px-2 mb-2">
                    Select which feeds send you DM reminders before events
                  </p>
                  <div className="space-y-0.5">
                    {subscribedFeeds.map((feed) => {
                      const enabled = reminderEnabledFeeds.has(feed.id);
                      return (
                        <button
                          key={feed.id}
                          onClick={() => handleToggleFeedReminder(feed.id)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left ${
                            enabled
                              ? "bg-rose-50 dark:bg-rose-500/10"
                              : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                          }`}
                        >
                          <span className="text-sm">{feed.emoji}</span>
                          <span className={`flex-1 text-xs ${
                            enabled ? "text-rose-700 dark:text-rose-300 font-medium" : "text-gray-700 dark:text-gray-300"
                          }`}>
                            {feed.name}
                          </span>
                          {enabled ? (
                            <Bell className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                          ) : (
                            <Bell className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {feedReminders.length === 0 && (
                <p className="text-[9px] text-gray-400 dark:text-gray-500 px-2">
                  Select a time above to enable DM reminders before feed events
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
