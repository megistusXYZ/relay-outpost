/**
 * Rich message body for Concord encrypted-chat rumors — the same shared pieces
 * the feed/discussion renderers use (applesauce parse → MentionProfileLink,
 * EmbeddedNote, EmbeddedAddressCard, hashtag links), tuned for an E2E room:
 *
 * PRIVACY (deliberate, do not "upgrade"): nothing here may announce the room's
 * contents to an external service. The only network activity a message body
 * can trigger is (a) the batched cached kind-0 profile fetch behind a resolved
 * @mention, (b) an on-demand PUBLIC note fetch when a quoted note/nevent card
 * renders, and (c) the browser loading a directly-linked media file the author
 * pasted (same precedent as Concord's own encrypted attachments rendering
 * inline). Plain links stay plain styled anchors — NO LinkPreviewCard, NO
 * OpenGraph/unfurl fetch, NO third-party embed iframes (YouTube etc.). Both
 * MediaRenderer and LinkPreviewCard auto-fetch, which is why this component
 * composes lighter pieces instead of reusing them wholesale.
 */
import { memo, useMemo, createContext, useContext } from "react";
import { Link } from "wouter";
import { useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import {
  contentComponents,
  getEventEmojiMap,
  emojifyChildren,
  MentionProfileLink,
  EmbeddedNote,
  EmbeddedAddressCard,
  TextWithUnresolvedNostr,
} from "@/components/NostrPost";
import { resolveNostrEmbed } from "@/components/nostr-post/embed-resolution";
import {
  rumorRenderEvent,
  concordLinkKind,
  replyPreviewSegments,
} from "@/lib/concord/concord-message-render";
import { useConcordProfile } from "./ConcordIdentity";

/**
 * In-group #channel navigation. A hashtag typed in a Concord message (e.g.
 * "#live") means the channel by that name IN THIS group — not a global content
 * tag — so it should jump to that channel, not the public hashtag-search page.
 * ConcordChat provides the group's channels + a selector; a hashtag that matches
 * a channel name becomes an in-group jump, and anything else falls back to the
 * normal search link (a member could still tag a real content topic).
 */
export interface ConcordChannelNav {
  channels: { id: string; name: string }[];
  onSelect: (channelId: string) => void;
}
const ChannelNavContext = createContext<ConcordChannelNav | null>(null);
export const ConcordChannelNavProvider = ChannelNavContext.Provider;

function ConcordHashtag({ name }: { name: string }) {
  const nav = useContext(ChannelNavContext);
  const match = nav?.channels.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (nav && match) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); nav.onSelect(match.id); }}
        className="text-brand dark:text-brand/90 font-medium hover:underline underline-offset-2 rounded px-0.5 -mx-0.5 hover:bg-brand/10 transition-colors"
        data-testid={`concord-channel-link-${name}`}
        title={`Go to #${match.name}`}
      >
        #{name}
      </button>
    );
  }
  // No channel by that name — treat it as a normal content hashtag (search).
  return (
    <Link
      href={`/search?tab=hashtags&q=${encodeURIComponent(`#${name}`)}`}
      className="text-brand/80 hover:underline underline-offset-2"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      data-testid={`link-hashtag-${name}`}
    >
      #{name}
    </Link>
  );
}

/**
 * Legacy plain "@Name" mentions (messages sent before the composer switched to
 * content-level nostr:npub tokens) keep their highlight; everything else in a
 * text run falls through to the shared resolver (stray nostr:/wss tokens).
 */
function ConcordText({ text }: { text: string }) {
  const parts = text.split(/(@\w[\w.]*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <span key={i} className="text-brand font-medium">{p}</span>
        ) : p ? (
          <TextWithUnresolvedNostr key={i} text={p} />
        ) : null,
      )}
    </>
  );
}

const concordChatComponents: ComponentMap = {
  ...contentComponents,
  text: ({ node }) => <ConcordText text={node.value} />,
  // #channel → jump to that channel in this group (falls back to search).
  hashtag: ({ node }) => <ConcordHashtag name={node.name} />,
  mention: ({ node }) => {
    // Shared resolver (same one the feed + embedded-note renderers use, so the
    // treatments can't drift): npub/nprofile → resolved @name chip that opens
    // the profile; note/nevent → compact tappable quoted-note card; naddr →
    // addressable card (article/wiki/event).
    const res = resolveNostrEmbed(node.decoded as any, { nested: false });
    if (res.render === "mention") return <MentionProfileLink pubkey={res.pubkey} />;
    if (res.render === "note-embed") {
      return (
        <span className="block max-w-full sm:max-w-sm">
          <EmbeddedNote eventId={res.eventId} encoded={node.encoded} relays={res.relays} />
        </span>
      );
    }
    if (res.render === "address-card") {
      return (
        <span className="block max-w-full sm:max-w-sm">
          <EmbeddedAddressCard kind={res.kind} pubkey={res.pubkey} identifier={res.identifier} relays={res.relays} encoded={node.encoded} />
        </span>
      );
    }
    return <span className="text-brand dark:text-brand/90">{node.encoded.slice(0, 16)}…</span>;
  },
  link: ({ node }) => {
    const url = node.href || node.value || "";
    if (!url) return null;
    const kind = concordLinkKind(url);
    // Direct media files render inline, sized like Concord's own attachments
    // (ConcordMediaView) so pasted and uploaded media read the same.
    if (kind === "image") {
      return (
        <img src={url} alt="" loading="lazy" decoding="async"
          className="block my-1 rounded-lg max-w-full sm:max-w-[280px] max-h-[360px] w-auto h-auto object-contain border border-border/20" />
      );
    }
    if (kind === "video") {
      return (
        <video src={url} controls playsInline preload="metadata"
          className="block my-1 rounded-lg max-w-full sm:max-w-[280px] max-h-[360px] border border-border/20"
          onClick={(e: React.MouseEvent) => e.stopPropagation()} />
      );
    }
    if (kind === "audio") {
      return <audio src={url} controls preload="metadata" className="block my-1 w-full max-w-full sm:max-w-[280px]" />;
    }
    // DELIBERATE: a plain styled anchor. An encrypted room must not phone home
    // about its links, so there is no link-preview/OG fetch and no embed here.
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand/80 hover:text-brand-strong underline underline-offset-2 decoration-brand/30 transition-colors break-all"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {url.length > 60 ? `${url.slice(0, 50)}…${url.slice(-10)}` : url}
      </a>
    );
  },
};

const concordContentCacheKey = Symbol.for("concord-content-v1");

/**
 * Memoized (the chat list re-renders on every reaction/typing tick — scalar
 * props keep the parse + component tree stable per message). The pseudo-event
 * is memoized so applesauce's per-event parse cache holds across renders.
 */
export const ConcordMessageBody = memo(function ConcordMessageBody({ id, pubkey, content }: {
  id: string; pubkey: string; content: string;
}) {
  const pseudoEvent = useMemo(() => rumorRenderEvent({ id, pubkey, content }), [id, pubkey, content]);
  const raw = useRenderedContent(pseudoEvent, concordChatComponents, { cacheKey: concordContentCacheKey });
  const emojiMap = useMemo(() => getEventEmojiMap(pseudoEvent), [pseudoEvent]);
  const rendered = useMemo(() => (raw && emojiMap ? emojifyChildren(raw, emojiMap) : raw), [raw, emojiMap]);
  return <>{rendered}</>;
});

/** Resolved "@DisplayName" (plain text, no link) for one-line previews. */
function PreviewMentionName({ pubkey }: { pubkey: string }) {
  const { name } = useConcordProfile(pubkey);
  return <span className="text-brand/80">@{name}</span>;
}

/**
 * One-line preview of a message (reply quotes + the composer's "Replying to"
 * bar): npub/nprofile tokens resolve to @DisplayName instead of being stripped
 * as bech32 noise; note/nevent/naddr refs collapse away ("Shared a post" when
 * nothing else remains). `fallback` wins over "Shared a post" (callers pass
 * "Attachment" when the parent had media), matching the old precedence.
 */
export function ConcordContentPreview({ content, fallback }: { content: string; fallback?: string }) {
  const parsed = useMemo(() => replyPreviewSegments(content), [content]);
  if (parsed.segments.length === 0) {
    return <>{fallback || (parsed.hadRef ? "Shared a post" : "")}</>;
  }
  return (
    <>
      {parsed.segments.map((seg, i) =>
        seg.type === "mention" ? <PreviewMentionName key={i} pubkey={seg.pubkey} /> : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}
