import { ExternalLink, Music } from "lucide-react";
import type { MusicService } from "@/lib/media-utils";

interface MusicLinkCardProps {
  url: string;
  service: MusicService;
  compact?: boolean;
}

interface ServiceMeta {
  name: string;
  /** Brand colour — drives the left accent edge, the "kind" label, and Play. */
  hex: string;
  Icon: () => JSX.Element;
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1DB954" />
      <path
        d="M17.6 16.2a.75.75 0 0 1-1.03.25c-2.83-1.73-6.4-2.12-10.6-1.16a.75.75 0 1 1-.34-1.46c4.6-1.06 8.55-.6 11.72 1.34.36.22.47.69.25 1.03zm1.5-3.3a.94.94 0 0 1-1.29.31c-3.24-1.99-8.18-2.57-12.02-1.4a.94.94 0 0 1-.55-1.8c4.4-1.34 9.84-.69 13.55 1.6a.94.94 0 0 1 .31 1.29zm.13-3.43c-3.88-2.3-10.28-2.51-13.98-1.39a1.13 1.13 0 1 1-.66-2.16c4.25-1.29 11.31-1.04 15.78 1.61a1.13 1.13 0 0 1-1.14 1.94z"
        fill="#000"
      />
    </svg>
  );
}

function AppleMusicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <defs>
        <linearGradient id="am-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FB5C74" />
          <stop offset="100%" stopColor="#FA243C" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="5" fill="url(#am-grad)" />
      <path
        d="M16.6 6.5c0-.4-.3-.6-.7-.5l-6 1.3c-.4.1-.6.3-.6.7v6.4c-.3-.1-.6-.2-1-.2-1.2 0-2.1.7-2.1 1.7s.9 1.7 2.1 1.7 2.1-.7 2.1-1.7V9.6l4.7-1v4.5c-.3-.1-.6-.2-1-.2-1.2 0-2.1.7-2.1 1.7s.9 1.7 2.1 1.7 2.1-.7 2.1-1.7V6.5z"
        fill="#fff"
      />
    </svg>
  );
}

function SoundCloudIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        d="M2.5 14.5c0-.3.1-.5.3-.5s.3.2.3.5v3c0 .3-.1.5-.3.5s-.3-.2-.3-.5v-3zm1.6-1c0-.3.1-.5.3-.5s.3.2.3.5v4c0 .3-.1.5-.3.5s-.3-.2-.3-.5v-4zm1.6-.5c0-.3.1-.5.3-.5s.3.2.3.5v4.5c0 .3-.1.5-.3.5s-.3-.2-.3-.5V13zm1.6-.5c0-.3.1-.5.3-.5s.3.2.3.5v5c0 .3-.1.5-.3.5s-.3-.2-.3-.5v-5zm1.6-1c0-.3.2-.5.4-.5s.4.2.4.5v6c0 .3-.2.5-.4.5s-.4-.2-.4-.5v-6zm1.7-1c0-.3.2-.5.4-.5s.4.2.4.5v7c0 .3-.2.5-.4.5s-.4-.2-.4-.5v-7zm1.8-1.5c0-.3.2-.5.4-.5s.4.2.4.5v8.5c0 .3-.2.5-.4.5s-.4-.2-.4-.5V9zm1.8-1c0-.3.2-.5.4-.5s.4.2.4.5v9.5c0 .3-.2.5-.4.5s-.4-.2-.4-.5V8zm2.6-1c.4-.2.8-.3 1.3-.3 2 0 3.6 1.6 3.6 3.6 0 .3 0 .6-.1.8.4-.2.8-.3 1.2-.3 1.5 0 2.7 1.2 2.7 2.7s-1.2 2.7-2.7 2.7h-6c-.2 0-.4-.2-.4-.4V7.4c0-.2.1-.3.4-.4z"
        fill="#FF5500"
      />
    </svg>
  );
}

function TidalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path d="M12 6 8 10l-4-4-4 4 4 4 4-4 4 4 4-4-4-4z" fill="#000" />
      <path d="M16 10l4-4 4 4-4 4z" fill="#000" />
      <path d="M12 14l4-4 4 4-4 4z" fill="#000" />
    </svg>
  );
}

function YouTubeMusicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#FF0000" />
      <path d="M9.5 8.5v7l6-3.5z" fill="#fff" />
    </svg>
  );
}

function WavlakeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <defs>
        <linearGradient id="wl-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="5" fill="url(#wl-grad)" />
      <path d="M3 13c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0" stroke="#FBBF24" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 6.2 10.4 11h2.4l-1.3 4 3.6-5.1h-2.4z" fill="#FFF" />
    </svg>
  );
}

function BandcampIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <rect width="24" height="24" rx="3" fill="#1DA0C3" />
      <path d="M5 15.5 9 8.5h10l-4 7z" fill="#fff" />
    </svg>
  );
}

const SERVICES: Record<MusicService, ServiceMeta> = {
  spotify: { name: "Spotify", hex: "#1DB954", Icon: SpotifyIcon },
  applemusic: { name: "Apple Music", hex: "#FA243C", Icon: AppleMusicIcon },
  soundcloud: { name: "SoundCloud", hex: "#FF5500", Icon: SoundCloudIcon },
  tidal: { name: "Tidal", hex: "#0EA5B7", Icon: TidalIcon },
  youtubemusic: { name: "YouTube Music", hex: "#FF0000", Icon: YouTubeMusicIcon },
  bandcamp: { name: "Bandcamp", hex: "#1DA0C3", Icon: BandcampIcon },
  wavlake: { name: "Wavlake", hex: "#7C3AED", Icon: WavlakeIcon },
};

function prettifyTitle(url: string, service: MusicService): { kind: string; title: string } {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (service === "spotify") {
      const kindSeg = segments[0] || "track";
      const kind = kindSeg.charAt(0).toUpperCase() + kindSeg.slice(1);
      return { kind, title: `Listen on Spotify` };
    }
    if (service === "applemusic") {
      const idx = segments.findIndex((s) => ["album", "playlist", "song", "music-video", "artist"].includes(s));
      const kindSeg = idx >= 0 ? segments[idx] : "album";
      const slugSeg = idx >= 0 && segments[idx + 1] ? segments[idx + 1] : segments[segments.length - 1] || "";
      const title = slugSeg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Listen on Apple Music";
      const kind = kindSeg.charAt(0).toUpperCase() + kindSeg.slice(1);
      return { kind, title };
    }
    if (service === "soundcloud") {
      if (segments.length >= 2) {
        const isSet = segments[1] === "sets";
        const titleSeg = isSet ? segments[2] || "" : segments[1] || "";
        const title = titleSeg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Listen on SoundCloud";
        const artist = segments[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return { kind: artist, title };
      }
      return { kind: "Track", title: "Listen on SoundCloud" };
    }
    if (service === "tidal") {
      const kindSeg = segments.find((s) => ["track", "album", "playlist", "video", "artist"].includes(s)) || "track";
      const kind = kindSeg.charAt(0).toUpperCase() + kindSeg.slice(1);
      return { kind, title: "Listen on Tidal" };
    }
    if (service === "youtubemusic") {
      return { kind: "Track", title: "Listen on YouTube Music" };
    }
    if (service === "wavlake") {
      const idx = segments.findIndex((s) => ["track", "album", "artist", "playlist"].includes(s));
      const kindSeg = idx >= 0 ? segments[idx] : "track";
      const kind = kindSeg.charAt(0).toUpperCase() + kindSeg.slice(1);
      return { kind, title: "Listen on Wavlake" };
    }
    if (service === "bandcamp") {
      const artist = parsed.hostname.replace(/\.bandcamp\.com$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const slugSeg = segments[1] || segments[0] || "";
      const title = slugSeg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Listen on Bandcamp";
      return { kind: artist || "Track", title };
    }
  } catch {
    /* fall through */
  }
  return { kind: "Track", title: SERVICES[service].name };
}

export function MusicLinkCard({ url, service, compact = false }: MusicLinkCardProps) {
  const meta = SERVICES[service];
  const { kind, title } = prettifyTitle(url, service);
  const Icon = meta.Icon;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      /* Opaque, token-driven card (was a muddy dark gradient with white text that
         went low-contrast/washed-out in light mode). One brand accent — the left
         edge, the kind label, and the Play button — reads pro in BOTH themes. */
      className="group/music flex items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5 overflow-hidden hover:border-border transition-colors"
      style={{ borderLeftWidth: 3, borderLeftColor: meta.hex }}
      data-testid={`music-link-${service}`}
    >
      {/* Light tile so every service glyph (Spotify green, Tidal black, …) reads. */}
      <div className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center bg-white ring-1 ring-black/5 shadow-sm">
        <Icon />
      </div>
      <div className="flex-1 min-w-0">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: meta.hex }}>
          <Music className="w-2.5 h-2.5" />
          {kind}
        </span>
        <p className={`font-semibold text-foreground truncate ${compact ? "text-xs" : "text-sm"}`}>
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">{meta.name}</p>
      </div>
      <span
        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full text-white text-xs font-semibold px-3.5 py-1.5 group-hover/music:brightness-110 transition-[filter]"
        style={{ backgroundColor: meta.hex }}
      >
        Play <ExternalLink className="w-3 h-3" />
      </span>
    </a>
  );
}
