import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { publishEvent, DEFAULT_RELAYS, throttledPoolSubscribe, verifySignedEventKind } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout } from "@/lib/signer-timeout";
import {
  mutePubkey as localMutePubkey,
  unmutePubkey as localUnmutePubkey,
  getMutedPubkeys,
  addMutedKeyword as localAddKeyword,
  removeMutedKeyword as localRemoveKeyword,
  getMutedKeywords,
  onMuteChange,
  isMutedPubkey,
} from "@/lib/spam-filter";

const KIND_MUTE_LIST = 10000;

let globalMutedPubkeys: string[] = [];
let globalMutedKeywords: string[] = [];
let globalRawEvent: any = null;
let globalLoading = true;
let globalListeners = new Set<() => void>();
let fetchedForPubkey: string | null = null;
let fetchFailed = false;

function notifyListeners() {
  globalListeners.forEach((fn) => fn());
}

function parseMuteListTags(tags: string[][]): { pubkeys: string[]; keywords: string[] } {
  const pubkeys: string[] = [];
  const keywords: string[] = [];
  for (const tag of tags) {
    if (tag[0] === "p" && tag[1]) {
      pubkeys.push(tag[1]);
    } else if (tag[0] === "t" && tag[1]) {
      keywords.push(tag[1].toLowerCase());
    } else if (tag[0] === "word" && tag[1]) {
      keywords.push(tag[1].toLowerCase());
    }
  }
  return { pubkeys, keywords };
}

async function fetchMuteListFromRelays(pubkey: string): Promise<void> {
  globalLoading = true;
  notifyListeners();

  let best: any = null;
  let resolved = false;

  const resolve = (timedOut: boolean) => {
    if (resolved) return;
    resolved = true;

    if (best) {
      const { pubkeys, keywords } = parseMuteListTags(best.tags);

      const localPks = getMutedPubkeys();
      const localKws = getMutedKeywords();
      const mergedPks = new Set([...pubkeys, ...localPks]);
      const mergedKws = new Set([...keywords, ...localKws]);

      mergedPks.forEach((pk) => localMutePubkey(pk));
      mergedKws.forEach((kw) => localAddKeyword(kw));

      globalMutedPubkeys = Array.from(mergedPks);
      globalMutedKeywords = Array.from(mergedKws);
      globalRawEvent = best;
      fetchFailed = false;
    } else {
      globalMutedPubkeys = getMutedPubkeys();
      globalMutedKeywords = getMutedKeywords();
      globalRawEvent = null;
      fetchFailed = timedOut;
    }
    globalLoading = false;
    notifyListeners();
  };

  try {
    const sub = throttledPoolSubscribe(DEFAULT_RELAYS, { kinds: [KIND_MUTE_LIST], authors: [pubkey] }, {
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
    console.error("Failed to fetch mute list:", err);
    fetchFailed = true;
    globalLoading = false;
    notifyListeners();
  }
}

export function useNostrMuteList() {
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

  const publishDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onMuteChange(() => {
      const prevPks = globalMutedPubkeys;
      const prevKws = globalMutedKeywords;
      globalMutedPubkeys = getMutedPubkeys();
      globalMutedKeywords = getMutedKeywords();
      notifyListeners();

      const changed = prevPks.length !== globalMutedPubkeys.length ||
        prevKws.length !== globalMutedKeywords.length ||
        prevPks.some((pk) => !globalMutedPubkeys.includes(pk)) ||
        prevKws.some((kw) => !globalMutedKeywords.includes(kw));

      if (changed && pubkey && signer && !globalLoading) {
        if (publishDebounceRef.current) clearTimeout(publishDebounceRef.current);
        publishDebounceRef.current = setTimeout(async () => {
          const pks = getMutedPubkeys();
          const kws = getMutedKeywords();
          const tags: string[][] = [
            ...pks.map((pk: string) => ["p", pk]),
            ...kws.map((kw: string) => ["word", kw]),
          ];
          try {
            const eventTemplate = {
              kind: KIND_MUTE_LIST,
              created_at: Math.floor(Date.now() / 1000),
              tags,
              content: "",
            };
            const signedEvent = await signWithTimeout(signer, eventTemplate);
            if (!verifySignedEventKind(signedEvent, KIND_MUTE_LIST)) return;
            await publishEvent(signedEvent);
            globalRawEvent = signedEvent;
          } catch (err) {
            console.warn("Failed to auto-publish mute list:", err);
          }
        }, 1500);
      }
    });
    return () => {
      unsub();
      if (publishDebounceRef.current) clearTimeout(publishDebounceRef.current);
    };
  }, [pubkey, signer]);

  useEffect(() => {
    if (!pubkey) {
      globalRawEvent = null;
      globalLoading = false;
      fetchedForPubkey = null;
      fetchFailed = false;
      globalMutedPubkeys = getMutedPubkeys();
      globalMutedKeywords = getMutedKeywords();
      notifyListeners();
      return;
    }

    if (fetchedForPubkey === pubkey && !fetchFailed) return;
    fetchedForPubkey = pubkey;

    fetchMuteListFromRelays(pubkey);
  }, [pubkey]);

  const publishMuteList = useCallback(async (pks: string[], kws: string[]) => {
    if (!pubkey || !signer) throw new Error("Not logged in");

    const tags: string[][] = [
      ...pks.map((pk) => ["p", pk]),
      ...kws.map((kw) => ["word", kw]),
    ];

    const eventTemplate = {
      kind: KIND_MUTE_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    };

    const signedEvent = await signWithTimeout(signer, eventTemplate);
    if (!verifySignedEventKind(signedEvent, KIND_MUTE_LIST)) {
      throw new Error("Signer returned wrong event kind for mute list");
    }
    await publishEvent(signedEvent);

    globalRawEvent = signedEvent;
    globalMutedPubkeys = pks;
    globalMutedKeywords = kws;
    notifyListeners();
  }, [pubkey, signer]);

  const mutePubkeySync = useCallback(async (targetPubkey: string) => {
    localMutePubkey(targetPubkey);

    if (pubkey && signer) {
      const currentPks = Array.from(new Set([...globalMutedPubkeys, targetPubkey]));
      const currentKws = [...globalMutedKeywords];
      try {
        await publishMuteList(currentPks, currentKws);
      } catch (err) {
        console.warn("Failed to publish mute list to relays:", err);
      }
    }
  }, [pubkey, signer, publishMuteList]);

  const unmutePubkeySync = useCallback(async (targetPubkey: string) => {
    localUnmutePubkey(targetPubkey);

    if (pubkey && signer) {
      const currentPks = globalMutedPubkeys.filter((pk) => pk !== targetPubkey);
      const currentKws = [...globalMutedKeywords];
      try {
        await publishMuteList(currentPks, currentKws);
      } catch (err) {
        console.warn("Failed to publish mute list to relays:", err);
      }
    }
  }, [pubkey, signer, publishMuteList]);

  const addKeywordSync = useCallback(async (keyword: string) => {
    const kw = keyword.toLowerCase().trim();
    localAddKeyword(kw);

    if (pubkey && signer) {
      const currentPks = [...globalMutedPubkeys];
      const currentKws = Array.from(new Set([...globalMutedKeywords, kw]));
      try {
        await publishMuteList(currentPks, currentKws);
      } catch (err) {
        console.warn("Failed to publish mute list to relays:", err);
      }
    }
  }, [pubkey, signer, publishMuteList]);

  const removeKeywordSync = useCallback(async (keyword: string) => {
    const kw = keyword.toLowerCase().trim();
    localRemoveKeyword(kw);

    if (pubkey && signer) {
      const currentPks = [...globalMutedPubkeys];
      const currentKws = globalMutedKeywords.filter((k) => k !== kw);
      try {
        await publishMuteList(currentPks, currentKws);
      } catch (err) {
        console.warn("Failed to publish mute list to relays:", err);
      }
    }
  }, [pubkey, signer, publishMuteList]);

  return {
    mutedPubkeys: globalMutedPubkeys,
    mutedKeywords: globalMutedKeywords,
    isLoading: globalLoading,
    isMuted: isMutedPubkey,
    mutePubkey: mutePubkeySync,
    unmutePubkey: unmutePubkeySync,
    addKeyword: addKeywordSync,
    removeKeyword: removeKeywordSync,
  };
}
