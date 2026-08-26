import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { pool, DEFAULT_RELAYS, publishEvent, eventStore, throttledPoolSubscribe, verifySignedEventKind } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout } from "@/lib/signer-timeout";

const KIND_BOOKMARK_LIST = 10003;

interface BookmarkEntry {
  type: "e" | "a";
  id: string;
  relay?: string;
  private: boolean;
}

let globalBookmarks: BookmarkEntry[] = [];
let globalRawEvent: any = null;
let globalLoading = true;
let globalListeners = new Set<() => void>();
let fetchedForPubkey: string | null = null;
let fetchFailed = false;

function notifyListeners() {
  globalListeners.forEach((fn) => fn());
}

function parseBookmarkTags(tags: string[][], isPrivate: boolean): BookmarkEntry[] {
  const entries: BookmarkEntry[] = [];
  for (const tag of tags) {
    if (tag[0] === "e" && tag[1]) {
      entries.push({ type: "e", id: tag[1], relay: tag[2], private: isPrivate });
    } else if (tag[0] === "a" && tag[1]) {
      entries.push({ type: "a", id: tag[1], relay: tag[2], private: isPrivate });
    }
  }
  return entries;
}

async function decryptBookmarkContent(content: string, pubkey: string, signer: any): Promise<BookmarkEntry[]> {
  if (!content || !content.trim()) return [];
  try {
    let decrypted: string | null = null;
    if (signer?.nip04?.decrypt) {
      decrypted = await signer.nip04.decrypt(pubkey, content);
    } else if (window.nostr?.nip04?.decrypt) {
      decrypted = await window.nostr.nip04.decrypt(pubkey, content);
    }
    if (!decrypted) return [];
    const parsed = JSON.parse(decrypted);
    if (Array.isArray(parsed)) {
      return parseBookmarkTags(parsed, true);
    }
  } catch (err) {
    console.warn("Failed to decrypt bookmark content:", err);
  }
  return [];
}

async function encryptBookmarkTags(tags: string[][], pubkey: string, signer: any): Promise<string> {
  const payload = JSON.stringify(tags);
  if (signer?.nip04?.encrypt) {
    return await signer.nip04.encrypt(pubkey, payload);
  } else if (window.nostr?.nip04?.encrypt) {
    return await window.nostr.nip04.encrypt(pubkey, payload);
  }
  throw new Error("No NIP-04 encryption available");
}

function dedupeEntries(entries: BookmarkEntry[]): BookmarkEntry[] {
  const seen = new Set<string>();
  const out: BookmarkEntry[] = [];
  for (const e of entries) {
    const key = `${e.type}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

async function fetchBookmarksFromRelays(pubkey: string, signer: any): Promise<void> {
  globalLoading = true;
  notifyListeners();

  let best: any = null;
  let resolved = false;

  const resolve = async (timedOut: boolean) => {
    if (resolved) return;
    resolved = true;

    if (best) {
      const publicEntries = parseBookmarkTags(best.tags, false);
      let privateEntries: BookmarkEntry[] = [];
      if (best.content && best.content.trim()) {
        privateEntries = await decryptBookmarkContent(best.content, pubkey, signer);
      }
      // Dedupe favoring private (since list shows newest first via UI)
      globalBookmarks = dedupeEntries([...privateEntries, ...publicEntries]);
      globalRawEvent = best;
      fetchFailed = false;
    } else {
      globalBookmarks = [];
      globalRawEvent = null;
      fetchFailed = timedOut;
    }
    globalLoading = false;
    notifyListeners();
  };

  try {
    const sub = throttledPoolSubscribe(DEFAULT_RELAYS, { kinds: [KIND_BOOKMARK_LIST], authors: [pubkey] }, {
      onevent(event: any) {
        if (!best || event.created_at > best.created_at) {
          best = event;
        }
      },
      oneose() {
        sub.close();
        resolve(false);
      },
    });

    setTimeout(() => {
      if (!resolved) {
        try { sub.close(); } catch {}
        resolve(!best);
      }
    }, 8000);
  } catch (err) {
    console.error("Failed to fetch bookmarks:", err);
    fetchFailed = true;
    globalLoading = false;
    notifyListeners();
  }
}

export function useNostrBookmarks() {
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
    if (!pubkey || !signer) {
      globalBookmarks = [];
      globalRawEvent = null;
      globalLoading = false;
      fetchedForPubkey = null;
      fetchFailed = false;
      notifyListeners();
      return;
    }

    if (fetchedForPubkey === pubkey && !fetchFailed) return;
    fetchedForPubkey = pubkey;

    fetchBookmarksFromRelays(pubkey, signer);
  }, [pubkey, signer]);

  const bookmarkedIds = useMemo(() => {
    return new Set(globalBookmarks.map((b) => b.id));
  }, [globalBookmarks]);

  const privacyById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const b of globalBookmarks) m.set(b.id, b.private);
    return m;
  }, [globalBookmarks]);

  const isBookmarked = useCallback((eventId: string) => {
    return bookmarkedIds.has(eventId);
  }, [bookmarkedIds]);

  const isPrivateBookmark = useCallback((eventId: string) => {
    return privacyById.get(eventId) ?? true;
  }, [privacyById]);

  const publishBookmarkList = useCallback(async (entries: BookmarkEntry[]) => {
    if (!pubkey || !signer) throw new Error("Not logged in");
    // Wipe guard: never republish the bookmark list from a base we haven't
    // actually loaded yet (still fetching, or the fetch failed) — that would
    // overwrite the user's existing bookmarks with a partial/empty list.
    if (globalLoading || fetchFailed) {
      throw new Error("Your bookmarks haven't finished loading — try again in a moment.");
    }

    const deduped = dedupeEntries(entries);
    const publicEntries = deduped.filter((e) => !e.private);
    const privateEntries = deduped.filter((e) => e.private);

    const publicTags = publicEntries.map((e) => {
      const tag = [e.type, e.id];
      if (e.relay) tag.push(e.relay);
      return tag;
    });

    const privateTags = privateEntries.map((e) => {
      const tag = [e.type, e.id];
      if (e.relay) tag.push(e.relay);
      return tag;
    });

    let encryptedContent = "";
    if (privateTags.length > 0) {
      try {
        encryptedContent = await encryptBookmarkTags(privateTags, pubkey, signer);
      } catch {
        throw new Error("Failed to encrypt bookmarks");
      }
    }

    const eventTemplate = {
      kind: KIND_BOOKMARK_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: publicTags,
      content: encryptedContent,
    };

    const signedEvent = await signWithTimeout(signer, eventTemplate);
    if (!verifySignedEventKind(signedEvent, KIND_BOOKMARK_LIST)) {
      throw new Error("Signer returned wrong event kind for bookmark list");
    }
    await publishEvent(signedEvent);

    globalRawEvent = signedEvent;
    globalBookmarks = deduped;
    notifyListeners();
  }, [pubkey, signer]);

  const addBookmark = useCallback(async (eventId: string, type: "e" | "a" = "e", isPrivate: boolean = true) => {
    if (!pubkey || !signer) {
      toast({ title: "Sign in required", description: "Log in to bookmark notes.", variant: "destructive" });
      return;
    }
    if (bookmarkedIds.has(eventId)) return;

    const prevBookmarks = globalBookmarks;
    const newEntries = [...globalBookmarks, { type, id: eventId, private: isPrivate }];
    // Optimistic: flip the bookmark icon now (publishBookmarkList reconciles to
    // the deduped list on success); revert if the relay round-trip fails.
    globalBookmarks = newEntries;
    notifyListeners();
    try {
      await publishBookmarkList(newEntries);
      toast({
        title: isPrivate ? "Saved privately" : "Saved publicly",
        description: isPrivate
          ? "Only you can see this bookmark."
          : "Anyone can see this bookmark on your profile.",
      });
    } catch (err) {
      console.error("Failed to add bookmark:", err);
      globalBookmarks = prevBookmarks;
      notifyListeners();
      toast({ title: "Error", description: "Failed to save bookmark.", variant: "destructive" });
    }
  }, [pubkey, signer, bookmarkedIds, publishBookmarkList, toast]);

  const removeBookmark = useCallback(async (eventId: string) => {
    if (!pubkey || !signer) return;

    const prevBookmarks = globalBookmarks;
    const newEntries = globalBookmarks.filter((b) => b.id !== eventId);
    // Optimistic: clear the icon now; revert if the relay round-trip fails.
    globalBookmarks = newEntries;
    notifyListeners();
    try {
      await publishBookmarkList(newEntries);
    } catch (err) {
      console.error("Failed to remove bookmark:", err);
      globalBookmarks = prevBookmarks;
      notifyListeners();
      toast({ title: "Error", description: "Failed to remove bookmark.", variant: "destructive" });
    }
  }, [pubkey, signer, publishBookmarkList, toast]);

  const toggleBookmark = useCallback(async (eventId: string, type: "e" | "a" = "e", isPrivate: boolean = true) => {
    if (bookmarkedIds.has(eventId)) {
      await removeBookmark(eventId);
    } else {
      await addBookmark(eventId, type, isPrivate);
    }
  }, [bookmarkedIds, addBookmark, removeBookmark]);

  const setBookmarkPrivacy = useCallback(async (eventId: string, isPrivate: boolean) => {
    if (!pubkey || !signer) return;
    const target = globalBookmarks.find((b) => b.id === eventId);
    if (!target || target.private === isPrivate) return;

    const newEntries = globalBookmarks.map((b) =>
      b.id === eventId ? { ...b, private: isPrivate } : b
    );
    try {
      await publishBookmarkList(newEntries);
      toast({
        title: isPrivate ? "Now private" : "Now public",
        description: isPrivate
          ? "This bookmark is hidden from others."
          : "This bookmark is now visible on your profile.",
      });
    } catch (err) {
      console.error("Failed to update bookmark privacy:", err);
      toast({ title: "Error", description: "Failed to update bookmark.", variant: "destructive" });
    }
  }, [pubkey, signer, publishBookmarkList, toast]);

  return {
    bookmarks: globalBookmarks,
    isLoading: globalLoading,
    isBookmarked,
    isPrivateBookmark,
    addBookmark,
    removeBookmark,
    toggleBookmark,
    setBookmarkPrivacy,
    bookmarkedIds,
  };
}
