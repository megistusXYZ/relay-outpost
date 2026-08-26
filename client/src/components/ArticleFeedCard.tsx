import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { nip19, type Event } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA } from "@/lib/nostr-helpers";
import { getDisplayName, getAvatarUrl, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { BookOpen } from "lucide-react";

/**
 * Compact long-form (kind 30023) card for the Discover feed — title, summary,
 * cover image, author, reading affordance. Tapping opens the article viewer.
 * Media-rich kind-1 posts already render inline via NostrPost/MediaRenderer, so
 * this covers the one "rich mix" kind the note renderer doesn't.
 */
export function ArticleFeedCard({ event }: { event: Event }) {
  const [, navigate] = useLocation();

  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  const identifier = tag("d") || "";
  const title = tag("title") || "Untitled";
  const summary = tag("summary") || "";
  const image = tag("image");

  const naddr = useMemo(() => {
    try {
      return nip19.naddrEncode({ kind: 30023, pubkey: event.pubkey, identifier, relays: [] });
    } catch {
      return null;
    }
  }, [event.pubkey, identifier]);

  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  useEffect(() => { fetchProfilesCached([event.pubkey]); }, [event.pubkey]);

  const fallbackName = shortenNpub(formatNpub(event.pubkey));
  const name = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatar = getAvatarUrl(authorProfile);
  const timeAgo = (() => {
    try { return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true }); } catch { return ""; }
  })();

  const open = () => { if (naddr) navigate(`/articles/${naddr}`); };

  return (
    <div
      className="mx-5 sm:mx-8 my-4 rounded-xl border border-border/50 dark:border-brand/15 bg-card/40 overflow-hidden cursor-pointer hover:border-brand/30 transition-colors"
      onClick={open}
      data-testid={`article-card-${event.id}`}
    >
      {image && (
        <div className="w-full aspect-[2/1] bg-muted/30 overflow-hidden">
          <img src={image} alt={title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-brand/70">
          <BookOpen className="w-3 h-3" /> Article
        </div>
        <h3 className="text-base font-semibold leading-snug text-foreground/90 line-clamp-2">{title}</h3>
        {summary && <p className="text-sm text-muted-foreground/80 leading-relaxed line-clamp-2">{summary}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Avatar className="w-5 h-5 ring-1 ring-border/30">
            <AvatarImage src={avatar} alt={name} />
            <AvatarFallback className="bg-brand/10 text-brand text-[8px] font-bold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-xs font-medium text-foreground/70 truncate max-w-[160px]">{name}</span>
          <span className="text-[11px] text-muted-foreground/50">{timeAgo}</span>
        </div>
      </div>
    </div>
  );
}
