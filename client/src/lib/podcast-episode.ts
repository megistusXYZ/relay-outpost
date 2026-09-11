/**
 * An episode as the player plays it: one builder for every place News plays a
 * podcast episode (the reader, a show's episode list, the add dialog's
 * preview, the Listen lane). The id is "rss-" plus the encoded audio URL, and
 * "resume where you left off" is saved under it, so it must never change.
 * See podcast-episode.test.ts.
 */
import type { MusicTrack } from "./music";
import { feedSupportsValue, type PodcastFeed } from "./podcast-index";
import type { SavedFeed } from "./rss-feeds";

/**
 * Follow a show from Podcast Index: the source it saves, the same whether it
 * was followed from the add dialog or from the Listen lane's suggestions. It
 * is filed under "Podcast", so it lands in your Listen lane (laneOf in
 * lib/news-library.ts), with its art, author and ⚡ support kept.
 */
export function podcastFeedToSaved(feed: PodcastFeed): SavedFeed {
  return {
    name: feed.title,
    url: feed.url,
    category: "Podcast",
    feedImage: feed.image || undefined,
    author: feed.author || undefined,
    v4v: feedSupportsValue(feed) || undefined,
  };
}

/** The episode fields the player uses (an RSS item or a Podcast Index episode). */
export interface EpisodeInput {
  title?: string;
  audioUrl?: string;
  pubDate?: string;
  /** Seconds. */
  duration?: number;
  description?: string;
  thumbnail?: string;
  author?: string;
  transcriptUrl?: string;
  transcriptType?: string;
  chaptersUrl?: string;
}

/** The show an episode belongs to. */
export interface ShowInput {
  title?: string;
  author?: string;
  image?: string;
}

export function episodeTrack(episode: EpisodeInput, show: ShowInput): MusicTrack | null {
  if (!episode.audioUrl) return null;
  const published = Date.parse(episode.pubDate || "");
  return {
    id: `rss-${encodeURIComponent(episode.audioUrl)}`,
    title: episode.title || "Untitled Episode",
    artist: episode.author || show.author || show.title || "Podcast",
    artistPubkey: "",
    audioUrl: episode.audioUrl,
    coverUrl: episode.thumbnail || show.image || "",
    description: episode.description || "",
    genre: "Podcast",
    duration: episode.duration || 0,
    createdAt: Number.isFinite(published) ? Math.floor(published / 1000) : 0,
    source: "podcast",
    albumTitle: show.title || undefined,
    transcriptUrl: episode.transcriptUrl || undefined,
    transcriptType: episode.transcriptType || undefined,
    chaptersUrl: episode.chaptersUrl || undefined,
  };
}
