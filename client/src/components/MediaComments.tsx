import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { use$ } from "applesauce-react/hooks";
import { eventStore, publishEvent, fetchProfilesCached, getEventRelays, pool, getRelaysForPurpose, DEFAULT_RELAYS } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { KIND_TEXT_NOTE, KIND_METADATA, getRelayHintForEvent, extractHashtags } from "@/lib/nostr-helpers";
import { commentKindFor, buildMediaCommentTags, commentFiltersFor, isCommentOn } from "@/lib/media-thread";
import { signWithTimeout } from "@/lib/signer-timeout";
import { fetchThreadView, primalStatsCache } from "@/lib/primal-cache";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getAvatarUrl, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { MentionHighlightTextarea } from "@/components/MentionHighlightTextarea";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { formatDistanceToNow } from "date-fns";
import { X, MessageCircle, Send, CornerUpLeft, ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Event } from "nostr-tools";

function MediaReplyComposer({ replyTo, onClose, onPublished }: { replyTo: Event; onClose: () => void; onPublished?: () => void }) {
  const [content, setContent] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const { signer, profile } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [vpRect, setVpRect] = useState<{ height: number; top: number } | null>(null);

  useEffect(() => {
    if (!isMobile) return;
    const timer = setTimeout(() => textareaRef.current?.focus(), 100);

    const vv = window.visualViewport;
    const update = () => {
      if (vv) {
        setVpRect({ height: vv.height, top: vv.offsetTop });
      }
    };
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    return () => {
      clearTimeout(timer);
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
    };
  }, [isMobile]);

  const handlePublish = async () => {
    if (!content.trim() || !signer) return;
    setIsPublishing(true);
    try {
      const hint = getRelayHintForEvent(replyTo.id, getEventRelays);
      // Kind-aware (media-thread.ts): kind-1 roots take kind-1 NIP-10 replies;
      // kind-20 pictures take NIP-22 kind-1111 — the vocabulary Olas/Amethyst
      // actually read. A kind-1 reply at a kind-20 root is a comment the
      // picture author's client never shows.
      const tags = [...buildMediaCommentTags(replyTo, hint), ...extractHashtags(content)];
      const eventTemplate = { kind: commentKindFor(replyTo), created_at: Math.floor(Date.now() / 1000), tags, content: content.trim() };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, undefined, isUserSelected);
      setContent("");
      onClose();
      onPublished?.();
    } catch (err) {
      console.error(err);
      toast({ title: "Failed", description: "Could not send reply.", variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isMobile) { e.preventDefault(); handlePublish(); }
  };

  if (isMobile) {
    return createPortal(
      <div className="fixed left-0 right-0 z-[90] flex flex-col" style={vpRect ? { top: `${vpRect.top}px`, height: `${vpRect.height}px` } : { top: 0, bottom: 0 }} data-testid={`media-reply-composer-${replyTo.id}`}>
        <div className="flex-1 bg-black/40" onClick={onClose} />
        <div className="bg-background border-t border-border/50" style={vpRect ? {} : { paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <CornerUpLeft className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            <span className="text-xs text-muted-foreground/70 truncate">Add a comment</span>
            <button onClick={onClose} className="ml-auto p-1 text-muted-foreground/60 cursor-pointer" data-testid={`button-cancel-media-reply-${replyTo.id}`}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-end gap-2 px-3 py-2">
            <Avatar className="w-7 h-7 border border-border/50 shrink-0 mb-0.5">
              <AvatarImage src={profile?.picture} alt="You" />
              <AvatarFallback className="text-xs bg-muted text-muted-foreground">{(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <MentionHighlightTextarea
              ref={textareaRef}
              placeholder="Write a comment..."
              className="flex-1 min-h-[42px] max-h-[120px] bg-muted/30 border-border/40 resize-none focus-visible:ring-0 text-foreground/90"
              style={{ fontSize: "16px" }}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              autoComplete="off"
              data-testid={`input-media-reply-${replyTo.id}`}
            />
            <Button size="icon" disabled={!content.trim() || isPublishing} onClick={handlePublish} className="shrink-0 mb-0.5" data-testid={`button-send-media-reply-${replyTo.id}`}>
              {isPublishing ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="mt-1 pt-1" data-testid={`media-reply-composer-${replyTo.id}`}>
      <div className="flex gap-2">
        <Avatar className="w-7 h-7 border border-border/50 shrink-0">
          <AvatarImage src={profile?.picture} alt="You" />
          <AvatarFallback className="text-xs bg-muted text-muted-foreground">{(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1 flex flex-col gap-2">
          <MentionHighlightTextarea
            ref={textareaRef}
            placeholder="Write a comment..."
            className="min-h-[50px] bg-background/40 border-border/40 resize-none focus-visible:ring-0 text-sm text-foreground/90"
            style={{ fontSize: 16 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            autoComplete="off"
            data-testid={`input-media-reply-${replyTo.id}`}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} data-testid={`button-cancel-media-reply-${replyTo.id}`}>
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
            <Button size="sm" disabled={!content.trim() || isPublishing} onClick={handlePublish} data-testid={`button-send-media-reply-${replyTo.id}`}>
              {isPublishing ? <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              Reply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaCommentItem({ reply }: { reply: Event }) {
  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, reply.pubkey), [reply.pubkey]);
  const fallbackName = shortenNpub(formatNpub(reply.pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(authorProfile);

  const timeAgo = useMemo(() => {
    try { return formatDistanceToNow(new Date(reply.created_at * 1000), { addSuffix: true }); }
    catch { return ""; }
  }, [reply.created_at]);

  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(reply.pubkey)}`; }
    catch { return "#"; }
  }, [reply.pubkey]);

  return (
    <div className="flex gap-2 sm:gap-2.5 py-1.5" data-testid={`media-comment-${reply.id}`}>
      <Link href={profileUrl}>
        <Avatar className="w-5 h-5 sm:w-6 sm:h-6 border border-border/40 shrink-0">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback className="text-[7px] sm:text-[8px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] sm:text-xs leading-relaxed break-words">
          <Link href={profileUrl} className="font-semibold text-foreground/90 mr-1 sm:mr-1.5" data-testid={`link-comment-author-${reply.id}`}>{displayName}</Link>
          <span className="text-foreground/70">{reply.content.length > 300 ? reply.content.slice(0, 300) + "..." : reply.content}</span>
        </p>
        <span className="text-[9px] sm:text-[10px] text-muted-foreground/50 mt-0.5 block">{timeAgo}</span>
      </div>
    </div>
  );
}

const replyCache = new Map<string, Event[]>();

/**
 * Comments under a non-kind-1 root (kind-20 pictures). Primal's thread view
 * only walks kind-1 e-tag replies, so it cannot see NIP-22 kind-1111 — this
 * asks the relays directly: the NIP-22 set (#E) plus the legacy kind-1 #e
 * sweep, deduped, oldest-first sorting handled by the caller.
 */
async function fetchPictureComments(event: Event): Promise<Event[]> {
  const relays = Array.from(new Set([
    ...getEventRelays(event.id),
    ...getRelaysForPurpose("notes"),
    ...DEFAULT_RELAYS,
  ])).slice(0, 8);
  const results = await Promise.all(
    commentFiltersFor(event).map((f) => pool.querySync(relays, f).catch(() => [] as Event[])),
  );
  const seen = new Set<string>();
  const out: Event[] = [];
  for (const e of results.flat()) {
    if (seen.has(e.id) || !isCommentOn(e, event.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

export function MediaCommentsSection({ event, open, autoComposer = false }: { event: Event; open: boolean; autoComposer?: boolean }) {
  const { signer } = useNostrAuth();
  const cached = replyCache.get(event.id);
  const [replies, setReplies] = useState<Event[]>(cached ?? []);
  const [loading, setLoading] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  // Opened via the comment ICON = "I want to write" (Instagram opens its sheet
  // with the keyboard ready) — the composer comes up without the extra "Add a
  // comment..." tap. Opened via "View all N comments" = reading; composer waits.
  useEffect(() => {
    if (open && autoComposer && signer) setShowComposer(true);
  }, [open, autoComposer, signer]);
  const [collapsed, setCollapsed] = useState(false);
  const [sortOrder, setSortOrder] = useState<"oldest" | "newest">(() => {
    try {
      const saved = localStorage.getItem("relay-outpost-default-comment-sort");
      if (saved === "newest") return "newest";
    } catch {}
    return "oldest";
  });
  const openCountRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const thisOpen = ++openCountRef.current;
    const hasCached = replyCache.has(event.id);
    if (!hasCached) setLoading(true);
    (event.kind === KIND_TEXT_NOTE ? fetchThreadView(event.id) : fetchPictureComments(event))
      .then(async (r) => {
        if (openCountRef.current !== thisOpen) return;
        replyCache.set(event.id, r);
        setReplies(r);
        const existing = primalStatsCache.get(event.id);
        const existingReplies = existing?.replies ?? 0;
        if (r.length > existingReplies) {
          primalStatsCache.set(event.id, {
            replies: r.length,
            reposts: existing?.reposts ?? 0,
            likes: existing?.likes ?? 0,
            zaps: existing?.zaps ?? 0,
            zapAmount: existing?.zapAmount ?? 0,
          });
        }
        const pubkeys = Array.from(new Set(r.map((e) => e.pubkey)));
        if (pubkeys.length > 0) fetchProfilesCached(pubkeys.slice(0, 50));
      })
      .catch((err) => console.error("Failed to fetch comments:", err))
      .finally(() => {
        if (openCountRef.current === thisOpen) setLoading(false);
      });
  }, [event.id, open]);

  useEffect(() => {
    if (!open) return;
    const sub = eventStore.insert$.subscribe((e) => {
      // Kind-gated comment match (media-thread.ts): kind-1 e-tag replies AND
      // kind-1111 NIP-22 comments; reactions/reposts carry the same e-tag and
      // must not land here.
      if (!isCommentOn(e, event.id)) return;
      setReplies((prev) => {
        if (prev.some((p) => p.id === e.id)) return prev;
        const updated = [...prev, e];
        replyCache.set(event.id, updated);
        const existing = primalStatsCache.get(event.id);
        primalStatsCache.set(event.id, {
          replies: updated.length,
          reposts: existing?.reposts ?? 0,
          likes: existing?.likes ?? 0,
          zaps: existing?.zaps ?? 0,
          zapAmount: existing?.zapAmount ?? 0,
        });
        return updated;
      });
    });
    return () => sub.unsubscribe();
  }, [event.id, open]);

  const sortedReplies = useMemo(
    () => [...replies].sort((a, b) => sortOrder === "oldest" ? a.created_at - b.created_at : b.created_at - a.created_at),
    [replies, sortOrder]
  );

  const cachedReplyCount = useMemo(() => {
    const stats = primalStatsCache.get(event.id);
    return stats?.replies ?? 0;
  }, [event.id]);

  if (!open) return null;

  if (loading && sortedReplies.length === 0) {
    return (
      <div className="px-2.5 sm:px-3 pb-2.5 sm:pb-3 flex items-center gap-2 text-muted-foreground" data-testid={`media-comments-loading-${event.id}`}>
        <RelayOutpostInlineLoader />
        <span className="text-[11px] sm:text-xs">
          {cachedReplyCount > 0
            ? `Loading ${cachedReplyCount} ${cachedReplyCount === 1 ? "comment" : "comments"}...`
            : "Loading comments..."}
        </span>
      </div>
    );
  }

  return (
    <div className="px-2.5 sm:px-3 pb-2.5 sm:pb-3" data-testid={`media-comments-${event.id}`}>
      {sortedReplies.length > 0 && (
        <div className="flex items-center justify-between mb-1">
          <div
            className="flex items-center gap-1.5 cursor-pointer"
            onClick={() => setCollapsed((c) => !c)}
            data-testid={`button-toggle-comments-${event.id}`}
          >
            <MessageCircle className="w-3 h-3 text-muted-foreground/60" />
            <span className="text-[11px] sm:text-xs font-medium text-muted-foreground/80">
              {sortedReplies.length} {sortedReplies.length === 1 ? "comment" : "comments"}
              {loading && <span className="text-muted-foreground/50 ml-1">(refreshing...)</span>}
            </span>
            {collapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground/50" /> : <ChevronUp className="w-3 h-3 text-muted-foreground/50" />}
          </div>
          <button
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors"
            onClick={() => setSortOrder((s) => s === "oldest" ? "newest" : "oldest")}
            data-testid={`button-sort-comments-${event.id}`}
          >
            <ArrowUpDown className="w-2.5 h-2.5" />
            {sortOrder === "oldest" ? "Oldest" : "Newest"}
          </button>
        </div>
      )}

      {!collapsed && sortedReplies.length > 0 && (
        <div className="space-y-0.5 mt-1 max-h-[200px] sm:max-h-[300px] overflow-y-auto overscroll-contain">
          {sortedReplies.map((reply) => (
            <MediaCommentItem key={reply.id} reply={reply} />
          ))}
        </div>
      )}

      {signer ? (
        showComposer ? (
          <MediaReplyComposer replyTo={event} onClose={() => setShowComposer(false)} />
        ) : (
          <button
            className="w-full text-left text-[11px] sm:text-xs text-muted-foreground/60 mt-2 py-1 cursor-pointer"
            onClick={() => setShowComposer(true)}
            data-testid={`button-add-comment-${event.id}`}
          >
            Add a comment...
          </button>
        )
      ) : sortedReplies.length === 0 ? (
        <p className="text-[11px] sm:text-xs text-muted-foreground/50 mt-1">No comments yet</p>
      ) : null}
    </div>
  );
}
