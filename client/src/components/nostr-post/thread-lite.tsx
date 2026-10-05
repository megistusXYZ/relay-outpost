/**
 * The small part of the thread module a post in a FEED needs: which post a
 * reply answers, the docked reply bar's context, and the "replying to" preview.
 * Kept apart from thread.tsx (the thread view and its composers) so a feed's
 * first load doesn't carry the composers, emoji picker and mention search —
 * those load when a thread or composer is first opened (guest-first-load.test.ts).
 */
import { createContext, useContext, useMemo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link, useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import { ClampedText, LINES, textForLines } from "@/components/ClampedText";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { eventStore } from "@/lib/nostr";
import { replyTargetOf, threadRootOf } from "@/lib/reply-target";
import { getAvatarUrl, getDisplayName, KIND_METADATA, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { ParsedPreviewText } from "../NostrPost";

// Both reply generations — NIP-10 kind 1 and NIP-22 kind 1111 (Amethyst's
// write format since 2026-08) — resolve through the shared, tested lib.
export function getReplyTargetId(event: Event): string | null {
  return replyTargetOf(event);
}

export function getRootEventId(event: Event): string | null {
  return threadRootOf(event);
}

/** The phone's docked reply bar (ReplyDock in thread.tsx provides it). */
export const ReplyDockContext = createContext<{ replyTo: (e: Event) => void } | null>(null);

/** Inside a docked thread page: Reply buttons hand their post to the bar. */
export function useReplyDock() {
  return useContext(ReplyDockContext);
}

/**
 * variant "note" is the margin note (reply-margin.ts): the same content as
 * "card", but it sits on the PAGE rather than inside a post card, so it gets a
 * real card surface and border. On the light page the inset card's 15% tint
 * and 20% border all but vanished (measured 2026-10-01).
 */
export function ParentPostPreview({ event, variant = "card" }: { event: Event; variant?: "card" | "spine" | "note" }) {
  const [, navigate] = useLocation();
  const parentAuthorProfile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const fallback = shortenNpub(formatNpub(event.pubkey));
  const name = parentAuthorProfile ? (getDisplayName(parentAuthorProfile, fallback) ?? fallback) : fallback;
  const avatar = getAvatarUrl(parentAuthorProfile);
  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(event.pubkey)}`; } catch { return "#"; }
  }, [event.pubkey]);
  const timeAgo = useMemo(() => {
    try { return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true }); } catch { return ""; }
  }, [event.created_at]);
  // Only what three lines can show is ever rendered here (one parent was
  // 46,238 characters).
  const contentText = useMemo(() => {
    return textForLines(event.content.replace(/https?:\/\/\S+/g, "").trim(), LINES.context, false);
  }, [event.content]);
  // Parent was ONLY a shared reference (quote/article token, no prose):
  // ParsedPreviewText strips those tokens, which would leave the preview
  // blank — label it instead.
  const refOnly = useMemo(() => {
    const withoutTokens = contentText.replace(/nostr:[a-z0-9]+/gi, "").trim();
    return contentText.length > 0 && withoutTokens.length === 0 && /nostr:(note1|nevent1|naddr1)/i.test(contentText);
  }, [contentText]);

  const noteUrl = useMemo(() => {
    try { return `/thread/${nip19.noteEncode(event.id)}`; } catch { return "#"; }
  }, [event.id]);

  const isSpine = variant === "spine";
  return (
    <div
      className={isSpine
        // pb + the line's negative bottom carry the thread past this block and
        // into the reply, so the two read as one continuous exchange. The
        // gradient STRENGTHENS downward for the same reason: it is pointing at
        // what comes next, and a line that fades out at the bottom says the
        // opposite of that.
        ? "relative pl-6 pb-3 cursor-pointer group/parent"
        : variant === "note"
          ? "rounded-lg bg-card border border-border/60 dark:border-white/[0.07] border-l-2 border-l-brand/50 dark:border-l-brand/40 p-2.5 space-y-1.5 shadow-sm shadow-black/[0.04] dark:shadow-none cursor-pointer hover:border-border transition-colors"
          : "rounded-lg bg-muted/15 border border-border/20 border-l-2 border-l-brand/40 dark:border-l-brand/30 p-2.5 space-y-1.5 shadow-sm dark:shadow-md dark:shadow-black/20 cursor-pointer hover:bg-muted/25 transition-colors"}
      data-testid={`parent-preview-${event.id}`}
      onClick={(e) => { e.stopPropagation(); navigate(noteUrl); }}
    >
      {isSpine && (
        <span
          aria-hidden="true"
          className="absolute left-[9px] top-5 -bottom-1 w-[1.5px] rounded-full bg-gradient-to-b from-primary/25 to-primary/50 dark:from-brand/25 dark:to-brand/50 group-hover/parent:to-primary/70 dark:group-hover/parent:to-brand/70 transition-colors"
          data-testid={`parent-spine-${event.id}`}
        />
      )}
      <div className={isSpine ? "flex items-center gap-2 mb-1" : "flex items-center gap-2"}>
        <Link href={profileUrl} data-testid={`link-parent-avatar-${event.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <Avatar className={isSpine
            ? "w-[18px] h-[18px] shrink-0 -ml-6 ring-2 ring-background cursor-pointer"
            : "w-5 h-5 shrink-0 ring-1 ring-border/30 cursor-pointer"}>
            <AvatarImage src={avatar} alt={name} />
            <AvatarFallback className="bg-brand/10 text-brand text-[8px] font-bold">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
        <Link href={profileUrl} data-testid={`link-parent-name-${event.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <span className="text-[11px] font-semibold text-foreground/80 cursor-pointer truncate max-w-[160px]">{name}</span>
        </Link>
        <span className={`text-[11px] ${variant === "note" ? "text-muted-foreground" : "text-muted-foreground/60"}`}>{timeAgo}</span>
      </div>
      {contentText && (
        // Context, not the post: three lines at most, and tapping opens the
        // parent (owner, 2026-09-30; one of these ran to 21,450 px).
        <ClampedText
          as="p"
          lines={LINES.context}
          expandable={false}
          className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-words"
          testId={`text-parent-content-${event.id}`}
        >
          {refOnly ? (
            <span className="italic text-muted-foreground/70">Shared a post</span>
          ) : (
            <ParsedPreviewText text={contentText} />
          )}
        </ClampedText>
      )}
    </div>
  );
}


