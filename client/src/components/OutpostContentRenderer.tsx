import { useMemo } from "react";
import type { Event } from "nostr-tools";
import { useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import { contentComponents, getEventEmojiMap, emojifyChildren } from "@/components/NostrPost";
import { MediaRenderer } from "@/components/MediaRenderer";
import { classifyUrl, getEventMediaInfo, parseImetaTags } from "@/lib/media-utils";

const MEDIA_TYPES = new Set(["image", "video", "audio", "youtube", "vimeo", "rumble"]);

const outpostContentComponents: ComponentMap = {
  ...contentComponents,
  link: ({ node }) => {
    const url = node.href || node.value || "";
    if (!url) return null;
    const type = classifyUrl(url);
    if (MEDIA_TYPES.has(type)) return null;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand/80 hover:text-brand-strong underline underline-offset-2 decoration-brand/30 transition-colors break-all"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {url.length > 60 ? `${url.slice(0, 50)}...${url.slice(-10)}` : url}
      </a>
    );
  },
};

const outpostContentCacheKey = Symbol.for("outpost-content-v1");

interface OutpostContentRendererProps {
  event: Event;
  compact?: boolean;
}

export function OutpostContentRenderer({ event, compact = false }: OutpostContentRendererProps) {
  const mediaInfo = useMemo(() => getEventMediaInfo(event.content, event.tags), [event.content, event.tags]);
  const hasAnyMedia = mediaInfo.hasImage || mediaInfo.hasVideo || mediaInfo.hasAudio;

  const rawRenderedContent = useRenderedContent(event, outpostContentComponents, {
    cacheKey: outpostContentCacheKey,
  });

  const eventEmojiMap = useMemo(() => getEventEmojiMap(event), [event]);
  const renderedContent = useMemo(() => {
    if (!rawRenderedContent || !eventEmojiMap) return rawRenderedContent;
    return emojifyChildren(rawRenderedContent, eventEmojiMap);
  }, [rawRenderedContent, eventEmojiMap]);

  return (
    <div className="space-y-2">
      {renderedContent && (
        <div className={`${compact ? "text-xs" : "text-[15px]"} text-foreground/90 leading-relaxed whitespace-pre-wrap break-words`}>
          {renderedContent}
        </div>
      )}
      {hasAnyMedia && (
        <MediaRenderer event={event} compact={compact} />
      )}
    </div>
  );
}

export function getFirstImageUrl(content: string, tags: string[][] = []): string | null {
  const urlRegex = /(https?:\/\/[^\s<>"]+)/g;
  let match;
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[1].replace(/[).,;:!?\]}>]+$/, "");
    if (classifyUrl(url) === "image") return url;
  }

  const imetaData = parseImetaTags(tags);
  for (const d of imetaData) {
    const t = d.mimeType ? (d.mimeType.startsWith("image/") ? "image" : null) : classifyUrl(d.url);
    if (t === "image") return d.url;
  }

  for (const tag of tags) {
    if ((tag[0] === "url" || tag[0] === "r") && tag[1]) {
      if (classifyUrl(tag[1]) === "image") return tag[1];
    }
  }

  return null;
}
