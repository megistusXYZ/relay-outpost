// Platforms we play inline via an <iframe> embed (vs. native <video> or a link card).
export type EmbedType = 'youtube' | 'vimeo' | 'rumble' | 'twitch' | 'streamable' | 'loom' | 'dailymotion';
export const EMBED_TYPES: readonly EmbedType[] = ['youtube', 'vimeo', 'rumble', 'twitch', 'streamable', 'loom', 'dailymotion'];
export function isEmbedType(t: string): t is EmbedType {
  return (EMBED_TYPES as readonly string[]).includes(t);
}

export type MediaType = 'image' | 'video' | 'audio' | EmbedType | 'nostr' | 'zapstream' | 'musiclink' | 'link';

export type MusicService = 'spotify' | 'applemusic' | 'soundcloud' | 'tidal' | 'youtubemusic' | 'bandcamp' | 'wavlake';

export interface MediaItem {
  type: MediaType;
  url: string;
  originalText: string;
  embedId?: string;
  musicService?: MusicService;
  nostrData?: {
    type: 'npub' | 'note' | 'nevent' | 'naddr' | 'nprofile';
    data: any;
    encoded: string;
  };
}

export interface ImetaData {
  url: string;
  mimeType?: string;
  blurhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  /** NIP-92 `x`: sha256 of the file — lets dead Blossom links heal via other servers. */
  sha256?: string;
  fallbacks?: string[];
  thumbnail?: string;
  duration?: number;
  waveform?: number[];
}

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|apng|svg)(\?.*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|ogv|m3u8)(\?.*)?$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?.*)?$/i;

const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch)/i,
  /(?:youtu\.be\/)/i,
  /(?:youtube\.com\/shorts\/)/i,
  /(?:youtube\.com\/embed\/)/i,
  /(?:youtube\.com\/live\/)/i,
  /(?:youtube\.com\/clip\/)/i,
  /(?:youtube\.com\/playlist)/i,
];

export type WavlakeUrlKind = 'track' | 'album' | 'artist';
export interface ParsedWavlakeUrl {
  kind: WavlakeUrlKind;
  id: string;
}

const WAVLAKE_RESERVED_SLUGS = new Set([
  'feed', 'feeds', 'login', 'signup', 'register', 'logout', 'wallet',
  'settings', 'profile', 'search', 'browse', 'discover', 'top', 'new',
  'featured', 'random', 'about', 'terms', 'privacy', 'help', 'support',
  'contact', 'faq', 'blog', 'docs', 'api', 'admin', 'dashboard',
  'preview', 'embed', 'player', 'not-found', 'sign-in', 'sign-up',
]);

export function parseWavlakeUrl(url: string): ParsedWavlakeUrl | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'wavlake.com' && host !== 'app.wavlake.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    const [first, second] = segments;
    if (first === 'track' && second) {
      return { kind: 'track', id: second.split('?')[0].split('#')[0] };
    }
    if (first === 'album' && second) {
      return { kind: 'album', id: second.split('?')[0].split('#')[0] };
    }
    if (segments.length === 1) {
      const slug = first.split('?')[0].split('#')[0];
      if (!slug || WAVLAKE_RESERVED_SLUGS.has(slug.toLowerCase())) return null;
      return { kind: 'artist', id: slug };
    }
    return null;
  } catch {
    return null;
  }
}

export function detectMusicService(url: string): MusicService | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'music.youtube.com') return 'youtubemusic';
    if (host === 'open.spotify.com' || host === 'spotify.link') return 'spotify';
    if (host === 'music.apple.com' || host === 'embed.music.apple.com') return 'applemusic';
    if (host === 'soundcloud.com' || host === 'on.soundcloud.com' || host === 'm.soundcloud.com') return 'soundcloud';
    if (host === 'tidal.com' || host === 'listen.tidal.com') return 'tidal';
    if (host.endsWith('.bandcamp.com') || host === 'bandcamp.com') return 'bandcamp';
    if (host === 'wavlake.com' || host === 'app.wavlake.com') return 'wavlake';

    return null;
  } catch {
    return null;
  }
}

export function classifyUrl(url: string): MediaType {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    if (IMAGE_EXTENSIONS.test(pathname)) return 'image';
    if (VIDEO_EXTENSIONS.test(pathname)) return 'video';
    if (AUDIO_EXTENSIONS.test(pathname)) return 'audio';

    // Extension-less URLs (IPFS gateways, upload services) often carry the real
    // name in a `filename=` query param — classify by that when present.
    const filename = parsed.searchParams.get('filename');
    if (filename) {
      if (IMAGE_EXTENSIONS.test(filename)) return 'image';
      if (VIDEO_EXTENSIONS.test(filename)) return 'video';
      if (AUDIO_EXTENSIONS.test(filename)) return 'audio';
    }

    if (detectMusicService(url)) return 'musiclink';

    if (YOUTUBE_PATTERNS.some((p) => p.test(url))) return 'youtube';
    if (/vimeo\.com\//i.test(url)) return 'vimeo';
    if (/rumble\.com\//i.test(url)) return 'rumble';
    if (/(?:^|\.)twitch\.tv$/i.test(parsed.hostname)) return 'twitch';
    if (/(?:^|\.)streamable\.com$/i.test(parsed.hostname)) return 'streamable';
    if (/(?:^|\.)loom\.com$/i.test(parsed.hostname)) return 'loom';
    if (/(?:^|\.)dailymotion\.com$/i.test(parsed.hostname) || /(?:^|\.)dai\.ly$/i.test(parsed.hostname)) return 'dailymotion';

    if (parsed.hostname === 'zap.stream' || parsed.hostname === 'www.zap.stream') {
      const naddr = extractZapStreamNaddr(url);
      if (naddr) return 'zapstream';
    }

    return 'link';
  } catch {
    return 'link';
  }
}

export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1);
      return id || null;
    }

    if (parsed.hostname.includes('youtube.com')) {
      const watchMatch = parsed.searchParams.get('v');
      if (watchMatch) return watchMatch;

      const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];

      const embedMatch = parsed.pathname.match(/\/embed\/([^/?]+)/);
      if (embedMatch) return embedMatch[1];

      const liveMatch = parsed.pathname.match(/\/live\/([^/?]+)/);
      if (liveMatch) return liveMatch[1];

      const clipMatch = parsed.pathname.match(/\/clip\/([^/?]+)/);
      if (clipMatch) return clipMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

export function extractVimeoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('vimeo.com')) return null;
    const match = parsed.pathname.match(/\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function extractRumbleId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('rumble.com')) return null;
    const match = parsed.pathname.match(/\/embed\/([^/?]+)/);
    if (match) return match[1];
    const videoMatch = parsed.pathname.match(/\/([^/?]+\.html)/);
    return videoMatch ? videoMatch[1] : parsed.pathname.slice(1) || null;
  } catch {
    return null;
  }
}

export function extractZapStreamNaddr(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'zap.stream' && parsed.hostname !== 'www.zap.stream') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const naddr = segments.find(s => s.startsWith('naddr1'));
    return naddr || null;
  } catch {
    return null;
  }
}

export function getRumbleEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("rumble.com")) return null;
    const embedMatch = parsed.pathname.match(/\/embed\/([a-z0-9]+)/i);
    if (embedMatch) return `https://rumble.com/embed/${embedMatch[1]}/`;
    const videoMatch = parsed.pathname.match(/\/([a-z0-9]+)-/i);
    if (videoMatch) return `https://rumble.com/embed/${videoMatch[1]}/`;
    return null;
  } catch {
    return null;
  }
}

// ── External video embeds ───────────────────────────────────────────────────
// YouTube / Vimeo / Rumble / Twitch / Streamable / Loom / Dailymotion.
// Shared by the feed (MediaRenderer) and the video page (VideoFeed) so both use
// one embed pipeline. Twitch's id is encoded as "clip:SLUG" | "video:ID" |
// "channel:NAME" so getEmbedIframeSrc can pick the right player URL.

export function extractTwitchId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(?:www|m)\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (host === 'clips.twitch.tv') return parts[0] ? `clip:${parts[0]}` : null;
    if (host === 'twitch.tv') {
      const clipIdx = parts.indexOf('clip');
      if (clipIdx !== -1 && parts[clipIdx + 1]) return `clip:${parts[clipIdx + 1]}`;
      if (parts[0] === 'videos' && parts[1]) return `video:${parts[1]}`;
      if (parts.length === 1 && parts[0]) return `channel:${parts[0]}`;
    }
    return null;
  } catch { return null; }
}

export function extractStreamableId(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    return (parts[0] === 'e' || parts[0] === 'o') ? (parts[1] || null) : parts[0];
  } catch { return null; }
}

export function extractLoomId(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    return (parts[0] === 'share' || parts[0] === 'embed') ? (parts[1] || null) : parts[parts.length - 1];
  } catch { return null; }
}

export function extractDailymotionId(url: string): string | null {
  try {
    const u = new URL(url);
    if (/dai\.ly$/i.test(u.hostname)) {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      return seg ? seg.split('_')[0] : null;
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const vi = parts.indexOf('video');
    const seg = vi !== -1 ? parts[vi + 1] : parts[parts.length - 1];
    return seg ? seg.split('_')[0] : null;
  } catch { return null; }
}

export function resolveEmbedId(videoUrl: string, urlType: string): string | null {
  if (urlType === 'youtube') return extractYouTubeId(videoUrl);
  if (urlType === 'vimeo') return extractVimeoId(videoUrl);
  if (urlType === 'rumble') {
    const id = extractRumbleId(videoUrl);
    return id && !id.includes('.html') ? id : null;
  }
  if (urlType === 'twitch') return extractTwitchId(videoUrl);
  if (urlType === 'streamable') return extractStreamableId(videoUrl);
  if (urlType === 'loom') return extractLoomId(videoUrl);
  if (urlType === 'dailymotion') return extractDailymotionId(videoUrl);
  return null;
}

export function getEmbedIframeSrc(type: string, embedId: string, autoplay = true): string | null {
  switch (type) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${embedId}?autoplay=${autoplay ? 1 : 0}&mute=1&rel=0&modestbranding=1`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${embedId}?autoplay=${autoplay ? 1 : 0}&muted=1&background=1&autopause=0&dnt=1&playsinline=1`;
    case 'rumble':
      return `https://rumble.com/embed/${embedId}/?autoplay=${autoplay ? 2 : 0}&mute=1`;
    case 'twitch': {
      // Twitch refuses to load unless `parent` matches the embedding host.
      const parent = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      const [kind, val] = embedId.split(':');
      const base = kind === 'clip'
        ? `https://clips.twitch.tv/embed?clip=${val}`
        : kind === 'video'
        ? `https://player.twitch.tv/?video=${val}`
        : `https://player.twitch.tv/?channel=${val}`;
      return `${base}&parent=${parent}&autoplay=${autoplay ? 'true' : 'false'}&muted=true`;
    }
    case 'streamable':
      return `https://streamable.com/e/${embedId}?autoplay=${autoplay ? 1 : 0}&muted=1`;
    case 'loom':
      return `https://www.loom.com/embed/${embedId}?autoplay=${autoplay ? 1 : 0}&muted=true`;
    case 'dailymotion':
      return `https://www.dailymotion.com/embed/video/${embedId}?autoplay=${autoplay ? 1 : 0}&mute=1`;
    default:
      return null;
  }
}

export function getEmbedThumbnail(type: string, embedId: string): string | null {
  switch (type) {
    case 'youtube':
      return `https://img.youtube.com/vi/${embedId}/hqdefault.jpg`;
    case 'vimeo':
      return `https://vumbnail.com/${embedId}.jpg`;
    case 'dailymotion':
      return `https://www.dailymotion.com/thumbnail/video/${embedId}`;
    default:
      // Twitch / Streamable / Loom have no simple public thumbnail URL — the
      // player shows a play button on black until loaded.
      return null;
  }
}

const EMBED_LABELS: Record<EmbedType, string> = {
  youtube: 'YouTube', vimeo: 'Vimeo', rumble: 'Rumble', twitch: 'Twitch',
  streamable: 'Streamable', loom: 'Loom', dailymotion: 'Dailymotion',
};
export function embedPlatformLabel(type: string): string {
  return EMBED_LABELS[type as EmbedType] ?? 'Video';
}

// YouTube Shorts are vertical (9:16); everything else is treated as 16:9.
export function isYouTubeShort(url: string): boolean {
  return /youtube\.com\/shorts\//i.test(url);
}

// Video platforms we DON'T embed inline (they block iframes / need oEmbed). We
// still want these to feel native — show a rich thumbnail + play affordance link
// preview instead of the branded "open in browser" card.
export function isKnownVideoLink(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (/(?:^|\.)(tiktok\.com|bitchute\.com|odysee\.com|kick\.com)$/i.test(h)) return true;
    if (/(?:^|\.)instagram\.com$/i.test(h) && /\/(reel|reels|tv|p)\//i.test(u.pathname)) return true;
    return false;
  } catch { return false; }
}

// ── IPFS (ipfs:// URIs → HTTPS gateway URLs) ────────────────────────────────
// Browsers can't fetch ipfs:// directly, so posts carrying raw IPFS URIs are
// rewritten to a public HTTP gateway. Ordered list: primary first; the image
// renderer swaps to the next gateway once on load error (ipfsGatewayFallback).
export const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
] as const;

// ipfs://<cid>[/path][?query] — also tolerates the redundant ipfs://ipfs/<cid>
// form. Parsed by regex (not new URL) so CID case is preserved (CIDv0 Qm… is
// case-sensitive; URL implementations may lowercase non-special-scheme hosts).
const IPFS_URI_RE = /^ipfs:\/\/(?:ipfs\/)?([a-z0-9]+)((?:\/[^?#\s]*)?)(\?[^#\s]*)?$/i;

/** Convert an ipfs:// URI to an HTTPS gateway URL (path + query preserved). Non-IPFS input → null. */
export function ipfsToHttp(uri: string, gateway: string = IPFS_GATEWAYS[0]): string | null {
  const m = IPFS_URI_RE.exec(uri);
  if (!m) return null;
  const [, cid, path = '', query = ''] = m;
  return `${gateway}${cid}${path}${query}`;
}

/**
 * One-step gateway retry for <img onError>: given a gateway URL that failed,
 * return the same cid/path/query on the NEXT gateway in IPFS_GATEWAYS — null
 * when the URL isn't one of our gateway URLs or we're out of gateways.
 */
export function ipfsGatewayFallback(url: string): string | null {
  for (let i = 0; i < IPFS_GATEWAYS.length - 1; i++) {
    if (url.startsWith(IPFS_GATEWAYS[i])) {
      return IPFS_GATEWAYS[i + 1] + url.slice(IPFS_GATEWAYS[i].length);
    }
  }
  return null;
}

export function extractMediaFromContent(content: string): { text: string; media: MediaItem[] } {
  const urlRegex = /((?:https?|ipfs):\/\/[^\s<>"]+)/g;
  const media: MediaItem[] = [];
  const urlsToRemove: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(content)) !== null) {
    const token = match[1];
    // ipfs:// tokens become HTTPS gateway URLs; the media item carries the
    // gateway URL (so <img>/<video>/link cards just work) while originalText
    // keeps the raw token so it's stripped from the prose. A malformed ipfs
    // token stays plain text.
    const url = token.startsWith('ipfs:') ? ipfsToHttp(token) : token;
    if (!url) continue;
    const type = classifyUrl(url);

    const item: MediaItem = {
      type,
      url,
      originalText: token,
    };

    if (isEmbedType(type)) {
      item.embedId = resolveEmbedId(url, type) ?? undefined;
    } else if (type === 'musiclink') {
      const svc = detectMusicService(url);
      if (svc) item.musicService = svc;
    }

    media.push(item);
    urlsToRemove.push(token);
  }

  let text = content;
  for (const url of urlsToRemove) {
    text = text.replace(url, '');
  }

  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return { text, media };
}

export function parseImetaTags(tags: string[][]): ImetaData[] {
  const results: ImetaData[] = [];

  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;

    const data: Partial<ImetaData> = {};
    const fallbacks: string[] = [];

    for (let i = 1; i < tag.length; i++) {
      const entry = tag[i];
      const spaceIdx = entry.indexOf(' ');
      if (spaceIdx === -1) continue;

      const key = entry.substring(0, spaceIdx);
      const value = entry.substring(spaceIdx + 1);

      switch (key) {
        case 'url':
          data.url = value;
          break;
        case 'm':
          data.mimeType = value;
          break;
        case 'blurhash':
          data.blurhash = value;
          break;
        case 'dim': {
          const [w, h] = value.split('x').map(Number);
          if (w && h) data.dimensions = { width: w, height: h };
          break;
        }
        case 'alt':
          data.alt = value;
          break;
        case 'x':
          data.sha256 = value.toLowerCase();
          break;
        case 'fallback':
          fallbacks.push(value);
          break;
        case 'thumb':
        case 'image':
          data.thumbnail = value;
          break;
        case 'duration':
          data.duration = Number(value);
          break;
        case 'waveform':
          data.waveform = value.split(' ').map(Number);
          break;
      }
    }

    if (data.url) {
      if (fallbacks.length > 0) data.fallbacks = fallbacks;
      results.push(data as ImetaData);
    }
  }

  return results;
}

export function getMediaTypeFromMime(mime: string): MediaType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'link';
}

export type MediaCategory = 'image' | 'video' | 'audio';

export interface EventMediaInfo {
  hasImage: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
}

export function getEventMediaInfo(content: string, tags: string[][]): EventMediaInfo {
  const { media } = extractMediaFromContent(content);
  const imetaData = parseImetaTags(tags);

  const imageUrls = new Set<string>();
  const videoUrls = new Set<string>();
  const audioUrls = new Set<string>();

  for (const m of media) {
    if (m.type === 'image') imageUrls.add(m.url);
    else if (m.type === 'video') videoUrls.add(m.url);
    else if (m.type === 'audio') audioUrls.add(m.url);
    else if (m.type === 'youtube' || m.type === 'vimeo' || m.type === 'rumble') videoUrls.add(m.url);
  }

  for (const d of imetaData) {
    const t = d.mimeType ? getMediaTypeFromMime(d.mimeType) : classifyUrl(d.url);
    if (t === 'image') imageUrls.add(d.url);
    else if (t === 'video') videoUrls.add(d.url);
    else if (t === 'audio') audioUrls.add(d.url);
  }

  for (const tag of tags) {
    if ((tag[0] === 'url' || tag[0] === 'r') && tag[1]) {
      const urlType = classifyUrl(tag[1]);
      if (urlType === 'video') videoUrls.add(tag[1]);
      else if (urlType === 'image') imageUrls.add(tag[1]);
      else if (urlType === 'audio') audioUrls.add(tag[1]);
    }
  }

  return {
    hasImage: imageUrls.size > 0,
    hasVideo: videoUrls.size > 0,
    hasAudio: audioUrls.size > 0,
    imageUrls: Array.from(imageUrls),
    videoUrls: Array.from(videoUrls),
    audioUrls: Array.from(audioUrls),
  };
}

export function eventHasMediaType(content: string, tags: string[][], category: MediaCategory): boolean {
  const info = getEventMediaInfo(content, tags);
  if (category === 'image') return info.hasImage;
  if (category === 'video') return info.hasVideo;
  if (category === 'audio') return info.hasAudio;
  return false;
}

const IMAGE_PROXY_HOST = 'wsrv.nl';
const NON_PROXYABLE_EXT = /\.(svg|gif)$/i;

export function shouldProxyImage(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === IMAGE_PROXY_HOST || host.endsWith('.' + IMAGE_PROXY_HOST)) return false;
  if (NON_PROXYABLE_EXT.test(parsed.pathname)) return false;
  return true;
}

export function proxiedImageUrl(url: string, width: number): string {
  if (!shouldProxyImage(url)) return url;
  const params = new URLSearchParams({
    url,
    w: String(width),
    output: 'webp',
    we: '',
    q: '82',
  });
  return `https://${IMAGE_PROXY_HOST}/?${params.toString()}`;
}

export function buildProxiedSrcSet(url: string, widths: number[]): string | undefined {
  if (!shouldProxyImage(url)) return undefined;
  return widths
    .map((w) => `${proxiedImageUrl(url, w)} ${w}w`)
    .join(', ');
}
