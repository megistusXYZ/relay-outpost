import type { Event, Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { clientTags } from "./nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";

export const KIND_MUSIC_TRACK = 31337;
export const KIND_WAVLAKE_TRACK = 32123;
export const KIND_STEMSTR_TRACK = 1808;
export const MUSIC_KINDS = [KIND_MUSIC_TRACK, KIND_WAVLAKE_TRACK, KIND_STEMSTR_TRACK];

export const WAVLAKE_RELAY = "wss://relay.wavlake.com";

export const STEMSTR_RELAY = "wss://relay.stemstr.app";

export const MUSIC_RELAYS = [
  WAVLAKE_RELAY,
  STEMSTR_RELAY,
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.wine",
  "wss://relay.snort.social",
  "wss://nostr-01.yakihonne.com",
];

export interface ZapSplitRecipient {
  name: string;
  pubkey?: string;
  address?: string;
  split: number;
  type?: string;
}

export interface MusicTrack {
  id: string;
  event?: Event;
  title: string;
  artist: string;
  artistPubkey: string;
  artistId?: string;
  audioUrl: string;
  coverUrl: string;
  description: string;
  genre: string;
  duration: number;
  createdAt: number;
  wavlakeUrl?: string;
  albumTitle?: string;
  artistAvatarUrl?: string;
  /** Podcasting 2.0 `podcast:transcript` file URL (SRT/VTT/JSON), when the feed provides one. */
  transcriptUrl?: string;
  /** Declared mime type of the transcript file. */
  transcriptType?: string;
  /** Podcasting 2.0 `podcast:chapters` JSON URL, when the feed provides one. */
  chaptersUrl?: string;
  zapSplits?: ZapSplitRecipient[];
  source?: "wavlake" | "zapstr" | "nostr" | "catalog" | "relay-outpost" | "podcast";
  version?: string;
  colorInfo?: {
    muted?: string;
    vibrant?: string;
    darkMuted?: string;
    lightMuted?: string;
    darkVibrant?: string;
    lightVibrant?: string;
  };
}

export interface WavlakeArtist {
  id: string;
  name: string;
  artworkUrl: string;
  artistUrl: string;
  bio: string;
  verified: boolean;
  npub: string;
  twitter?: string;
  instagram?: string;
  youtube?: string;
  website?: string;
  topTracks?: WavlakeCatalogTrack[];
  topAlbums?: WavlakeAlbum[];
}

export interface WavlakeAlbum {
  id: string;
  title: string;
  artworkUrl: string;
  artistId: string;
  description: string;
  genreId?: number;
  msatTotal?: string;
}

export interface WavlakeSearchResult {
  id: string;
  type: "artist" | "album" | "track";
  name?: string;
  title?: string;
  url?: string;
  avatarUrl?: string;
  artworkUrl?: string;
  artist?: string;
  artistUrl?: string;
  liveUrl?: string;
  duration?: number;
  albumTitle?: string;
  genreId?: number;
  colorInfo?: Record<string, string>;
}

const WAVLAKE_CATALOG_BASE = "https://catalog.wavlake.com/v1";

interface WavlakeCatalogTrack {
  id: string;
  title: string;
  artist: string;
  artistUrl: string;
  artistId: string;
  avatarUrl: string;
  artworkUrl: string;
  albumTitle: string;
  albumId: string;
  liveUrl: string;
  duration: number;
  createdAt: string;
  genreId?: number;
  subgenreId?: number;
  msatTotal?: string;
  hasPromo?: boolean;
  ranking?: string;
  colorInfo?: {
    muted?: string;
    vibrant?: string;
    darkMuted?: string;
    lightMuted?: string;
    darkVibrant?: string;
    lightVibrant?: string;
  };
}

function wavlakeTrackToMusicTrack(t: WavlakeCatalogTrack): MusicTrack {
  return {
    id: t.id,
    title: t.title || "Untitled Track",
    artist: t.artist || "Unknown Artist",
    artistPubkey: "",
    artistId: t.artistId || undefined,
    audioUrl: t.liveUrl || "",
    coverUrl: t.artworkUrl || "",
    description: "",
    genre: getGenreName(t.genreId),
    duration: t.duration || 0,
    createdAt: t.createdAt ? Math.floor(new Date(t.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
    wavlakeUrl: t.id ? `https://wavlake.com/track/${t.id}` : undefined,
    albumTitle: t.albumTitle || undefined,
    artistAvatarUrl: t.avatarUrl || undefined,
    colorInfo: t.colorInfo || undefined,
  };
}

const GENRE_MAP: Record<number, string> = {
  1: "Pop",
  2: "Rock",
  3: "Hip-Hop",
  4: "Electronic",
  5: "Country",
  6: "R&B",
  7: "Jazz",
  8: "Classical",
  9: "Reggae",
  10: "Blues",
  11: "Folk",
  12: "Latin",
  13: "Metal",
  14: "Punk",
  15: "Indie",
  16: "Alternative",
  17: "World",
  18: "Ambient",
  19: "Lo-fi",
  20: "Podcast",
};

export const BROWSE_GENRES = [
  { label: "Rock", searchTerm: "rock", icon: "guitar" },
  { label: "Hip-Hop", searchTerm: "hip hop", icon: "mic" },
  { label: "Electronic", searchTerm: "electronic", icon: "zap" },
  { label: "Jazz", searchTerm: "jazz", icon: "music" },
  { label: "Ambient", searchTerm: "ambient", icon: "cloud" },
  { label: "Folk", searchTerm: "folk", icon: "leaf" },
  { label: "Country", searchTerm: "country", icon: "sun" },
  { label: "Classical", searchTerm: "classical", icon: "piano" },
  { label: "Metal", searchTerm: "metal", icon: "flame" },
  { label: "Indie", searchTerm: "indie", icon: "star" },
  { label: "Lo-fi", searchTerm: "lofi", icon: "headphones" },
  { label: "Podcast", searchTerm: "podcast", icon: "radio" },
  { label: "Blues", searchTerm: "blues", icon: "sunset" },
  { label: "Reggae", searchTerm: "reggae", icon: "palmtree" },
  { label: "Latin", searchTerm: "latin", icon: "flame" },
  { label: "R&B", searchTerm: "r&b", icon: "heart" },
] as const;

function getGenreName(genreId?: number): string {
  if (!genreId) return "";
  return GENRE_MAP[genreId] || "";
}

export async function fetchWavlakeNewTracks(): Promise<MusicTrack[]> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/tracks/new`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data)) return [];
    return json.data
      .filter((t: WavlakeCatalogTrack) => t.liveUrl)
      .map(wavlakeTrackToMusicTrack);
  } catch (err) {
    console.error("Failed to fetch Wavlake new tracks:", err);
    return [];
  }
}

export async function fetchWavlakeFeaturedTracks(): Promise<MusicTrack[]> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/tracks/featured`);
    if (!res.ok) return fetchWavlakeRandomTracks();
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
      return fetchWavlakeRandomTracks();
    }
    return json.data
      .filter((t: WavlakeCatalogTrack) => t.liveUrl)
      .map(wavlakeTrackToMusicTrack);
  } catch (err) {
    console.error("Failed to fetch Wavlake featured tracks:", err);
    return fetchWavlakeRandomTracks();
  }
}

export async function fetchWavlakeRandomTracks(): Promise<MusicTrack[]> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/tracks/random`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data)) return [];
    return json.data
      .filter((t: WavlakeCatalogTrack) => t.liveUrl)
      .map(wavlakeTrackToMusicTrack);
  } catch (err) {
    console.error("Failed to fetch Wavlake random tracks:", err);
    return [];
  }
}


export async function fetchWavlakeTrendingTracks(): Promise<MusicTrack[]> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/tracks/top`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data)) return [];
    return json.data
      .filter((t: WavlakeCatalogTrack) => t.liveUrl)
      .map(wavlakeTrackToMusicTrack);
  } catch {
    return [];
  }
}

export async function searchWavlake(term: string): Promise<WavlakeSearchResult[]> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/search?term=${encodeURIComponent(term)}`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data)) return [];
    return json.data;
  } catch (err) {
    console.error("Failed to search Wavlake:", err);
    return [];
  }
}

export async function searchWavlakeTracks(term: string): Promise<MusicTrack[]> {
  const results = await searchWavlake(term);
  return results
    .filter((item) => item.type === "track" && item.liveUrl)
    .map((t) => ({
      id: t.id,
      title: t.title || t.name || "Untitled Track",
      artist: t.artist || "Unknown Artist",
      artistPubkey: "",
      audioUrl: t.liveUrl || "",
      coverUrl: t.artworkUrl || "",
      description: "",
      genre: getGenreName(t.genreId),
      duration: t.duration || 0,
      createdAt: Math.floor(Date.now() / 1000),
      wavlakeUrl: t.id ? `https://wavlake.com/track/${t.id}` : undefined,
      albumTitle: t.albumTitle || undefined,
      artistAvatarUrl: t.avatarUrl || undefined,
    }));
}

export async function fetchWavlakeArtist(artistId: string): Promise<WavlakeArtist | null> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/artists/${artistId}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.data) return null;
    return json.data;
  } catch (err) {
    console.error("Failed to fetch artist:", err);
    return null;
  }
}

export function getArtistTracks(artist: WavlakeArtist): MusicTrack[] {
  if (!artist.topTracks) return [];
  return artist.topTracks
    .filter((t) => t.liveUrl)
    .map(wavlakeTrackToMusicTrack);
}

export function getArtistAlbums(artist: WavlakeArtist): WavlakeAlbum[] {
  return artist.topAlbums || [];
}

export async function fetchWavlakeTrackById(trackId: string): Promise<MusicTrack | null> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/tracks/${trackId}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.data) return null;
    const data = json.data as WavlakeCatalogTrack;
    if (!data.liveUrl) return null;
    return wavlakeTrackToMusicTrack(data);
  } catch {
    return null;
  }
}

export async function fetchWavlakeArtistTopTrackBySlug(slug: string): Promise<MusicTrack | null> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/search?term=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !Array.isArray(json.data)) return null;
    const slugLower = slug.toLowerCase();
    const artist = json.data.find(
      (item: { type?: string; url?: string; id?: string }) =>
        item.type === "artist" && (item.url || "").toLowerCase() === slugLower
    );
    if (!artist?.id) return null;
    const artistRes = await fetch(`${WAVLAKE_CATALOG_BASE}/artists/${artist.id}`);
    if (!artistRes.ok) return null;
    const artistJson = await artistRes.json();
    if (!artistJson.success || !artistJson.data) return null;
    const topTracks = artistJson.data.topTracks;
    if (!Array.isArray(topTracks) || topTracks.length === 0) return null;
    const first = topTracks.find((t: WavlakeCatalogTrack) => t.liveUrl);
    if (!first) return null;
    return wavlakeTrackToMusicTrack(first);
  } catch {
    return null;
  }
}

export async function fetchWavlakeAlbumFirstTrack(albumId: string): Promise<MusicTrack | null> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/albums/${albumId}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.data) return null;
    const album = json.data;
    if (!Array.isArray(album.tracks) || album.tracks.length === 0) return null;
    const first = album.tracks[0];
    if (first.liveUrl) {
      return wavlakeTrackToMusicTrack(first as WavlakeCatalogTrack);
    }
    if (first.id) {
      return await fetchWavlakeTrackById(first.id);
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchAlbumTracks(albumId: string): Promise<MusicTrack[]> {
  try {
    const res = await fetch(`${WAVLAKE_CATALOG_BASE}/albums/${albumId}`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.success || !json.data) return [];
    const album = json.data;
    if (!Array.isArray(album.tracks) || album.tracks.length === 0) return [];

    const hasFullData = album.tracks[0].liveUrl !== undefined;
    if (hasFullData) {
      return album.tracks
        .filter((t: WavlakeCatalogTrack) => t.liveUrl)
        .map(wavlakeTrackToMusicTrack);
    }

    const trackIds: string[] = album.tracks.map((t: { id: string }) => t.id);
    const results = await Promise.allSettled(
      trackIds.map(async (id) => {
        const r = await fetch(`${WAVLAKE_CATALOG_BASE}/tracks/${id}`);
        if (!r.ok) return null;
        const j = await r.json();
        if (!j.success || !j.data) return null;
        return j.data as WavlakeCatalogTrack;
      })
    );
    return results
      .filter((r): r is PromiseFulfilledResult<WavlakeCatalogTrack> => r.status === "fulfilled" && r.value !== null && !!r.value.liveUrl)
      .map((r) => wavlakeTrackToMusicTrack(r.value));
  } catch (err) {
    console.error("Failed to fetch album tracks:", err);
    return [];
  }
}

const wavlakeNpubCache = new Map<string, MusicTrack[]>();
let wavlakeNpubToArtistId: Map<string, string> | null = null;
let wavlakeArtistIdToPubkey: Map<string, string> | null = null;
let wavlakeArtistListPromise: Promise<Map<string, string>> | null = null;

const WAVLAKE_MAP_SESSION_KEY = "wavlake_npub_map";
const WAVLAKE_MAP_TS_KEY = "wavlake_npub_map_ts";
const WAVLAKE_MAP_TTL = 15 * 60 * 1000;

function decodeNpubSafe(npub: string): string {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") return decoded.data;
  } catch {}
  return "";
}

async function getWavlakeNpubMap(): Promise<Map<string, string>> {
  if (wavlakeNpubToArtistId) return wavlakeNpubToArtistId;
  if (wavlakeArtistListPromise) return wavlakeArtistListPromise;

  wavlakeArtistListPromise = (async () => {
    const map = new Map<string, string>();
    const reverseMap = new Map<string, string>();
    try {
      const cached = sessionStorage.getItem(WAVLAKE_MAP_SESSION_KEY);
      const cachedTs = sessionStorage.getItem(WAVLAKE_MAP_TS_KEY);
      if (cached && cachedTs && Date.now() - parseInt(cachedTs) < WAVLAKE_MAP_TTL) {
        const parsed = JSON.parse(cached) as [string, string][];
        for (const [k, v] of parsed) {
          map.set(k, v);
          const hex = decodeNpubSafe(k);
          if (hex) reverseMap.set(v, hex);
        }
        wavlakeNpubToArtistId = map;
        wavlakeArtistIdToPubkey = reverseMap;
        return map;
      }
    } catch {}

    try {
      const res = await fetch(`${WAVLAKE_CATALOG_BASE}/artists`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          for (const a of json.data) {
            if (a.npub && a.npub.startsWith("npub1") && a.id) {
              map.set(a.npub, a.id);
              const hex = decodeNpubSafe(a.npub);
              if (hex) reverseMap.set(a.id, hex);
            }
          }
          if (map.size > 0) {
            wavlakeNpubToArtistId = map;
            wavlakeArtistIdToPubkey = reverseMap;
            try {
              sessionStorage.setItem(WAVLAKE_MAP_SESSION_KEY, JSON.stringify(Array.from(map.entries())));
              sessionStorage.setItem(WAVLAKE_MAP_TS_KEY, String(Date.now()));
            } catch {}
            return map;
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch Wavlake artist list:", err);
    }

    wavlakeArtistListPromise = null;
    return map;
  })();

  return wavlakeArtistListPromise;
}

export function resolveWavlakeArtistPubkey(artistId: string): string {
  return wavlakeArtistIdToPubkey?.get(artistId) || "";
}

export async function ensureWavlakeMapLoaded(): Promise<void> {
  await getWavlakeNpubMap().catch(() => {});
}

export async function fetchWavlakeTracksByNpub(npub: string, pubkey?: string): Promise<MusicTrack[]> {
  if (wavlakeNpubCache.has(npub)) return wavlakeNpubCache.get(npub)!;
  try {
    const npubMap = await getWavlakeNpubMap();
    const artistId = npubMap.get(npub);

    if (!artistId) {
      wavlakeNpubCache.set(npub, []);
      return [];
    }

    const artist = await fetchWavlakeArtist(artistId);
    if (!artist) {
      return [];
    }

    const topTracks = getArtistTracks(artist);
    const albums = getArtistAlbums(artist);

    const albumTrackArrays = await Promise.all(
      albums.map((album) => fetchAlbumTracks(album.id))
    );
    const allAlbumTracks = albumTrackArrays.flat();

    const seen = new Set<string>();
    const merged: MusicTrack[] = [];
    const artistPk = pubkey || "";
    for (const t of [...topTracks, ...allAlbumTracks]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        merged.push({ ...t, source: "catalog", artistPubkey: artistPk });
      }
    }

    merged.sort((a, b) => b.createdAt - a.createdAt);
    wavlakeNpubCache.set(npub, merged);
    return merged;
  } catch (err) {
    console.error("Failed to fetch Wavlake tracks by npub:", err);
    return [];
  }
}

export interface UniqueArtistInfo {
  id: string;
  name: string;
  avatarUrl: string;
  trackCount: number;
  genres: string[];
  hasV4V?: boolean;
}

export function extractUniqueArtists(tracks: MusicTrack[]): UniqueArtistInfo[] {
  const artistMap = new Map<string, UniqueArtistInfo & { genreSet: Set<string> }>();
  for (const track of tracks) {
    const artistKey = track.artistId || (track.artistPubkey ? `pubkey:${track.artistPubkey}` : null);
    if (!artistKey) continue;
    const existing = artistMap.get(artistKey);
    if (existing) {
      existing.trackCount++;
      if (!existing.avatarUrl && track.artistAvatarUrl) {
        existing.avatarUrl = track.artistAvatarUrl;
      }
      if (track.genre) existing.genreSet.add(track.genre);
      if (track.zapSplits && track.zapSplits.length > 0) existing.hasV4V = true;
    } else {
      const genreSet = new Set<string>();
      if (track.genre) genreSet.add(track.genre);
      artistMap.set(artistKey, {
        id: artistKey,
        name: track.artist || "Unknown Artist",
        avatarUrl: track.artistAvatarUrl || track.coverUrl || "",
        trackCount: 1,
        genres: [],
        hasV4V: !!(track.zapSplits && track.zapSplits.length > 0),
        genreSet,
      });
    }
  }
  return Array.from(artistMap.values())
    .map(({ genreSet, ...rest }) => ({ ...rest, genres: Array.from(genreSet) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchPopularArtists(): Promise<UniqueArtistInfo[]> {
  try {
    const [newTracks, randomTracks] = await Promise.all([
      fetchWavlakeNewTracks(),
      fetchWavlakeRandomTracks(),
    ]);
    return extractUniqueArtists([...newTracks, ...randomTracks]);
  } catch {
    return [];
  }
}

function getTagValue(tags: string[][], key: string): string {
  const tag = tags.find((t) => t[0] === key);
  return tag ? tag[1] || "" : "";
}

export function extractZapSplits(event: Event): ZapSplitRecipient[] {
  const splits: ZapSplitRecipient[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "zap" && tag[1]) {
      const pubkey = tag[1];
      const relay = tag[2] || "";
      const weight = tag[3] ? parseFloat(tag[3]) : 1;
      const name = tag[4] || pubkey.slice(0, 8);
      splits.push({ name, pubkey, split: weight, type: "zap" });
    }
    if (tag[0] === "value" && tag[1]) {
      try {
        const val = JSON.parse(tag[1]);
        if (val.recipients && Array.isArray(val.recipients)) {
          for (const r of val.recipients) {
            const splitVal = typeof r.split === "number" ? r.split : (parseFloat(r.split) || 0);
            splits.push({
              name: r.name || r.customKey || "Recipient",
              pubkey: r.address || r.pubkey || "",
              address: r.address || "",
              split: splitVal > 0 ? splitVal : (typeof r.fee === "number" ? r.fee : 1),
              type: r.type || "node",
            });
          }
        }
      } catch {}
    }
  }
  return splits;
}

function parseWavlakeTrack(event: Event): MusicTrack | null {
  try {
    let title = "";
    let artist = "";
    let audioUrl = "";
    let coverUrl = "";
    let description = "";
    let genre = "";
    let wavlakeUrl = "";
    let duration = 0;
    let albumTitle = "";
    let version = "";
    let artistId = "";

    try {
      const nom = JSON.parse(event.content);
      title = nom.title || nom.name || "";
      artist = nom.artist || nom.creator || nom.author || "";
      audioUrl = nom.enclosure || nom.enclosureUrl || nom.media || nom.url || nom.audioUrl || "";
      coverUrl = nom.artworkUrl || nom.image || nom.cover || nom.coverUrl || nom.picture || "";
      description = nom.description || nom.about || "";
      genre = nom.genre || nom.category || "";
      duration = typeof nom.duration === "number" ? nom.duration : (parseInt(nom.duration) || 0);
      wavlakeUrl = nom.link || nom.wavlakeUrl || "";
      albumTitle = nom.album || nom.albumTitle || nom.collection || "";
      version = nom.version || "";
      artistId = nom.artistId || nom.guid || "";
    } catch {
      description = event.content || "";
    }

    if (!title) title = getTagValue(event.tags, "subject") || getTagValue(event.tags, "title") || getTagValue(event.tags, "name") || "";
    if (!artist) {
      artist = getTagValue(event.tags, "artist") || getTagValue(event.tags, "creator") || getTagValue(event.tags, "p") || "";
    }
    if (!audioUrl) {
      const mediaTags = event.tags.filter((t) => t[0] === "media" || t[0] === "url" || t[0] === "streaming" || t[0] === "r");
      for (const mt of mediaTags) {
        const u = mt[1] || "";
        if (u && (u.endsWith(".mp3") || u.endsWith(".wav") || u.endsWith(".ogg") || u.endsWith(".flac") || u.endsWith(".m4a") || u.includes("audio") || u.includes("stream"))) {
          audioUrl = u;
          break;
        }
      }
      if (!audioUrl && mediaTags.length > 0) audioUrl = mediaTags[0][1] || "";
    }
    if (!coverUrl) coverUrl = getTagValue(event.tags, "cover") || getTagValue(event.tags, "image") || getTagValue(event.tags, "thumb") || getTagValue(event.tags, "picture") || "";
    if (!genre) genre = getTagValue(event.tags, "c") || getTagValue(event.tags, "t") || "";
    if (!albumTitle) albumTitle = getTagValue(event.tags, "album") || "";
    if (!wavlakeUrl) {
      const dTag = getTagValue(event.tags, "d");
      if (dTag) wavlakeUrl = `https://wavlake.com/track/${dTag}`;
    }

    if (!audioUrl) return null;

    const zapSplits = extractZapSplits(event);

    return {
      id: event.id,
      event,
      title: title || "Untitled Track",
      artist: artist || "Unknown Artist",
      artistPubkey: event.pubkey,
      artistId: artistId || undefined,
      audioUrl,
      coverUrl,
      description,
      genre,
      duration,
      createdAt: event.created_at,
      wavlakeUrl: wavlakeUrl || undefined,
      albumTitle: albumTitle || undefined,
      zapSplits: zapSplits.length > 0 ? zapSplits : undefined,
      source: "wavlake",
      version: version || undefined,
    };
  } catch {
    return null;
  }
}

function parseZapstrTrack(event: Event): MusicTrack | null {
  try {
    let title = getTagValue(event.tags, "subject") || getTagValue(event.tags, "title") || getTagValue(event.tags, "name") || "";
    let artist = getTagValue(event.tags, "artist") || getTagValue(event.tags, "creator") || "";

    let audioUrl = "";
    const mediaTags = event.tags.filter((t) =>
      t[0] === "media" || t[0] === "url" || t[0] === "streaming" ||
      t[0] === "enclosure" || t[0] === "r" || t[0] === "imeta"
    );
    for (const mt of mediaTags) {
      const u = mt[1] || "";
      if (u && /\.(mp3|wav|ogg|flac|m4a|aac|opus)/i.test(u)) {
        audioUrl = u;
        break;
      }
    }
    if (!audioUrl) {
      for (const mt of mediaTags) {
        const u = mt[1] || "";
        if (u && (u.includes("audio") || u.includes("stream") || u.startsWith("http"))) {
          audioUrl = u;
          break;
        }
      }
    }

    if (!audioUrl) {
      const urlMatch = event.content.match(/(https?:\/\/[^\s]+\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?[^\s]*)?)/i);
      if (urlMatch) audioUrl = urlMatch[1];
    }

    if (!audioUrl && event.content) {
      try {
        const parsed = JSON.parse(event.content);
        audioUrl = parsed.enclosure || parsed.url || parsed.audioUrl || parsed.media || "";
        if (!title) title = parsed.title || parsed.name || "";
        if (!artist) artist = parsed.artist || parsed.creator || "";
      } catch {}
    }

    if (!audioUrl) return null;

    const coverUrl = getTagValue(event.tags, "cover") || getTagValue(event.tags, "image") ||
      getTagValue(event.tags, "thumb") || getTagValue(event.tags, "picture") || "";
    const genre = getTagValue(event.tags, "c") || getTagValue(event.tags, "t") || "";
    const albumTitle = getTagValue(event.tags, "album") || "";
    const durationStr = getTagValue(event.tags, "duration") || getTagValue(event.tags, "length") || "";
    const duration = durationStr ? parseInt(durationStr) || 0 : 0;
    const zapSplits = extractZapSplits(event);

    let description = "";
    if (event.content && !event.content.startsWith("{")) {
      description = event.content;
    }

    return {
      id: event.id,
      event,
      title: title || "Untitled Track",
      artist: artist || "Unknown Artist",
      artistPubkey: event.pubkey,
      audioUrl,
      coverUrl,
      description,
      genre,
      duration,
      createdAt: event.created_at,
      albumTitle: albumTitle || undefined,
      zapSplits: zapSplits.length > 0 ? zapSplits : undefined,
      source: event.tags.some(t => t[0] === "client" && (t[1] === "Relay Outpost" || t[1] === "relay-outpost")) ? "relay-outpost" : "zapstr",
    };
  } catch {
    return null;
  }
}

const PODCAST_SEARCH_TERMS = ["podcast", "episode", "show", "interview"];

function isPodcastContent(item: { name?: string; title?: string; artist?: string; albumTitle?: string; genreId?: number }): boolean {
  if (item.genreId === 20) return true;
  const text = [item.name, item.title, item.artist, item.albumTitle].filter(Boolean).join(" ").toLowerCase();
  return PODCAST_SEARCH_TERMS.some(term => text.includes(term));
}

export async function fetchWavlakePodcasts(searchIndex = 0): Promise<MusicTrack[]> {
  try {
    const term = PODCAST_SEARCH_TERMS[searchIndex % PODCAST_SEARCH_TERMS.length];
    const results = await searchWavlake(term);
    const podcastTracks = results
      .filter((item) => item.type === "track" && item.liveUrl && isPodcastContent(item))
      .map((t) => ({
        id: t.id,
        title: t.title || t.name || "Untitled Episode",
        artist: t.artist || "Unknown Podcast",
        artistPubkey: "",
        audioUrl: t.liveUrl || "",
        coverUrl: t.artworkUrl || "",
        description: "",
        genre: "Podcast",
        duration: t.duration || 0,
        createdAt: Math.floor(Date.now() / 1000),
        wavlakeUrl: t.id ? `https://wavlake.com/track/${t.id}` : undefined,
        albumTitle: t.albumTitle || undefined,
        artistAvatarUrl: t.avatarUrl || undefined,
      }));

    const podcastArtists = results.filter(r => r.type === "artist" && isPodcastContent(r));
    const artistTrackPromises = podcastArtists.slice(0, 3).map(async (a) => {
      const artist = await fetchWavlakeArtist(a.id);
      if (!artist) return [];
      return getArtistTracks(artist).map(t => ({ ...t, genre: "Podcast" }));
    });

    const artistTracks = (await Promise.all(artistTrackPromises)).flat();

    const seen = new Set<string>();
    const merged: MusicTrack[] = [];
    for (const t of [...podcastTracks, ...artistTracks]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        merged.push(t);
      }
    }

    return merged;
  } catch (err) {
    console.error("Failed to fetch podcasts:", err);
    return [];
  }
}

export interface TrendingPodcast {
  id: number;
  title: string;
  author: string;
  description: string;
  image: string;
  url: string;
  episodeCount: number;
  language: string;
  categories: string[];
  trendScore: number;
}

let trendingPodcastCache: { data: TrendingPodcast[]; fetchedAt: number } | null = null;
const TRENDING_CACHE_TTL = 10 * 60 * 1000;

export async function fetchPodcastIndexTrending(): Promise<TrendingPodcast[]> {
  if (trendingPodcastCache && Date.now() - trendingPodcastCache.fetchedAt < TRENDING_CACHE_TTL) {
    return trendingPodcastCache.data;
  }
  try {
    const res = await fetch("/api/podcastindex/trending");
    if (!res.ok) return [];
    const json = await res.json();
    const feeds: TrendingPodcast[] = json.feeds || [];
    trendingPodcastCache = { data: feeds, fetchedAt: Date.now() };
    return feeds;
  } catch {
    return [];
  }
}

export interface PodcastRSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author: string;
  thumbnail: string;
  audioUrl: string;
  duration: number;
  episode: string;
  season: string;
  transcriptUrl?: string;
  transcriptType?: string;
  chaptersUrl?: string;
}

export function rssItemToMusicTrack(
  item: PodcastRSSItem,
  feedTitle: string,
  feedImage: string,
  artistPubkey: string,
): MusicTrack | null {
  if (!item.audioUrl) return null;
  const seasonEp = [
    item.season ? `S${item.season}` : "",
    item.episode ? `E${item.episode}` : "",
  ].filter(Boolean).join("");
  const title = seasonEp ? `${seasonEp}: ${item.title}` : item.title;
  return {
    id: `podcast-${btoa(item.audioUrl).replace(/[/+=]/g, "")}`,
    title: title || "Untitled Episode",
    artist: item.author || feedTitle || "Unknown Podcast",
    artistPubkey,
    audioUrl: item.audioUrl,
    coverUrl: item.thumbnail || feedImage || "",
    description: item.description || "",
    genre: "Podcast",
    duration: item.duration || 0,
    createdAt: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : 0,
    source: "podcast",
    albumTitle: feedTitle || undefined,
    transcriptUrl: item.transcriptUrl || undefined,
    transcriptType: item.transcriptType || undefined,
    chaptersUrl: item.chaptersUrl || undefined,
  };
}

const podcastFeedCache = new Map<string, { tracks: MusicTrack[]; fetchedAt: number }>();
const PODCAST_FEED_TTL = 10 * 60 * 1000;

export async function fetchPodcastFromRSS(
  feedUrl: string,
  artistPubkey: string,
  limit = 25,
): Promise<MusicTrack[]> {
  const cacheKey = `${feedUrl}::${artistPubkey}::${limit}`;
  const cached = podcastFeedCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PODCAST_FEED_TTL) {
    return cached.tracks;
  }
  try {
    const res = await fetch(`/api/rss?url=${encodeURIComponent(feedUrl)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.isPodcast) return [];
    const tracks: MusicTrack[] = [];
    for (const item of (data.items || []).slice(0, limit)) {
      const track = rssItemToMusicTrack(item, data.title, data.image, artistPubkey);
      if (track) tracks.push(track);
    }
    podcastFeedCache.set(cacheKey, { tracks, fetchedAt: Date.now() });
    return tracks;
  } catch {
    return [];
  }
}

const KNOWN_PODCASTER_PUBKEYS = new Set([
  "7f177706ad6e0aea75a9e3345d9ffdae67676faff249be657b596375e1ced391",
  "04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9",
]);

export function isKnownPodcaster(pubkey: string): boolean {
  return KNOWN_PODCASTER_PUBKEYS.has(pubkey);
}

const PODCAST_FEED_STORAGE_KEY = "relay-outpost-podcast-feed";

export function getSavedPodcastFeed(pubkey: string): string | null {
  try {
    const stored = localStorage.getItem(`${PODCAST_FEED_STORAGE_KEY}::${pubkey}`);
    return stored && stored !== "disabled" ? stored : null;
  } catch {
    return null;
  }
}

export function isPodcastDisabled(pubkey: string): boolean {
  try {
    return localStorage.getItem(`${PODCAST_FEED_STORAGE_KEY}::${pubkey}`) === "disabled";
  } catch {
    return false;
  }
}

export function savePodcastFeed(pubkey: string, feedUrl: string): void {
  try {
    localStorage.setItem(`${PODCAST_FEED_STORAGE_KEY}::${pubkey}`, feedUrl);
  } catch {}
}

export function removePodcastFeed(pubkey: string): void {
  try {
    localStorage.setItem(`${PODCAST_FEED_STORAGE_KEY}::${pubkey}`, "disabled");
  } catch {}
}

const podcastDiscoveryCache = new Map<string, { feedUrl: string | null; fetchedAt: number }>();
const PODCAST_DISCOVERY_TTL = 30 * 60 * 1000;

const PODCAST_HOST_PATTERNS = [
  "feeds.fountain.fm",
  "anchor.fm",
  "serve.podhome.fm",
  "feed.podbean.com",
  "feeds.buzzsprout.com",
  "feeds.transistor.fm",
  "feeds.simplecast.com",
  "feeds.megaphone.fm",
  "feeds.libsyn.com",
  "feeds.captivate.fm",
  "feeds.redcircle.com",
  "rss.art19.com",
  "feeds.acast.com",
];

async function searchPodverse(query: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/podverse/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const podcasts = data.podcasts || [];
    if (podcasts.length === 0) return null;
    const match = podcasts.find((p: any) =>
      p.title?.toLowerCase() === query.toLowerCase()
    ) || podcasts[0];
    const feedUrls: string[] = match.feedUrls || [];
    return feedUrls[0] || null;
  } catch {
    return null;
  }
}

export async function discoverPodcastFeed(websiteUrl: string, displayName?: string): Promise<string | null> {
  if (!websiteUrl && !displayName) return null;
  const cacheKey = `${websiteUrl || ""}::${displayName || ""}`;
  const cached = podcastDiscoveryCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PODCAST_DISCOVERY_TTL) {
    return cached.feedUrl;
  }

  const setCache = (feedUrl: string | null) => {
    podcastDiscoveryCache.set(cacheKey, { feedUrl, fetchedAt: Date.now() });
    return feedUrl;
  };

  if (websiteUrl) {
    const normalized = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
    try {
      const base = new URL(normalized);
      const host = base.hostname.toLowerCase();
      const isPodcastHost = PODCAST_HOST_PATTERNS.some(h => host.includes(h));
      if (isPodcastHost) {
        const res = await fetch(`/api/rss?url=${encodeURIComponent(normalized)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.isPodcast && data.items?.some((i: any) => i.audioUrl)) {
            return setCache(normalized);
          }
        }
      }
    } catch {
    }
  }

  if (displayName && displayName.length >= 3) {
    const podverseFeed = await searchPodverse(displayName);
    if (podverseFeed) {
      try {
        const res = await fetch(`/api/rss?url=${encodeURIComponent(podverseFeed)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.isPodcast && data.items?.some((i: any) => i.audioUrl)) {
            return setCache(podverseFeed);
          }
        }
      } catch {
      }
    }
  }

  if (websiteUrl) {
    const normalized = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`;
    const candidates: string[] = [];
    try {
      const base = new URL(normalized);
      const origin = base.origin;
      const path = base.pathname.replace(/\/$/, "");
      if (path && path !== "/") {
        candidates.push(`${origin}${path}/feed`);
        candidates.push(`${origin}${path}`);
      }
      candidates.push(`${origin}/feed`, `${origin}/feed/podcast`, `${origin}/rss`, `${origin}/podcast.xml`);
    } catch {
      return setCache(null);
    }
    for (const url of candidates) {
      try {
        const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.isPodcast && data.items?.some((i: any) => i.audioUrl)) {
          return setCache(url);
        }
      } catch {
        continue;
      }
    }
  }

  return setCache(null);
}

function parseStemstrTrack(event: Event): MusicTrack | null {
  try {
    let audioUrl = "";
    let title = "";
    let artist = "";
    let coverUrl = "";

    const mediaTags = event.tags.filter((t) =>
      t[0] === "streaming" || t[0] === "url" || t[0] === "r" ||
      t[0] === "media" || t[0] === "enclosure" || t[0] === "imeta"
    );
    for (const mt of mediaTags) {
      const u = mt[1] || "";
      if (u && /\.(mp3|wav|ogg|flac|m4a|aac|opus)/i.test(u)) {
        audioUrl = u;
        break;
      }
    }
    if (!audioUrl) {
      for (const mt of mediaTags) {
        const u = mt[1] || "";
        if (u && (u.includes("audio") || u.includes("stream") || u.startsWith("http"))) {
          audioUrl = u;
          break;
        }
      }
    }
    if (!audioUrl) {
      const urlMatch = event.content.match(/(https?:\/\/[^\s]+\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?[^\s]*)?)/i);
      if (urlMatch) audioUrl = urlMatch[1];
    }
    if (!audioUrl && event.content) {
      try {
        const parsed = JSON.parse(event.content);
        audioUrl = parsed.enclosure || parsed.url || parsed.audioUrl || parsed.media || "";
        if (!title) title = parsed.title || parsed.name || "";
        if (!artist) artist = parsed.artist || parsed.creator || "";
        if (!coverUrl) coverUrl = parsed.artworkUrl || parsed.image || parsed.cover || "";
      } catch {}
    }
    if (!audioUrl) return null;

    if (!title) title = getTagValue(event.tags, "subject") || getTagValue(event.tags, "title") || getTagValue(event.tags, "name") || "";
    if (!artist) artist = getTagValue(event.tags, "artist") || getTagValue(event.tags, "creator") || "";
    if (!coverUrl) coverUrl = getTagValue(event.tags, "cover") || getTagValue(event.tags, "image") ||
      getTagValue(event.tags, "thumb") || getTagValue(event.tags, "picture") || "";
    const genre = getTagValue(event.tags, "t") || getTagValue(event.tags, "c") || "";
    const durationStr = getTagValue(event.tags, "duration") || getTagValue(event.tags, "length") || "";
    const duration = durationStr ? parseInt(durationStr) || 0 : 0;
    const zapSplits = extractZapSplits(event);

    let description = "";
    if (event.content && !event.content.startsWith("{") && !event.content.startsWith("http")) {
      description = event.content.slice(0, 500);
    }

    return {
      id: event.id,
      event,
      title: title || description.slice(0, 60) || "Untitled Track",
      artist: artist || "Unknown Artist",
      artistPubkey: event.pubkey,
      audioUrl,
      coverUrl,
      description,
      genre,
      duration,
      createdAt: event.created_at,
      zapSplits: zapSplits.length > 0 ? zapSplits : undefined,
      source: "nostr",
    };
  } catch {
    return null;
  }
}

export function parseMusicEvent(event: Event): MusicTrack | null {
  if (event.kind === KIND_WAVLAKE_TRACK) return parseWavlakeTrack(event);
  if (event.kind === KIND_MUSIC_TRACK) return parseZapstrTrack(event);
  if (event.kind === KIND_STEMSTR_TRACK) return parseStemstrTrack(event);
  return null;
}

export function parseMusicEvents(events: Event[]): MusicTrack[] {
  const tracks: MusicTrack[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    const track = parseMusicEvent(event);
    if (track) tracks.push(track);
  }

  return tracks.sort((a, b) => b.createdAt - a.createdAt);
}

export const KIND_PODCAST_RSS = 30078;
export const PODCAST_D_TAG = "relay-outpost-podcast-rss";

const nostrPodcastCache = new Map<string, { feedUrl: string | null; fetchedAt: number }>();
const NOSTR_PODCAST_CACHE_TTL = 5 * 60 * 1000;
const NOSTR_PODCAST_NULL_CACHE_TTL = 60 * 1000;

export async function publishPodcastFeed(feedUrl: string | null, signer: any): Promise<boolean> {
  try {
    const { publishEvent, DEFAULT_RELAYS } = await import("./nostr");
    const { getWriteRelays } = await import("./outbox");
    const eventTemplate = {
      kind: KIND_PODCAST_RSS,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", PODCAST_D_TAG], ...clientTags()],
      content: feedUrl || "",
    };
    const signedEvent = await signWithTimeout(signer, eventTemplate);
    const pubkey = await signer.getPublicKey();
    const outboxRelays = getWriteRelays(pubkey, []);
    const relaySet = new Set([...DEFAULT_RELAYS, ...outboxRelays]);
    const relays = Array.from(relaySet).slice(0, 10);
    const ok = await publishEvent(signedEvent, relays);
    if (ok) {
      nostrPodcastCache.set(pubkey, { feedUrl, fetchedAt: Date.now() });
    }
    return ok;
  } catch (err) {
    console.error("[Podcast] Failed to publish feed event:", err);
    return false;
  }
}

export function clearNostrPodcastCache(pubkey: string): void {
  nostrPodcastCache.delete(pubkey);
}

export function isPodcastFeedUrl(url: string): boolean {
  try {
    const normalized = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
    const hostname = new URL(normalized).hostname.toLowerCase();
    return PODCAST_HOST_PATTERNS.some(p => hostname.includes(p));
  } catch {
    return false;
  }
}

export async function fetchNostrPodcastFeed(pubkey: string): Promise<string | null> {
  const cached = nostrPodcastCache.get(pubkey);
  if (cached) {
    const ttl = cached.feedUrl ? NOSTR_PODCAST_CACHE_TTL : NOSTR_PODCAST_NULL_CACHE_TTL;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.feedUrl;
    }
  }

  try {
    const { throttledPoolSubscribe, DEFAULT_RELAYS } = await import("./nostr");
    const { getWriteRelays, fetchRelayLists } = await import("./outbox");
    let outboxRelays = getWriteRelays(pubkey, []);
    if (outboxRelays.length === 0) {
      fetchRelayLists([pubkey]);
      await new Promise(r => setTimeout(r, 300));
      outboxRelays = getWriteRelays(pubkey, []);
    }
    const relaySet = new Set([...DEFAULT_RELAYS, ...outboxRelays]);
    const relays = Array.from(relaySet).slice(0, 10);
    const filter: Filter = {
      kinds: [KIND_PODCAST_RSS],
      authors: [pubkey],
      "#d": [PODCAST_D_TAG],
      limit: 1,
    };

    return new Promise<string | null>((resolve) => {
      let found: string | null = null;
      let latestCreatedAt = 0;
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        sub.close();
        nostrPodcastCache.set(pubkey, { feedUrl: found, fetchedAt: Date.now() });
        resolve(found);
      };

      const timeout = setTimeout(finish, 8000);

      const sub = throttledPoolSubscribe(relays, filter, {
        onevent: (event: Event) => {
          if (event.created_at > latestCreatedAt) {
            latestCreatedAt = event.created_at;
            const content = event.content?.trim();
            found = content || null;
          }
        },
        oneose: finish,
      });
    });
  } catch (err) {
    console.error("[Podcast] Failed to fetch feed event:", err);
    return null;
  }
}
