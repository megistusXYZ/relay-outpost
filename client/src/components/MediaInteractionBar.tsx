import { useEffect, useMemo, useState, useCallback } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Button } from "@/components/ui/button";
import {
  Bookmark,
  BookmarkCheck,
  Heart,
  Repeat,
  Copy,
  ExternalLink,
  MessageCircle,
  Hash,
  User,
  FileJson,
  VolumeX,
  Flag,
  Type,
  Orbit,
} from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { use$ } from "applesauce-react/hooks";
import {
  KIND_REPOST,
  KIND_REACTION,
  KIND_METADATA,
  formatNoteId,
  formatNpub,
  shortenNpub,
  getDisplayName,
  buildRepostTags,
  buildReactionTags,
  getRelayHintForEvent,
} from "@/lib/nostr-helpers";
import { eventStore, publishEvent, getEventRelays } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { useNostrBookmarks } from "@/hooks/use-nostr-bookmarks";
import { usePrimalStats } from "@/hooks/use-primal-stats";
import { primalStatsCache } from "@/lib/primal-cache";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { ZapDialog } from "@/components/ZapDialog";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { ReportDialog } from "@/components/ReportDialog";
import { ConfirmAction } from "@/components/ConfirmAction";
import { formatSats } from "@/lib/zap";
import { mutePubkey } from "@/lib/spam-filter";
import { copyNostrId } from "@/lib/clipboard-bridge";

interface MediaInteractionBarProps {
  event: Event;
  vertical?: boolean;
  onCommentClick?: () => void;
}

export function MediaInteractionBar({ event, vertical, onCommentClick }: MediaInteractionBarProps) {
  const { toast } = useToast();
  const { signer, pubkey, attemptReconnect } = useNostrAuth();
  const { isBookmarked: checkBookmarked, toggleBookmark } = useNostrBookmarks();
  const stats = usePrimalStats(event.id);

  const [hasReposted, setHasReposted] = useState(false);
  const [hasLiked, setHasLiked] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showMuteConfirm, setShowMuteConfirm] = useState(false);

  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(event.pubkey));
  const authorDisplayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;

  const repostCount = stats?.reposts ?? 0;
  const likeCount = stats?.likes ?? 0;
  const zapCount = stats?.zaps ?? 0;
  const zapAmount = stats?.zapAmount ?? 0;
  const replyCount = stats?.replies ?? 0;

  useEffect(() => {
    if (!pubkey) return;
    const checkReposted = () => {
      const all = eventStore.getByFilters({ kinds: [KIND_REPOST] });
      setHasReposted([...all].some(
        (e) => e.pubkey === pubkey && e.tags.some((t) => t[0] === "e" && t[1] === event.id)
      ));
    };
    const checkLiked = () => {
      const all = eventStore.getByFilters({ kinds: [KIND_REACTION] });
      setHasLiked([...all].some(
        (e) => e.pubkey === pubkey && e.tags.some((t) => t[0] === "e" && t[1] === event.id)
      ));
    };
    checkReposted();
    checkLiked();
    const sub = eventStore.insert$.subscribe((e) => {
      if (e.kind === KIND_REPOST) checkReposted();
      if (e.kind === KIND_REACTION) checkLiked();
    });
    return () => sub.unsubscribe();
  }, [event.id, pubkey]);

  const isBookmarked = checkBookmarked(event.id);

  const noteId = useMemo(() => formatNoteId(event.id), [event.id]);

  const handleRepost = useCallback(async () => {
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
      publishEvent(signedEvent, userRelays, undefined, isUserSelected).catch((err) => {
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
  }, [signer, hasReposted, event, toast, attemptReconnect]);

  const handleLike = useCallback(async () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to like.", variant: "destructive" });
      return;
    }
    if (hasLiked) return;
    setIsLiking(true);
    try {
      const hint = getRelayHintForEvent(event.id, getEventRelays);
      const tags = buildReactionTags(event, hint);
      const eventTemplate = {
        kind: KIND_REACTION,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "+",
      };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      setHasLiked(true);
      setIsLiking(false);
      const existing = primalStatsCache.get(event.id);
      primalStatsCache.set(event.id, {
        replies: existing?.replies ?? 0,
        reposts: existing?.reposts ?? 0,
        likes: (existing?.likes ?? 0) + 1,
        zaps: existing?.zaps ?? 0,
        zapAmount: existing?.zapAmount ?? 0,
      });
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      publishEvent(signedEvent, userRelays, undefined, isUserSelected).catch((err) => {
        console.error(err);
        setHasLiked(false);
        const rollback = primalStatsCache.get(event.id);
        if (rollback && rollback.likes > 0) {
          primalStatsCache.set(event.id, { ...rollback, likes: rollback.likes - 1 });
        }
        toast({ title: "Failed", description: "Could not like.", variant: "destructive" });
      });
    } catch (err) {
      console.error(err);
      setIsLiking(false);
      if (isSignerError(err)) {
        handleSignerError(err, toast, attemptReconnect);
      } else {
        toast({ title: "Failed", description: "Could not like.", variant: "destructive" });
      }
    }
  }, [signer, hasLiked, event, toast, attemptReconnect]);

  const handleBookmark = useCallback(() => {
    toggleBookmark(event.id);
  }, [toggleBookmark, event.id]);

  const handleCopyLink = useCallback(async () => {
    try {
      await copyNostrId(`nostr:${noteId}`);
      toast({ title: "Copied", description: "Note link copied." });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  }, [noteId, toast]);

  const handleCopyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(event.content);
      toast({ title: "Copied", description: "Note text copied." });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  }, [event.content, toast]);

  const handleCopyNoteId = useCallback(async () => {
    try {
      await copyNostrId(noteId);
      toast({ title: "Copied", description: "Note ID copied." });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  }, [noteId, toast]);

  const handleCopyNpub = useCallback(async () => {
    try {
      const npub = nip19.npubEncode(event.pubkey);
      await copyNostrId(npub);
      toast({ title: "Copied", description: "Author npub copied." });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  }, [event.pubkey, toast]);

  const handleViewOnWeb = useCallback(() => {
    window.open(`${window.location.origin}/thread/${event.id}`, "_blank");
  }, [event.id]);

  return (
    <>
      <div className={vertical
        ? "flex flex-col items-center gap-1 bg-black/50 backdrop-blur-md rounded-full py-2.5 px-1.5"
        : "flex items-center gap-0.5 px-2 py-1.5"
      } onClick={(e) => e.stopPropagation()}>
        {onCommentClick && (
          <div className={vertical ? "flex flex-col items-center" : "contents"}>
            <Button
              variant="ghost"
              size="icon"
              className={vertical
                ? "w-9 h-9 rounded-full text-white/90"
                : "w-7 h-7 text-muted-foreground/80"
              }
              onClick={onCommentClick}
              data-testid={`button-media-comment-${event.id}`}
            >
              <MessageCircle className={vertical ? "w-5 h-5" : "w-3.5 h-3.5"} />
            </Button>
            {vertical && replyCount > 0 && (
              <span className="text-[11px] text-white/60 -mt-1.5" data-testid={`text-media-reply-count-${event.id}`}>
                {replyCount}
              </span>
            )}
            {!vertical && replyCount > 0 && (
              <span className="text-[11px] text-muted-foreground/70 -ml-1 mr-0.5" data-testid={`text-media-reply-count-${event.id}`}>
                {replyCount}
              </span>
            )}
          </div>
        )}

        <div className={vertical ? "flex flex-col items-center" : "contents"}>
          <Button
            variant="ghost"
            size="icon"
            className={vertical
              ? `w-9 h-9 rounded-full ${hasReposted ? "text-green-800 dark:text-green-400" : "text-white/90"}`
              : `w-7 h-7 ${hasReposted ? "text-green-500/80" : "text-muted-foreground/80"}`
            }
            onClick={handleRepost}
            disabled={isReposting || hasReposted}
            data-testid={`button-media-repost-${event.id}`}
          >
            {isReposting ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Repeat className={vertical ? "w-5 h-5" : "w-3.5 h-3.5"} />}
          </Button>
          {vertical && repostCount > 0 && (
            <span className="text-[11px] text-white/60 -mt-1.5" data-testid={`text-media-repost-count-${event.id}`}>
              {repostCount}
            </span>
          )}
          {!vertical && repostCount > 0 && (
            <span className={`text-[11px] -ml-1 mr-0.5 ${hasReposted ? "text-green-500/80" : "text-muted-foreground/70"}`} data-testid={`text-media-repost-count-${event.id}`}>
              {repostCount}
            </span>
          )}
        </div>

        <div className={vertical ? "flex flex-col items-center" : "contents"}>
          <Button
            variant="ghost"
            size="icon"
            className={vertical
              ? `w-9 h-9 rounded-full ${hasLiked ? "text-red-700 dark:text-red-400" : "text-white/90"}`
              : `w-7 h-7 ${hasLiked ? "text-red-700/80 dark:text-red-400/80" : "text-muted-foreground/80"}`
            }
            onClick={handleLike}
            disabled={isLiking || hasLiked}
            data-testid={`button-media-like-${event.id}`}
          >
            {isLiking ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Heart className={`${vertical ? "w-5 h-5" : "w-3.5 h-3.5"} ${hasLiked ? "fill-current" : ""}`} />}
          </Button>
          {vertical && likeCount > 0 && (
            <span className="text-[11px] text-white/60 -mt-1.5" data-testid={`text-media-like-count-${event.id}`}>
              {likeCount}
            </span>
          )}
          {!vertical && likeCount > 0 && (
            <span className={`text-[11px] -ml-1 mr-0.5 ${hasLiked ? "text-red-700/80 dark:text-red-400/80" : "text-muted-foreground/70"}`} data-testid={`text-media-like-count-${event.id}`}>
              {likeCount}
            </span>
          )}
        </div>

        <div className={vertical ? "flex flex-col items-center" : "contents"}>
          <Button
            variant="ghost"
            size="icon"
            className={vertical
              ? "w-9 h-9 rounded-full text-white/90"
              : "w-7 h-7 text-muted-foreground/80"
            }
            onClick={() => {
              if (!signer) {
                toast({ title: "Sign in required", description: "Sign in to zap.", variant: "destructive" });
                return;
              }
              setShowZapDialog(true);
            }}
            data-testid={`button-media-zap-${event.id}`}
          >
            <BtcZapIcon className={vertical ? "w-5 h-5" : "w-3.5 h-3.5"} />
          </Button>
          {vertical && (zapCount > 0 || zapAmount > 0) && (
            <span className="text-[11px] text-amber-800/80 dark:text-amber-400/80 -mt-1.5" data-testid={`text-media-zap-count-${event.id}`}>
              {zapAmount > 0 ? formatSats(zapAmount) : zapCount}
            </span>
          )}
          {!vertical && (zapCount > 0 || zapAmount > 0) && (
            <span className="text-[11px] text-amber-500/60 -ml-1 mr-0.5" data-testid={`text-media-zap-count-${event.id}`}>
              {zapAmount > 0 ? formatSats(zapAmount) : zapCount}
            </span>
          )}
        </div>

        {!vertical && <div className="flex-1" />}

        <div className={vertical ? "flex flex-col items-center" : "contents"}>
          <Button
            variant="ghost"
            size="icon"
            className={vertical
              ? `w-9 h-9 rounded-full ${isBookmarked ? "text-white" : "text-white/90"}`
              : `w-7 h-7 ${isBookmarked ? "text-foreground" : "text-muted-foreground/80"}`
            }
            onClick={handleBookmark}
            disabled={!pubkey}
            data-testid={`button-media-bookmark-${event.id}`}
          >
            {isBookmarked ? (
              <BookmarkCheck className={`${vertical ? "w-5 h-5" : "w-3.5 h-3.5"} fill-current`} />
            ) : (
              <Bookmark className={`${vertical ? "w-5 h-5" : "w-3.5 h-3.5"}`} />
            )}
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={vertical
                ? "w-9 h-9 rounded-full text-white/90"
                : "w-7 h-7 text-muted-foreground/80"
              }
              data-testid={`button-media-options-${event.id}`}
            >
              <Orbit className={vertical ? "w-5 h-5" : "w-3.5 h-3.5"} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-dropdown min-w-[190px]" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuLabel className="glass-dropdown-label">Copy</DropdownMenuLabel>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyLink} data-testid={`menu-media-copy-link-${event.id}`}>
              <Copy className="w-3.5 h-3.5 text-brand/70" />
              Note Link
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyText} data-testid={`menu-media-copy-text-${event.id}`}>
              <Type className="w-3.5 h-3.5 text-brand/70" />
              Note Text
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyNoteId} data-testid={`menu-media-copy-id-${event.id}`}>
              <Hash className="w-3.5 h-3.5 text-brand/70" />
              Note ID
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyNpub} data-testid={`menu-media-copy-npub-${event.id}`}>
              <User className="w-3.5 h-3.5 text-brand/70" />
              Author npub
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="glass-dropdown-label">Inspect</DropdownMenuLabel>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => setTimeout(() => setShowRawData(true), 0)} data-testid={`menu-media-raw-data-${event.id}`}>
              <FileJson className="w-3.5 h-3.5 text-brand/70" />
              Raw Telemetry
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleViewOnWeb} data-testid={`menu-media-view-web-${event.id}`}>
              <ExternalLink className="w-3.5 h-3.5 text-brand/70" />
              Open in New Tab
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => setTimeout(() => setShowMuteConfirm(true), 0)} data-testid={`menu-media-mute-${event.id}`}>
              <VolumeX className="w-3.5 h-3.5" />
              Mute Signal
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => setTimeout(() => setShowReportDialog(true), 0)} data-testid={`menu-media-report-${event.id}`}>
              <Flag className="w-3.5 h-3.5" />
              Report Content
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ReportDialog open={showReportDialog} onOpenChange={setShowReportDialog} event={event} />
        <ConfirmAction
          open={showMuteConfirm}
          onOpenChange={setShowMuteConfirm}
          title={`Mute ${authorDisplayName}?`}
          description="You won't see their posts anymore. You can unmute them anytime."
          confirmLabel="Mute"
          variant="destructive"
          onConfirm={() => {
            setShowMuteConfirm(false);
            mutePubkey(event.pubkey);
          }}
        />
      </div>

      <ZapDialog
        open={showZapDialog}
        onOpenChange={setShowZapDialog}
        event={event}
        recipientName=""
      />

      <Dialog open={showRawData} onOpenChange={setShowRawData}>
        <DialogContent className="max-w-lg sm:max-w-2xl glass-dialog-card border-brand/15 max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
              <FileJson className="w-4 h-4 text-brand/70" />
              Raw Telemetry
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="text-xs font-mono text-foreground/80 bg-muted/50 dark:bg-black/20 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(event, null, 2)}
            </pre>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
                  toast({ title: "Copied", description: "Raw event JSON copied." });
                } catch {
                  toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
                }
              }}
              data-testid={`button-copy-raw-${event.id}`}
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" />
              Copy JSON
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
