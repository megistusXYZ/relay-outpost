import { useEffect, useRef, useState } from "react";
import type { Event } from "nostr-tools";
import { searchCachedProfiles } from "@/lib/nostr";
import { searchUsers as searchUsersNip50 } from "@/lib/primal-cache";

/**
 * Live people typeahead: instant local-cache matches, then ONE debounced
 * remote call with stale-cancel. Extracted from Search.tsx's people
 * typeahead so the Stories menu reuses the exact same query machinery —
 * the relay/backend layer is the shared `searchCachedProfiles` +
 * `searchUsersNip50` helpers; nothing is re-implemented here.
 *
 * `enabled: false` (menu closed, dropdown dismissed) clears results and
 * invalidates any in-flight debounce/response — no relay spam after close.
 * Identifier-shaped input (npub/nprofile/nsec/hex/NIP-05) is skipped, same
 * as the Search page: those resolve on submit, not via typeahead.
 */
export function usePeopleTypeahead(query: string, enabled: boolean = true, limit: number = 6) {
  const [results, setResults] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const trimmed = query.trim();
    const looksLikeId =
      /^(npub1|nprofile1|nsec1)/i.test(trimmed) ||
      /^[0-9a-f]{64}$/i.test(trimmed) ||
      trimmed.includes("@");
    if (!enabled || trimmed.length < 2 || looksLikeId) {
      seqRef.current++; // invalidate any in-flight response
      setResults([]);
      setLoading(false);
      return;
    }
    const cached = searchCachedProfiles(trimmed, limit) as Event[];
    if (cached.length > 0) setResults(cached);
    setLoading(true);
    const seq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const remote = await searchUsersNip50(trimmed, limit);
        if (seq !== seqRef.current) return;
        const seen = new Set<string>();
        const merged: Event[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) {
            seen.add(e.pubkey);
            merged.push(e);
          }
        }
        setResults(merged.slice(0, limit));
      } catch {
        /* keep cached results */
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, enabled, limit]);

  return { results, loading };
}
