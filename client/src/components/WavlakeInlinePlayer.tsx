import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Zap } from "lucide-react";
import { fetchWavlakeTrackById, fetchWavlakeAlbumFirstTrack, fetchWavlakeArtistTopTrackBySlug } from "@/lib/music";
import { parseWavlakeUrl } from "@/lib/media-utils";
import { MusicLinkCard } from "@/components/MusicLinkCard";
import { InlineAudio } from "@/components/InlineAudio";

interface WavlakeInlinePlayerProps {
  url: string;
  compact?: boolean;
}

export function WavlakeInlinePlayer({ url, compact = false }: WavlakeInlinePlayerProps) {
  const parsed = parseWavlakeUrl(url);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["wavlake-resolve", parsed?.kind, parsed?.id],
    queryFn: async () => {
      if (!parsed) return null;
      if (parsed.kind === "track") return fetchWavlakeTrackById(parsed.id);
      if (parsed.kind === "album") return fetchWavlakeAlbumFirstTrack(parsed.id);
      return fetchWavlakeArtistTopTrackBySlug(parsed.id);
    },
    enabled: !!parsed,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  });

  if (!parsed) {
    return <MusicLinkCard url={url} service="wavlake" compact={compact} />;
  }

  if (isLoading) {
    return (
      <div data-testid="wavlake-inline-loading">
        <MusicLinkCard url={url} service="wavlake" compact={compact} />
      </div>
    );
  }

  if (isError || !data || !data.audioUrl) {
    return <MusicLinkCard url={url} service="wavlake" compact={compact} />;
  }

  return (
    <div className="space-y-1.5" data-testid="wavlake-inline-player">
      <InlineAudio
        src={data.audioUrl}
        duration={data.duration}
        compact={compact}
        coverArt={data.coverUrl}
        title={data.title}
        artist={data.artist}
        artistHref={data.artistId ? `/audio?artist=${encodeURIComponent(data.artistId)}` : undefined}
        credit={{
          artist: data.artist,
          artistPubkey: data.artistPubkey,
          artistId: data.artistId,
          wavlakeUrl: data.wavlakeUrl || url,
          artistAvatarUrl: data.artistAvatarUrl,
          zapSplits: data.zapSplits,
          source: data.source ?? "wavlake",
        }}
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 text-[11px] text-brand/80 hover:text-brand-strong transition-colors px-1"
        data-testid="wavlake-attribution-link"
      >
        <Zap className="w-3 h-3 fill-current" />
        <span>Listen on Wavlake</span>
        <ExternalLink className="w-2.5 h-2.5" />
      </a>
    </div>
  );
}
