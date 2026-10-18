/**
 * The article a note or comment answers, shown on top of it in the feed
 * (owner, 2026-10-18): cover, title, author and read time on one slim strip,
 * tapping through to the article. A reply that only said "great point" now
 * says which piece it is about, and invites the reader to it.
 *
 * Links even before the article loads (the address is known), and when the
 * relays can't be reached, the strip still opens it.
 */
import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { BookOpen } from "lucide-react";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { estimateReadingTime } from "@/lib/nip23";
import { proxiedImageUrl } from "@/lib/media-utils";
import { KIND_ARTICLE, type ArticleCoord } from "@/lib/article-reply";
import { useAddressableEvent } from "@/hooks/use-addressable-event";

export function ArticleRibbon({ coord, replyAuthor }: { coord: ArticleCoord; replyAuthor: string }) {
  const [, navigate] = useLocation();
  const relays = useMemo(() => (coord.relay ? [coord.relay] : undefined), [coord.relay]);
  const { resolved } = useAddressableEvent(KIND_ARTICLE, coord.pubkey, coord.identifier, relays);
  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, coord.pubkey), [coord.pubkey]);
  useEffect(() => { if (!authorProfile) fetchProfilesCached([coord.pubkey]); }, [authorProfile, coord.pubkey]);

  const tag = (name: string) => resolved?.tags.find((t) => t[0] === name)?.[1];
  const title = tag("title") || coord.identifier.replace(/[-_]+/g, " ");
  const cover = tag("image");
  const fallbackName = shortenNpub(formatNpub(coord.pubkey));
  const author = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const minutes = resolved ? estimateReadingTime(resolved.content) : null;
  const ownArticle = replyAuthor === coord.pubkey;

  const href = useMemo(() => {
    try {
      return `/articles/${nip19.naddrEncode({ kind: KIND_ARTICLE, pubkey: coord.pubkey, identifier: coord.identifier, relays: relays ?? [] })}`;
    } catch {
      return null;
    }
  }, [coord.pubkey, coord.identifier, relays]);

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (href) navigate(href); }}
      className="group/ribbon mb-2 flex w-full items-center gap-3 rounded-lg border border-border/50 bg-foreground/[0.02] px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.05] hover:border-border"
      aria-label={`Open the article ${title}`}
      data-testid="article-ribbon"
    >
      {cover ? (
        <img
          src={proxiedImageUrl(cover, 120)}
          alt=""
          aria-hidden="true"
          loading="eager"
          className="h-11 w-11 shrink-0 rounded-md object-cover"
          data-testid="article-ribbon-cover"
        />
      ) : (
        <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground ml-1" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted-foreground" data-testid="article-ribbon-eyebrow">
          {ownArticle ? "More on their article" : "On the article"}
        </span>
        <span className="block truncate text-sm font-semibold text-foreground group-hover/ribbon:underline underline-offset-2" data-testid="article-ribbon-title">
          {title}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground" data-testid="article-ribbon-meta">
          {ownArticle ? "" : `by ${author}`}{minutes !== null ? `${ownArticle ? "" : " · "}${minutes} min read` : ""}
        </span>
      </span>
    </button>
  );
}
