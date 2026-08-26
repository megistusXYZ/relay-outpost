import { pool, DEFAULT_RELAYS, throttledPoolSubscribe } from "./nostr";
import {
  KIND_MUSIC_TRACK,
  KIND_WAVLAKE_TRACK,
  KIND_STEMSTR_TRACK,
  MUSIC_RELAYS,
  WAVLAKE_RELAY,
  parseMusicEvent,
  type MusicTrack,
} from "./music";
import type { Event, Filter } from "nostr-tools";

const MUSIC_PRIORITY_RELAYS = [
  WAVLAKE_RELAY,
  "wss://relay.nostr.band",
  "wss://nostr.wine",
];

const AUDIO_RELAYS = Array.from(
  new Set([...MUSIC_PRIORITY_RELAYS, ...MUSIC_RELAYS, ...DEFAULT_RELAYS])
);

const STATUS_RELAYS = [
  WAVLAKE_RELAY,
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
];

const FETCH_TIMEOUT_MS = 4000;
const STATUS_TIMEOUT_MS = 3000;
const AUDIO_NOTES_TIMEOUT_MS = 4000;

const CACHE_TTL_MS = 3 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const musicTrackCache = new Map<string, CacheEntry<MusicTrack[]>>();
const audioNoteCache = new Map<string, CacheEntry<NostrAudioNote[]>>();
const statusCache: CacheEntry<NostrMusicStatus[]> | null = { data: [], timestamp: 0 };
let statusCacheRef = statusCache;

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

const FOUNTAIN_DOMAINS = ["fountain.fm"];
const WAVLAKE_DOMAINS = ["wavlake.com"];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"];

const AUDIO_URL_PATTERNS = [
  /https?:\/\/[^\s]+\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?[^\s]*)?/i,
  /https?:\/\/(www\.)?fountain\.fm\/(episode|show|clip)\/[^\s]+/i,
  /https?:\/\/(www\.)?wavlake\.com\/track\/[^\s]+/i,
  /https?:\/\/(www\.)?wavlake\.com\/[a-f0-9-]+/i,
  /https?:\/\/(www\.)?open\.spotify\.com\/(track|episode)\/[^\s]+/i,
  /https?:\/\/(www\.)?soundcloud\.com\/[^\s]+\/[^\s]+/i,
  /https?:\/\/(www\.)?podcasts?\.apple\.com\/[^\s]+/i,
  /https?:\/\/(www\.)?music\.youtube\.com\/watch\?[^\s]+/i,
  /https?:\/\/(www\.)?tidal\.com\/(track|album)\/[^\s]+/i,
  /https?:\/\/(www\.)?bandcamp\.com\/track\/[^\s]+/i,
  /https?:\/\/[^\s]+\.bandcamp\.com\/track\/[^\s]+/i,
];

export interface NostrAudioNote {
  id: string;
  event: Event;
  content: string;
  audioUrls: string[];
  fountainUrl?: string;
  wavlakeUrl?: string;
  pubkey: string;
  createdAt: number;
  isFountain: boolean;
  isWavlake: boolean;
  isPodcast: boolean;
  platform?: string;
}

function extractAudioUrls(content: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const pattern of AUDIO_URL_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "gi");
    let match;
    while ((match = globalPattern.exec(content)) !== null) {
      const url = match[0].replace(/[)}\]>]+$/, "");
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

function detectPlatform(audioUrls: string[], content: string): string | undefined {
  if (audioUrls.some((u) => u.includes("fountain.fm"))) return "fountain";
  if (audioUrls.some((u) => u.includes("wavlake.com"))) return "wavlake";
  if (audioUrls.some((u) => u.includes("spotify.com"))) return "spotify";
  if (audioUrls.some((u) => u.includes("soundcloud.com"))) return "soundcloud";
  if (audioUrls.some((u) => u.includes("bandcamp.com"))) return "bandcamp";
  if (audioUrls.some((u) => u.includes("tidal.com"))) return "tidal";
  if (audioUrls.some((u) => u.includes("music.youtube.com"))) return "youtube-music";
  if (audioUrls.some((u) => u.includes("apple.com"))) return "apple";
  return undefined;
}

function classifyAudioNote(event: Event): NostrAudioNote | null {
  const content = event.content || "";
  const audioUrls = extractAudioUrls(content);

  const tagUrls = event.tags
    .filter((t) => t[0] === "r" || t[0] === "url" || t[0] === "imeta")
    .map((t) => t[1])
    .filter(Boolean);

  for (const u of tagUrls) {
    if (audioUrls.includes(u)) continue;
    const isAudio = AUDIO_EXTENSIONS.some((ext) => u.toLowerCase().includes(ext)) ||
      FOUNTAIN_DOMAINS.some((d) => u.includes(d)) ||
      WAVLAKE_DOMAINS.some((d) => u.includes(d));
    if (isAudio) audioUrls.push(u);
  }

  const aTags = event.tags.filter((t) => t[0] === "a" && t[1]?.startsWith("32123:"));
  if (aTags.length > 0 && audioUrls.length === 0) {
    audioUrls.push(`nostr:${aTags[0][1]}`);
  }

  if (audioUrls.length === 0) return null;

  const isFountain = audioUrls.some((u) => u.includes("fountain.fm"));
  const isWavlake = audioUrls.some((u) => u.includes("wavlake.com"));
  const contentLower = content.toLowerCase();
  const isPodcast =
    isFountain ||
    audioUrls.some((u) => u.includes("podcast") || u.includes("apple.com")) ||
    contentLower.includes("podcast") ||
    contentLower.includes("episode") ||
    contentLower.includes("new ep") ||
    contentLower.includes("ep drop") ||
    contentLower.includes("latest episode") ||
    event.tags.some((t) => t[0] === "t" && (
      t[1]?.toLowerCase().includes("podcast") ||
      t[1]?.toLowerCase().includes("episode") ||
      t[1]?.toLowerCase() === "pod"
    ));

  const platform = detectPlatform(audioUrls, content);

  return {
    id: event.id,
    event,
    content,
    audioUrls,
    fountainUrl: audioUrls.find((u) => u.includes("fountain.fm")),
    wavlakeUrl: audioUrls.find((u) => u.includes("wavlake.com")),
    pubkey: event.pubkey,
    createdAt: event.created_at,
    isFountain,
    isWavlake,
    isPodcast,
    platform,
  };
}

export async function fetchNostrMusicTracks(
  limit = 50,
  since?: number,
  until?: number
): Promise<MusicTrack[]> {
  const cacheKey = `tracks_${limit}_${since || 0}_${until || 0}`;
  const cached = getCached(musicTrackCache, cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const tracks: MusicTrack[] = [];
    const seen = new Set<string>();
    const timeout = setTimeout(() => {
      sub.close();
      finalize();
    }, FETCH_TIMEOUT_MS);

    function finalize() {
      const sorted = tracks.sort((a, b) => b.createdAt - a.createdAt);
      setCache(musicTrackCache, cacheKey, sorted);
      resolve(sorted);
    }

    const filter: Filter = {
      kinds: [KIND_WAVLAKE_TRACK, KIND_MUSIC_TRACK, KIND_STEMSTR_TRACK],
      limit,
    };
    if (since) filter.since = since;
    if (until) filter.until = until;

    const sub = throttledPoolSubscribe(AUDIO_RELAYS, filter, {
      onevent(event: Event) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        const track = parseMusicEvent(event);
        if (track && track.audioUrl) {
          tracks.push(track);
        }
      },
      oneose() {
        clearTimeout(timeout);
        sub.close();
        finalize();
      },
    });
  });
}

export async function fetchNostrMusicTracksStreaming(
  onBatch: (tracks: MusicTrack[]) => void,
  limit = 50,
  since?: number,
  until?: number
): Promise<MusicTrack[]> {
  const cacheKey = `tracks_stream_${limit}_${since || 0}_${until || 0}`;
  const cached = getCached(musicTrackCache, cacheKey);
  if (cached) {
    onBatch(cached);
    return cached;
  }

  return new Promise((resolve) => {
    const tracks: MusicTrack[] = [];
    const seen = new Set<string>();
    let batchBuffer: MusicTrack[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    function flushBatch() {
      if (batchBuffer.length > 0) {
        onBatch([...batchBuffer]);
        batchBuffer = [];
      }
      batchTimer = null;
    }

    function scheduleBatch() {
      if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, 150);
      }
    }

    const timeout = setTimeout(() => {
      sub.close();
      flushBatch();
      const sorted = tracks.sort((a, b) => b.createdAt - a.createdAt);
      setCache(musicTrackCache, cacheKey, sorted);
      resolve(sorted);
    }, FETCH_TIMEOUT_MS);

    const filter: Filter = {
      kinds: [KIND_WAVLAKE_TRACK, KIND_MUSIC_TRACK, KIND_STEMSTR_TRACK],
      limit,
    };
    if (since) filter.since = since;
    if (until) filter.until = until;

    const sub = throttledPoolSubscribe(AUDIO_RELAYS, filter, {
      onevent(event: Event) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        const track = parseMusicEvent(event);
        if (track && track.audioUrl) {
          tracks.push(track);
          batchBuffer.push(track);
          scheduleBatch();
        }
      },
      oneose() {
        clearTimeout(timeout);
        sub.close();
        flushBatch();
        const sorted = tracks.sort((a, b) => b.createdAt - a.createdAt);
        setCache(musicTrackCache, cacheKey, sorted);
        resolve(sorted);
      },
    });
  });
}

export async function fetchAudioNotes(
  limit = 100,
  since?: number
): Promise<NostrAudioNote[]> {
  const cacheKey = `notes_${limit}_${since || 0}`;
  const cached = getCached(audioNoteCache, cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    const notes: NostrAudioNote[] = [];
    const seen = new Set<string>();
    const timeout = setTimeout(() => {
      sub.close();
      finalize();
    }, AUDIO_NOTES_TIMEOUT_MS);

    function finalize() {
      const sorted = notes.sort((a, b) => b.createdAt - a.createdAt);
      setCache(audioNoteCache, cacheKey, sorted);
      resolve(sorted);
    }

    const filter: Filter = {
      kinds: [1],
      limit,
    };
    if (since) filter.since = since;

    const sub = throttledPoolSubscribe(AUDIO_RELAYS, filter, {
      onevent(event: Event) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        const note = classifyAudioNote(event);
        if (note) {
          notes.push(note);
        }
      },
      oneose() {
        clearTimeout(timeout);
        sub.close();
        finalize();
      },
    });
  });
}

export interface NostrMusicStatus {
  pubkey: string;
  content: string;
  trackInfo?: string;
  expiration?: number;
  createdAt: number;
}

export async function fetchMusicStatuses(limit = 30): Promise<NostrMusicStatus[]> {
  if (statusCacheRef && statusCacheRef.data.length > 0 &&
      Date.now() - statusCacheRef.timestamp < CACHE_TTL_MS) {
    return statusCacheRef.data;
  }

  return new Promise((resolve) => {
    const statuses: NostrMusicStatus[] = [];
    const seen = new Set<string>();
    const timeout = setTimeout(() => {
      sub.close();
      finalize();
    }, STATUS_TIMEOUT_MS);

    function finalize() {
      const sorted = statuses.sort((a, b) => b.createdAt - a.createdAt);
      statusCacheRef = { data: sorted, timestamp: Date.now() };
      resolve(sorted);
    }

    const filter: Filter = {
      kinds: [30315],
      "#d": ["music"],
      limit,
    };

    const sub = throttledPoolSubscribe(STATUS_RELAYS, filter, {
      onevent(event: Event) {
        if (seen.has(event.pubkey)) return;
        seen.add(event.pubkey);
        const expTag = event.tags.find((t) => t[0] === "expiration");
        const expiration = expTag ? parseInt(expTag[1]) : undefined;
        if (expiration && expiration < Math.floor(Date.now() / 1000)) return;

        statuses.push({
          pubkey: event.pubkey,
          content: event.content,
          trackInfo: event.content,
          expiration,
          createdAt: event.created_at,
        });
      },
      oneose() {
        clearTimeout(timeout);
        sub.close();
        finalize();
      },
    });
  });
}

export function subscribeToNostrMusic(
  onTrack: (track: MusicTrack) => void,
  limit = 20
): () => void {
  const seen = new Set<string>();
  const filter: Filter = {
    kinds: [KIND_WAVLAKE_TRACK, KIND_MUSIC_TRACK, KIND_STEMSTR_TRACK],
    limit,
    since: Math.floor(Date.now() / 1000) - 3600,
  };

  const sub = throttledPoolSubscribe(AUDIO_RELAYS, filter, {
    onevent(event: Event) {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      const track = parseMusicEvent(event);
      if (track && track.audioUrl) {
        onTrack(track);
      }
    },
  });

  return () => sub.close();
}

export function clearMusicCache(): void {
  musicTrackCache.clear();
  audioNoteCache.clear();
  statusCacheRef = { data: [], timestamp: 0 };
}
