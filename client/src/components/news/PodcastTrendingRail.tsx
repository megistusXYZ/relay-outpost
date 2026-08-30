import { useState } from "react";
import { Play, Pause, Podcast, Loader2 } from "lucide-react";
import { usePodcastTrending } from "@/hooks/use-podcast-index";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useToast } from "@/hooks/use-toast";
import type { MusicTrack } from "@/lib/music";
import type { PodcastFeed } from "@/lib/podcast-index";

/**
 * "Trending podcasts" rail for the trending news page. Shows trending shows from
 * Podcast Index; tapping plays the show's LATEST episode in the app's own audio
 * player — no external redirect, the deferred blocker that's since been lifted
 * (in-app player + /api/podcastindex/trending both exist now).
 *
 * Reach-honest: renders nothing until real feeds arrive, so an unreachable
 * Podcast Index (or an unconfigured key → the endpoint 503s) simply omits the
 * rail rather than showing an empty shell.
 */

function proxied(url: string): string {
  return `/api/rss/image-proxy?url=${encodeURIComponent(url)}`;
}

interface RssItem {
  title?: string;
  guid?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  thumbnail?: string;
  audioUrl?: string;
  duration?: number;
  transcriptUrl?: string;
  transcriptType?: string;
  chaptersUrl?: string;
}

export function PodcastTrendingRail({ enabled = true }: { enabled?: boolean }) {
  const { feeds, isLoading } = usePodcastTrending(null, 12, enabled);
  const { play, currentTrack, isPlaying, togglePlay } = useAudioPlayer();
  const { toast } = useToast();
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const isCurrentFeed = (feed: PodcastFeed) =>
    !!currentTrack?.id && currentTrack.id.startsWith(`podcast-trending-${feed.id}-`);

  const playFeed = async (feed: PodcastFeed) => {
    // Already this show's episode in the player → just toggle, don't re-fetch.
    if (isCurrentFeed(feed)) {
      togglePlay();
      return;
    }
    setLoadingId(feed.id);
    try {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(feed.url)}`);
      if (!res.ok) throw new Error("feed unreachable");
      const data = (await res.json()) as { items?: RssItem[] };
      const ep = (data.items ?? []).find((it) => it.audioUrl);
      if (!ep?.audioUrl) {
        toast({ title: "Nothing to play yet", description: "This show didn't return a playable episode.", variant: "destructive" });
        return;
      }
      const track: MusicTrack = {
        id: `podcast-trending-${feed.id}-${encodeURIComponent(ep.audioUrl)}`,
        title: ep.title || feed.title || "Untitled Episode",
        artist: feed.author || feed.title || "Podcast",
        artistPubkey: "",
        audioUrl: ep.audioUrl,
        coverUrl: ep.thumbnail || feed.image || "",
        description: ep.description || "",
        genre: "Podcast",
        duration: ep.duration || 0,
        createdAt: ep.pubDate ? Math.floor(new Date(ep.pubDate).getTime() / 1000) : 0,
        source: "podcast",
        albumTitle: feed.title || undefined,
        transcriptUrl: ep.transcriptUrl,
        transcriptType: ep.transcriptType,
        chaptersUrl: ep.chaptersUrl,
      };
      play(track);
    } catch {
      toast({ title: "Couldn't load episode", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setLoadingId(null);
    }
  };

  if (!enabled) return null;

  if (isLoading) {
    return (
      <section className="mb-4" data-testid="podcast-rail-loading" aria-hidden>
        <div className="flex items-center gap-2 mb-2">
          <Podcast className="w-4 h-4 text-muted-foreground/50" />
          <span className="text-sm font-semibold text-muted-foreground/50">Trending podcasts</span>
        </div>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-28 shrink-0">
              <div className="w-28 h-28 rounded-xl bg-muted/40 animate-pulse" />
              <div className="h-3 mt-2 w-24 rounded bg-muted/40 animate-pulse" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (feeds.length === 0) return null;

  return (
    <section className="mb-4" aria-label="Trending podcasts" data-testid="podcast-trending-rail">
      <div className="flex items-center gap-2 mb-2">
        <Podcast className="w-4 h-4 text-brand" />
        <span className="text-sm font-semibold">Trending podcasts</span>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
        {feeds.map((feed) => {
          const current = isCurrentFeed(feed);
          const busy = loadingId === feed.id;
          return (
            <button
              key={feed.id}
              type="button"
              onClick={() => playFeed(feed)}
              disabled={busy}
              className="w-28 shrink-0 text-left group focus:outline-none"
              data-testid={`podcast-rail-card-${feed.id}`}
              title={`${feed.title}${feed.author ? ` — ${feed.author}` : ""}`}
              aria-label={`Play latest episode of ${feed.title}`}
            >
              <div className="relative w-28 h-28 rounded-xl overflow-hidden ring-1 ring-border/20 bg-muted/30 group-focus-visible:ring-2 group-focus-visible:ring-brand/50">
                {feed.image && (
                  <img
                    src={proxied(feed.image)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm text-white transition-transform group-hover:scale-105">
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : current && isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-[1px]" />}
                  </span>
                </span>
                {current && <span className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-black/40" />}
              </div>
              <span className="block mt-1.5 text-xs font-medium leading-snug line-clamp-2">{feed.title}</span>
              {feed.author && <span className="block text-[11px] text-muted-foreground line-clamp-1">{feed.author}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
