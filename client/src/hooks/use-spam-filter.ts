import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import {
  fetchSpamList,
  filterSpamEvents,
  mutePubkey,
  unmutePubkey,
  isMutedPubkey,
  getMutedPubkeys,
  addMutedKeyword,
  removeMutedKeyword,
  getMutedKeywords,
  onMuteChange,
  onSpamListChange,
  getSpamStats,
  addReportedItem,
  removeReportedItem,
  getReportedItems,
  isReportedEvent,
  isReportedPubkey,
  type SpamFilterOptions,
  type ReportedItem,
} from "@/lib/spam-filter";
import type { Event } from "nostr-tools";

export function useSpamFilter() {
  const [version, setVersion] = useState(0);

  const pageVisible = usePageVisibility();
  const spamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pageVisible) {
      fetchSpamList();
      spamIntervalRef.current = setInterval(() => fetchSpamList(), 5 * 60 * 1000);
    } else {
      if (spamIntervalRef.current) {
        clearInterval(spamIntervalRef.current);
        spamIntervalRef.current = null;
      }
    }
    return () => {
      if (spamIntervalRef.current) {
        clearInterval(spamIntervalRef.current);
        spamIntervalRef.current = null;
      }
    };
  }, [pageVisible]);

  useEffect(() => {
    const unsubMute = onMuteChange(() => setVersion((v) => v + 1));
    const unsubSpam = onSpamListChange(() => setVersion((v) => v + 1));
    return () => { unsubMute(); unsubSpam(); };
  }, []);

  const mute = useCallback((pubkey: string) => mutePubkey(pubkey), []);
  const unmute = useCallback((pubkey: string) => unmutePubkey(pubkey), []);
  const isMuted = useCallback((pubkey: string) => isMutedPubkey(pubkey), [version]);
  const mutedPubkeys = useMemo(() => getMutedPubkeys(), [version]);
  const mutedKeywords = useMemo(() => getMutedKeywords(), [version]);
  const addKeyword = useCallback((kw: string) => addMutedKeyword(kw), []);
  const removeKeyword = useCallback((kw: string) => removeMutedKeyword(kw), []);
  const reportedItems = useMemo(() => getReportedItems(), [version]);

  const filter = useCallback(
    (events: Event[], options?: SpamFilterOptions) => filterSpamEvents(events, options),
    [version]
  );

  const stats = useMemo(() => getSpamStats(), [version]);

  return {
    filter,
    mute,
    unmute,
    isMuted,
    mutedPubkeys,
    mutedKeywords,
    addKeyword,
    removeKeyword,
    reportedItems,
    addReport: addReportedItem,
    removeReport: removeReportedItem,
    isReported: isReportedEvent,
    isReportedAuthor: isReportedPubkey,
    stats,
  };
}
