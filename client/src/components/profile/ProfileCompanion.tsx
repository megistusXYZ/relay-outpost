/**
 * The pinned rail's moving parts (lib/profile-companion.ts has the why and the
 * rules): a time spine with a dot that glides to the stretch being read, and
 * the pictures from that stretch. Desktop only — it renders into the slot the
 * layout keeps at the end of the left rail, which does not exist on a phone.
 *
 * It reads the stream it sits beside rather than owning it: the stream's own
 * chapter headings (`data-chapter`) are what it measures and jumps to, so the
 * spine can never name a chapter the page does not show.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Play } from "lucide-react";
import { LazyVideoPoster } from "@/components/LazyVideoPoster";
import { getOptimizedImageUrl } from "@/lib/nostr-helpers";
import { scrollRootFor } from "@/lib/scroll-root";
import { TILE_TITLE } from "@/components/discover-tile-title";
import { currentChapter, mediaForChapter, type CompanionMedia } from "@/lib/profile-companion";

export const COMPANION_SLOT_ID = "identity-rail-companion";
/** How far below the top of the scroller a heading counts as "being read". */
const READING_LINE_PX = 120;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ProfileCompanion({
  streamRef,
  chapters,
  media,
  hasMore,
}: {
  /** The stream this rail accompanies: its headings and rows are measured. */
  streamRef: RefObject<HTMLElement | null>;
  chapters: string[];
  media: CompanionMedia[];
  /** Older posts exist that are not loaded yet: the spine offers the way to them. */
  hasMore: boolean;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [current, setCurrent] = useState<string | null>(chapters[0] ?? null);
  const [thumbTop, setThumbTop] = useState<number | null>(null);
  const spineRef = useRef<HTMLDivElement | null>(null);

  // The slot is rendered by the layout, earlier in the same commit.
  useEffect(() => { setSlot(document.getElementById(COMPANION_SLOT_ID)); }, []);

  const measure = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const root = scrollRootFor(stream);
    const rootTop = root ? root.getBoundingClientRect().top : 0;
    const headings = Array.from(stream.querySelectorAll<HTMLElement>("[data-chapter-heading]")).map((el) => ({
      label: el.dataset.chapterHeading as string,
      top: el.getBoundingClientRect().top - rootTop,
    }));
    setCurrent(currentChapter(headings, READING_LINE_PX));
  }, [streamRef]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || !slot) return;
    // On a phone the rail's pinned block is display:none: nothing to keep in
    // step, so no scroll work at all.
    if (slot.offsetParent === null) return;
    const root: EventTarget = scrollRootFor(stream) ?? window;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => { root.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [streamRef, slot, measure, chapters.length]);

  // The dot sits beside the active row.
  useLayoutEffect(() => {
    const on = spineRef.current?.querySelector<HTMLElement>("[data-on='true']");
    setThumbTop(on ? on.offsetTop + on.offsetHeight / 2 - 6 : null);
  }, [current, chapters, slot]);

  const scrollTo = (el: Element | null | undefined) => {
    el?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const goToChapter = (label: string) => {
    const stream = streamRef.current;
    scrollTo(Array.from(stream?.querySelectorAll<HTMLElement>("[data-chapter-heading]") ?? []).find((el) => el.dataset.chapterHeading === label));
  };
  const goToPost = (eventId: string) => {
    const row = streamRef.current?.querySelector<HTMLElement>(`[data-stream-id="${eventId}"]`);
    if (!row) return;
    scrollTo(row);
    row.setAttribute("data-flash", "true");
    window.setTimeout(() => row.removeAttribute("data-flash"), 1200);
  };
  // The sentinel that loads more is the stream's last child.
  const goOlder = () => scrollTo(streamRef.current?.lastElementChild);

  if (!slot || chapters.length === 0) return null;
  const from = mediaForChapter(media, current);

  return createPortal(
    <>
      <section className="rounded-xl border border-border/60 dark:border-white/[0.07] bg-card p-3 shadow-sm shadow-black/[0.04] dark:shadow-none" data-testid="companion-spine">
        <h2 className={`${TILE_TITLE} mb-2`}>Jump through time</h2>
        <div ref={spineRef} className="relative pl-6">
          <span className="absolute left-[7px] top-1.5 bottom-1.5 w-0.5 rounded bg-border/70" aria-hidden="true" />
          {thumbTop !== null && (
            <span
              className="absolute left-0.5 w-3 h-3 rounded-full bg-primary ring-4 ring-primary/15 motion-safe:transition-[top] motion-safe:duration-300 motion-safe:ease-out"
              style={{ top: thumbTop }}
              aria-hidden="true"
            />
          )}
          {chapters.map((label) => {
            const on = label === current;
            return (
              <button
                key={label}
                type="button"
                onClick={() => goToChapter(label)}
                data-on={on}
                aria-current={on ? "true" : undefined}
                className={`block w-full text-left rounded-md px-1.5 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  on ? "text-foreground font-semibold text-[15px]" : "text-muted-foreground/70 hover:text-foreground text-[13px]"
                }`}
                data-testid="companion-chapter"
              >
                {label}
              </button>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={goOlder}
              className="block w-full text-left rounded-md px-1.5 py-1.5 text-[13px] text-muted-foreground/50 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="companion-older"
            >
              Older…
            </button>
          )}
        </div>
      </section>

      {from.items.length > 0 && (
        <section className="rounded-xl border border-border/60 dark:border-white/[0.07] bg-card p-3 shadow-sm shadow-black/[0.04] dark:shadow-none" data-testid="companion-media">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className={TILE_TITLE}>{from.fallback ? "Recent" : "From this time"}</h2>
            {!from.fallback && <span className="text-[11px] text-muted-foreground" data-testid="companion-media-label">{from.label}</span>}
          </div>
          {/* Keyed by what it shows, so a new stretch fades in rather than
              swapping under the eye. */}
          <div key={from.label} className="grid grid-cols-2 gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            {from.items.map((m, i) => (
              <button
                key={m.eventId + m.url}
                type="button"
                onClick={() => goToPost(m.eventId)}
                className={`group relative overflow-hidden rounded-lg bg-muted/30 border border-border/40 hover:ring-2 hover:ring-primary/30 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  i === 0 ? "col-span-2 aspect-video" : "aspect-[4/3]"
                }`}
                aria-label={m.isVideo ? "Video — go to the post" : "Photo — go to the post"}
                title="Go to the post"
                data-testid="companion-media-tile"
              >
                {m.isVideo ? (
                  <>
                    {m.poster
                      ? <img src={m.poster} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      : <LazyVideoPoster src={m.url} className="w-full h-full" />}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-black/55"><Play className="w-3.5 h-3.5 text-white ml-0.5" /></span>
                    </span>
                  </>
                ) : (
                  <img
                    src={getOptimizedImageUrl(m.url, 480) || m.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget.closest("button") as HTMLElement | null)?.style.setProperty("display", "none"); }}
                  />
                )}
              </button>
            ))}
          </div>
        </section>
      )}
    </>,
    slot,
  );
}
