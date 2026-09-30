import { useMemo, useState } from "react";
import { useRenderedContent } from "applesauce-react/hooks";
import type { Event } from "nostr-tools";
import { contentComponents } from "@/components/NostrPost";
import { MediaRenderer } from "@/components/MediaRenderer";
import { ClampedText, LINES, textForLines } from "@/components/ClampedText";
import { normalizeNostrClientLinks } from "@/lib/nostr-client-links";

const COMMENT_CACHE_KEY = Symbol.for("article-comment-content-v1");
const COMMENT_CUT_CACHE_KEY = Symbol.for("article-comment-content-cut-v1");

/**
 * A comment rendered the way posts render: nostr: references become embedded
 * cards and profile mentions, and images, GIFs and links get the posts' media
 * and preview treatment — not raw `nostr:naddr1…` strings and bare URLs.
 */
export function CommentContent({ event }: { event: Event }) {
  // Links to other Nostr clients become nostr: references (an embedded card or
  // an @mention). Rendered raw, they vanished: the text drops http links and
  // the media/preview side skips client links.
  // While cut at six lines, only what those lines can show is rendered.
  const [expanded, setExpanded] = useState(false);
  const normalized = useMemo(() => {
    const full = normalizeNostrClientLinks(event.content);
    const content = textForLines(full, LINES.comment, expanded);
    const derived = { ...event, content };
    // A cut copy must not share the full render's parse cache (it lives on the
    // event as a symbol property, which the spread copies).
    if (content !== full) Reflect.deleteProperty(derived, COMMENT_CACHE_KEY);
    return derived;
  }, [event, expanded]);
  const cut = normalized.content !== normalizeNostrClientLinks(event.content);
  const rendered = useRenderedContent(normalized, contentComponents, { cacheKey: cut ? COMMENT_CUT_CACHE_KEY : COMMENT_CACHE_KEY });
  return (
    <div className="text-sm text-foreground/80 break-words leading-relaxed" data-testid={`comment-content-${event.id.slice(0, 8)}`}>
      {/* Long comments are cut at six lines with Show more (owner, 2026-09-30). */}
      <ClampedText
        lines={LINES.comment}
        className="whitespace-pre-wrap"
        testId={`comment-text-${event.id.slice(0, 8)}`}
        toggleTestId={`button-comment-more-${event.id.slice(0, 8)}`}
        expanded={expanded}
        onExpandedChange={setExpanded}
      >
        {rendered}
      </ClampedText>
      <MediaRenderer event={event} compact />
    </div>
  );
}
