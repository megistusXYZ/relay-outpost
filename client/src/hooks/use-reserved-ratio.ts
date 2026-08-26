import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  NEUTRAL_RATIO,
  boxMatchesMedia,
  nextFrozenRatio,
  ratioFromSize,
  recallRatio,
  rememberRatio,
  reservedRatio,
} from "@/lib/media-ratio";

/**
 * The reserved box for one piece of media, learned rather than guessed.
 *
 * The rules are pure and live in lib/media-ratio.ts; this hook is the two
 * side-effecting halves: watching whether the box is on screen (so it can be
 * frozen) and accepting the natural size the element reports once it loads.
 *
 * WHAT THIS DELIBERATELY NO LONGER DOES is hand back a guessed box. It used to
 * fall back to a neutral 4:5 and let the caller contain the image inside it,
 * which produced the failure this replaced: a landscape screenshot with no
 * `imeta dim`, pinned to the top of a portrait box, with half the post left as
 * blurred filler that reads as a hole. And the freeze made it permanent for as
 * long as you were looking at it.
 *
 * `known` is false in that case and the caller lets the image flow at its
 * natural height instead. The reserved box exists to stop layout shift, but
 * media mounts 1500px before it enters view — so an unknown image has about two
 * screens to load and there is usually nothing left to shift. The guess was
 * insuring a case the mount-lead already covers, and charging a visible hole
 * as the premium.
 *
 * `learn` is meant to be wired to the load event that already fires — an
 * <img onLoad> reading naturalWidth, a <video onLoadedMetadata> reading
 * videoWidth. Media in this app mounts 1500px before it scrolls into view, so
 * that lands roughly two screens early and the box settles off-screen, at the
 * cost of no extra network request whatsoever.
 */
export function useReservedRatio(
  ref: RefObject<HTMLElement | null>,
  url: string,
  imetaRatio?: number | null,
  fallback: number = NEUTRAL_RATIO,
): {
  /** The aspect ratio to reserve on this render. */
  ratio: number;
  /** True when the box IS the media's shape — the caller may safely `cover`. */
  exact: boolean;
  /**
   * Do we actually know this media's shape? When false the caller must NOT
   * reserve a box at all — see the note on the fallback below.
   */
  known: boolean;
  /** Feed the element's natural size in; safe to call repeatedly. */
  learn: (width?: number | null, height?: number | null) => void;
} {
  const [learned, setLearned] = useState<number | undefined>(() => recallRatio(url));
  const [frozen, setFrozen] = useState<number | undefined>(undefined);
  const [visible, setVisible] = useState(false);

  // A new URL in the same slot (feed recycling, a gallery step) must not inherit
  // the previous item's shape.
  useEffect(() => {
    setLearned(recallRatio(url));
    setFrozen(undefined);
  }, [url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => setVisible(!!entries[0]?.isIntersecting),
      { rootMargin: "0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  const trueRatio = imetaRatio ?? learned ?? null;
  const live = reservedRatio({ imetaRatio, learnedRatio: learned, fallback });
  const ratio = reservedRatio({ frozenRatio: frozen, imetaRatio, learnedRatio: learned, fallback });

  // Capture on entry, hold while visible, release on exit. Keyed on the LIVE
  // ratio rather than the displayed one, so re-running this can never feed a
  // frozen value back into itself.
  useEffect(() => {
    setFrozen((prev) => nextFrozenRatio(prev, visible, live));
  }, [visible, live]);

  const learn = useCallback(
    (width?: number | null, height?: number | null) => {
      const next = ratioFromSize(width, height);
      if (next === null) return;
      rememberRatio(url, width, height);
      setLearned((prev) => (prev === next ? prev : next));
    },
    [url],
  );

  return { ratio, exact: boxMatchesMedia(ratio, trueRatio), known: trueRatio !== null, learn };
}
