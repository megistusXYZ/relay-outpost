import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Film, Music, Upload, ArrowUpRight, Radio, Play, Pause, Square, ExternalLink, Calendar, Mic, ChevronDown, BookOpen, ListPlus, Disc3 } from "lucide-react";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { VideoChannelTheater } from "@/components/VideoChannelTheater";
import { RelayAmpDeck } from "@/components/RelayAmpDeck";
import { LazyVideoPoster } from "@/components/LazyVideoPoster";
import { useToast } from "@/hooks/use-toast";
import { uploadToNostrBuild, UploadError } from "@/lib/media-upload";
import { publishEvent } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { clientTags, getOptimizedImageUrl } from "@/lib/nostr-helpers";
import { isVideoUrl } from "@/lib/media-frame";
import { signWithTimeout } from "@/lib/signer-timeout";
import { UploadTrackDialog } from "@/components/UploadTrackDialog";
import { UploadVideoDialog } from "@/components/UploadVideoDialog";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import type { MusicTrack } from "@/lib/music";
import type { LiveEventData } from "@/lib/live-events";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { format } from "date-fns";
import type Hls from "hls.js";
import { loadHls } from "@/lib/load-hls";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";

// Extension fallback only — the declared type wins, see isVideoMedia.
const isVideo = isVideoUrl;

/** Post text minus the media URLs it embedded — the caption that gives an image
 *  its meaning in the lightbox. */
function stripMediaUrls(content: string): string {
  return content
    .replace(/(https?:\/\/[^\s]+\.(jpeg|jpg|gif|png|webp|mp4|mov|webm)(\?[^\s]*)?)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type MediaSubTab = "images" | "videos" | "audio" | "articles";
export type VideoOrientation = "portrait" | "landscape";
export type OrientationMap = Record<string, VideoOrientation>;

interface MediaSectionProps {
  mediaUrls: string[];
  mediaLoaded: boolean;
  audioTracks: MusicTrack[];
  audioLoaded: boolean;
  isOwnProfile: boolean;
  onLoadAudio?: () => void;
  onRefreshAudio?: () => void;
  liveStreams?: LiveEventData[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  connectedPodcastFeed?: string | null;
  onConnectPodcast?: (feedUrl: string) => void;
  onDisconnectPodcast?: () => void;
  orientationMap?: OrientationMap;
  // Articles folded into Media as a sub-tab. The content is passed as a slot so
  // the existing ArticlesTab (defined in MyOutpost) renders here unchanged.
  articleCount?: number;
  articlesSlot?: ReactNode;
  onArticlesOpen?: () => void;
  /** Per-media-URL source-post info → powers the lightbox caption + resonance. */
  mediaMeta?: Record<string, { eventId: string; pubkey: string; content: string; createdAt: number; poster?: string; title?: string; isVideo?: boolean }>;
  /** The profile owner (whose media this is) — shown as the lightbox author. */
  mediaAuthor?: { displayName: string; avatarUrl?: string };
}

/** A still video poster (first frame, muted, NOT autoplaying) that opens the
 *  channel-surf theater on click — so a grid of clips never plays all at once. */
function VideoThumb({ src, onOpen, testId, poster }: { src: string; onOpen: () => void; testId: string; poster?: string }) {
  return (
    <button onClick={onOpen} className="relative w-full h-full group/vthumb" data-testid={testId}>
      {/* An event that HANDS us a poster gets to keep it.
          NIP-71 videos carry `imeta … image <url>`, and using it beats decoding
          a frame on every axis: no media decoder, no seek, no range request,
          and no black tile while any of that is pending — plus it is the frame
          the author chose. LazyVideoPoster stays as the fallback for plain
          links in prose, which declare nothing. */}
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          // A dead poster must not leave a blank tile — drop back to the frame
          // decoder rather than showing nothing.
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      ) : (
        <LazyVideoPoster src={src} className="w-full h-full" />
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover/vthumb:bg-black/25 transition-colors">
        <span className="w-12 h-12 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center">
          <Play className="w-5 h-5 text-white ml-0.5" fill="currentColor" />
        </span>
      </div>
    </button>
  );
}

export function MediaSection({
  mediaUrls,
  mediaLoaded,
  audioTracks,
  audioLoaded,
  isOwnProfile,
  onLoadAudio,
  onRefreshAudio,
  liveStreams,
  onLoadMore,
  hasMore,
  loadingMore,
  connectedPodcastFeed,
  onConnectPodcast,
  onDisconnectPodcast,
  orientationMap,
  articleCount,
  articlesSlot,
  onArticlesOpen,
  mediaMeta,
  mediaAuthor }: MediaSectionProps) {
  const [activeSubTab, setActiveSubTab] = useState<MediaSubTab>("images");
  const audioLoadTriggered = useRef(false);
  const articlesLoadTriggered = useRef(false);

  // Lazy-load articles the first time the sub-tab is opened.
  useEffect(() => {
    if (activeSubTab === "articles" && onArticlesOpen && !articlesLoadTriggered.current) {
      articlesLoadTriggered.current = true;
      onArticlesOpen();
    }
  }, [activeSubTab, onArticlesOpen]);

  /**
   * What the EVENT declared beats what the filename suggests.
   *
   * `isVideo(url)` reads a file extension, and a NIP-71 video from
   * divine.video is `https://media.divine.video/<sha256>` — no extension at
   * all. Sixteen of them were filed as images on a profile whose Videos tab
   * said "No videos yet", which is how a video-only account read as having no
   * videos while its clips sat in the wrong tab.
   * The extension test stays as the fallback for bare links in prose, which
   * declare nothing about themselves.
   */
  const looksLikeVideo = useCallback(
    (u: string) => mediaMeta?.[u]?.isVideo ?? isVideo(u),
    [mediaMeta],
  );
  const imageUrls = useMemo(() => mediaUrls.filter((u) => !looksLikeVideo(u)), [mediaUrls, looksLikeVideo]);
  const videoUrls = useMemo(() => mediaUrls.filter((u) => looksLikeVideo(u)), [mediaUrls, looksLikeVideo]);

  useEffect(() => {
    if (!audioLoaded) {
      audioLoadTriggered.current = false;
    }
  }, [audioLoaded]);

  // Prefetch audio as soon as the Media tab opens (not only when the Audio
  // sub-tab is clicked) so every sub-tab is ready without an extra click.
  useEffect(() => {
    if (onLoadAudio && !audioLoadTriggered.current) {
      audioLoadTriggered.current = true;
      onLoadAudio();
    }
  }, [onLoadAudio]);

  const liveStreamCount = liveStreams?.length || 0;
  const audioCount = audioTracks.length + liveStreamCount;

  const subTabs: { id: MediaSubTab; label: string; icon: typeof ImageIcon; count: number }[] = [
    { id: "images", label: "Images", icon: ImageIcon, count: imageUrls.length },
    { id: "videos", label: "Videos", icon: Film, count: videoUrls.length },
    { id: "audio", label: "Audio", icon: Music, count: audioCount },
    ...(articlesSlot !== undefined ? [{ id: "articles" as const, label: "Articles", icon: BookOpen, count: articleCount ?? 0 }] : []),
  ];

  return (
    <div data-testid="container-media-section">
      <div className="flex items-center gap-1 mb-4 p-1 rounded-xl bg-muted/8 dark:bg-black/20 border border-border/15 dark:border-brand/15 backdrop-blur-sm w-fit shadow-sm shadow-primary/5 dark:shadow-brand/10" data-testid="media-sub-tabs">
        {subTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${ isActive ? "bg-accent text-accent-foreground dark:bg-gradient-to-r dark:from-brand/25 dark:to-brand/20 dark:text-brand shadow-sm shadow-primary/10 dark:shadow-brand/20 border border-brand/20 dark:border-brand/25" : "text-muted-foreground hover:text-foreground hover:bg-muted/15 dark:hover:bg-white/5 border border-transparent" }`}
              onClick={() => setActiveSubTab(tab.id)}
              data-testid={`button-media-subtab-${tab.id}`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? "text-brand" : ""}`} />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.count > 0 && (
                <Badge variant="secondary" className={`text-[9px] px-1 py-0 min-w-[18px] justify-center ${isActive ? "bg-brand/10 dark:bg-brand/15 text-brand border-brand/15" : ""}`}>
                  {tab.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {activeSubTab === "images" && (
        <ImagesSubTab urls={imageUrls} loaded={mediaLoaded} isOwnProfile={isOwnProfile} mediaMeta={mediaMeta} mediaAuthor={mediaAuthor} />
      )}
      {activeSubTab === "videos" && (
        <VideosSubTab urls={videoUrls} loaded={mediaLoaded} isOwnProfile={isOwnProfile} orientationMap={orientationMap} mediaMeta={mediaMeta} />
      )}
      {activeSubTab === "audio" && (
        <AudioSubTab
          tracks={audioTracks}
          loaded={audioLoaded}
          isOwnProfile={isOwnProfile}
          onRefresh={onRefreshAudio}
          liveStreams={liveStreams}
          connectedPodcastFeed={connectedPodcastFeed}
          onConnectPodcast={onConnectPodcast}
          onDisconnectPodcast={onDisconnectPodcast}
        />
      )}
      {activeSubTab === "articles" && articlesSlot}
      {(activeSubTab === "images" || activeSubTab === "videos") && onLoadMore && hasMore !== undefined && loadingMore !== undefined && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} isLoading={loadingMore} hasMore={hasMore} />
      )}
    </div>
  );
}

function ImagesSubTab({ urls, loaded, isOwnProfile, mediaMeta, mediaAuthor }: { urls: string[]; loaded: boolean; isOwnProfile: boolean; mediaMeta?: Record<string, { eventId: string; pubkey: string; content: string; createdAt: number }>; mediaAuthor?: { displayName: string; avatarUrl?: string } }) {
  // Index into the full gallery the lightbox is open on (null = closed) — so
  // tapping any thumbnail opens a flip-through gallery, not a single dead-end image.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Enrich each image with its source-post caption, resonance id, and a link to
  // the full thread — so an opened image carries meaning, not just pixels.
  const lightboxImages = useMemo(() => urls.map((src) => {
    const meta = mediaMeta?.[src];
    if (!meta) return { src };
    let postUrl: string | undefined;
    try { postUrl = `/thread/${nip19.noteEncode(meta.eventId)}`; } catch { postUrl = undefined; }
    return {
      src,
      caption: stripMediaUrls(meta.content) || undefined,
      eventId: meta.eventId,
      postUrl,
      timestamp: meta.createdAt > 0 ? format(new Date(meta.createdAt * 1000), "MMM d, yyyy") : undefined,
    };
  }), [urls, mediaMeta]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const { signer } = useNostrAuth();
  const { toast } = useToast();

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "File too large", description: `Images must be under 25 MB.`, variant: "destructive" });
      return;
    }
    setIsUploading(true);
    setUploadStatus("Preparing...");
    try {
      const result = await uploadToNostrBuild(file, setUploadStatus, signer);
      if (!signer) { toast({ title: "Not signed in", variant: "destructive" }); return; }
      const signedEvent = await signWithTimeout(signer, { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [...clientTags()], content: result.url });
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, undefined, isUserSelected);
      toast({ title: "Published", description: result.metadataStripped ? "Image published! Metadata scrubbed." : "Image published." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload image.", variant: "destructive" });
    } finally {
      setIsUploading(false);
      setUploadStatus("");
    }
  }, [signer, toast]);

  if (!loaded && urls.length === 0) {
    return <div className="flex flex-col items-center justify-center py-12"><RelayOutpostLoader size="md" label="Loading images..." /></div>;
  }

  if (urls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-no-images">
        <ImageIcon className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No images yet</p>
        {isOwnProfile && (
          <>
            <p className="text-xs text-muted-foreground/60 mt-1">Upload images to share</p>
            <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => mediaInputRef.current?.click()} disabled={isUploading} data-testid="button-upload-first-image">
              {isUploading ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
              {isUploading ? "Uploading..." : "Upload Image"}
            </Button>
            <p className="text-[10px] text-muted-foreground/40 mt-2">Images up to 25 MB · Metadata auto-stripped</p>
            <input ref={mediaInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} data-testid="input-image-upload" />
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {isOwnProfile && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">{urls.length} image{urls.length !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            {isUploading && uploadStatus && (
              <span className="text-[10px] text-brand/60 flex items-center gap-1"><RelayOutpostInlineLoader className="w-2.5 h-2.5" />{uploadStatus}</span>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => mediaInputRef.current?.click()} disabled={isUploading} data-testid="button-upload-image">
              {isUploading ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Upload className="w-3 h-3" />}
              Upload
            </Button>
          </div>
          <input ref={mediaInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} data-testid="input-image-upload" />
        </div>
      )}
      {/* Desktop pass (owner request 2026-08-26): the profile column is wide
          enough for another track at lg — 4 columns of squares read sparse. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2" data-testid="container-images-grid">
        {urls.map((url, i) => (
          <div
            key={url}
            className="aspect-square rounded-xl overflow-hidden bg-muted/30 cursor-pointer ring-1 ring-border/20 dark:ring-primary/10 shadow-sm hover:shadow-md hover:ring-border/40 dark:hover:ring-primary/20 transition-all duration-300"
            onClick={() => setLightboxIndex(i)}
            data-testid={`image-item-${i}`}
          >
            <img src={getOptimizedImageUrl(url, 400) || url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={lightboxImages}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          authorInfo={mediaAuthor ? { displayName: mediaAuthor.displayName, avatarUrl: mediaAuthor.avatarUrl } : undefined}
          testIdPrefix="profile-lightbox"
        />
      )}
    </>
  );
}

function VideosSubTab({ urls, loaded, isOwnProfile, orientationMap, mediaMeta }: { urls: string[]; loaded: boolean; isOwnProfile: boolean; orientationMap?: OrientationMap; mediaMeta?: Record<string, { poster?: string }> }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  // Which video the channel-surf theater is open on (null = closed). Only the
  // theater ever plays, so a grid of clips never overloads with N live streams.
  const [theaterStart, setTheaterStart] = useState<number | null>(null);

  if (!loaded && urls.length === 0) {
    return <div className="flex flex-col items-center justify-center py-12"><RelayOutpostLoader size="md" label="Loading videos..." /></div>;
  }

  const portraitVideos = urls.filter((u) => orientationMap?.[u] === "portrait");
  const landscapeVideos = urls.filter((u) => orientationMap?.[u] !== "portrait");
  // Theater surfs in the same order the grid is scanned: landscape row, then portrait.
  const orderedVideos = [...landscapeVideos, ...portraitVideos];

  return (
    <>
      {isOwnProfile && <UploadVideoDialog open={uploadOpen} onOpenChange={setUploadOpen} />}
      {urls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-no-videos">
          <Film className="w-8 h-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No videos yet</p>
          {isOwnProfile && (
            <>
              <p className="text-xs text-muted-foreground/60 mt-1">Upload videos to share</p>
              <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setUploadOpen(true)} data-testid="button-upload-first-video">
                <Upload className="w-3.5 h-3.5" />
                Upload Video
              </Button>
              <p className="text-[10px] text-muted-foreground/40 mt-2">Videos up to 100 MB</p>
            </>
          )}
        </div>
      ) : (
        <>
          {isOwnProfile && (
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">{urls.length} video{urls.length !== 1 ? "s" : ""}</span>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setUploadOpen(true)} data-testid="button-upload-video">
                <Upload className="w-3 h-3" />
                Upload
              </Button>
            </div>
          )}

          {landscapeVideos.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="container-videos-grid">
              {landscapeVideos.map((url, i) => (
                <div
                  key={url}
                  className="aspect-video rounded-xl overflow-hidden bg-muted/30 ring-1 ring-border/20 dark:ring-primary/10 shadow-sm hover:shadow-md hover:ring-border/40 dark:hover:ring-primary/20 transition-all duration-300"
                  data-testid={`video-item-landscape-${i}`}
                >
                  <VideoThumb src={url} poster={mediaMeta?.[url]?.poster} onOpen={() => setTheaterStart(i)} testId={`video-player-landscape-${i}`} />
                </div>
              ))}
            </div>
          )}

          {portraitVideos.length > 0 && (
            <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 ${landscapeVideos.length > 0 ? "mt-3" : ""}`} data-testid="container-videos-portrait-grid">
              {portraitVideos.map((url, i) => (
                <div
                  key={url}
                  className="aspect-[9/16] rounded-xl overflow-hidden bg-muted/30 ring-1 ring-border/20 dark:ring-primary/10 shadow-sm hover:shadow-md hover:ring-border/40 dark:hover:ring-primary/20 transition-all duration-300"
                  data-testid={`video-item-portrait-${i}`}
                >
                  <VideoThumb src={url} poster={mediaMeta?.[url]?.poster} onOpen={() => setTheaterStart(landscapeVideos.length + i)} testId={`video-player-portrait-${i}`} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {theaterStart !== null && (
        <VideoChannelTheater urls={orderedVideos} startIndex={theaterStart} onClose={() => setTheaterStart(null)} />
      )}
    </>
  );
}

function LiveStreamCard({ stream }: { stream: LiveEventData }) {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  // Monotonic token: invalidates an in-flight async hls.js load when the
  // stream is stopped/restarted before the module finishes loading.
  const startSeqRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { stop: stopMusic } = useAudioPlayer();
  const { toast } = useToast();

  const isLive = stream.status === "live";
  const playableUrl = stream.hlsUrl || stream.streamUrl || stream.recordingUrl;
  const hasRecording = !!stream.recordingUrl;
  const isHls = playableUrl ? (playableUrl.includes(".m3u8") || playableUrl.includes("m3u8")) : false;

  const zapStreamUrl = useMemo(() => {
    try {
      const naddr = nip19.naddrEncode({
        identifier: stream.dTag,
        pubkey: stream.pubkey,
        kind: 30311,
        relays: stream.relays.length > 0 ? stream.relays.slice(0, 2) : ["wss://relay.zap.stream"] });
      return `https://zap.stream/${naddr}`;
    } catch {
      return null;
    }
  }, [stream.dTag, stream.pubkey, stream.relays]);

  const destroyHls = useCallback(() => {
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy();
      hlsInstanceRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    startSeqRef.current++;
    const media = mediaRef.current;
    if (media) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    destroyHls();
    setPlaying(false);
    setLoading(false);
  }, [destroyHls]);

  const startStream = useCallback(() => {
    const media = mediaRef.current;
    if (!media || !playableUrl) return;

    stopMusic();
    setLoading(true);
    destroyHls();
    const seq = ++startSeqRef.current;

    const playDirect = () => {
      media.src = playableUrl;
      media.play()
        .then(() => { setPlaying(true); setLoading(false); })
        .catch(() => { setLoading(false); });
    };

    if (isHls) {
      // hls.js loads on demand (it's ~1.3MB) — only when a stream is played.
      loadHls()
        .then((HlsCtor) => {
          if (seq !== startSeqRef.current) return;
          if (HlsCtor.isSupported()) {
            const hls = new HlsCtor({
              enableWorker: true,
              maxBufferLength: 30,
              maxMaxBufferLength: 60 });
            hlsInstanceRef.current = hls;
            hls.loadSource(playableUrl);
            hls.attachMedia(media);
            hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
              media.play()
                .then(() => { setPlaying(true); setLoading(false); })
                .catch(() => { setLoading(false); });
            });
            hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
              if (data.fatal) {
                stopStream();
                toast({
                  title: "Playback unavailable",
                  description: zapStreamUrl ? "Try listening on zap.stream instead." : "Recording not available.",
                  variant: "destructive" });
              }
            });
          } else {
            // Native HLS (Safari) or plain <video> fallback.
            playDirect();
          }
        })
        .catch(() => {
          if (seq !== startSeqRef.current) return;
          playDirect();
        });
    } else {
      playDirect();
    }
  }, [playableUrl, isHls, stopMusic, destroyHls, stopStream, zapStreamUrl, toast]);

  const toggleStream = useCallback(() => {
    if (playing) {
      stopStream();
    } else {
      startStream();
    }
  }, [playing, stopStream, startStream]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onEnded = () => { setPlaying(false); setLoading(false); };
    const onError = () => { setPlaying(false); setLoading(false); };
    media.addEventListener("ended", onEnded);
    media.addEventListener("error", onError);
    return () => {
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
      stopStream();
    };
  }, [stopStream]);

  const dateStr = stream.event.created_at
    ? format(new Date(stream.event.created_at * 1000), "MMM d, yyyy · h:mm a")
    : "";

  const showImage = stream.image && !imgError;

  return (
    <div
      className={`rounded-xl border bg-card/40 dark:bg-card/20 backdrop-blur-sm shadow-sm transition-all duration-300 hover:shadow-md ${ isLive ? "border-red-500/30 dark:border-red-500/25 shadow-red-500/10 dark:shadow-red-500/15" : playing ? "border-brand/30 dark:border-brand/25 shadow-primary/10 dark:shadow-brand/15 ring-1 ring-primary/20 dark:ring-brand/20" : "border-border/30 dark:border-brand/10 shadow-primary/5 dark:shadow-primary/10" }`}
      data-testid={`live-stream-card-${stream.dTag}`}
    >
      <div className="p-3 flex items-center gap-3">
        {showImage ? (
          <img
            src={stream.image}
            alt={stream.title}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover shrink-0 ring-1 ring-border/20 dark:ring-primary/10"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-brand/5 dark:bg-brand/10 shrink-0 flex items-center justify-center ring-1 ring-border/20 dark:ring-primary/10">
            <Radio className="w-5 h-5 text-brand/40" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {isLive ? (
              <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 font-bold uppercase tracking-wider border-none shadow-[0_0_6px_1px_rgba(239,68,68,0.3)] live-dot">
                LIVE
              </Badge>
            ) : playing ? (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-brand/10 text-brand dark:bg-brand/15 border border-brand/20">
                Playing
              </Badge>
            ) : hasRecording ? (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                Recording
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 opacity-60">
                Ended
              </Badge>
            )}
            {dateStr && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />
                {dateStr}
              </span>
            )}
          </div>
          <p className="text-sm font-medium truncate">{stream.title}</p>
          {stream.summary && (
            <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{stream.summary}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {playableUrl && (
            <button
              className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${ loading ? "text-brand/70" : playing ? "text-red-500 bg-red-500/10" : isLive ? "text-red-500/70 hover:text-red-500 hover:bg-red-500/10" : "text-brand/70 hover:text-brand hover:bg-brand/10" }`}
              onClick={toggleStream}
              disabled={loading}
              title={playing ? "Stop" : "Play"}
              data-testid={`button-stream-toggle-${stream.dTag}`}
            >
              {loading ? (
                <RelayOutpostInlineLoader className="w-4 h-4" />
              ) : playing ? (
                <Square className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </button>
          )}
          {zapStreamUrl && (
            <a
              href={zapStreamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`shrink-0 rounded-full flex items-center justify-center transition-colors ${ playableUrl ? "w-7 h-7 text-muted-foreground/40 hover:text-foreground hover:bg-muted/30" : "w-9 h-9 text-brand/70 hover:text-brand hover:bg-brand/10" }`}
              onClick={(e) => e.stopPropagation()}
              title="Listen on zap.stream"
              data-testid={`button-stream-external-${stream.dTag}`}
            >
              <ExternalLink className={playableUrl ? "w-3.5 h-3.5" : "w-4 h-4"} />
            </a>
          )}
        </div>
      </div>
      <video ref={mediaRef} className="hidden" preload="none" playsInline />
    </div>
  );
}

function AudioSubTab({ tracks, loaded, isOwnProfile, onRefresh, liveStreams, connectedPodcastFeed, onConnectPodcast, onDisconnectPodcast }: { tracks: MusicTrack[]; loaded: boolean; isOwnProfile: boolean; onRefresh?: () => void; liveStreams?: LiveEventData[]; connectedPodcastFeed?: string | null; onConnectPodcast?: (feedUrl: string) => void; onDisconnectPodcast?: () => void }) {
  const { play, currentTrack, isPlaying, togglePlay, addToQueue } = useAudioPlayer();
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [podcastConnectOpen, setPodcastConnectOpen] = useState(false);
  const [podcastFeedInput, setPodcastFeedInput] = useState("");
  const [sharingTrackId, setSharingTrackId] = useState<string | null>(null);
  const [showAllPodcasts, setShowAllPodcasts] = useState(false);
  const PODCAST_INITIAL_LIMIT = 10;

  const handleShare = useCallback(async (track: MusicTrack) => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    setSharingTrackId(track.id);
    try {
      let artistMention = "";
      if (track.artistPubkey && track.artistPubkey !== pubkey) {
        try { artistMention = `nostr:${nip19.npubEncode(track.artistPubkey)}`; } catch {}
      }
      const trackUrl = track.wavlakeUrl || track.audioUrl;
      const noteContent = `🎵 ${track.title} by ${artistMention || track.artist}\n\n${trackUrl}`;
      const tags: string[][] = [];
      if (track.artistPubkey && track.artistPubkey !== pubkey) tags.push(["p", track.artistPubkey]);
      if (trackUrl) tags.push(["r", trackUrl]);
      if (track.genre) tags.push(["t", track.genre.toLowerCase()]);
      tags.push(["t", "music"]);
      tags.push(...clientTags());
      const signedEvent = await signWithTimeout(signer, { kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content: noteContent });
      const { relays: userRelays2, userSelected: isUserSelected2 } = getPublishTarget();
      await publishEvent(signedEvent, userRelays2, undefined, isUserSelected2);
      toast({ title: "Shared!", description: "Your track has been shared as a note." });
    } catch (err) {
      console.error("Failed to share track:", err);
      toast({ title: "Share failed", description: "Could not publish note.", variant: "destructive" });
    } finally {
      setSharingTrackId(null);
    }
  }, [signer, pubkey, toast]);

  const handleUploadComplete = useCallback(() => {
    setTimeout(() => onRefresh?.(), 1500);
  }, [onRefresh]);

  const liveNow = useMemo(() => liveStreams?.filter((s) => s.status === "live") || [], [liveStreams]);
  const previousShows = useMemo(() => liveStreams?.filter((s) => s.status === "ended") || [], [liveStreams]);
  const podcastTracks = useMemo(() => tracks.filter(t => t.source === "podcast"), [tracks]);
  const musicTracks = useMemo(() => tracks.filter(t => t.source !== "podcast"), [tracks]);
  // Group into albums (Winamp-style), preserving track order. Album headers only
  // show when there's more than one titled album — otherwise it's a flat list.
  const musicAlbums = useMemo(() => {
    const map = new Map<string, MusicTrack[]>();
    for (const t of musicTracks) {
      const key = t.albumTitle?.trim() || "";
      (map.get(key) ?? map.set(key, []).get(key)!).push(t);
    }
    return [...map.entries()];
  }, [musicTracks]);
  const showAlbumHeaders = musicAlbums.filter(([k]) => k).length > 1;

  const showsCount = liveNow.length + previousShows.length;
  const musicCount = musicTracks.length;
  const podcastCount = podcastTracks.length;

  type AudioTab = "shows" | "music" | "podcast";
  const audioTabs = useMemo(() => {
    const tabs: { id: AudioTab; label: string; icon: typeof Radio; count: number }[] = [];
    if (showsCount > 0) tabs.push({ id: "shows", label: "Shows", icon: Radio, count: showsCount });
    if (musicCount > 0 || isOwnProfile) tabs.push({ id: "music", label: "Music", icon: Music, count: musicCount });
    if (podcastCount > 0 || connectedPodcastFeed) tabs.push({ id: "podcast", label: "Podcast", icon: Mic, count: podcastCount });
    return tabs;
  }, [showsCount, musicCount, podcastCount, isOwnProfile, connectedPodcastFeed]);

  const defaultTab = useMemo<AudioTab>(() => {
    if (liveNow.length > 0) return "shows";
    if (musicCount > 0) return "music";
    if (showsCount > 0) return "shows";
    if (podcastCount > 0) return "podcast";
    return "music";
  }, [liveNow.length, musicCount, showsCount, podcastCount]);

  const [activeAudioTab, setActiveAudioTab] = useState<AudioTab>(defaultTab);

  useEffect(() => {
    if (audioTabs.length > 0 && !audioTabs.some(t => t.id === activeAudioTab)) {
      setActiveAudioTab(defaultTab);
    }
  }, [audioTabs, defaultTab]);

  if (!loaded) {
    return <div className="flex flex-col items-center justify-center py-12"><RelayOutpostLoader size="md" label="Scanning frequencies..." /></div>;
  }

  const hasAnyContent = tracks.length > 0 || liveNow.length > 0 || previousShows.length > 0;

  if (!hasAnyContent && !connectedPodcastFeed) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-no-audio">
        <Music className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No audio published yet</p>
        {isOwnProfile && (
          <>
            <p className="text-xs text-muted-foreground/60 mt-1">Upload your first track to start broadcasting</p>
            <Button variant="outline" size="sm" className="mt-3 gap-1.5 font-medium" onClick={() => setUploadOpen(true)} data-testid="button-upload-first-track">
              <Upload className="w-3.5 h-3.5" />
              Upload Your First Track
            </Button>
            <p className="text-[10px] text-muted-foreground/40 mt-2">Audio files up to 100 MB · MP3, WAV, FLAC metadata auto-stripped</p>
            <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} onPublished={handleUploadComplete} />

            {onConnectPodcast && (
              <div className="mt-6 pt-5 border-t border-border/20 w-full max-w-xs mx-auto">
                <p className="text-xs text-muted-foreground/50 mb-2">Or connect an existing podcast</p>
                {connectedPodcastFeed ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border/20 dark:border-brand/10 bg-card/30 dark:bg-card/15">
                    <Mic className="w-3.5 h-3.5 text-brand/60 shrink-0" />
                    <span className="text-[11px] text-muted-foreground/70 truncate flex-1">{connectedPodcastFeed}</span>
                    {onDisconnectPodcast && (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-red-700/70 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-400" onClick={onDisconnectPodcast}>
                        Disconnect
                      </Button>
                    )}
                  </div>
                ) : !podcastConnectOpen ? (
                  <Button variant="outline" size="sm" className="gap-1.5 font-medium" onClick={() => setPodcastConnectOpen(true)} data-testid="button-connect-podcast-empty">
                    <Mic className="w-3 h-3" />
                    Connect Podcast RSS Feed
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      placeholder="Paste your podcast RSS feed URL..."
                      value={podcastFeedInput}
                      onChange={(e) => setPodcastFeedInput(e.target.value)}
                      className="flex-1 h-8 px-3 text-xs rounded-lg border border-border/30 dark:border-brand/15 bg-background/50 dark:bg-black/20 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring dark:focus:ring-brand/30"
                      style={{ fontSize: 16 }}
                      data-testid="input-podcast-feed-url-empty"
                    />
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 px-3 text-xs"
                      disabled={!podcastFeedInput.trim()}
                      onClick={() => {
                        const url = podcastFeedInput.trim();
                        if (url) {
                          onConnectPodcast(url);
                          setPodcastFeedInput("");
                          setPodcastConnectOpen(false);
                        }
                      }}
                      data-testid="button-save-podcast-feed-empty"
                    >
                      Connect
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => { setPodcastConnectOpen(false); setPodcastFeedInput(""); }}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const renderTrackCard = (track: MusicTrack, showShare = false) => {
    const isCurrent = currentTrack?.id === track.id;
    const isSharing = sharingTrackId === track.id;
    const isPodcast = track.source === "podcast";
    return (
      <div
        key={track.id}
        className={`rounded-xl border border-border/30 dark:border-primary/10 bg-card/40 dark:bg-card/20 backdrop-blur-sm shadow-sm shadow-primary/5 dark:shadow-primary/10 hover-elevate cursor-pointer transition-all duration-300 hover:shadow-md hover:shadow-primary/8 dark:hover:shadow-primary/15 hover:border-border/50 dark:hover:border-primary/20 ${isCurrent ? "ring-1 ring-primary/30 dark:ring-brand/40 shadow-md shadow-primary/10 dark:shadow-brand/20" : ""}`}
        onClick={() => isCurrent ? togglePlay() : play(track, isPodcast ? podcastTracks : musicTracks)}
        data-testid={`${isPodcast ? "podcast-episode" : "audio-track"}-${track.id}`}
      >
        <div className="p-3 flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-muted/30 ring-1 ring-border/20 dark:ring-primary/10 shadow-sm group/cover">
            {track.coverUrl ? (
              <img src={track.coverUrl} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-brand/5 dark:bg-brand/10">
                {isPodcast ? <Mic className="w-4 h-4 text-brand/40" /> : <Music className="w-4 h-4 text-brand/40" />}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity duration-200" data-testid={`overlay-play-${track.id}`}>
              {isCurrent && isPlaying ? (
                <Pause className="w-5 h-5 text-white drop-shadow-md" />
              ) : (
                <Play className="w-5 h-5 text-white drop-shadow-md ml-0.5" />
              )}
            </div>
            {isCurrent && isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/cover:opacity-0 transition-opacity duration-200">
                <div className="flex items-end gap-[2px] h-3">
                  <span className="w-[3px] bg-brand rounded-full animate-[equalizer_0.8s_ease-in-out_infinite]" style={{ height: "60%" }} />
                  <span className="w-[3px] bg-brand rounded-full animate-[equalizer_0.8s_ease-in-out_infinite_0.2s]" style={{ height: "100%" }} />
                  <span className="w-[3px] bg-brand rounded-full animate-[equalizer_0.8s_ease-in-out_infinite_0.4s]" style={{ height: "40%" }} />
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{track.title}</p>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
              {isPodcast && track.createdAt > 0 && (
                <span className="text-[10px] text-muted-foreground/50 shrink-0">· {format(new Date(track.createdAt * 1000), "MMM d")}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {showShare && isOwnProfile && (
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 text-muted-foreground/50 hover:text-brand"
                onClick={(e) => { e.stopPropagation(); handleShare(track); }}
                disabled={isSharing}
                data-testid={`button-share-track-${track.id}`}
              >
                {isSharing ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
              </Button>
            )}
            {track.duration > 0 && (
              <span className="text-[11px] text-muted-foreground/60 tabular-nums">
                {Math.floor(track.duration / 60)}:{String(Math.floor(track.duration % 60)).padStart(2, "0")}
              </span>
            )}
            <div className="w-7 h-7 rounded-full flex items-center justify-center bg-brand/10 text-brand dark:bg-brand/15" data-testid={`button-play-${isPodcast ? "podcast" : "track"}-${track.id}`}>
              {isCurrent && isPlaying ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5 ml-0.5" />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Compact Winamp-style playlist row — dense, feeds the RelayAmp deck. Cover
  // doubles as play/pause (with a now-playing equalizer), + adds to queue.
  const renderMusicRow = (track: MusicTrack) => {
    const isCurrent = currentTrack?.id === track.id;
    const isSharing = sharingTrackId === track.id;
    const dur = track.duration > 0 ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, "0")}` : "";
    return (
      <div
        key={track.id}
        onClick={() => isCurrent ? togglePlay() : play(track, musicTracks)}
        className={`group/mrow flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer transition-colors ${isCurrent ? "bg-brand/[0.06] dark:bg-brand/10" : "hover:bg-muted/40"}`}
        data-testid={`audio-track-${track.id}`}
      >
        <div className="relative w-8 h-8 rounded overflow-hidden shrink-0 bg-muted/30 ring-1 ring-border/20 dark:ring-primary/10">
          {track.coverUrl ? (
            <img src={getOptimizedImageUrl(track.coverUrl, 64) || track.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-brand/5 dark:bg-brand/10"><Music className="w-3.5 h-3.5 text-brand/40" /></div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover/mrow:opacity-100 transition-opacity">
            {isCurrent && isPlaying ? <Pause className="w-3.5 h-3.5 text-white" /> : <Play className="w-3.5 h-3.5 text-white ml-0.5" />}
          </div>
          {isCurrent && isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/35 group-hover/mrow:opacity-0 transition-opacity">
              <div className="flex items-end gap-[2px] h-3">
                <span className="w-[2px] bg-brand rounded-full animate-[equalizer_0.8s_ease-in-out_infinite]" style={{ height: "60%" }} />
                <span className="w-[2px] bg-brand rounded-full animate-[equalizer_0.8s_ease-in-out_infinite_0.2s]" style={{ height: "100%" }} />
                <span className="w-[2px] bg-brand rounded-full animate-[equalizer_0.8s_ease-in-out_infinite_0.4s]" style={{ height: "40%" }} />
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-medium truncate ${isCurrent ? "text-brand" : ""}`}>{track.title}</p>
          <p className="text-[11px] text-muted-foreground truncate">{track.artist}</p>
        </div>
        {dur && <span className="text-[11px] tabular-nums font-mono text-muted-foreground/60 shrink-0">{dur}</span>}
        <button
          onClick={(e) => { e.stopPropagation(); addToQueue(track); toast({ title: "Added to queue", description: track.title }); }}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-brand hover:bg-brand/10 opacity-0 group-hover/mrow:opacity-100 transition-all"
          aria-label="Add to queue" title="Add to queue" data-testid={`button-queue-${track.id}`}
        >
          <ListPlus className="w-3.5 h-3.5" />
        </button>
        {isOwnProfile && (
          <button
            onClick={(e) => { e.stopPropagation(); handleShare(track); }}
            disabled={isSharing}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-brand opacity-0 group-hover/mrow:opacity-100 transition-all"
            aria-label="Share as note" title="Share as note" data-testid={`button-share-track-row-${track.id}`}
          >
            {isSharing ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3" data-testid="container-audio-tracks">
      {audioTabs.length > 0 && (
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/8 dark:bg-black/20 border border-border/15 dark:border-brand/15 backdrop-blur-sm w-fit shadow-sm shadow-primary/5 dark:shadow-brand/10" data-testid="audio-sub-tabs">
          {audioTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeAudioTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${ isActive ? "bg-accent text-accent-foreground dark:bg-gradient-to-r dark:from-brand/25 dark:to-brand/20 dark:text-brand shadow-sm shadow-primary/10 dark:shadow-brand/20 border border-brand/20 dark:border-brand/25" : "text-muted-foreground hover:text-foreground hover:bg-muted/15 dark:hover:bg-white/5 border border-transparent" }`}
                onClick={() => setActiveAudioTab(tab.id)}
                data-testid={`button-audio-tab-${tab.id}`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-brand" : ""}`} />
                {tab.label}
                {tab.count > 0 && (
                  <Badge variant="secondary" className={`text-[9px] px-1 py-0 min-w-[18px] justify-center ${isActive ? "bg-brand/10 dark:bg-brand/15 text-brand border-brand/15" : ""}`}>
                    {tab.count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {activeAudioTab === "shows" && (
        <div className="space-y-2">
          {liveNow.length > 0 && (
            <div className="mb-3" data-testid="container-live-streams">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="w-3.5 h-3.5 text-red-500 live-dot" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-red-500/80 font-bold">Live Now</span>
              </div>
              <div className="space-y-2">
                {liveNow.map((stream) => (
                  <LiveStreamCard key={stream.dTag} stream={stream} />
                ))}
              </div>
            </div>
          )}
          {previousShows.length > 0 && (
            <div data-testid="container-previous-shows">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">Previous Shows</span>
                <span className="text-[10px] text-muted-foreground/40">({previousShows.length})</span>
              </div>
              <div className="space-y-2">
                {previousShows.map((stream) => (
                  <LiveStreamCard key={stream.dTag} stream={stream} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeAudioTab === "music" && (
        <div className="space-y-2">
          {isOwnProfile && (
            <div className="mb-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">{musicCount} song{musicCount !== 1 ? "s" : ""}</span>
                <div className="flex items-center gap-2">
                  {onConnectPodcast && !connectedPodcastFeed && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs border-brand/30 dark:border-brand/25 text-brand bg-brand/5 dark:bg-brand/10 hover:bg-brand/10 dark:hover:bg-brand/20 shadow-[0_0_8px_rgba(168,85,247,0.15)] dark:shadow-[0_0_10px_rgba(168,85,247,0.2)] hover:shadow-[0_0_12px_rgba(168,85,247,0.25)] dark:hover:shadow-[0_0_14px_rgba(168,85,247,0.3)] transition-all"
                      onClick={() => setPodcastConnectOpen(true)}
                      data-testid="button-connect-podcast"
                    >
                      <Mic className="w-3 h-3" />
                      <span className="hidden sm:inline">Connect Podcast</span>
                      <span className="sm:hidden">Podcast</span>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setUploadOpen(true)} data-testid="button-upload-track">
                    <Upload className="w-3 h-3" />
                    Upload
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/40 mt-1">Audio files up to 100 MB · MP3, WAV, FLAC metadata auto-stripped</p>
              {onConnectPodcast && podcastConnectOpen && !connectedPodcastFeed && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="url"
                    placeholder="Paste your podcast RSS feed URL..."
                    value={podcastFeedInput}
                    onChange={(e) => setPodcastFeedInput(e.target.value)}
                    className="flex-1 h-8 px-3 text-xs rounded-lg border border-border/30 dark:border-brand/15 bg-background/50 dark:bg-black/20 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring dark:focus:ring-brand/30"
                    data-testid="input-podcast-feed-url"
                  />
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    disabled={!podcastFeedInput.trim()}
                    onClick={() => {
                      const url = podcastFeedInput.trim();
                      if (url) {
                        onConnectPodcast(url);
                        setPodcastFeedInput("");
                        setPodcastConnectOpen(false);
                      }
                    }}
                    data-testid="button-save-podcast-feed"
                  >
                    Connect
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => { setPodcastConnectOpen(false); setPodcastFeedInput(""); }}
                    data-testid="button-cancel-podcast-connect"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
          {musicTracks.length > 0 && <RelayAmpDeck tracks={musicTracks} />}
          {musicTracks.length > 0 && (
            <div className="rounded-xl border border-border/40 dark:border-primary/10 bg-card/40 dark:bg-card/20 overflow-hidden shadow-sm">
              {showAlbumHeaders ? (
                musicAlbums.map(([album, albumTracks]) => (
                  <div key={album || "__loose"} className="border-b border-border/15 dark:border-primary/5 last:border-b-0">
                    {album && (
                      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/25 dark:bg-white/[0.02]">
                        <Disc3 className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 truncate">{album}</span>
                        <span className="text-[10px] text-muted-foreground/40 ml-auto tabular-nums">{albumTracks.length}</span>
                      </div>
                    )}
                    <div className="divide-y divide-border/15 dark:divide-primary/5">{albumTracks.map(renderMusicRow)}</div>
                  </div>
                ))
              ) : (
                <div className="divide-y divide-border/15 dark:divide-primary/5">{musicTracks.map(renderMusicRow)}</div>
              )}
            </div>
          )}
          {musicCount === 0 && isOwnProfile && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Music className="w-6 h-6 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground/60">No music uploaded yet</p>
            </div>
          )}
        </div>
      )}

      {activeAudioTab === "podcast" && (
        <div className="space-y-2" data-testid="container-podcast-episodes">
          {podcastTracks.length > 0 && (
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-3.5 h-3.5 text-brand/60" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                {podcastTracks[0]?.albumTitle || podcastTracks[0]?.artist || "Podcast"}
              </span>
              <span className="text-[10px] text-muted-foreground/40">({podcastCount} episode{podcastCount !== 1 ? "s" : ""})</span>
            </div>
          )}
          {(showAllPodcasts ? podcastTracks : podcastTracks.slice(0, PODCAST_INITIAL_LIMIT)).map((track) => renderTrackCard(track, false))}
          {!showAllPodcasts && podcastTracks.length > PODCAST_INITIAL_LIMIT && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground"
              onClick={() => setShowAllPodcasts(true)}
              data-testid="button-show-more-podcasts"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Show {podcastTracks.length - PODCAST_INITIAL_LIMIT} more episode{podcastTracks.length - PODCAST_INITIAL_LIMIT !== 1 ? "s" : ""}
            </Button>
          )}
          {podcastTracks.length === 0 && isOwnProfile && !connectedPodcastFeed && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Mic className="w-6 h-6 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground/60 mb-3">Connect your podcast RSS feed to display episodes here</p>
            </div>
          )}
          {podcastTracks.length === 0 && connectedPodcastFeed && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Mic className="w-6 h-6 text-amber-500/40 mb-2" />
              <p className="text-xs text-muted-foreground/70">No episodes loaded from this feed</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">The RSS feed may be unavailable, empty, or not a podcast feed. Try disconnecting and using a different URL.</p>
            </div>
          )}
        </div>
      )}

      {isOwnProfile && onConnectPodcast && connectedPodcastFeed && (
        <div className="mt-3">
          <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border/20 dark:border-brand/10 bg-card/30 dark:bg-card/15">
            <Mic className="w-3.5 h-3.5 text-brand/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground/70 truncate flex-1" data-testid="text-connected-podcast-feed">{connectedPodcastFeed}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
              onClick={() => {
                if (onDisconnectPodcast) onDisconnectPodcast();
                setPodcastConnectOpen(false);
              }}
              data-testid="button-disconnect-podcast"
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {isOwnProfile && (
        <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} onPublished={handleUploadComplete} />
      )}
    </div>
  );
}
