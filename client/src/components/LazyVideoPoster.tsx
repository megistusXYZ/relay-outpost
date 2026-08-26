import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";

/**
 * A video POSTER (muted, first decoded frame) that only mounts its <video>
 * element while it's near the viewport — and unmounts it (back to a cheap
 * placeholder) once scrolled away.
 *
 * WHY LAZY: a grid/strip/montage that renders one <video> per clip mounts a real
 * media decoder for EVERY item at once. Chrome caps simultaneous decoders
 * (~75); a video-heavy profile blows past that and crashes the renderer/GPU
 * process — which takes down every tab ("Chrome quit unexpectedly"). Bounding
 * the live <video> count to what's on screen keeps us well under the limit.
 *
 * It never plays — it's a poster. Actual playback happens in the single-video
 * theater/lightbox opened on click.
 */

/**
 * Seek a hair off zero so the browser has to DECODE a frame.
 *
 * `preload="metadata"` fetches duration and dimensions. It does not promise a
 * painted picture, and Safari in particular renders the element black until a
 * frame has actually been decoded — which is why a profile full of clips showed
 * a row of black squares with a play glyph and nothing else.
 *
 * A `#t=` media fragment is the cheap half of the fix: it asks the server for
 * that instant and gives the decoder something to paint. Appended as a FRAGMENT
 * so it survives a query string, and skipped when the URL already carries a
 * hash — rewriting someone else's fragment would be a different bug.
 */
const POSTER_SEEK = 0.1;
function withPosterFrame(src: string): string {
  return src.includes("#") ? src : `${src}#t=${POSTER_SEEK}`;
}

export function LazyVideoPoster({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  /** No frame will ever paint — show the glyph rather than a black rectangle. */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "250px" }, // mount a touch early so the frame is ready on arrival
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Reset when the clip changes — otherwise one broken URL poisons the slot for
  // whatever scrolls into it next.
  useEffect(() => { setFailed(false); }, [src]);

  /**
   * If no frame has decoded shortly after mounting, stop pretending one will.
   *
   * The seek above fixes the CAUSE on the hosts and browsers that cooperate. It
   * cannot fix all of them: `#t=` needs range requests, an explicit seek needs a
   * seekable stream, and a codec the device cannot decode fails without ever
   * firing `error`. In every one of those cases the element paints nothing and
   * the tile is a black square — which reads as a broken video rather than as a
   * clip, and was the actual complaint.
   *
   * So the black box is treated as a failure state in its own right. Swapping in
   * the same film glyph the not-yet-in-view placeholder uses means the worst
   * case is a tile that looks deliberate. Deliberately generous at 2.5s: a slow
   * connection should get its real frame, not a glyph.
   */
  useEffect(() => {
    if (!inView || failed) return;
    const t = setTimeout(() => {
      const v = ref.current?.querySelector("video");
      // readyState < HAVE_CURRENT_DATA means there is no frame to paint.
      if (v && v.readyState < 2) setFailed(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [inView, failed, src]);

  const placeholder = (
    <div className="w-full h-full flex items-center justify-center bg-muted/40 dark:bg-white/[0.03]">
      <Film className="w-5 h-5 text-muted-foreground/30" />
    </div>
  );

  return (
    <div ref={ref} className={className}>
      {inView && !failed ? (
        <video
          src={withPosterFrame(src)}
          muted
          preload="metadata"
          playsInline
          // The other half of the fix, and the half that does not depend on the
          // host. `#t=` needs the server to honour a range request; plenty of
          // media hosts do not, and there the fragment is silently ignored and
          // we are back to a black box. Seeking explicitly once metadata lands
          // asks the decoder directly. Guarded on currentTime so we don't fight
          // a fragment the browser DID honour, and on duration so a stream that
          // reports nothing seekable is left alone.
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.currentTime === 0 && Number.isFinite(v.duration) && v.duration > POSTER_SEEK) {
              try { v.currentTime = POSTER_SEEK; } catch { /* not seekable; the fragment was our only shot */ }
            }
          }}
          // A dead URL used to leave a black rectangle that looked like a video
          // which had simply failed to start. The glyph at least says "clip".
          onError={() => setFailed(true)}
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        placeholder
      )}
    </div>
  );
}
