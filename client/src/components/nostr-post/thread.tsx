import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link, useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import { eventStore, pool, publishEvent, fetchProfiles, fetchProfilesCached, DEFAULT_RELAYS, FAST_RELAYS, getEventRelays } from "@/lib/nostr";
import { replyTargetOf, threadRootOf, KIND_NIP22_COMMENT } from "@/lib/reply-target";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { getPublishTarget } from "@/lib/outpost-relays";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Heart,
  MessageSquare,
  Repeat,
  Send,
  Copy,
  Quote,
  X,
  ChevronDown,
  ChevronUp,
  User,
  VolumeX,
  CornerUpLeft,
  FileJson,
  Check,
  Orbit,
  MoreHorizontal,
  Type,
  Hash,
  Flag,
  Terminal,
  Filter,
  Search,
  Play,
  ImageIcon,
  ArrowUpDown,
  ArrowRight,
  Headphones,
} from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useTranslation, TranslateLine } from "@/components/TranslateControl";
import { ImpersonationChip } from "@/components/ImpersonationChip";
import { formatDistanceToNow } from "date-fns";
import {
  getAvatarUrl,
  getDisplayName,
  getProfileContent,
  KIND_METADATA,
  KIND_TEXT_NOTE,
  KIND_REPOST,
  KIND_REACTION,
  formatNpub,
  shortenNpub,
  formatNoteId,
  buildReplyTags,
  buildRepostTags,
  buildReactionTags,
  getRelayHintForEvent,
  clientTags,
  extractHashtags,
} from "@/lib/nostr-helpers";
import { MediaRenderer } from "@/components/MediaRenderer";
import { extractMediaFromContent, getEventMediaInfo } from "@/lib/media-utils";
import { primalStatsCache, fetchThreadRepliesStreaming, getCachedThread, setCachedThread } from "@/lib/primal-cache";
import { computeEngagementScore, type EngagementStats } from "@/lib/engagement";
import { useToast } from "@/hooks/use-toast";
import { mutePubkey } from "@/lib/spam-filter";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { ConfirmAction } from "@/components/ConfirmAction";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { ZapDialog } from "@/components/ZapDialog";
import { ReportDialog } from "@/components/ReportDialog";
import { useTTS, type ThreadTTSSegment } from "@/contexts/TextToSpeechContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrimalStats } from "@/hooks/use-primal-stats";
import { useFeedStyle } from "@/hooks/use-feed-style";
import { useCustomEmojis, type CustomEmoji } from "@/hooks/use-custom-emojis";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getReplyTier } from "@/lib/graperank";
import { useMention } from "@/hooks/use-mention";
import {
  NARROW_THREAD_MEDIA_QUERY,
  DESKTOP_THREAD_INDENT_CAP,
  getThreadIndentCap,
  partitionSiblings,
  shouldContinueThread,
  rendersIndentColumn,
  isBeyondIndentCap,
} from "@/lib/thread-tree";
import { MentionSearch } from "@/components/MentionSearch";
import { MentionHighlightTextarea } from "@/components/MentionHighlightTextarea";
import { ComposeEmojiPicker, useEmojiTags } from "@/components/ComposeEmojiPicker";
import { prefetchProfileOnHover } from "@/hooks/use-prefetch-visible";
import { AuthorHoverCard, TrustTierDot, ThreadTrustBar, BtcZapIcon } from "./author-hover";
import { ZapReceiptsPopover, TopZapperAvatars, ReactionDetailsPopover, formatCount } from "./zap-reactions";
import {
  contentComponents,
  REACTIONS,
  closeAllReactionBars,
  dismissReactionBar,
  startReactionHoverDwell,
  cancelReactionHoverDwell,
  toggleMobileReactionBar,
  getReactionDisplay,
  CustomEmojiPicker,
  getEventEmojiMap,
  emojifyChildren,
  PostBadgeToggle,
  ParsedPreviewText,
  RawEventDialog,
} from "../NostrPost";

function useCommentTrustVisible() {
  const [visible] = useState(() => {
    try { return localStorage.getItem("relay-outpost-hide-comment-trust") !== "true"; } catch { return true; }
  });
  return visible;
}

// Both reply generations — NIP-10 kind 1 and NIP-22 kind 1111 (Amethyst's
// write format since 2026-08) — resolve through the shared, tested lib.
export function getReplyTargetId(event: Event): string | null {
  return replyTargetOf(event);
}

export function getRootEventId(event: Event): string | null {
  return threadRootOf(event);
}

export interface ThreadNode {
  event: Event;
  children: ThreadNode[];
}

export function buildThreadTree(replies: Event[], rootId: string): ThreadNode[] {
  const dedupIds = new Set<string>();
  const dedupedReplies = replies.filter((r) => {
    if (dedupIds.has(r.id)) return false;
    dedupIds.add(r.id);
    return true;
  });
  const replyIds = new Set(dedupedReplies.map((r) => r.id));
  replyIds.add(rootId);
  const byParent = new Map<string, Event[]>();

  for (const reply of dedupedReplies) {
    let parentId = getReplyTargetId(reply);
    if (parentId && !replyIds.has(parentId)) {
      parentId = rootId;
    }
    const target = parentId || rootId;
    const existing = byParent.get(target) || [];
    existing.push(reply);
    byParent.set(target, existing);
  }

  function buildChildren(parentId: string, depth: number, ancestors: Set<string>): ThreadNode[] {
    const children = byParent.get(parentId) || [];
    return children
      // Guard against reply cycles / self-replies so we never recurse forever.
      .filter((e) => !ancestors.has(e.id))
      .sort((a, b) => a.created_at - b.created_at)
      .map((event) => {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(event.id);
        return {
          event,
          // Recurse the FULL tree — deep replies keep their children (previously
          // anything past depth 5 was discarded). A high hard cap is a backstop.
          children: depth >= 60 ? [] : buildChildren(event.id, depth + 1, nextAncestors),
        };
      });
  }

  return buildChildren(rootId, 0, new Set([rootId]));
}

export const MAX_THREAD_TTS_CHARS = 50000;

export function flattenThreadForTTS(
  rootEvent: Event | undefined,
  tree: ThreadNode[],
): ThreadTTSSegment[] {
  const segments: ThreadTTSSegment[] = [];
  let totalChars = 0;

  function getAuthorName(pubkey: string): string {
    const profile = eventStore.getByFilters({ kinds: [0] });
    if (profile) {
      for (const p of profile) {
        if (p.pubkey === pubkey) {
          const name = getDisplayName(p, "");
          if (name) return name;
        }
      }
    }
    try {
      const npub = nip19.npubEncode(pubkey);
      return `${npub.slice(0, 9)}...${npub.slice(-4)}`;
    } catch {
      return "Unknown";
    }
  }

  function extractReadableText(content: string): string {
    return content
      .replace(/nostr:(npub1|note1|nevent1|naddr1|nprofile1|nrelay1)\w+/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[*_~`#>\[\]()!|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (rootEvent) {
    const text = extractReadableText(rootEvent.content);
    if (text.length >= 10) {
      segments.push({
        pubkey: rootEvent.pubkey,
        displayName: getAuthorName(rootEvent.pubkey),
        text: rootEvent.content,
      });
      totalChars += text.length;
    }
  }

  function walkTree(nodes: ThreadNode[]) {
    for (const node of nodes) {
      if (totalChars >= MAX_THREAD_TTS_CHARS) return;
      const text = extractReadableText(node.event.content);
      if (text.length >= 10) {
        segments.push({
          pubkey: node.event.pubkey,
          displayName: getAuthorName(node.event.pubkey),
          text: node.event.content,
        });
        totalChars += text.length;
      }
      walkTree(node.children);
    }
  }

  walkTree(tree);
  return segments;
}

export function ReplyComposer({
  replyTo,
  onClose,
  onPublished,
}: {
  replyTo: Event;
  onClose: () => void;
  onPublished?: () => void;
}) {
  const [content, setContent] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const { signer, profile, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { mentionActive, mentionQuery, detectMention, insertMention, closeMention, resolveContent, getMentionTags, clearMentionTags } = useMention();
  const { trackEmoji, getEmojiTags, clearEmojiTags } = useEmojiTags();
  const { emojis: replyCustomEmojis } = useCustomEmojis();
  const replyEmojiMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of replyCustomEmojis) map.set(e.shortcode, e.url);
    return map;
  }, [replyCustomEmojis]);
  const [vpRect, setVpRect] = useState<{ height: number; top: number } | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);

  const handleEmojiInsert = useCallback((text: string, emoji?: CustomEmoji) => {
    if (emoji) trackEmoji(emoji);
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? content.length;
    const before = content.slice(0, cursor);
    const after = content.slice(cursor);
    const spaceBefore = before.length > 0 && !before.endsWith(" ") && !text.startsWith("\n") ? " " : "";
    const spaceAfter = after.length > 0 && !after.startsWith(" ") && !text.endsWith("\n") ? " " : "";
    const newContent = before + spaceBefore + text + spaceAfter + after;
    setContent(newContent);
    requestAnimationFrame(() => {
      if (ta) {
        const newCursor = (before + spaceBefore + text + spaceAfter).length;
        ta.selectionStart = newCursor;
        ta.selectionEnd = newCursor;
        ta.focus();
      }
    });
  }, [content, trackEmoji]);

  useEffect(() => {
    if (!isMobile) return;
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);

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

  const replyToProfile = use$(
    () => eventStore.replaceable(KIND_METADATA, replyTo.pubkey),
    [replyTo.pubkey]
  );
  const replyToName = useMemo(() => {
    if (replyToProfile) {
      const name = getDisplayName(replyToProfile, "");
      if (name) return name;
    }
    try {
      const npub = nip19.npubEncode(replyTo.pubkey);
      return `${npub.slice(0, 9)}...${npub.slice(-4)}`;
    } catch {
      return "user";
    }
  }, [replyTo.pubkey, replyToProfile]);

  const handlePublish = async () => {
    if ((!content.trim() && !gifUrl) || !signer) return;
    setIsPublishing(true);
    try {
      const mentionTags = getMentionTags(content);
      const emojiTags = getEmojiTags(content);
      let publishContent = resolveContent(content);
      if (gifUrl) {
        const separator = publishContent.trim() ? "\n" : "";
        publishContent = publishContent + separator + gifUrl;
      }
      const hint = getRelayHintForEvent(replyTo.id, getEventRelays);
      const hashtagTags = extractHashtags(content);
      const tags = [...buildReplyTags(replyTo, hint), ...mentionTags, ...emojiTags, ...hashtagTags];
      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: publishContent.trim(),
      };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      // Optimistic: surface the reply in the thread immediately and close the
      // composer; the relay round-trip happens in the background with a retry on
      // failure (the signed event is reused, no re-sign needed).
      eventStore.add(signedEvent);
      setContent("");
      setGifUrl(null);
      clearMentionTags();
      clearEmojiTags();
      onClose();
      onPublished?.();
      publishEvent(signedEvent, userRelays, undefined, isUserSelected)
        .then((ok) => { if (!ok) throw new Error("Reply was rejected by all relays"); })
        .catch((err) => {
          console.error(err);
          toast({
            title: "Couldn't send reply",
            description: "Your reply didn't reach any relays.",
            variant: "destructive",
            action: (
              <button
                onClick={() => { publishEvent(signedEvent, userRelays, undefined, isUserSelected).catch(() => {}); }}
                className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-foreground/10 hover:bg-foreground/20 transition-colors"
              >
                Retry
              </button>
            ) as any,
          });
        });
    } catch (err) {
      console.error(err);
      if (isSignerError(err)) {
        handleSignerError(err, toast, attemptReconnect);
      } else {
        toast({ title: "Failed", description: "Could not send reply.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const replyMaxH = vpRect ? Math.max(100, Math.round(vpRect.height * 0.4)) : 200;

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const clamped = Math.min(ta.scrollHeight, replyMaxH);
    ta.style.height = `${clamped}px`;
    ta.style.overflowY = ta.scrollHeight > replyMaxH ? "auto" : "hidden";
  }, [replyMaxH]);

  useEffect(() => {
    requestAnimationFrame(() => autoResize());
  }, [content, autoResize]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    const cursor = e.target.selectionStart ?? val.length;
    detectMention(val, cursor);
  }, [detectMention]);

  const handleMentionSelect = useCallback((result: import("@/components/MentionSearch").MentionResult) => {
    const newContent = insertMention(result, content, textareaRef);
    setContent(newContent);
  }, [content, insertMention]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionActive) return;
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handlePublish();
    }
  };

  if (isMobile) {
    return createPortal(
      <div
        className="fixed left-0 right-0 z-[90] flex flex-col"
        style={vpRect ? { top: `${vpRect.top}px`, height: `${vpRect.height}px` } : { top: 0, bottom: 0 }}
        data-testid={`reply-composer-${replyTo.id}`}
      >
        <div className="flex-1 bg-black/40" onClick={onClose} data-testid={`overlay-reply-dismiss-${replyTo.id}`} />

        {/* Glass composer bar: violet-tinted hairline + blur over the page —
            same panel language as the app's dialogs/menus (PR #308). Static
            gradients/blur only — no fixed-attachment textures (PR #98). */}
        <div className="bg-background/90 supports-[backdrop-filter]:bg-background/80 backdrop-blur-xl border-t border-brand/15 dark:border-brand/20 shadow-[0_-10px_28px_-14px_rgba(139,92,246,0.22)]" style={vpRect ? {} : { paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-brand/10 dark:border-white/[0.06]">
            <CornerUpLeft className="w-3 h-3 text-brand/60 shrink-0" />
            <span className="text-xs text-muted-foreground/70 truncate">
              Replying to <span className="text-brand/90 font-medium">@{replyToName}</span>
            </span>
            <button
              onClick={onClose}
              className="ml-auto p-1 text-muted-foreground/60 cursor-pointer"
              data-testid={`button-cancel-reply-${replyTo.id}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <MentionSearch
              query={mentionQuery}
              visible={mentionActive}
              onSelect={handleMentionSelect}
              onClose={closeMention}
              position="above"
            />
          </div>
          <div className="flex items-end gap-2 px-3 py-2">
            <Avatar className="w-7 h-7 border border-border/50 shrink-0 mb-0.5">
              <AvatarImage src={profile?.picture} alt="You" />
              <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                {(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <MentionHighlightTextarea
                ref={textareaRef}
                placeholder="Write a reply..."
                className="w-full min-h-[44px] bg-muted/20 border-border/30 rounded-2xl resize-none focus-visible:ring-1 focus-visible:ring-primary/30 text-foreground/90 px-4 py-2.5"
                style={{ fontSize: "16px", maxHeight: `${replyMaxH}px`, overflowY: "hidden" }}
                value={content}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                emojiMap={replyEmojiMap}
                rows={1}
                autoComplete="off"
                data-testid={`input-reply-${replyTo.id}`}
              />
              {gifUrl && (
                <div className="relative mt-2 w-fit self-start rounded-lg overflow-hidden bg-brand/[0.06] border border-brand/15">
                  <img src={gifUrl} alt="GIF" className="max-w-[140px] max-h-[110px] object-cover block" loading="lazy" decoding="async" />
                  <button
                    type="button"
                    onClick={() => setGifUrl(null)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="shrink-0 mb-0.5">
              <ComposeEmojiPicker onInsert={handleEmojiInsert} onGifSelect={(url) => setGifUrl(url)} />
            </div>
            <Button
              size="icon"
              disabled={(!content.trim() && !gifUrl) || isPublishing}
              onClick={handlePublish}
              className="shrink-0 mb-0.5 w-10 h-10 rounded-full shadow-md shadow-primary/25"
              data-testid={`button-send-reply-${replyTo.id}`}
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="mt-2 pt-2" data-testid={`reply-composer-${replyTo.id}`}>
      <div className="flex gap-2">
        <Avatar className="w-7 h-7 border border-border/50 shrink-0">
          <AvatarImage src={profile?.picture} alt="You" />
          <AvatarFallback className="text-xs bg-muted text-muted-foreground">
            {(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 flex flex-col gap-2 relative">
          <MentionHighlightTextarea
            ref={textareaRef}
            placeholder="Write a reply..."
            className="w-full min-h-[60px] max-h-[200px] bg-background/40 border-border/40 resize-none focus-visible:ring-0 text-sm text-foreground/90 overflow-y-auto"
            value={content}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            emojiMap={replyEmojiMap}
            autoFocus
            autoComplete="off"
            data-testid={`input-reply-${replyTo.id}`}
          />
          <MentionSearch
            query={mentionQuery}
            visible={mentionActive}
            onSelect={handleMentionSelect}
            onClose={closeMention}
            position="above"
          />
          {gifUrl && (
            <div className="relative mt-2 w-fit self-start rounded-lg overflow-hidden bg-brand/[0.06] border border-brand/15">
              <img src={gifUrl} alt="GIF" className="max-w-[160px] max-h-[120px] object-cover block" loading="lazy" decoding="async" />
              <button
                type="button"
                onClick={() => setGifUrl(null)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <ComposeEmojiPicker onInsert={handleEmojiInsert} onGifSelect={(url) => setGifUrl(url)} />
            <Button variant="ghost" size="sm" onClick={onClose} data-testid={`button-cancel-reply-${replyTo.id}`}>
              <X className="w-3.5 h-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={(!content.trim() && !gifUrl) || isPublishing}
              onClick={handlePublish}
              data-testid={`button-send-reply-${replyTo.id}`}
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-1" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-1" />
              )}
              Reply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QuotePreviewCard({ quotedEvent, compact }: { quotedEvent: Event; compact?: boolean }) {
  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, quotedEvent.pubkey), [quotedEvent.pubkey]);
  const fallback = shortenNpub(formatNpub(quotedEvent.pubkey));
  const authorName = authorProfile ? (getDisplayName(authorProfile, fallback) ?? fallback) : fallback;
  const authorAvatar = getAvatarUrl(authorProfile);

  const { text: cleanedText } = useMemo(() => extractMediaFromContent(quotedEvent.content), [quotedEvent.content]);
  const mediaInfo = useMemo(() => getEventMediaInfo(quotedEvent.content, quotedEvent.tags), [quotedEvent.content, quotedEvent.tags]);
  const mediaThumbnail = mediaInfo.imageUrls[0] || mediaInfo.videoUrls[0] || null;
  const isVideo = !mediaInfo.imageUrls[0] && !!mediaInfo.videoUrls[0];
  const displayText = cleanedText.replace(/nostr:[a-z0-9]+/gi, "").trim();

  return (
    <div className="rounded-xl border border-border/40 bg-muted/15 overflow-hidden" data-testid={`quote-preview-card-${quotedEvent.id}`}>
      <div className="flex">
        <div className={`flex-1 min-w-0 ${compact ? "p-2" : "p-2.5"}`}>
          <div className={`flex items-center gap-1.5 ${compact ? "mb-0.5" : "mb-1"}`}>
            <Avatar className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} shrink-0`}>
              <AvatarImage src={authorAvatar} alt={authorName} />
              <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">
                {authorName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium text-foreground/80 truncate">{authorName}</span>
          </div>
          {displayText ? (
            <p className={`text-xs text-muted-foreground leading-relaxed ${compact ? "line-clamp-2" : "line-clamp-3"}`}>{displayText}</p>
          ) : mediaThumbnail ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
              {isVideo ? <Play className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
              <span>{isVideo ? "Video" : "Photo"}</span>
            </div>
          ) : null}
        </div>
        {mediaThumbnail && (
          <div className={`${compact ? "w-12 h-12" : "w-16 h-16"} shrink-0 relative bg-muted/30 m-2 rounded-lg overflow-hidden`}>
            <img
              src={mediaThumbnail}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {isVideo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Play className="w-4 h-4 text-white fill-white" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function QuoteComposer({
  quotedEvent,
  noteId,
  onClose,
}: {
  quotedEvent: Event;
  noteId: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const { signer, profile, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [vpRect, setVpRect] = useState<{ height: number; top: number } | null>(null);

  useEffect(() => {
    if (!isMobile) return;
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);

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

  const quoteMaxH = vpRect ? Math.max(80, Math.round(vpRect.height * 0.4)) : 180;

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const clamped = Math.min(ta.scrollHeight, quoteMaxH);
    ta.style.height = `${clamped}px`;
    ta.style.overflowY = ta.scrollHeight > quoteMaxH ? "auto" : "hidden";
  }, [quoteMaxH]);

  useEffect(() => {
    requestAnimationFrame(() => autoResize());
  }, [content, autoResize]);

  const handlePublish = async () => {
    if (!signer) return;
    const fullContent = `${content.trim()}\n\nnostr:${noteId}`.trim();
    if (!fullContent) return;
    setIsPublishing(true);
    try {
      const tags: string[][] = [
        ["q", quotedEvent.id],
        ["p", quotedEvent.pubkey],
        ...clientTags(),
      ];
      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: fullContent,
      };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      // Optimistic: surface the quote immediately, publish in the background.
      eventStore.add(signedEvent);
      setContent("");
      onClose();
      publishEvent(signedEvent, userRelays, undefined, isUserSelected)
        .then((ok) => { if (!ok) throw new Error("Quote was rejected by all relays"); })
        .catch((err) => {
          console.error(err);
          toast({
            title: "Couldn't post quote",
            description: "Your quote didn't reach any relays.",
            variant: "destructive",
            action: (
              <button
                onClick={() => { publishEvent(signedEvent, userRelays, undefined, isUserSelected).catch(() => {}); }}
                className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-foreground/10 hover:bg-foreground/20 transition-colors"
              >
                Retry
              </button>
            ) as any,
          });
        });
    } catch (err) {
      console.error(err);
      if (isSignerError(err)) {
        handleSignerError(err, toast, attemptReconnect);
      } else {
        toast({ title: "Failed", description: "Could not post quote.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  if (isMobile) {
    return createPortal(
      <div
        className="fixed left-0 right-0 z-[90] flex flex-col"
        style={vpRect ? { top: `${vpRect.top}px`, height: `${vpRect.height}px` } : { top: 0, bottom: 0 }}
        data-testid={`quote-composer-${quotedEvent.id}`}
      >
        <div className="flex-1 bg-black/40" onClick={onClose} data-testid={`overlay-quote-dismiss-${quotedEvent.id}`} />

        <div className="bg-background border-t border-border/50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <Quote className="w-3 h-3 text-muted-foreground/60 shrink-0" />
            <span className="text-xs text-muted-foreground/70 truncate">
              Quote post
            </span>
            <button
              onClick={onClose}
              className="ml-auto p-1 text-muted-foreground/60 cursor-pointer"
              data-testid={`button-cancel-quote-${quotedEvent.id}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 py-1">
            <QuotePreviewCard quotedEvent={quotedEvent} compact />
          </div>

          <div className="flex items-end gap-2 px-3 py-2">
            <Avatar className="w-7 h-7 border border-border/50 shrink-0 mb-0.5">
              <AvatarImage src={profile?.picture} alt="You" />
              <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                {(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Textarea
              ref={textareaRef}
              placeholder="Add your thoughts..."
              className="flex-1 min-h-[42px] bg-muted/30 border-border/40 resize-none focus-visible:ring-0 text-foreground/90"
              style={{ fontSize: "16px", maxHeight: `${quoteMaxH}px`, overflowY: "hidden" }}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={1}
              autoComplete="off"
              data-testid={`input-quote-${quotedEvent.id}`}
            />
            <Button
              size="icon"
              disabled={isPublishing}
              onClick={handlePublish}
              className="shrink-0 mb-0.5"
              data-testid={`button-send-quote-${quotedEvent.id}`}
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-4 h-4" />
              ) : (
                <Quote className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="mt-2 pt-2" data-testid={`quote-composer-${quotedEvent.id}`}>
      <div className="flex gap-2">
        <Avatar className="w-7 h-7 border border-border/50 shrink-0">
          <AvatarImage src={profile?.picture} alt="You" />
          <AvatarFallback className="text-xs bg-muted text-muted-foreground">
            {(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 flex flex-col gap-2">
          <Textarea
            placeholder="Add your thoughts..."
            className="min-h-[60px] bg-background/40 border-border/40 resize-none focus-visible:ring-0 text-sm text-foreground/90"
            style={{ fontSize: 16 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
            autoComplete="off"
            data-testid={`input-quote-${quotedEvent.id}`}
          />
          <QuotePreviewCard quotedEvent={quotedEvent} />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} data-testid={`button-cancel-quote-${quotedEvent.id}`}>
              <X className="w-3.5 h-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isPublishing}
              onClick={handlePublish}
              data-testid={`button-send-quote-${quotedEvent.id}`}
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-1" />
              ) : (
                <Quote className="w-3.5 h-3.5 mr-1" />
              )}
              Quote
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The post a reply is answering.
 *
 * `variant="spine"` renders it as the top of a conversation rather than a quote
 * attached to a post: no card, no border box, just the parent set quieter with
 * a violet thread-line running down its left edge and past its bottom, into the
 * reply below. The line is the whole idea — it says "this continues" without a
 * label, which is why the spine layout can drop both the "Replying to @x" text
 * and the Show-context button that used to be needed to reveal any of it.
 *
 * `variant="card"` is the original bordered quote, kept for the collapsed mode
 * someone opts into in Settings.
 */
export function ParentPostPreview({ event, variant = "card" }: { event: Event; variant?: "card" | "spine" }) {
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
  const contentText = useMemo(() => {
    return event.content.replace(/https?:\/\/\S+/g, "").trim();
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
        <span className="text-[11px] text-muted-foreground/60">{timeAgo}</span>
      </div>
      {contentText && (
        <p className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-words" data-testid={`text-parent-content-${event.id}`}>
          {refOnly ? (
            <span className="italic text-muted-foreground/70">Shared a post</span>
          ) : (
            <ParsedPreviewText text={contentText} />
          )}
        </p>
      )}
    </div>
  );
}


export function ThreadReplyItem({ event, childCount = 0, opPubkey, showParentCue = false }: { event: Event; childCount?: number; opPubkey?: string; showParentCue?: boolean }) {
  const { signer, pubkey: myPubkey, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const commentTrustVisible = useCommentTrustVisible();
  // Clean (bubbles off) → flat X-style comment; Bubbles → today's glass card.
  const isBubbles = useFeedStyle() === "bubbles";

  const [showQuoteComposer, setShowQuoteComposer] = useState(false);
  const [showInlineReply, setShowInlineReply] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const [hasReposted, setHasReposted] = useState(false);
  const [hasLiked, setHasLiked] = useState(false);
  const [myReactionContent, setMyReactionContent] = useState<string | null>(null);
  const [myReactionEmojiUrl, setMyReactionEmojiUrl] = useState<string | undefined>(undefined);
  const { emojis: customEmojis } = useCustomEmojis();
  const [reactionPopping, setReactionPopping] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showMuteConfirm, setShowMuteConfirm] = useState(false);
  const [showRawData, setShowRawData] = useState(false);

  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(event.pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  // Impersonation guard input: the PROFILE-claimed name only (never the npub
  // fallback) + the claimed nip05. The hook exits immediately for in-network
  // authors, so this stays cheap per reply row.
  const authorClaimed = useMemo(() => {
    if (!authorProfile) return null;
    const c = getProfileContent(authorProfile) as { display_name?: string; name?: string; nip05?: string } | null;
    if (!c) return null;
    return { name: c.display_name || c.name, nip05: c.nip05 };
  }, [authorProfile]);
  const avatarUrl = getAvatarUrl(authorProfile);
  const { text: textContent, media: replyMediaItems } = useMemo(() => extractMediaFromContent(event.content), [event.content]);
  const isOwnReply = myPubkey === event.pubkey;
  const isOP = !!(opPubkey && event.pubkey === opPubkey);
  const hasReplyMedia = replyMediaItems.length > 0;

  const primalStats = usePrimalStats(event.id);
  const replyCount = primalStats?.replies ?? 0;
  const repostCount = primalStats?.reposts ?? 0;
  const likeCount = primalStats?.likes ?? 0;
  const zapCount = primalStats?.zaps ?? 0;
  const zapAmount = primalStats?.zapAmount ?? 0;

  const noteId = useMemo(() => formatNoteId(event.id), [event.id]);

  useEffect(() => {
    const checkReposted = () => {
      if (!myPubkey) { setHasReposted(false); return; }
      const all = eventStore.getByFilters({ kinds: [KIND_REPOST] });
      setHasReposted([...all].some(
        (e) => e.pubkey === myPubkey && e.tags.some((t) => t[0] === "e" && t[1] === event.id)
      ));
    };
    const checkLiked = () => {
      if (!myPubkey) { setHasLiked(false); setMyReactionContent(null); setMyReactionEmojiUrl(undefined); return; }
      const all = eventStore.getByFilters({ kinds: [KIND_REACTION] });
      const myReaction = [...all].find(
        (e) => e.pubkey === myPubkey && e.tags.some((t) => t[0] === "e" && t[1] === event.id)
      );
      setHasLiked(!!myReaction);
      if (myReaction) {
        setMyReactionContent(myReaction.content);
        const emojiTag = myReaction.tags.find((t: string[]) => t[0] === "emoji" && t[2]);
        setMyReactionEmojiUrl(emojiTag?.[2]);
      } else {
        setMyReactionContent(null);
        setMyReactionEmojiUrl(undefined);
      }
    };
    checkReposted();
    checkLiked();
    const sub = eventStore.insert$.subscribe((e) => {
      if (e.kind === KIND_REPOST) checkReposted();
      if (e.kind === KIND_REACTION) checkLiked();
    });
    return () => sub.unsubscribe();
  }, [event.id, myPubkey]);

  // Foreign-language replies get the same quiet Translate control as posts;
  // while showing, translated prose rides the same truncation/render pipeline.
  const tr = useTranslation(event);
  const replyProse = tr.showing && tr.translatedProse !== null ? tr.translatedProse : textContent;

  const REPLY_TRUNCATE_CHARS = 300;
  const replyNeedsTruncation = replyProse.length > REPLY_TRUNCATE_CHARS;
  const [replyExpanded, setReplyExpanded] = useState(false);

  const replyDisplayText = useMemo(() => {
    if (!replyNeedsTruncation || replyExpanded) return replyProse;
    const truncated = replyProse.slice(0, REPLY_TRUNCATE_CHARS);
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > REPLY_TRUNCATE_CHARS * 0.6 ? truncated.slice(0, lastSpace) : truncated) + "...";
  }, [replyProse, replyNeedsTruncation, replyExpanded]);

  const replyTruncatedEvent = useMemo(() => {
    // Translated views need a fresh object identity — the content renderer
    // caches per event and would otherwise serve the untranslated render.
    if ((!replyNeedsTruncation || replyExpanded) && !tr.showing) return event;
    const derived = { ...event, content: replyDisplayText };
    // The spread copies applesauce's parse cache too (an enumerable symbol
    // property on the event) — strip both reply cache slots, or the renderer
    // serves the ORIGINAL parse and the translated text never appears.
    Reflect.deleteProperty(derived, Symbol.for("reply-content-expanded-v2"));
    Reflect.deleteProperty(derived, Symbol.for("reply-content-truncated-v2"));
    return derived;
  }, [event, replyNeedsTruncation, replyExpanded, replyDisplayText, tr.showing]);

  const replyCacheKey = useMemo(
    () => replyExpanded ? Symbol.for("reply-content-expanded-v2") : Symbol.for("reply-content-truncated-v2"),
    [replyExpanded]
  );

  const rawRenderedContent = useRenderedContent(replyTruncatedEvent, contentComponents, {
    cacheKey: replyCacheKey,
    content: replyDisplayText,
  });

  const replyEmojiMap = useMemo(() => getEventEmojiMap(event), [event]);
  const renderedContent = useMemo(() => {
    if (!rawRenderedContent || !replyEmojiMap) return rawRenderedContent;
    return emojifyChildren(rawRenderedContent, replyEmojiMap);
  }, [rawRenderedContent, replyEmojiMap]);

  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(event.pubkey)}`; } catch { return "#"; }
  }, [event.pubkey]);
  const timeAgo = useMemo(() => {
    try { return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true }); } catch { return ""; }
  }, [event.created_at]);

  const replyToPubkey = useMemo(() => {
    const eTags = event.tags.filter((t) => t[0] === "e");
    const replyETag = eTags.find((t) => t[3] === "reply") || eTags.find((t) => t[3] === "root");
    if (replyETag && replyETag[1]) {
      const parentInStore = eventStore.getByFilters({ ids: [replyETag[1]] });
      const parentEvt = parentInStore ? [...parentInStore][0] : null;
      if (parentEvt) return parentEvt.pubkey;
    }
    const pTags = event.tags.filter((t) => t[0] === "p");
    if (pTags.length >= 1) return pTags[0][1];
    return null;
  }, [event]);

  const replyToProfile = use$(
    () => replyToPubkey ? eventStore.replaceable(KIND_METADATA, replyToPubkey) : undefined,
    [replyToPubkey]
  );

  const replyToName = useMemo(() => {
    if (!replyToPubkey) return null;
    if (replyToProfile) {
      const name = getDisplayName(replyToProfile, "");
      if (name) return name;
    }
    try {
      const npub = nip19.npubEncode(replyToPubkey);
      return `${npub.slice(0, 9)}...${npub.slice(-4)}`;
    } catch {
      return null;
    }
  }, [replyToPubkey, replyToProfile]);

  // "↳ @parent" cue tap: scroll to + flash the parent reply when it's rendered
  // in this thread (indent-capped deep replies all sit at the same indent, so
  // this is how you trace parentage). No-op when the parent isn't on the page.
  const handleParentCueClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const parentId = getReplyTargetId(event);
    if (!parentId) return;
    const container = document.querySelector(`[data-event-id="${parentId}"]`);
    if (!container) return;
    const item = container.querySelector(`[data-testid="thread-reply-content-${parentId}"]`) ?? container;
    item.scrollIntoView({ behavior: "smooth", block: "center" });
    item.classList.remove("thread-parent-flash");
    // Force a reflow so re-taps restart the flash animation.
    void (item as HTMLElement).offsetWidth;
    item.classList.add("thread-parent-flash");
    window.setTimeout(() => item.classList.remove("thread-parent-flash"), 1500);
  }, [event]);

  const handleReplyClick = () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to reply.", variant: "destructive" });
      return;
    }
    setShowInlineReply(prev => !prev);
  };

  const handleRepost = async () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to repost.", variant: "destructive" });
      return;
    }
    if (hasReposted) return;
    setIsReposting(true);
    try {
      const hint = getRelayHintForEvent(event.id, getEventRelays);
      const tags = buildRepostTags(event, hint);
      const eventTemplate = {
        kind: KIND_REPOST,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify(event),
      };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      setHasReposted(true);
      setIsReposting(false);
      eventStore.add(signedEvent);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      publishEvent(signedEvent, userRelays, event.pubkey, isUserSelected).catch((err) => {
        console.error(err);
        setHasReposted(false);
        const rollback = primalStatsCache.get(event.id);
        if (rollback && rollback.reposts > 0) {
          primalStatsCache.set(event.id, { ...rollback, reposts: rollback.reposts - 1 });
        }
        toast({ title: "Failed", description: "Could not repost.", variant: "destructive" });
      });
    } catch (err) {
      console.error(err);
      setIsReposting(false);
      if (isSignerError(err)) {
        handleSignerError(err, toast, attemptReconnect);
      } else {
        toast({ title: "Failed", description: "Could not repost.", variant: "destructive" });
      }
    }
  };

  const handleUndoRepost = async () => {
    if (!signer || !myPubkey) return;
    const all = eventStore.getByFilters({ kinds: [KIND_REPOST] });
    const myRepost = [...all].find(
      (e) => e.pubkey === myPubkey && e.tags.some((t) => t[0] === "e" && t[1] === event.id)
    );
    if (!myRepost) return;
    setHasReposted(false);
    const existing = primalStatsCache.get(event.id);
    if (existing && existing.reposts > 0) {
      primalStatsCache.set(event.id, { ...existing, reposts: existing.reposts - 1 });
    }
    try {
      const deleteEvent = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["e", myRepost.id]],
        content: "",
      };
      const signed = await signWithTimeout(signer, deleteEvent);
      const { relays: userRelays3, userSelected: isUserSelected3 } = getPublishTarget();
      publishEvent(signed, userRelays3, undefined, isUserSelected3).catch((err) => {
        console.error(err);
        setHasReposted(true);
        const cur = primalStatsCache.get(event.id);
        if (cur) {
          primalStatsCache.set(event.id, { ...cur, reposts: cur.reposts + 1 });
        }
        toast({ title: "Failed", description: "Could not undo repost.", variant: "destructive" });
      });
      toast({ title: "Repost removed" });
    } catch (err) {
      console.error(err);
      setHasReposted(true);
      const cur = primalStatsCache.get(event.id);
      if (cur) {
        primalStatsCache.set(event.id, { ...cur, reposts: cur.reposts + 1 });
      }
      toast({ title: "Failed", description: "Could not undo repost.", variant: "destructive" });
    }
  };

  const handleReaction = async (content: string, emojiTag?: [string, string, string]) => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to react.", variant: "destructive" });
      return;
    }
    if (hasLiked) return;
    setIsLiking(true);
    try {
      const hint = getRelayHintForEvent(event.id, getEventRelays);
      const tags = buildReactionTags(event, hint);
      if (emojiTag) tags.push(emojiTag);
      const eventTemplate = {
        kind: KIND_REACTION,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      setHasLiked(true);
      setIsLiking(false);
      setMyReactionContent(content);
      if (emojiTag) setMyReactionEmojiUrl(emojiTag[2]);
      setReactionPopping(true);
      setTimeout(() => setReactionPopping(false), 350);
      const existing = primalStatsCache.get(event.id);
      primalStatsCache.set(event.id, {
        replies: existing?.replies ?? 0,
        reposts: existing?.reposts ?? 0,
        likes: (existing?.likes ?? 0) + 1,
        zaps: existing?.zaps ?? 0,
        zapAmount: existing?.zapAmount ?? 0,
      });
      const { relays: userRelays2, userSelected: isUserSelected2 } = getPublishTarget();
      publishEvent(signedEvent, userRelays2, event.pubkey, isUserSelected2).catch((err) => {
        console.error(err);
        setHasLiked(false);
        setMyReactionContent(null);
        if (emojiTag) setMyReactionEmojiUrl(undefined);
        const rollback = primalStatsCache.get(event.id);
        if (rollback && rollback.likes > 0) {
          primalStatsCache.set(event.id, { ...rollback, likes: rollback.likes - 1 });
        }
        toast({ title: "Failed", description: "Could not react.", variant: "destructive" });
      });
    } catch (err) {
      console.error(err);
      setIsLiking(false);
      if (isSignerError(err)) {
        handleSignerError(err, toast, attemptReconnect);
      } else {
        toast({ title: "Failed", description: "Could not react.", variant: "destructive" });
      }
    }
  };

  const handleCustomEmojiReaction = useCallback((emoji: CustomEmoji) => {
    const content = `:${emoji.shortcode}:`;
    const emojiTag: [string, string, string] = ["emoji", emoji.shortcode, emoji.url];
    handleReaction(content, emojiTag);
  }, [handleReaction]);

  const handleLike = () => {
    handleReaction("+");
  };

  const handleQuote = () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to quote.", variant: "destructive" });
      return;
    }
    setShowQuoteComposer(!showQuoteComposer);
  };

  const handleCopyLink = async () => {
    try {
      await copyNostrId(`nostr:${noteId}`);
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  };

  const handleCopyNpub = async () => {
    try {
      const npub = formatNpub(event.pubkey);
      await copyNostrId(npub);
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(event.content);
      toast({ title: "Copied", description: "Note text copied." });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  };

  const handleCopyNoteId = async () => {
    try {
      await copyNostrId(noteId);
      toast({ title: "Copied", description: "Note ID copied." });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  };

  const isShortReply = textContent.length <= 120 && textContent.length > 0 && !hasReplyMedia && !replyNeedsTruncation;

  return (
    <div className={`group/reply overflow-visible ${isBubbles ? `thread-reply-item rounded-xl ${isOP ? "thread-reply-item-op" : ""}` : `thread-reply-flat ${isOP ? "thread-reply-flat-op" : ""}`}`} data-testid={`thread-reply-content-${event.id}`}>
      <div className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2.5 sm:py-2.5 overflow-hidden ${isBubbles ? "glass-header rounded-t-xl" : ""}`} onClick={(e) => e.stopPropagation()}>
        <AuthorHoverCard pubkey={event.pubkey} profile={authorProfile}>
          <Link href={profileUrl} data-testid={`link-thread-avatar-${event.id}`}>
            <Avatar className={`w-7 h-7 sm:w-6 sm:h-6 shrink-0 ring-1 ${isOP ? "ring-brand/40" : "ring-primary/20"} border border-background cursor-pointer`}>
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-brand/10 text-brand font-bold text-xs sm:text-[11px]">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Link>
        </AuthorHoverCard>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link href={profileUrl} className="shrink min-w-0">
              <span className="text-sm sm:text-xs font-semibold text-foreground/90 cursor-pointer truncate block max-w-[120px] sm:max-w-[160px]" data-testid={`text-thread-author-${event.id}`}>
                {displayName}
              </span>
            </Link>
            {commentTrustVisible && <TrustTierDot pubkey={event.pubkey} />}
            {isOP && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-brand/15 text-brand border-brand/20 shrink-0" data-testid={`badge-op-${event.id}`}>
                OP
              </Badge>
            )}
            {!isOwnReply && authorClaimed?.name && (
              <ImpersonationChip pubkey={event.pubkey} displayName={authorClaimed.name} nip05={authorClaimed.nip05} compact className="shrink min-w-0" />
            )}
            {replyToName && (
              <button
                type="button"
                onClick={handleParentCueClick}
                title={`Replying to @${replyToName}`}
                className={`items-center gap-0.5 truncate min-w-0 shrink cursor-pointer text-[11px] ${
                  showParentCue
                    ? "flex text-muted-foreground/70 hover:text-foreground/80 font-medium rounded-full px-1 py-0.5 transition-colors"
                    : "hidden sm:flex text-brand font-medium bg-brand/10 rounded-full px-1.5 py-0.5"
                }`}
                data-testid={`button-parent-cue-${event.id}`}
              >
                <CornerUpLeft className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">@{replyToName}</span>
              </button>
            )}
            <span className="text-[11px] text-muted-foreground/70 shrink-0 whitespace-nowrap hidden sm:inline">{timeAgo}</span>
          </div>
          <span className="text-[11px] text-muted-foreground/60 block sm:hidden mt-0.5">{timeAgo}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 -mr-1 shrink-0 text-muted-foreground/60 hover:text-foreground/70 transition-opacity [@media(hover:hover)]:opacity-0 group-hover/reply:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              onClick={(e) => e.stopPropagation()}
              data-testid={`button-thread-menu-${event.id}`}
              aria-label="More"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-dropdown min-w-[180px]" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()}>
            {/* Replies keep a slim menu — Copy / Inspect / Mute / Report only.
                Share + Bookmark live on the OP post, not on every passing reply. */}
            <DropdownMenuLabel className="glass-dropdown-label">Copy</DropdownMenuLabel>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyLink} data-testid={`menu-thread-copy-link-${event.id}`}>
              <Copy className="w-3.5 h-3.5 text-brand/70" />
              Note Link
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyText} data-testid={`menu-thread-copy-text-${event.id}`}>
              <Type className="w-3.5 h-3.5 text-brand/70" />
              Note Text
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyNoteId} data-testid={`menu-thread-copy-id-${event.id}`}>
              <Hash className="w-3.5 h-3.5 text-brand/70" />
              Note ID
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyNpub} data-testid={`menu-thread-copy-npub-${event.id}`}>
              <User className="w-3.5 h-3.5 text-brand/70" />
              Author npub
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="glass-dropdown-label">Inspect</DropdownMenuLabel>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => setTimeout(() => setShowRawData(true), 0)} data-testid={`menu-thread-raw-data-${event.id}`}>
              <FileJson className="w-3.5 h-3.5 text-brand/70" />
              Raw Telemetry
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => setTimeout(() => setShowMuteConfirm(true), 0)} data-testid={`menu-thread-mute-${event.id}`}>
              <VolumeX className="w-3.5 h-3.5" />
              Mute Signal
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => setTimeout(() => setShowReportDialog(true), 0)} data-testid={`menu-thread-report-${event.id}`}>
              <Flag className="w-3.5 h-3.5" />
              Report Content
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <RawEventDialog open={showRawData} onOpenChange={setShowRawData} event={event} />
      <ReportDialog open={showReportDialog} onOpenChange={setShowReportDialog} event={event} />
      <ConfirmAction
        open={showMuteConfirm}
        onOpenChange={setShowMuteConfirm}
        title={`Mute ${displayName}?`}
        description="You won't see their posts anymore. You can unmute them anytime."
        confirmLabel="Mute"
        variant="destructive"
        onConfirm={() => {
          setShowMuteConfirm(false);
          mutePubkey(event.pubkey);
        }}
      />
      <div className="px-3 sm:px-3.5 py-2.5 sm:py-3">
        {renderedContent && (
          <div className={`post-content-text reply-content-text leading-relaxed whitespace-pre-wrap break-words ${isBubbles ? `rounded-lg px-2.5 py-1.5 ${isShortReply ? "w-fit max-w-[85%]" : ""} ${isOwnReply ? "glass-bubble-reply-own" : "glass-bubble-reply"}` : ""}`} data-testid={`text-thread-content-${event.id}`}>
            {renderedContent}
          </div>
        )}
        {replyNeedsTruncation && (
          <button
            onClick={(e) => { e.stopPropagation(); setReplyExpanded(!replyExpanded); }}
            className="text-[11px] text-brand/80 mt-1 cursor-pointer font-medium tracking-wide"
            data-testid={`button-toggle-reply-expand-${event.id}`}
          >
            {replyExpanded ? "Show less" : "Show more"}
          </button>
        )}
        <TranslateLine tr={tr} eventId={event.id} />
        <MediaRenderer event={event} compact />
      </div>

      <TopZapperAvatars eventId={event.id} hasZaps={zapCount > 0 || zapAmount > 0} />

      <div className={`flex items-center gap-0.5 px-3 sm:px-3.5 py-2 flex-wrap ${isBubbles ? "glass-footer rounded-b-xl" : ""}`} onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className={`w-6 h-6 ${showInlineReply ? "text-blue-700 dark:text-blue-400" : "text-muted-foreground"}`}
          onClick={handleReplyClick}
          data-testid={`button-inline-reply-${event.id}`}
        >
          <MessageSquare className="w-3 h-3" />
        </Button>
        <span className="text-[11px] -ml-0.5 mr-0.5 text-muted-foreground" data-testid={`text-thread-reply-count-${event.id}`}>
          {formatCount(replyCount || childCount || 0)}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`w-6 h-6 ${hasReposted ? "stat-glow-reposts" : "text-muted-foreground"}`}
              data-testid={`button-thread-repost-${event.id}`}
            >
              {isReposting ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Repeat className="w-3 h-3" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="glass-dropdown min-w-[140px]">
            {hasReposted ? (
              <DropdownMenuItem
                className="gap-2 cursor-pointer text-destructive"
                onClick={handleUndoRepost}
                data-testid={`button-thread-undo-repost-${event.id}`}
              >
                <Repeat className="w-3.5 h-3.5" />
                Undo repost
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={handleRepost}
                disabled={isReposting}
                data-testid={`button-thread-do-repost-${event.id}`}
              >
                <Repeat className="w-3.5 h-3.5 text-brand/70" />
                Repost
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={handleQuote}
              data-testid={`button-thread-quote-${event.id}`}
            >
              <Quote className="w-3.5 h-3.5 text-brand/70" />
              Quote
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {repostCount > 0 && (
          <span className={`text-[11px] -ml-0.5 mr-0.5 ${hasReposted ? "stat-glow-reposts" : "text-muted-foreground"}`} data-testid={`text-thread-repost-count-${event.id}`}>
            {formatCount(repostCount)}
          </span>
        )}

        {/* Single-tap like (emoji fan-out removed to match the lighter feed). */}
        <Button
          variant="ghost"
          size="icon"
          className={`w-6 h-6 ${reactionPopping ? "reaction-pop" : ""} ${hasLiked ? "stat-glow-likes" : "text-muted-foreground"}`}
          onClick={(e) => { e.stopPropagation(); handleLike(); }}
          disabled={isLiking || hasLiked}
          data-testid={`button-thread-like-${event.id}`}
        >
          {isLiking ? (
            <RelayOutpostInlineLoader className="w-3 h-3" />
          ) : (
            <Heart className={`w-3 h-3 ${hasLiked ? "fill-current" : ""}`} />
          )}
        </Button>
        {likeCount > 0 && (
          <ReactionDetailsPopover
            eventId={event.id}
            likeCount={likeCount}
            trigger={
              <span className={`text-[11px] -ml-0.5 mr-0.5 cursor-pointer ${hasLiked ? "stat-glow-likes" : "text-muted-foreground"}`} data-testid={`text-thread-like-count-${event.id}`}>
                {formatCount(likeCount)}
              </span>
            }
          />
        )}

        <div className="flex-1" />

        {/* Zap anchors bottom-right (matches NostrPost), signal check to its
            left; the zap ICON is the fixed rightmost element (aligned with the
            reply ⋯ menu), the amount grows to its LEFT. */}
        <PostBadgeToggle
          eventId={event.id}
          score={computeEngagementScore(primalStats ?? null)}
          stats={primalStats ?? null}
          size="compact"
        />
        {/* Zap hero: ₿-then-amount, gapped from the demoted signal-check; icon
            goes amber only when the post has sats (matches NostrPost). */}
        <Button
          variant="ghost"
          size="icon"
          className={`w-6 h-6 shrink-0 ml-1.5 ${zapCount > 0 || zapAmount > 0 ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground"}`}
          onClick={() => {
            if (!signer) {
              toast({ title: "Sign in required", description: "Sign in to zap.", variant: "destructive" });
              return;
            }
            setShowZapDialog(true);
          }}
          data-testid={`button-thread-zap-${event.id}`}
        >
          <BtcZapIcon className="w-3 h-3" />
        </Button>
        {(zapCount > 0 || zapAmount > 0) && (
          <ZapReceiptsPopover eventId={event.id} zapAmount={zapAmount} zapCount={zapCount} size="compact" />
        )}
      </div>

      {showQuoteComposer && (
        <div className="px-3 sm:px-3.5 pb-3 border-t border-border/10 pt-2" onClick={(e) => e.stopPropagation()}>
          <QuoteComposer quotedEvent={event} noteId={noteId} onClose={() => setShowQuoteComposer(false)} />
        </div>
      )}

      {showInlineReply && (
        <div className="px-3 sm:px-3.5 pb-3 border-t border-border/10 pt-2" onClick={(e) => e.stopPropagation()} data-testid={`inline-reply-composer-${event.id}`}>
          <ReplyComposer replyTo={event} onClose={() => setShowInlineReply(false)} />
        </div>
      )}

      <ZapDialog
        open={showZapDialog}
        onOpenChange={setShowZapDialog}
        event={event}
        recipientName={displayName}
      />
    </div>
  );
}

// Responsive visual indent cap (2 levels <640px, 5 on desktop). Replies deeper
// than the cap render AT the cap's indent with a "↳ @parent" cue — layout rules
// live in @/lib/thread-tree; this hook just answers "which cap applies now?".
export function useThreadIndentCap(): number {
  const [cap, setCap] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return DESKTOP_THREAD_INDENT_CAP;
    }
    return getThreadIndentCap(window.matchMedia(NARROW_THREAD_MEDIA_QUERY).matches);
  });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(NARROW_THREAD_MEDIA_QUERY);
    const onChange = () => setCap(getThreadIndentCap(mql.matches));
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return cap;
}

export function getDescendantPubkeys(node: ThreadNode, limit: number): string[] {
  const pubkeys: string[] = [];
  const seen = new Set<string>();
  function walk(n: ThreadNode) {
    if (pubkeys.length >= limit) return;
    for (const child of n.children) {
      if (!seen.has(child.event.pubkey)) {
        seen.add(child.event.pubkey);
        pubkeys.push(child.event.pubkey);
        if (pubkeys.length >= limit) return;
      }
      walk(child);
    }
  }
  walk(node);
  return pubkeys;
}

export function CollapsedAvatarPreview({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  return (
    <Avatar className="w-5 h-5 border-2 border-background shrink-0">
      <AvatarImage src={getAvatarUrl(profile)} alt="" />
      <AvatarFallback className="text-[7px] bg-brand/10 text-brand font-bold">
        {(profile ? (getDisplayName(profile, "") || "") : "").slice(0, 1).toUpperCase() || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

export function CollapsedThreadPreview({ node, totalDescendants, onExpand }: { node: ThreadNode; totalDescendants: number; onExpand: () => void }) {
  const previewPubkeys = useMemo(() => getDescendantPubkeys(node, 4), [node]);

  return (
    <button
      className="flex items-center gap-2 text-xs text-brand/70 py-2 px-2.5 rounded-lg hover:bg-brand/5 cursor-pointer mt-1 transition-colors w-full"
      onClick={onExpand}
      data-testid={`button-expand-replies-${node.event.id}`}
    >
      {previewPubkeys.length > 0 && (
        <div className="flex -space-x-1.5">
          {previewPubkeys.map((pk) => (
            <CollapsedAvatarPreview key={pk} pubkey={pk} />
          ))}
        </div>
      )}
      <ChevronDown className="w-3 h-3 shrink-0" />
      <span>{totalDescendants} more {totalDescendants === 1 ? "reply" : "replies"}</span>
    </button>
  );
}

function countDescendants(node: ThreadNode): number {
  let c = node.children.length;
  for (const child of node.children) c += countDescendants(child);
  return c;
}

/**
 * Branch cutoff row: a branch nesting past (indent cap + 4) levels stops
 * rendering inline — this row re-roots the thread page on the branch's top
 * event (the /thread route renders any event id as root, so back returns to
 * the outer thread via normal history).
 */
export function ContinueThreadRow({ node }: { node: ThreadNode }) {
  const [, navigate] = useLocation();
  const hiddenCount = useMemo(() => countDescendants(node), [node]);
  const url = useMemo(() => {
    try { return `/thread/${nip19.noteEncode(node.event.id)}`; } catch { return `/thread/${node.event.id}`; }
  }, [node.event.id]);

  return (
    <button
      className="flex items-center gap-1.5 text-xs text-brand/70 hover:text-brand py-2 px-2.5 rounded-lg hover:bg-brand/5 cursor-pointer mt-1 transition-colors w-full text-left"
      onClick={(e) => { e.stopPropagation(); navigate(url); }}
      data-testid={`button-continue-thread-${node.event.id}`}
    >
      <span className="font-medium">Continue thread</span>
      <ArrowRight className="w-3 h-3 shrink-0" />
      <span className="text-muted-foreground/60">
        {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
      </span>
    </button>
  );
}

/**
 * One LEVEL of the tree (per-level sibling overflow). Levels with more than
 * SIBLING_OVERFLOW_LIMIT replies show the first chunk + one "Show N more
 * replies" row — the only automatic folding left (depth-based auto-collapse
 * is gone; every depth expands by default).
 */
export function ThreadSiblingGroup({
  nodes,
  depth,
  opPubkey,
  indentCap,
  groupKey,
}: {
  nodes: ThreadNode[];
  depth: number;
  opPubkey?: string;
  indentCap: number;
  groupKey: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const { visible, overflow } = useMemo(() => partitionSiblings(nodes), [nodes]);
  const shown = showAll ? nodes : visible;

  return (
    <>
      {shown.map((child) => (
        <ThreadReplyNode key={child.event.id} node={child} depth={depth} opPubkey={opPubkey} indentCap={indentCap} />
      ))}
      {!showAll && overflow.length > 0 && (
        <button
          className="flex items-center gap-1.5 text-xs text-brand/70 hover:text-brand py-2 px-2.5 rounded-lg hover:bg-brand/5 cursor-pointer transition-colors w-full text-left"
          onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
          data-testid={`button-show-more-siblings-${groupKey}`}
        >
          <ChevronDown className="w-3 h-3 shrink-0" />
          <span>Show {overflow.length} more {overflow.length === 1 ? "reply" : "replies"}</span>
        </button>
      )}
    </>
  );
}

export function ThreadReplyNode({ node, depth, opPubkey, indentCap = DESKTOP_THREAD_INDENT_CAP }: { node: ThreadNode; depth: number; opPubkey?: string; indentCap?: number }) {
  // Expand by default at EVERY depth — the old depth-based auto-collapse
  // littered deep threads with per-branch "N more replies" buttons. Manual
  // collapse via the rail tap stays.
  const [showChildren, setShowChildren] = useState(true);
  const hasChildren = node.children.length > 0;
  const nodeRef = useRef<HTMLDivElement>(null);
  const totalDescendants = useMemo(() => countDescendants(node), [node]);

  const handleToggleCollapse = useCallback(() => {
    setShowChildren((prev) => {
      if (prev) {
        requestAnimationFrame(() => {
          const el = nodeRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          if (rect.top < 0) {
            el.scrollIntoView({ behavior: "instant", block: "start" });
            window.scrollBy({ top: -10, behavior: "instant" });
          }
        });
      }
      return !prev;
    });
  }, []);

  // Rails/indent only within the responsive cap; deeper nodes render flush at
  // the cap's indent with the "↳ @parent" cue standing in for nesting.
  const hasIndentColumn = rendersIndentColumn(depth, indentCap);
  const beyondCap = isBeyondIndentCap(depth, indentCap);
  // Branch cutoff: past (cap + 4) levels the subtree becomes one
  // "Continue thread →" row instead of rendering inline.
  const continueBranch = shouldContinueThread(depth, indentCap, hasChildren);
  const railTint = `reddit-thread-line-t${depth % 3}`;

  return (
    <div
      ref={nodeRef}
      className="relative reddit-thread-node"
      data-event-id={node.event.id}
      data-testid={`thread-reply-${node.event.id}`}
    >
      <div className="flex">
        {hasChildren && hasIndentColumn && !continueBranch && (
          <button
            className="reddit-thread-line-btn group cursor-pointer"
            onClick={handleToggleCollapse}
            aria-label={showChildren ? "Collapse thread" : "Expand thread"}
            data-testid={`button-collapse-line-${node.event.id}`}
          >
            <div className={`reddit-thread-line ${railTint} group-hover:reddit-thread-line-hover ${!showChildren ? "reddit-thread-line-collapsed" : ""}`} />
          </button>
        )}
        {((!hasChildren && depth > 0) || (hasChildren && continueBranch)) && hasIndentColumn && (
          <div className="reddit-thread-line-btn">
            <div className={`reddit-thread-line ${railTint} reddit-thread-line-leaf`} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div
            className="relative rounded-lg transition-colors duration-200"
            data-testid={`button-select-reply-${node.event.id}`}
          >
            <ThreadReplyItem event={node.event} childCount={hasChildren ? node.children.length : 0} opPubkey={opPubkey} showParentCue={beyondCap} />
          </div>

          {hasChildren && continueBranch && <ContinueThreadRow node={node} />}

          {hasChildren && !continueBranch && !showChildren && (
            <CollapsedThreadPreview node={node} totalDescendants={totalDescendants} onExpand={() => setShowChildren(true)} />
          )}

          {hasChildren && !continueBranch && showChildren && (
            <div className="mt-1 space-y-0">
              <ThreadSiblingGroup
                nodes={node.children}
                depth={depth + 1}
                opPubkey={opPubkey}
                indentCap={indentCap}
                groupKey={node.event.id}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function InlineThreadReplyBar({
  replyTo,
  variant = "compact",
}: {
  replyTo: Event;
  variant?: "compact" | "full";
}) {
  const { pubkey, profile } = useNostrAuth();
  const [showComposer, setShowComposer] = useState(false);

  if (!pubkey) return null;

  const isFull = variant === "full";

  if (showComposer) {
    return (
      <div
        className={
          isFull
            ? "px-4 sm:px-5 py-3"
            : "border-t border-border/20 px-3 sm:px-4 py-2.5"
        }
        data-testid={`inline-reply-bar-${replyTo.id}`}
      >
        <ReplyComposer replyTo={replyTo} onClose={() => setShowComposer(false)} />
      </div>
    );
  }

  if (isFull) {
    const initials = (profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase();
    return (
      <button
        type="button"
        onClick={() => setShowComposer(true)}
        aria-label="Write a reply"
        className="group w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left bg-transparent border-0 appearance-none cursor-text transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus:outline-none"
        data-testid={`inline-reply-prompt-${replyTo.id}`}
      >
        <Avatar className="w-8 h-8 border border-border/40 shrink-0">
          <AvatarImage src={profile?.picture} alt="You" />
          <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="flex-1 text-sm text-muted-foreground/70 truncate">
          Write a reply...
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full bg-brand/15 text-brand text-xs font-semibold px-3.5 py-1.5 transition-colors group-hover:bg-brand/25"
        >
          Reply
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5 border-t border-border/20 cursor-text"
      onClick={() => setShowComposer(true)}
      data-testid={`inline-reply-prompt-${replyTo.id}`}
    >
      <Avatar className="w-6 h-6 border border-border/40 shrink-0">
        <AvatarImage src={profile?.picture} alt="You" />
        <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
          {(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs text-muted-foreground/50">Write a reply...</span>
    </div>
  );
}

export function ReplyThread({ rootId, rootEvent, onClose, showFloatingCollapse = true, bare = false }: { rootId: string; rootEvent?: Event; onClose: () => void; showFloatingCollapse?: boolean; bare?: boolean }) {
  const cached = useMemo(() => getCachedThread(rootId), [rootId]);
  const [allReplies, setAllReplies] = useState<Event[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [collapsed, setCollapsed] = useState(false);
  const indentCap = useThreadIndentCap();
  const fetchedRef = useRef(false);
  const { enabled: ttsEnabled, startReadingThread, isReading, sourceUrl: ttsSourceUrl, stop: stopTTS } = useTTS();
  const { toast } = useToast();
  const commentTrustVisible = useCommentTrustVisible();

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const { cancel } = fetchThreadRepliesStreaming(
      rootId,
      (replies) => {
        setAllReplies(replies);
        setLoading(false);
        const existing = primalStatsCache.get(rootId);
        const existingReplies = existing?.replies ?? 0;
        if (replies.length > existingReplies) {
          primalStatsCache.set(rootId, {
            replies: replies.length,
            reposts: existing?.reposts ?? 0,
            likes: existing?.likes ?? 0,
            zaps: existing?.zaps ?? 0,
            zapAmount: existing?.zapAmount ?? 0,
          });
        }
        const pubkeys = Array.from(new Set(replies.map((r) => r.pubkey)));
        if (pubkeys.length > 0) {
          fetchProfiles(pubkeys.slice(0, 50), FAST_RELAYS.slice(0, 3));
        }
      },
    );

    const loadingTimeout = setTimeout(() => setLoading(false), 4000);

    return () => {
      cancel();
      clearTimeout(loadingTimeout);
    };
  }, [rootId]);

  useEffect(() => {
    const sub = eventStore.insert$.subscribe((e) => {
      // Kind 1111 = NIP-22 comments, Amethyst's reply format since 2026-08 —
      // they splice into kind-1 threads exactly like NIP-10 replies.
      if (e.kind !== KIND_TEXT_NOTE && e.kind !== KIND_NIP22_COMMENT) return;
      setAllReplies((prev) => {
        if (prev.some((p) => p.id === e.id)) return prev;
        const rootE = getRootEventId(e);
        const replyE = getReplyTargetId(e);
        const existingIds = new Set(prev.map((p) => p.id));
        existingIds.add(rootId);
        // Only splice in events that genuinely REPLY into this thread — its root
        // is our root, or its reply-target is our root or an already-shown reply.
        // Previously any event carrying ANY `e` tag that referenced a shown id
        // (a quote, a mention, or a repost-hydrated original that entered the
        // shared eventStore) was treated as a reply and leaked into the thread.
        const isRelevant = rootE === rootId || replyE === rootId ||
          (replyE != null && existingIds.has(replyE));
        if (!isRelevant) return prev;
        const updated = [...prev, e];
        setCachedThread(rootId, updated);
        const existing = primalStatsCache.get(rootId);
        const existingReplies = existing?.replies ?? 0;
        if (updated.length > existingReplies) {
          primalStatsCache.set(rootId, {
            replies: updated.length,
            reposts: existing?.reposts ?? 0,
            likes: existing?.likes ?? 0,
            zaps: existing?.zaps ?? 0,
            zapAmount: existing?.zapAmount ?? 0,
          });
        }
        return updated;
      });
    });
    return () => sub.unsubscribe();
  }, [rootId]);

  const [sortOrder, setSortOrder] = useState<"oldest" | "newest">(() => {
    try {
      const saved = localStorage.getItem("relay-outpost-default-comment-sort");
      if (saved === "newest") return "newest";
    } catch {}
    return "oldest";
  });
  const [excludedTiers, setExcludedTiers] = useState<Set<string>>(() => {
    try {
      const trustVisible = localStorage.getItem("relay-outpost-hide-comment-trust") !== "true";
      if (trustVisible) {
        const stored = localStorage.getItem("relay-outpost-excluded-tiers");
        if (stored) {
          const tiers: string[] = JSON.parse(stored);
          // Migrate the old combined "none" exclusion to "unverified" only —
          // preserves "hide low-trust" intent without also hiding no-data accounts.
          const migrated = tiers.map((t) => (t === "none" ? "unverified" : t));
          if (migrated.length > 0) return new Set(migrated);
        }
      }
    } catch {}
    return new Set();
  });
  const { getAuthorInfluence: getReplyAuthorInfluence, flaggedPubkeys: replyFlaggedPubkeys, requestScoresBulk: requestReplyScoresBulk } = useGrapeRankScores();

  // Prefetch reply-author WoT scores the moment replies stream in, so the trust
  // bar resolves fast instead of waiting for its own render-time fetch.
  useEffect(() => {
    if (allReplies.length === 0) return;
    const authors = Array.from(new Set(allReplies.map((r) => r.pubkey)));
    if (authors.length > 0) requestReplyScoresBulk(authors);
  }, [allReplies, requestReplyScoresBulk]);

  const threadTree = useMemo(() => {
    const tree = buildThreadTree(allReplies, rootId);
    if (sortOrder === "newest") return [...tree].reverse();
    return tree;
  }, [allReplies, rootId, sortOrder]);

  const filteredThreadTree = useMemo(() => {
    if (excludedTiers.size === 0) return threadTree;
    function filterNodes(nodes: ThreadNode[]): ThreadNode[] {
      const result: ThreadNode[] = [];
      for (const node of nodes) {
        const isFlagged = replyFlaggedPubkeys?.has(node.event.pubkey) ?? false;
        // Same split as the trust bar: "unverified" (scored low) vs "unknown" (no
        // data). Excluding low-trust must NOT hide accounts we simply lack a score
        // for, so they stay visible unless the user filters "No data" explicitly.
        const effectiveTier = getReplyTier(getReplyAuthorInfluence(node.event.pubkey), isFlagged);
        if (excludedTiers.has(effectiveTier)) {
          result.push(...filterNodes(node.children));
        } else {
          result.push({ ...node, children: filterNodes(node.children) });
        }
      }
      return result;
    }
    return filterNodes(threadTree);
  }, [threadTree, excludedTiers, getReplyAuthorInfluence, replyFlaggedPubkeys]);

  const filteredNodeCount = useMemo(() => {
    function countNodes(nodes: ThreadNode[]): number {
      let c = 0;
      for (const n of nodes) { c += 1 + countNodes(n.children); }
      return c;
    }
    return countNodes(filteredThreadTree);
  }, [filteredThreadTree]);

  const threadTTSSourceUrl = `thread-tts-${rootId}`;
  const isReadingThread = isReading && ttsSourceUrl === threadTTSSourceUrl;

  const handleReadThread = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReadingThread) {
      stopTTS();
      return;
    }
    const segments = flattenThreadForTTS(rootEvent, threadTree);
    if (segments.length === 0) {
      toast({ title: "Nothing to read", description: "This thread has no readable text content.", variant: "destructive" });
      return;
    }
    startReadingThread(segments, "Thread discussion", threadTTSSourceUrl, rootEvent?.pubkey);
  }, [isReadingThread, rootEvent, threadTree, startReadingThread, stopTTS, threadTTSSourceUrl, toast]);

  const threadRef = useRef<HTMLDivElement>(null);
  const [postOffScreen, setPostOffScreen] = useState(false);
  const [threadInView, setThreadInView] = useState(true);

  const collapseAndScroll = useCallback(() => {
    setCollapsed(true);
    requestAnimationFrame(() => {
      const el = threadRef.current;
      if (!el) return;
      const postEl = el.closest(".feed-post-item");
      const target = postEl || el;
      const rect = target.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        target.scrollIntoView({ behavior: "instant", block: "start" });
        window.scrollBy({ top: -20, behavior: "instant" });
      }
    });
  }, []);

  useEffect(() => {
    if (collapsed) {
      setPostOffScreen(false);
      setThreadInView(true);
      return;
    }
    const el = threadRef.current;
    if (!el) return;
    const postItem = el.closest(".feed-post-item");
    if (!postItem) return;
    const cardEl = postItem.querySelector(":scope > .glass-card");
    if (!cardEl) return;
    const scrollRoot = document.querySelector(".feed-scroll-container") as HTMLElement | null;
    const cardObserver = new IntersectionObserver(
      ([entry]) => setPostOffScreen(!entry.isIntersecting),
      { root: scrollRoot, threshold: 0 },
    );
    const threadObserver = new IntersectionObserver(
      ([entry]) => setThreadInView(entry.isIntersecting),
      { root: scrollRoot, threshold: 0 },
    );
    cardObserver.observe(cardEl);
    threadObserver.observe(el);
    return () => {
      cardObserver.disconnect();
      threadObserver.disconnect();
    };
  }, [collapsed, rootId, loading]);

  if (loading) {
    // Bare (dedicated thread page): the reply box lives above this, so just show
    // a slim loader with no close button or second composer.
    if (bare) {
      return (
        <div className="mt-3 flex items-center gap-2.5 px-4 py-3 text-muted-foreground" data-testid={`replies-loading-${rootId}`}>
          <RelayOutpostInlineLoader />
          <span className="text-xs">Loading replies…</span>
        </div>
      );
    }
    return (
      <div className="mt-3 glass-thread rounded-xl overflow-visible" data-testid={`replies-loading-${rootId}`}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <RelayOutpostInlineLoader />
            <span className="text-xs">Loading thread...</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground/70"
            onClick={onClose}
            data-testid={`button-close-thread-loading-${rootId}`}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        {rootEvent && <InlineThreadReplyBar replyTo={rootEvent} />}
      </div>
    );
  }

  if (threadTree.length === 0) {
    // Bare: one quiet empty state — the reply box is already above.
    if (bare) {
      return (
        <p className="mt-4 text-center text-sm text-muted-foreground/50 py-6" data-testid={`replies-empty-${rootId}`}>No replies yet</p>
      );
    }
    return (
      <div className="mt-3 glass-thread rounded-xl overflow-visible" data-testid={`replies-empty-${rootId}`}>
        <div
          className="flex items-center justify-between px-4 py-2.5 glass-thread-header rounded-t-xl cursor-pointer"
          onClick={() => setCollapsed((c) => !c)}
          data-testid={`button-toggle-empty-thread-${rootId}`}
        >
          <span className="text-xs font-medium text-muted-foreground">No replies yet</span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground/70"
              onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
              data-testid={`button-collapse-thread-empty-${rootId}`}
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground/70"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              data-testid={`button-close-thread-empty-${rootId}`}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        {!collapsed && (
          <>
            <p className="text-xs text-muted-foreground/50 text-center py-3">No replies yet</p>
            {rootEvent && <InlineThreadReplyBar replyTo={rootEvent} />}
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={threadRef} className="mt-3 glass-thread rounded-xl overflow-visible" data-testid={`replies-${rootId}`}>
      <div
        className={`flex items-center justify-between px-4 py-2.5 glass-thread-header rounded-t-xl ${bare ? "" : "cursor-pointer"}`}
        onClick={bare ? undefined : () => setCollapsed((c) => !c)}
        data-testid={`button-toggle-thread-${rootId}`}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-brand/50" />
          <span className="text-xs font-medium text-foreground/70">
            {threadTree.length} {threadTree.length === 1 ? "reply" : "replies"}
            {allReplies.length > threadTree.length && (
              <span className="text-muted-foreground/50 ml-1">
                ({allReplies.length} total)
              </span>
            )}
            {excludedTiers.size > 0 && filteredNodeCount !== allReplies.length && (
              <span className="text-brand/60 ml-1">
                (showing {filteredNodeCount})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {ttsEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 px-1.5 text-[10px] gap-1 ${isReadingThread ? "text-brand" : "text-muted-foreground/70 hover:text-foreground/80"}`}
              onClick={handleReadThread}
              title={isReadingThread ? "Stop reading thread" : "Read thread aloud"}
              data-testid={`button-read-thread-${rootId}`}
            >
              {isReadingThread ? <X className="w-3 h-3" /> : <Headphones className="w-3 h-3" />}
              {isReadingThread ? "Stop" : "Listen"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] text-muted-foreground/70 hover:text-foreground/80 gap-1"
            onClick={(e) => { e.stopPropagation(); setSortOrder((s) => s === "oldest" ? "newest" : "oldest"); }}
            data-testid={`button-sort-thread-${rootId}`}
          >
            <ArrowUpDown className="w-3 h-3" />
            {sortOrder === "oldest" ? "Oldest" : "Newest"}
          </Button>
          {!bare && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground/70"
                onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
                data-testid={`button-collapse-thread-${rootId}`}
              >
                {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground/70"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                data-testid={`button-close-thread-${rootId}`}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      {!collapsed && (
        <>
          {commentTrustVisible && <ThreadTrustBar replies={allReplies} excludedTiers={excludedTiers} onFilterChange={setExcludedTiers} />}
          <div className="p-3 sm:p-4 space-y-3">
            {filteredThreadTree.length === 0 && excludedTiers.size > 0 ? (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground/50">All replies filtered out</p>
                <button
                  onClick={() => setExcludedTiers(new Set())}
                  className="text-[11px] text-brand/70 hover:text-brand-strong transition-colors mt-1 cursor-pointer"
                >
                  Show all replies
                </button>
              </div>
            ) : (
              <ThreadSiblingGroup
                nodes={filteredThreadTree}
                depth={0}
                opPubkey={rootEvent?.pubkey}
                indentCap={indentCap}
                groupKey={rootId}
              />
            )}
          </div>
          {!bare && rootEvent && <InlineThreadReplyBar replyTo={rootEvent} />}
          {!bare && (
            <div
              className="flex items-center justify-center gap-1.5 px-4 py-2 border-t border-border/10 cursor-pointer text-xs text-muted-foreground/60 hover:text-brand/70 transition-colors"
              onClick={collapseAndScroll}
              data-testid={`button-collapse-thread-bottom-${rootId}`}
            >
              <ChevronUp className="w-3 h-3" />
              <span>Collapse thread</span>
            </div>
          )}
        </>
      )}
      {/* Floating "collapse + jump back to post" shortcut. Only meaningful in a
          scrollable feed; hidden on the focused single-thread view (nothing to
          scroll back into). */}
      {showFloatingCollapse && createPortal(
        <button
          onClick={collapseAndScroll}
          className={`collapse-thread-btn fixed z-[42] flex items-center justify-center rounded-full cursor-pointer transition-all duration-300 ${postOffScreen && !collapsed && threadInView ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none"}`}
          style={{ right: "calc(1.5rem + 5px)", bottom: "7.75rem" }}
          aria-label="Collapse thread and return to post"
          data-testid={`button-float-collapse-thread-${rootId}`}
        >
          <Orbit className="w-3 h-3" />
        </button>,
        document.body,
      )}
    </div>
  );
}

