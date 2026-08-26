// Podcasting 2.0 episode extras inside the expanded audio player: a chapter
// list (current-chapter title + tap-to-seek) and a searchable transcript whose
// segments seek playback on tap. Both render NOTHING when the episode's feed
// doesn't provide the tags — no empty tabs, no placeholders.
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { BookOpen, Captions, ChevronDown, Search, X } from "lucide-react";
import {
  findChapterIndex,
  formatTranscriptTime,
  type PodcastChapter,
  type TranscriptSegment,
} from "@/lib/podcast-transcript";
import { usePodcastTranscript } from "@/hooks/use-podcast-extras";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export function ChapterSection({
  chapters,
  currentTime,
  onSeek }: {
  chapters: PodcastChapter[];
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentIdx = useMemo(() => findChapterIndex(chapters, currentTime), [chapters, currentTime]);

  if (chapters.length === 0) return null;
  const current = currentIdx >= 0 ? chapters[currentIdx] : null;

  return (
    <div className="pt-2 md:pt-1.5 border-t border-border/15 dark:border-brand/10" data-testid="player-chapters">
      <button
        className="w-full flex items-center gap-1.5 px-0.5 min-h-[36px] md:min-h-0 md:py-1 text-muted-foreground/60 hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
        data-testid="button-toggle-chapters"
      >
        <BookOpen className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
        <span className="text-xs md:text-[11px] font-medium shrink-0">Chapters</span>
        <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0">{chapters.length}</span>
        {current && (
          <span className="text-[11px] text-brand/80 truncate ml-1 min-w-0" data-testid="current-chapter-title">
            {current.title || formatTranscriptTime(current.startTime)}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="max-h-48 md:max-h-44 overflow-y-auto -mx-1 px-1 space-y-0.5 mt-1" data-testid="chapter-list">
          {chapters.map((ch, i) => (
            <button
              key={`${ch.startTime}-${i}`}
              className={`w-full flex items-center gap-2 rounded-lg px-1.5 py-1.5 min-h-[40px] md:min-h-0 text-left transition-colors ${ i === currentIdx ? "bg-brand/10 dark:bg-brand/15" : "hover:bg-muted/15" }`}
              onClick={() => onSeek(ch.startTime)}
              data-testid={`chapter-row-${i}`}
            >
              {ch.img && (
                <img src={ch.img} alt="" loading="lazy" className="w-8 h-8 rounded object-cover shrink-0 border border-primary/10" />
              )}
              <span className="text-[11px] text-muted-foreground/50 tabular-nums shrink-0 w-11">
                {formatTranscriptTime(ch.startTime)}
              </span>
              <span className={`text-xs md:text-[12px] truncate leading-tight ${i === currentIdx ? "text-foreground font-medium" : "text-foreground/75"}`}>
                {ch.title || `Chapter ${i + 1}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

/** Case-insensitive <mark> highlighting of `query` inside `text`. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let idx = 0;
  let from = 0;
  let key = 0;
  while ((idx = lower.indexOf(q, from)) !== -1) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark key={key++} className="bg-brand/25 dark:bg-brand/30 text-inherit rounded-[2px] px-px">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    from = idx + q.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

export function TranscriptSection({
  transcriptUrl,
  transcriptType,
  currentTime,
  onSeek }: {
  transcriptUrl?: string;
  transcriptType?: string;
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Lazy: the transcript file is only fetched the first time the section opens.
  const { segments, isLoading, isError } = usePodcastTranscript(transcriptUrl, transcriptType, open);

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length >= 2;
  const visible = useMemo(
    () => (searching ? segments.filter((s) => s.text.toLowerCase().includes(trimmedQuery.toLowerCase())) : segments),
    [segments, searching, trimmedQuery],
  );

  // Active segment follows playback (binary search not needed at this scale —
  // memoized linear scan over the un-filtered list).
  const activeIdx = useMemo(() => {
    if (searching) return -1;
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start <= currentTime) idx = i;
      else break;
    }
    return idx;
  }, [segments, currentTime, searching]);

  const handleSegmentTap = useCallback(
    (seg: TranscriptSegment) => {
      onSeek(seg.start);
    },
    [onSeek],
  );

  // Reset search when the episode changes.
  useEffect(() => {
    setQuery("");
    setOpen(false);
  }, [transcriptUrl]);

  if (!transcriptUrl) return null;

  return (
    <div className="pt-2 md:pt-1.5 border-t border-border/15 dark:border-brand/10" data-testid="player-transcript">
      <button
        className="w-full flex items-center gap-1.5 px-0.5 min-h-[36px] md:min-h-0 md:py-1 text-muted-foreground/60 hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
        data-testid="button-toggle-transcript"
      >
        <Captions className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
        <span className="text-xs md:text-[11px] font-medium">Transcript</span>
        <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1">
          {isLoading && (
            <div className="flex items-center gap-2 px-1 py-3 text-[11px] text-muted-foreground/50">
              <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> Loading transcript…
            </div>
          )}
          {!isLoading && (isError || segments.length === 0) && (
            <p className="text-[11px] text-muted-foreground/40 px-1 py-2">Couldn't load the transcript for this episode.</p>
          )}
          {!isLoading && segments.length > 0 && (
            <div className="max-h-64 md:max-h-56 overflow-y-auto -mx-1 px-1 relative" data-testid="transcript-list">
              <div className="sticky top-0 z-10 bg-popover/95 backdrop-blur-sm pb-1.5 pt-0.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 pointer-events-none" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search transcript"
                    className="w-full h-8 md:h-7 pl-8 pr-8 rounded-lg bg-muted/20 border border-border/20 text-xs md:text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                    style={{ fontSize: 16 }}
                    data-testid="input-transcript-search"
                  />
                  {query && (
                    <button
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-muted-foreground/40 hover:text-foreground"
                      onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {searching && (
                  <p className="text-[10px] text-muted-foreground/40 px-0.5 pt-1 tabular-nums" data-testid="transcript-match-count">
                    {visible.length === 0 ? "No matches" : `${visible.length} match${visible.length === 1 ? "" : "es"}`}
                  </p>
                )}
              </div>
              <div className="space-y-0.5 pb-1">
                {visible.map((seg, i) => {
                  const origIdx = searching ? -1 : i;
                  const isActive = !searching && origIdx === activeIdx;
                  const prevSpeaker = i > 0 ? visible[i - 1].speaker : undefined;
                  const showSpeaker = !!seg.speaker && seg.speaker !== prevSpeaker;
                  return (
                    <button
                      key={`${seg.start}-${i}`}
                      className={`w-full flex items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors ${ isActive ? "bg-brand/10 dark:bg-brand/15" : "hover:bg-muted/15" }`}
                      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 36px" } as React.CSSProperties}
                      onClick={() => handleSegmentTap(seg)}
                      title="Jump to this moment"
                      data-testid={`transcript-segment-${i}`}
                    >
                      <span className="text-[10px] text-brand/60 tabular-nums shrink-0 w-11 pt-0.5">
                        {formatTranscriptTime(seg.start)}
                      </span>
                      <span className="min-w-0 flex-1">
                        {showSpeaker && (
                          <span className="block text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide">
                            {seg.speaker}
                          </span>
                        )}
                        <span className={`text-xs md:text-[12px] leading-relaxed ${isActive ? "text-foreground" : "text-foreground/75"}`}>
                          <HighlightedText text={seg.text} query={searching ? trimmedQuery : ""} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
