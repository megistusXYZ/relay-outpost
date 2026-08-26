// Fetch + parse Podcasting 2.0 episode extras (transcripts, chapters) through
// the server-side `/api/podcast/transcript` proxy (the files are cross-origin).
// Parsing lives in the pure `@/lib/podcast-transcript` module; these hooks add
// react-query caching and graceful absence: no URL → no fetch → empty result,
// so surfaces can simply render nothing.
import { useQuery } from "@tanstack/react-query";
import {
  parseTranscript,
  parseChapters,
  type TranscriptSegment,
  type PodcastChapter,
} from "@/lib/podcast-transcript";

interface ProxyResponse {
  content: string;
  contentType: string;
}

async function fetchPodcastFile(url: string): Promise<ProxyResponse> {
  const res = await fetch(`/api/podcast/transcript?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Transcript proxy failed: ${res.status}`);
  return res.json();
}

/**
 * Chapters for the given `podcast:chapters` URL. Returns [] while loading,
 * on error, or when the episode has no chapters URL.
 */
export function usePodcastChapters(chaptersUrl?: string): PodcastChapter[] {
  const q = useQuery({
    queryKey: ["podcast-chapters", chaptersUrl],
    queryFn: async () => {
      const file = await fetchPodcastFile(chaptersUrl!);
      return parseChapters(file.content);
    },
    enabled: !!chaptersUrl,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
  return q.data ?? [];
}

/**
 * Transcript segments for the given `podcast:transcript` URL. `declaredType`
 * is the feed's declared mime type (used as a parse hint; the body is sniffed
 * when it's absent or wrong). No URL → never fetches, returns empty.
 */
export function usePodcastTranscript(
  transcriptUrl?: string,
  declaredType?: string,
  enabled = true,
): { segments: TranscriptSegment[]; isLoading: boolean; isError: boolean } {
  const q = useQuery({
    queryKey: ["podcast-transcript", transcriptUrl],
    queryFn: async () => {
      const file = await fetchPodcastFile(transcriptUrl!);
      return parseTranscript(file.content, declaredType || file.contentType);
    },
    enabled: enabled && !!transcriptUrl,
    staleTime: 60 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
  return {
    segments: q.data ?? [],
    isLoading: !!transcriptUrl && enabled && q.isLoading,
    isError: q.isError,
  };
}
