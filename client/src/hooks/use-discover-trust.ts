import { useCallback, useEffect, useMemo, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { admitToDiscover, loadDiscoverTrust } from "@/lib/discover-trust";

/**
 * Discover's trust gate for tiles fed by React state rather than a fetcher
 * (Live hosts, people suggestions): which of these people Discover may show
 * (score 0.50+ or followed; lib/discover-trust.ts).
 *
 * `checked` is false until the answer is in, so a tile can hold rather than
 * flash unvetted faces; `reached: false` means the trusted list couldn't be
 * read, and `admit` then lets only people you follow through.
 */
export function useDiscoverTrust(pubkeys: readonly string[], enabled = true) {
  const { pubkey, follows } = useNostrAuth();
  const { wotEnabled, scores } = useGrapeRankScores();
  const followSet = useMemo(() => new Set(follows ?? []), [follows]);
  const key = useMemo(() => [...new Set(pubkeys)].sort().join(","), [pubkeys]);
  const [state, setState] = useState<{ reached: boolean | null; scores: Map<string, number> }>({ reached: null, scores: new Map() });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadDiscoverTrust(key ? key.split(",") : [], { follows: followSet, wotEnabled: !!pubkey && wotEnabled, ownScores: scores ?? null })
      .then((t) => { if (live) setState({ reached: t.reached, scores: t.scores }); })
      .catch(() => { if (live) setState({ reached: false, scores: new Map() }); });
    return () => { live = false; };
  }, [enabled, key, followSet, pubkey, wotEnabled, scores]);

  const admit = useCallback(
    (pk: string) => admitToDiscover(pk, { follows: followSet, scores: state.scores }),
    [followSet, state.scores],
  );
  return { checked: state.reached !== null, reached: state.reached === true, admit };
}
