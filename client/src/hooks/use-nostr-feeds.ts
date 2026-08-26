import { useState, useEffect, useCallback, useRef } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { pool, DEFAULT_RELAYS, publishEvent, throttledPoolSubscribe } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout } from "@/lib/signer-timeout";
import { isValidFeedIconKey } from "@/components/FeedIcons";

const KIND_CUSTOM_FEED_LIST = 30078;
const CACHE_KEY_PREFIX = "relay-outpost-feeds-";
const ORDER_KEY_PREFIX = "relay-outpost-feed-order-";

export interface NostrCustomFeed {
  id: string;
  name: string;
  hashtags: string[];
  authorPubkeys: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  contentType: string;
  source: "pack" | "custom";
  icon?: string;
  createdAt: number;
}

interface FeedEventContent {
  name: string;
  hashtags: string[];
  authorPubkeys: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  contentType: string;
  source?: "pack" | "custom";
  icon?: string;
}

let globalFeeds: NostrCustomFeed[] = [];
let globalLoading = true;
let globalListeners = new Set<() => void>();
let fetchedForPubkey: string | null = null;

function notifyListeners() {
  globalListeners.forEach((fn) => fn());
}

function getCacheKey(pubkey: string) {
  return `${CACHE_KEY_PREFIX}${pubkey}`;
}

function loadCachedFeeds(pubkey: string): NostrCustomFeed[] {
  try {
    const raw = localStorage.getItem(getCacheKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

function saveFeedsToCache(pubkey: string, feeds: NostrCustomFeed[]) {
  try {
    localStorage.setItem(getCacheKey(pubkey), JSON.stringify(feeds));
  } catch {}
}

function loadFeedOrder(pubkey: string): string[] {
  try {
    const raw = localStorage.getItem(`${ORDER_KEY_PREFIX}${pubkey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

function saveFeedOrder(pubkey: string, order: string[]) {
  try {
    localStorage.setItem(`${ORDER_KEY_PREFIX}${pubkey}`, JSON.stringify(order));
  } catch {}
}

function applyFeedOrder(feeds: NostrCustomFeed[], pubkey: string): NostrCustomFeed[] {
  const order = loadFeedOrder(pubkey);
  if (order.length === 0) return feeds;
  const feedMap = new Map(feeds.map(f => [f.id, f]));
  const ordered: NostrCustomFeed[] = [];
  for (const id of order) {
    const feed = feedMap.get(id);
    if (feed) {
      ordered.push(feed);
      feedMap.delete(id);
    }
  }
  for (const feed of feedMap.values()) {
    ordered.push(feed);
  }
  return ordered;
}

function parseFeedEvent(event: any): NostrCustomFeed | null {
  const dTag = event.tags?.find((t: string[]) => t[0] === "d")?.[1];
  if (!dTag) return null;

  try {
    const content: FeedEventContent = JSON.parse(event.content);
    return {
      id: dTag,
      name: content.name || dTag,
      hashtags: content.hashtags || [],
      authorPubkeys: content.authorPubkeys || [],
      includeKeywords: content.includeKeywords || [],
      excludeKeywords: content.excludeKeywords || [],
      contentType: content.contentType || "all",
      source: content.source || (
        (content.authorPubkeys?.length > 0 && (!content.hashtags || content.hashtags.length === 0) && (!content.includeKeywords || content.includeKeywords.length === 0))
          ? "pack"
          : "custom"
      ),
      icon: isValidFeedIconKey(content.icon) ? content.icon : undefined,
      createdAt: event.created_at,
    };
  } catch {
    return null;
  }
}

function fetchFeedsFromRelays(pubkey: string): Promise<NostrCustomFeed[]> {
  return new Promise((resolve) => {
    const feedMap = new Map<string, any>();
    const timeout = setTimeout(() => {
      sub?.close();
      finalize();
    }, 8000);

    let resolved = false;
    function finalize() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      const feeds: NostrCustomFeed[] = [];
      for (const event of Array.from(feedMap.values())) {
        const feed = parseFeedEvent(event);
        if (feed) feeds.push(feed);
      }
      feeds.sort((a, b) => b.createdAt - a.createdAt);
      resolve(feeds);
    }

    const sub = throttledPoolSubscribe(DEFAULT_RELAYS, { kinds: [KIND_CUSTOM_FEED_LIST], authors: [pubkey] }, {
      onevent(event: any) {
        const dTag = event.tags?.find((t: string[]) => t[0] === "d")?.[1];
        if (!dTag || !dTag.startsWith("feed:")) return;
        const existing = feedMap.get(dTag);
        if (!existing || event.created_at > existing.created_at) {
          feedMap.set(dTag, event);
        }
      },
      oneose() {
        sub?.close();
        finalize();
      },
    });
  });
}

export function useNostrFeeds() {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [, forceUpdate] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const listener = () => {
      if (mountedRef.current) forceUpdate((v) => v + 1);
    };
    globalListeners.add(listener);
    return () => {
      mountedRef.current = false;
      globalListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!pubkey) {
      globalFeeds = [];
      globalLoading = false;
      fetchedForPubkey = null;
      notifyListeners();
      return;
    }

    if (fetchedForPubkey === pubkey) return;
    fetchedForPubkey = pubkey;

    const cached = loadCachedFeeds(pubkey);
    if (cached.length > 0) {
      globalFeeds = applyFeedOrder(cached, pubkey);
      globalLoading = false;
      notifyListeners();
    } else {
      globalLoading = true;
      notifyListeners();
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;

      let feeds = await fetchFeedsFromRelays(pubkey);

      if (feeds.length === 0 && !cancelled) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) return;
        feeds = await fetchFeedsFromRelays(pubkey);
      }

      if (cancelled) return;

      if (feeds.length > 0 || cached.length === 0) {
        globalFeeds = applyFeedOrder(feeds, pubkey);
        saveFeedsToCache(pubkey, feeds);
      }
      globalLoading = false;
      notifyListeners();
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pubkey]);

  const createFeed = useCallback(async (feed: Omit<NostrCustomFeed, "id" | "createdAt">) => {
    if (!pubkey || !signer) {
      toast({ title: "Sign in required", description: "Log in to save feeds.", variant: "destructive" });
      return null;
    }

    const id = `feed:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const content: FeedEventContent = {
      name: feed.name,
      hashtags: feed.hashtags,
      authorPubkeys: feed.authorPubkeys,
      includeKeywords: feed.includeKeywords,
      excludeKeywords: feed.excludeKeywords,
      contentType: feed.contentType,
      source: feed.source,
      icon: feed.icon,
    };

    const eventTemplate = {
      kind: KIND_CUSTOM_FEED_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", id]],
      content: JSON.stringify(content),
    };

    try {
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      await publishEvent(signedEvent);

      const newFeed: NostrCustomFeed = {
        id,
        ...feed,
        createdAt: eventTemplate.created_at,
      };
      globalFeeds = [newFeed, ...globalFeeds];
      saveFeedsToCache(pubkey, globalFeeds);
      saveFeedOrder(pubkey, globalFeeds.map(f => f.id));
      notifyListeners();
      return newFeed;
    } catch (err) {
      console.error("Failed to create feed:", err);
      toast({ title: "Error", description: "Failed to save feed.", variant: "destructive" });
      return null;
    }
  }, [pubkey, signer, toast]);

  const updateFeed = useCallback(async (id: string, updates: Partial<Omit<NostrCustomFeed, "id" | "createdAt">>) => {
    if (!pubkey || !signer) return null;

    const existing = globalFeeds.find((f) => f.id === id);
    if (!existing) return null;

    const merged = { ...existing, ...updates };

    const content: FeedEventContent = {
      name: merged.name,
      hashtags: merged.hashtags,
      authorPubkeys: merged.authorPubkeys,
      includeKeywords: merged.includeKeywords,
      excludeKeywords: merged.excludeKeywords,
      contentType: merged.contentType,
      source: merged.source,
      icon: merged.icon,
    };

    const eventTemplate = {
      kind: KIND_CUSTOM_FEED_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", id]],
      content: JSON.stringify(content),
    };

    try {
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      await publishEvent(signedEvent);

      globalFeeds = globalFeeds.map((f) =>
        f.id === id ? { ...f, ...updates, createdAt: eventTemplate.created_at } : f
      );
      saveFeedsToCache(pubkey, globalFeeds);
      notifyListeners();
      return merged;
    } catch (err) {
      console.error("Failed to update feed:", err);
      toast({ title: "Error", description: "Failed to update feed.", variant: "destructive" });
      return null;
    }
  }, [pubkey, signer, toast]);

  const deleteFeed = useCallback(async (id: string) => {
    if (!pubkey || !signer) return;

    const eventTemplate = {
      kind: KIND_CUSTOM_FEED_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", id]],
      content: "",
    };

    try {
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      await publishEvent(signedEvent);

      globalFeeds = globalFeeds.filter((f) => f.id !== id);
      saveFeedsToCache(pubkey, globalFeeds);
      saveFeedOrder(pubkey, globalFeeds.map(f => f.id));
      notifyListeners();
    } catch (err) {
      console.error("Failed to delete feed:", err);
      toast({ title: "Error", description: "Failed to delete feed.", variant: "destructive" });
    }
  }, [pubkey, signer, toast]);

  const reorderFeeds = useCallback((fromIndex: number, toIndex: number) => {
    if (!pubkey) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= globalFeeds.length || toIndex >= globalFeeds.length) return;
    const reordered = [...globalFeeds];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    globalFeeds = reordered;
    saveFeedOrder(pubkey, reordered.map(f => f.id));
    notifyListeners();
  }, [pubkey]);

  return {
    feeds: globalFeeds,
    isLoading: globalLoading,
    createFeed,
    updateFeed,
    deleteFeed,
    reorderFeeds,
  };
}
