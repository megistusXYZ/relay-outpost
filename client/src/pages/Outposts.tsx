import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Segment } from "./home/FeedOptionsSheet";
import { MissionBriefing, OUTPOSTS_BRIEFING } from "@/components/MissionBriefing";
import { Link, useLocation, useSearch } from "wouter";
import { pool, fetchProfilesCached, eventStore, publishEvent } from "@/lib/nostr";
import { FeaturedStrip } from "@/components/FeaturedStrip";
import { getAuthStatus, onAuthChange, resetAuthState } from "@/lib/nip42-auth";
import { useConcordEnabled } from "@/lib/concord/concord-prefs";
import { getOutpostRelays, isJoinedOutpost, joinOutpost, leaveOutpost, updateNip65RelayList, publishCommunitySubscriptions, hydrateCommunitySubscriptions, classifyRelayUrl, reorderOutpostRelays, saveOutpostRelays, getActiveDefaultRelays, type OutpostRelay } from "@/lib/outpost-relays";
import { isPinned as isFeedPinned, togglePin as toggleFeedPin, cleanupPinnedFeeds, getPinnedFeeds, groupPinsByRelay, pinUrl, normalizeUrl, slugToTabKey, tabKeyToSlug, type PinnableTab, type PinnedFeed } from "@/lib/pinned-feeds";
import { TAB_ICON, pinDisplayLabel } from "@/lib/pin-meta";
import { FOCUS_RING } from "@/lib/a11y";
import { isReplyEvent } from "./home/helpers";
import { fetchNip11, isNip11Operator, type Nip11Document, getSoftwareDisplay } from "@/lib/nip11";
import { banEvent, banPubkey, listAllowedPubkeys } from "@/lib/nip86";
import { addModLogEntry, ADMIN_BLOCKLIST_KEY, getStoredList, saveStoredList } from "@/pages/relay-ops/shared";
import { withSignerTimeout, SIGNER_SIGN_TIMEOUT } from "@/lib/signer-timeout";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { GuestWall } from "@/components/GuestWall";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { FEED_FILTER_TIERS } from "@/pages/home/feed-controls";
import { getSignalTierLabel } from "@/lib/graperank";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { useExcludedTiers, readOutpostFilterOn, writeOutpostFilterOn, isHiddenByTrust } from "@/lib/trust-filter";
import { useOutpostCompose } from "@/contexts/OutpostComposeContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useOutpostDirectorySearch } from "@/hooks/use-outpost-directory-search";
import { useHeaderIdentitySlot } from "@/hooks/use-header-identity-slot";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import { nextPageLimit, BASE_PAGE_LIMIT } from "@/lib/adaptive-page";
import { NewPostsBanner } from "@/components/NewPostsBanner";
import { ComposeEmojiPicker, useEmojiTags } from "@/components/ComposeEmojiPicker";
import { useCustomEmojis } from "@/hooks/use-custom-emojis";
import type { CustomEmoji } from "@/hooks/use-custom-emojis";
import { useMention } from "@/hooks/use-mention";
import { MentionSearch } from "@/components/MentionSearch";
import { MentionHighlightTextarea } from "@/components/MentionHighlightTextarea";
import { buildDestinationLabel } from "@/lib/community-destination";
import { NostrPost, TrustTierDot } from "@/components/NostrPost";
import { PersonBadges } from "@/components/PersonBadges";
import { OutpostContentRenderer, getFirstImageUrl } from "@/components/OutpostContentRenderer";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchPill } from "@/components/SearchPill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/PageTabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction } from "@/components/ui/alert-dialog";
import {
  Search,
  X,
  Lock,
  Hash,
  Shield,
  ChevronRight,
  ArrowLeft,
  Server,
  Zap,
  MessageSquare,
  Satellite,
  Rocket,
  Sparkles,
  ArrowUpRight,
  Telescope,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Send,
  ArrowBigUp,
  ArrowBigDown,
  Share2,
  Info,
  LogIn,
  LogOut,
  PenSquare,
  ShieldCheck,
  Settings,
  Trash2,
  Pin,
  PinOff,
  ImagePlus,
  Film,
  Music,
  LinkIcon,
  ArrowUpDown,
  Clock,
  Flame,
  TrendingUp,
  ShieldAlert,
  RefreshCw,
  Package,
  GripVertical,
  ChevronsDownUp,
  ChevronsUpDown,
  Wrench,
  Link2,
  Copy,
  Check,
  Inbox } from "lucide-react";
import { ResponsiveFormPanel } from "@/components/ui/responsive-form-panel";
import { ProfileSearchInput, type SelectedRecipient } from "@/components/ProfileSearchInput";
import { sendDM } from "@/lib/dm";
import { OutpostIcon } from "@/components/icons/OutpostIcon";
import { WavesIcon } from "@/components/icons/WavesIcon";
import { TimelineIcon } from "@/components/icons/TimelineIcon";
import { AboutIcon } from "@/components/icons/AboutIcon";
import { RelayFeaturedFeed, useRelayFeaturedSets } from "@/components/RelayFeaturedFeed";
import { starterSuggestions } from "@/lib/starter-communities";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import { useQuery } from "@tanstack/react-query";
import { HorizonIcon } from "@/components/icons/HorizonIcon";
import { ChannelsIcon } from "@/components/icons/CommsIcon";
import { HorizonTab } from "@/components/HorizonTab";
import { CommsTab } from "@/components/CommsTab";
import { ChatTab } from "@/components/concord/ChatTab";
import type { Event as NostrEvent } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { use$ } from "applesauce-react/hooks";
import {
  uploadToNostrBuild,
  uploadMediaForOutpost,
  UploadError,
  validateFile,
  isVideoFile,
  isAudioFile } from "@/lib/media-upload";
import {
  getAvatarUrl,
  getProfileContent,
  getDisplayName,
  KIND_METADATA,
  KIND_TEXT_NOTE,
  KIND_TOPIC,
  KIND_COMMENT,
  KIND_REACTION,
  clientTags,
  buildNip22CommentTags,
  formatNpub,
  shortenNpub } from "@/lib/nostr-helpers";
import type { SignalTier } from "@/lib/graperank";
import { OutpostHealthBadge } from "@/components/OutpostHealthBadge";
import { OutpostHero } from "@/components/outpost/OutpostHero";
import { outpostPresenceProps } from "@/lib/outpost-presence";
import { discoverRecipientForRelay, openFeedbackDrawer, repoCoord, subscribeFeedbackThread, hydrateIssues, countUnread, type FeedbackRecipient } from "@/lib/nip34-feedback";



function OperatorBadge({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const avatarUrl = profile ? getAvatarUrl(profile) : null;
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));

  useEffect(() => {
    fetchProfilesCached([pubkey]);
  }, [pubkey]);

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <Avatar className="w-4 h-4 border border-black/10 dark:border-white/10">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName || ""} /> : null}
        <AvatarFallback className="text-[7px] bg-brand/10 text-brand">
          {(displayName || "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-[10px] text-muted-foreground/60 truncate max-w-[100px]">{displayName}</span>
      <TrustTierDot pubkey={pubkey} />
    </div>
  );
}

/** Avatar-only operator credit for the condensed banner strip (tap → profile). */
function OperatorMiniAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const avatarUrl = profile ? getAvatarUrl(profile) : null;
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));

  useEffect(() => {
    fetchProfilesCached([pubkey]);
  }, [pubkey]);

  return (
    <Link
      href={`/profile/${formatNpub(pubkey)}`}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0"
      title={`Operated by ${displayName}`}
      aria-label={`Operated by ${displayName}`}
      data-testid="collapsed-operator-avatar"
    >
      <Avatar className="w-7 h-7 border border-white/25 shadow-sm">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName || ""} /> : null}
        <AvatarFallback className="text-[9px] bg-brand/30 text-brand">
          {(displayName || "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    </Link>
  );
}

function useFeedbackAffordance(relayUrl: string, label: string, isOperator: boolean) {
  const [recipient, setRecipient] = useState<FeedbackRecipient | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    discoverRecipientForRelay(relayUrl, label).then((r) => {
      if (!cancelled) setRecipient(r);
    });
    return () => { cancelled = true; };
  }, [relayUrl, label]);

  const cacheRef = useRef<{ coord: string; issues: ReturnType<typeof hydrateIssues> } | null>(null);

  useEffect(() => {
    cacheRef.current = null;
    setUnread(0);
    if (!isOperator || !recipient?.hasInbox || !recipient.operatorPubkey || !recipient.repoD) return;
    const coord = repoCoord(recipient.operatorPubkey, recipient.repoD);
    const sub = subscribeFeedbackThread(relayUrl, coord, (events) => {
      const issues = hydrateIssues(events);
      cacheRef.current = { coord, issues };
      setUnread(countUnread(coord, issues));
    });
    const onRead = () => {
      const cache = cacheRef.current;
      if (cache) setUnread(countUnread(cache.coord, cache.issues));
    };
    window.addEventListener("relay-outpost:feedback-read", onRead);
    return () => { sub.close(); window.removeEventListener("relay-outpost:feedback-read", onRead); };
  }, [isOperator, recipient, relayUrl]);

  return { recipient, unread };
}

function JoinedCardFeedbackSlot({ relay, isOperator, encodedUrl }: { relay: OutpostRelay; isOperator: boolean; encodedUrl: string }) {
  const [, setLocation] = useLocation();
  const { recipient, unread } = useFeedbackAffordance(relay.url, relay.label, isOperator);

  if (isOperator) {
    return (
      <span className="relative inline-flex shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setLocation(unread > 0 ? `/relay-ops-center/${encodedUrl}#feedback` : `/relay-ops-center/${encodedUrl}`); }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border border-brand/30 bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
          data-testid={`button-operator-console-${relay.url}`}
          title={unread > 0 ? `${unread} new feedback ${unread === 1 ? "item" : "items"}` : "Open the operator console for this community"}
        >
          <Settings className="w-3 h-3" />
          Operator console
        </button>
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-primary text-primary-foreground text-[9px] leading-[14px] font-semibold text-center shadow"
            data-testid={`badge-operator-feedback-unread-${relay.url}`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>
    );
  }

  if (!recipient?.hasInbox) return null;
  return <SendFeedbackLink recipient={recipient} relayUrl={relay.url} />;
}

function SendFeedbackLink({ recipient, relayUrl }: { recipient: FeedbackRecipient; relayUrl: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); openFeedbackDrawer({ initialRecipient: recipient }); }}
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border border-border/40 text-muted-foreground/70 hover:text-brand hover:border-brand/40 hover:bg-brand/5 transition-colors"
      data-testid={`button-card-feedback-${relayUrl}`}
      title="Send feedback to this operator"
    >
      <Inbox className="w-3 h-3" />
      Feedback
    </button>
  );
}

function JoinedOutpostCard({
  relay,
  nip11,
  onMoveUp,
  onMoveDown,
  reordering,
  pins = [],
  pinsExpanded = false,
  onTogglePins }: {
  relay: OutpostRelay;
  nip11: Nip11Document | null;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  reordering?: boolean;
  pins?: PinnedFeed[];
  pinsExpanded?: boolean;
  onTogglePins?: () => void;
}) {
  const [, setLocation] = useLocation();
  const { pubkey: currentPubkey } = useNostrAuth();
  const icon = nip11?.icon;
  const name = nip11?.name || relay.label || relay.url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  const operatorPubkey = nip11?.pubkey;
  const encodedUrl = encodeURIComponent(relay.url);
  // One-tap share: hand someone a direct link to this outpost so they never
  // have to browse for it. (The richer invite-with-code flow lives inside.)
  const [linkCopied, setLinkCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { toast } = useToast();
  const copyOutpostLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${window.location.origin}/outposts/${encodedUrl}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  };
  const isOperator =
    relay.operatorOverride !== "off" &&
    (relay.isAdmin === true ||
      (!!currentPubkey && (
        operatorPubkey === currentPubkey ||
        (nip11?.moderators?.includes(currentPubkey) ?? false)
      )));

  return (
    <Card
      className="glass-card overflow-hidden cursor-pointer hover:border-primary/30 transition-all duration-200 group"
      onClick={() => !reordering && setLocation(`/outposts/${encodedUrl}`)}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-2.5">
          {reordering && (
            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
                disabled={!onMoveUp}
                className={`p-2 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-20 disabled:cursor-default transition-colors ${FOCUS_RING}`}
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
                disabled={!onMoveDown}
                className={`p-2 rounded text-muted-foreground/60 hover:text-foreground disabled:opacity-20 disabled:cursor-default transition-colors ${FOCUS_RING}`}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="shrink-0">
            <Avatar className="w-8 h-8 border border-primary/20">
              <AvatarImage src={icon || undefined} alt={name} />
              <AvatarFallback className="bg-brand/10 text-brand text-[10px]">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <h3 className="text-sm font-semibold truncate">{name}</h3>
            {relay.access === "private" && (
              <Lock className="w-3 h-3 text-amber-600/70 dark:text-amber-400/70 shrink-0" />
            )}
            {operatorPubkey && <TrustTierDot pubkey={operatorPubkey} />}
          </div>
          {!reordering && (
            <button
              type="button"
              onClick={copyOutpostLink}
              className={`shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1.5 rounded-md text-muted-foreground/40 hover:text-brand hover:bg-brand/10 transition-colors ${FOCUS_RING}`}
              aria-label={`Copy link to ${name}`}
              title="Copy link"
              data-testid={`button-outpost-copy-link-${encodedUrl.slice(0, 24)}`}
            >
              {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Link2 className="w-3.5 h-3.5" />}
            </button>
          )}
          {/* Leave — hover-revealed, non-operators only, behind a confirm. Kept
              quiet (fades in on hover) so it never reads as a primary action or
              gets mis-tapped; the dialog is the real safety. */}
          {!reordering && !isOperator && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmLeave(true); }}
              className={`shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1.5 rounded-md text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/10 reveal-on-hover ${FOCUS_RING}`}
              aria-label={`Leave ${name}`}
              title="Leave community"
              data-testid={`button-outpost-leave-${encodedUrl.slice(0, 24)}`}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
          {!reordering && pins.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTogglePins?.(); }}
              className={`shrink-0 flex items-center gap-1 px-2 py-1.5 min-h-[44px] sm:min-h-0 rounded-md text-[10px] font-medium text-brand/80 hover:bg-brand/10 transition-colors ${FOCUS_RING}`}
              aria-label={`Toggle pinned feeds for ${name}`}
              aria-expanded={pinsExpanded}
              data-testid={`button-outpost-pins-toggle-${encodedUrl.slice(0, 24)}`}
            >
              <Pin className="w-2.5 h-2.5 rotate-45" />
              {pins.length}
              <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${pinsExpanded ? "rotate-90" : ""}`} />
            </button>
          )}
          {!reordering && <JoinedCardFeedbackSlot relay={relay} isOperator={!!isOperator} encodedUrl={encodedUrl} />}
          {!reordering && (
            <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-brand/60 dark:text-brand/60 transition-colors shrink-0" />
          )}
        </div>
      </div>
      {!reordering && pins.length > 0 && pinsExpanded && (
        // The whole expander swallows clicks: on touch, a near-miss around a pin
        // row must be INERT — not fall through to the card's own onClick (which
        // opens the outpost on Posts and made pins "always go to Posts" on iOS).
        <div
          className="border-t border-primary/10 px-3 py-1.5 cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          <ul className="space-y-0.5 pl-1.5 border-l border-primary/15 ml-1">
            {pins.map((pin) => {
              const Icon = TAB_ICON[pin.tab];
              return (
                <li key={pin.id}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setLocation(pinUrl(pin)); }}
                    className="w-full flex items-center gap-2 px-2 py-2.5 sm:py-1 min-h-[44px] sm:min-h-0 rounded-md text-xs text-muted-foreground hover:bg-primary/10 hover:text-foreground active:bg-primary/15 transition-colors text-left"
                    data-testid={`link-outpost-pin-${pin.id.slice(0, 32)}`}
                  >
                    <Icon className="w-3 h-3 text-brand/70 shrink-0" />
                    <span className="flex-1 truncate">{pinDisplayLabel(pin)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent className="glass-dialog-card border-red-500/20 max-w-sm" onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-brand tracking-wide">Leave {name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground/70 leading-relaxed">
              You'll be removed from this community and it won't appear in your joined list. You can rejoin anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              // Defer so the dialog finishes closing (Radix restores body
              // pointer-events) before this card unmounts from the list.
              onClick={(e) => { e.stopPropagation(); setTimeout(() => { leaveOutpost(relay.url); toast({ title: `Left ${name}` }); }, 0); }}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
            >
              <LogOut className="w-3 h-3 mr-1" />
              Leave community
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ActiveMemberItem({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const avatarUrl = profile ? getAvatarUrl(profile) : null;
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  // Off the kind-0 already in the store — no extra network.
  const content = profile ? (getProfileContent(profile) as { nip05?: string; name?: string; display_name?: string }) : undefined;

  return (
    <Link href={`/profile/${formatNpub(pubkey)}`}>
      <div
        className="flex items-center gap-2.5 px-2 min-h-[44px] rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
        data-testid={`link-active-member-${pubkey.slice(0, 8)}`}
      >
        <div className="relative shrink-0">
          <Avatar className="w-8 h-8 border border-black/10 dark:border-white/10">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName || ""} /> : null}
            <AvatarFallback className="text-[10px] bg-brand/10 text-brand">
              {(displayName || "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-0.5 -right-0.5">
            <TrustTierDot pubkey={pubkey} />
          </div>
        </div>
        <span className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-foreground/90">
          <span className="truncate">{displayName}</span>
          {/* Inline after the name, NOT on the avatar: TrustTierDot already owns
              that corner, and two small glyphs stacked there reads as noise.
              Different axes anyway — nip05 is domain-attested, TrustTierDot is
              web-of-trust. */}
          <PersonBadges
            pubkey={pubkey}
            nip05={content?.nip05}
            claimedName={content?.display_name || content?.name}
            showCollision={!!profile}
          />
        </span>
      </div>
    </Link>
  );
}

function ActiveMembersSection({ authors }: { authors: string[] }) {
  const { requestScoresBulk, scores, wotEnabled } = useGrapeRankScores();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (authors.length > 0 && wotEnabled) {
      requestScoresBulk(authors);
    }
  }, [authors, requestScoresBulk, wotEnabled]);

  useEffect(() => {
    if (authors.length > 0) {
      fetchProfilesCached(authors);
    }
  }, [authors]);

  const sortedAuthors = useMemo(() => {
    if (!scores) return authors;
    return [...authors].sort((a, b) => {
      const sa = scores.get(a) ?? -1;
      const sb = scores.get(b) ?? -1;
      return sb - sa;
    });
  }, [authors, scores]);

  const displayed = showAll ? sortedAuthors : sortedAuthors.slice(0, 10);

  if (authors.length === 0) return null;

  return (
    <Card className="glass-card overflow-hidden">
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-brand tracking-wider uppercase text-brand">
            Active Members
          </h3>
          <span className="text-[10px] text-muted-foreground/40 tabular-nums">{authors.length}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-0.5">
          {displayed.map((pk) => (
            <ActiveMemberItem key={pk} pubkey={pk} />
          ))}
        </div>
        {sortedAuthors.length > 10 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full mt-2 py-1.5 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors text-[10px] text-brand/60 hover:text-brand text-center"
          >
            Show {sortedAuthors.length - 10} more members
          </button>
        )}
        {showAll && sortedAuthors.length > 10 && (
          <button
            onClick={() => setShowAll(false)}
            className="w-full mt-2 py-1.5 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors text-[10px] text-muted-foreground/50 hover:text-muted-foreground text-center"
          >
            Show less
          </button>
        )}
      </div>
    </Card>
  );
}

type OutpostTab = "feed" | "featured" | "topics" | "channels" | "horizon" | "about";

function WaveAuthorLine({ pubkey, createdAt, isOP, size = "sm" }: { pubkey: string; createdAt: number; isOP?: boolean; size?: "sm" | "md" }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const avatarSize = size === "md" ? "w-7 h-7" : "w-5 h-5";
  const textSize = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar className={`${avatarSize} shrink-0`}>
        {avatar && <AvatarImage src={avatar} alt={name} />}
        <AvatarFallback className="text-[8px] bg-brand/10 text-brand">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className={`${textSize} font-medium truncate`}>{name}</span>
      <TrustTierDot pubkey={pubkey} />
      {isOP && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 shrink-0">OP</span>
      )}
      <span className="text-[10px] text-muted-foreground/40 shrink-0">
        {formatDistanceToNow(createdAt * 1000, { addSuffix: true })}
      </span>
    </div>
  );
}

function createReactionAccumulator() {
  const latestByUserTarget = new Map<string, NostrEvent>();

  function processReaction(e: NostrEvent): Map<string, number> | null {
    const target = e.tags.find((t) => t[0] === "e")?.[1];
    if (!target) return null;

    const key = `${e.pubkey}:${target}`;
    const existing = latestByUserTarget.get(key);
    if (existing && existing.created_at >= e.created_at) return null;
    latestByUserTarget.set(key, e);

    return recompute();
  }

  function recompute(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const [, evt] of latestByUserTarget) {
      const target = evt.tags.find((t) => t[0] === "e")?.[1];
      if (!target) continue;
      const val = evt.content === "-" ? -1 : 1;
      totals.set(target, (totals.get(target) || 0) + val);
    }
    return totals;
  }

  return { processReaction };
}

function useVoteState(eventId: string, relayUrl: string, targetPubkey?: string, onVoteFailed?: () => void) {
  const { pubkey, signer } = useNostrAuth();
  const [userVote, setUserVote] = useState<"up" | "down" | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!pubkey) { setUserVote(null); return; }
    setUserVote(null);
    let closed = false;
    let latest: NostrEvent | null = null;
    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_REACTION], authors: [pubkey], "#e": [eventId], limit: 5 },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          if (!latest || e.created_at > latest.created_at) latest = e;
        },
        oneose() {
          if (closed) return;
          closed = true;
          sub.close();
          clearTimeout(timer);
          if (latest) setUserVote(latest.content === "-" ? "down" : "up");
        } },
    );
    const timer = setTimeout(() => { if (!closed) { closed = true; sub.close(); } }, 4000);
    return () => { closed = true; sub.close(); clearTimeout(timer); };
  }, [pubkey, eventId, relayUrl]);

  const castVote = useCallback(async (direction: "up" | "down") => {
    if (!pubkey || voting) return;
    if (userVote === direction) return;
    const prevVote = userVote;
    setVoting(true);
    // Optimistic: fill the arrow immediately, then sign + publish in the
    // background; revert if the signer is unavailable or the relay rejects.
    setUserVote(direction);
    try {
      const reactionContent = direction === "up" ? "+" : "-";
      const tags: string[][] = [["e", eventId]];
      if (targetPubkey) tags.push(["p", targetPubkey]);
      if (classifyRelayUrl(relayUrl) === "private") tags.push(["-"]);
      const eventTemplate = {
        kind: KIND_REACTION,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: reactionContent };
      const signerToUse = signer || (window as any).nostr;
      if (!signerToUse) { setUserVote(prevVote); return; }
      const signed = await withSignerTimeout(signerToUse.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (!signed) { setUserVote(prevVote); return; }
      const ok = await publishEvent(signed, [relayUrl], undefined, true, true);
      if (!ok) {
        setUserVote(prevVote);
        onVoteFailed?.();
      }
    } catch {
      setUserVote(prevVote);
    } finally {
      setVoting(false);
    }
  }, [eventId, relayUrl, pubkey, userVote, voting, targetPubkey]);

  return { userVote, voting, castVote };
}

function useRelayReadiness(relayUrl: string, authRequired?: boolean) {
  const [authStatus, setAuthStatus] = useState(() => getAuthStatus(relayUrl).status);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    setAuthStatus(getAuthStatus(relayUrl).status);
    return onAuthChange(() => {
      setAuthStatus(getAuthStatus(relayUrl).status);
    });
  }, [relayUrl]);

  const baseConnecting = !!authRequired && (authStatus === "none" || authStatus === "challenged" || authStatus === "authenticating");

  // No-access guard: a private relay that never authenticates us (we're simply not on
  // its allowlist) would otherwise spin on "Authenticating" forever. Give the handshake
  // a window, then treat it as denied so the UI resolves to a clear members-only state.
  useEffect(() => {
    if (!baseConnecting) return;
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(t);
  }, [baseConnecting, relayUrl, authStatus]);

  useEffect(() => { if (authStatus === "authenticated") setTimedOut(false); }, [authStatus]);

  const ready = !authRequired || authStatus === "authenticated";
  const connecting = baseConnecting && !timedOut;
  const failed = !!authRequired && (authStatus === "failed" || timedOut);

  let statusLabel = "";
  if (connecting) statusLabel = "Connecting to relay…";
  else if (failed) statusLabel = "Relay auth failed";

  return { ready, connecting, failed, statusLabel, authStatus };
}

type WaveSortMode = "active" | "newest" | "oldest" | "comments" | "reactions";

function WavePostCard({
  topic,
  commentCount,
  reactionCount,
  lastActivity,
  onClick,
  isPinned,
  onBan,
  relayUrl }: {
  topic: NostrEvent;
  commentCount: number;
  reactionCount: number;
  lastActivity?: number;
  onClick: () => void;
  isPinned?: boolean;
  onBan?: (eventId: string) => void;
  relayUrl: string;
}) {
  const title = topic.tags.find((t) => t[0] === "title")?.[1] || topic.content.slice(0, 80) || "Untitled";
  const topicTags = topic.tags.filter((t) => t[0] === "t").map((t) => t[1]).filter(Boolean);
  const thumbnailUrl = useMemo(() => getFirstImageUrl(topic.content, topic.tags), [topic.content, topic.tags]);
  const { toast } = useToast();
  const { userVote, castVote } = useVoteState(topic.id, relayUrl, topic.pubkey, () => {
    toast({ title: "Vote failed", description: "The relay did not accept your vote.", variant: "destructive" });
  });
  const bodyPreview = useMemo(() => {
    const text = topic.content.replace(/https?:\/\/[^\s]+/g, "").trim();
    if (text.length > 200) return text.slice(0, 200) + "...";
    return text;
  }, [topic.content]);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${window.location.origin}/outposts/${encodeURIComponent(relayUrl)}?wave=${topic.id}`);
    toast({ title: "Link copied" });
  };

  return (
    <div
      className={`group flex bg-black/[0.02] dark:bg-white/[0.03] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.1] dark:hover:border-white/[0.1] rounded-xl transition-all cursor-pointer overflow-hidden ${isPinned ? "border-brand/20" : ""}`}
      onClick={onClick}
      data-testid={`wave-post-${topic.id}`}
    >
      {/* Reddit-style vertical vote rail */}
      <div className="flex flex-col items-center gap-0.5 shrink-0 px-1 sm:px-1.5 py-2.5 bg-black/[0.025] dark:bg-white/[0.02] border-r border-black/[0.05] dark:border-white/[0.05]">
        <button
          onClick={(e) => { e.stopPropagation(); castVote("up"); }}
          className={`p-1.5 sm:p-1 rounded-md transition-colors hover:bg-orange-500/10 active:bg-orange-500/20 ${userVote === "up" ? "text-orange-500 dark:text-orange-400" : "text-muted-foreground/45 hover:text-orange-500/80"}`}
          aria-label="Upvote"
          data-testid={`wave-upvote-${topic.id}`}
        >
          <ArrowBigUp className={`w-5 h-5 ${userVote === "up" ? "fill-orange-500 dark:fill-orange-400" : ""}`} />
        </button>
        <span className={`text-[11px] font-bold tabular-nums text-center min-w-[20px] ${userVote === "up" ? "text-orange-500 dark:text-orange-400" : userVote === "down" ? "text-blue-600 dark:text-blue-400" : "text-foreground/70"}`}>
          {reactionCount || 0}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); castVote("down"); }}
          className={`p-1.5 sm:p-1 rounded-md transition-colors hover:bg-blue-500/10 active:bg-blue-500/20 ${userVote === "down" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground/45 hover:text-blue-500/80"}`}
          aria-label="Downvote"
          data-testid={`wave-downvote-${topic.id}`}
        >
          <ArrowBigDown className={`w-5 h-5 ${userVote === "down" ? "fill-blue-600 dark:fill-blue-400" : ""}`} />
        </button>
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0 p-3 sm:p-3.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[11px]">
            {isPinned && <Pin className="w-3 h-3 text-brand shrink-0 rotate-45" />}
            {topicTags.length > 0 && (
              <span className="shrink-0 rounded-full bg-brand/10 dark:bg-brand/15 text-brand/80 px-1.5 py-0.5 text-[10px] font-medium">
                #{topicTags[0]}
              </span>
            )}
            <span className="text-foreground/25 shrink-0">·</span>
            <WaveAuthorLine pubkey={topic.pubkey} createdAt={topic.created_at} size="sm" />
          </div>
          {onBan && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground/30 hover:text-red-600 dark:hover:text-red-400 shrink-0 reveal-on-hover touch-target"
              aria-label="Remove from relay"
              title="Remove from relay"
              onClick={(e) => { e.stopPropagation(); onBan(topic.id); }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>

        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm sm:text-base font-bold leading-snug line-clamp-2 mb-1 text-foreground/90">{title}</h3>
            {bodyPreview && (
              <p className="text-xs text-foreground/50 dark:text-foreground/40 leading-relaxed line-clamp-3">{bodyPreview}</p>
            )}
          </div>
          {thumbnailUrl && (
            <div className="shrink-0 w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-lg overflow-hidden bg-muted/30">
              <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 pt-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-muted-foreground/55 hover:text-foreground/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">{commentCount}</span>
            <span className="text-[11px] font-medium hidden sm:inline">Comments</span>
          </button>

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-muted-foreground/55 hover:text-foreground/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">Share</span>
          </button>

          {lastActivity && lastActivity !== topic.created_at && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/35 shrink-0">
              <Clock className="w-2.5 h-2.5" />
              {formatDistanceToNow(lastActivity * 1000, { addSuffix: true })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TagFilterPills({
  tags,
  selected,
  onSelect }: {
  tags: string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
      <button
        onClick={() => onSelect(null)}
        className={`shrink-0 px-3 py-1.5 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-[10px] font-medium transition-colors active:scale-95 ${ selected === null ? "bg-accent text-accent-foreground dark:text-brand border border-brand/20" : "bg-black/[0.03] dark:bg-white/[0.04] text-muted-foreground/60 border border-black/[0.06] dark:border-white/[0.06] hover:text-muted-foreground/90" }`}
      >
        All
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onSelect(selected === tag ? null : tag)}
          className={`shrink-0 px-3 py-1.5 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-[10px] font-medium transition-colors active:scale-95 ${ selected === tag ? "bg-accent text-accent-foreground dark:text-brand border border-brand/20" : "bg-black/[0.03] dark:bg-white/[0.04] text-muted-foreground/60 border border-black/[0.06] dark:border-white/[0.06] hover:text-muted-foreground/90" }`}
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}

const WAVE_SORT_OPTIONS: { value: WaveSortMode; label: string; icon: typeof Flame }[] = [
  { value: "active", label: "Hot", icon: Flame },
  { value: "newest", label: "New", icon: Clock },
  { value: "reactions", label: "Top", icon: TrendingUp },
  { value: "comments", label: "Most Comments", icon: MessageSquare },
  { value: "oldest", label: "Oldest", icon: Clock },
];

function WaveSortDropdown({ value, onChange }: { value: WaveSortMode; onChange: (v: WaveSortMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = WAVE_SORT_OPTIONS.find((o) => o.value === value) || WAVE_SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] sm:text-[10px] font-medium transition-colors active:scale-95 ${ value !== "active" ? "bg-accent text-accent-foreground dark:text-brand border border-brand/20" : "bg-black/[0.03] dark:bg-white/[0.04] text-muted-foreground/60 border border-black/[0.06] dark:border-white/[0.06] hover:text-muted-foreground/90" }`}
      >
        <ArrowUpDown className="w-3 h-3" />
        <span className="hidden sm:inline">{current.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-black/[0.06] dark:border-white/[0.06] bg-background/95 backdrop-blur-xl shadow-lg py-1">
          {WAVE_SORT_OPTIONS.map((opt) => {
            const OptIcon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] transition-colors ${
                  value === opt.value
                    ? "text-accent-foreground dark:text-brand bg-accent"
                    : "text-muted-foreground/70 hover:text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                }`}
              >
                <OptIcon className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WaveCreateForm({
  relayUrl,
  existingTags,
  onCreated,
  onCancel }: {
  relayUrl: string;
  existingTags: string[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const isPrivateRelay = classifyRelayUrl(relayUrl) === "private";
  const { ready: relayReady, statusLabel: relayStatusLabel } = useRelayReadiness(relayUrl, isPrivateRelay);

  const addTag = (tag: string) => {
    const cleaned = tag.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
    if (cleaned && !selectedTags.includes(cleaned)) {
      setSelectedTags((prev) => [...prev, cleaned]);
    }
    setTagInput("");
  };

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim() || !pubkey) return;
    setPublishing(true);
    try {
      const tags: string[][] = [
        ["title", title.trim()],
        ...selectedTags.map((t) => ["t", t]),
        ...clientTags(),
      ];
      if (classifyRelayUrl(relayUrl) === "private") tags.push(["-"]);
      const eventTemplate = {
        kind: KIND_TOPIC,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: content.trim() };
      // Accept the in-app local-key signer too — not just a browser extension —
      // otherwise PWA / created / imported accounts wrongly get "Sign in required".
      const signerToUse = signer || (window as any).nostr;
      if (!signerToUse) {
        toast({ title: "Sign in required", description: "Sign in to post." });
        return;
      }
      const signed = await withSignerTimeout(signerToUse.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (!signed) return;
      const ok = await publishEvent(signed, [relayUrl], undefined, true, true);
      if (!ok) {
        toast({ title: "Relay rejected your post", description: "The community relay did not accept your wave. You may not be authenticated.", variant: "destructive" });
        return;
      }
      toast({ title: "Wave posted" });
      onCreated();
    } catch {
      toast({ title: "Failed to post", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Card className="glass-card p-4 space-y-3">
      <h3 className="text-xs font-brand tracking-wider uppercase text-brand">New discussion</h3>
      <div className="flex items-center gap-1.5">
        <Lock className="w-3 h-3 text-emerald-600/70 dark:text-emerald-400/70" />
        <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
          Publishing to {relayUrl.replace(/^wss?:\/\//, "")} only
        </p>
      </div>
      {!relayReady && relayStatusLabel && (
        <div className="flex items-center gap-1.5">
          <RelayOutpostInlineLoader className="w-3 h-3 text-amber-600/60 dark:text-amber-400/60" />
          <span className="text-[10px] text-amber-600/60 dark:text-amber-400/60">{relayStatusLabel}</span>
        </div>
      )}
      <Input
        placeholder="Wave title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-base sm:text-sm bg-black/[0.03] dark:bg-white/[0.03] border-border/20"
        maxLength={200}
      />
      <Textarea
        placeholder="Write your post..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[80px] text-base sm:text-sm bg-black/[0.03] dark:bg-white/[0.03] border-border/20 resize-none"
      />
      <div className="space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {selectedTags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="text-[9px] h-5 px-1.5 border-brand/20 text-brand/70 bg-brand/5 cursor-pointer hover:border-red-500/30 hover:text-red-600 dark:hover:text-red-400"
              onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
            >
              #{tag} <X className="w-2 h-2 ml-0.5" />
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Hash className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
            <Input
              placeholder="Add tag..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              className="pl-7 h-8 text-base sm:text-[11px] bg-black/[0.03] dark:bg-white/[0.03] border-border/20"
            />
          </div>
        </div>
        {existingTags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <span className="text-[9px] text-muted-foreground/40 mr-1 self-center">Existing:</span>
            {existingTags.slice(0, 10).map((tag) => (
              <button
                key={tag}
                onClick={() => addTag(tag)}
                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${ selectedTags.includes(tag) ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-border/20 text-muted-foreground/50 hover:text-muted-foreground/80" }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs h-7">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!title.trim() || !content.trim() || publishing || !pubkey || !relayReady}
          className="text-xs h-7"
        >
          {publishing ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Send className="w-3 h-3 mr-1" />}
          Post Wave
        </Button>
      </div>
    </Card>
  );
}

let commentMediaIdCounter = 0;

interface CommentMediaAttachment {
  id: string;
  url: string;
  type: "image";
}

function CommentComposer({
  rootEvent,
  parentEvent,
  relayUrl,
  onCommented,
  onCancel,
  compact,
  authRequired,
  autoFocus }: {
  rootEvent: NostrEvent;
  parentEvent: NostrEvent | null;
  relayUrl: string;
  onCommented: (event?: NostrEvent) => void;
  onCancel?: () => void;
  compact?: boolean;
  authRequired?: boolean;
  autoFocus?: boolean;
}) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [mediaAttachments, setMediaAttachments] = useState<CommentMediaAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Focus the field when the composer opens in place (Reddit-style expand).
  useEffect(() => {
    if (autoFocus) {
      const id = setTimeout(() => textareaRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [autoFocus]);
  const { mentionActive, mentionQuery, detectMention, insertMention, closeMention, resolveContent, getMentionTags, clearMentionTags } = useMention();
  const { trackEmoji, getEmojiTags, clearEmojiTags } = useEmojiTags();
  const { emojis: customEmojis } = useCustomEmojis();
  const composeEmojiMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of customEmojis) map.set(e.shortcode, e.url);
    return map;
  }, [customEmojis]);

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

  const handleGifSelect = useCallback((url: string) => {
    setMediaAttachments((prev) => [...prev, {
      id: `cmedia-${++commentMediaIdCounter}`,
      url,
      type: "image" as const }]);
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      validateFile(file, true);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported file.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    setUploadStatus("Preparing...");
    try {
      const result = await uploadToNostrBuild(file, setUploadStatus, signer);
      setMediaAttachments((prev) => [...prev, {
        id: `cmedia-${++commentMediaIdCounter}`,
        url: result.url,
        type: "image" as const }]);
      toast({ title: "Uploaded", description: result.metadataStripped ? "Image attached. Location data removed." : "Image attached." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload file.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [signer, toast]);

  const removeMediaAttachment = useCallback((id: string) => {
    setMediaAttachments((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleSubmit = async () => {
    if (!pubkey) return;
    setPublishing(true);
    try {
      let publishContent = resolveContent(content).trim();
      for (const media of mediaAttachments) {
        const separator = publishContent ? "\n" : "";
        publishContent = publishContent + separator + media.url;
      }

      if (!publishContent) {
        toast({ title: "Nothing to post" });
        setPublishing(false);
        return;
      }

      const commentTags = buildNip22CommentTags(rootEvent, parentEvent, relayUrl);
      const mentionTags = getMentionTags(content);
      const emojiTags = getEmojiTags(content);
      const tags = [...commentTags, ...mentionTags, ...emojiTags];
      if (authRequired) tags.push(["-"]);

      const eventTemplate = {
        kind: KIND_COMMENT,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: publishContent };
      // Accept the in-app local-key signer too — not just a browser extension —
      // so signed-in PWA / local-key members can reply (was: "Sign in required").
      const signerToUse = signer || (window as any).nostr;
      if (!signerToUse) {
        toast({ title: "Sign in required", description: "Sign in to reply." });
        return;
      }
      const signed = await withSignerTimeout(signerToUse.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (!signed) return;
      const ok = await publishEvent(signed, [relayUrl], undefined, true, true);
      if (!ok) {
        toast({ title: "Relay rejected your reply", description: "The community relay did not accept your comment. You may not be authenticated.", variant: "destructive" });
        return;
      }
      setContent("");
      setMediaAttachments([]);
      clearMentionTags();
      clearEmojiTags();
      onCommented(signed as NostrEvent);
    } catch {
      toast({ title: "Failed to post comment", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const hasContent = (() => {
    if (mediaAttachments.length > 0) return true;
    const visible = content.replace(/[\u200B\u200C]/g, "").trim();
    return visible.length > 0;
  })();

  const { ready: relayReady, statusLabel: relayStatusLabel } = useRelayReadiness(relayUrl, authRequired);

  if (!pubkey) return null;

  return (
    <div className={`${compact ? "" : "mt-3"}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Lock className="w-2.5 h-2.5 text-emerald-600/60 dark:text-emerald-400/60" />
        <span className="text-[9px] text-emerald-600/60 dark:text-emerald-400/60">
          {relayUrl.replace(/^wss?:\/\//, "")} only
        </span>
      </div>
      {!relayReady && relayStatusLabel && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <RelayOutpostInlineLoader className="w-2.5 h-2.5 text-amber-600/60 dark:text-amber-400/60" />
          <span className="text-[9px] text-amber-600/60 dark:text-amber-400/60">{relayStatusLabel}</span>
        </div>
      )}
      <div className="relative">
        <MentionSearch
          query={mentionQuery}
          visible={mentionActive}
          onSelect={handleMentionSelect}
          onClose={closeMention}
          position="above"
        />
        <MentionHighlightTextarea
          ref={textareaRef}
          placeholder={parentEvent ? "Reply..." : "Add a comment..."}
          value={content}
          onChange={handleTextChange}
          emojiMap={composeEmojiMap}
          className={`w-full text-xs bg-black/[0.03] dark:bg-white/[0.03] border border-border/20 rounded-md resize-none px-3 py-2 ${compact ? "min-h-[40px]" : "min-h-[60px]"}`}
          onKeyDown={(e) => {
            if (mentionActive) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
      </div>

      {mediaAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {mediaAttachments.map((media) => (
            <div key={media.id} className="relative group w-14 h-14 rounded-md overflow-hidden border border-border/20 bg-black/[0.03] dark:bg-white/[0.03]">
              <img src={media.url} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeMediaAttachment(media.id)}
                // reveal-on-hover WITHOUT touch-target: this badge sits on a
                // 56px thumbnail, and a 44px minimum would put a black disc
                // over most of the image it removes. Visibility was the defect;
                // inflating the target here would trade it for a worse one.
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 flex items-center justify-center reveal-on-hover cursor-pointer"
                aria-label="Remove this image"
                title="Remove image"
              >
                <X className="w-2.5 h-2.5 text-white" />
              </button>
            </div>
          ))}
          {isUploading && (
            <div className="w-14 h-14 rounded-md border border-border/20 bg-black/[0.03] dark:bg-white/[0.03] flex items-center justify-center">
              <RelayOutpostInlineLoader className="w-4 h-4 text-foreground/40" />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-0.5">
          <ComposeEmojiPicker
            onInsert={handleEmojiInsert}
            onGifSelect={handleGifSelect}
            disabled={publishing}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={publishing || isUploading}
            className="w-8 h-8 flex items-center justify-center rounded-md text-brand/60 hover:text-brand/90 hover:bg-brand/10 dark:hover:bg-brand/15 transition-colors cursor-pointer disabled:opacity-40"
          >
            <ImagePlus className="w-[18px] h-[18px]" />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />
          {isUploading && (
            <span className="text-[10px] text-foreground/30 ml-1">{uploadStatus}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 px-2 text-xs">
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!hasContent || publishing || isUploading || !relayReady}
            className="h-7 px-2"
          >
            {publishing ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Send className="w-3 h-3" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TopicTrustBar({ comments, excludedTiers, onFilterChange }: {
  comments: NostrEvent[];
  excludedTiers: Set<string>;
  onFilterChange: (tiers: Set<string>) => void;
}) {
  const { scores, flaggedPubkeys, getAuthorTier, requestScoresBulk, wotEnabled, wotReady } = useGrapeRankScores();

  const uniquePubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of comments) set.add(c.pubkey);
    return Array.from(set);
  }, [comments]);

  useEffect(() => {
    if (!scores) return;
    const missing = uniquePubkeys.filter(pk => !scores.has(pk));
    if (missing.length > 0) requestScoresBulk(missing);
  }, [uniquePubkeys, scores, requestScoresBulk]);

  const tierCounts = useMemo(() => {
    if (!scores || uniquePubkeys.length === 0) return null;
    let strong = 0, moderate = 0, low = 0, weak = 0, unverified = 0, flagged = 0;
    for (const pk of uniquePubkeys) {
      const isFlagged = flaggedPubkeys?.has(pk) ?? false;
      if (isFlagged) { flagged++; continue; }
      const tier = getAuthorTier(pk);
      if (tier === "strong") strong++;
      else if (tier === "moderate") moderate++;
      else if (tier === "low") low++;
      else if (tier === "weak") weak++;
      else unverified++;
    }
    return { strong, moderate, low, weak, unverified, flagged, total: uniquePubkeys.length };
  }, [uniquePubkeys, scores, flaggedPubkeys, getAuthorTier]);

  // wotReady: an empty scores map would count EVERY author as "Unverified" and
  // render a confident-looking 100% Unverified bar during the new-user
  // calculation gap. Hide until the observer's calculation has completed.
  if (!wotEnabled || !wotReady || !tierCounts || tierCounts.total < 2) return null;

  const { total } = tierCounts;
  const segments = [
    { count: tierCounts.strong, color: "bg-emerald-500", label: "Highly Trusted", tierId: "strong" },
    { count: tierCounts.moderate, color: "bg-blue-500", label: "Trusted", tierId: "moderate" },
    { count: tierCounts.low, color: "bg-cyan-500", label: "Neutral", tierId: "low" },
    { count: tierCounts.weak, color: "bg-amber-500", label: "Low Trust", tierId: "weak" },
    { count: tierCounts.unverified, color: "bg-slate-500/60 dark:bg-slate-400/50", label: "Unverified", tierId: "none" },
    { count: tierCounts.flagged, color: "bg-red-600", label: "Flagged", tierId: "flagged" },
  ].filter(s => s.count > 0);

  const hasActiveFilter = excludedTiers.size > 0;
  const toggleTier = (tierId: string) => {
    const next = new Set(excludedTiers);
    if (next.has(tierId)) next.delete(tierId);
    else next.add(tierId);
    onFilterChange(next);
  };
  const filteredCount = hasActiveFilter
    ? segments.reduce((sum, seg) => sum + (excludedTiers.has(seg.tierId) ? 0 : seg.count), 0)
    : total;

  return (
    <Card className="glass-card px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full overflow-hidden flex gap-px bg-slate-500/15 dark:bg-slate-400/10">
          {segments.map((seg, i) => {
            const excluded = excludedTiers.has(seg.tierId);
            return (
              <div
                key={seg.label}
                className={`${seg.color} transition-all duration-300 ${i === 0 ? "rounded-l-full" : ""} ${i === segments.length - 1 ? "rounded-r-full" : ""} ${excluded ? "opacity-20" : ""}`}
                style={{ width: `${(seg.count / total) * 100}%`, minWidth: seg.count > 0 ? "4px" : 0 }}
                title={`${seg.label}: ${seg.count}`}
              />
            );
          })}
        </div>
        <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums font-medium">
          {hasActiveFilter ? `${filteredCount}/${total}` : total} authors
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {segments.map((seg) => {
          const excluded = excludedTiers.has(seg.tierId);
          return (
            <button
              key={seg.label}
              onClick={() => toggleTier(seg.tierId)}
              className={`flex items-center gap-1 text-[10px] transition-all duration-200 cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] ${excluded ? "opacity-35 line-through decoration-1" : "text-foreground/70 dark:text-foreground/60"}`}
            >
              <TrustTierGlyph tier={seg.tierId as SignalTier} size="w-1.5 h-1.5" decorative className={excluded ? "opacity-40" : ""} />
              <span className="font-medium">{seg.label}</span> <span className="tabular-nums">{seg.count}</span>
            </button>
          );
        })}
        {hasActiveFilter && (
          <button
            onClick={() => onFilterChange(new Set())}
            className="text-[10px] text-brand/70 hover:text-brand transition-colors ml-1 cursor-pointer"
          >
            Show all
          </button>
        )}
      </div>
    </Card>
  );
}

interface CommentNode {
  event: NostrEvent;
  children: CommentNode[];
  reactionCount: number;
}

function buildCommentTree(comments: NostrEvent[], rootId: string, reactionCounts: Map<string, number>): CommentNode[] {
  const commentIds = new Set(comments.map((c) => c.id));
  commentIds.add(rootId);
  const byParent = new Map<string, NostrEvent[]>();
  for (const c of comments) {
    const parentTag = c.tags.find((t) => t[0] === "e");
    let parentId = parentTag ? parentTag[1] : rootId;
    if (!commentIds.has(parentId)) parentId = rootId;
    const arr = byParent.get(parentId) || [];
    arr.push(c);
    byParent.set(parentId, arr);
  }

  function buildNodes(parentId: string): CommentNode[] {
    const children = byParent.get(parentId) || [];
    children.sort((a, b) => a.created_at - b.created_at);
    return children.map((c) => ({
      event: c,
      children: buildNodes(c.id),
      reactionCount: reactionCounts.get(c.id) || 0 }));
  }

  return buildNodes(rootId);
}

function CommentTreeItem({
  node,
  depth,
  rootEvent,
  relayUrl,
  onCommented,
  onBan,
  opPubkey,
  authRequired }: {
  node: CommentNode;
  depth: number;
  rootEvent: NostrEvent;
  relayUrl: string;
  onCommented: (event?: NostrEvent) => void;
  onBan?: (eventId: string) => void;
  opPubkey: string;
  authRequired?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const { toast } = useToast();
  const { userVote, castVote } = useVoteState(node.event.id, relayUrl, node.event.pubkey, () => {
    toast({ title: "Vote failed", description: "The relay did not accept your vote.", variant: "destructive" });
  });

  const totalDescendants = useMemo(() => {
    function count(n: CommentNode): number {
      let c = 0;
      for (const child of n.children) c += 1 + count(child);
      return c;
    }
    return count(node);
  }, [node]);

  const borderColors = [
    "border-brand/25",
    "border-blue-500/25",
    "border-green-500/25",
    "border-orange-500/25",
    "border-pink-500/25",
    "border-cyan-500/25",
    "border-yellow-500/25",
  ];
  const borderColor = borderColors[depth % borderColors.length];

  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const indent = depth > 0 ? (isMobile ? Math.min(depth * 4, 16) : Math.min(depth * 10, 40)) : 0;

  return (
    <div
      style={{ marginLeft: indent }}
      className={`${depth > 0 ? `border-l-2 ${borderColor} pl-1.5 sm:pl-3` : ""} mt-2 min-w-0`}
    >
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <WaveAuthorLine pubkey={node.event.pubkey} createdAt={node.event.created_at} isOP={node.event.pubkey === opPubkey} size="sm" />
          {node.children.length > 0 && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors ml-auto shrink-0 p-1.5 -m-1.5"
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        {!collapsed && (
          <>
            <OutpostContentRenderer event={node.event} compact />
            <div className="flex items-center gap-1.5 sm:gap-1">
              <div className="flex items-center rounded-full">
                <button
                  onClick={() => castVote("up")}
                  className={`p-1.5 sm:p-1 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05] active:bg-black/[0.08] dark:active:bg-white/[0.08] rounded-l-full ${userVote === "up" ? "text-orange-500 dark:text-orange-400" : "text-muted-foreground/30 hover:text-muted-foreground/60"}`}
                >
                  <ArrowBigUp className={`w-3.5 h-3.5 ${userVote === "up" ? "fill-orange-500 dark:fill-orange-400" : ""}`} />
                </button>
                {node.reactionCount > 0 && (
                  <span className="text-[10px] font-medium text-muted-foreground/50 px-0.5">{node.reactionCount}</span>
                )}
                <button
                  onClick={() => castVote("down")}
                  className={`p-1.5 sm:p-1 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05] active:bg-black/[0.08] dark:active:bg-white/[0.08] rounded-r-full ${userVote === "down" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground/30 hover:text-muted-foreground/60"}`}
                >
                  <ArrowBigDown className={`w-3.5 h-3.5 ${userVote === "down" ? "fill-blue-600 dark:fill-blue-400" : ""}`} />
                </button>
              </div>
              <button
                onClick={() => setShowReply(!showReply)}
                className="flex items-center gap-1 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-full text-[10px] text-muted-foreground/40 hover:text-brand hover:bg-black/[0.03] dark:hover:bg-white/[0.03] active:bg-black/[0.06] dark:active:bg-white/[0.06] transition-colors"
              >
                <MessageSquare className="w-3 h-3" />
                Reply
              </button>
              {onBan && (
                <button
                  onClick={() => onBan(node.event.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-full text-[10px] text-muted-foreground/30 hover:text-red-600 dark:hover:text-red-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] active:bg-black/[0.06] dark:active:bg-white/[0.06] transition-colors"
                  title="Remove from relay"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
            {showReply && (
              <CommentComposer
                rootEvent={rootEvent}
                parentEvent={node.event}
                relayUrl={relayUrl}
                onCommented={(ev) => {
                  setShowReply(false);
                  onCommented(ev);
                }}
                onCancel={() => setShowReply(false)}
                compact
                authRequired={authRequired}
              />
            )}
          </>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="text-[10px] text-blue-600/70 dark:text-blue-400/70 hover:text-blue-700 dark:hover:text-blue-400 transition-colors py-1"
          >
            {totalDescendants} more {totalDescendants === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>
      {!collapsed &&
        node.children.map((child) => (
          <CommentTreeItem
            key={child.event.id}
            node={child}
            depth={depth + 1}
            rootEvent={rootEvent}
            relayUrl={relayUrl}
            onCommented={onCommented}
            onBan={onBan}
            opPubkey={opPubkey}
            authRequired={authRequired}
          />
        ))}
    </div>
  );
}

function TopicThreadView({
  topic,
  relayUrl,
  onBack,
  canModerate = false,
  authRequired }: {
  topic: NostrEvent;
  relayUrl: string;
  onBack: () => void;
  canModerate?: boolean;
  authRequired?: boolean;
}) {
  const [comments, setComments] = useState<NostrEvent[]>([]);
  const [reactions, setReactions] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Shared by the live subscription and optimistic inserts so a freshly-posted
  // comment shows instantly (and dedupes when the relay later echoes it).
  const commentMapRef = useRef<Map<string, NostrEvent>>(new Map());
  const [excludedTiers, setExcludedTiers] = useState<Set<string>>(new Set());
  const { getAuthorTier: getCommentAuthorTier, flaggedPubkeys: commentFlaggedPubkeys } = useGrapeRankScores();

  const title = topic.tags.find((t) => t[0] === "title")?.[1] || topic.content.slice(0, 80) || "Untitled";
  const topicTags = topic.tags.filter((t) => t[0] === "t").map((t) => t[1]).filter(Boolean);
  const topicReactionCount = reactions.get(topic.id) || 0;

  const fetchComments = useCallback(() => {
    const commentMap = commentMapRef.current;
    commentMap.clear();
    const accumulator = createReactionAccumulator();
    let unmounted = false;
    let eoseReceived = false;

    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_COMMENT], "#E": [topic.id] },
      {
        onevent(e: NostrEvent) {
          if (unmounted) return;
          if (!commentMap.has(e.id)) {
            commentMap.set(e.id, e);
            eventStore.add(e);
            fetchProfilesCached([e.pubkey]);
            if (eoseReceived) {
              setComments(Array.from(commentMap.values()));
            }
          }
        },
        oneose() {
          if (unmounted) return;
          eoseReceived = true;
          setComments(Array.from(commentMap.values()));
          setLoading(false);
        } },
    );

    const reactionSub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_REACTION], "#e": [topic.id] },
      {
        onevent(e: NostrEvent) {
          if (unmounted) return;
          const updated = accumulator.processReaction(e);
          if (updated) {
            setReactions((prev) => {
              const next = new Map(prev);
              for (const [k, v] of updated) next.set(k, v);
              return next;
            });
          }
        },
        oneose() {
          reactionSub.close();
        } },
    );

    const timer = setTimeout(() => {
      if (!eoseReceived && !unmounted) {
        eoseReceived = true;
        setComments(Array.from(commentMap.values()));
        setLoading(false);
      }
    }, 10000);

    return () => {
      unmounted = true;
      sub.close();
      reactionSub.close();
      clearTimeout(timer);
    };
  }, [relayUrl, topic.id]);

  useEffect(() => {
    setComments([]);
    setReactions(new Map());
    setLoading(true);
    return fetchComments();
  }, [fetchComments, refreshKey]);

  const handleCommented = useCallback((newEvent?: NostrEvent) => {
    // Show the just-posted comment immediately. Re-querying the relay here misses
    // it on index-delayed backends (e.g. Ditto/OpenSearch), which is why it only
    // appeared after a manual refresh. The shared map dedupes the relay's echo.
    if (newEvent) {
      if (commentMapRef.current.has(newEvent.id)) return;
      commentMapRef.current.set(newEvent.id, newEvent);
      eventStore.add(newEvent);
      fetchProfilesCached([newEvent.pubkey]);
      setComments(Array.from(commentMapRef.current.values()));
      return;
    }
    setRefreshKey((k) => k + 1);
  }, []);

  const { toast } = useToast();
  const handleBanCommentLocal = useCallback(async (eventId: string) => {
    const res = await banEvent(relayUrl, eventId, "Removed by moderator");
    if (res.error) {
      toast({ title: "Failed to remove comment", description: res.error, variant: "destructive" });
    } else {
      setComments(prev => prev.filter(c => c.id !== eventId));
      toast({ title: "Comment removed from relay" });
    }
  }, [relayUrl, toast]);

  const tree = useMemo(
    () => buildCommentTree(comments, topic.id, reactions),
    [comments, topic.id, reactions],
  );

  const filteredTree = useMemo(() => {
    if (excludedTiers.size === 0) return tree;
    function filterNodes(nodes: CommentNode[]): CommentNode[] {
      const result: CommentNode[] = [];
      for (const node of nodes) {
        const isFlagged = commentFlaggedPubkeys?.has(node.event.pubkey) ?? false;
        const effectiveTier = isFlagged ? "flagged" : getCommentAuthorTier(node.event.pubkey);
        if (excludedTiers.has(effectiveTier)) {
          result.push(...filterNodes(node.children));
        } else {
          result.push({ ...node, children: filterNodes(node.children) });
        }
      }
      return result;
    }
    return filterNodes(tree);
  }, [tree, excludedTiers, getCommentAuthorTier, commentFlaggedPubkeys]);

  const filteredCommentCount = useMemo(() => {
    function countNodes(nodes: CommentNode[]): number {
      let c = 0;
      for (const n of nodes) { c += 1 + countNodes(n.children); }
      return c;
    }
    return countNodes(filteredTree);
  }, [filteredTree]);

  useEffect(() => {
    if (comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
      const commentAccum = createReactionAccumulator();
      const rSub = pool.subscribeMany(
        [relayUrl],
        { kinds: [KIND_REACTION], "#e": commentIds },
        {
          onevent(e: NostrEvent) {
            const updated = commentAccum.processReaction(e);
            if (updated) {
              setReactions((prev) => {
                const next = new Map(prev);
                for (const [k, v] of updated) next.set(k, v);
                return next;
              });
            }
          },
          oneose() {
            rSub.close();
          } },
      );
      return () => rSub.close();
    }
  }, [comments, relayUrl]);

  const { toast: threadToast } = useToast();
  const { userVote: postVote, castVote: castPostVote } = useVoteState(topic.id, relayUrl, topic.pubkey, () => {
    threadToast({ title: "Vote failed", description: "The relay did not accept your vote.", variant: "destructive" });
  });
  const [showMainReply, setShowMainReply] = useState(false);

  const handleCopyThreadLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/outposts/${encodeURIComponent(relayUrl)}?wave=${topic.id}`);
    threadToast({ title: "Link copied" });
  };

  return (
    <div className="space-y-3 pb-24 sm:pb-8">
      <div className="flex items-center justify-between gap-2 py-1">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground active:text-muted-foreground transition-colors py-1.5 -my-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to discussions
        </button>
        <button onClick={onBack} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-2 -m-2">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="glass-card border rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 space-y-3">
          {topicTags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {topicTags.map((tag) => (
                <span key={tag} className="text-[10px] text-brand/70">#{tag}</span>
              ))}
            </div>
          )}
          <WaveAuthorLine pubkey={topic.pubkey} createdAt={topic.created_at} size="md" />
          <h2 className="text-base sm:text-lg font-bold leading-snug">{title}</h2>
          <OutpostContentRenderer event={topic} />

          <div className="flex items-center gap-1.5 sm:gap-1 pt-2 border-t border-border/10">
            <div className="flex items-center rounded-full bg-black/[0.03] dark:bg-white/[0.03] border border-border/10">
              <button
                onClick={() => castPostVote("up")}
                className={`p-2 sm:p-1.5 rounded-l-full transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05] active:bg-black/[0.08] dark:active:bg-white/[0.08] ${postVote === "up" ? "text-orange-500 dark:text-orange-400" : "text-muted-foreground/40 hover:text-muted-foreground/70"}`}
              >
                <ArrowBigUp className={`w-4 h-4 ${postVote === "up" ? "fill-orange-500 dark:fill-orange-400" : ""}`} />
              </button>
              <span className="text-[11px] font-medium text-muted-foreground/60 min-w-[20px] text-center px-0.5">
                {topicReactionCount || ""}
              </span>
              <button
                onClick={() => castPostVote("down")}
                className={`p-2 sm:p-1.5 rounded-r-full transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05] active:bg-black/[0.08] dark:active:bg-white/[0.08] ${postVote === "down" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground/40 hover:text-muted-foreground/70"}`}
              >
                <ArrowBigDown className={`w-4 h-4 ${postVote === "down" ? "fill-blue-600 dark:fill-blue-400" : ""}`} />
              </button>
            </div>

            <button className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-full bg-black/[0.03] dark:bg-white/[0.03] border border-border/10 text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] active:bg-black/[0.08] dark:active:bg-white/[0.08] transition-colors">
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium">
                {comments.length}
                {excludedTiers.size > 0 && filteredCommentCount !== comments.length && (
                  <span className="text-brand/60 ml-1">({filteredCommentCount})</span>
                )}
              </span>
            </button>

            <button
              onClick={handleCopyThreadLink}
              className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-full bg-black/[0.03] dark:bg-white/[0.03] border border-border/10 text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] active:bg-black/[0.08] dark:active:bg-white/[0.08] transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium">Share</span>
            </button>
          </div>
        </div>
      </div>

      {!loading && comments.length >= 2 && (
        <TopicTrustBar comments={comments} excludedTiers={excludedTiers} onFilterChange={setExcludedTiers} />
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[80px] gap-2">
          <RelayOutpostInlineLoader className="w-5 h-5" />
          <p className="text-[10px] text-muted-foreground/50">Loading comments...</p>
        </div>
      ) : tree.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-muted-foreground/40">No comments yet. Be the first to reply!</p>
        </div>
      ) : filteredTree.length === 0 && excludedTiers.size > 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-muted-foreground/50">All comments filtered out</p>
          <button
            onClick={() => setExcludedTiers(new Set())}
            className="text-[11px] text-brand/70 hover:text-brand transition-colors mt-1 cursor-pointer"
          >
            Show all comments
          </button>
        </div>
      ) : (
        <div className="space-y-1 overflow-hidden">
          {filteredTree.map((node) => (
            <CommentTreeItem
              key={node.event.id}
              node={node}
              depth={0}
              rootEvent={topic}
              relayUrl={relayUrl}
              onCommented={handleCommented}
              onBan={canModerate ? handleBanCommentLocal : undefined}
              opPubkey={topic.pubkey}
              authRequired={authRequired}
            />
          ))}
        </div>
      )}

      {/* Reddit-style: the bottom "Join the conversation" box expands into the
          composer in place (no jump to a composer elsewhere on the page). In-flow
          at every breakpoint — the old mobile `fixed bottom-0` bar resolved
          against PullToRefresh's transformed ancestor and floated mid-thread. */}
      <div className="mt-2">
        {showMainReply ? (
          <CommentComposer
            rootEvent={topic}
            parentEvent={null}
            relayUrl={relayUrl}
            onCommented={(ev) => { setShowMainReply(false); handleCommented(ev); }}
            onCancel={() => setShowMainReply(false)}
            authRequired={authRequired}
            autoFocus
          />
        ) : (
          <button
            onClick={() => setShowMainReply(true)}
            className="flex w-full items-center gap-3 text-left text-sm text-muted-foreground/45 bg-black/[0.02] dark:bg-white/[0.02] border border-border/10 rounded-xl px-4 py-3 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:border-border/20 active:bg-black/[0.06] dark:active:bg-white/[0.06] transition-colors"
            data-testid="button-join-conversation"
          >
            <MessageSquare className="w-4 h-4 text-muted-foreground/25 shrink-0" />
            Join the conversation...
          </button>
        )}
      </div>
    </div>
  );
}

const KIND_APP_DATA = 30078;
const PINNED_TOPICS_D_TAG = "relay-outpost/pinned-topics";
const APP_DATA_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"];

function TopicsTab({
  relayUrl,
  externalRefreshKey = 0,
  canModerate = false,
  operatorPubkey,
  onThreadOpen,
  authRequired,
  trustFilterEnabled = false,
  isHiddenByTrust,
  onTrustHidden }: {
  relayUrl: string;
  externalRefreshKey?: number;
  canModerate?: boolean;
  operatorPubkey?: string;
  onThreadOpen?: (open: boolean) => void;
  authRequired?: boolean;
  trustFilterEnabled?: boolean;
  isHiddenByTrust?: (pubkey: string) => boolean;
  onTrustHidden?: (count: number) => void;
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [topics, setTopics] = useState<NostrEvent[]>([]);
  const [comments, setComments] = useState<NostrEvent[]>([]);
  const [reactions, setReactions] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<WaveSortMode>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<NostrEvent | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!operatorPubkey) return;
    const sub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [operatorPubkey], "#d": [PINNED_TOPICS_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (Array.isArray(data.pinnedIds)) setPinnedIds(new Set(data.pinnedIds));
          } catch {}
        },
        oneose() { sub.close(); clearTimeout(timer); } },
    );
    const timer = setTimeout(() => { sub.close(); }, 6000);
    return () => { sub.close(); clearTimeout(timer); };
  }, [operatorPubkey, relayUrl]);

  const handleBanTopic = useCallback(async (eventId: string) => {
    const res = await banEvent(relayUrl, eventId, "Removed by moderator");
    if (res.error) {
      toast({ title: "Failed to remove", description: res.error, variant: "destructive" });
    } else {
      setTopics(prev => prev.filter(t => t.id !== eventId));
      setPinnedIds(prev => { const next = new Set(prev); next.delete(eventId); return next; });
      toast({ title: "Wave removed from relay" });
    }
  }, [relayUrl, toast]);

  const fetchTopics = useCallback(() => {
    const topicMap = new Map<string, NostrEvent>();
    const commentMap = new Map<string, NostrEvent>();
    const topicAccum = createReactionAccumulator();
    let unmounted = false;
    let topicEose = false;
    let commentEose = false;
    let commentSub: { close(): void } | null = null;
    let reactionSub: { close(): void } | null = null;
    let commentTimer: ReturnType<typeof setTimeout> | null = null;

    const topicSub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_TOPIC], limit: 100 },
      {
        onevent(e: NostrEvent) {
          if (unmounted) return;
          if (!topicMap.has(e.id)) {
            topicMap.set(e.id, e);
            eventStore.add(e);
            fetchProfilesCached([e.pubkey]);
            if (topicEose) {
              setTopics(Array.from(topicMap.values()));
            }
          }
        },
        oneose() {
          if (unmounted) return;
          topicEose = true;
          const topicList = Array.from(topicMap.values());
          setTopics(topicList);

          if (topicList.length > 0) {
            const topicIds = topicList.map((t) => t.id);
            commentSub = pool.subscribeMany(
              [relayUrl],
              { kinds: [KIND_COMMENT], "#E": topicIds },
              {
                onevent(e: NostrEvent) {
                  if (unmounted) return;
                  if (!commentMap.has(e.id)) {
                    commentMap.set(e.id, e);
                    eventStore.add(e);
                    if (commentEose) {
                      setComments(Array.from(commentMap.values()));
                    }
                  }
                },
                oneose() {
                  commentEose = true;
                  setComments(Array.from(commentMap.values()));
                  setLoading(false);
                } },
            );

            reactionSub = pool.subscribeMany(
              [relayUrl],
              { kinds: [KIND_REACTION], "#e": topicIds },
              {
                onevent(e: NostrEvent) {
                  if (unmounted) return;
                  const updated = topicAccum.processReaction(e);
                  if (updated) {
                    setReactions((prev) => {
                      const next = new Map(prev);
                      for (const [k, v] of updated) next.set(k, v);
                      return next;
                    });
                  }
                },
                oneose() {
                  reactionSub?.close();
                  reactionSub = null;
                } },
            );

            commentTimer = setTimeout(() => {
              if (!commentEose && !unmounted) {
                commentEose = true;
                setComments(Array.from(commentMap.values()));
                setLoading(false);
              }
            }, 8000);
          } else {
            setLoading(false);
          }
        } },
    );

    const timer = setTimeout(() => {
      if (!topicEose && !unmounted) {
        topicEose = true;
        setTopics(Array.from(topicMap.values()));
        setLoading(false);
      }
    }, 10000);

    return () => {
      unmounted = true;
      topicSub.close();
      commentSub?.close();
      reactionSub?.close();
      clearTimeout(timer);
      if (commentTimer) clearTimeout(commentTimer);
    };
  }, [relayUrl]);

  useEffect(() => {
    setTopics([]);
    setComments([]);
    setReactions(new Map());
    setLoading(true);
    return fetchTopics();
  }, [fetchTopics, refreshKey, externalRefreshKey]);

  // Trust filter: hide comments whose author is hidden, so counts/activity stay consistent.
  const visibleComments = useMemo(
    () =>
      trustFilterEnabled && isHiddenByTrust
        ? comments.filter((c) => !isHiddenByTrust(c.pubkey))
        : comments,
    [comments, trustFilterEnabled, isHiddenByTrust],
  );

  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of visibleComments) {
      const rootTag = c.tags.find((t) => t[0] === "E");
      if (rootTag) {
        counts.set(rootTag[1], (counts.get(rootTag[1]) || 0) + 1);
      }
    }
    return counts;
  }, [visibleComments]);

  const lastActivityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of visibleComments) {
      const rootTag = c.tags.find((t) => t[0] === "E");
      if (rootTag) {
        const current = map.get(rootTag[1]) || 0;
        if (c.created_at > current) map.set(rootTag[1], c.created_at);
      }
    }
    return map;
  }, [visibleComments]);

  const allTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    for (const t of topics) {
      for (const tag of t.tags) {
        if (tag[0] === "t" && tag[1]) {
          tagCounts.set(tag[1], (tagCounts.get(tag[1]) || 0) + 1);
        }
      }
    }
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [topics]);

  const filteredTopics = useMemo(() => {
    let list = [...topics];
    if (selectedTag) {
      list = list.filter((t) =>
        t.tags.some((tag) => tag[0] === "t" && tag[1] === selectedTag),
      );
    }
    list.sort((a, b) => {
      const aPinned = pinnedIds.has(a.id) ? 1 : 0;
      const bPinned = pinnedIds.has(b.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      switch (sortMode) {
        case "newest":
          return b.created_at - a.created_at;
        case "oldest":
          return a.created_at - b.created_at;
        case "comments": {
          const aC = commentCounts.get(a.id) || 0;
          const bC = commentCounts.get(b.id) || 0;
          return bC - aC || b.created_at - a.created_at;
        }
        case "reactions": {
          const aR = reactions.get(a.id) || 0;
          const bR = reactions.get(b.id) || 0;
          return bR - aR || b.created_at - a.created_at;
        }
        case "active":
        default: {
          const aLast = lastActivityMap.get(a.id) || a.created_at;
          const bLast = lastActivityMap.get(b.id) || b.created_at;
          return bLast - aLast;
        }
      }
    });
    return list;
  }, [topics, selectedTag, lastActivityMap, pinnedIds, sortMode, commentCounts, reactions]);

  // Trust filter applied last, layered on top of tag/sort filtering.
  const visibleTopics = useMemo(
    () =>
      trustFilterEnabled && isHiddenByTrust
        ? filteredTopics.filter((t) => !isHiddenByTrust(t.pubkey))
        : filteredTopics,
    [filteredTopics, trustFilterEnabled, isHiddenByTrust],
  );

  // Report how many TOP-LEVEL topics are currently hidden by the trust filter.
  useEffect(() => {
    onTrustHidden?.(trustFilterEnabled ? filteredTopics.length - visibleTopics.length : 0);
  }, [trustFilterEnabled, filteredTopics.length, visibleTopics.length, onTrustHidden]);

  useEffect(() => {
    onThreadOpen?.(selectedTopic !== null);
  }, [selectedTopic, onThreadOpen]);

  if (selectedTopic) {
    return (
      <TopicThreadView
        topic={selectedTopic}
        relayUrl={relayUrl}
        onBack={() => setSelectedTopic(null)}
        canModerate={canModerate}
        authRequired={authRequired}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-brand tracking-wider uppercase text-brand">Discussions</h2>
        {loading && <RelayOutpostInlineLoader className="w-3.5 h-3.5" />}
      </div>

      {showCreate && (
        <WaveCreateForm
          relayUrl={relayUrl}
          existingTags={allTags}
          onCreated={() => {
            setShowCreate(false);
            setRefreshKey((k) => k + 1);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <TagFilterPills tags={allTags} selected={selectedTag} onSelect={setSelectedTag} />
        </div>
        <WaveSortDropdown value={sortMode} onChange={setSortMode} />
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[120px] gap-3">
          <RelayOutpostInlineLoader className="w-6 h-6" />
          <p className="text-xs text-muted-foreground/50">Fetching waves...</p>
        </div>
      ) : visibleTopics.length === 0 ? (
        <Card className="glass-card p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <BookOpen className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">
              {selectedTag ? `No discussions tagged #${selectedTag}` : "No discussions yet"}
            </p>
            <p className="text-[10px] text-muted-foreground/30">
              Be the first to start a conversation in this community
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleTopics.map((topic) => (
            <WavePostCard
              key={topic.id}
              topic={topic}
              commentCount={commentCounts.get(topic.id) || 0}
              reactionCount={reactions.get(topic.id) || 0}
              lastActivity={lastActivityMap.get(topic.id)}
              onClick={() => setSelectedTopic(topic)}
              isPinned={pinnedIds.has(topic.id)}
              onBan={canModerate ? handleBanTopic : undefined}
              relayUrl={relayUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileCardInline({ pubkey, roleLabel }: { pubkey: string; roleLabel?: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const avatarUrl = profile ? getAvatarUrl(profile) : null;
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));

  useEffect(() => {
    fetchProfilesCached([pubkey]);
  }, [pubkey]);

  return (
    <Link href={`/profile/${formatNpub(pubkey)}`}>
      <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors cursor-pointer">
        <Avatar className="w-8 h-8 border border-black/10 dark:border-white/10 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName || ""} /> : null}
          <AvatarFallback className="text-[9px] bg-brand/10 text-brand">
            {(displayName || "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{displayName}</span>
            <TrustTierDot pubkey={pubkey} />
          </div>
          {roleLabel && (
            <span className="text-[9px] text-brand/60 uppercase tracking-wider">{roleLabel}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function formatFeeAmount(amount: number, unit: string): string {
  if (unit === "msats") return `${(amount / 1000).toLocaleString()} sats`;
  if (unit === "sats") return `${amount.toLocaleString()} sats`;
  return `${amount.toLocaleString()} ${unit}`;
}

function formatFeePeriod(periodSeconds: number): string {
  const days = Math.round(periodSeconds / 86400);
  if (days <= 1) return " / day";
  if (days <= 7) return " / week";
  if (days >= 28 && days <= 31) return " / month";
  if (days >= 89 && days <= 92) return " / quarter";
  if (days >= 180 && days <= 186) return " / 6 months";
  if (days >= 364 && days <= 366) return " / year";
  return ` / ${days} days`;
}

function CommunityInfoPanel({
  nip11,
  relayUrl,
  authors,
  pinnedRules,
  allModerators: moderatorsProp,
  lastActivity,
  onClose }: {
  nip11: Nip11Document | null;
  relayUrl: string;
  authors: string[];
  pinnedRules?: string[];
  allModerators?: string[];
  lastActivity?: number;
  onClose?: () => void;
}) {
  const name = nip11?.name || relayUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  const description = nip11?.description;
  const operatorPubkey = nip11?.pubkey;
  const moderators = moderatorsProp || nip11?.moderators || [];
  const sw = nip11 ? getSoftwareDisplay(nip11) : null;
  const supportedNips = nip11?.supported_nips || [];
  // The NIP badge cloud can run 25+ chips over four lines — collapsed to one
  // row of 8 with a "+N more" toggle.
  const [showAllNips, setShowAllNips] = useState(false);
  const postingPolicy = nip11?.posting_policy;
  const fees = nip11?.fees;
  const paymentsUrl = nip11?.payments_url;

  return (
    <div className="flex flex-col gap-4 overflow-y-auto flex-1">
      <div className="space-y-1">
        {/* No "About" heading — the tab bar already labels this view. */}
        <h2 className="text-sm font-bold">{name}</h2>
        <p className="text-[11px] text-muted-foreground/50 font-mono">
          {relayUrl.replace(/^wss?:\/\//, "")}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground/70 leading-relaxed mt-2">{description}</p>
        )}
      </div>

      {authors.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[10px] font-brand tracking-wider uppercase text-brand/70">
            Community Health
          </h3>
          <OutpostHealthBadge relayUrl={relayUrl} members={authors} lastActivityTs={lastActivity} />
        </div>
      )}

      {operatorPubkey && (
        <div className="space-y-1">
          <h3 className="text-[10px] font-brand tracking-wider uppercase text-brand/70">
            Operator
          </h3>
          <ProfileCardInline pubkey={operatorPubkey} roleLabel="Operator" />
        </div>
      )}

      {moderators.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[10px] font-brand tracking-wider uppercase text-brand/70 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Moderators
          </h3>
          {moderators.map((pk) => (
            <ProfileCardInline key={pk} pubkey={pk} roleLabel="Moderator" />
          ))}
        </div>
      )}

      {(postingPolicy || nip11?.limitation || fees || (pinnedRules && pinnedRules.length > 0)) && (
        <div className="space-y-2">
          <h3 className="text-[10px] font-brand tracking-wider uppercase text-brand/70">
            Rules & Policies
          </h3>
          {pinnedRules && pinnedRules.length > 0 && (
            <ul className="text-[11px] text-muted-foreground/70 space-y-0.5 list-disc list-inside">
              {pinnedRules.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          )}
          {nip11?.limitation && (
            <ul className="text-[11px] text-muted-foreground/60 space-y-0.5 list-disc list-inside">
              {nip11.limitation.auth_required && (
                <li>Authentication required (NIP-42)</li>
              )}
              {nip11.limitation.payment_required && !fees && (
                <li>Payment required to post</li>
              )}
              {nip11.limitation.restricted_writes && (
                <li>Write access is restricted</li>
              )}
              {nip11.limitation.max_content_length && (
                <li>Max content length: {nip11.limitation.max_content_length.toLocaleString()} chars</li>
              )}
              {nip11.limitation.max_event_tags && (
                <li>Max tags per event: {nip11.limitation.max_event_tags}</li>
              )}
              {nip11.limitation.min_pow_difficulty && nip11.limitation.min_pow_difficulty > 0 && (
                <li>Min PoW difficulty: {nip11.limitation.min_pow_difficulty}</li>
              )}
            </ul>
          )}
          {fees && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-amber-600/80 dark:text-amber-400/80 flex items-center gap-1">
                <Zap className="w-3 h-3" /> Payment Required
              </p>
              <ul className="text-[11px] text-muted-foreground/60 space-y-0.5 list-disc list-inside">
                {fees.admission && fees.admission.length > 0 && fees.admission.map((fee, i) => (
                  <li key={`adm-${i}`}>
                    One-time admission: {formatFeeAmount(fee.amount, fee.unit)}
                  </li>
                ))}
                {fees.subscription && fees.subscription.length > 0 && fees.subscription.map((fee, i) => (
                  <li key={`sub-${i}`}>
                    Subscription: {formatFeeAmount(fee.amount, fee.unit)}{formatFeePeriod(fee.period)}
                  </li>
                ))}
                {fees.publication && fees.publication.length > 0 && fees.publication.map((fee, i) => (
                  <li key={`pub-${i}`}>
                    Per-post fee: {formatFeeAmount(fee.amount, fee.unit)}
                  </li>
                ))}
              </ul>
              {paymentsUrl && (
                <a
                  href={paymentsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-amber-600/80 dark:text-amber-400/80 hover:text-amber-700 dark:hover:text-amber-300 underline break-all block"
                >
                  Payment page →
                </a>
              )}
            </div>
          )}
          {postingPolicy && (
            <a
              href={postingPolicy}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-brand hover:text-brand/80 dark:hover:text-brand underline break-all block"
            >
              Full posting policy →
            </a>
          )}
        </div>
      )}

      {nip11?.blossom_servers && nip11.blossom_servers.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[10px] font-brand tracking-wider uppercase text-brand/70 flex items-center gap-1">
            <Package className="w-3 h-3" /> Media Storage
          </h3>
          <div className="space-y-1">
            {nip11.blossom_servers.map((server) => {
              let hostname = server;
              try { hostname = new URL(server).hostname; } catch {}
              return (
                <div key={server} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 shrink-0" />
                  <span className="text-emerald-600/80 dark:text-emerald-400/80 font-mono truncate">{hostname}</span>
                  <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-emerald-600/20 dark:border-emerald-400/20 text-emerald-600/60 dark:text-emerald-400/60 shrink-0">
                    Blossom
                  </Badge>
                </div>
              );
            })}
            <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-1">
              Media uploaded in this community is stored on the relay's Blossom server.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <h3 className="text-[10px] font-brand tracking-wider uppercase text-brand/70">
          Relay Info
        </h3>
        <div className="space-y-1 text-[11px] text-muted-foreground/60">
          {lastActivity && lastActivity > 0 && (
            <p className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-emerald-600/60 dark:text-emerald-400/60" />
              Last activity: {formatDistanceToNow(new Date(lastActivity * 1000), { addSuffix: true })}
            </p>
          )}
          {sw && <p>Software: {sw}</p>}
          {supportedNips.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1 items-center">
              {[...supportedNips].sort((a, b) => a - b).slice(0, showAllNips ? undefined : 8).map((nip) => (
                <Badge
                  key={nip}
                  variant="outline"
                  className="text-[8px] h-3.5 px-1 border-border/20 text-muted-foreground/40 font-mono"
                >
                  NIP-{nip}
                </Badge>
              ))}
              {supportedNips.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowAllNips((v) => !v)}
                  className="text-[9px] text-brand/60 hover:text-brand transition-colors px-1 min-h-[20px]"
                  data-testid="button-toggle-nips"
                >
                  {showAllNips ? "Show less" : `+${supportedNips.length - 8} more`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {authors.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[10px] font-brand tracking-wider uppercase text-brand/70">
            Members ({authors.length})
          </h3>
          <ActiveMembersSection authors={authors} />
        </div>
      )}
    </div>
  );
}


interface MediaAttachment {
  id: string;
  url: string;
  type: "image" | "video" | "audio";
  metadataStripped: boolean;
}

let composeMediaId = 0;

function OutpostComposeSheet({
  open,
  onOpenChange,
  relayUrl,
  mode,
  onPublished,
  relayBlossomServers = [],
  nip11 = null,
  authRequired = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relayUrl: string;
  mode: "note" | "topic";
  onPublished: () => void;
  relayBlossomServers?: string[];
  nip11?: Nip11Document | null;
  authRequired?: boolean;
}) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [mediaAttachments, setMediaAttachments] = useState<MediaAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("Uploading...");
  const [linkInput, setLinkInput] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [crossPost, setCrossPost] = useState(false);
  // Cross-posting is only offered on public outposts — never on private/closed
  // communities, so their content can't leak to your public followers.
  const isPublicRelay = classifyRelayUrl(relayUrl) !== "private";
  // Friendly destination identity — prefer the community's NIP-11 name/icon,
  // fall back to the bare relay hostname. A community is "private" (lock shown)
  // when it requires AUTH or classifies as a private relay.
  const communityName = nip11?.name?.trim() || relayUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  const communityIcon = nip11?.icon;
  const isPrivateCommunity = !!authRequired || !isPublicRelay;
  const destinationLabel = buildDestinationLabel({
    communityName: nip11?.name,
    relayUrl,
    alsoShareToFeed: crossPost && isPublicRelay,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const { trackEmoji, getEmojiTags, clearEmojiTags } = useEmojiTags();
  const { emojis: customEmojis } = useCustomEmojis();
  const composeEmojiMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of customEmojis) map.set(e.shortcode, e.url);
    return map;
  }, [customEmojis]);
  const { mentionActive, mentionQuery, detectMention, insertMention, closeMention, resolveContent, getMentionTags, clearMentionTags } = useMention();

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    const cursor = e.target.selectionStart ?? val.length;
    detectMention(val, cursor);
  }, [detectMention]);

  const handleMentionSelect = useCallback((result: import("@/components/MentionSearch").MentionResult) => {
    const newContent = insertMention(result, content, textareaRef);
    setContent(newContent);
  }, [content, insertMention]);

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

  const handleFileUpload = useCallback(async (file: File) => {
    try {
      validateFile(file);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported file.", variant: "destructive" });
      return;
    }
    if (isVideoFile(file)) {
      toast({ title: "Privacy notice", description: "Video metadata cannot be stripped in-browser. Consider removing location data before uploading." });
    }
    setIsUploading(true);
    setUploadStatus("Preparing...");
    try {
      const result = await uploadMediaForOutpost(file, relayBlossomServers, setUploadStatus, signer);
      const mediaType = isVideoFile(file) ? "video" as const : isAudioFile(file) ? "audio" as const : "image" as const;
      setMediaAttachments(prev => [...prev, {
        id: `media-${++composeMediaId}`,
        url: result.url,
        type: mediaType,
        metadataStripped: !!result.metadataStripped }]);
      const desc = result.metadataStripped
        ? "Media attached. Location and device data were removed."
        : "Media attached to your post.";
      toast({ title: "Uploaded", description: desc });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof UploadError ? err.message : "Could not upload the file. Try again or use a smaller file.",
        variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [signer, toast, relayBlossomServers]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const handleAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const removeMedia = useCallback((id: string) => {
    setMediaAttachments(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleAddLink = () => {
    const url = linkInput.trim();
    if (!url) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? content.length;
    const before = content.slice(0, cursor);
    const after = content.slice(cursor);
    const spaceBefore = before.length > 0 && !before.endsWith("\n") && !before.endsWith(" ") ? "\n" : "";
    const spaceAfter = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    setContent(before + spaceBefore + url + spaceAfter + after);
    setLinkInput("");
    setShowLinkInput(false);
    textareaRef.current?.focus();
  };

  const hasContent = (() => {
    if (gifUrl || mediaAttachments.length > 0) return true;
    return content.replace(/[\u200B\u200C]/g, "").trim().length > 0;
  })();

  const handlePublish = async () => {
    if (!pubkey) return;
    if (mode === "topic" && !title.trim()) return;
    if (!hasContent) return;
    setPublishing(true);
    try {
      const emojiTags = getEmojiTags(content);
      const mentionTags = getMentionTags(content);
      const tags: string[][] = [...clientTags(), ...emojiTags, ...mentionTags];
      let kind = KIND_TEXT_NOTE;
      if (mode === "topic") {
        kind = KIND_TOPIC;
        tags.unshift(["title", title.trim()]);
      }
      if (classifyRelayUrl(relayUrl) === "private") tags.push(["-"]);
      let publishContent = resolveContent(content).trim();
      if (gifUrl) {
        const separator = publishContent.length > 0 ? "\n\n" : "";
        publishContent = publishContent + separator + gifUrl;
      }
      for (const media of mediaAttachments) {
        const separator = publishContent.length > 0 ? "\n\n" : "";
        publishContent = publishContent + separator + media.url;
      }
      const eventTemplate = {
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: publishContent };
      const signerToUse = signer || (window as any).nostr;
      if (!signerToUse) {
        toast({ title: "Sign in required", description: "Connect a Nostr extension or signer to post." });
        return;
      }
      const signed = await withSignerTimeout(signerToUse.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (!signed) return;
      // Cross-post (public outposts only): also broadcast to the user's own
      // relays and let it enter their feed (privateOnly off). Default stays
      // relay-only, exactly as before.
      const crossPosting = crossPost && isPublicRelay;
      const targets = crossPosting
        ? Array.from(new Set([relayUrl, ...getActiveDefaultRelays()]))
        : [relayUrl];
      const ok = await publishEvent(signed, targets, undefined, true, !crossPosting);
      if (!ok) {
        toast({ title: "Relay rejected your post", description: "The community relay did not accept your post. You may not be authenticated or connected.", variant: "destructive" });
        return;
      }
      toast({ title: crossPosting ? "Posted to community + your feed" : (mode === "topic" ? "Wave posted" : "Note published") });
      setContent("");
      setTitle("");
      setGifUrl(null);
      setMediaAttachments([]);
      setShowLinkInput(false);
      setLinkInput("");
      setCrossPost(false);
      clearEmojiTags();
      clearMentionTags();
      onOpenChange(false);
      onPublished();
    } catch {
      toast({ title: "Failed to publish", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const body = (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2 mb-1">
        <PenSquare className="w-4 h-4 text-brand/70" />
        <h3 className="text-xs font-brand tracking-wider uppercase text-brand">
          {mode === "topic" ? "New discussion" : "New post"}
        </h3>
      </div>
      {/* Friendly destination chip: avatar + "Posting to <community>" + a lock
          when the community is AUTH/members-only. Replaces the raw relay-URL
          label. When cross-posting is on, the label reads "<name> + your feed". */}
      <div
        className="flex items-center gap-2 w-fit max-w-full rounded-full bg-black/[0.03] dark:bg-white/[0.04] border border-border/40 pl-1 pr-3 py-1"
        data-testid="chip-post-destination"
        title={`Posting to ${destinationLabel}`}
      >
        <Avatar className="w-6 h-6 shrink-0">
          <AvatarImage src={communityIcon || undefined} alt={communityName} />
          <AvatarFallback className="text-[9px] bg-brand/10 text-brand">
            {communityName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-[12px] font-medium text-foreground/80 truncate min-w-0">
          Posting to <span className="text-foreground">{destinationLabel}</span>
        </span>
        {isPrivateCommunity && (
          <Lock
            className="w-3 h-3 text-emerald-600/70 dark:text-emerald-400/70 shrink-0"
            aria-label="Members-only community"
          />
        )}
      </div>
      {isPublicRelay && (
        <label className="flex items-center justify-between gap-3 cursor-pointer select-none px-0.5 py-0.5" data-testid="toggle-crosspost">
          <span className="flex flex-col min-w-0">
            <span className="text-[12px] text-foreground/70">Also share to your feed</span>
            <span className="text-[10px] text-muted-foreground/50">Reach your followers too</span>
          </span>
          <Switch
            checked={crossPost}
            onCheckedChange={setCrossPost}
            className="shrink-0"
            data-testid="switch-crosspost"
          />
        </label>
      )}
      {mode === "topic" && (
        <Input
          placeholder="Wave title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-base sm:text-sm bg-black/[0.03] dark:bg-white/[0.03] border-border/20"
          maxLength={200}
        />
      )}
      <div className="relative">
        <MentionSearch
          query={mentionQuery}
          visible={mentionActive}
          onSelect={handleMentionSelect}
          onClose={closeMention}
          position="below"
        />
        <MentionHighlightTextarea
          ref={textareaRef}
          placeholder={mode === "topic" ? "Write your post..." : "What's on your mind?"}
          value={content}
          onChange={handleContentChange}
          emojiMap={composeEmojiMap}
          className="min-h-[100px] w-full text-base sm:text-sm bg-black/[0.03] dark:bg-white/[0.03] border border-border/20 rounded-md resize-none px-3 py-2"
          onKeyDown={(e) => {
            if (mentionActive) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handlePublish();
            }
          }}
        />
      </div>

      {(gifUrl || mediaAttachments.length > 0) && (
        <div className="flex gap-2 flex-wrap">
          {gifUrl && (
            <div className="relative w-fit rounded-lg overflow-hidden bg-primary/[0.06] border border-primary/15">
              <img src={gifUrl} alt="GIF" className="max-w-[120px] max-h-[100px] object-cover block" />
              <button
                type="button"
                onClick={() => setGifUrl(null)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {mediaAttachments.map(media => (
            <div key={media.id} className="relative rounded-lg overflow-hidden bg-primary/[0.06] border border-primary/15">
              {media.type === "image" && (
                <img src={media.url} alt="Attachment" className="w-24 h-24 object-cover block" />
              )}
              {media.type === "video" && (
                <div className="w-24 h-24 flex items-center justify-center bg-black/30">
                  <Film className="w-6 h-6 text-brand/70" />
                  <span className="absolute bottom-1 left-1 text-[8px] text-white/60">Video</span>
                </div>
              )}
              {media.type === "audio" && (
                <div className="w-24 h-24 flex items-center justify-center bg-black/30">
                  <Music className="w-6 h-6 text-brand/70" />
                  <span className="absolute bottom-1 left-1 text-[8px] text-white/60">Audio</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeMedia(media.id)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showLinkInput && (
        <div className="flex gap-2">
          <Input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://..."
            className="h-9 text-base sm:text-xs flex-1 bg-black/[0.03] dark:bg-white/[0.03] border-border/20"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleAddLink(); }
              if (e.key === "Escape") setShowLinkInput(false);
            }}
            autoFocus
          />
          <Button size="sm" onClick={handleAddLink} className="h-8 text-xs px-3" disabled={!linkInput.trim()}>
            Add
          </Button>
        </div>
      )}

      {isUploading && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-primary/5 border border-primary/10">
          <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand/70" />
          <span className="text-[11px] text-brand/70">{uploadStatus}</span>
        </div>
      )}

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioSelect} />

      <div className="flex items-center gap-1">
        <ComposeEmojiPicker
          onInsert={handleEmojiInsert}
          onGifSelect={(url) => setGifUrl(url)}
          disabled={publishing || isUploading}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={publishing || isUploading}
          className="flex items-center justify-center h-9 w-9 rounded-md text-brand/70 hover:text-brand hover:bg-brand/10 transition-colors disabled:opacity-30"
          title="Add image"
          aria-label="Add image"
        >
          <ImagePlus className="w-[18px] h-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          disabled={publishing || isUploading}
          className="flex items-center justify-center h-9 w-9 rounded-md text-brand/70 hover:text-brand hover:bg-brand/10 transition-colors disabled:opacity-30"
          title="Add video"
          aria-label="Add video"
        >
          <Film className="w-[18px] h-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => audioInputRef.current?.click()}
          disabled={publishing || isUploading}
          className="flex items-center justify-center h-9 w-9 rounded-md text-brand/70 hover:text-brand hover:bg-brand/10 transition-colors disabled:opacity-30"
          title="Add audio"
          aria-label="Add audio"
        >
          <Music className="w-[18px] h-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => setShowLinkInput(!showLinkInput)}
          disabled={publishing || isUploading}
          className={`flex items-center justify-center h-9 w-9 rounded-md transition-colors disabled:opacity-30 ${showLinkInput ? "text-brand dark:text-brand bg-brand/10" : "text-brand/70 hover:text-brand hover:bg-brand/10"}`}
          title="Add link"
          aria-label="Add link"
        >
          <LinkIcon className="w-[18px] h-[18px]" />
        </button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-xs h-9">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handlePublish}
          disabled={!hasContent || (mode === "topic" && !title.trim()) || publishing || isUploading || !pubkey}
          className="text-xs h-9 px-4"
          data-testid="button-community-publish"
        >
          {publishing ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5 mr-1" />}
          {mode === "topic" ? "Post Wave" : "Publish"}
        </Button>
      </div>

      <div className="mt-4 pt-3 border-t border-border/10">
        <button
          type="button"
          onClick={() => setShowLearnMore(!showLearnMore)}
          className="flex items-center gap-2 w-full text-left group cursor-pointer"
        >
          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Info className="w-3 h-3 text-brand/60" />
          </div>
          <span className="text-[11px] text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors flex-1">
            {mode === "topic" ? "How do discussions work?" : "How do posts work?"}
          </span>
          {showLearnMore ? (
            <ChevronUp className="w-3 h-3 text-muted-foreground/30" />
          ) : (
            <ChevronDown className="w-3 h-3 text-muted-foreground/30" />
          )}
        </button>

        {showLearnMore && (
          <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            {mode === "topic" ? (
              <>
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Telescope className="w-3.5 h-3.5 text-brand/70" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-foreground/70">Start a conversation</p>
                    <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                      Waves are threaded discussions that live on this relay. Give it a title, share your thoughts, and others can reply to keep the conversation going.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Satellite className="w-3.5 h-3.5 text-brand/70" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-foreground/70">Published to this community</p>
                    <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                      Your wave is stored on this relay and visible to its members.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-600/70 dark:text-yellow-400/70" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-foreground/70">Attach media and links</p>
                    <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                      Drop in images, videos, audio, GIFs, or links to make your wave stand out.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Rocket className="w-3.5 h-3.5 text-brand/70" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-foreground/70">Quick thoughts, no title needed</p>
                    <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                      Notes are short-form posts — like a status update or a quick share. Just write and publish. No title required.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Satellite className="w-3.5 h-3.5 text-brand/70" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-foreground/70">Shows up in the feed</p>
                    <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                      Your note appears in this community's feed, visible to all members, and is stored on this relay.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Telescope className="w-3.5 h-3.5 text-brand/70" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-foreground/70">Want a longer discussion?</p>
                    <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                      If you have more to say, try creating a Wave instead. Waves have titles and are designed for threaded conversations that people can find later.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="glass-dialog-card border-primary/15 sm:max-w-md"
      >
        <SheetTitle className="sr-only">{mode === "topic" ? "New discussion" : "New post"}</SheetTitle>
        {body}
      </SheetContent>
    </Sheet>
  );
}

export function OutpostFeedBrowser({ relayUrl }: { relayUrl: string }) {
  useDocumentTitle("Community · Relay Outpost");
  const [, setLocation] = useLocation();
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const concordEnabled = useConcordEnabled();
  const [nip11, setNip11] = useState<Nip11Document | null>(null);
  // Operator-curated Featured feeds (kind 30004) — the tab self-hides when empty.
  const { sets: featuredSets } = useRelayFeaturedSets(relayUrl, nip11);
  // Which featured feed is showing — lifted so the tab's options sheet and the
  // inline chips stay one control (the Posts-tab pattern).
  const [featuredCoord, setFeaturedCoord] = useState<string | null>(null);
  const [events, setEvents] = useState<NostrEvent[]>([]);
  // Posts / Replies / All lens for the Posts tab, matching the main feed control.
  const [feedContentFilter, setFeedContentFilter] = useState<"posts" | "replies" | "all">("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [bufferedNewCount, setBufferedNewCount] = useState(0);
  const [nip11Loading, setNip11Loading] = useState(true);
  const [authors, setAuthors] = useState<string[]>([]);
  const eventMapRef = useRef(new Map<string, NostrEvent>());
  const authorSetRef = useRef(new Set<string>());
  const eoseReceivedRef = useRef(false);
  const bufferedNewRef = useRef<NostrEvent[]>([]);
  const loadMoreSubRef = useRef<{ close: () => void } | null>(null);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreRelayRef = useRef<string>("");
  const [allowedPubkeys, setAllowedPubkeys] = useState<string[]>([]);
  const PINNABLE_TABS: PinnableTab[] = ["feed", "topics", "channels", "horizon"];
  const validTabKeys: OutpostTab[] = ["feed", "featured", "topics", "channels", "horizon", "about"];
  const urlParams = new URLSearchParams(window.location.search);
  const rawUrlTab = urlParams.get("tab");
  const urlTab = (rawUrlTab ? slugToTabKey(rawUrlTab) : null) as OutpostTab | null;
  const [activeTab, setActiveTab] = useState<OutpostTab>(urlTab && validTabKeys.includes(urlTab) ? urlTab : "feed");
  // The URL query is the source of truth for which tab + channel is shown. wouter's
  // location is pathname-only, so navigating to a different ?tab/?channel on the SAME
  // outpost (e.g. clicking the outpost name vs. a pinned channel) wouldn't otherwise
  // update the view — it would "stick" where you left off. useSearch is reactive.
  const searchStr = useSearch();
  const liveTab = useMemo<OutpostTab>(() => {
    const raw = new URLSearchParams(searchStr).get("tab");
    const t = (raw ? slugToTabKey(raw) : null) as OutpostTab | null;
    return t && validTabKeys.includes(t) ? t : "feed";
  }, [searchStr]);
  const liveChannel = useMemo(() => new URLSearchParams(searchStr).get("channel") || undefined, [searchStr]);
  const liveInviteCode = useMemo(() => {
    const p = new URLSearchParams(searchStr);
    return p.get("code") || p.get("invite") || undefined;
  }, [searchStr]);
  useEffect(() => { setActiveTab(liveTab); }, [liveTab]);
  const [tabDropdownOpen, setTabDropdownOpen] = useState(false);
  const [feedPinned, setFeedPinned] = useState(() =>
    (PINNABLE_TABS as string[]).includes(activeTab) ? isFeedPinned(relayUrl, activeTab as PinnableTab) : false
  );
  const [joined, setJoined] = useState(() => isJoinedOutpost(relayUrl));
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeMode, setComposeMode] = useState<"note" | "topic">("note");
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [waveThreadOpen, setWaveThreadOpen] = useState(false);
  // Condensed by default: outpost identity (avatar · name · AUTH · Invite ·
  // Join/Leave · ⌄) portals into the global top bar's #header-identity-slot,
  // same pattern as profiles — banner shows through the bar, the ⌄ expands the
  // full banner/description/meta card below.
  // The slot is tracked live because the header bar unmounts entirely on
  // desktop while the sidebar is expanded; whenever it's gone the same
  // condensed strip renders inline above the tabs instead (pre-slot layout).
  const [headerCollapsed, setHeaderCollapsed] = useState(true);
  const headerSlotEl = useHeaderIdentitySlot();
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const { registerOutpostCompose, unregisterOutpostCompose, setHorizonDialogOpen } = useOutpostCompose();
  const [pinnedRules, setPinnedRules] = useState<string[]>([]);
  const [storedModerators, setStoredModerators] = useState<string[]>([]);
  const [horizonAdminOnly, setHorizonAdminOnly] = useState<boolean | null>(null);
  const [horizonConfigLoaded, setHorizonConfigLoaded] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      // Collapse-only: scrolling reclaims the space, but never force-expands
      // the header back open (expansion is the user's explicit choice).
      if (el.scrollTop > 80) setHeaderCollapsed(true);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if ((PINNABLE_TABS as string[]).includes(activeTab)) {
      setFeedPinned(isFeedPinned(relayUrl, activeTab as PinnableTab));
    } else {
      setFeedPinned(false);
    }
    const params = new URLSearchParams(window.location.search);
    if (activeTab === "feed") {
      params.delete("tab");
    } else {
      params.set("tab", tabKeyToSlug(activeTab));
    }
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [activeTab, relayUrl]);

  const handleTogglePin = useCallback(() => {
    if (!(PINNABLE_TABS as string[]).includes(activeTab)) return;
    const tab = activeTab as PinnableTab;
    const tabConfig = [
      { key: "feed", label: "Posts" },
      { key: "topics", label: "Discussions" },
      { key: "channels", label: "Chat" },
      { key: "horizon", label: "Articles" },
    ];
    const tabLabel = tabConfig.find((t) => t.key === tab)?.label || tab;
    // Bare view name — the pin always renders nested under its relay, so the
    // relay name would be redundant. See pinDisplayLabel().
    const label = tabLabel;
    const nowPinned = toggleFeedPin(relayUrl, tab, label);
    setFeedPinned(nowPinned);
    toast({ title: nowPinned ? "Pinned — find it under this community" : "Unpinned" });
  }, [activeTab, relayUrl, nip11, toast]);

  const [pinVersion, setPinVersion] = useState(0);

  const quickAccessChannelIds = useMemo(() => {
    const normalizedRelay = relayUrl.replace(/\/+$/, "").toLowerCase();
    const pins = getPinnedFeeds();
    return new Set(
      pins
        .filter((p) => p.tab === "channels" && p.channelId && p.relayUrl.replace(/\/+$/, "").toLowerCase() === normalizedRelay)
        .map((p) => p.channelId!)
    );
  }, [pinVersion, relayUrl]);

  const handleQuickAccessChannelPin = useCallback((groupId: string, groupName: string) => {
    // Bare channel name; channelLabel drives the display via pinDisplayLabel().
    const label = groupName;
    const nowPinned = toggleFeedPin(relayUrl, "channels", label, groupId, groupName);
    setPinVersion((v) => v + 1);
    toast({ title: nowPinned ? "Pinned — find it under this community" : "Unpinned" });
  }, [relayUrl, nip11, toast]);

  useEffect(() => {
    cleanupPinnedFeeds();
  }, []);

  useEffect(() => {
    const refreshPin = () => {
      if ((PINNABLE_TABS as string[]).includes(activeTab)) {
        setFeedPinned(isFeedPinned(relayUrl, activeTab as PinnableTab));
      }
      setPinVersion((v) => v + 1);
    };
    window.addEventListener("pinned-feeds-changed", refreshPin);
    return () => window.removeEventListener("pinned-feeds-changed", refreshPin);
  }, [activeTab, relayUrl]);

  useEffect(() => {
    // Map the URL slug back to the internal tab key. The tab-sync effect above
    // rewrites the URL to friendly slugs (?tab=discussions/chat/…), so reading
    // it raw here made every deep-linked pin fall through to "feed" (Posts).
    const rawFreshTab = new URLSearchParams(window.location.search).get("tab");
    const freshTab = (rawFreshTab ? slugToTabKey(rawFreshTab) : null) as OutpostTab | null;
    if (freshTab && validTabKeys.includes(freshTab)) {
      setActiveTab(freshTab);
    } else {
      setActiveTab("feed");
    }
    // Every outpost LOADS with the banner condensed — expansion never carries
    // over from a previously-viewed outpost (the component stays mounted when
    // hopping between relays, so the mount default alone isn't enough).
    setHeaderCollapsed(true);
    setEvents([]);
    setAuthors([]);
    setAllowedPubkeys([]);
    setLoading(true);
    setLoadingMore(false);
    setHasMore(true);
    setBufferedNewCount(0);
    bufferedNewRef.current = [];
    eventMapRef.current = new Map();
    authorSetRef.current = new Set();
    eoseReceivedRef.current = false;
    if (loadMoreSubRef.current) { loadMoreSubRef.current.close(); loadMoreSubRef.current = null; }
    if (loadMoreTimerRef.current) { clearTimeout(loadMoreTimerRef.current); loadMoreTimerRef.current = null; }
    loadMoreRelayRef.current = "";
    // A new relay starts at the base page size — the last community's filter
    // yield says nothing about this one's.
    pageLimitRef.current = BASE_PAGE_LIMIT;
    setNip11(null);
    setNip11Loading(true);
    setJoined(isJoinedOutpost(relayUrl));
    // NOTE: no setHeaderCollapsed(false) here — the header must LOAD condensed
    // (reset to true at the top of this effect). This line used to re-expand it
    // and silently overrode the reset.
    setPinnedRules([]);
    setStoredModerators([]);
  }, [relayUrl]);

  useEffect(() => {
    fetchNip11(relayUrl).then((doc) => {
      setNip11(doc);
      setNip11Loading(false);
    }).catch(() => {
      setNip11Loading(false);
    });

    const eventMap = new Map<string, NostrEvent>();
    const authorSet = new Set<string>();
    let unmounted = false;
    let eoseReceived = false;
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
    eventMapRef.current = eventMap;
    authorSetRef.current = authorSet;
    eoseReceivedRef.current = false;
    bufferedNewRef.current = [];
    setEvents([]);
    setLoading(true);
    setHasMore(true);
    setBufferedNewCount(0);

    function flushEvents() {
      if (unmounted) return;
      const sorted = Array.from(eventMap.values()).sort((a, b) => b.created_at - a.created_at);
      setEvents(sorted);
      setAuthors(Array.from(authorSet));
    }

    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [1], limit: 30 },
      {
        onevent(e: NostrEvent) {
          if (unmounted) return;
          if (!eventMap.has(e.id)) {
            eventMap.set(e.id, e);
            eventStore.add(e);
            const isNewAuthor = !authorSet.has(e.pubkey);
            authorSet.add(e.pubkey);
            if (isNewAuthor) fetchProfilesCached([e.pubkey]);

            if (eoseReceived) {
              bufferedNewRef.current.push(e);
              setBufferedNewCount(bufferedNewRef.current.length);
            } else if (!streamFlushTimer) {
              streamFlushTimer = setTimeout(() => {
                streamFlushTimer = null;
                flushEvents();
              }, 150);
            }
          }
        },
        oneose() {
          if (unmounted) return;
          eoseReceived = true;
          eoseReceivedRef.current = true;
          clearTimeout(timer);
          if (streamFlushTimer) { clearTimeout(streamFlushTimer); streamFlushTimer = null; }
          flushEvents();
          setLoading(false);
        } },
    );

    const timer = setTimeout(() => {
      if (!eoseReceived && !unmounted) {
        eoseReceived = true;
        eoseReceivedRef.current = true;
        if (streamFlushTimer) { clearTimeout(streamFlushTimer); streamFlushTimer = null; }
        flushEvents();
        setLoading(false);
      }
    }, 8000);

    return () => {
      unmounted = true;
      sub.close();
      clearTimeout(timer);
      if (streamFlushTimer) clearTimeout(streamFlushTimer);
      if (loadMoreSubRef.current) { loadMoreSubRef.current.close(); loadMoreSubRef.current = null; }
      if (loadMoreTimerRef.current) { clearTimeout(loadMoreTimerRef.current); loadMoreTimerRef.current = null; }
    };
  }, [relayUrl, feedRefreshKey]);

  useEffect(() => {
    if (!nip11) return;
    const isAuth = nip11.limitation?.auth_required ||
      nip11.supported_nips?.includes(42);
    if (!isAuth) return;
    let cancelled = false;
    listAllowedPubkeys(relayUrl).then((res) => {
      if (cancelled) return;
      if (res.result && Array.isArray(res.result)) {
        const pks = res.result.map((e) => e.pubkey).filter(Boolean);
        if (pks.length > 0) {
          setAllowedPubkeys(pks);
          fetchProfilesCached(pks);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [relayUrl, nip11]);

  const members = useMemo(() => {
    if (allowedPubkeys.length === 0) return authors;
    const merged = new Set([...authors, ...allowedPubkeys]);
    return Array.from(merged);
  }, [authors, allowedPubkeys]);

  const lastActivity = useMemo(() => {
    if (events.length === 0) return undefined;
    return events[0].created_at;
  }, [events]);

  useEffect(() => {
    let unmounted = false;
    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_TOPIC], "#t": ["rules", "pinned"], limit: 5 },
      {
        onevent(e: NostrEvent) {
          if (unmounted) return;
          const content = e.content?.trim();
          if (content) {
            const lines = content
              .split(/\n/)
              .map((l) => l.replace(/^\d+\.\s*/, "").trim())
              .filter(Boolean);
            if (lines.length > 0) {
              setPinnedRules((prev) => {
                const combined = new Set([...prev, ...lines]);
                return Array.from(combined);
              });
            }
          }
        },
        oneose() {
          sub.close();
          clearTimeout(timer);
        } },
    );
    const timer = setTimeout(() => { sub.close(); }, 6000);
    return () => { unmounted = true; sub.close(); clearTimeout(timer); };
  }, [relayUrl]);

  useEffect(() => {
    const opPk = nip11?.pubkey;
    if (!opPk) { setHorizonAdminOnly(null); setHorizonConfigLoaded(true); return; }
    setHorizonAdminOnly(null);
    setHorizonConfigLoaded(false);
    const MODERATORS_D_TAG = "relay-outpost/moderators";
    const modSub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [opPk], "#d": [MODERATORS_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (Array.isArray(data.moderators)) setStoredModerators(data.moderators);
          } catch {}
        },
        oneose() { modSub.close(); clearTimeout(modTimer); } },
    );
    const modTimer = setTimeout(() => { modSub.close(); }, 6000);

    const COMMUNITY_RULES_D_TAG = "relay-outpost/community-rules";
    const sub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [opPk], "#d": [COMMUNITY_RULES_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (data.rules && typeof data.rules === "string") {
              const lines = data.rules.split(/\n/).map((l: string) => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
              if (lines.length > 0) {
                setPinnedRules(prev => {
                  const combined = new Set([...prev, ...lines]);
                  return Array.from(combined);
                });
              }
            }
          } catch {}
        },
        oneose() { sub.close(); clearTimeout(timer); } },
    );
    const timer = setTimeout(() => { sub.close(); }, 6000);

    const HORIZON_CONFIG_D_TAG = "relay-outpost/horizon-config";
    const hSub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [opPk], "#d": [HORIZON_CONFIG_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (typeof data.horizonAdminOnly === "boolean") setHorizonAdminOnly(data.horizonAdminOnly);
          } catch {}
        },
        oneose() { hSub.close(); clearTimeout(hTimer); setHorizonConfigLoaded(true); } },
    );
    const hTimer = setTimeout(() => { hSub.close(); setHorizonConfigLoaded(true); }, 6000);

    return () => { sub.close(); modSub.close(); hSub.close(); clearTimeout(timer); clearTimeout(modTimer); clearTimeout(hTimer); };
  }, [nip11?.pubkey, relayUrl]);

  const allModerators = useMemo(() => {
    const set = new Set([...(nip11?.moderators || []), ...storedModerators]);
    return Array.from(set);
  }, [nip11?.moderators, storedModerators]);

  const name = nip11?.name || relayUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "");

  // Invite anyone to this outpost — works for any member (public relay), not
  // just operators. Copy the link or send it as a private NIP-17 DM.
  const [showOutpostInvite, setShowOutpostInvite] = useState(false);
  const [outpostInviteRecipient, setOutpostInviteRecipient] = useState<SelectedRecipient | null>(null);
  const [outpostLinkCopied, setOutpostLinkCopied] = useState(false);
  const [sendingOutpostInvite, setSendingOutpostInvite] = useState(false);
  const outpostInviteLink = useMemo(
    () => `${typeof window !== "undefined" ? window.location.origin : ""}/outposts/${encodeURIComponent(relayUrl)}`,
    [relayUrl],
  );
  const handleCopyOutpostLink = useCallback(() => {
    navigator.clipboard.writeText(outpostInviteLink);
    setOutpostLinkCopied(true);
    setTimeout(() => setOutpostLinkCopied(false), 2000);
  }, [outpostInviteLink]);
  const handleSendOutpostInvite = useCallback(async () => {
    if (!outpostInviteRecipient?.pubkey || !pubkey || !window.nostr) return;
    setSendingOutpostInvite(true);
    try {
      const content = `You're invited to join the community "${name}". Tap to open and join:\n\n${outpostInviteLink}`;
      const res = await sendDM({ signer: window.nostr, senderPubkey: pubkey, recipientPubkey: outpostInviteRecipient.pubkey, content });
      if (res.success) {
        toast({ title: "Invite sent", description: `Sent to ${outpostInviteRecipient.displayName || "the user"}.` });
        setOutpostInviteRecipient(null);
      } else {
        toast({ title: "Couldn't send", description: res.error || "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setSendingOutpostInvite(false);
    }
  }, [outpostInviteRecipient, pubkey, name, outpostInviteLink, toast]);

  const icon = nip11?.icon;
  const banner = nip11?.banner;
  const description = nip11?.description;
  const tags = nip11?.tags;
  const authRequired = nip11?.limitation?.auth_required;
  const sw = nip11 ? getSoftwareDisplay(nip11) : null;
  // `undefined` when we could not read the relay's NIP-11, NOT []. An empty
  // array is a claim — "this relay supports nothing" — and `|| []` was making
  // that claim on every failed fetch, including a plain 502. Downstream,
  // CommsTab reads `supportedNips?.includes(29) ?? true`: a deliberately
  // permissive default for the unknown case that could never once fire, because
  // [] is not nullish. A relay whose HTTP endpoint blipped was told it doesn't
  // do NIP-29, and its rooms vanished behind "This outpost doesn't have chat yet".
  const supportedNips = nip11?.supported_nips;
  const operatorPubkey = nip11?.pubkey;
  const nip11Operator = !!(pubkey && operatorPubkey && pubkey === operatorPubkey);
  const isModerator = !!(pubkey && allModerators.includes(pubkey));

  // Track this relay's persisted record so the operator-mode override
  // toggle can read its current `isAdmin` flag and write changes back.
  const [joinedRelayRecord, setJoinedRelayRecord] = useState<OutpostRelay | undefined>(
    () => getOutpostRelays().find((r) => r.url === relayUrl),
  );
  useEffect(() => {
    const sync = () => {
      setJoinedRelayRecord(getOutpostRelays().find((r) => r.url === relayUrl));
    };
    sync();
    window.addEventListener("outpost-relays-changed", sync);
    return () => window.removeEventListener("outpost-relays-changed", sync);
  }, [relayUrl]);

  const isJoined = !!joinedRelayRecord;
  const operatorOverrideOff = joinedRelayRecord?.operatorOverride === "off";
  // Effective operator status combines NIP-11 detection, the persisted
  // `isAdmin` flag (set by auto-promotion or manual toggle), and the
  // explicit user override that can suppress both.
  const isOperator = !operatorOverrideOff && (nip11Operator || joinedRelayRecord?.isAdmin === true);
  const canModerate = isOperator || isModerator;
  // A relay that publishes an operator pubkey can only be claimed by that operator
  // — otherwise it would branch under "Relays you run" yet be denied in Relay
  // Control. (Relays that publish no operator pubkey skip verification, so a manual
  // claim stays allowed there, matching Relay Control.)
  const operatorClaimBlocked = !!operatorPubkey && !nip11Operator;

  const toggleOperatorMode = useCallback(() => {
    const all = getOutpostRelays();
    const idx = all.findIndex((r) => r.url === relayUrl);
    if (idx === -1) return;
    const current = all[idx];
    const turningOn = !(current.isAdmin === true) || current.operatorOverride === "off";
    if (turningOn && operatorClaimBlocked) {
      toast({
        title: "You don't operate this relay",
        description: "This relay's operator key doesn't match yours, so it can't be added to \"Relays you run.\"",
        variant: "destructive",
      });
      return;
    }
    const next: OutpostRelay = turningOn
      ? { ...current, isAdmin: true, operatorOverride: undefined }
      : { ...current, isAdmin: false, operatorOverride: "off" };
    const updated = [...all];
    updated[idx] = next;
    saveOutpostRelays(updated);
    setJoinedRelayRecord(next);
    toast({
      title: turningOn ? "Operator mode enabled" : "Operator mode disabled",
      description: turningOn
        ? "Operator tools are available for this community."
        : "Auto-detection is suppressed for this community.",
    });
  }, [relayUrl, toast, operatorClaimBlocked]);
  const effectiveHorizonAdminOnly = horizonAdminOnly ?? false;
  const canPostHorizon = horizonConfigLoaded ? (effectiveHorizonAdminOnly ? canModerate : !!pubkey) : false;
  const { ready: relayReady, failed: relayAuthFailed, connecting: relayConnecting, statusLabel: relayStatusLabel } = useRelayReadiness(relayUrl, authRequired);

  // ── WoT trust filter: a per-outpost on/off toggle over the ONE shared excluded-tier
  // set (the same filter the feed uses). When on, it applies across every content tab. ──
  const { excludedTiers: trustExcludedTiers, toggleTier: toggleTrustTier, clearTiers: clearTrustTiers } = useExcludedTiers();
  const { wotEnabled: trustWotEnabled, getAuthorInfluence: trustGetInfluence, isAuthorFlagged: trustIsFlagged, scores: trustScores } = useGrapeRankScores();
  const [trustFilterOn, setTrustFilterOn] = useState(() => readOutpostFilterOn(relayUrl));
  const [trustPopoverOpen, setTrustPopoverOpen] = useState(false);
  const [trustSheetOpen, setTrustSheetOpen] = useState(false);
  const [trustGraceElapsed, setTrustGraceElapsed] = useState(false);
  const [trustHiddenCount, setTrustHiddenCount] = useState(0);
  const trustFilterEnabled = trustFilterOn && trustWotEnabled && trustExcludedTiers.size > 0;

  useEffect(() => { setTrustFilterOn(readOutpostFilterOn(relayUrl)); setTrustHiddenCount(0); }, [relayUrl]);
  // Hidden count is per-tab; reset when switching tabs so the badge reflects the view.
  useEffect(() => { setTrustHiddenCount(0); }, [activeTab]);

  // Grace window so unscored/"none" authors aren't hidden during the initial score load.
  useEffect(() => {
    if (!trustFilterEnabled) { setTrustGraceElapsed(false); return; }
    setTrustGraceElapsed(false);
    const t = setTimeout(() => setTrustGraceElapsed(true), 1800);
    return () => clearTimeout(t);
  }, [trustFilterEnabled, relayUrl]);

  const toggleTrustFilter = useCallback(() => {
    setTrustFilterOn((prev) => { const next = !prev; writeOutpostFilterOn(relayUrl, next); return next; });
  }, [relayUrl]);

  const isHiddenByTrustFn = useCallback((pk: string) => isHiddenByTrust({
    enabled: trustFilterEnabled,
    excludedTiers: trustExcludedTiers,
    influence: trustGetInfluence(pk),
    flagged: trustIsFlagged(pk),
    resolved: !!trustScores?.has(pk) || trustGraceElapsed,
  }), [trustFilterEnabled, trustExcludedTiers, trustGetInfluence, trustIsFlagged, trustScores, trustGraceElapsed]);

  const feedTrustFiltered = useMemo(
    () => (trustFilterEnabled ? events.filter((e) => !isHiddenByTrustFn(e.pubkey)) : events),
    [events, trustFilterEnabled, isHiddenByTrustFn],
  );
  // Posts / Replies / All lens on top of the trust filter. Kind-1 notes only; a
  // note with a reply marker is a reply, otherwise a top-level post.
  const feedContentFiltered = useMemo(
    () => (feedContentFilter === "all"
      ? feedTrustFiltered
      : feedTrustFiltered.filter((e) => isReplyEvent(e.tags) ? feedContentFilter === "replies" : feedContentFilter === "posts")),
    [feedTrustFiltered, feedContentFilter],
  );
  useEffect(() => {
    if (activeTab === "feed") {
      setTrustHiddenCount(trustFilterEnabled ? events.length - feedTrustFiltered.length : 0);
    }
  }, [activeTab, trustFilterEnabled, events.length, feedTrustFiltered.length]);

  const handleRetryAuth = useCallback(() => {
    resetAuthState(relayUrl);
    pool.close([relayUrl]);
    setTimeout(() => {
      window.location.reload();
    }, 300);
  }, [relayUrl]);

  // In-context moderation: a post's menu opens a reason dialog, then the
  // confirmed action runs the NIP-86 call, prunes the feed, and records a mod-log
  // entry (visible in Relay Ops → Access Control). Banning also reflects into the
  // Access Control blocklist so the two surfaces stay in sync.
  const [modAction, setModAction] = useState<{ kind: "remove" | "ban"; eventId: string; pubkey: string } | null>(null);
  const [modReason, setModReason] = useState("");
  const [modBusy, setModBusy] = useState(false);

  const openRemove = useCallback((eventId: string) => {
    setModReason("");
    setModAction({ kind: "remove", eventId, pubkey: eventMapRef.current.get(eventId)?.pubkey || "" });
  }, []);
  const openBan = useCallback((authorPubkey: string, eventId: string) => {
    setModReason("");
    setModAction({ kind: "ban", eventId, pubkey: authorPubkey });
  }, []);

  const confirmModAction = useCallback(async () => {
    if (!modAction) return;
    const reason = modReason.trim();
    setModBusy(true);
    try {
      if (modAction.kind === "remove") {
        const res = await banEvent(relayUrl, modAction.eventId, reason || "Removed by moderator");
        if (res.error) { toast({ title: "Failed to remove", description: res.error, variant: "destructive" }); return; }
        setEvents(prev => prev.filter(e => e.id !== modAction.eventId));
        eventMapRef.current.delete(modAction.eventId);
        addModLogEntry(relayUrl, { action: "delete_event", targetEventId: modAction.eventId, targetPubkey: modAction.pubkey || undefined, note: reason || undefined });
        toast({ title: "Content removed from relay" });
      } else {
        const res = await banPubkey(relayUrl, modAction.pubkey, reason || "Banned by moderator");
        if (res.error) { toast({ title: "Failed to ban author", description: res.error, variant: "destructive" }); return; }
        const blocklist = getStoredList(ADMIN_BLOCKLIST_KEY, relayUrl);
        if (!blocklist.includes(modAction.pubkey)) saveStoredList(ADMIN_BLOCKLIST_KEY, relayUrl, [...blocklist, modAction.pubkey]);
        setEvents(prev => prev.filter(e => e.pubkey !== modAction.pubkey));
        addModLogEntry(relayUrl, { action: "block_author", targetPubkey: modAction.pubkey, note: reason || undefined });
        toast({ title: "Author banned from relay" });
      }
      setModAction(null);
    } finally {
      setModBusy(false);
    }
  }, [modAction, modReason, relayUrl, toast]);

  // Yield-aware page size (lib/adaptive-page.ts): grows while the trust
  // filter eats pages so one round-trip buys a screenful, settles back when
  // yield recovers. Reset per relay via the relay-change cleanup below.
  const pageLimitRef = useRef(BASE_PAGE_LIMIT);
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || !eoseReceivedRef.current) return;
    setLoadingMore(true);

    const oldest = events[events.length - 1];
    if (!oldest) { setHasMore(false); setLoadingMore(false); return; }

    const currentRelay = relayUrl;
    loadMoreRelayRef.current = currentRelay;
    const requestedLimit = pageLimitRef.current;

    if (loadMoreSubRef.current) { loadMoreSubRef.current.close(); loadMoreSubRef.current = null; }
    if (loadMoreTimerRef.current) { clearTimeout(loadMoreTimerRef.current); loadMoreTimerRef.current = null; }

    const batchEvents: NostrEvent[] = [];
    let rawCount = 0;

    function finalize() {
      loadMoreSubRef.current = null;
      loadMoreTimerRef.current = null;
      if (loadMoreRelayRef.current !== currentRelay) return;
      // Short RAW page = the relay ran out (proportional to what we asked
      // for, not a hardcoded 30 — an adaptive ask needs an adaptive bar).
      if (rawCount < requestedLimit || batchEvents.length === 0) setHasMore(false);
      // What the user actually GAINED this round decides the next page size.
      const visibleAdded = trustFilterEnabled
        ? batchEvents.filter((e) => !isHiddenByTrustFn(e.pubkey)).length
        : batchEvents.length;
      pageLimitRef.current = nextPageLimit({ prevLimit: requestedLimit, rawCount, visibleAdded });
      if (batchEvents.length > 0) {
        setEvents(prev => {
          const merged = [...prev, ...batchEvents];
          merged.sort((a, b) => b.created_at - a.created_at);
          return merged;
        });
        setAuthors(Array.from(authorSetRef.current));
      }
      setLoadingMore(false);
    }

    const loadMoreSub = pool.subscribeMany(
      [currentRelay],
      { kinds: [1], limit: requestedLimit, until: oldest.created_at },
      {
        onevent(e: NostrEvent) {
          rawCount++;
          if (eventMapRef.current.has(e.id)) return;
          eventMapRef.current.set(e.id, e);
          eventStore.add(e);
          batchEvents.push(e);
          const isNewAuthor = !authorSetRef.current.has(e.pubkey);
          authorSetRef.current.add(e.pubkey);
          if (isNewAuthor) fetchProfilesCached([e.pubkey]);
        },
        oneose() {
          if (loadMoreTimerRef.current) { clearTimeout(loadMoreTimerRef.current); loadMoreTimerRef.current = null; }
          loadMoreSub.close();
          finalize();
        } },
    );
    loadMoreSubRef.current = loadMoreSub;
    loadMoreTimerRef.current = setTimeout(() => {
      loadMoreSub.close();
      finalize();
    }, 8000);
  }, [relayUrl, events, loadingMore, hasMore, trustFilterEnabled, isHiddenByTrustFn]);

  const showBufferedPosts = useCallback(() => {
    const buffered = bufferedNewRef.current;
    if (buffered.length === 0) return;
    setEvents(prev => {
      const merged = [...buffered, ...prev];
      merged.sort((a, b) => b.created_at - a.created_at);
      return merged;
    });
    bufferedNewRef.current = [];
    setBufferedNewCount(0);
  }, []);

  const handleJoinLeave = async () => {
    if (joined) {
      setShowLeaveConfirm(true);
    } else {
      const access = authRequired ? "private" as const : "public" as const;
      joinOutpost(relayUrl, name, access, pubkey);
      setJoined(true);
      toast({ title: `Joined ${name}` });
      await updateNip65RelayList("add", relayUrl);
      await publishCommunitySubscriptions();
    }
  };

  const handleConfirmLeave = async () => {
    leaveOutpost(relayUrl);
    setJoined(false);
    setShowLeaveConfirm(false);
    toast({ title: `Left ${name}` });
    await updateNip65RelayList("remove", relayUrl);
    // You left — an empty list is the honest result, not an accident.
    await publishCommunitySubscriptions({ allowEmpty: true });
  };

  const handleCompose = useCallback((mode: "note" | "topic") => {
    setComposeMode(mode);
    setShowCompose(true);
  }, []);

  useEffect(() => {
    registerOutpostCompose({
      relayUrl,
      activeTab,
      triggerCompose: handleCompose,
      canPostHorizon });
    return () => unregisterOutpostCompose();
  }, [relayUrl, activeTab, handleCompose, canPostHorizon, registerOutpostCompose, unregisterOutpostCompose]);

  const TAB_CONFIG: { key: OutpostTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
    { key: "feed", label: "Posts", icon: TimelineIcon, hint: "The community feed — short posts" },
    // Self-hiding: only relays whose operator curated something get the tab.
    ...(featuredSets.length > 0 ? [{ key: "featured" as OutpostTab, label: "Featured", icon: MagicStarIcon, hint: "Hand-picked by this relay's operators" }] : []),
    { key: "topics", label: "Discussions", icon: WavesIcon, hint: "Threaded discussions people can reply to and vote on" },
    { key: "channels", label: "Chat", icon: ChannelsIcon, hint: "Real-time chat rooms" },
    { key: "horizon", label: "Articles", icon: HorizonIcon, hint: "Long-form articles" },
    { key: "about", label: "About", icon: AboutIcon, hint: "About this community" },
  ];

  // Invite + Join/Leave + expand chevron — shared by the top-bar portal strip
  // and the inline fallback strip (rendered when the top bar is unmounted,
  // i.e. desktop with the sidebar expanded).
  const stripActions = (
    <div className="flex items-center gap-1.5 shrink-0 group-data-[audio=true]:hidden">
      {pubkey && (
        <button
          type="button"
          onClick={() => { setOutpostLinkCopied(false); setOutpostInviteRecipient(null); setShowOutpostInvite(true); }}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-black/40 border border-white/20 text-white/90 hover:text-white hover:bg-black/55 active:scale-95 transition-[background-color,color,transform]"
          aria-label="Invite to this community"
          title="Invite to this community"
          data-testid="button-invite-outpost-strip"
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
      )}
      {joined ? (
        <button
          type="button"
          onClick={handleJoinLeave}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-black/40 border border-white/20 text-white/90 hover:text-red-300 hover:bg-black/55 active:scale-95 transition-[background-color,color,transform]"
          aria-label="Leave this community"
          title="Leave"
          data-testid="button-leave-outpost-strip"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleJoinLeave}
          className="flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold border bg-black/40 hover:bg-black/55 text-white/90 border-white/20 active:scale-95 transition-[background-color,color,transform]"
          data-testid="button-join-outpost-strip"
        >
          <LogIn className="w-3.5 h-3.5" />
          Join
        </button>
      )}
      <button
        type="button"
        onClick={() => setHeaderCollapsed((c) => !c)}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-black/40 border border-white/20 text-white/85 hover:text-white hover:bg-black/55 active:scale-95 transition-[background-color,color,transform]"
        aria-expanded={!headerCollapsed}
        aria-label={headerCollapsed ? "Show full banner" : "Condense banner"}
        title={headerCollapsed ? "Show full banner" : "Condense banner"}
        data-testid="button-toggle-outpost-header"
      >
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${headerCollapsed ? "" : "rotate-180"}`} />
      </button>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 pb-24 space-y-4">
      <div ref={scrollContainerRef} className="flex-1 min-w-0 space-y-4 overflow-y-auto overflow-x-hidden pb-8">
        <Card className="glass-card overflow-hidden">
          {nip11Loading ? (
            <div className="flex items-center justify-center py-10">
              <RelayOutpostInlineLoader className="w-6 h-6" />
            </div>
          ) : (
            <>
              {/* Identity lives in the global top bar (portal into
                  #header-identity-slot), exactly like profiles: banner shows
                  through the bar (.header-banner-bg makes it transparent and
                  flips its chrome white), ⌄ expands the full banner card below.
                  Operator credit + health live in the expanded view. */}
              {headerSlotEl && createPortal(
                <div className="flex w-full items-center gap-2 min-w-0 pr-1" data-testid="container-outpost-strip">
                  <div className="header-banner-bg absolute inset-0 -z-10 overflow-hidden pointer-events-none group-data-[audio=true]:hidden" aria-hidden="true">
                    {banner
                    ? <img src={banner} alt="" loading="eager" decoding="async" className="w-full h-full object-cover" />
                    : icon
                      ? <img src={icon} alt="" aria-hidden loading="eager" decoding="async" className="w-full h-full object-cover scale-125 blur-2xl saturate-150 opacity-70" />
                      : <div className="w-full h-full bg-gradient-to-br from-brand/30 via-[#14101f] to-black" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setHeaderCollapsed((c) => !c)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    aria-label={headerCollapsed ? "Show full banner" : "Condense banner"}
                    data-testid="button-header-identity"
                  >
                    <Avatar className="w-7 h-7 border border-white/25 shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-1 ring-brand/20 shrink-0">
                      <AvatarImage src={icon || undefined} alt={name} />
                      <AvatarFallback className="bg-brand/20 text-brand text-[10px] font-bold">
                        {name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-bold text-white truncate group-data-[audio=true]:hidden" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }} data-testid="text-strip-name">
                      {name}
                    </span>
                    {authRequired && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-400/50 text-amber-300 bg-amber-500/15 backdrop-blur-sm shadow-sm shrink-0 group-data-[audio=true]:hidden">
                        <Lock className="w-2.5 h-2.5 mr-0.5" />
                        AUTH
                      </Badge>
                    )}
                  </button>
                  {stripActions}
                </div>,
                headerSlotEl,
              )}

              {/* Inline fallback strip: on desktop with the sidebar expanded
                  the top bar (and its identity slot) is unmounted, so the
                  condensed identity renders here instead — the pre-slot ~56px
                  banner strip above the tabs. The same ⌄ expands the full
                  banner card below. */}
              {!headerSlotEl && headerCollapsed && (
                <div className="relative h-14 w-full overflow-hidden" style={{ backgroundColor: "hsl(260 20% 7%)" }} data-testid="container-outpost-strip">
                  {banner
                    ? <img src={banner} alt="" loading="eager" decoding="async" className="w-full h-full object-cover" />
                    : icon
                      ? <img src={icon} alt="" aria-hidden loading="eager" decoding="async" className="w-full h-full object-cover scale-125 blur-2xl saturate-150 opacity-70" />
                      : <div className="w-full h-full bg-gradient-to-br from-brand/30 via-[#14101f] to-black" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
                  <div className="absolute inset-y-0 left-3 right-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setHeaderCollapsed(false)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      aria-label="Show full banner"
                      data-testid="button-header-identity"
                    >
                      <Avatar className="w-8 h-8 border border-white/25 shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-1 ring-brand/20 shrink-0">
                        <AvatarImage src={icon || undefined} alt={name} />
                        <AvatarFallback className="bg-brand/20 text-brand text-[11px] font-bold">
                          {name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-bold text-white truncate" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)" }} data-testid="text-strip-name">
                        {name}
                      </span>
                      {authRequired && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-400/50 text-amber-300 bg-amber-500/15 backdrop-blur-sm shadow-sm shrink-0">
                          <Lock className="w-2.5 h-2.5 mr-0.5" />
                          AUTH
                        </Badge>
                      )}
                    </button>
                    {stripActions}
                  </div>
                </div>
              )}

              {!headerCollapsed && (
                <OutpostHero
                  relayUrl={relayUrl}
                  realName={name}
                  bannerSrc={banner || undefined}
                  avatarUrl={icon || undefined}
                  authRequired={!!authRequired}
                  description={description}
                  presence={outpostPresenceProps({
                    membersMeasured: members.length > 0,
                    membersCount: members.length,
                    postsCount: 0,
                    lastActivityMs: lastActivity ? lastActivity * 1000 : undefined,
                  })}
                  memberPubkeys={members}
                  healthBadge={members.length > 0 ? <OutpostHealthBadge relayUrl={relayUrl} members={members} lastActivityTs={lastActivity} compact /> : undefined}
                  operatorCredit={operatorPubkey ? <OperatorMiniAvatar pubkey={operatorPubkey} /> : undefined}
                  condenseControl={
                    <button
                      type="button"
                      onClick={() => setHeaderCollapsed(true)}
                      className="flex items-center justify-center w-9 h-9 rounded-full bg-black/40 border border-white/20 text-white/85 hover:text-white hover:bg-black/55 active:scale-95 transition-[background-color,color,transform]"
                      aria-expanded
                      aria-label="Condense banner"
                      title="Condense banner"
                      data-testid="button-toggle-outpost-banner"
                    >
                      <ChevronDown className="w-4 h-4 rotate-180 transition-transform duration-200" />
                    </button>
                  }
                  actions={
                    <div className="flex items-center justify-center gap-2">
                      {pubkey && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setOutpostLinkCopied(false); setOutpostInviteRecipient(null); setShowOutpostInvite(true); }}
                          className="h-9 text-xs px-3 border-brand/20 text-muted-foreground/70 hover:text-brand gap-1"
                          title="Invite to this community"
                          data-testid="button-invite-outpost"
                        >
                          <Link2 className="w-3 h-3" />
                          Invite
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={joined ? "outline" : "default"}
                        onClick={handleJoinLeave}
                        className={`h-9 text-xs px-4 ${
                          joined
                            ? "border-primary/20 text-muted-foreground/70 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/30"
                            : "bg-primary hover:bg-primary/90 text-primary-foreground"
                        }`}
                      >
                        {joined ? (
                          <>
                            <LogOut className="w-3 h-3 mr-1" />
                            Leave
                          </>
                        ) : (
                          <>
                            <LogIn className="w-3 h-3 mr-1" />
                            Join
                          </>
                        )}
                      </Button>
                    </div>
                  }
                  metaRow={(operatorPubkey || (nip11?.blossom_servers && nip11.blossom_servers.length > 0) || sw || (pubkey && isJoined && (isOperator || !operatorClaimBlocked)) || (tags && tags.length > 0)) ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground/50">
                        {operatorPubkey && (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wider shrink-0">Operated by</span>
                            <OperatorBadge pubkey={operatorPubkey} />
                          </div>
                        )}
                        {operatorPubkey && <div className="flex-1" />}
                        {nip11?.blossom_servers && nip11.blossom_servers.length > 0 && (
                          <span className="flex items-center gap-1 text-emerald-600/70 dark:text-emerald-400/70" title={`Media hosted by ${nip11.blossom_servers.map(s => { try { return new URL(s).hostname; } catch { return s; } }).join(", ")}`}>
                            <Package className="w-3 h-3" />
                            <span className="hidden sm:inline">Blossom</span>
                          </span>
                        )}
                        {sw && (
                          <span className="flex items-center gap-1 hidden sm:flex">
                            <Server className="w-3 h-3" />
                            {sw}
                          </span>
                        )}
                        {pubkey && isJoined && (isOperator || !operatorClaimBlocked) && (
                          <button
                            onClick={toggleOperatorMode}
                            className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors duration-200 shrink-0 ${
                              isOperator
                                ? "bg-primary/20 border border-primary/30"
                                : "bg-muted/60 dark:bg-white/[0.06] border border-border/50 dark:border-white/[0.08]"
                            }`}
                            title={
                              isOperator
                                ? "Operator mode is on. Click to disable."
                                : nip11Operator
                                  ? "Re-enable operator mode (currently overridden off)."
                                  : "Enable operator mode (I operate this relay)."
                            }
                            data-testid="button-operator-mode-toggle"
                            aria-label="Toggle operator mode"
                          >
                            <span className={`inline-block w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                              isOperator
                                ? "translate-x-[18px] bg-primary dark:bg-brand"
                                : "translate-x-[3px] bg-muted-foreground/30"
                            }`} />
                          </button>
                        )}
                        {isOperator && (
                          <Link href={`/relay-ops-center/${encodeURIComponent(relayUrl)}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-brand"
                              title="Relay Control"
                            >
                              <Settings className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        )}
                      </div>
                      {tags && tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap justify-center">
                          {tags.map((tag) => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className="text-[9px] h-4 px-1.5 border-brand/15 text-brand/70 bg-brand/5"
                            >
                              <Hash className="w-2 h-2 mr-0.5" />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : undefined}
                />
              )}
            </>
          )}
        </Card>

        {(() => {
          const activeTabConfig = TAB_CONFIG.find((t) => t.key === activeTab);
          const composeAction = pubkey && activeTab !== "about" ? (
            activeTab === "horizon" ? (
              canPostHorizon ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHorizonDialogOpen(true)}
                  className="h-7 text-[11px] text-brand/70 hover:text-brand gap-1 -mb-px"
                >
                  <PenSquare className="w-3 h-3" />
                  <span className="hidden sm:inline">New article</span>
                </Button>
              ) : null
            ) : relayReady ? (
              activeTab === "channels" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCreateChannelOpen(true)}
                  title="New room"
                  aria-label="New room"
                  className="h-7 text-[11px] text-brand/70 hover:text-brand gap-1 -mb-px"
                >
                  <PenSquare className="w-3 h-3" />
                  <span className="hidden sm:inline">New room</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCompose(activeTab === "topics" ? "topic" : "note")}
                  className="h-7 text-[11px] text-brand/70 hover:text-brand gap-1 -mb-px"
                >
                  <PenSquare className="w-3 h-3" />
                  <span className="hidden sm:inline">{activeTab === "topics" ? "New discussion" : "New post"}</span>
                </Button>
              )
            ) : relayAuthFailed ? (
              <span className="text-[10px] text-red-700/70 dark:text-red-400/70 flex items-center gap-1 -mb-px">
                <ShieldAlert className="w-3 h-3" />
                <span className="hidden sm:inline">Auth failed</span>
              </span>
            ) : relayStatusLabel ? (
              <span className="text-[10px] text-amber-600/60 dark:text-amber-400/60 flex items-center gap-1 -mb-px">
                <RelayOutpostInlineLoader className="w-3 h-3" />
                <span className="hidden sm:inline">{relayStatusLabel}</span>
              </span>
            ) : null
          ) : null;

          const pinAction = (PINNABLE_TABS as string[]).includes(activeTab) ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleTogglePin}
              className={`h-7 w-7 p-0 -mb-px ${feedPinned ? "text-brand" : "text-muted-foreground/50 hover:text-muted-foreground/80"}`}
              title={feedPinned ? "Unpin this view" : "Pin this view"}
            >
              {feedPinned ? <Pin className="w-3.5 h-3.5 rotate-45" /> : <PinOff className="w-3.5 h-3.5" />}
            </Button>
          ) : null;

          // Mobile twin of pinAction — the desktop pin lives in a `hidden sm:flex`
          // cluster, which left phones with NO visible pin affordance (the only
          // path was the non-obvious tap-the-active-tab options sheet). Same
          // handler/state; sized to match the mobile trust-shield button.
          const pinActionMobile = (PINNABLE_TABS as string[]).includes(activeTab) ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleTogglePin}
              className={`h-9 w-9 p-0 shrink-0 ${feedPinned ? "text-brand" : "text-muted-foreground/60 hover:text-muted-foreground/90"}`}
              aria-label={feedPinned ? "Unpin this view from your hub" : "Pin this view to your hub"}
              title={feedPinned ? "Unpin this view" : "Pin this view"}
              data-testid="button-outpost-pin-mobile"
            >
              {feedPinned ? <Pin className="w-4 h-4 rotate-45" /> : <PinOff className="w-4 h-4" />}
            </Button>
          ) : null;

          // Shared self-contained panel — switch + tiers + count + explainer — reused by
          // the desktop popover and the mobile bottom-sheet (one model on both breakpoints).
          const trustPanel = (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">Apply trust filter</p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {trustFilterOn ? (trustHiddenCount > 0 ? `Hiding ${trustHiddenCount} on this tab` : "On") : "Off — showing everyone"}
                  </p>
                </div>
                <Switch checked={trustFilterOn} onCheckedChange={toggleTrustFilter} data-testid="switch-outpost-trust-filter" />
              </div>
              <div className={trustFilterOn ? "" : "opacity-50 pointer-events-none select-none"}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Hide these tiers</p>
                  {trustExcludedTiers.size > 0 && (
                    <button onClick={clearTrustTiers} className="text-[10px] text-brand/70 hover:text-brand" data-testid="button-trust-reset">Reset</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FEED_FILTER_TIERS.map((tier) => {
                    const excluded = trustExcludedTiers.has(tier);
                    return (
                      <button
                        key={tier}
                        onClick={() => toggleTrustTier(tier)}
                        title={excluded ? `Show ${getSignalTierLabel(tier)}` : `Hide ${getSignalTierLabel(tier)}`}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-colors ${
                          excluded
                            ? "border-border/40 bg-muted/40 text-muted-foreground/60 line-through"
                            : "border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10"
                        }`}
                        data-testid={`trust-tier-${tier}`}
                      >
                        <TrustTierGlyph tier={tier} size="w-2 h-2" decorative className={excluded ? "opacity-30" : ""} />
                        {getSignalTierLabel(tier)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                Applies across Posts, Discussions, Chat &amp; Articles in this community. Excluding “None” hides people outside your network. Your selection is shared with your feed.
              </p>
            </div>
          );

          const trustActionDesktop = trustWotEnabled && activeTab !== "about" ? (
            <Popover open={trustPopoverOpen} onOpenChange={setTrustPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`h-7 gap-1.5 px-2 text-xs -mb-px shrink-0 ${trustFilterEnabled ? "text-brand" : "text-muted-foreground/50 hover:text-muted-foreground/80"}`}
                  title="Trust filter for this community"
                  data-testid="button-outpost-trust-filter"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Trust filter</span>
                  {trustFilterEnabled && trustHiddenCount > 0 && (
                    <span className="rounded-full bg-brand/15 text-brand px-1.5 py-0.5 text-[10px] leading-none">{trustHiddenCount} hidden</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3">
                {trustPanel}
              </PopoverContent>
            </Popover>
          ) : null;

          const trustActionMobile = trustWotEnabled && activeTab !== "about" ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTrustSheetOpen(true)}
                className={`relative h-9 w-9 p-0 shrink-0 ${trustFilterEnabled ? "text-brand" : "text-muted-foreground/60 hover:text-muted-foreground/90"}`}
                aria-label="Trust filter"
                data-testid="button-outpost-trust-filter-mobile"
              >
                <ShieldCheck className="w-4 h-4" />
                {trustFilterEnabled && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary ring-2 ring-background" />}
              </Button>
              <Sheet open={trustSheetOpen} onOpenChange={setTrustSheetOpen}>
                <SheetContent side="bottom" className="rounded-t-2xl px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                  <SheetTitle className="text-sm font-brand tracking-wide mb-3">Trust filter</SheetTitle>
                  {trustPanel}
                </SheetContent>
              </Sheet>
            </>
          ) : null;

          return (
            <>
              {/* ONE PageTabs row on both breakpoints (the desktop underline
                  variant is gone). Tapping the already-active tab opens its
                  options sheet (Show filter, Pin, per-tab create) — the ⌄ on
                  the active tab is the affordance, matching the feed pills.
                  Trust/pin/compose ride beside the row on desktop; the trust
                  shield and the pin ride it on mobile. */}
              <div className="flex items-center gap-1.5 border-b border-border/30 pb-2">
                <PageTabs
                  className="flex-1 min-w-0"
                  testId="container-outpost-tabs"
                  ariaLabel="Community sections"
                  active={activeTab}
                  onChange={(key) => {
                    const hasSheet = key !== "about";
                    if (key === activeTab && hasSheet) { setTabDropdownOpen(true); return; }
                    setActiveTab(key as OutpostTab);
                    if (key !== "topics") setWaveThreadOpen(false);
                  }}
                  tabs={TAB_CONFIG.map((tab) => ({
                    key: tab.key,
                    label: tab.label,
                    icon: tab.icon,
                    title: tab.hint,
                    ariaLabel: tab.label,
                    testId: `tab-outpost-${tab.key}`,
                    badge: activeTab === tab.key && tab.key !== "about" ? (
                      <ChevronDown className="w-3 h-3 shrink-0 opacity-70" aria-hidden="true" />
                    ) : undefined,
                  }))}
                />
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  {trustActionDesktop}
                  {pinAction}
                  {composeAction}
                </div>
                <div className="sm:hidden flex items-center shrink-0">
                  {trustActionMobile}
                  {pinActionMobile}
                </div>
              </div>

              {/* Active-tab options sheet — same shell as the feed/Saved sheets. */}
              <Sheet open={tabDropdownOpen} onOpenChange={setTabDropdownOpen}>
                <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]" data-testid="outpost-tab-sheet">
                  <SheetTitle className="text-sm font-brand uppercase tracking-widest mb-4">
                    {activeTabConfig?.label ?? "Tab"} options
                  </SheetTitle>
                  <div className="space-y-5">
                    {activeTab === "feed" && (
                      <Segment
                        label="Show"
                        options={[{ value: "posts", label: "Posts" }, { value: "replies", label: "Replies" }, { value: "all", label: "All" }]}
                        value={feedContentFilter}
                        onChange={(v) => { setFeedContentFilter(v); setTabDropdownOpen(false); }}
                        testPrefix="outpost-show"
                      />
                    )}
                    {activeTab === "featured" && featuredSets.length > 0 && (
                      <Segment
                        label="Feed"
                        options={featuredSets.map((f) => ({ value: `${f.pubkey}:${f.dTag}`, label: f.title }))}
                        value={featuredCoord ?? `${featuredSets[0].pubkey}:${featuredSets[0].dTag}`}
                        onChange={(v) => { setFeaturedCoord(v); setTabDropdownOpen(false); }}
                        testPrefix="outpost-featured-feed"
                        cols={2}
                      />
                    )}
                    <div className="grid grid-cols-1 gap-1.5">
                      {(PINNABLE_TABS as string[]).includes(activeTab) && (
                        <button
                          type="button"
                          onClick={() => { handleTogglePin(); setTabDropdownOpen(false); }}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium border border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25 transition-all text-left"
                          data-testid="sheet-toggle-pin"
                        >
                          {feedPinned ? <Pin className="w-4 h-4 shrink-0 rotate-45 text-brand" /> : <PinOff className="w-4 h-4 shrink-0" />}
                          {feedPinned ? "Unpin this view from your hub" : "Pin this view to your hub"}
                        </button>
                      )}
                      {activeTab === "topics" && relayReady && (
                        <button
                          type="button"
                          onClick={() => { handleCompose("topic"); setTabDropdownOpen(false); }}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium border border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25 transition-all text-left"
                          data-testid="sheet-new-discussion"
                        >
                          <PenSquare className="w-4 h-4 shrink-0" />
                          New discussion
                        </button>
                      )}
                      {activeTab === "channels" && relayReady && (
                        <button
                          type="button"
                          onClick={() => { setCreateChannelOpen(true); setTabDropdownOpen(false); }}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium border border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25 transition-all text-left"
                          data-testid="sheet-new-channel"
                        >
                          <PenSquare className="w-4 h-4 shrink-0" />
                          New channel
                        </button>
                      )}
                      {activeTab === "horizon" && relayReady && pubkey && (
                        <button
                          type="button"
                          onClick={() => { setHorizonDialogOpen(true); setTabDropdownOpen(false); }}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium border border-border dark:border-brand/10 bg-muted text-muted-foreground/80 hover:border-brand/25 transition-all text-left"
                          data-testid="sheet-new-article"
                        >
                          <PenSquare className="w-4 h-4 shrink-0" />
                          New article
                        </button>
                      )}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          );
        })()}

        {relayAuthFailed && authRequired ? (
          <Card className="glass-card border-amber-500/20 p-8">
            <div className="flex flex-col items-center gap-4 text-center max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Lock className="w-7 h-7 text-amber-500/70 dark:text-amber-400/70" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-brand tracking-wide text-foreground/90">Members only</h3>
                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                  This is a private community and the relay didn't authorize you — you're not on its allowlist. You can ask the operator for access, or leave it.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                {operatorPubkey && (
                  <Button
                    size="sm"
                    onClick={() => setLocation(`/messages/${formatNpub(operatorPubkey)}`)}
                    className="gap-2 text-xs"
                    data-testid="button-request-access"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Request access from the operator
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetryAuth}
                    className="flex-1 gap-2 text-xs border-primary/30 hover:border-primary/50 hover:bg-primary/10"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </Button>
                  {joined && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowLeaveConfirm(true)}
                      className="flex-1 gap-2 text-xs text-muted-foreground/70 hover:text-foreground"
                      data-testid="button-leave-noaccess"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Leave
                    </Button>
                  )}
                </div>
                {!pubkey && (
                  <p className="text-[10px] text-amber-600/50 dark:text-amber-400/50">
                    Sign in first to authenticate with this relay.
                  </p>
                )}
              </div>
            </div>
          </Card>
        ) : relayConnecting && authRequired ? (
          <Card className="glass-card border-amber-500/20 p-8">
            <div className="flex flex-col items-center gap-4 text-center max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <RelayOutpostInlineLoader className="w-7 h-7 text-amber-600/60 dark:text-amber-400/60" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-brand tracking-wide text-foreground/90">Authenticating</h3>
                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                  Verifying your identity with this relay. Check your signer if prompted.
                </p>
              </div>
            </div>
          </Card>
        ) : (
        <>

        {activeTab === "feed" && (
          <div className="space-y-2">
            <FeaturedStrip relayUrl={relayUrl} operatorPubkey={operatorPubkey} />
            {/* No "Recent Activity" heading — the Posts tab IS the activity.
                The Posts/Replies/All filter shows inline on desktop only; on
                mobile it lives in the active-pill options sheet. */}
            <div className="hidden sm:flex items-center gap-2 flex-wrap">
              {loading && <RelayOutpostInlineLoader className="w-3.5 h-3.5" />}
              <div
                className="flex items-center gap-0.5 shrink-0 ml-auto"
                role="group"
                aria-label="Filter by posts, replies, or all"
                data-testid="container-outpost-content-filter"
              >
                {([["posts", "Posts"], ["replies", "Replies"], ["all", "All"]] as const).map(([val, label]) => {
                  const active = feedContentFilter === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setFeedContentFilter(val)}
                      aria-pressed={active}
                      aria-label={`Show ${label.toLowerCase()}`}
                      className={`rounded-full px-3 min-h-[36px] sm:min-h-0 py-1 text-[11px] font-medium transition-colors ${ active ? "bg-accent text-accent-foreground border border-brand/20 dark:bg-brand/15 dark:text-brand dark:border-brand/25" : "text-muted-foreground/60 hover:text-muted-foreground border border-transparent" }`}
                      data-testid={`button-outpost-content-filter-${val}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {bufferedNewCount > 0 && (
              <NewPostsBanner count={bufferedNewCount} onClick={showBufferedPosts} />
            )}

            {loading && events.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[120px] gap-3">
                <RelayOutpostInlineLoader className="w-6 h-6" />
                <p className="text-xs text-muted-foreground/50">Fetching posts from relay...</p>
              </div>
            ) : !loading && events.length === 0 ? (
              <Card className="glass-card p-6">
                <div className="flex flex-col items-center gap-2 text-center">
                  <MessageSquare className="w-8 h-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground/50">No recent posts found</p>
                  <p className="text-[10px] text-muted-foreground/30">
                    This relay may have limited public content.
                  </p>
                </div>
              </Card>
            ) : (
              <div className="space-y-2">
                {trustFilterEnabled && events.length > 0 && feedTrustFiltered.length === 0 ? (
                  <Card className="glass-card p-6">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <ShieldCheck className="w-8 h-8 text-muted-foreground/20" />
                      <p className="text-sm text-muted-foreground/50">Everything here is hidden by your trust filter</p>
                      <p className="text-[10px] text-muted-foreground/30">Loosen the filter (top right) to see more.</p>
                    </div>
                  </Card>
                ) : feedContentFilter !== "all" && feedTrustFiltered.length > 0 && feedContentFiltered.length === 0 ? (
                  <Card className="glass-card p-6">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <MessageSquare className="w-8 h-8 text-muted-foreground/20" />
                      <p className="text-sm text-muted-foreground/50">
                        {feedContentFilter === "replies" ? "No replies in view" : "No top-level posts in view"}
                      </p>
                      <p className="text-[10px] text-muted-foreground/30">Switch to All to see everything.</p>
                    </div>
                  </Card>
                ) : (
                  feedContentFiltered.map((event) => (
                    <NostrPost
                      key={event.id}
                      event={event}
                      onModeratorRemove={canModerate ? openRemove : undefined}
                      onModeratorBanAuthor={canModerate ? openBan : undefined}
                    />
                  ))
                )}
                <InfiniteScrollSentinel
                  onLoadMore={loadMore}
                  isLoading={loadingMore}
                  hasMore={hasMore}
                />
              </div>
            )}
          </div>
        )}

        <AlertDialog open={!!modAction} onOpenChange={(o) => { if (!o && !modBusy) setModAction(null); }}>
          <AlertDialogContent className="glass-dialog-card max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm font-brand tracking-wide">
                {modAction?.kind === "ban" ? "Ban author from relay?" : "Remove from relay?"}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground/70">
                {modAction?.kind === "ban"
                  ? "Their posts will be removed from this relay and they'll be added to your blocklist."
                  : "This removes the post from your relay."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={modReason}
              onChange={(e) => setModReason(e.target.value)}
              placeholder="Reason (optional, logged)"
              className="text-base sm:text-sm"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && !modBusy) confirmModAction(); }}
              data-testid="input-mod-reason"
            />
            <AlertDialogFooter>
              <AlertDialogCancel className="h-8 text-xs" disabled={modBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="h-8 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => { e.preventDefault(); confirmModAction(); }}
                disabled={modBusy}
                data-testid="button-confirm-mod-action"
              >
                {modBusy ? "Working…" : modAction?.kind === "ban" ? "Ban author" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {activeTab === "topics" && (
          <TopicsTab
            relayUrl={relayUrl}
            externalRefreshKey={feedRefreshKey}
            canModerate={canModerate}
            operatorPubkey={operatorPubkey || undefined}
            onThreadOpen={setWaveThreadOpen}
            authRequired={authRequired}
            trustFilterEnabled={trustFilterEnabled}
            isHiddenByTrust={isHiddenByTrustFn}
            onTrustHidden={setTrustHiddenCount}
          />
        )}

        {activeTab === "channels" && (() => {
          const commsTab = (opts: { createChannelOpen?: boolean; onCreateChannelClose?: () => void }) => (
            <CommsTab
              key={liveChannel || "default"}
              relayUrl={relayUrl}
              createChannelOpen={opts.createChannelOpen}
              onCreateChannelClose={opts.onCreateChannelClose}
              supportedNips={supportedNips}
              initialChannelId={liveChannel}
              initialInviteCode={liveInviteCode}
              onQuickAccessPin={handleQuickAccessChannelPin}
              quickAccessPinnedIds={quickAccessChannelIds}
              trustFilterEnabled={trustFilterEnabled}
              isHiddenByTrust={isHiddenByTrustFn}
              onTrustHidden={setTrustHiddenCount}
            />
          );
          // Concord off → today's behavior, exactly. On → coexistence wrapper.
          return concordEnabled ? (
            <ChatTab
              relayUrl={relayUrl}
              outpostName={name}
              isOwner={isOperator}
              createChannelOpen={createChannelOpen}
              onCreateChannelClose={() => setCreateChannelOpen(false)}
              renderLegacy={commsTab}
            />
          ) : commsTab({ createChannelOpen, onCreateChannelClose: () => setCreateChannelOpen(false) });
        })()}

        {activeTab === "horizon" && (
          <HorizonTab
            relayUrl={relayUrl}
            externalRefreshKey={feedRefreshKey}
            canPostHorizon={canPostHorizon}
            trustFilterEnabled={trustFilterEnabled}
            isHiddenByTrust={isHiddenByTrustFn}
            onTrustHidden={setTrustHiddenCount}
          />
        )}

        </>
        )}

        {activeTab === "featured" && (
          <div className="py-2">
            <RelayFeaturedFeed sets={featuredSets} relayUrl={relayUrl} activeCoord={featuredCoord} onSelectFeed={setFeaturedCoord} />
          </div>
        )}

        {activeTab === "about" && (
          <div className="py-2">
            <CommunityInfoPanel
              nip11={nip11}
              relayUrl={relayUrl}
              authors={members}
              pinnedRules={pinnedRules}
              allModerators={allModerators}
              lastActivity={lastActivity}
            />
          </div>
        )}
      </div>


      <OutpostComposeSheet
        open={showCompose}
        onOpenChange={setShowCompose}
        relayUrl={relayUrl}
        mode={composeMode}
        onPublished={() => setFeedRefreshKey((k) => k + 1)}
        relayBlossomServers={nip11?.blossom_servers}
        nip11={nip11}
        authRequired={authRequired}
      />

      <Sheet open={showInfoDrawer} onOpenChange={setShowInfoDrawer}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className="glass-dialog-card border-primary/15 sm:max-w-sm max-h-[85vh] overflow-y-auto"
        >
          <SheetTitle className="sr-only">Community Info</SheetTitle>
          <CommunityInfoPanel
            nip11={nip11}
            relayUrl={relayUrl}
            authors={members}
            pinnedRules={pinnedRules}
            allModerators={allModerators}
            lastActivity={lastActivity}
            onClose={() => setShowInfoDrawer(false)}
          />
        </SheetContent>
      </Sheet>

      <ResponsiveFormPanel
        open={showOutpostInvite}
        onOpenChange={setShowOutpostInvite}
        contentClassName="border-primary/20 sm:max-h-[calc(100dvh-4rem)]"
        title={<><Link2 className="w-4 h-4 text-brand" /> Invite to {name}</>}
        description="Share a link, or send a private invite DM."
        footer={
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setShowOutpostInvite(false)} className="h-8 text-xs">Close</Button>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">Invite link</p>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/20 border border-border/30">
              <Link2 className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              <span className="flex-1 text-[11px] font-mono text-foreground/70 truncate">{outpostInviteLink}</span>
              <Button size="sm" variant="ghost" onClick={handleCopyOutpostLink} className="h-7 px-2 gap-1 text-[10px] shrink-0" data-testid="button-copy-outpost-link">
                {outpostLinkCopied ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/40">Anyone with the link can open this community and tap Join.</p>
          </div>
          {pubkey && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">Send to a person · private DM</p>
              <ProfileSearchInput
                onSelect={(r) => setOutpostInviteRecipient(r)}
                selected={outpostInviteRecipient}
                placeholder="Search a name or npub…"
              />
              <Button
                onClick={handleSendOutpostInvite}
                disabled={!outpostInviteRecipient?.pubkey || sendingOutpostInvite}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs gap-1.5 h-9 disabled:opacity-50"
                data-testid="button-send-outpost-invite-dm"
              >
                {sendingOutpostInvite ? <><RelayOutpostInlineLoader className="w-3 h-3" /> Sending…</> : <><Send className="w-3 h-3" /> Send invite DM</>}
              </Button>
            </div>
          )}
        </div>
      </ResponsiveFormPanel>

      <AlertDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <AlertDialogContent className="glass-dialog-card border-red-500/20 max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-brand tracking-wide">Leave {name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground/70 leading-relaxed">
              You'll be removed from this community and it won't appear in your joined list. You can rejoin anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmLeave}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
            >
              <LogOut className="w-3 h-3 mr-1" />
              Leave community
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const PAGE_PINS_COLLAPSED_KEY = "relay-outpost-page-pins-collapsed";

/**
 * Buzz communities from buzz.directory, via our /api/buzz-directory proxy.
 * Reach-honest: the section renders on data, says so on failure (with Retry),
 * and shows nothing while nothing is known. Each slug IS a relay
 * (wss://<slug>.communities.buzz.xyz) — opening one is a normal outpost visit.
 */
function BuzzDirectorySection({ joinedUrls, onOpen }: { joinedUrls: string[]; onOpen: (url: string) => void }) {
  const { data, isError, refetch } = useQuery<{ communities: { slug: string; name: string; relayUrl: string; access: "public" | "invite" | null }[] }>({
    queryKey: ["/api/buzz-directory"],
    queryFn: async () => {
      const r = await fetch("/api/buzz-directory");
      if (!r.ok) throw new Error("directory unavailable");
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const joined = useMemo(() => new Set(joinedUrls.map((u) => u.toLowerCase().replace(/\/+$/, ""))), [joinedUrls]);
  const communities = (data?.communities || []).filter((c) => !joined.has(c.relayUrl.toLowerCase())).slice(0, 8);

  if (isError) {
    return (
      <div className="mt-6">
        <p className="px-0.5 mb-2 text-[11px] font-brand uppercase tracking-wider text-muted-foreground/60">From the Buzz directory</p>
        <button type="button" onClick={() => refetch()} className="text-[12px] text-muted-foreground/60 hover:text-foreground px-0.5" data-testid="button-buzz-retry">
          Couldn't reach the directory — tap to retry
        </button>
      </div>
    );
  }
  if (communities.length === 0) return null;

  return (
    <div className="mt-6" data-testid="buzz-directory-section">
      <div className="flex items-baseline justify-between px-0.5 mb-2.5">
        <p className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/60">From the Buzz directory</p>
        <a href="https://buzz.directory" target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground/50 hover:text-foreground">
          buzz.directory ↗
        </a>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {communities.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => onOpen(c.relayUrl)}
            className="group/buzz flex items-center gap-3 rounded-xl border border-border/30 bg-card/40 px-3.5 py-3 text-left transition-all hover:border-brand/30 hover:bg-brand/[0.05] min-h-[44px]"
            data-testid={`buzz-community-${c.slug.slice(0, 12)}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-sm font-semibold text-amber-600 dark:text-amber-400">
              {c.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{c.name}</span>
              <span className="block text-[11px] text-muted-foreground/70">
                {c.access === "invite" ? "Invite only" : c.access === "public" ? "Open to join" : "Buzz community"}
              </span>
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover/buzz:text-brand" />
          </button>
        ))}
      </div>
    </div>
  );
}

function StarterCommunityIcon({ url, name }: { url: string; name: string }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchNip11(url).then((doc) => { if (!cancelled && doc?.icon) setIcon(doc.icon); }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  if (icon) {
    return <img src={icon} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-border/30" onError={() => setIcon(null)} />;
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-sm font-semibold text-brand">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function Outposts() {
  useDocumentTitle("Communities · Relay Outpost");
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  // Command-bar dropdown: results anchor to the input instead of rendering inline.
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Seed the command bar from a ?q= param — e.g. arriving from the desktop
  // rail's Communities flyout search — so the page runs its own discovery /
  // paste-join on the carried query. Seeded once per mount.
  const pageSearch = useSearch();
  const seededQueryRef = useRef(false);
  useEffect(() => {
    if (seededQueryRef.current) return;
    const q = new URLSearchParams(pageSearch).get("q");
    if (q && q.trim()) {
      seededQueryRef.current = true;
      setSearchQuery(q);
      setSearchFocused(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [pageSearch]);
  const [joinedNip11s, setJoinedNip11s] = useState<Map<string, Nip11Document | null>>(new Map());

  // Directory search (saved + other relays) — shared with the desktop rail's
  // Communities flyout via one hook so both surfaces run identical logic. The
  // page is always `active`, so discovery fetches eagerly on mount as before.
  const {
    joinedMatches,
    dirMatches,
    loading,
    moreCount,
    looksLikeUrl,
    urlToOpen,
    groupInvite,
  } = useOutpostDirectorySearch(searchQuery, { active: true });

  const [joinedRelays, setJoinedRelays] = useState(() => getOutpostRelays());
  const [reordering, setReordering] = useState(false);
  const starterCards = useMemo(() => starterSuggestions(joinedRelays.map((r) => r.url)), [joinedRelays]);

  const [pinnedFeeds, setPinnedFeeds] = useState<PinnedFeed[]>(() => getPinnedFeeds());
  // Nested pins are EXPANDED by default (your shortcuts should be one tap away,
  // not hidden behind a count). The state stores the set of COLLAPSED relay
  // urls — empty set = everything open — and the choice persists.
  const [collapsedPagePins, setCollapsedPagePins] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(PAGE_PINS_COLLAPSED_KEY);
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const moveRelay = useCallback((index: number, direction: -1 | 1) => {
    setJoinedRelays((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      reorderOutpostRelays(next.map((r) => r.url));
      return next;
    });
  }, []);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !pubkey || joinedRelays.length > 0) return;
    hydratedRef.current = true;
    hydrateCommunitySubscriptions().then((imported) => {
      if (imported) window.location.reload();
    });
  }, [pubkey, joinedRelays]);

  useEffect(() => {
    const handler = () => setPinnedFeeds(getPinnedFeeds());
    window.addEventListener("pinned-feeds-changed", handler);
    cleanupPinnedFeeds();
    setPinnedFeeds(getPinnedFeeds());
    return () => window.removeEventListener("pinned-feeds-changed", handler);
  }, []);

  // Pins grouped under their parent outpost (same data the sidebar tree uses).
  const pinsByRelay = useMemo(() => groupPinsByRelay(pinnedFeeds), [pinnedFeeds]);
  useEffect(() => {
    try { localStorage.setItem(PAGE_PINS_COLLAPSED_KEY, JSON.stringify(Array.from(collapsedPagePins))); } catch {}
  }, [collapsedPagePins]);
  const togglePagePins = useCallback((url: string) => {
    setCollapsedPagePins((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  }, []);
  // Expand-all / collapse-all across every joined outpost that has pins.
  const relaysWithPins = useMemo(
    () => joinedRelays.filter((r) => (pinsByRelay.get(normalizeUrl(r.url)) || []).length > 0),
    [joinedRelays, pinsByRelay],
  );
  const anyPinsExpanded = relaysWithPins.some((r) => !collapsedPagePins.has(r.url));
  const toggleAllPagePins = useCallback(() => {
    setCollapsedPagePins(anyPinsExpanded ? new Set(relaysWithPins.map((r) => r.url)) : new Set());
  }, [anyPinsExpanded, relaysWithPins]);

  useEffect(() => {
    for (const relay of joinedRelays) {
      fetchNip11(relay.url).then((doc) => {
        setJoinedNip11s((prev) => {
          const next = new Map(prev);
          next.set(relay.url, doc);
          return next;
        });
      });
    }
  }, [joinedRelays]);

  // Auto-promote isAdmin whenever NIP-11 confirms the signed-in pubkey is
  // the relay operator (or a listed moderator). The sidebar's operator
  // radar reads `isAdmin` from localStorage, so persisting the verified
  // status here means the sidebar lights up automatically without forcing
  // the user to find a manual toggle.
  useEffect(() => {
    if (!pubkey) return;
    let mutated = false;
    const current = getOutpostRelays();
    const updated = current.map((r) => {
      const doc = joinedNip11s.get(r.url);
      const docOperator = isNip11Operator(doc, pubkey);
      // Auto-demote a falsely-claimed relay: it's flagged as operated, but its
      // NIP-11 names a different operator (and you're not a listed moderator).
      // Cleans up stale manual claims so they leave "Relays you run".
      if (r.isAdmin === true && doc && !!doc.pubkey && !docOperator) {
        mutated = true;
        return { ...r, isAdmin: false };
      }
      if (r.isAdmin === true) return r;
      // User explicitly disabled operator mode for this relay; never
      // re-promote them automatically. They can flip it back on from
      // the outpost detail header.
      if (r.operatorOverride === "off") return r;
      if (!doc) return r;
      if (!docOperator) return r;
      mutated = true;
      return { ...r, isAdmin: true };
    });
    if (mutated) {
      saveOutpostRelays(updated);
      setJoinedRelays(updated);
    }
  }, [joinedNip11s, pubkey]);

  // Directory results are search-triggered ONLY, and render in a dropdown
  // anchored to the command bar — no browse list ever sits on the page.
  // Outposts is your hub; you get somewhere new via a shared link, an invite,
  // or an explicit search — not by wading through the raw relay directory.

  // Hard wall (owner decision, 2026-08-14): the directory is pure
  // enumeration — every community on the network from one URL — and that is
  // exactly the browse surface membership gates. Shared links keep their
  // guest previews on their own routes (/outposts/:relay?channel=…,
  // /outposts/c/…, /invite/…); only this browse page is walled. Render-gate
  // AFTER all hooks (rules of hooks).
  if (!pubkey) {
    return (
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 pb-24" data-testid="page-outposts">
        <div className="pt-8">
          <GuestWall context="Communities are for members" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 pb-24">
      <MissionBriefing pageId="outposts" steps={OUTPOSTS_BRIEFING} />
      {/* No page title — the bottom nav already labels this tab; the command
          bar leads and content starts immediately. */}
      {/* Command bar: one subtle pill at the top — search by name or paste a
          link — with matches dropping down from it (combobox), so results never
          push the hub around. */}
      {(() => {
        const raw = searchQuery.trim();
        // `groupInvite`, `looksLikeUrl`, `urlToOpen`, `joinedMatches`,
        // `dirMatches`, `moreCount` and `loading` all come from the shared
        // useOutpostDirectorySearch hook above — the exact same directory logic
        // the desktop rail's Communities flyout consumes (no duplication).
        // Group-chat invite links join HERE, whatever host minted them; the
        // hook checks them FIRST so the looks-like-a-relay-URL branch can't
        // swallow them, and a link copied from a hub card
        // (https://…/outposts/<encoded-relay>) is unwrapped to the right relay.
        const openOutpost = (url: string) => {
          setSearchQuery("");
          setSearchFocused(false);
          setLocation(`/outposts/${encodeURIComponent(url)}`);
        };
        const openInvite = (path: string) => {
          setSearchQuery("");
          setSearchFocused(false);
          setLocation(path);
        };
        const dropdownOpen = !!raw && searchFocused;
        return (
          <div className="relative mb-5" data-testid="outpost-command-bar">
            <SearchPill
              ref={searchInputRef}
              placeholder="Search communities or paste a link…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchQuery(""); searchInputRef.current?.blur(); return; }
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (groupInvite) return openInvite(groupInvite.path);
                if (looksLikeUrl) return openOutpost(urlToOpen);
                if (joinedMatches[0]) return openOutpost(joinedMatches[0].url);
                if (dirMatches[0]) return openOutpost(dirMatches[0].url);
              }}
              data-testid="input-outpost-universal"
              trailing={searchQuery ? (
                <button
                  onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                  className="p-2 rounded-full hover:bg-muted/50 transition-colors"
                  aria-label="Clear search"
                  data-testid="button-clear-outpost-search"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground" />
                </button>
              ) : undefined}
            />
            {dropdownOpen && (
              <div
                className="absolute top-full inset-x-0 mt-1.5 rounded-xl border border-border/50 bg-popover shadow-xl z-50 overflow-hidden"
                // Keep the input focused while tapping inside, so item onClick
                // fires before the blur closes the dropdown.
                onMouseDown={(e) => e.preventDefault()}
                data-testid="outpost-search-dropdown"
              >
                <div className="max-h-[min(420px,60vh)] overflow-y-auto py-1">
                  {groupInvite && (
                    <button
                      type="button"
                      onClick={() => openInvite(groupInvite.path)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-primary/10 transition-colors"
                      data-testid="button-open-invite-link"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 shrink-0">
                        <Lock className="w-3.5 h-3.5 text-brand" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">Join group chat</span>
                        <span className="block text-[11px] text-muted-foreground/60 truncate">
                          {groupInvite.host ? `Invite from ${groupInvite.host} — ` : "Encrypted group invite — "}opens in Relay Outpost
                        </span>
                      </span>
                    </button>
                  )}
                  {looksLikeUrl && (
                    <button
                      type="button"
                      onClick={() => openOutpost(urlToOpen)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-primary/10 transition-colors"
                      data-testid="button-open-outpost-url"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 shrink-0">
                        <Rocket className="w-3.5 h-3.5 text-brand" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">Open {urlToOpen.replace(/^wss?:\/\//, "")}</span>
                        <span className="block text-[11px] text-muted-foreground/60">Go straight to this community</span>
                      </span>
                    </button>
                  )}
                  {joinedMatches.length > 0 && (
                    <>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50">Your communities</p>
                      {joinedMatches.map((m) => (
                        <button
                          key={m.url}
                          type="button"
                          onClick={() => openOutpost(m.url)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                          data-testid={`dropdown-joined-${encodeURIComponent(m.url).slice(0, 24)}`}
                        >
                          <Avatar className="w-7 h-7 border border-border/40 shrink-0">
                            <AvatarImage src={m.icon || undefined} alt={m.name} />
                            <AvatarFallback className="text-[9px] bg-muted">{m.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm truncate">{m.name}</span>
                            <span className="block text-[11px] text-muted-foreground/60 truncate">{m.url.replace(/^wss?:\/\//, "")}</span>
                          </span>
                          <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 shrink-0">Joined</span>
                        </button>
                      ))}
                    </>
                  )}
                  {(dirMatches.length > 0 || loading) && (
                    <p className="px-3 pt-2 pb-1 text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50">Directory</p>
                  )}
                  {loading && dirMatches.length === 0 && (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground/60">
                      <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> Searching…
                    </div>
                  )}
                  {dirMatches.map((m) => (
                    <button
                      key={m.url}
                      type="button"
                      onClick={() => openOutpost(m.url)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                      data-testid={`dropdown-dir-${encodeURIComponent(m.url).slice(0, 24)}`}
                    >
                      <Avatar className="w-7 h-7 border border-border/40 shrink-0">
                        <AvatarImage src={m.icon || undefined} alt={m.name} />
                        <AvatarFallback className="text-[9px] bg-muted">{m.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm truncate">{m.name}</span>
                        <span className="block text-[11px] text-muted-foreground/60 truncate">{m.url.replace(/^wss?:\/\//, "")}</span>
                      </span>
                      {(m.activeUserCount ?? 0) > 0 && (
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">~{m.activeUserCount} active</span>
                      )}
                    </button>
                  ))}
                  {!loading && !groupInvite && !looksLikeUrl && joinedMatches.length === 0 && dirMatches.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground/60">No communities found — try another name, or paste a link.</p>
                  )}
                  {moreCount > 0 && (
                    <p className="px-3 pt-1 pb-2 text-[10px] text-muted-foreground/40 tabular-nums">+{moreCount} more — keep typing to narrow it down</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {joinedRelays.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xs font-brand tracking-wider uppercase text-emerald-600/70 dark:text-emerald-400/70">
              Your communities
            </h2>
            <span className="text-[10px] text-muted-foreground/40">{joinedRelays.length}</span>
            <div className="ml-auto flex items-center gap-1">
              {relaysWithPins.length > 0 && !reordering && (
                <button
                  onClick={toggleAllPagePins}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                  title={anyPinsExpanded ? "Collapse all pins" : "Expand all pins"}
                  aria-label={anyPinsExpanded ? "Collapse all pins" : "Expand all pins"}
                  data-testid="button-toggle-all-pins"
                >
                  {anyPinsExpanded ? <ChevronsDownUp className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3" />}
                  {anyPinsExpanded ? "Collapse" : "Expand"}
                </button>
              )}
              {joinedRelays.length > 1 && (
                <button
                  onClick={() => setReordering((p) => !p)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${ reordering ? "bg-accent text-accent-foreground dark:text-brand border border-brand/20" : "text-muted-foreground/40 hover:text-muted-foreground/70" }`}
                >
                  <GripVertical className="w-3 h-3" />
                  {reordering ? "Done" : "Reorder"}
                </button>
              )}
            </div>
          </div>
          <div className={reordering ? "space-y-2" : "grid grid-cols-1 sm:grid-cols-2 gap-2"}>
            {joinedRelays.map((relay, idx) => (
              <JoinedOutpostCard
                key={relay.url}
                relay={relay}
                nip11={joinedNip11s.get(relay.url) || null}
                reordering={reordering}
                onMoveUp={idx > 0 ? () => moveRelay(idx, -1) : undefined}
                onMoveDown={idx < joinedRelays.length - 1 ? () => moveRelay(idx, 1) : undefined}
                pins={pinsByRelay.get(normalizeUrl(relay.url)) || []}
                pinsExpanded={!collapsedPagePins.has(relay.url)}
                onTogglePins={() => togglePagePins(relay.url)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty hub: one quiet pointer instead of a big empty-state card — the
          hub stays calm: search → your communities once they exist. */}
      {pubkey && joinedRelays.length === 0 && (
        <p className="px-0.5 text-[13px] text-muted-foreground/50" data-testid="text-empty-outposts-hint">
          Join a community by pasting its link above, or ask a friend for an invite.
        </p>
      )}

      {/* Curated starters — good rooms a new person can join without knowing
          what to search for. Each entry is wire-verified before it's listed
          (lib/starter-communities). Self-hides once everything is joined. */}
      {pubkey && starterCards.length > 0 && (
        <div className="mt-5" data-testid="starter-communities">
          <p className="px-0.5 mb-2.5 text-[11px] font-brand uppercase tracking-wider text-muted-foreground/60">
            Good places to start
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {starterCards.map((c) => (
              <button
                key={c.url}
                type="button"
                onClick={() => setLocation(`/outposts/${encodeURIComponent(c.url)}`)}
                className="group/starter flex items-center gap-3 rounded-xl border border-border/30 bg-card/40 px-3.5 py-3 text-left transition-all hover:border-brand/30 hover:bg-brand/[0.05] min-h-[44px]"
                data-testid={`starter-community-${c.url.replace(/\W+/g, "-")}`}
              >
                <StarterCommunityIcon url={c.url} name={c.name} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{c.name}</span>
                  <span className="block text-[11px] text-muted-foreground/70 truncate">{c.tagline}</span>
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover/starter:text-brand" />
              </button>
            ))}
          </div>
          {/* Community operators are the growth loop — invite them in. Opens
              the feedback composer (idea type) rather than a mailto: replies
              land in the operator inbox with the reporter's npub attached. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("relay-outpost:open-feedback", { detail: { initialType: "idea" } }))}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-brand/25 bg-brand/[0.03] px-3.5 py-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/[0.06] min-h-[44px]"
            data-testid="button-feature-your-community"
          >
            <MagicStarIcon className="h-4 w-4 shrink-0 text-brand/70" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Run a community? Get it featured here.</span>
              <span className="block text-[11px] text-muted-foreground/70">Tell us about your relay and we'll take a look.</span>
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
          </button>

          <BuzzDirectorySection joinedUrls={joinedRelays.map((r) => r.url)} onOpen={(url) => setLocation(`/outposts/${encodeURIComponent(url)}`)} />
        </div>
      )}

      {/* Relay infrastructure moved to Settings → Tools → Relays (/relays). Keep a
          slim power-user link here, plus quick feedback. */}
      <div className="mt-8 pt-4 border-t border-border/30 flex items-center gap-3 px-3">
        {pubkey && (
          <Link
            href="/relays"
            className="flex items-center gap-2 py-1 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
            data-testid="link-outposts-manage-relays"
          >
            <Wrench className="w-3.5 h-3.5 text-muted-foreground/50" />
            <span>Manage relays</span>
            <span className="text-[10px] text-muted-foreground/40">routes · health · blocks</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => openFeedbackDrawer({ initialType: "bug" })}
          className="text-[10px] text-muted-foreground/50 hover:text-brand transition-colors inline-flex items-center gap-1 px-1 ml-auto"
          data-testid="link-outposts-feedback"
        >
          <Inbox className="w-3 h-3" />
          Found a bug?
        </button>
      </div>

    </div>
  );
}
