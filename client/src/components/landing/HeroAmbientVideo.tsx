import { useEffect, useRef, useState } from "react";

/**
 * Ambient marketing video for the landing page — a cut-off "glimpse" of a real
 * person using Relay Outpost, anchored off one edge of a section and feathered
 * with a radial mask toward the center so it reads as atmosphere behind the
 * copy, not a media player. Low opacity + a violet wash blends it into the
 * brand starfield.
 *
 * Performance: plays on desktop AND mobile, but stays cheap —
 *  - phones get a much smaller encode via `mobileSrc` (~255KB vs ~700KB),
 *  - users on Data Saver or prefers-reduced-motion get the static poster
 *    instead of any video download,
 *  - it's a touch more subtle on mobile so it never fights the centered copy.
 * autoplay/muted/loop/playsinline. Mount inside a `relative` element.
 */
export function AmbientVideo({
  src,
  mobileSrc,
  poster,
  mobilePoster,
  side = "right",
  widthClass = "w-[60%] max-w-[880px]",
  fill = false,
}: {
  src: string;
  /** Smaller phone-tuned encode; falls back to `src` if omitted. */
  mobileSrc?: string;
  poster: string;
  /** Phone-specific still (mobile is poster-only); falls back to `poster`. */
  mobilePoster?: string;
  side?: "left" | "right";
  widthClass?: string;
  /** Cover the whole parent as a backdrop (with a readability scrim) instead of
   *  the side-anchored "glimpse" layout. Use behind a card of text. */
  fill?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setIsMobile(!desktop.matches);
      setReduced(motion.matches);
      try { setSaveData(((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) === true); } catch { /* unsupported */ }
      setReady(true);
    };
    sync();
    desktop.addEventListener("change", sync);
    motion.addEventListener("change", sync);
    return () => {
      desktop.removeEventListener("change", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);

  // Only fetch/play the clip once it's near the viewport — keeps below-the-fold
  // videos (e.g. the final-CTA backdrop) off the initial page load. Above-the-
  // fold uses (the hero) trip the 400px margin immediately, so they're eager.
  useEffect(() => {
    if (!ready) return;
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);

  if (!ready) return null;

  const isLeft = side === "left";
  // Anchored at the chosen edge, dissolving toward the center and corners so the
  // clip is "cut off" cleanly rather than sitting in a hard box.
  const mask = `radial-gradient(115% 95% at ${isLeft ? "0%" : "100%"} 45%, #000 26%, rgba(0,0,0,0.5) 55%, transparent 82%)`;
  const opacityClass = isMobile ? "opacity-[0.3]" : "opacity-[0.42]";
  // Poster-only on mobile (keeps phones light — no autoplay video decode or
  // bandwidth; the poster is the same imagery), and for motion-sensitive users
  // or anyone on Data Saver. Ambient video is a desktop delight.
  const posterOnly = reduced || saveData || isMobile;
  const videoSrc = isMobile && mobileSrc ? mobileSrc : src;
  // Mobile is poster-only, so the phone-specific still is what visitors actually
  // see there; desktop keeps the original poster.
  const effectivePoster = isMobile && mobilePoster ? mobilePoster : poster;

  const mediaEl = (cls: string) =>
    posterOnly || !inView ? (
      <img src={effectivePoster} alt="" className={`h-full w-full object-cover ${cls}`} />
    ) : (
      <video
        key={videoSrc}
        className={`h-full w-full object-cover ${cls}`}
        autoPlay
        muted
        loop
        playsInline
        preload={isMobile ? "metadata" : "auto"}
        poster={effectivePoster}
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
    );

  // Full-cover backdrop (behind a card of text): low opacity + a strong violet
  // scrim so white copy stays readable on top.
  if (fill) {
    return (
      <div ref={containerRef} aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {mediaEl(isMobile ? "opacity-[0.26]" : "opacity-[0.34]")}
        <div className="absolute inset-0 bg-gradient-to-br from-brand/70 via-black/60 to-brand/55" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 ${isLeft ? "left-0" : "right-0"} z-0 overflow-hidden ${widthClass}`}
      style={{ WebkitMaskImage: mask, maskImage: mask }}
    >
      {mediaEl(opacityClass)}
      {/* Violet wash to harmonize the footage with the brand starfield. */}
      <div className={`absolute inset-0 ${isLeft ? "bg-gradient-to-r" : "bg-gradient-to-l"} from-brand/25 via-brand/5 to-transparent`} />
    </div>
  );
}
