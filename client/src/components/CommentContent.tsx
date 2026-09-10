import { useRenderedContent } from "applesauce-react/hooks";
import type { Event } from "nostr-tools";
import { contentComponents } from "@/components/NostrPost";
import { MediaRenderer } from "@/components/MediaRenderer";

const COMMENT_CACHE_KEY = Symbol.for("article-comment-content-v1");

/**
 * A comment rendered the way posts render: nostr: references become embedded
 * cards and profile mentions, and images, GIFs and links get the posts' media
 * and preview treatment — not raw `nostr:naddr1…` strings and bare URLs.
 */
export function CommentContent({ event }: { event: Event }) {
  const rendered = useRenderedContent(event, contentComponents, { cacheKey: COMMENT_CACHE_KEY });
  return (
    <div className="text-sm text-foreground/80 break-words leading-relaxed" data-testid={`comment-content-${event.id.slice(0, 8)}`}>
      <div className="whitespace-pre-wrap">{rendered}</div>
      <MediaRenderer event={event} compact />
    </div>
  );
}
