/**
 * One calm row for every story on the News page (2026-09 redesign). It
 * replaces the hero card, rail and grid tiles, stacked cards and podcast cards
 * the page used to mix on one screen.
 *
 * The whole row is one button (≥44px) that opens the reader, where sharing and
 * bookmarking live. Title, then "source · time" in plain muted text; read
 * stories dim in place. The lead is the same row, bigger, with no badge. A
 * picture appears only when it's good (lib/news-image.ts decides the fit): a
 * story without one is a text row, never a grey placeholder. If the picture
 * fails it tries the image proxy once, then drops out; if a picture of unknown
 * size turns out small, it steps down to a thumbnail or disappears.
 */
import { useState, type SyntheticEvent } from "react";

export interface NewsStoryImage {
  url: string;
  fit: "lead" | "thumb";
  verified: boolean;
}

export interface NewsStoryRowProps {
  title: string;
  sourceName: string;
  /** Relative time ("24 minutes ago"); empty when the story has no date. */
  timeLabel: string;
  image: NewsStoryImage | null;
  variant: "lead" | "row";
  isRead: boolean;
  onOpen: () => void;
}

/** Wide enough to fill the lead's picture without looking blown up. */
const LEAD_MIN_WIDTH = 640;
/** Below this an image is an icon, not a picture. */
const THUMB_MIN_WIDTH = 120;

const proxied = (url: string) => `/api/rss/image-proxy?url=${encodeURIComponent(url)}`;

export function NewsStoryRow({ title, sourceName, timeLabel, image, variant, isRead, onOpen }: NewsStoryRowProps) {
  const [src, setSrc] = useState(image?.url ?? "");
  const [fit, setFit] = useState<"lead" | "thumb" | "none">(image ? image.fit : "none");
  const isLead = variant === "lead";
  // Ordinary rows only ever show a thumbnail; a big picture is the lead's alone.
  const shown = !image ? "none" : isLead ? fit : fit === "none" ? "none" : "thumb";

  const onError = () => {
    if (image && !src.startsWith("/api/rss/image-proxy")) setSrc(proxied(image.url));
    else setFit("none");
  };
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const width = e.currentTarget.naturalWidth;
    if (shown === "lead" && width < LEAD_MIN_WIDTH) setFit(width >= THUMB_MIN_WIDTH ? "thumb" : "none");
    else if (shown === "thumb" && width < THUMB_MIN_WIDTH) setFit("none");
  };
  const picture = (
    <img
      src={src}
      alt=""
      loading={isLead ? "eager" : "lazy"}
      decoding="async"
      className="h-full w-full object-cover"
      onError={onError}
      onLoad={onLoad}
    />
  );

  const tone = isRead ? "text-muted-foreground" : "text-foreground";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full min-h-11 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={isLead ? "news-lead" : "news-row"}
    >
      {shown === "lead" && (
        <span data-news-image className="mb-3 block aspect-video overflow-hidden rounded-lg bg-muted/40">
          {picture}
        </span>
      )}
      <span className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span
            className={
              isLead
                ? `block text-xl sm:text-2xl font-semibold leading-snug text-balance ${tone}`
                : `block text-[15px] font-medium leading-snug line-clamp-3 ${tone}`
            }
          >
            {title || "Untitled"}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {sourceName}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </span>
        </span>
        {shown === "thumb" && (
          <span data-news-image className="block h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted/40 sm:h-[4.5rem] sm:w-28">
            {picture}
          </span>
        )}
      </span>
    </button>
  );
}
