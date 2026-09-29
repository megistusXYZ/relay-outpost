import { useMemo } from "react";
import { useRenderedContent } from "applesauce-react/hooks";
import type { Event } from "nostr-tools";
import { contentComponents } from "@/components/NostrPost";
import { MediaRenderer } from "@/components/MediaRenderer";
import { normalizeNostrClientLinks } from "@/lib/nostr-client-links";

const COMMENT_CACHE_KEY = Symbol.for("article-comment-content-v1");

/**
 * A comment rendered the way posts render: nostr: references become embedded
 * cards and profile mentions, and images, GIFs and links get the posts' media
 * and preview treatment — not raw `nostr:naddr1…` strings and bare URLs.
 */
export function CommentContent({ event }: { event: Event }) {
  // Links to other Nostr clients become nostr: references (an embedded card or
  // an @mention). Rendered raw, they vanished: the text drops http links and
  // the media/preview side skips client links.
  const normalized = useMemo(() => ({ ...event, content: normalizeNostrClientLinks(event.content) }), [event]);
  const rendered = useRenderedContent(normalized, contentComponents, { cacheKey: COMMENT_CACHE_KEY });
  return (
    <div className="text-sm text-foreground/80 break-words leading-relaxed" data-testid={`comment-content-${event.id.slice(0, 8)}`}>
      <div className="whitespace-pre-wrap">{rendered}</div>
      <MediaRenderer event={event} compact />
    </div>
  );
}
