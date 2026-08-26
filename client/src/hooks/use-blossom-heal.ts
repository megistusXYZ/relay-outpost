import { useCallback, useMemo, useRef, useState } from "react";
import {
  blossomAlternates,
  isMediaUrlDead,
  markMediaUrlDead,
  MAX_BLOSSOM_ALTERNATES,
} from "@/lib/blossom-media";
import { getBlossomServers, DEFAULT_BLOSSOM_SERVERS } from "@/lib/media-upload";

export interface BlossomHealOptions {
  /** imeta `x` fingerprint, when the event ships one. */
  sha256?: string;
  /** imeta `fallback` mirror URLs, when the event ships them. */
  fallbacks?: string[];
}

/**
 * Self-healing media source: when a media URL dies, walk an ordered, bounded
 * list of Blossom alternates (imeta fallbacks first, then `{server}/{sha256}`
 * across the user's + default servers — the hash derived from imeta `x` or
 * the URL path itself, so it works even without imeta).
 *
 * Bounded by design: at most MAX_BLOSSOM_ALTERNATES alternates per media,
 * each URL tried once per session (module-scope dead-URL cache shared across
 * components), never a loop. `exhausted` flips true when nothing is left —
 * callers keep their existing terminal fallback UI.
 */
export function useBlossomHeal(src: string, opts?: BlossomHealOptions) {
  const fallbackKey = (opts?.fallbacks ?? []).join("\n");
  const candidates = useMemo(() => {
    let alternates: string[] = [];
    try {
      alternates = blossomAlternates(src, {
        sha256: opts?.sha256,
        fallbacks: opts?.fallbacks,
        servers: [...getBlossomServers(), ...DEFAULT_BLOSSOM_SERVERS],
      }).slice(0, MAX_BLOSSOM_ALTERNATES);
    } catch {}
    return [src, ...alternates];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, opts?.sha256, fallbackKey]);

  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  // Start on the first candidate not already known-dead this session — a blob
  // that failed earlier in the feed goes straight to a live mirror (or, when
  // everything is dead, straight to the terminal fallback) with zero requests.
  const [index, setIndex] = useState(() => {
    const first = candidates.findIndex((c) => !isMediaUrlDead(c));
    return first === -1 ? candidates.length : first;
  });
  const indexRef = useRef(index);
  indexRef.current = index;

  const exhausted = index >= candidates.length;
  const healSrc = exhausted ? src : candidates[index];

  /**
   * Record the current candidate as dead and move to the next live one.
   * Returns true when another candidate is available (a re-render will load
   * it); false when the list is exhausted.
   */
  const advance = useCallback((): boolean => {
    const list = candidatesRef.current;
    const current = list[indexRef.current];
    if (current) markMediaUrlDead(current);
    let next = indexRef.current + 1;
    while (next < list.length && isMediaUrlDead(list[next])) next++;
    indexRef.current = next;
    setIndex(next);
    return next < list.length;
  }, []);

  return {
    /** The URL to load right now (original or a live alternate). */
    src: healSrc,
    /** True when `src` is a healed alternate (skip proxy/IPFS chains for these). */
    isAlternate: !exhausted && index > 0,
    /** True when the original and every alternate are dead — show the terminal fallback. */
    exhausted,
    advance,
  };
}
