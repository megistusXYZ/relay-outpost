/**
 * The Nostr signal behind the news boost (NEWS_TRENDING_PLAN.md, decision 8):
 * "which news links is my network sharing right now." Fetches recent kind-1
 * notes from a bounded sample of the viewer's follows and folds them into a
 * share map (lib/news-network-boost.ts), weighted by GrapeRank influence when
 * the graph is ready. The map is what NewsTrending re-ranks the story list
 * against — CLIENT-side, so the base trending payload stays cached and
 * universal.
 *
 * Bounded on purpose: a landing surface must not open a broad subscription.
 * One `querySync` over ≤150 follows, notes from the last couple days, capped.
 */
import { useEffect, useRef, useState } from "react";
import { pool, getRelaysForPurpose } from "@/lib/nostr";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { buildNetworkShareMap, type NetworkShareMap, type NoteLike } from "@/lib/news-network-boost";

/** How far back "what my network is sharing" reaches. */
const SINCE_MS = 48 * 60 * 60 * 1000;
/** Follows sampled per pass — enough signal, bounded cost. */
const MAX_FOLLOWS = 150;
const NOTE_LIMIT = 500;
const QUERY_TIMEOUT_MS = 6000;

export function useNewsNetworkShares(enabled: boolean): NetworkShareMap {
  const { pubkey, follows } = useNostrAuth();
  const { scores } = useGrapeRankScores();
  const [map, setMap] = useState<NetworkShareMap>(new Map());
  // Re-fetch only when the follow SET changes (not on every scores tick — the
  // weight is applied at fold time, and a rebuild on score arrival is handled
  // by the scoresReady bump below without a network round-trip).
  const followsKey = (follows ?? []).length;
  const scoresRef = useRef(scores);
  scoresRef.current = scores;
  const notesRef = useRef<NoteLike[]>([]);

  useEffect(() => {
    if (!enabled || !pubkey || !follows || follows.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    const authors = follows.slice(0, MAX_FOLLOWS);
    const relays = getRelaysForPurpose("notes");
    const since = Math.floor((Date.now() - SINCE_MS) / 1000);

    (async () => {
      try {
        const events = await Promise.race([
          pool.querySync(relays, { kinds: [1], authors, since, limit: NOTE_LIMIT }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), QUERY_TIMEOUT_MS)),
        ]).catch(() => [] as Array<{ pubkey: string; content: string }>);
        if (cancelled) return;
        const notes: NoteLike[] = events.map((e) => ({ pubkey: e.pubkey, content: e.content || "" }));
        notesRef.current = notes;
        setMap(buildNetworkShareMap(notes, {
          viewer: pubkey,
          weightOf: (pk) => scoresRef.current?.get(pk) ?? 1,
        }));
      } catch { /* the boost is additive — no shares just means no lift */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pubkey, followsKey]);

  // Re-fold (no re-fetch) once GrapeRank scores arrive, so weights apply.
  const scoresReady = !!scores;
  useEffect(() => {
    if (!scoresReady || notesRef.current.length === 0) return;
    setMap(buildNetworkShareMap(notesRef.current, {
      viewer: pubkey,
      weightOf: (pk) => scoresRef.current?.get(pk) ?? 1,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoresReady, pubkey]);

  return map;
}
