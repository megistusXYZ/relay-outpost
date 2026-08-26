import type { ReactNode, RefObject } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopOptionsPopover } from "@/components/DesktopOptionsPopover";
import { ShieldCheck, ArrowRight, Globe, Heart, MessageCircle, Repeat2, BarChart3, RefreshCw } from "lucide-react";
import { BtcZapIcon } from "@/components/NostrPost";
import {
  TRENDING_SELECTORS, TRENDING_TIME_OPTIONS, POLL_SORTS, isArchivesSelector,
  type TrendingTimeValue, type PollSort,
} from "./helpers";

/**
 * X-style feed options sheet — the single tap-to-open surface that replaces the
 * old stacked header rows (sort pills, content filter, HOW STRICT preset). Opened
 * by the chevron on the active For you / Following tab. Groups: Sort, Show, and
 * (when WoT is on) Strictness with an Advanced link to Trust & Safety.
 */
export type FeedSortValue = "popular" | "latest" | "trending";
export type ContentFilterValue = "posts" | "replies" | "all";
export type PresetValue = "open" | "balanced" | "strict";

export function Segment<T extends string>({
  label, options, value, onChange, testPrefix, cols = 3,
}: {
  label: string;
  options: { value: T; label: string; desc?: string; icon?: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
  testPrefix: string;
  cols?: 2 | 3 | 4;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">{label}</p>
      <div className={`grid ${cols === 4 ? "grid-cols-4" : cols === 2 ? "grid-cols-2" : "grid-cols-3"} gap-1.5`}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`rounded-lg px-2 py-2 text-sm font-medium border transition-all min-h-[44px] ${ active ? "border-brand/40 bg-accent dark:bg-brand/15 text-foreground" : "border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25" }`}
              aria-pressed={active}
              data-testid={`${testPrefix}-${o.value}`}
            >
              {o.icon ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  {o.icon}
                  {o.label}
                </span>
              ) : (
                o.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Metric icons for the Trending "Metric" segment — same colors as the feed's engagement icons. */
const METRIC_ICONS: Record<string, ReactNode> = {
  arc_reactions: <Heart className="w-3.5 h-3.5 text-pink-400 shrink-0" />,
  arc_zaps: <BtcZapIcon className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />,
  arc_replies: <MessageCircle className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400 shrink-0" />,
  arc_reposts: <Repeat2 className="w-3.5 h-3.5 text-green-800 dark:text-green-400 shrink-0" />,
};

export function FeedOptionsSheet({
  open, onOpenChange, tab, anchorRef,
  currentSort, onSort,
  contentFilter, onContentFilter,
  showStrictness, activePreset, onPreset, onAdvanced,
  trendingSelector, onTrendingMetric, trendingTime, onTrendingTime,
  pollSort, onPollSort, onPickPolls, onRefreshTrending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tab: "foryou" | "following";
  /** Active tab pill the desktop popover anchors under (see DesktopOptionsPopover). */
  anchorRef: RefObject<HTMLElement>;
  currentSort: FeedSortValue;
  onSort: (v: FeedSortValue) => void;
  contentFilter: ContentFilterValue;
  onContentFilter: (v: ContentFilterValue) => void;
  showStrictness: boolean;
  activePreset: string;
  onPreset: (p: PresetValue) => void;
  onAdvanced: () => void;
  /** Trending controls (moved here from the old under-tab pill/chip rows). */
  trendingSelector: string;
  onTrendingMetric: (v: string) => void;
  trendingTime: TrendingTimeValue | null;
  onTrendingTime: (v: TrendingTimeValue) => void;
  pollSort: PollSort;
  onPollSort: (v: PollSort) => void;
  onPickPolls: () => void;
  onRefreshTrending: () => void;
}) {
  // Following has no separate "Trending" source.
  const sortOptions: { value: FeedSortValue; label: string }[] =
    tab === "foryou"
      ? [{ value: "popular", label: "Popular" }, { value: "latest", label: "Latest" }, { value: "trending", label: "Trending" }]
      : [{ value: "popular", label: "Popular" }, { value: "latest", label: "Latest" }];

  const close = () => onOpenChange(false);
  // X-style: picking an option applies it and closes the sheet, so the feed
  // (behind the sheet) is immediately visible. Reopen with one tap to change more.
  const pickSort = (v: FeedSortValue) => { onSort(v); close(); };
  const pickShow = (v: ContentFilterValue) => { onContentFilter(v); close(); };
  const pickPreset = (p: PresetValue) => { onPreset(p); close(); };
  const pickMetric = (v: string) => { onTrendingMetric(v); close(); };
  const pickTime = (v: TrendingTimeValue) => { onTrendingTime(v); close(); };
  const pickPollSort = (v: PollSort) => { onPollSort(v); close(); };
  const pickPolls = () => { onPickPolls(); close(); };
  const refreshTrending = () => { onRefreshTrending(); close(); };

  const isPolls = trendingSelector === "polls";
  const isMobile = useIsMobile();
  const title = `${tab === "foryou" ? "For you" : "Following"} options`;

  const body = (
        <div className="space-y-5">
          <Segment
            label="Sort"
            options={sortOptions}
            value={currentSort}
            onChange={pickSort}
            testPrefix="feed-opt-sort"
          />

          {currentSort === "trending" && (
            // Trending's metric + time-range controls — moved here from the old
            // under-tab pill/dropdown + chip rows so the feed top stays tabs-only.
            <>
              <Segment
                label="Metric"
                cols={2}
                options={TRENDING_SELECTORS.filter((s) => s.group === "archives").map((s) => ({
                  value: s.value as string,
                  label: s.label,
                  icon: METRIC_ICONS[s.value],
                }))}
                value={isArchivesSelector(trendingSelector) ? trendingSelector : null}
                onChange={pickMetric}
                testPrefix="feed-opt-metric"
              />

              {isPolls ? (
                <Segment
                  label="Poll sort"
                  cols={2}
                  options={POLL_SORTS.map(({ value, label }) => ({ value, label }))}
                  value={pollSort}
                  onChange={pickPollSort}
                  testPrefix="feed-opt-poll-sort"
                />
              ) : (
                <Segment
                  label="Time range"
                  cols={4}
                  options={TRENDING_TIME_OPTIONS.map(({ value, label }) => ({ value, label }))}
                  value={trendingTime}
                  onChange={pickTime}
                  testPrefix="feed-opt-time"
                />
              )}

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={pickPolls}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium border transition-all min-h-[44px] ${ isPolls ? "border-brand/40 bg-accent dark:bg-brand/15 text-foreground" : "border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25" }`}
                  aria-pressed={isPolls}
                  title="Active polls from the network"
                  data-testid="feed-opt-polls"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-brand shrink-0" />
                  Polls
                </button>
                <button
                  type="button"
                  onClick={refreshTrending}
                  className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium border border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25 transition-all min-h-[44px]"
                  data-testid="feed-opt-refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                  Refresh
                </button>
              </div>
            </>
          )}

          {currentSort === "trending" ? (
            // Honest UI: the Posts/Replies/All lens deliberately doesn't apply to
            // Trending (its charts — Most Replied, Zapped, … — need the full
            // ranked set), so explain that instead of offering dead buttons.
            <div data-testid="feed-opt-show-na">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">Show</p>
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                Trending ranks the whole network's activity, so it always shows the full chart (flagged accounts are still hidden). Switch to Popular or Latest to filter and tune strictness.
              </p>
              <a
                href="https://nostrarchives.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] bg-[#1f1b4b] dark:bg-brand/15 text-white dark:text-brand border border-[#1f1b4b] dark:border-brand/25 hover:bg-[#2a2560] dark:hover:bg-brand/20 transition-colors"
                data-testid="link-archives-attribution"
              >
                <span className="opacity-70">powered by</span>
                <Globe className="w-2.5 h-2.5 opacity-75" />
                Archives
              </a>
            </div>
          ) : (
            <Segment
              label="Show"
              options={[{ value: "posts", label: "Posts" }, { value: "replies", label: "Replies" }, { value: "all", label: "All" }]}
              value={contentFilter}
              onChange={pickShow}
              testPrefix="feed-opt-show"
            />
          )}

          {/* Strictness is hidden for Trending: personal trust tiers don't map onto
              a global network chart (the note above covers it; flagged accounts
              stay hidden regardless). */}
          {showStrictness && currentSort !== "trending" && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-brand/70" />
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Strictness</p>
              </div>
              <Segment
                label=""
                options={[{ value: "open", label: "Open" }, { value: "balanced", label: "Balanced" }, { value: "strict", label: "Strict" }]}
                value={(["open", "balanced", "strict"].includes(activePreset) ? (activePreset as PresetValue) : null)}
                onChange={pickPreset}
                testPrefix="feed-opt-strict"
              />
              <button
                type="button"
                onClick={() => { onAdvanced(); close(); }}
                className="mt-2 inline-flex items-center gap-1 text-xs text-brand/80 hover:underline"
                data-testid="feed-opt-advanced"
              >
                Advanced controls in Trust &amp; Safety <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
  );

  if (!isMobile) {
    return (
      <DesktopOptionsPopover
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        align="start"
        title={title}
        testId="feed-options-sheet"
      >
        {body}
      </DesktopOptionsPopover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]" data-testid="feed-options-sheet">
        <SheetTitle className="text-sm font-brand uppercase tracking-widest mb-4">
          {title}
        </SheetTitle>
        {body}
      </SheetContent>
    </Sheet>
  );
}
