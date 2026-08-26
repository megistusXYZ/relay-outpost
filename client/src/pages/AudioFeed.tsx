import { SearchPill } from "@/components/SearchPill";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  fetchWavlakeNewTracks,
  fetchWavlakeRandomTracks,
  fetchWavlakeTrendingTracks,
  fetchWavlakePodcasts,
  fetchPodcastIndexTrending,
  fetchPodcastFromRSS,
  ensureWavlakeMapLoaded,
  resolveWavlakeArtistPubkey,
  searchWavlake,
  searchWavlakeTracks,
  fetchWavlakeArtist,
  getArtistTracks,
  getArtistAlbums,
  fetchAlbumTracks,
  fetchPopularArtists,
  extractUniqueArtists,
  BROWSE_GENRES,
  type MusicTrack,
  type WavlakeSearchResult,
  type WavlakeArtist,
  type WavlakeAlbum,
  type UniqueArtistInfo,
  type TrendingPodcast,
} from "@/lib/music";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  fetchNostrMusicTracks,
} from "@/lib/nostr-audio";
import { useAudioPlayer, getCachedDuration } from "@/contexts/AudioPlayerContext";
import { proxiedImageUrl } from "@/lib/media-utils";

// Cover art comes from external CDNs at full resolution (often ~1500px) but we
// render it in small tiles — route it through the image proxy so we download a
// right-sized webp instead of the original. No-op for non-proxyable URLs.
function coverArt(url: string | undefined, size: number): string {
  return url ? proxiedImageUrl(url, size) : "";
}

// Duration metadata is inconsistent across sources (seconds vs milliseconds, plus
// the occasional garbage value that rendered as "3750:00"). Normalize and never
// show an absurd time: values over ~6h are treated as milliseconds; still-absurd
// values are hidden rather than shown wrong.
function formatTrackDuration(raw: number | undefined): string {
  let s = raw || 0;
  if (s <= 0) return "";
  if (s > 21600) s = s / 1000; // >6h is almost certainly milliseconds
  if (s > 21600) return "";     // still absurd → hide rather than show garbage
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { publishEvent } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { clientTags } from "@/lib/nostr-helpers";
import { createShareMention } from "@/lib/share-mention";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/PageTabs";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { formatDistanceToNow } from "date-fns";
import {
  Play, Pause, Disc3, Headphones, Clock, Shuffle, Search, X, Send,
  ArrowLeft, User, Users, Music, Disc, Guitar, Mic, Zap, Cloud, Leaf, Sun,
  Flame, Star, Radio, Heart, Share2, ExternalLink, Copy, MessageCircle, Globe, ChevronRight,
  LayoutGrid, LayoutList,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

type FeedView = "new" | "browse" | "podcasts" | "artists" | "search-results" | "artist-detail" | "genre-results" | "album-detail";

function RelayOutpostBadge({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      data-testid="badge-relay-outpost"
    >
      <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" />
      <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" />
    </svg>
  );
}

const GENRE_ICON_MAP: Record<string, typeof Guitar> = {
  guitar: Guitar, mic: Mic, zap: Zap, music: Music, cloud: Cloud,
  leaf: Leaf, sun: Sun, piano: Music, flame: Flame, star: Star,
  headphones: Headphones, radio: Radio, sunset: Sun, palmtree: Leaf, heart: Heart,
};

const KIND_TEXT_NOTE = 1;

export function ShareTrackDialog({ track, open, onOpenChange }: { track: MusicTrack; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pubkey: myPubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);

  const [resolvedArtistPubkey, setResolvedArtistPubkey] = useState<string>(track.artistPubkey || "");

  useEffect(() => {
    if (track.artistPubkey) {
      setResolvedArtistPubkey(track.artistPubkey);
      return;
    }
    if (track.artistId) {
      let cancelled = false;
      ensureWavlakeMapLoaded().then(() => {
        if (cancelled) return;
        const pk = resolveWavlakeArtistPubkey(track.artistId!);
        if (pk) setResolvedArtistPubkey(pk);
      });
      return () => { cancelled = true; };
    }
  }, [track.artistPubkey, track.artistId]);

  // Show the artist's name in the editable prefill (raw npubs are user-hostile);
  // the mention is swapped back to a nostr:npub token at publish time so other
  // clients render a tappable @mention.
  const artistMention = useMemo(
    () => (resolvedArtistPubkey ? createShareMention(resolvedArtistPubkey, track.artist) : null),
    [resolvedArtistPubkey, track.artist]
  );

  const trackUrl = track.wavlakeUrl || track.audioUrl;
  const defaultContent = `${track.title} by ${artistMention ? artistMention.display : track.artist}${track.albumTitle ? ` (${track.albumTitle})` : ""}\n\n${trackUrl}`;
  const [content, setContent] = useState(defaultContent);

  useEffect(() => {
    if (open) setContent(defaultContent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resolvedArtistPubkey]);

  const handleShare = async () => {
    if (!signer || !myPubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    if (!content.trim()) return;

    setIsPublishing(true);
    try {
      const tags: string[][] = [];
      const artistPk = track.artistPubkey || resolvedArtistPubkey;
      if (artistPk) {
        tags.push(["p", artistPk]);
      }
      if (trackUrl) {
        tags.push(["r", trackUrl]);
      }
      if (track.audioUrl && track.audioUrl !== trackUrl) {
        tags.push(["r", track.audioUrl]);
      }
      if (track.audioUrl) {
        const imetaParts = [`url ${track.audioUrl}`, "m audio/mpeg"];
        if (track.coverUrl) imetaParts.push(`image ${track.coverUrl}`);
        const altText = `${track.title} by ${track.artist}`;
        imetaParts.push(`alt ${altText}`);
        tags.push(["imeta", ...imetaParts]);
      }
      if (track.title) tags.push(["title", track.title]);
      if (track.artist) tags.push(["artist", track.artist]);
      if (track.genre) {
        tags.push(["t", track.genre.toLowerCase()]);
      }
      tags.push(["t", "music"]);
      tags.push(...clientTags());

      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: (artistMention ? artistMention.resolve(content) : content).trim(),
      };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, undefined, isUserSelected);
      toast({ title: "Shared!", description: "Your post about this track has been published." });
      onOpenChange(false);
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to share track:", err);
        toast({ title: "Failed to share", description: "Something went wrong.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md glass-dialog-card border-border overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Share Track
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-primary/10 border border-border p-3 overflow-hidden">
            <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-1.5">Sharing</p>
            <div className="flex items-center gap-3">
              {track.coverUrl && (
                <img src={coverArt(track.coverUrl, 96)} alt={track.title} width={48} height={48} loading="lazy" className="w-12 h-12 rounded-md object-cover shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground dark:text-white/80 truncate">{track.title}</p>
                <p className="text-xs text-muted-foreground dark:text-white/40 truncate">by {track.artist}</p>
                {track.albumTitle && (
                  <p className="text-[11px] text-muted-foreground dark:text-white/30 truncate">{track.albumTitle}</p>
                )}
              </div>
            </div>
          </div>

          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            className="text-sm bg-muted dark:bg-white/[0.04] border-border dark:border-white/[0.06] text-foreground dark:text-white/80 resize-none rounded-lg"
            style={{ fontSize: 16, wordBreak: "break-word", overflowWrap: "break-word" }}
            placeholder="Add your thoughts..."
            autoComplete="off"
            data-testid="textarea-share-track"
          />

          <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider leading-relaxed">
            This creates a public post{track.artistPubkey ? " tagging the artist" : ""}. Others can reply and zap your post.
          </p>

          <div className="flex gap-2.5 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 font-brand uppercase tracking-widest text-xs border-border dark:border-white/10 text-muted-foreground"
              data-testid="button-cancel-share-track"
            >
              Cancel
            </Button>
            <Button
              onClick={handleShare}
              disabled={isPublishing || !content.trim()}
              className="flex-1 bg-primary text-primary-foreground font-brand uppercase tracking-widest text-xs border-0"
              data-testid="button-confirm-share-track"
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-2" />
              )}
              {isPublishing ? "Posting..." : "Share"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ShareLinkKind = "artist" | "album";

export function ShareLinkDialog({
  open,
  onOpenChange,
  url,
  title,
  subtitle,
  coverUrl,
  kind,
  artistPubkey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
  kind: ShareLinkKind;
  artistPubkey?: string;
}) {
  const { pubkey: myPubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);

  // Show the artist's name in the editable prefill (raw npubs are user-hostile);
  // the mention is swapped back to a nostr:npub token at publish time so other
  // clients render a tappable @mention.
  const artistName = kind === "artist" ? title : subtitle;
  const artistMention = useMemo(
    () => (artistPubkey && artistName ? createShareMention(artistPubkey, artistName) : null),
    [artistPubkey, artistName]
  );

  const defaultContent = kind === "artist"
    ? `Check out ${artistMention ? artistMention.display : title} on Wavlake\n\n${url}`
    : `Listen to ${title}${subtitle ? ` by ${artistMention ? artistMention.display : subtitle}` : ""}\n\n${url}`;
  const [content, setContent] = useState(defaultContent);

  useEffect(() => {
    if (open) setContent(defaultContent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url, artistPubkey]);

  const handleShare = async () => {
    if (!signer || !myPubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    if (!content.trim()) return;

    setIsPublishing(true);
    try {
      const tags: string[][] = [];
      if (artistPubkey) tags.push(["p", artistPubkey]);
      if (url) tags.push(["r", url]);
      if (title) tags.push([kind === "artist" ? "artist" : "title", title]);
      tags.push(["t", "music"]);
      tags.push(...clientTags());

      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: (artistMention ? artistMention.resolve(content) : content).trim(),
      };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, undefined, isUserSelected);
      toast({ title: "Shared!", description: `Your post has been published.` });
      onOpenChange(false);
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to share link:", err);
        toast({ title: "Failed to share", description: "Something went wrong.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md glass-dialog-card border-border overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Share {kind === "artist" ? "Artist" : "Album"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-primary/10 border border-border p-3 overflow-hidden">
            <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-1.5">Sharing</p>
            <div className="flex items-center gap-3">
              {coverUrl && (
                <img src={coverArt(coverUrl, 96)} alt={title} width={48} height={48} loading="lazy" className="w-12 h-12 rounded-md object-cover shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground dark:text-white/80 truncate">{title}</p>
                {subtitle && (
                  <p className="text-xs text-muted-foreground dark:text-white/40 truncate">{subtitle}</p>
                )}
              </div>
            </div>
          </div>

          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            className="text-sm bg-muted dark:bg-white/[0.04] border-border dark:border-white/[0.06] text-foreground dark:text-white/80 resize-none rounded-lg"
            style={{ fontSize: 16, wordBreak: "break-word", overflowWrap: "break-word" }}
            placeholder="Add your thoughts..."
            autoComplete="off"
            data-testid="textarea-share-link"
          />

          <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider leading-relaxed">
            This creates a public post{artistPubkey ? " tagging the artist" : ""}. Others can reply and zap your post.
          </p>

          <div className="flex gap-2.5 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 font-brand uppercase tracking-widest text-xs border-border dark:border-white/10 text-muted-foreground"
              data-testid="button-cancel-share-link"
            >
              Cancel
            </Button>
            <Button
              onClick={handleShare}
              disabled={isPublishing || !content.trim()}
              className="flex-1 bg-primary text-primary-foreground font-brand uppercase tracking-widest text-xs border-0"
              data-testid="button-confirm-share-link"
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-2" />
              )}
              {isPublishing ? "Posting..." : "Share"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareLinkButton({
  url,
  title,
  subtitle,
  coverUrl,
  kind,
  artistPubkey,
  testIdSuffix,
}: {
  url: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
  kind: ShareLinkKind;
  artistPubkey?: string;
  testIdSuffix: string;
}) {
  const { toast } = useToast();
  const [shareOpen, setShareOpen] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Share it anywhere." });
    } catch {
      toast({ title: "Error", description: "Failed to copy link.", variant: "destructive" });
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid={`button-share-${kind}-${testIdSuffix}`}
          >
            <Share2 className="w-3.5 h-3.5 mr-1.5" />
            Share
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onSelect={() => { setTimeout(() => setShareOpen(true), 0); }}
            data-testid={`button-share-${kind}-nostr-${testIdSuffix}`}
          >
            <Send className="w-3.5 h-3.5" />
            Share
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onClick={handleCopyLink}
            data-testid={`button-share-${kind}-copy-${testIdSuffix}`}
          >
            <Copy className="w-3.5 h-3.5" />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareLinkDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        url={url}
        title={title}
        subtitle={subtitle}
        coverUrl={coverUrl}
        kind={kind}
        artistPubkey={artistPubkey}
      />
    </>
  );
}

function AudioShareMenu({ track }: { track: MusicTrack }) {
  const { toast } = useToast();
  const [shareOpen, setShareOpen] = useState(false);

  const handleCopyLink = async () => {
    const url = track.wavlakeUrl || track.audioUrl;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  };

  const handleOpenWavlake = () => {
    if (track.wavlakeUrl) {
      window.open(track.wavlakeUrl, "_blank");
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-muted-foreground/70"
            data-testid={`button-audio-share-${track.id}`}
          >
            <Share2 className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onSelect={() => { setTimeout(() => setShareOpen(true), 0); }}
            data-testid={`button-audio-share-nostr-${track.id}`}
          >
            <Send className="w-3.5 h-3.5" />
            Share
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onClick={handleCopyLink}
            data-testid={`button-audio-copy-link-${track.id}`}
          >
            <Copy className="w-3.5 h-3.5" />
            Copy link
          </DropdownMenuItem>
          {track.wavlakeUrl && (
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={handleOpenWavlake}
              data-testid={`button-audio-open-wavlake-${track.id}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open on Wavlake
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareTrackDialog track={track} open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}

function TrackCard({ track, tracks, onArtistClick }: { track: MusicTrack; tracks: MusicTrack[]; onArtistClick?: (artistId: string) => void }) {
  const { play, currentTrack, isPlaying, togglePlay, duration: playerDuration } = useAudioPlayer();
  const isCurrentTrack = currentTrack?.id === track.id;

  const displayArtist = track.artist || "Unknown Artist";
  const avatarUrl = track.artistAvatarUrl || track.coverUrl || "";

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(track.createdAt * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [track.createdAt]);

  const handlePlay = useCallback(() => {
    if (isCurrentTrack) {
      togglePlay();
    } else {
      play(track, tracks);
    }
  }, [isCurrentTrack, togglePlay, play, track, tracks]);

  const resolvedDuration = track.duration || (isCurrentTrack && playerDuration ? playerDuration : 0) || getCachedDuration(track.id);

  const formatDuration = formatTrackDuration;

  return (
    <Card
      className="glass-card overflow-hidden group cursor-pointer"
      onClick={handlePlay}
      data-testid={`music-card-${track.id}`}
    >
      <div className="relative aspect-square overflow-hidden">
        {track.coverUrl ? (
          <img
            src={coverArt(track.coverUrl, 320)}
            alt={track.title}
            className="w-full h-full object-cover"
            loading="lazy"
            data-testid={`img-cover-${track.id}`}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 via-muted/30 to-primary/10 flex items-center justify-center" data-testid={`img-cover-placeholder-${track.id}`}>
            <Disc3 className="w-16 h-16 text-brand/30" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent reveal-on-hover duration-300" />

        <button
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
            isCurrentTrack ? "opacity-100" : "reveal-on-hover"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            handlePlay();
          }}
          data-testid={`button-play-${track.id}`}
        >
          <div className={`w-14 h-14 rounded-full flex items-center justify-center backdrop-blur-md transition-opacity duration-200 ${
            isCurrentTrack && isPlaying
              ? "bg-primary/90"
              : "bg-black/50 border border-white/20 hover:bg-black/70"
          }`}>
            {isCurrentTrack && isPlaying ? (
              <Pause className="w-6 h-6 text-white" />
            ) : (
              <Play className="w-6 h-6 text-white ml-0.5" />
            )}
          </div>
        </button>

        {isCurrentTrack && isPlaying && (
          <div className="absolute top-2 right-2">
            <div className="flex items-end gap-[2px] h-4" data-testid={`indicator-playing-${track.id}`}>
              <div className="w-[3px] bg-primary rounded-full animate-music-bar-1" />
              <div className="w-[3px] bg-primary rounded-full animate-music-bar-2" />
              <div className="w-[3px] bg-primary rounded-full animate-music-bar-3" />
            </div>
          </div>
        )}

        {track.genre && (
          <div className="absolute top-2 left-2">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-black/50 text-white/80 backdrop-blur-sm border border-white/10" data-testid={`text-genre-${track.id}`}>
              {track.genre}
            </span>
          </div>
        )}

        {track.source === "relay-outpost" && !(isCurrentTrack && isPlaying) && (
          <div className="absolute top-2 right-2" title="Uploaded via Relay Outpost">
            <div className="w-6 h-6 rounded-full bg-black/50 backdrop-blur-sm border border-primary/30 flex items-center justify-center">
              <RelayOutpostBadge className="w-3.5 h-3.5 text-brand" />
            </div>
          </div>
        )}

        {resolvedDuration > 0 && (
          <div className="absolute bottom-2 right-2">
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-black/60 text-white/70 backdrop-blur-sm tabular-nums">
              {formatDuration(resolvedDuration)}
            </span>
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div>
          <p className="text-sm font-medium text-foreground/90 truncate" data-testid={`text-title-${track.id}`}>
            {track.title}
          </p>
          <p
            className={`text-xs text-muted-foreground/80 truncate ${onArtistClick && track.artistId ? "hover:text-brand/70 cursor-pointer" : ""}`}
            onClick={(e) => {
              if (onArtistClick && track.artistId) {
                e.stopPropagation();
                onArtistClick(track.artistId);
              }
            }}
            data-testid={`text-artist-${track.id}`}
          >
            {displayArtist}
          </p>
          {track.albumTitle && (
            <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
              {track.albumTitle}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={onArtistClick && track.artistId ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}
              onClick={(e) => {
                if (onArtistClick && track.artistId) {
                  e.stopPropagation();
                  onArtistClick(track.artistId);
                }
              }}
              data-testid={`avatar-artist-${track.id}`}
            >
              <Avatar className="w-6 h-6 border border-border/30 shrink-0">
                <AvatarImage src={avatarUrl} alt={displayArtist} />
                <AvatarFallback className="text-[8px] bg-muted">{displayArtist.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </div>
            <span className="text-[11px] text-muted-foreground/60 truncate" data-testid={`text-time-${track.id}`}>{timeAgo}</span>
          </div>

          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <AudioShareMenu track={track} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function TrackListItem({ track, tracks, index, onArtistClick }: {
  track: MusicTrack;
  tracks: MusicTrack[];
  index: number;
  onArtistClick?: (artistId: string) => void;
}) {
  const { play, currentTrack, isPlaying, togglePlay, duration: playerDuration } = useAudioPlayer();
  const isCurrentTrack = currentTrack?.id === track.id;

  const handlePlay = useCallback(() => {
    if (isCurrentTrack) {
      togglePlay();
    } else {
      play(track, tracks);
    }
  }, [isCurrentTrack, togglePlay, play, track, tracks]);

  const resolvedDuration = track.duration || (isCurrentTrack && playerDuration ? playerDuration : 0) || getCachedDuration(track.id);

  const formatDuration = (seconds: number) => {
    if (!seconds) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer group transition-colors ${
        isCurrentTrack ? "bg-primary/10" : "hover:bg-muted/30"
      }`}
      onClick={handlePlay}
      data-testid={`track-list-item-${track.id}`}
    >
      <span className="text-xs text-muted-foreground/60 w-5 text-right tabular-nums shrink-0">
        {isCurrentTrack && isPlaying ? (
          <div className="flex items-end gap-[1px] h-3 justify-center">
            <div className="w-[2px] bg-primary rounded-full animate-music-bar-1" />
            <div className="w-[2px] bg-primary rounded-full animate-music-bar-2" />
            <div className="w-[2px] bg-primary rounded-full animate-music-bar-3" />
          </div>
        ) : (
          index + 1
        )}
      </span>

      <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 relative">
        {track.coverUrl ? (
          <img src={coverArt(track.coverUrl, 128)} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-muted/30 flex items-center justify-center">
            <Disc3 className="w-5 h-5 text-muted-foreground/50" />
          </div>
        )}
        <div className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${
          isCurrentTrack ? "opacity-100" : "reveal-on-hover"
        }`}>
          {isCurrentTrack && isPlaying ? (
            <Pause className="w-4 h-4 text-white" />
          ) : (
            <Play className="w-4 h-4 text-white" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm truncate ${isCurrentTrack ? "text-brand font-medium" : "text-foreground/90"}`}>
            {track.title}
          </p>
          {track.source === "relay-outpost" && (
            <RelayOutpostBadge className="w-3.5 h-3.5 text-brand/70 shrink-0" />
          )}
        </div>
        <p
          className={`text-xs text-muted-foreground/80 truncate ${onArtistClick && track.artistId ? "hover:text-brand/70 cursor-pointer" : ""}`}
          onClick={(e) => {
            if (onArtistClick && track.artistId) {
              e.stopPropagation();
              onArtistClick(track.artistId);
            }
          }}
        >
          {track.artist}
        </p>
      </div>

      {track.transcriptUrl && (
        <span
          className="hidden sm:inline-flex items-center rounded border border-brand/20 bg-brand/5 px-1 py-px text-[9px] font-medium text-brand/70 shrink-0"
          title="This episode has a transcript — open it from the player"
        >
          Transcript
        </span>
      )}

      {track.genre && (
        <span className="text-[11px] text-muted-foreground/60 hidden sm:inline shrink-0">{track.genre}</span>
      )}

      <span className="text-xs text-muted-foreground/60 tabular-nums shrink-0">
        {formatDuration(resolvedDuration)}
      </span>
    </div>
  );
}

function SearchResultItem({ result, onArtistClick, onAlbumClick, onTrackPlay, tracks }: {
  result: WavlakeSearchResult;
  onArtistClick: (artistId: string) => void;
  onAlbumClick?: (albumId: string, title?: string) => void;
  onTrackPlay?: (track: MusicTrack, tracks: MusicTrack[]) => void;
  tracks: MusicTrack[];
}) {
  const { play, currentTrack, isPlaying, togglePlay } = useAudioPlayer();

  if (result.type === "artist") {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => onArtistClick(result.id)}
        data-testid={`search-result-artist-${result.id}`}
      >
        <Avatar className="w-11 h-11 border border-border/30 shrink-0">
          <AvatarImage src={result.avatarUrl} alt={result.name || ""} />
          <AvatarFallback className="text-xs bg-muted"><User className="w-4 h-4" /></AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/90 truncate">{result.name}</p>
          <p className="text-xs text-muted-foreground/70">Artist</p>
        </div>
        <ArrowLeft className="w-4 h-4 text-muted-foreground/50 rotate-180 shrink-0" />
      </div>
    );
  }

  if (result.type === "album") {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => onAlbumClick?.(result.id, result.name || result.title)}
        data-testid={`search-result-album-${result.id}`}
      >
        <div className="w-11 h-11 rounded-md overflow-hidden shrink-0">
          {result.artworkUrl ? (
            <img src={coverArt(result.artworkUrl, 160)} alt={result.name || ""} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-muted/30 flex items-center justify-center">
              <Disc className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/90 truncate">{result.name}</p>
          <p className="text-xs text-muted-foreground/70 truncate">{result.artist ? `${result.artist} · ` : ""}Album</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
      </div>
    );
  }

  if (result.type === "track" && result.liveUrl) {
    const musicTrack: MusicTrack = {
      id: result.id,
      title: result.title || result.name || "Untitled",
      artist: result.artist || "Unknown Artist",
      artistPubkey: "",
      audioUrl: result.liveUrl,
      coverUrl: result.artworkUrl || "",
      description: "",
      genre: "",
      duration: result.duration || 0,
      createdAt: Math.floor(Date.now() / 1000),
      albumTitle: result.albumTitle || undefined,
      artistAvatarUrl: result.avatarUrl || undefined,
    };

    const isCurrentTrack = currentTrack?.id === result.id;

    return (
      <div
        className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
          isCurrentTrack ? "bg-primary/10" : "hover:bg-muted/30"
        }`}
        onClick={() => {
          if (isCurrentTrack) {
            togglePlay();
          } else {
            play(musicTrack, [musicTrack, ...tracks]);
          }
        }}
        data-testid={`search-result-track-${result.id}`}
      >
        <div className="w-11 h-11 rounded-md overflow-hidden shrink-0 relative">
          {result.artworkUrl ? (
            <img src={coverArt(result.artworkUrl, 160)} alt={result.title || ""} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-muted/30 flex items-center justify-center">
              <Music className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-100 sm:opacity-0 sm:hover:opacity-100 transition-opacity">
            {isCurrentTrack && isPlaying ? (
              <Pause className="w-4 h-4 text-white" />
            ) : (
              <Play className="w-4 h-4 text-white" />
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm truncate ${isCurrentTrack ? "text-brand font-medium" : "text-foreground/90"}`}>{result.title || result.name}</p>
          <p className="text-xs text-muted-foreground/70 truncate">{result.artist} {result.albumTitle ? `\u00B7 ${result.albumTitle}` : ""}</p>
        </div>
      </div>
    );
  }

  return null;
}

function AlbumCard({ album, onAlbumClick }: { album: WavlakeAlbum; onAlbumClick: (albumId: string) => void }) {
  return (
    <div
      className="cursor-pointer group"
      onClick={() => onAlbumClick(album.id)}
      data-testid={`album-card-${album.id}`}
    >
      <div className="relative aspect-square rounded-md overflow-hidden mb-2">
        {album.artworkUrl ? (
          <img src={coverArt(album.artworkUrl, 256)} alt={album.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 via-muted/30 to-primary/10 flex items-center justify-center">
            <Disc className="w-10 h-10 text-brand/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 reveal-on-hover flex items-center justify-center">
          <Play className="w-8 h-8 text-white" />
        </div>
      </div>
      <p className="text-sm font-medium text-foreground/90 truncate">{album.title}</p>
      {album.description && (
        <p className="text-[11px] text-muted-foreground/60 truncate">{album.description}</p>
      )}
    </div>
  );
}

function ArtistCard({ artist, onClick }: { artist: UniqueArtistInfo; onClick: (id: string) => void }) {
  return (
    <div
      className="flex flex-col items-center text-center cursor-pointer group p-3"
      onClick={() => onClick(artist.id)}
      data-testid={`artist-card-${artist.id}`}
    >
      <div className="relative">
        <Avatar className="w-20 h-20 sm:w-24 sm:h-24 border-2 border-border/30 mb-2 group-hover:border-primary/40 transition-colors">
          <AvatarImage src={artist.avatarUrl} alt={artist.name} />
          <AvatarFallback className="text-lg bg-muted">{artist.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        {artist.hasV4V && (
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/90 text-white whitespace-nowrap flex items-center gap-0.5">
            <Zap className="w-2.5 h-2.5" />
            V4V
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-foreground/90 truncate w-full">{artist.name}</p>
      {artist.genres.length > 0 && (
        <p className="text-[11px] text-muted-foreground/60 truncate w-full">{artist.genres.slice(0, 2).join(" / ")}</p>
      )}
    </div>
  );
}

function TrendingPodcastCard({ podcast, onSelect }: { podcast: TrendingPodcast; onSelect: (podcast: TrendingPodcast) => void }) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/30 transition-colors border border-border/20"
      onClick={() => onSelect(podcast)}
      data-testid={`trending-podcast-${podcast.id}`}
    >
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden shrink-0 bg-muted/20">
        {podcast.image ? (
          <img src={coverArt(podcast.image, 256)} alt={podcast.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Radio className="w-6 h-6 text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground/90 truncate">{podcast.title}</p>
        <p className="text-xs text-muted-foreground/70 truncate">{podcast.author}</p>
        <div className="flex items-center gap-2 mt-1">
          {podcast.episodeCount > 0 && (
            <span className="text-[10px] text-muted-foreground/50">{podcast.episodeCount} episodes</span>
          )}
          {podcast.categories.length > 0 && (
            <span className="text-[10px] text-muted-foreground/50 truncate">{podcast.categories.slice(0, 2).join(", ")}</span>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
    </div>
  );
}

function TrendingPodcastEpisodes({ podcast, onBack }: { podcast: TrendingPodcast; onBack: () => void }) {
  const [episodes, setEpisodes] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!podcast.url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchPodcastFromRSS(podcast.url, "", 20).then((tracks) => {
      setEpisodes(tracks);
      setLoading(false);
    });
  }, [podcast.url]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <RelayOutpostLoader size="md" label="Loading episodes..." />
      </div>
    );
  }

  return (
    <div data-testid="container-trending-podcast-episodes">
      <div className="flex items-start gap-3 mb-4 p-3 rounded-lg glass-card border">
        {podcast.image && (
          <img src={coverArt(podcast.image, 128)} alt={podcast.title} width={64} height={64} loading="lazy" className="w-16 h-16 rounded-lg object-cover shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="text-muted-foreground/70 hover:text-foreground/80 transition-colors shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <p className="text-sm font-semibold text-foreground/90 truncate">{podcast.title}</p>
          </div>
          <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{podcast.author}</p>
          {podcast.description && (
            <p className="text-[11px] text-muted-foreground/50 line-clamp-2 mt-1">{podcast.description}</p>
          )}
        </div>
      </div>
      {episodes.length > 0 ? (
        <div className="space-y-0.5">
          {episodes.map((ep, i) => (
            <TrackListItem key={ep.id} track={ep} tracks={episodes} index={i} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/70 text-center py-8">No episodes found</p>
      )}
    </div>
  );
}

function AlbumDetailView({ albumId, albumTitle, onBack, onArtistClick }: { albumId: string; albumTitle?: string; onBack: () => void; onArtistClick?: (artistId: string) => void }) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const { play } = useAudioPlayer();

  useEffect(() => {
    setLoading(true);
    fetchAlbumTracks(albumId).then((t) => {
      setTracks(t);
      setLoading(false);
    });
  }, [albumId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RelayOutpostLoader size="lg" label="Loading album..." />
      </div>
    );
  }

  return (
    <div data-testid="container-album-detail">
      {tracks.length > 0 && (
        <div className="flex items-end gap-4 mb-6">
          <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-md overflow-hidden shrink-0 shadow-lg bg-muted/30 flex items-center justify-center">
            {tracks[0].coverUrl ? (
              <img src={tracks[0].coverUrl} alt={albumTitle || "Album"} className="w-full h-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <Disc3 className="w-12 h-12 text-muted-foreground/40" />
            )}
          </div>
          <div className="min-w-0 pb-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">Album</p>
            <h3 className="text-lg font-bold tracking-tight truncate" data-testid="text-album-title">{albumTitle || "Unknown Album"}</h3>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => play(tracks[0], tracks)}
                data-testid="button-play-album"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Play All
              </Button>
              <ShareLinkButton
                url={`${window.location.origin}/audio?album=${encodeURIComponent(albumId)}${albumTitle ? `&albumTitle=${encodeURIComponent(albumTitle)}` : ""}`}
                title={albumTitle || "Album"}
                subtitle={tracks[0]?.artist}
                coverUrl={tracks[0]?.coverUrl}
                kind="album"
                artistPubkey={tracks[0]?.artistPubkey}
                testIdSuffix={albumId}
              />
            </div>
          </div>
        </div>
      )}

      {tracks.length > 0 ? (
        <div className="space-y-0.5" data-testid="container-album-tracks">
          {tracks.map((track, i) => (
            <TrackListItem key={track.id} track={track} tracks={tracks} index={i} onArtistClick={onArtistClick} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/70 text-center py-8">No tracks in this album</p>
      )}
    </div>
  );
}

function ArtistDetailView({ artistId, onBack, onArtistClick, onAlbumClick }: { artistId: string; onBack: () => void; onArtistClick: (id: string) => void; onAlbumClick: (albumId: string, title?: string) => void }) {
  const [artist, setArtist] = useState<WavlakeArtist | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [albums, setAlbums] = useState<WavlakeAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const { play } = useAudioPlayer();
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    setShowAllTracks(false);
    fetchWavlakeArtist(artistId).then((a) => {
      if (a) {
        setArtist(a);
        setTracks(getArtistTracks(a));
        setAlbums(getArtistAlbums(a));
      }
      setLoading(false);
    });
  }, [artistId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RelayOutpostLoader size="lg" label="Loading artist..." />
      </div>
    );
  }

  if (!artist) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <p className="text-sm text-muted-foreground">Artist not found</p>
        <Button variant="outline" size="sm" onClick={onBack} data-testid="button-back-artist">Go Back</Button>
      </div>
    );
  }

  const displayedTracks = showAllTracks ? tracks : tracks.slice(0, 5);
  const wavlakeProfileUrl = artist.artistUrl ? `https://wavlake.com/${artist.artistUrl}` : null;
  const hasNostrProfile = !!artist.npub;
  const hasSocials = artist.twitter || artist.instagram || artist.youtube || artist.website;

  const artistPubkeyHex = (() => {
    if (!artist.npub) return undefined;
    try {
      const decoded = nip19.decode(artist.npub);
      if (decoded.type === "npub") return decoded.data as string;
    } catch {}
    return undefined;
  })();
  const artistShareUrl = `${window.location.origin}/audio?artist=${encodeURIComponent(artistId)}`;

  return (
    <div data-testid="container-artist-detail">
      <div className="relative mb-6">
        {artist.artworkUrl && (
          <div className="absolute inset-0 -mx-2 sm:-mx-4 -mt-4 h-40 overflow-hidden">
            <img src={artist.artworkUrl} alt="" className="w-full h-full object-cover blur-2xl opacity-20 scale-110" loading="lazy" decoding="async" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
          </div>
        )}

        <div className="relative flex flex-col sm:flex-row items-center sm:items-end gap-4 pt-6">
          <Avatar className="w-28 h-28 sm:w-32 sm:h-32 border-2 border-border/30 shrink-0 shadow-xl">
            <AvatarImage src={artist.artworkUrl} alt={artist.name} />
            <AvatarFallback className="text-3xl bg-muted">{artist.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-center sm:text-left pb-1 flex-1">
            {artist.verified && (
              <span className="text-[11px] font-medium text-brand/70 uppercase tracking-wider">Verified Artist</span>
            )}
            <h2 className="text-2xl font-bold tracking-tight truncate" data-testid="text-artist-name">{artist.name}</h2>
            {artist.bio && (
              <p className="text-xs text-muted-foreground/80 line-clamp-3 mt-1 max-w-md">{artist.bio}</p>
            )}
            <div className="flex items-center justify-center sm:justify-start gap-1 mt-1">
              <span className="text-[11px] text-muted-foreground/60">
                {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
              </span>
              {albums.length > 0 && (
                <>
                  <span className="text-[11px] text-muted-foreground/50">·</span>
                  <span className="text-[11px] text-muted-foreground/60">
                    {albums.length} {albums.length === 1 ? "album" : "albums"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6" data-testid="container-artist-actions">
        {tracks.length > 0 && (
          <Button
            variant="default"
            size="sm"
            onClick={() => play(tracks[0], tracks)}
            data-testid="button-play-all"
          >
            <Play className="w-3.5 h-3.5 mr-1.5" />
            Play All
          </Button>
        )}
        {tracks.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const shuffled = [...tracks].sort(() => Math.random() - 0.5);
              play(shuffled[0], shuffled);
            }}
            data-testid="button-shuffle"
          >
            <Shuffle className="w-3.5 h-3.5 mr-1.5" />
            Shuffle
          </Button>
        )}
        {wavlakeProfileUrl && (
          <a href={wavlakeProfileUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" data-testid="button-view-wavlake">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Wavlake
            </Button>
          </a>
        )}
        {hasNostrProfile && (
          <Link href={`/profile/${artist.npub}`}>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-nostr-profile"
            >
              <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
              Nostr Profile
            </Button>
          </Link>
        )}
        <ShareLinkButton
          url={artistShareUrl}
          title={artist.name}
          coverUrl={artist.artworkUrl}
          kind="artist"
          artistPubkey={artistPubkeyHex}
          testIdSuffix={artistId}
        />
      </div>

      {(hasSocials) && (
        <div className="flex flex-wrap items-center gap-2 mb-6 px-1" data-testid="container-artist-socials">
          {artist.twitter && (
            <a href={artist.twitter.startsWith("http") ? artist.twitter : `https://x.com/${artist.twitter.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground/70 hover:text-foreground/70 transition-colors" data-testid="link-twitter">
              @{artist.twitter.replace(/^@/, "").replace(/^https?:\/\/(x\.com|twitter\.com)\//, "")}
            </a>
          )}
          {artist.instagram && (
            <a href={artist.instagram.startsWith("http") ? artist.instagram : `https://instagram.com/${artist.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground/70 hover:text-foreground/70 transition-colors" data-testid="link-instagram">
              Instagram
            </a>
          )}
          {artist.youtube && (
            <a href={artist.youtube.startsWith("http") ? artist.youtube : `https://youtube.com/${artist.youtube}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground/70 hover:text-foreground/70 transition-colors" data-testid="link-youtube">
              YouTube
            </a>
          )}
          {artist.website && (
            <a href={artist.website.startsWith("http") ? artist.website : `https://${artist.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground/70 transition-colors" data-testid="link-website">
              <Globe className="w-3 h-3" />
              Website
            </a>
          )}
        </div>
      )}

      {albums.length > 0 && (
        <div className="mb-6" data-testid="container-artist-albums">
          <h3 className="text-sm font-semibold text-foreground/80 mb-3 px-1">Albums</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} onAlbumClick={(id) => onAlbumClick(id, album.title)} />
            ))}
          </div>
        </div>
      )}

      {tracks.length > 0 ? (
        <div data-testid="container-artist-tracks">
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="text-sm font-semibold text-foreground/80">Top Tracks</h3>
            {tracks.length > 5 && (
              <button
                onClick={() => setShowAllTracks(!showAllTracks)}
                className="text-[11px] text-muted-foreground/70 hover:text-foreground/70 transition-colors flex items-center gap-1"
                data-testid="button-toggle-all-tracks"
              >
                {showAllTracks ? "Show less" : `See all ${tracks.length}`}
                <ChevronRight className={`w-3 h-3 transition-transform ${showAllTracks ? "rotate-90" : ""}`} />
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {displayedTracks.map((track, i) => (
              <TrackListItem
                key={track.id}
                track={track}
                tracks={tracks}
                index={i}
                onArtistClick={onArtistClick}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/70 text-center py-8">No tracks available</p>
      )}
    </div>
  );
}

function BrowseGenres({ onGenreSelect }: { onGenreSelect: (genre: typeof BROWSE_GENRES[number]) => void }) {
  return (
    <div data-testid="container-browse-genres">
      <h3 className="text-sm font-semibold text-foreground/80 mb-3 px-1">Browse by Genre</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {BROWSE_GENRES.map((genre) => {
          const IconComponent = GENRE_ICON_MAP[genre.icon] || Music;
          const colorIndex = BROWSE_GENRES.indexOf(genre);
          const colors = [
            "from-brand/40 to-brand/20 border-brand/20",
            "from-amber-900/40 to-orange-900/20 border-amber-700/20",
            "from-cyan-900/40 to-teal-900/20 border-cyan-700/20",
            "from-blue-900/40 to-sky-900/20 border-blue-700/20",
            "from-emerald-900/40 to-green-900/20 border-emerald-700/20",
            "from-lime-900/40 to-green-900/20 border-lime-700/20",
            "from-yellow-900/40 to-amber-900/20 border-yellow-700/20",
            "from-brand/40 to-blue-900/20 border-brand/20",
            "from-red-900/40 to-rose-900/20 border-red-700/20",
            "from-brand/40 to-brand/20 border-brand/20",
            "from-slate-800/40 to-gray-900/20 border-slate-700/20",
            "from-pink-900/40 to-rose-900/20 border-pink-700/20",
            "from-sky-900/40 to-blue-900/20 border-sky-700/20",
            "from-teal-900/40 to-cyan-900/20 border-teal-700/20",
            "from-orange-900/40 to-red-900/20 border-orange-700/20",
            "from-brand/40 to-pink-900/20 border-brand/20",
          ];
          const color = colors[colorIndex % colors.length];

          return (
            <button
              key={genre.label}
              onClick={() => onGenreSelect(genre)}
              className={`flex items-center gap-3 p-3 rounded-md bg-gradient-to-br ${color} border hover-elevate transition-all text-left`}
              data-testid={`button-genre-${genre.label.toLowerCase().replace(/[^a-z]/g, "")}`}
            >
              <IconComponent className="w-5 h-5 text-foreground/80 shrink-0" />
              <span className="text-sm font-medium text-foreground/80 truncate">{genre.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AudioFeed({ embedded = false }: { embedded?: boolean } = {}) {
  useDocumentTitle("Audio");
  useEffect(() => { ensureWavlakeMapLoaded(); }, []);
  const [view, setView] = useState<FeedView>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("artist")) return "artist-detail";
    if (params.get("album")) return "album-detail";
    // First-time visitors land on Artists so they immediately see who's
    // publishing on Nostr. Subsequent visits fall back to New Releases.
    try {
      const VISITED_KEY = "relay-outpost-audio-visited";
      if (!localStorage.getItem(VISITED_KEY)) {
        localStorage.setItem(VISITED_KEY, "1");
        return "artists";
      }
    } catch {}
    return "new";
  });
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WavlakeSearchResult[]>([]);
  const [searchTracks, setSearchTracks] = useState<MusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("artist") || null;
  });
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [genreTracks, setGenreTracks] = useState<MusicTrack[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [noMoreResults, setNoMoreResults] = useState(false);
  const podcastSearchIndexRef = useRef(0);

  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("album") || null;
  });
  const [selectedAlbumTitle, setSelectedAlbumTitle] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("albumTitle") || undefined;
  });
  const [artistsList, setArtistsList] = useState<UniqueArtistInfo[]>([]);
  const [isLoadingArtists, setIsLoadingArtists] = useState(false);
  const [artistGenreFilter, setArtistGenreFilter] = useState<string | null>(null);
  const [podcastCategoryFilter, setPodcastCategoryFilter] = useState<string | null>(null);
  const [trendingPodcasts, setTrendingPodcasts] = useState<TrendingPodcast[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(false);
  const [selectedTrendingPodcast, setSelectedTrendingPodcast] = useState<TrendingPodcast | null>(null);
  const trendingFetchedRef = useRef(false);

  const isFirstUrlSyncRef = useRef(true);
  useEffect(() => {
    // When embedded in the Search Media hub we must NOT touch the URL — it owns
    // ?tab=media&type=audio, and rewriting it would bounce Search to another tab.
    // Artist/album navigation runs purely on React state instead.
    if (embedded) return;
    const params = new URLSearchParams(window.location.search);
    const currentArtist = params.get("artist");
    const currentAlbum = params.get("album");
    const currentAlbumTitle = params.get("albumTitle");

    let nextArtist: string | null = null;
    let nextAlbum: string | null = null;
    let nextAlbumTitle: string | null = null;

    if (view === "artist-detail" && selectedArtistId) {
      nextArtist = selectedArtistId;
    } else if (view === "album-detail" && selectedAlbumId) {
      nextAlbum = selectedAlbumId;
      nextAlbumTitle = selectedAlbumTitle || null;
    }

    const matches =
      currentArtist === nextArtist &&
      currentAlbum === nextAlbum &&
      (currentAlbumTitle || null) === nextAlbumTitle;

    if (matches) {
      isFirstUrlSyncRef.current = false;
      return;
    }

    params.delete("artist");
    params.delete("album");
    params.delete("albumTitle");
    if (nextArtist) params.set("artist", nextArtist);
    if (nextAlbum) {
      params.set("album", nextAlbum);
      if (nextAlbumTitle) params.set("albumTitle", nextAlbumTitle);
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;

    if (isFirstUrlSyncRef.current) {
      isFirstUrlSyncRef.current = false;
      window.history.replaceState(window.history.state, "", url);
    } else {
      window.history.pushState({}, "", url);
      inAppHistoryDepthRef.current += 1;
    }
  }, [view, selectedArtistId, selectedAlbumId, selectedAlbumTitle]);

  useEffect(() => {
    if (embedded) return; // parent Search owns browser history when embedded
    const onPopState = () => {
      if (inAppHistoryDepthRef.current > 0) {
        inAppHistoryDepthRef.current -= 1;
      }
      const params = new URLSearchParams(window.location.search);
      const artist = params.get("artist");
      const album = params.get("album");
      const albumTitle = params.get("albumTitle") || undefined;

      if (artist) {
        setSelectedArtistId(artist);
        setSelectedAlbumId(null);
        setSelectedAlbumTitle(undefined);
        setView("artist-detail");
      } else if (album) {
        setSelectedAlbumId(album);
        setSelectedAlbumTitle(albumTitle);
        setSelectedArtistId(null);
        setView("album-detail");
      } else {
        setSelectedArtistId(null);
        setSelectedAlbumId(null);
        setSelectedAlbumTitle(undefined);
        setView((prev) => {
          if (prev === "artist-detail" || prev === "album-detail") {
            return lastFeedViewRef.current;
          }
          return prev;
        });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<"grid" | "list">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "grid"
  );
  const hasUserToggledView = useRef(false);

  useEffect(() => {
    if (isMobile && viewMode === "grid" && !hasUserToggledView.current) {
      setViewMode("list");
    }
  }, [isMobile]);


  const viewHistoryRef = useRef<FeedView[]>([]);
  const lastFeedViewRef = useRef<FeedView>(
    view === "artist-detail" || view === "album-detail" ? "new" : view
  );
  const inAppHistoryDepthRef = useRef(0);

  useEffect(() => {
    if (view !== "artist-detail" && view !== "album-detail") {
      lastFeedViewRef.current = view;
    }
  }, [view]);

  const artistGenres = useMemo(() => {
    const genreSet = new Set<string>();
    artistsList.forEach(a => a.genres.forEach(g => { if (g) genreSet.add(g); }));
    return Array.from(genreSet).sort((a, b) => a.localeCompare(b));
  }, [artistsList]);

  const filteredArtists = useMemo(() => {
    if (!artistGenreFilter) return artistsList;
    return artistsList.filter(a => a.genres.some(g => g.toLowerCase() === artistGenreFilter!.toLowerCase()));
  }, [artistsList, artistGenreFilter]);

  const podcastGenres = useMemo(() => {
    if (view !== "podcasts") return [];
    const genreSet = new Set<string>();
    tracks.forEach(t => { if (t.genre) genreSet.add(t.genre); });
    trendingPodcasts.forEach(p => {
      p.categories.forEach(c => { if (c) genreSet.add(c); });
    });
    return Array.from(genreSet).sort((a, b) => a.localeCompare(b));
  }, [tracks, view, trendingPodcasts]);

  const filteredPodcasts = useMemo(() => {
    if (view !== "podcasts" || !podcastCategoryFilter) return tracks;
    return tracks.filter(t => t.genre?.toLowerCase() === podcastCategoryFilter!.toLowerCase());
  }, [tracks, podcastCategoryFilter, view]);

  const MIN_TRACK_DURATION = 60;

  const isQualityTrack = useCallback((t: MusicTrack) => {
    if (!t.coverUrl) return false;
    if (t.duration > 0 && t.duration < MIN_TRACK_DURATION) return false;
    return true;
  }, []);

  const fetchTracks = useCallback(async (feedView: FeedView, append = false) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setError(null);
      setNoMoreResults(false);
    }
    try {
      let result: MusicTrack[];
      switch (feedView) {
        case "new": {
          const settled = await Promise.allSettled([
            fetchWavlakeNewTracks(),
            fetchWavlakeTrendingTracks(),
            fetchNostrMusicTracks(50),
          ]);
          const allTracks: MusicTrack[] = [];
          for (const s of settled) {
            if (s.status === "fulfilled") allTracks.push(...s.value);
          }
          const seen = new Set<string>();
          const merged: MusicTrack[] = [];
          for (const t of allTracks) {
            if (!seen.has(t.id)) {
              seen.add(t.id);
              merged.push(t);
            }
          }
          result = merged.filter(isQualityTrack).sort((a, b) => b.createdAt - a.createdAt);
          break;
        }
        case "podcasts":
          if (append) {
            podcastSearchIndexRef.current += 1;
          } else {
            podcastSearchIndexRef.current = 0;
          }
          result = await fetchWavlakePodcasts(podcastSearchIndexRef.current);
          break;
        default:
          result = [];
      }
      if (append) {
        setTracks(prev => {
          const existingIds = new Set(prev.map(t => t.id));
          const newTracks = result.filter(t => !existingIds.has(t.id));
          if (newTracks.length === 0) {
            setNoMoreResults(true);
          }
          return [...prev, ...newTracks];
        });
      } else {
        setTracks(result);
      }
    } catch (err) {
      console.error("Failed to fetch tracks:", err);
      if (!append) setError("Failed to load music. Please try again.");
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [isQualityTrack]);

  useEffect(() => {
    if (view === "new" || view === "podcasts") {
      fetchTracks(view);
    }
    if (view === "podcasts" && (!trendingFetchedRef.current || trendingPodcasts.length === 0)) {
      trendingFetchedRef.current = true;
      setIsLoadingTrending(true);
      fetchPodcastIndexTrending().then((pods) => {
        setTrendingPodcasts(pods);
        setIsLoadingTrending(false);
      });
    }
    if (view !== "podcasts") {
      setPodcastCategoryFilter(null);
      setSelectedTrendingPodcast(null);
    }
    if (view !== "artists") setArtistGenreFilter(null);
  }, [view, fetchTracks]);


  const navigateTo = useCallback((newView: FeedView) => {
    viewHistoryRef.current.push(view);
    setView(newView);
  }, [view]);

  const goBack = useCallback(() => {
    if (view === "artist-detail" || view === "album-detail") {
      if (inAppHistoryDepthRef.current > 0) {
        window.history.back();
      } else {
        setSelectedArtistId(null);
        setSelectedAlbumId(null);
        setSelectedAlbumTitle(undefined);
        setView(lastFeedViewRef.current);
      }
      return;
    }
    const prev = viewHistoryRef.current.pop();
    if (prev) {
      setView(prev);
    } else {
      setView("new");
    }
    setSelectedArtistId(null);
    setSelectedGenre(null);
    setSelectedAlbumId(null);
    setSelectedAlbumTitle(undefined);
  }, [view]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!query.trim()) {
      setSearchResults([]);
      setSearchTracks([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const [results, trackResults] = await Promise.all([
          searchWavlake(query),
          searchWavlakeTracks(query),
        ]);
        setSearchResults(results);
        setSearchTracks(trackResults);
        if (view !== "search-results") {
          navigateTo("search-results");
        }
      } catch {
        setSearchResults([]);
        setSearchTracks([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  }, [view, navigateTo]);

  const handleArtistClick = useCallback((artistId: string) => {
    if (artistId.startsWith("pubkey:")) {
      const hex = artistId.replace("pubkey:", "");
      try {
        const npub = nip19.npubEncode(hex);
        window.location.href = `/profile/${npub}`;
      } catch {
        setSelectedArtistId(artistId);
        navigateTo("artist-detail");
      }
      return;
    }
    setSelectedArtistId(artistId);
    navigateTo("artist-detail");
  }, [navigateTo]);

  const handleAlbumClick = useCallback((albumId: string, title?: string) => {
    setSelectedAlbumId(albumId);
    setSelectedAlbumTitle(title);
    navigateTo("album-detail");
  }, [navigateTo]);

  const handleGenreSelect = useCallback(async (genre: typeof BROWSE_GENRES[number]) => {
    setSelectedGenre(genre.label);
    setNoMoreResults(false);
    navigateTo("genre-results");
    setIsLoading(true);
    try {
      const results = await searchWavlakeTracks(genre.searchTerm);
      setGenreTracks(results);
    } catch {
      setGenreTracks([]);
    } finally {
      setIsLoading(false);
    }
  }, [navigateTo]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchTracks([]);
    if (view === "search-results") {
      goBack();
    }
    searchInputRef.current?.focus();
  }, [view, goBack]);

  const showingFeedView = view === "new" || view === "podcasts";
  const showBackButton = view === "artist-detail" || view === "genre-results" || view === "search-results" || view === "album-detail";
  const isTopLevelView = !showBackButton;
  // Hoisted out of the old tabs-row IIFE so the mobile source Select (now inline
  // in the search row) and the desktop tabs share them.
  const selectArtists = () => {
    viewHistoryRef.current = [];
    setView("artists");
    if (artistsList.length === 0 && !isLoadingArtists) {
      setIsLoadingArtists(true);
      Promise.allSettled([
        fetchPopularArtists(),
        fetchNostrMusicTracks(50).then(nostrTracks => extractUniqueArtists(nostrTracks)),
      ]).then((results) => {
        const allArtists: UniqueArtistInfo[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") allArtists.push(...r.value);
        }
        const seen = new Set<string>();
        const deduped: UniqueArtistInfo[] = [];
        for (const a of allArtists) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            deduped.push(a);
          }
        }
        setArtistsList(deduped.sort((x, y) => x.name.localeCompare(y.name)));
        setIsLoadingArtists(false);
      });
    }
  };
  const selectTab = (next: "new" | "browse" | "artists" | "podcasts") => {
    if (next === "artists") {
      selectArtists();
    } else {
      viewHistoryRef.current = [];
      setView(next);
    }
  };

  return (
    <div className={embedded ? "" : "px-3 sm:px-4 py-4 sm:py-6"} data-testid="page-audio-feed">
      <div className={embedded ? "" : "max-w-5xl mx-auto"}>
        {/* Header row only where it carries information: standalone page (title)
            or a detail view (back + contextual title). Embedded top-level views
            skip it entirely — the hub chip already says "Audio", and the grid
            toggle rides the search row below instead. */}
        {(!embedded || showBackButton) && (
        <div className="flex items-center gap-3 mb-4">
          {showBackButton && (
            <button
              onClick={goBack}
              className="flex items-center justify-center w-9 h-9 rounded-md hover:bg-muted/30 transition-colors shrink-0"
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
            <Headphones className="w-5 h-5 text-brand/70" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground" data-testid="text-page-title">
              {view === "artist-detail" ? "Artist" :
               view === "album-detail" ? "Album" :
               view === "genre-results" ? selectedGenre || "Genre" :
               view === "search-results" ? "Search" :
               view === "artists" ? "Artists" :
               "Audio"}
            </h1>
            <p className="text-xs text-muted-foreground/70" data-testid="text-audio-count">
            </p>
          </div>
          {view !== "artist-detail" && view !== "album-detail" && view !== "search-results" && view !== "browse" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { hasUserToggledView.current = true; setViewMode(viewMode === "grid" ? "list" : "grid"); }}
              className="text-muted-foreground/80 shrink-0 ml-auto"
              data-testid="button-toggle-view-mode"
            >
              {viewMode === "grid" ? <LayoutList className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </Button>
          )}
        </div>
        )}

        {/* ONE control row: [search] [grid toggle] — the view switcher is a
            PageTabs row below (all breakpoints; the old mobile Select is gone). */}
        <div className="mb-4 flex items-center gap-2" data-testid="container-search">
          <SearchPill
            ref={searchInputRef}
            containerClassName="flex-1 min-w-0"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search"
            data-testid="input-search"
            trailing={(searchQuery || isSearching) ? (
              <span className="flex items-center">
                {isSearching && <RelayOutpostInlineLoader className="w-4 h-4 mr-1" />}
                {searchQuery && (
                  <button
                    onClick={clearSearch}
                    className="p-2 rounded-full text-muted-foreground/60 hover:text-foreground/70 hover:bg-muted/50 transition-colors"
                    data-testid="button-clear-search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </span>
            ) : undefined}
          />
          {embedded && !showBackButton && view !== "browse" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { hasUserToggledView.current = true; setViewMode(viewMode === "grid" ? "list" : "grid"); }}
              className="text-muted-foreground/80 shrink-0"
              data-testid="button-toggle-view-mode"
            >
              {viewMode === "grid" ? <LayoutList className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </Button>
          )}
        </div>

        {isTopLevelView && (
          <PageTabs
            className="mb-5"
            equalWidth={false}
            testId="container-feed-tabs"
            ariaLabel="Audio views"
            active={view === "new" || view === "browse" || view === "artists" || view === "podcasts" ? view : "new"}
            onChange={(key) => selectTab(key as "new" | "browse" | "artists" | "podcasts")}
            tabs={[
              { key: "new", label: "New Releases", icon: Clock, testId: "button-tab-new" },
              { key: "browse", label: "Browse", icon: Disc3, testId: "button-tab-browse" },
              { key: "artists", label: "Artists", icon: Users, testId: "button-tab-artists" },
              { key: "podcasts", label: "Podcasts", icon: Radio, testId: "button-tab-podcasts" },
            ]}
          />
        )}

        {view === "search-results" && (
          <div data-testid="container-search-results">
            {searchResults.length === 0 && !isSearching ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-2">
                <Search className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground/70">
                  {searchQuery ? `No results for "${searchQuery}"` : "Type to search"}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {searchResults.filter(r => r.type === "artist").length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider px-1 mb-2">Artists</p>
                    <div className="space-y-0.5">
                      {searchResults.filter(r => r.type === "artist").map(r => (
                        <SearchResultItem key={r.id} result={r} onArtistClick={handleArtistClick} onAlbumClick={handleAlbumClick} tracks={searchTracks} />
                      ))}
                    </div>
                  </div>
                )}
                {searchResults.filter(r => r.type === "track").length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider px-1 mb-2">Tracks</p>
                    <div className="space-y-0.5">
                      {searchResults.filter(r => r.type === "track").map(r => (
                        <SearchResultItem key={r.id} result={r} onArtistClick={handleArtistClick} onAlbumClick={handleAlbumClick} tracks={searchTracks} />
                      ))}
                    </div>
                  </div>
                )}
                {searchResults.filter(r => r.type === "album").length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider px-1 mb-2">Albums</p>
                    <div className="space-y-0.5">
                      {searchResults.filter(r => r.type === "album").map(r => (
                        <SearchResultItem key={r.id} result={r} onArtistClick={handleArtistClick} onAlbumClick={handleAlbumClick} tracks={searchTracks} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {view === "artist-detail" && selectedArtistId && (
          <ArtistDetailView
            artistId={selectedArtistId}
            onBack={goBack}
            onArtistClick={handleArtistClick}
            onAlbumClick={handleAlbumClick}
          />
        )}

        {view === "album-detail" && selectedAlbumId && (
          <AlbumDetailView
            albumId={selectedAlbumId}
            albumTitle={selectedAlbumTitle}
            onBack={goBack}
            onArtistClick={handleArtistClick}
          />
        )}

        {view === "artists" && (
          <div data-testid="container-artists-grid">
            {isLoadingArtists ? (
              <div className="flex flex-col items-center justify-center py-20">
                <RelayOutpostLoader size="lg" label="Loading artists..." />
              </div>
            ) : artistsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-2">
                <Users className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground/70">No artists found</p>
              </div>
            ) : (
              <>
                {artistGenres.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-3 mb-4 scrollbar-hide" data-testid="container-artist-genre-filters">
                    <Button
                      variant={artistGenreFilter === null ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setArtistGenreFilter(null)}
                      className={artistGenreFilter === null ? "" : "text-muted-foreground/80"}
                      data-testid="button-artist-filter-all"
                    >
                      All
                    </Button>
                    {artistGenres.map(g => (
                      <Button
                        key={g}
                        variant={artistGenreFilter === g ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setArtistGenreFilter(artistGenreFilter === g ? null : g)}
                        className={`shrink-0 ${artistGenreFilter === g ? "" : "text-muted-foreground/80"}`}
                        data-testid={`button-artist-filter-${g.toLowerCase().replace(/[^a-z]/g, "")}`}
                      >
                        {g}
                      </Button>
                    ))}
                  </div>
                )}
                {filteredArtists.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-2">
                    <Users className="w-6 h-6 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground/70">No artists match this genre</p>
                  </div>
                ) : viewMode === "list" ? (
                  <div className="space-y-0.5" data-testid="container-artists-list">
                    {filteredArtists.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover-elevate transition-colors"
                        onClick={() => handleArtistClick(a.id)}
                        data-testid={`artist-row-${a.id}`}
                      >
                        <Avatar className="w-9 h-9 border border-border/30 shrink-0">
                          <AvatarImage src={a.avatarUrl} alt={a.name} />
                          <AvatarFallback className="text-xs bg-muted">{a.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm text-foreground/90 truncate">{a.name}</p>
                            {a.hasV4V && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/90 text-white whitespace-nowrap flex items-center gap-0.5 shrink-0">
                                <Zap className="w-2.5 h-2.5" />
                                V4V
                              </span>
                            )}
                          </div>
                          {a.genres.length > 0 && (
                            <p className="text-[11px] text-muted-foreground/60 truncate">{a.genres.slice(0, 3).join(", ")}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {filteredArtists.map((a) => (
                      <ArtistCard key={a.id} artist={a} onClick={handleArtistClick} />
                    ))}
                  </div>
                )}
                <div className="flex justify-center mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setIsLoadingMore(true);
                      try {
                        const more = await fetchPopularArtists();
                        setArtistsList(prev => {
                          const existingIds = new Set(prev.map(a => a.id));
                          const newArtists = more.filter(a => !existingIds.has(a.id));
                          if (newArtists.length === 0) setNoMoreResults(true);
                          return [...prev, ...newArtists];
                        });
                      } finally {
                        setIsLoadingMore(false);
                      }
                    }}
                    disabled={isLoadingMore || noMoreResults}
                    data-testid="button-load-more-artists"
                  >
                    {isLoadingMore ? (
                      <RelayOutpostInlineLoader />
                    ) : noMoreResults ? (
                      <span className="text-muted-foreground/70">No more artists</span>
                    ) : (
                      <>
                        <Shuffle className="w-3.5 h-3.5 mr-1.5" />
                        Load More
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {view === "genre-results" && (
          <div data-testid="container-genre-results">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <RelayOutpostLoader size="lg" label={`Loading ${selectedGenre}...`} />
              </div>
            ) : genreTracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-2">
                <Music className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground/70">No {selectedGenre} tracks found</p>
              </div>
            ) : (
              <>
                {viewMode === "list" ? (
                  <div className="space-y-0.5" data-testid="container-genre-list">
                    {genreTracks.map((track, i) => (
                      <TrackListItem key={track.id} track={track} tracks={genreTracks} index={i} onArtistClick={handleArtistClick} />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4" data-testid="container-genre-grid">
                    {genreTracks.map((track) => (
                      <TrackCard key={track.id} track={track} tracks={genreTracks} onArtistClick={handleArtistClick} />
                    ))}
                  </div>
                )}
                <div className="flex justify-center mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!selectedGenre) return;
                      setIsLoadingMore(true);
                      try {
                        const genre = BROWSE_GENRES.find(g => g.label === selectedGenre);
                        if (genre) {
                          const more = await searchWavlakeTracks(genre.searchTerm);
                          setGenreTracks(prev => {
                            const existingIds = new Set(prev.map(t => t.id));
                            const newTracks = more.filter(t => !existingIds.has(t.id));
                            if (newTracks.length === 0) setNoMoreResults(true);
                            return [...prev, ...newTracks];
                          });
                        }
                      } finally {
                        setIsLoadingMore(false);
                      }
                    }}
                    disabled={isLoadingMore || noMoreResults}
                    data-testid="button-load-more-genre"
                  >
                    {isLoadingMore ? (
                      <RelayOutpostInlineLoader />
                    ) : noMoreResults ? (
                      <span className="text-muted-foreground/70">No more results</span>
                    ) : (
                      <>
                        <Shuffle className="w-3.5 h-3.5 mr-1.5" />
                        Load More
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {view === "browse" && (
          <BrowseGenres onGenreSelect={handleGenreSelect} />
        )}

        {showingFeedView && (
          <>
            {isLoading && tracks.length === 0 && !selectedTrendingPodcast ? (
              <div className="flex flex-col items-center justify-center py-20" data-testid="container-loading">
                <RelayOutpostLoader size="lg" label="Loading music..." />
                <p className="text-xs text-muted-foreground/60 mt-4">Fetching tracks from Wavlake & Nostr</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4" data-testid="container-error">
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">{error}</p>
                  <Button variant="outline" size="sm" onClick={() => fetchTracks(view)} data-testid="button-retry">
                    Try Again
                  </Button>
                </div>
              </div>
            ) : view === "podcasts" && selectedTrendingPodcast ? (
              <TrendingPodcastEpisodes
                podcast={selectedTrendingPodcast}
                onBack={() => setSelectedTrendingPodcast(null)}
              />
            ) : tracks.length === 0 && (view !== "podcasts" || trendingPodcasts.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4" data-testid="container-empty">
                <div className="w-16 h-16 rounded-2xl bg-muted/20 flex items-center justify-center border border-border/30">
                  <Disc3 className="w-8 h-8 text-muted-foreground/50" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm text-muted-foreground">No music found</p>
                  <p className="text-xs text-muted-foreground/70">Try a different category</p>
                </div>
              </div>
            ) : (
              <>
                {isLoading && (
                  <div className="flex justify-center mb-4">
                    <RelayOutpostInlineLoader className="w-5 h-5" />
                  </div>
                )}
                {view === "podcasts" && podcastGenres.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-3 mb-4 scrollbar-hide" data-testid="container-podcast-genre-filters">
                    <Button
                      variant={podcastCategoryFilter === null ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setPodcastCategoryFilter(null)}
                      className={podcastCategoryFilter === null ? "" : "text-muted-foreground/80"}
                      data-testid="button-podcast-filter-all"
                    >
                      All
                    </Button>
                    {podcastGenres.map(g => (
                      <Button
                        key={g}
                        variant={podcastCategoryFilter === g ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setPodcastCategoryFilter(podcastCategoryFilter === g ? null : g)}
                        className={`shrink-0 ${podcastCategoryFilter === g ? "" : "text-muted-foreground/80"}`}
                        data-testid={`button-podcast-filter-${g.toLowerCase().replace(/[^a-z]/g, "")}`}
                      >
                        {g}
                      </Button>
                    ))}
                  </div>
                )}

                {view === "podcasts" && (() => {
                  const visibleTrending = podcastCategoryFilter
                    ? trendingPodcasts.filter(p => p.categories.some(c => c.toLowerCase() === podcastCategoryFilter!.toLowerCase()))
                    : trendingPodcasts;
                  if (visibleTrending.length === 0 && !isLoadingTrending) return null;
                  return (
                    <div className="mb-6" data-testid="container-trending-podcasts">
                      <div className="flex items-center gap-2 mb-3">
                        <Flame className="w-4 h-4 text-orange-500/80" />
                        <h3 className="text-sm font-semibold text-foreground/80">Trending Podcasts</h3>
                      </div>
                      {isLoadingTrending ? (
                        <div className="flex justify-center py-6">
                          <RelayOutpostInlineLoader className="w-5 h-5" />
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {visibleTrending.map((podcast) => (
                            <TrendingPodcastCard
                              key={podcast.id}
                              podcast={podcast}
                              onSelect={setSelectedTrendingPodcast}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {view === "podcasts" && trendingPodcasts.length > 0 && (podcastCategoryFilter ? filteredPodcasts.length > 0 : tracks.length > 0) && (
                  <div className="flex items-center gap-2 mb-3">
                    <Headphones className="w-4 h-4 text-brand/60" />
                    <h3 className="text-sm font-semibold text-foreground/80">Wavlake Episodes</h3>
                  </div>
                )}

                {view === "podcasts" && podcastCategoryFilter && filteredPodcasts.length === 0 && !trendingPodcasts.some(p => p.categories.some(c => c.toLowerCase() === podcastCategoryFilter!.toLowerCase())) ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-2">
                    <Radio className="w-6 h-6 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground/70">No episodes match this category</p>
                  </div>
                ) : viewMode === "list" ? (
                  <div className="space-y-0.5" data-testid="container-music-list">
                    {(view === "podcasts" ? filteredPodcasts : tracks).map((track, i) => (
                      <TrackListItem
                        key={track.id}
                        track={track}
                        tracks={view === "podcasts" ? filteredPodcasts : tracks}
                        index={i}
                        onArtistClick={handleArtistClick}
                      />
                    ))}
                  </div>
                ) : (
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
                  data-testid="container-music-grid"
                >
                  {(view === "podcasts" ? filteredPodcasts : tracks).map((track) => (
                    <TrackCard
                      key={track.id}
                      track={track}
                      tracks={view === "podcasts" ? filteredPodcasts : tracks}
                      onArtistClick={handleArtistClick}
                    />
                  ))}
                </div>
                )}
                {view === "podcasts" && (
                  <div className="flex justify-center mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchTracks(view, true)}
                      disabled={isLoadingMore || (view === "podcasts" && noMoreResults)}
                      data-testid="button-load-more"
                    >
                      {isLoadingMore ? (
                        <RelayOutpostInlineLoader />
                      ) : (view === "podcasts" && noMoreResults) ? (
                        <span className="text-muted-foreground/70">No more episodes</span>
                      ) : (
                        <>
                          <Shuffle className="w-3.5 h-3.5 mr-1.5" />
                          Load More
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
