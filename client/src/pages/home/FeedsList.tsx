import { useMemo, useState, type ReactNode, type RefObject } from "react";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopOptionsPopover } from "@/components/DesktopOptionsPopover";
import {
  BarChart3, Check, ChevronDown, ChevronUp, Download, Flame, Hash, Image as ImageIcon, MoreHorizontal,
  Package, Pencil, Plus, Radio, Share2, Trash2, Users, Video,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { FeedIcon as FeedIconSvg, isValidFeedIconKey } from "@/components/FeedIcons";
import type { NostrCustomFeed } from "@/hooks/use-nostr-feeds";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { feedHasLive, liveNowCount } from "@/lib/feed-live";
import { useFollowedHashtags } from "@/hooks/use-followed-hashtags";
import { PANEL_TITLE } from "./FeedFilter";

type Macro = "photos" | "video" | "polls";

const ROW = "flex w-full items-center gap-3 min-h-[48px] px-2 rounded-lg text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ACTION = "inline-flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30 disabled:pointer-events-none";

/**
 * The Feeds list — what the Feeds tab opens. One plain list to pick from:
 * Photos, Videos, Polls, then the hashtags you follow and the feeds you made,
 * then "Add a feed". Picking a feed switches to it and closes the list.
 *
 * It replaces the "Saved options" panel, which mixed feeds to pick with
 * sort rows, an always-open hashtag form and three create/import buttons.
 * Sorting moved to the filter (the same one every feed uses); managing a feed
 * (edit, share, move, delete) sits behind its own "…"; and everything that
 * adds a feed is under one row.
 */
export function FeedsList({
  open, onOpenChange, anchorRef,
  feedMode, feedStyle, customFeeds,
  onPickMacro, onSelectFeed, onReorder, onShare, onEdit, onDelete,
  onCreate, onFindFeeds, onImport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The Feeds tab: the desktop popover drops from it. */
  anchorRef: RefObject<HTMLElement>;
  feedMode: string;
  feedStyle: "all" | "photos" | "video" | "polls";
  customFeeds: NostrCustomFeed[];
  onPickMacro: (style: Macro) => void;
  onSelectFeed: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onShare: (feed: NostrCustomFeed) => void;
  onEdit: (feed: NostrCustomFeed) => void;
  onDelete: (feed: NostrCustomFeed) => void;
  onCreate: () => void;
  onFindFeeds: () => void;
  onImport: () => void;
}) {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  /** The row whose "…" is open: a feed id, or "#tag". One at a time. */
  const [managing, setManaging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const { hashtags, follow, unfollow, pending, canFollow } = useFollowedHashtags();

  // Live signal from the already-subscribed LiveStatusContext: no new
  // subscriptions. Hashtags are a fallback so topic feeds can light up too.
  const { livePubkeys, getLiveStream } = useLiveStatus();
  const liveHashtags = useMemo(() => {
    const tags = new Set<string>();
    for (const pk of livePubkeys) getLiveStream(pk)?.hashtags?.forEach((t) => tags.add(t.toLowerCase()));
    return tags;
  }, [livePubkeys, getLiveStream]);
  const liveCount = useMemo(() => liveNowCount(customFeeds, livePubkeys), [customFeeds, livePubkeys]);

  const close = () => { setManaging(null); setAdding(false); onOpenChange(false); };
  // Dialogs open after the list has closed, so two overlays never fight for focus.
  const after = (fn: () => void) => { close(); setTimeout(fn, 0); };
  const addHashtag = () => {
    const tag = draft.trim().replace(/^#/, "");
    if (!tag) return;
    follow(tag);
    setDraft("");
  };

  const macros: { key: Macro; label: string; icon: ReactNode }[] = [
    { key: "photos", label: "Photos", icon: <ImageIcon className="w-[18px] h-[18px]" /> },
    { key: "video", label: "Videos", icon: <Video className="w-[18px] h-[18px]" /> },
    { key: "polls", label: "Polls", icon: <BarChart3 className="w-[18px] h-[18px]" /> },
  ];
  const hasOwn = customFeeds.length > 0 || (canFollow && hashtags.length > 0) || liveCount > 0;

  const body = (
    <div data-testid="feeds-list-body">
      <div className="space-y-0.5">
        {macros.map((m) => {
          // No style picked shows photos (feed-menu.ts feedsTabLabel).
          const on = feedMode === "custom_all" && (feedStyle === m.key || (m.key === "photos" && feedStyle === "all"));
          return (
            <button key={m.key} type="button" onClick={() => { onPickMacro(m.key); close(); }} className={ROW} aria-current={on ? "true" : undefined} data-testid={`feeds-pick-${m.key}`}>
              <span className={on ? "text-brand" : "text-muted-foreground"}>{m.icon}</span>
              <span className={`flex-1 text-[15px] ${on ? "font-semibold text-foreground" : "text-foreground/90"}`}>{m.label}</span>
              {on && <Check className="w-4 h-4 text-brand" aria-label="On screen" />}
            </button>
          );
        })}
      </div>

      {hasOwn && (
        <>
          <p className="mt-4 mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Your feeds</p>
          <div className="space-y-0.5">
            {liveCount > 0 && (
              <button type="button" onClick={() => after(() => navigate("/search?tab=live"))} className={ROW} data-testid="feeds-live-now">
                <Radio className="w-[18px] h-[18px] text-red-500 live-dot" />
                <span className="flex-1 text-[15px] text-foreground/90">Live now</span>
                <span className="text-xs font-semibold text-danger dark:text-red-500 tabular-nums">{liveCount}</span>
              </button>
            )}

            {canFollow && hashtags.map((tag) => {
              const key = `#${tag}`;
              return (
                <div key={key} data-testid={`feeds-hashtag-${tag}`}>
                  <div className="flex items-center">
                    <button type="button" onClick={() => after(() => navigate(`/search?tab=hashtags&q=${encodeURIComponent(tag)}`))} className={`${ROW} flex-1 min-w-0`}>
                      <Hash className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-[15px] text-foreground/90">{tag}</span>
                    </button>
                    <button type="button" onClick={() => setManaging(managing === key ? null : key)} className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label={`More for #${tag}`} aria-expanded={managing === key} data-testid={`feeds-more-hashtag-${tag}`}>
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                  {managing === key && (
                    <div className="flex flex-wrap gap-1 pl-9 pb-1">
                      <button type="button" onClick={() => { unfollow(tag); setManaging(null); }} disabled={pending === tag} className={`${ACTION} hover:text-destructive`} data-testid={`feeds-unfollow-${tag}`}>
                        <Trash2 className="w-3.5 h-3.5" /> Unfollow
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {customFeeds.map((cf, i) => {
              const on = feedMode === `custom_${cf.id}`;
              const live = feedHasLive(cf, livePubkeys, liveHashtags);
              return (
                <div key={cf.id} data-testid={`feeds-row-${cf.id}`}>
                  <div className="flex items-center">
                    <button type="button" onClick={() => { onSelectFeed(cf.id); close(); }} className={`${ROW} flex-1 min-w-0`} aria-current={on ? "true" : undefined} data-testid={`feeds-pick-${cf.id}`}>
                      <span className={`shrink-0 ${on ? "text-brand" : "text-muted-foreground"}`}>
                        {isValidFeedIconKey(cf.icon)
                          ? <FeedIconSvg iconKey={cf.icon} className="w-[18px] h-[18px]" />
                          : cf.source === "pack" ? <Users className="w-[18px] h-[18px]" /> : <Flame className="w-[18px] h-[18px]" />}
                      </span>
                      <span className={`flex-1 min-w-0 truncate text-[15px] ${on ? "font-semibold text-foreground" : "text-foreground/90"}`}>{cf.name}</span>
                      {live && <span className="w-2 h-2 rounded-full bg-red-500 live-dot shrink-0" title="Someone in this feed is live" />}
                      {on && <Check className="w-4 h-4 text-brand shrink-0" aria-label="On screen" />}
                    </button>
                    <button type="button" onClick={() => setManaging(managing === cf.id ? null : cf.id)} className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label={`More for ${cf.name}`} aria-expanded={managing === cf.id} data-testid={`feeds-more-${cf.id}`}>
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                  {managing === cf.id && (
                    <div className="flex flex-wrap gap-1 pl-9 pb-1" data-testid={`feeds-manage-${cf.id}`}>
                      <button type="button" onClick={() => after(() => onEdit(cf))} className={ACTION} data-testid={`feeds-edit-${cf.id}`}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                      <button type="button" onClick={() => after(() => onShare(cf))} className={ACTION} data-testid={`feeds-share-${cf.id}`}><Share2 className="w-3.5 h-3.5" /> Share</button>
                      {customFeeds.length > 1 && (
                        <>
                          <button type="button" onClick={() => onReorder(i, i - 1)} disabled={i === 0} className={ACTION} aria-label={`Move ${cf.name} up`} data-testid={`feeds-up-${cf.id}`}><ChevronUp className="w-3.5 h-3.5" /> Up</button>
                          <button type="button" onClick={() => onReorder(i, i + 1)} disabled={i === customFeeds.length - 1} className={ACTION} aria-label={`Move ${cf.name} down`} data-testid={`feeds-down-${cf.id}`}><ChevronDown className="w-3.5 h-3.5" /> Down</button>
                        </>
                      )}
                      <button type="button" onClick={() => after(() => onDelete(cf))} className={`${ACTION} hover:text-destructive`} data-testid={`feeds-delete-${cf.id}`}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-3 pt-3 border-t border-border/60 dark:border-white/[0.07]">
        <button type="button" onClick={() => setAdding(!adding)} className={`${ROW} text-brand`} aria-expanded={adding} data-testid="feeds-add">
          <Plus className="w-[18px] h-[18px]" />
          <span className="flex-1 text-[15px] font-medium">Add a feed</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${adding ? "rotate-180" : ""}`} />
        </button>
        {adding && (
          <div className="mt-1 space-y-0.5 pl-2" data-testid="feeds-add-choices">
            <button type="button" onClick={() => after(onCreate)} className={ROW} data-testid="feeds-add-create">
              <Pencil className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1"><span className="block text-sm text-foreground/90">Make your own</span><span className="block text-xs text-muted-foreground">Pick hashtags, people or words</span></span>
            </button>
            <button type="button" onClick={() => after(onFindFeeds)} className={ROW} data-testid="feeds-add-find">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1"><span className="block text-sm text-foreground/90">Find feeds</span><span className="block text-xs text-muted-foreground">Ready-made lists of people to read</span></span>
            </button>
            <button type="button" onClick={() => after(onImport)} className={ROW} data-testid="feeds-add-import">
              <Download className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1"><span className="block text-sm text-foreground/90">Import a feed</span><span className="block text-xs text-muted-foreground">Paste one someone shared with you</span></span>
            </button>
            {canFollow && (
              <div className="flex items-center gap-1.5 px-2 pt-1.5" data-testid="feeds-add-hashtag">
                <div className="relative flex-1">
                  <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.replace(/\s+/g, ""))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHashtag(); } }}
                    placeholder="Follow a hashtag"
                    aria-label="Follow a hashtag"
                    className="h-11 pl-8 text-sm"
                    data-testid="input-follow-hashtag"
                  />
                </div>
                <button type="button" onClick={addHashtag} disabled={!draft.trim() || !!pending} className="shrink-0 min-h-[44px] px-3 rounded-lg text-sm font-medium border border-brand/30 bg-brand/10 text-brand hover:bg-brand/15 transition-colors disabled:opacity-40" data-testid="button-add-followed-hashtag">
                  Follow
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const onChange = (o: boolean) => { if (!o) { setManaging(null); setAdding(false); } onOpenChange(o); };

  if (!isMobile) {
    return (
      <DesktopOptionsPopover open={open} onOpenChange={onChange} anchorRef={anchorRef} align="end" title="Feeds" titleClassName={PANEL_TITLE} testId="feeds-list" width="w-[340px]">
        {body}
      </DesktopOptionsPopover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onChange}>
      {/* Scrolling lives on an INNER wrapper, not on SheetContent: iOS WebKit
          can fail to paint the background of a scrollable element inside the
          transformed, fixed slide-up sheet (seen on-device with the old tall
          Saved sheet). */}
      <SheetContent side="bottom" className="rounded-t-2xl p-0 overflow-hidden" data-testid="feeds-list">
        <div className="max-h-[85vh] overflow-y-auto p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <SheetTitle className={PANEL_TITLE}>Feeds</SheetTitle>
          {body}
        </div>
      </SheetContent>
    </Sheet>
  );
}
