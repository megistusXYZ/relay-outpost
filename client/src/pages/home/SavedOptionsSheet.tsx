import { useMemo, useState } from "react";
import type { RefObject } from "react";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopOptionsPopover } from "@/components/DesktopOptionsPopover";
import {
  ChevronDown, ChevronUp, Download, Flame, Hash, Package, Plus, Radio,
  Settings2, Share2, Users, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { FeedIcon as FeedIconSvg, isValidFeedIconKey } from "@/components/FeedIcons";
import type { NostrCustomFeed } from "@/hooks/use-nostr-feeds";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { feedHasLive, liveNowCount } from "@/lib/feed-live";
import { useFollowedHashtags } from "@/hooks/use-followed-hashtags";
import { Segment } from "./FeedOptionsSheet";

/**
 * "Hashtags you follow" — the user's PORTABLE kind-10015 interests list, shared
 * across every Nostr app they use. Deliberately kept visually + textually
 * distinct from "Your feeds" below (custom kind-30078 feeds that live only here)
 * so the two concepts can't be confused. All writes are wipe-guarded in
 * interests.ts (they merge into the freshly-loaded list, never replace it).
 */
function FollowedHashtagsSection({ onNavigate }: { onNavigate: () => void }) {
  const { hashtags, follow, unfollow, pending, canFollow } = useFollowedHashtags();
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState("");

  if (!canFollow) return null;

  const add = () => {
    const tag = draft.trim();
    if (!tag) return;
    follow(tag);
    setDraft("");
  };
  const openTag = (tag: string) => {
    onNavigate();
    setLocation(`/search?tab=hashtags&q=${encodeURIComponent(tag)}`);
  };

  return (
    <div data-testid="followed-hashtags-section">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5 flex items-center gap-1">
        <Hash className="w-3 h-3" /> Hashtags you follow
      </p>
      <p className="text-[11px] text-muted-foreground/45 mb-2 leading-snug">
        Portable — shared across all your Nostr apps. Different from custom feeds below.
      </p>
      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {hashtags.map((tag) => {
            const busy = pending === tag;
            return (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border border-brand/25 bg-brand/5 dark:bg-brand/10 text-sm text-foreground/90"
                data-testid={`followed-hashtag-${tag}`}
              >
                <button
                  type="button"
                  onClick={() => openTag(tag)}
                  className="pl-2.5 pr-1.5 py-1.5 min-h-[36px] font-medium hover:text-brand transition-colors"
                >
                  #{tag}
                </button>
                <button
                  type="button"
                  onClick={() => unfollow(tag)}
                  disabled={busy}
                  aria-label={`Unfollow #${tag}`}
                  className="pr-2 pl-0.5 py-1.5 min-h-[36px] text-muted-foreground/50 hover:text-destructive transition-colors disabled:opacity-40"
                  data-testid={`unfollow-hashtag-${tag}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\s+/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Follow a hashtag…"
            className="h-11 pl-8 text-sm"
            data-testid="input-follow-hashtag"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || !!pending}
          className="flex items-center gap-1 rounded-lg px-3 min-h-[44px] text-sm font-medium border border-brand/30 bg-brand/10 text-brand hover:bg-brand/15 transition-all disabled:opacity-40 shrink-0"
          data-testid="button-add-followed-hashtag"
        >
          <Plus className="w-4 h-4" /> Follow
        </button>
      </div>
    </div>
  );
}
import {
  FEED_SORT_OPTIONS, TIME_WINDOW_SORT_MODES, TOP_TIME_WINDOWS,
  SAVED_POLL_SORTS, SAVED_POLL_SHOW_OPTIONS,
  type FeedSortMode, type TopTimeWindow, type SavedPollSort, type SavedPollShow,
} from "./helpers";

export type FeedStyleValue = "all" | "photos" | "video" | "polls";
export type MediaSortValue = "trending" | "latest";

/**
 * Saved-tab counterpart of FeedOptionsSheet — same bottom-sheet shell, opened by
 * tapping the active Saved pill. Replaces the old dropdown so all three pills
 * share one uniform options surface: Feed (Images/Videos/Polls), Sort, the
 * user's custom feeds, and the Tune/Packs/Import actions.
 */
export function SavedOptionsSheet({
  open, onOpenChange, anchorRef,
  feedMode, feedStyle, mediaSort,
  onPickMacro, onPickSort,
  pollSort, onPollSort, pollShow, onPollShow,
  activeFeed, feedSortMode, onFeedSort, topTimeWindow, onTimeWindow, onPickStyle,
  customFeeds, onSelectFeed, onReorder, onShare, onEdit, onDelete,
  onTuneNew, onBrowsePacks, onImport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Active Saved pill the desktop popover anchors under (see DesktopOptionsPopover). */
  anchorRef: RefObject<HTMLElement>;
  feedMode: string;
  feedStyle: FeedStyleValue;
  mediaSort: MediaSortValue;
  onPickMacro: (style: Exclude<FeedStyleValue, "all">) => void;
  onPickSort: (v: MediaSortValue) => void;
  /** Polls macro feed controls — shown only while the Polls feed is active. */
  pollSort: SavedPollSort;
  onPollSort: (v: SavedPollSort) => void;
  pollShow: SavedPollShow;
  onPollShow: (v: SavedPollShow) => void;
  /** The saved custom feed currently on screen (null on the macro/other feeds). */
  activeFeed: NostrCustomFeed | null;
  feedSortMode: FeedSortMode;
  onFeedSort: (v: FeedSortMode) => void;
  topTimeWindow: TopTimeWindow;
  onTimeWindow: (v: TopTimeWindow) => void;
  onPickStyle: (v: "all" | "photos" | "video") => void;
  customFeeds: NostrCustomFeed[];
  onSelectFeed: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onShare: (feed: NostrCustomFeed) => void;
  onEdit: (feed: NostrCustomFeed) => void;
  onDelete: (feed: NostrCustomFeed) => void;
  onTuneNew: () => void;
  onBrowsePacks: () => void;
  onImport: () => void;
}) {
  const [, navigate] = useLocation();
  // Real-time live signal, derived entirely from the already-subscribed
  // LiveStatusContext — no new per-feed subscriptions. livePubkeys drives the
  // per-feed dot + the Live-now count; liveHashtags is a best-effort fallback
  // so author-less (topic) feeds can still light up.
  const { livePubkeys, getLiveStream } = useLiveStatus();
  const liveHashtags = useMemo(() => {
    const tags = new Set<string>();
    if (livePubkeys.size === 0) return tags;
    for (const pk of livePubkeys) {
      getLiveStream(pk)?.hashtags?.forEach((t) => tags.add(t.toLowerCase()));
    }
    return tags;
  }, [livePubkeys, getLiveStream]);
  const liveCount = useMemo(
    () => liveNowCount(customFeeds, livePubkeys),
    [customFeeds, livePubkeys],
  );

  const close = () => onOpenChange(false);
  // Same X-style contract as FeedOptionsSheet: picking applies + closes.
  const pickMacro = (v: Exclude<FeedStyleValue, "all">) => { onPickMacro(v); close(); };
  const pickSort = (v: MediaSortValue) => { onPickSort(v); close(); };
  const pickPollSort = (v: SavedPollSort) => { onPollSort(v); close(); };
  const pickPollShow = (v: SavedPollShow) => { onPollShow(v); close(); };
  const pickFeed = (id: string) => { onSelectFeed(id); close(); };
  const pickFeedSort = (v: FeedSortMode) => { onFeedSort(v); close(); };
  const pickWindow = (v: TopTimeWindow) => { onTimeWindow(v); close(); };
  const pickStyle = (v: "all" | "photos" | "video") => { onPickStyle(v); close(); };
  // Dialog-opening actions close the sheet first so the two overlays don't
  // fight over focus, then open on the next tick.
  const after = (fn: () => void) => { close(); setTimeout(fn, 0); };
  // Live-now row taps into the existing live-streams surface (search's Live tab).
  const openLive = () => after(() => navigate("/search?tab=live"));

  const isMobile = useIsMobile();

  const body = (
        <div className="space-y-5">
          <Segment
            label="Feed"
            options={[{ value: "photos", label: "Images" }, { value: "video", label: "Videos" }, { value: "polls", label: "Polls" }]}
            value={feedMode === "custom_all" ? (feedStyle as "photos" | "video" | "polls") : null}
            onChange={pickMacro}
            testPrefix="saved-opt-feed"
          />

          {/* Sort belongs to the macro Images/Videos feeds only. */}
          {feedMode === "custom_all" && feedStyle !== "polls" && (
            <Segment
              label="Sort"
              options={[{ value: "trending", label: "Trending" }, { value: "latest", label: "Latest" }]}
              value={mediaSort}
              onChange={pickSort}
              testPrefix="saved-opt-sort"
            />
          )}

          {/* Polls macro feed controls: sort (Trending / Latest / Ending soon)
              plus the Open/All lens over ended polls. Same value vocabulary as
              the For You surface's pollSort ("expiring" = Ending soon). */}
          {feedMode === "custom_all" && feedStyle === "polls" && (
            <>
              <Segment
                label="Sort"
                options={SAVED_POLL_SORTS.map(({ value, label }) => ({ value, label }))}
                value={pollSort}
                onChange={pickPollSort}
                testPrefix="saved-opt-poll-sort"
              />
              <Segment
                label="Show"
                cols={2}
                options={SAVED_POLL_SHOW_OPTIONS.map(({ value, label }) => ({ value, label }))}
                value={pollShow}
                onChange={pickPollShow}
                testPrefix="saved-opt-poll-show"
              />
            </>
          )}

          {/* Active saved feed's controls — these replaced the condensed
              control row that used to sit under the mode pills. */}
          {activeFeed && (
            <>
              <Segment
                label={`Sort · ${activeFeed.name}`}
                options={FEED_SORT_OPTIONS.map(({ value, label }) => ({ value, label }))}
                value={feedSortMode}
                onChange={pickFeedSort}
                testPrefix="saved-opt-feed-sort"
              />
              {TIME_WINDOW_SORT_MODES.includes(feedSortMode) && (
                <Segment
                  label="Time range"
                  options={TOP_TIME_WINDOWS.map(({ value, label }) => ({ value, label }))}
                  value={topTimeWindow}
                  onChange={pickWindow}
                  testPrefix="saved-opt-feed-window"
                  cols={4}
                />
              )}
              <Segment
                label="Show"
                options={[{ value: "all", label: "All" }, { value: "photos", label: "Photos" }, { value: "video", label: "Video" }]}
                value={feedStyle === "polls" ? "all" : (feedStyle as "all" | "photos" | "video")}
                onChange={pickStyle}
                testPrefix="saved-opt-feed-style"
              />
            </>
          )}

          <FollowedHashtagsSection onNavigate={close} />

          {customFeeds.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">Your feeds</p>
              <div className="space-y-1.5">
                {/* Conditional Live-now entry — styled like a saved-feed row so it
                    fits the layout. Only renders when a live author is relevant to
                    your feeds; vanishes when nothing's live. Taps into the live
                    streams surface. */}
                {liveCount > 0 && (
                  <button
                    type="button"
                    onClick={openLive}
                    className="flex w-full items-center gap-2 rounded-lg border border-red-400/40 bg-red-500/5 px-2 py-2 min-h-[44px] text-left transition-all hover:border-red-400/60"
                    data-testid="saved-opt-live-now"
                  >
                    <Radio className="w-3.5 h-3.5 text-red-500 live-dot shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">Live now</span>
                    <span className="text-[11px] font-semibold text-red-500 tabular-nums shrink-0">{liveCount}</span>
                    <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_4px_1px_rgba(239,68,68,0.4)] live-dot border border-red-400/50 shrink-0" />
                  </button>
                )}
                {customFeeds.map((cf, cfIdx) => {
                  const active = feedMode === `custom_${cf.id}`;
                  const hasLive = feedHasLive(cf, livePubkeys, liveHashtags);
                  return (
                    <div
                      key={cf.id}
                      className={`flex items-center gap-1 rounded-lg border px-2 min-h-[44px] transition-all ${ active ? "border-brand/40 bg-accent dark:bg-brand/15" : "border-border dark:border-brand/10 bg-muted" }`}
                      data-testid={`saved-opt-feed-row-${cf.id}`}
                    >
                      <button
                        type="button"
                        onClick={() => pickFeed(cf.id)}
                        className="flex flex-1 min-w-0 items-center gap-2 py-2 text-left"
                        data-testid={`saved-opt-select-${cf.id}`}
                      >
                        {isValidFeedIconKey(cf.icon)
                          ? <FeedIconSvg iconKey={cf.icon} className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                          : cf.source === "pack"
                            ? <Users className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                            : <Flame className="w-3.5 h-3.5 text-orange-800/70 dark:text-orange-400/70 shrink-0" />}
                        <span className={`truncate text-sm font-medium ${active ? "text-foreground" : "text-muted-foreground/80"}`}>{cf.name}</span>
                        {hasLive && (
                          <span
                            className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_4px_1px_rgba(239,68,68,0.4)] live-dot border border-red-400/50 shrink-0"
                            title="A streamer in this feed is live"
                            data-testid={`saved-opt-feed-live-${cf.id}`}
                          />
                        )}
                        {active && <span className="text-[10px] text-brand shrink-0">Active</span>}
                      </button>
                      {customFeeds.length > 1 && (
                        <div className="flex flex-col shrink-0">
                          <button
                            type="button"
                            className={`px-1.5 py-0.5 rounded hover:bg-brand/10 transition-colors ${cfIdx === 0 ? "text-muted-foreground/20 pointer-events-none" : "text-muted-foreground/50 hover:text-brand"}`}
                            onClick={() => onReorder(cfIdx, cfIdx - 1)}
                            aria-label={`Move ${cf.name} up`}
                            data-testid={`saved-opt-move-up-${cf.id}`}
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className={`px-1.5 py-0.5 rounded hover:bg-brand/10 transition-colors ${cfIdx === customFeeds.length - 1 ? "text-muted-foreground/20 pointer-events-none" : "text-muted-foreground/50 hover:text-brand"}`}
                            onClick={() => onReorder(cfIdx, cfIdx + 1)}
                            aria-label={`Move ${cf.name} down`}
                            data-testid={`saved-opt-move-down-${cf.id}`}
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        className="p-2 rounded hover:bg-brand/10 text-muted-foreground/50 hover:text-brand transition-colors shrink-0"
                        onClick={() => after(() => onShare(cf))}
                        aria-label={`Share ${cf.name}`}
                        data-testid={`saved-opt-share-${cf.id}`}
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded hover:bg-brand/10 text-muted-foreground/50 hover:text-brand transition-colors shrink-0"
                        onClick={() => after(() => onEdit(cf))}
                        aria-label={`Edit ${cf.name}`}
                        data-testid={`saved-opt-edit-${cf.id}`}
                      >
                        <Settings2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-colors shrink-0"
                        onClick={() => after(() => onDelete(cf))}
                        aria-label={`Delete ${cf.name}`}
                        data-testid={`saved-opt-delete-${cf.id}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="grid grid-cols-1 gap-1.5">
              {([
                { key: "tune", label: "Tune New Feed", icon: Plus, run: onTuneNew },
                { key: "packs", label: "Browse Packs", icon: Package, run: onBrowsePacks },
                { key: "import", label: "Import Feed", icon: Download, run: onImport },
              ] as const).map(({ key, label, icon: Icon, run }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => after(run)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium border border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25 transition-all text-left"
                  data-testid={`saved-opt-action-${key}`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
  );

  if (!isMobile) {
    return (
      <DesktopOptionsPopover
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        align="end"
        title="Saved options"
        testId="saved-options-sheet"
      >
        {body}
      </DesktopOptionsPopover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Scrolling lives on an INNER wrapper, not on SheetContent itself:
          iOS WebKit can fail to composite the background of a scrollable
          element inside a transformed fixed container (the slide-up sheet) —
          on-device the tall Saved sheet painted its text with NO panel behind
          it while the short For-you/Following sheets were fine. Keeping
          SheetContent overflow-free keeps that scroll off the animated shell.
          The opaque drawer fill itself is now guaranteed by SheetContent's
          shared iOS-standalone compositing fix (inline bg + translateZ(0) +
          isolate for side="bottom"), so no per-sheet backing layer is needed. */}
      <SheetContent side="bottom" className="rounded-t-2xl p-0 overflow-hidden" data-testid="saved-options-sheet">
        <div className="max-h-[85vh] overflow-y-auto p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <SheetTitle className="text-sm font-brand uppercase tracking-widest mb-4">
            Saved options
          </SheetTitle>
          {body}
        </div>
      </SheetContent>
    </Sheet>
  );
}
