/**
 * The identity layout's MAIN column — the antidote to "a profile is just a
 * scrolling feed." It opens with the person's EXPRESSION (a visual media
 * montage) and then presents ONE unified activity stream you lightly filter
 * (All · Media · Replies), instead of four separate tabs to hop between.
 *
 * Reuses the profile page's already-loaded data (allNotes / replyNotes /
 * mediaUrls) and the shared NostrPost renderer — no data-layer fork.
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { nip19, type Event } from "nostr-tools";
import { useLocation } from "wouter";
import { NostrPost } from "@/components/NostrPost";
import { KIND_LONG_FORM } from "@/lib/nip23";
import { BookOpen } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import { IdentityPresence, rankTopics } from "@/components/profile/IdentityPresence";
import { ImageLightbox } from "@/components/ImageLightbox";
import { VideoChannelTheater } from "@/components/VideoChannelTheater";
import { LazyVideoPoster } from "@/components/LazyVideoPoster";
import { getOptimizedImageUrl } from "@/lib/nostr-helpers";
import { isVideoMedia } from "@/lib/media-frame";
import { mergeProfileStream } from "@/lib/profile-stream";
import { chipDimmed } from "@/lib/profile-chips";
import { Play } from "lucide-react";
import { Images } from "lucide-react";

/**
 * The chip row IS the filter — there is no second control nested inside "All".
 * A sub-filter under All would have re-offered Replies and Media, which are
 * already chips; the thing genuinely missing was originals-only, so that became
 * a chip too rather than a mode inside another mode.
 */
type StreamFilter = "all" | "posts" | "replies" | "articles" | "media";

/** Videos render as a poster + ▶ in the montage; images as <img>. */

/** Time "chapter" a post belongs to — turns the stream into a story with
 *  headings (Today / This week / …) instead of undifferentiated scroll. */
function timeChapter(ts: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  if (diffDays < 31) return "This month";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function IdentityProfileMain({
  allNotes,
  replyNotes,
  repostedEvents,
  articleEvents,
  mediaUrls,
  mediaMeta,
  repostMap,
  notesLoaded,
  articlesLoaded,
  onLoadMore,
  hasMore,
  loadingMore,
  stats,
  mediaSlot,
  onSelectMedia,
  articlesSlot,
  onSelectArticles,
  onSeeNetwork,
}: {
  allNotes: Event[];
  replyNotes: Event[];
  /**
   * The ORIGINALS this person reposted (kind-6 resolution, other authors).
   * Passed separately because `allNotes` is the eventStore timeline filtered
   * on `authors: [pubkey]` — a reposted original structurally cannot be in it.
   * The first version of this skin filtered reposts OUT of Posts via repostMap
   * while receiving a list that never contained them, so reposts were simply
   * absent from every chip and nobody's repost activity showed at all.
   */
  repostedEvents?: Event[];
  /**
   * The person's long-form articles (kind 30023), folded into the All stream
   * in timeline order. Addressable editions are deduped here by d-tag (newest
   * wins) — the raw fetch can return several versions of one article.
   */
  articleEvents?: Event[];
  mediaUrls: string[];
  /** Declared media type + poster, keyed by url (see Profile's MediaMeta). */
  mediaMeta?: Record<string, { poster?: string; isVideo?: boolean }>;
  repostMap?: Map<string, { pubkey: string; timestamp: number }>;
  notesLoaded: boolean;
  /** The articles fetch ANSWERED (identity layout eager-loads it) — gates the
   *  Articles chip's confirmed-empty dim; unknown must never dim. */
  articlesLoaded?: boolean;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  stats?: { following?: number; followers?: number; totalPosts?: number; totalReplies?: number; totalArticles?: number; joinedAt?: number; lastActiveAt?: number };
  /** The full media browser (photos · videos · audio · live · articles) — the
   *  classic MediaSection with its own sub-tabs, rendered under the Media chip. */
  mediaSlot?: ReactNode;
  onSelectMedia?: () => void;
  /**
   * Long-form writing, as its OWN chip rather than a sub-tab three levels down.
   * It was buried inside Media → Articles, which put an 11-article body of work
   * behind two taps and grouped writing with photos and audio because they all
   * happened to be "not a note". Someone who writes is here to be read.
   */
  articlesSlot?: ReactNode;
  onSelectArticles?: () => void;
  /** Opens the following/followers list from the headline counts. */
  onSeeNetwork?: () => void;
}) {
  const [filter, setFilter] = useState<StreamFilter>("all");
  // Montage = a VISUAL glance: photos + video posters, in post order. Tapping a
  // photo opens the gallery lightbox at that photo; tapping a video opens the
  // channel-surf theater at that video. (Audio/articles aren't visual-glance
  // content — they live under the Media chip's sub-tabs.)
  const montageMedia = useMemo(() => mediaUrls.slice(0, 14), [mediaUrls]);
  // Topics the person actually posts about — top recurring hashtags across their
  // loaded notes (fades away entirely for people who don't tag).
  const topics = useMemo(() => rankTopics(allNotes), [allNotes]);
  const montageImages = useMemo(() => mediaUrls.filter((u) => !isVideoMedia(u, mediaMeta?.[u])), [mediaUrls, mediaMeta]);
  const montageVideos = useMemo(() => mediaUrls.filter((u) => isVideoMedia(u, mediaMeta?.[u])), [mediaUrls, mediaMeta]);
  const [montageLightbox, setMontageLightbox] = useState<number | null>(null);
  const [montageVideoStart, setMontageVideoStart] = useState<number | null>(null);

  const filters: { key: StreamFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "posts", label: "Posts" },
    { key: "replies", label: "Replies" },
    // Between Replies and Media: the chips run from most conversational to most
    // visual, and articles sit exactly there.
    ...(articlesSlot !== undefined ? [{ key: "articles" as const, label: "Articles" }] : []),
    { key: "media", label: "Media" },
  ];

  const selectFilter = (key: StreamFilter) => {
    // Both of these are lazy: nothing fetches audio or long-form until the chip
    // that shows it is tapped.
    if (key === "media") onSelectMedia?.();
    if (key === "articles") onSelectArticles?.();
    setFilter(key);
  };

  // Reposts belong in All AND Posts (owner call 2026-08-08, matching the
  // classic skin and every mainstream timeline): a repost is something this
  // person chose to put on their page, timed by WHEN THEY REPOSTED it
  // (repostMap timestamp), not by when the original was written — an old
  // article reposted today reads as today's activity. Replies stay their own
  // chip. Dedup guards the self-repost case (reposting your own note).
  const replyIds = useMemo(() => new Set(replyNotes.map((e) => e.id)), [replyNotes]);
  // Articles join the timeline at their created_at, deduped by d-tag (an
  // addressable event can arrive as several editions — newest wins). Presorted
  // here because mergeProfileStream returns its first argument UNTOUCHED when
  // there are no reposts.
  const ownWithArticles = useMemo(() => {
    if (!articleEvents?.length) return allNotes;
    const byD = new Map<string, Event>();
    for (const a of articleEvents) {
      const d = a.tags.find((t) => t[0] === "d")?.[1] ?? a.id;
      const prev = byD.get(d);
      if (!prev || a.created_at > prev.created_at) byD.set(d, a);
    }
    return [...allNotes, ...byD.values()].sort((a, b) => b.created_at - a.created_at);
  }, [allNotes, articleEvents]);
  const merged = useMemo(
    () => mergeProfileStream(ownWithArticles, repostedEvents ?? [], repostMap),
    [ownWithArticles, repostedEvents, repostMap],
  );
  const stream = useMemo(() => {
    if (filter === "replies") return replyNotes;
    // Posts keeps notes + reposts but not articles — writing has its own chip,
    // and duplicating it in two filters makes neither mean anything.
    if (filter === "posts") return merged.filter((e) => !replyIds.has(e.id) && e.kind !== KIND_LONG_FORM);
    return merged;
  }, [filter, merged, replyNotes, replyIds]);

  return (
    <div className="min-w-0">
      {/* Presence — a calm, human read of who this person is: activity status,
          tenure, what they post about, and quiet lifetime totals. Deliberately
          NOT a posts-per-week / contribution-graph dashboard. */}
      <IdentityPresence
        following={stats?.following}
        followers={stats?.followers}
        totalPosts={stats?.totalPosts}
        totalReplies={stats?.totalReplies}
        totalArticles={stats?.totalArticles}
        joinedAt={stats?.joinedAt}
        lastActiveAt={stats?.lastActiveAt ?? (allNotes.length ? Math.max(...allNotes.map((e) => e.created_at)) : undefined)}
        topics={topics}
        onSeeNetwork={onSeeNetwork}
      />

      {/* Media montage — the page leads with what they MAKE, not a text wall.
          Inset to the same gutter every card in this column uses for its own
          content: this section has no card around it, so without the padding it
          sat 13px left of the Details and Circle text above it and the post text
          below it — three different left edges down one scroll. */}
      {montageMedia.length > 0 && (
        <section className="mb-4 px-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Images className="w-3.5 h-3.5" /> Media
            </h2>
            <button onClick={() => selectFilter("media")} className="text-[11px] text-brand hover:underline" data-testid="identity-montage-all">See all</button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {montageMedia.map((url, i) => {
              const isVid = isVideoMedia(url, mediaMeta?.[url]);
              return (
                <button
                  key={`${url}-${i}`}
                  onClick={() => isVid ? setMontageVideoStart(montageVideos.indexOf(url)) : setMontageLightbox(montageImages.indexOf(url))}
                  className="group/thumb relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-border/40 bg-muted/20 hover:ring-2 hover:ring-primary/30 transition-shadow"
                  data-testid="identity-montage-thumb"
                >
                  {isVid ? (
                    <>
                      {/* Poster only — lazy-mounts near the viewport so a video-heavy
                          profile never spins up dozens of decoders at once. */}
                      {mediaMeta?.[url]?.poster ? (
                        // The event handed us a poster; no decoder needed.
                        <img src={mediaMeta[url].poster} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      ) : (
                        <LazyVideoPoster src={url} className="w-full h-full" />
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover/thumb:bg-black/10 transition-colors">
                        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm">
                          <Play className="w-3.5 h-3.5 text-white ml-0.5" />
                        </span>
                      </span>
                    </>
                  ) : (
                    <img src={getOptimizedImageUrl(url, 256) || url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.closest("button") as HTMLElement).style.display = "none"; }} />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {montageLightbox !== null && (
        <ImageLightbox
          images={montageImages.map((src) => ({ src }))}
          startIndex={montageLightbox}
          onClose={() => setMontageLightbox(null)}
          testIdPrefix="montage-lightbox"
        />
      )}

      {montageVideoStart !== null && (
        <VideoChannelTheater
          urls={montageVideos}
          startIndex={montageVideoStart}
          onClose={() => setMontageVideoStart(null)}
        />
      )}

      {/* One stream, lightly filtered. Same inset as the montage above and the
          card text either side of it.
          Scrolls rather than wraps: five chips need 351px and a 375px phone
          offers 316, so wrapping put "Media" alone on a second row looking like
          a mistake. Tighter chip padding fits all five on a normal phone; a
          narrower one swipes instead of stacking. */}
      <div className="flex items-center gap-1.5 mb-3 px-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((f) => {
          // Confirmed-empty chips DIM (lib/profile-chips.ts: unknown never
          // dims, data un-dims) but stay tappable — the tap lands on an honest
          // empty state, so a wrong count costs nothing. Selection outranks
          // the dim so the active chip is never ghosted under your finger.
          const evidence = {
            posts: { answered: notesLoaded, count: merged.filter((e) => !replyIds.has(e.id) && e.kind !== KIND_LONG_FORM).length },
            replies: { answered: notesLoaded, count: replyNotes.length },
            articles: { answered: articlesLoaded ?? false, count: articleEvents?.length ?? 0 },
            media: { answered: notesLoaded, count: mediaUrls.length },
          }[f.key as string];
          const dimmed = filter !== f.key && chipDimmed(f.key, evidence);
          return (
            <button
              key={f.key}
              onClick={() => selectFilter(f.key)}
              className={`h-8 shrink-0 px-2.5 rounded-full text-xs font-medium transition-colors ${filter === f.key ? "bg-primary text-primary-foreground" : dimmed ? "bg-muted/15 text-muted-foreground/45 hover:bg-muted/30 hover:text-muted-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}
              title={dimmed ? `No ${f.label.toLowerCase()} yet` : undefined}
              data-dimmed={dimmed || undefined}
              data-testid={`identity-filter-${f.key}`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Media opens the full library (photos · videos · audio · live ·
          articles) via the classic MediaSection's sub-tabs; everything else is
          the note stream, each post its OWN card with breathing room. */}
      {filter === "articles" ? (
        <div>{articlesSlot}</div>
      ) : filter === "media" ? (
        <div>{mediaSlot}</div>
      ) : (
      <div className="flex flex-col gap-3">
        {stream.length === 0 && notesLoaded ? (
          <p className="text-center text-sm text-muted-foreground/60 py-10 rounded-xl border border-border/60 bg-card">
            {filter === "replies" ? "No replies yet." : filter === "posts" ? "No posts yet." : "Nothing here yet."}
          </p>
        ) : (() => {
          let lastChapter = "";
          return stream.map((event) => {
            // A repost's chapter follows its SORT time (when it was reposted)
            // — chaptering by the original's created_at printed "March" above
            // a row sitting at the top of today's stream.
            const chapter = timeChapter(repostMap?.get(event.id)?.timestamp ?? event.created_at);
            const showChapter = chapter !== lastChapter;
            lastChapter = chapter;
            return (
              <Fragment key={event.id}>
                {showChapter && (
                  <div className="flex items-center gap-2.5 pt-2 first:pt-0" data-testid="identity-chapter">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/55">{chapter}</span>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                )}
                <div className="rounded-xl border border-border/60 bg-card overflow-hidden hover:border-border transition-colors">
                  <ErrorBoundary>
                    {event.kind === KIND_LONG_FORM
                      ? <ArticleStreamRow event={event} />
                      : <NostrPost event={event} repostedBy={repostMap?.get(event.id) || null} />}
                  </ErrorBoundary>
                </div>
              </Fragment>
            );
          });
        })()}
        <InfiniteScrollSentinel onLoadMore={onLoadMore} hasMore={hasMore} isLoading={loadingMore} />
      </div>
      )}
    </div>
  );
}

/**
 * A kind-30023 in the All stream: a compact reader card, not a wall of raw
 * markdown — which is exactly what NostrPost would have rendered it as. Links
 * to the real article route; the event is already in hand, so nothing fetches.
 */
function ArticleStreamRow({ event }: { event: Event }) {
  const [, navigate] = useLocation();
  const tagVal = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  const title = tagVal("title") || "Untitled article";
  const image = tagVal("image");
  const summary = (tagVal("summary") || event.content)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_>`~[\]]/g, "")
    .trim()
    .slice(0, 200);
  const publishedAt = Number(tagVal("published_at")) || event.created_at;
  const href = (() => {
    try {
      const identifier = tagVal("d") ?? "";
      return `/articles/${nip19.naddrEncode({ kind: KIND_LONG_FORM, pubkey: event.pubkey, identifier, relays: [] })}`;
    } catch {
      return "#";
    }
  })();
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className="w-full flex items-stretch gap-3 p-4 text-left hover:bg-muted/20 transition-colors"
      data-testid={`identity-article-${event.id.slice(0, 12)}`}
    >
      <span className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand/80 mb-1">
          <BookOpen className="w-3 h-3" />
          Article
        </span>
        <span className="block text-base font-semibold leading-snug line-clamp-2">{title}</span>
        {summary && <span className="mt-1 block text-sm text-muted-foreground line-clamp-2">{summary}</span>}
        <span className="mt-1.5 block text-[11px] text-muted-foreground/70">
          {new Date(publishedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </span>
      {image && (
        <span className="w-24 shrink-0 self-center overflow-hidden rounded-lg bg-muted/30 aspect-[4/3]">
          <img src={image} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
        </span>
      )}
    </button>
  );
}
