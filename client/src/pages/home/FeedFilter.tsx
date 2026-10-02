import type { ReactNode, RefObject } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopOptionsPopover } from "@/components/DesktopOptionsPopover";
import { Segment } from "@/components/Segment";
import { ArrowRight, Globe } from "lucide-react";
import {
  FEED_SORT_OPTIONS, TOP_TIME_WINDOWS, SAVED_POLL_SORTS, SAVED_POLL_SHOW_OPTIONS,
  type FeedSortMode, type TopTimeWindow, type SavedPollSort, type SavedPollShow, type ArchivesRange,
} from "./helpers";
import { TOP_BY_OPTIONS, trendingFilter, type FilterGroup, type TopBy, type TrendingFrom } from "./feed-menu";

export type FeedOrderValue = "popular" | "latest";
export type ContentFilterValue = "posts" | "replies" | "all";
export type PresetValue = "open" | "balanced" | "strict";
export type MediaSortValue = "trending" | "latest";

/** The heading both panels (filter, Feeds list) share: plain, sentence case. */
export const PANEL_TITLE = "text-base font-semibold text-foreground mb-4";

/**
 * The feed filter: the options of the feed on screen, and only those
 * (feed-menu.ts decides which). One button opens it, for every feed.
 *
 * It stays open while you pick — the feed changes behind it — so setting two
 * things is two taps, not open-pick-reopen-pick. A popover under the filter
 * button on desktop; a bottom sheet with a Done button on a phone.
 */
export function FeedFilter({
  open, onOpenChange, anchorRef, feedName, groups,
  order, onOrder,
  contentFilter, onContentFilter,
  activePreset, onPreset, onAdvanced,
  trendingSelector, archivesRange, onTopBy, onFrom,
  mediaSort, onMediaSort,
  pollSort, onPollSort, pollShow, onPollShow,
  feedSortMode, onFeedSort, topTimeWindow, onTimeWindow, feedStyle, onFeedStyle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The filter button: the desktop popover drops from it. */
  anchorRef: RefObject<HTMLElement>;
  feedName: string;
  groups: FilterGroup[];
  order: FeedOrderValue;
  onOrder: (v: FeedOrderValue) => void;
  contentFilter: ContentFilterValue;
  onContentFilter: (v: ContentFilterValue) => void;
  activePreset: string;
  onPreset: (p: PresetValue) => void;
  onAdvanced: () => void;
  trendingSelector: string;
  archivesRange: ArchivesRange;
  onTopBy: (v: TopBy) => void;
  onFrom: (v: TrendingFrom) => void;
  mediaSort: MediaSortValue;
  onMediaSort: (v: MediaSortValue) => void;
  pollSort: SavedPollSort;
  onPollSort: (v: SavedPollSort) => void;
  pollShow: SavedPollShow;
  onPollShow: (v: SavedPollShow) => void;
  feedSortMode: FeedSortMode;
  onFeedSort: (v: FeedSortMode) => void;
  topTimeWindow: TopTimeWindow;
  onTimeWindow: (v: TopTimeWindow) => void;
  feedStyle: "all" | "photos" | "video" | "polls";
  onFeedStyle: (v: "all" | "photos" | "video") => void;
}) {
  const isMobile = useIsMobile();
  const trending = trendingFilter(trendingSelector, archivesRange);

  const group: Record<FilterGroup, () => ReactNode> = {
    order: () => (
      <Segment label="Order" cols={2} options={[{ value: "popular", label: "Popular" }, { value: "latest", label: "Latest" }]} value={order} onChange={onOrder} testPrefix="feed-filter-order" />
    ),
    show: () => (
      <Segment label="Show" options={[{ value: "posts", label: "Posts" }, { value: "replies", label: "Replies" }, { value: "all", label: "Both" }]} value={contentFilter} onChange={onContentFilter} testPrefix="feed-filter-show" />
    ),
    strictness: () => (
      <div>
        <Segment
          label="How strict"
          options={[{ value: "open", label: "Open" }, { value: "balanced", label: "Balanced" }, { value: "strict", label: "Strict" }]}
          value={(["open", "balanced", "strict"].includes(activePreset) ? (activePreset as PresetValue) : null)}
          onChange={onPreset}
          testPrefix="feed-filter-strict"
        />
        <button
          type="button"
          onClick={() => { onAdvanced(); onOpenChange(false); }}
          className="mt-2 inline-flex items-center gap-1 min-h-[32px] text-xs text-brand/80 hover:underline"
          data-testid="feed-filter-advanced"
        >
          More in Trust &amp; Safety <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    ),
    "top-by": () => (
      <Segment label="Top by" options={TOP_BY_OPTIONS} value={trending.topBy} onChange={onTopBy} testPrefix="feed-filter-top-by" />
    ),
    from: () => (
      <div>
        <Segment label="From" cols={trending.fromOptions.length === 2 ? 2 : 3} options={trending.fromOptions} value={trending.from} onChange={onFrom} testPrefix="feed-filter-from" />
        {trending.topBy !== "overall" && (
          <a
            href="https://nostrarchives.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
            data-testid="link-archives-attribution"
          >
            <Globe className="w-3 h-3" /> Charts by Archives
          </a>
        )}
      </div>
    ),
    "media-order": () => (
      <Segment label="Order" cols={2} options={[{ value: "trending", label: "Trending" }, { value: "latest", label: "Latest" }]} value={mediaSort} onChange={onMediaSort} testPrefix="feed-filter-media-order" />
    ),
    "poll-order": () => (
      <Segment label="Order" options={SAVED_POLL_SORTS.map(({ value, label }) => ({ value, label }))} value={pollSort} onChange={onPollSort} testPrefix="feed-filter-poll-order" />
    ),
    "poll-show": () => (
      <Segment label="Show" cols={2} options={SAVED_POLL_SHOW_OPTIONS.map(({ value, label }) => ({ value, label: value === "open" ? "Open polls" : "All polls" }))} value={pollShow} onChange={onPollShow} testPrefix="feed-filter-poll-show" />
    ),
    "feed-order": () => (
      <Segment label="Order" cols={2} options={FEED_SORT_OPTIONS.map(({ value, label }) => ({ value, label }))} value={feedSortMode} onChange={onFeedSort} testPrefix="feed-filter-feed-order" />
    ),
    "feed-from": () => (
      <Segment label="From" cols={4} options={TOP_TIME_WINDOWS.map(({ value, label }) => ({ value, label }))} value={topTimeWindow} onChange={onTimeWindow} testPrefix="feed-filter-feed-from" />
    ),
    "feed-show": () => (
      <Segment label="Show" options={[{ value: "all", label: "Everything" }, { value: "photos", label: "Photos" }, { value: "video", label: "Videos" }]} value={feedStyle === "polls" ? "all" : feedStyle} onChange={onFeedStyle} testPrefix="feed-filter-feed-show" />
    ),
  };

  const body = (
    <div className="space-y-5" data-testid="feed-filter-groups">
      {groups.map((g) => <div key={g} data-group={g}>{group[g]()}</div>)}
    </div>
  );
  const title = `Filter ${feedName}`;

  if (!isMobile) {
    return (
      <DesktopOptionsPopover open={open} onOpenChange={onOpenChange} anchorRef={anchorRef} align="end" title={title} titleClassName={PANEL_TITLE} testId="feed-filter" width="w-[360px]">
        {body}
      </DesktopOptionsPopover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl p-0 overflow-hidden" data-testid="feed-filter">
        <div className="max-h-[85vh] overflow-y-auto p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <SheetTitle className={PANEL_TITLE}>{title}</SheetTitle>
          {body}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mt-6 w-full min-h-[48px] rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            data-testid="feed-filter-done"
          >
            Done
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
