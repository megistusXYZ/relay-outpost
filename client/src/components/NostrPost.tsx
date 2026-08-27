import { useEffect, useMemo, useRef, useState, useCallback, memo, isValidElement, cloneElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link, useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import { eventStore, pool, publishEvent, fetchProfiles, fetchProfilesCached, DEFAULT_RELAYS, FAST_RELAYS, getEventRelays } from "@/lib/nostr";
import { noteShareId } from "@/lib/share-links";
import { queryAnswered } from "@/lib/relay-reach";
import { classifyParentTarget, orderedRelayCandidates, parentRelayCandidates, resolveFetchOutcome } from "@/lib/parent-resolve";
import { parseListing, KIND_CLASSIFIED_LISTING, LISTING_RELAYS } from "@/lib/listing";
import { ListingCard } from "@/components/ListingCard";
import { getPublishTarget } from "@/lib/outpost-relays";
import { getWriteRelays } from "@/lib/outbox";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { prefetchProfileOnHover } from "@/hooks/use-prefetch-visible";
import { ActivityIndicator } from "@/components/ActivityIndicator";
import { Nip05Badge, Nip05VerifiedCheck } from "@/components/Nip05Badge";
import { PostBadgeIcons } from "@/components/BadgeDisplay";
import { useTopZappers } from "@/hooks/use-top-zappers";
import { formatDistanceToNow } from "date-fns";
import { formatCompactTime } from "@/lib/time";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import {
  Bookmark,
  BookmarkCheck,
  Heart,
  MessageSquare,
  Repeat,
  Share2,
  Send,
  Copy,
  ExternalLink,
  Quote,
  X,
  ChevronDown,
  ChevronUp,
  User,
  VolumeX,
  Volume2,
  CornerUpLeft,
  CornerDownRight,
  FileJson,
  Check,
  Type,
  Hash,
  Flag,
  Terminal,
  Filter,
  Search,
  Zap,
  Play,
  ImageIcon,
  Pause,
  ArrowLeftRight,
  ArrowUpDown,
  Users,
  Headphones,
  ShieldCheck,
  Trash2,
  Ban,
  MessagesSquare,
  Radio } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { EventCard, EventCardSkeleton } from "@/components/EventCard";
import { ShareEventDialog } from "@/components/ShareEventDialog";
import { parseCalendarEvent, KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT, type CalendarEventData } from "@/lib/calendar-events";
import { resolveNostrEmbed, truncatePreservingNostr } from "@/components/nostr-post/embed-resolution";
import { OutpostIcon } from "@/components/icons/OutpostIcon";
import nostrOstrichGif from "@assets/219719339-5eff628c-3470-4cc3-81eb-404f8902de9f_1771392554698.gif";
import { useReactionDetails } from "@/hooks/use-reaction-details";
import { useSignalCheck } from "@/hooks/use-signal-check";
import { useAttestations, isActiveAttestation, getAttestationStatusLabel, type Attestation } from "@/hooks/use-attestations";
import { useMention } from "@/hooks/use-mention";
import { MentionSearch } from "@/components/MentionSearch";
import { MentionHighlightTextarea } from "@/components/MentionHighlightTextarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle } from "@/components/ui/sheet";
import {
  getAvatarUrl,
  getDisplayName,
  getProfileContent,
  KIND_METADATA,
  KIND_TEXT_NOTE,
  KIND_REPOST,
  KIND_REACTION,
  KIND_LIVE_EVENT,
  formatNpub,
  shortenNpub,
  formatNoteId,
  buildReplyTags,
  buildRepostTags,
  buildReactionTags,
  getRelayHintForEvent,
  clientTags,
  isProtectedEvent } from "@/lib/nostr-helpers";
import { usePetnamesVersion } from "@/lib/petnames";
import { FOCUS_RING } from "@/lib/a11y";
import { getClientDisplay } from "@/lib/client-display";
import { ClientTagBadge } from "@/components/ClientTagBadge";
import { useShowClientTag } from "@/hooks/use-show-client-tag";
import { MediaRenderer } from "@/components/MediaRenderer";
import { useTranslation, TranslateLine } from "@/components/TranslateControl";
import { getContentWarning, getSensitiveContentSetting, isCwRevealed, markCwRevealed } from "@/lib/sensitive-content";
import { extractMediaFromContent, getEventMediaInfo } from "@/lib/media-utils";
import { normalizeNostrClientLinks } from "@/lib/nostr-client-links";
import { useNostrBookmarks } from "@/hooks/use-nostr-bookmarks";
import { useFeedStyle } from "@/hooks/use-feed-style";
import { useReplyContext } from "@/hooks/use-reply-context";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { usePrimalStats } from "@/hooks/use-primal-stats";
import { primalStatsCache, fetchThreadRepliesStreaming, getCachedThread, setCachedThread } from "@/lib/primal-cache";
import { computeEngagementScore, formatEngagementScore, type EngagementStats } from "@/lib/engagement";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { getEngagementWeights } from "@/lib/engagement-weights";
import { useFeedPrefs } from "@/lib/feed-prefs";
import { useToast } from "@/hooks/use-toast";
import { mutePubkey, isMutedPubkey } from "@/lib/spam-filter";
import { ConfirmAction } from "@/components/ConfirmAction";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { ZapDialog } from "@/components/ZapDialog";
import { ReportDialog } from "@/components/ReportDialog";
import { useTTS, type ThreadTTSSegment } from "@/contexts/TextToSpeechContext";
import { createContext, useContext } from "react";
import { quotesItsParent } from "@/lib/quote-reply";
import { useIsMobile } from "@/hooks/use-mobile";
import { PostFrame } from "@/components/PostFrame";
import { isMediaDominant } from "@/lib/media-frame";
import { isMediaFeedEnabled } from "@/lib/media-feed-prefs";
import { formatSats } from "@/lib/zap";
import { useCustomEmojis, isCustomEmoji, getCustomEmojiShortcode } from "@/hooks/use-custom-emojis";
import { useInteraction } from "@/contexts/InteractionIndexContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { formatInfluence } from "@/lib/graperank";
import type { SignalTier } from "@/lib/graperank";
import type { CustomEmoji } from "@/hooks/use-custom-emojis";
import { SmilePlus, Lock, Globe } from "lucide-react";
import { ComposeEmojiPicker, useEmojiTags } from "@/components/ComposeEmojiPicker";
import { useLazyScoreRequest, VerifiedBadgeIcon, useHoverPopover, TrustTierDot, ThreadTrustBar, AuthorHoverCard, BtcZapIcon, HoverCardTrustBadge, VouchedBySection, TrustedBySection } from "./nostr-post/author-hover";
import { ZapReceiptsPopover, TopZapperAvatars, ReactionDetailsPopover, formatCount } from "./nostr-post/zap-reactions";
import { ReplyThread, ReplyComposer, QuoteComposer, ParentPostPreview, getReplyTargetId } from "./nostr-post/thread";
import { PrivateReplyDialog } from "@/components/PrivateReplyDialog";
import { AddToFeaturedDialog } from "@/components/AddToFeaturedDialog";
import { getAdminOutposts } from "@/lib/featured-append";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";

export { VerifiedBadgeIcon, TrustTierDot, AuthorHoverCard, BtcZapIcon } from "./nostr-post/author-hover";
export { ZapReceiptsPopover, TopZapperAvatars, ReactionDetailsPopover, formatCount } from "./nostr-post/zap-reactions";
export { ReplyThread, ReplyComposer, QuoteComposer, getReplyTargetId } from "./nostr-post/thread";


const badgeModeListeners = new Set<(m: "score" | "signal") => void>();
let badgeModeValue: "score" | "signal" = (() => {
  try {
    const stored = localStorage.getItem("engagement-badge-mode");
    return stored === "signal" ? "signal" : "score";
  } catch { return "score" as const; }
})();

function setBadgeModeGlobal(m: "score" | "signal") {
  if (badgeModeValue === m) return;
  badgeModeValue = m;
  try { localStorage.setItem("engagement-badge-mode", m); } catch {}
  badgeModeListeners.forEach(l => l(m));
}

function useBadgeMode() {
  const [mode, setMode] = useState<"score" | "signal">(badgeModeValue);
  useEffect(() => {
    const listener = (m: "score" | "signal") => setMode(m);
    badgeModeListeners.add(listener);
    setMode(badgeModeValue);
    return () => { badgeModeListeners.delete(listener); };
  }, []);
  const toggle = useCallback(() => {
    setBadgeModeGlobal(badgeModeValue === "score" ? "signal" : "score");
  }, []);
  return { mode, toggle };
}

export function ProtectedNoteBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 shrink-0 ${className || ""}`}
      title="Protected (NIP-70) — only the author can publish this note. Other clients shouldn't rebroadcast it."
      data-testid="badge-protected-note"
    >
      <Lock className="w-2.5 h-2.5" />
      <span className="hidden sm:inline">Protected</span>
    </span>
  );
}

// Minimum engagement (replies + reposts + likes + zaps) before the Signal Check
// chip earns its post real estate. Below this the chip renders NOTHING — no "?"
// (unfetched) and no "0" (checked, nobody) resting states cluttering quiet
// posts. statsTotal is already computed per-post, so this gate costs no extra
// fetches. Exception: a previously-fetched check that found real participants
// keeps showing (never hide known-good signal).
const SIGNAL_CHECK_MIN_ENGAGEMENT = 5;

function SignalCheckBadge({ eventId, statsTotal = 0, size = "default" }: { eventId: string; statsTotal?: number; size?: "default" | "compact" }) {
  const [open, setOpen] = useState(false);
  const { crew, known, others, total, loading, fetched, fetch: fetchSignal, participants } = useSignalCheck(eventId);
  const { pubkey } = useNostrAuth();
  const { scores: grScores, getAuthorTier, getAuthorInfluence, isAuthorFlagged, requestScoresBulk, wotEnabled } = useGrapeRankScores();

  useEffect(() => {
    if (!wotEnabled || !grScores || !fetched || participants.length === 0) return;
    const missing = participants.map(p => p.pubkey).filter(pk => !grScores.has(pk));
    if (missing.length > 0) requestScoresBulk(missing);
  }, [participants, grScores, fetched, requestScoresBulk, wotEnabled]);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && !fetched) {
      fetchSignal();
    }
  }, [fetched, fetchSignal]);

  const crewRatio = total > 0 ? crew / total : 0;
  const knownRatio = total > 0 ? (crew + known) / total : 0;
  const tier = crewRatio >= 0.3 ? "high" : knownRatio >= 0.3 ? "mid" : "low";
  // Demoted to a plain muted number (no pill/border): the signal check is
  // SECONDARY context — the amber zap total is the row's hero. Trust-signal
  // colours still live inside the popover with a labelled legend.
  const sizeClass = size === "compact" ? "text-[9px]" : "text-[10px]";

  const tierLabel = tier === "high" ? "Strong signal" : tier === "mid" ? "Some signal" : "Weak signal";

  if (!pubkey) return null;
  // Threshold gate: quiet posts get no chip at all. A cached fetch that found
  // real network participants still shows (total > 0), regardless of stats.
  if (statsTotal < SIGNAL_CHECK_MIN_ENGAGEMENT && !(fetched && total > 0)) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-0.5 font-mono cursor-pointer text-muted-foreground/55 hover:text-muted-foreground transition-colors ${sizeClass}`}
          data-testid={`badge-signal-check-${eventId}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Users className="w-2.5 h-2.5" />
          {fetched ? (crew + known > 0 ? `${crew + known}` : `${total}`) : (statsTotal > 0 ? `${statsTotal}` : "?")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0 border-border dark:border-brand/20 bg-popover dark:bg-[rgba(4,4,10,0.97)]"
        side="top"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-display text-brand">Signal Check</p>
            {fetched && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                tier === "high" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                tier === "mid" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" :
                "bg-secondary/50 text-muted-foreground"
              }`}>
                {tierLabel}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Who liked, reposted, or zapped this post — and how they rank in your trust graph.
          </p>

          {loading && (
            <div className="flex items-center justify-center py-4">
              <RelayOutpostInlineLoader className="w-4 h-4 text-brand/50" />
            </div>
          )}

          {!loading && fetched && total === 0 && (
            <p className="text-[11px] text-muted-foreground/70 text-center py-3">
              No interactions found on relays
            </p>
          )}

          {!loading && fetched && total > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border dark:border-brand/10">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-foreground/80 font-medium">Crew</span>
                  <span className="text-muted-foreground/70 text-[10px]">you follow</span>
                </div>
                <span className="text-emerald-500 dark:text-emerald-400 font-mono font-bold">{crew}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-foreground/80 font-medium">Known</span>
                  <span className="text-muted-foreground/70 text-[10px]">friends of friends</span>
                </div>
                <span className="text-blue-500 dark:text-blue-400 font-mono font-bold">{known}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                  <span className="text-foreground/80 font-medium">Others</span>
                  <span className="text-muted-foreground/70 text-[10px]">outside your graph</span>
                </div>
                <span className="text-muted-foreground font-mono font-bold">{others}</span>
              </div>

              <div className="pt-1.5 mt-1 border-t border-border dark:border-brand/10">
                <div className="h-2 rounded-full overflow-hidden bg-secondary/50 flex">
                  {crew > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${(crew / total) * 100}%` }} />}
                  {known > 0 && <div className="bg-blue-500 h-full" style={{ width: `${(known / total) * 100}%` }} />}
                  {others > 0 && <div className="bg-muted-foreground/20 h-full" style={{ width: `${(others / total) * 100}%` }} />}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground/80">{total} engager{total !== 1 ? "s" : ""}</span>
                  <span className="text-[10px] text-muted-foreground/70">NIP-02 follow graph</span>
                </div>
              </div>

              {wotEnabled && grScores && grScores.size > 0 && (() => {
                let grStrong = 0, grModerate = 0, grLow = 0, grWeak = 0, grFlagged = 0, grUnscored = 0;
                const allScores: number[] = [];
                let scoredCount = 0;
                let totalWeight = 0;

                for (const p of participants) {
                  const flagged = isAuthorFlagged(p.pubkey);
                  const t = getAuthorTier(p.pubkey);
                  const influence = getAuthorInfluence(p.pubkey);
                  const score = influence ?? 0;
                  allScores.push(score);
                  if (influence !== null) { scoredCount++; totalWeight += score; }
                  if (flagged) { grFlagged++; continue; }
                  if (t === "strong") grStrong++;
                  else if (t === "moderate") grModerate++;
                  else if (t === "low") grLow++;
                  else if (t === "weak") grWeak++;
                  else grUnscored++;
                }

                const grScored = grStrong + grModerate + grLow + grWeak + grFlagged;
                if (grScored === 0 && grUnscored === 0) return null;

                const avgInfluence = scoredCount > 0 ? totalWeight / scoredCount : 0;
                const sorted = [...allScores].sort((a, b) => b - a);
                const topN = Math.max(1, Math.min(3, Math.ceil(total * 0.1)));
                const topWeight = sorted.slice(0, topN).reduce((s, v) => s + v, 0);
                const concentration = totalWeight > 0 ? topWeight / totalWeight : 0;

                const grAvgColor = avgInfluence >= 0.15 ? "text-emerald-600 dark:text-emerald-400"
                  : avgInfluence >= 0.02 ? "text-blue-600 dark:text-blue-400"
                  : avgInfluence > 0 ? "text-cyan-600 dark:text-cyan-400"
                  : "text-slate-500 dark:text-slate-400";
                const grConcColor = concentration > 0.85 ? "text-red-500 dark:text-red-400"
                  : concentration > 0.6 ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400";

                const trustedRatio = total > 0 ? (grStrong + grModerate) / total : 0;
                const verdict = grFlagged > 0 && grFlagged >= total * 0.2
                  ? { label: "Suspicious", color: "text-red-600 dark:text-red-400 bg-red-500/10", desc: `${grFlagged} flagged engager${grFlagged > 1 ? "s" : ""}` }
                  : total >= 10 && concentration > 0.85 && avgInfluence < 0.02
                  ? { label: "Inorganic", color: "text-red-600 dark:text-red-400 bg-red-500/10", desc: "Trust concentrated in few accounts" }
                  : trustedRatio >= 0.5
                  ? { label: "Organic", color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", desc: "Majority from trusted accounts" }
                  : trustedRatio >= 0.2
                  ? { label: "Mixed", color: "text-amber-600 dark:text-amber-400 bg-amber-500/10", desc: "Some trusted, some unknown" }
                  : { label: "Unverified", color: "text-slate-500 dark:text-slate-400 bg-slate-500/10", desc: "Few scored engagers" };

                const grSegments = [
                  { count: grStrong, color: "bg-emerald-500", label: "Highly Trusted" },
                  { count: grModerate, color: "bg-blue-500", label: "Trusted" },
                  { count: grLow, color: "bg-cyan-500", label: "Neutral" },
                  { count: grWeak, color: "bg-red-400", label: "Low Trust" },
                  { count: grFlagged, color: "bg-red-600", label: "Flagged" },
                  { count: grUnscored, color: "bg-slate-500/60 dark:bg-slate-400/50", label: "Unscored" },
                ].filter(s => s.count > 0);

                const grBarTotal = grScored + grUnscored;

                return (
                  <div className="pt-2 mt-2 border-t border-border dark:border-brand/10 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-medium text-brand">GrapeRank Trust</p>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${verdict.color}`}>
                        {verdict.label}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden flex gap-px bg-slate-500/10">
                      {grSegments.map((seg, i) => (
                        <div
                          key={seg.label}
                          className={`${seg.color} transition-all duration-300 ${i === 0 ? "rounded-l-full" : ""} ${i === grSegments.length - 1 ? "rounded-r-full" : ""}`}
                          style={{ width: `${grBarTotal > 0 ? (seg.count / grBarTotal) * 100 : 0}%`, minWidth: seg.count > 0 ? "3px" : 0 }}
                          title={`${seg.label}: ${seg.count}`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {grSegments.map((seg) => (
                        <span key={seg.label} className="flex items-center gap-1 text-[9px] text-muted-foreground/80">
                          <span className={`w-1.5 h-1.5 rounded-full ${seg.color}`} />
                          {seg.label} {seg.count}
                        </span>
                      ))}
                    </div>
                    {scoredCount > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-muted-foreground/80" title="Average trust score of people who engaged with this post">
                            Avg Signal <span className={`font-mono font-bold ${grAvgColor}`}>{avgInfluence.toFixed(4)}</span>
                          </span>
                          {total >= 4 && (
                            <span className="text-[9px] text-muted-foreground/80" title={`Top ${topN} account${topN > 1 ? "s" : ""} hold ${Math.round(concentration * 100)}% of total trust — ${concentration > 0.85 ? "highly concentrated" : concentration > 0.6 ? "moderately concentrated" : "broadly distributed"}`}>
                              Top {topN} <span className={`font-mono font-bold ${grConcColor}`}>{Math.round(concentration * 100)}%</span>
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-muted-foreground/70 leading-snug">
                          {avgInfluence >= 0.15 ? "High average trust among engagers" : avgInfluence >= 0.02 ? "Moderate trust among engagers" : avgInfluence > 0 ? "Low trust among engagers" : "No trust data available"}
                          {total >= 4 && (<>{" · "}{concentration > 0.85 ? "trust concentrated in few accounts" : concentration > 0.6 ? "trust somewhat concentrated" : "trust broadly distributed"}</>)}
                        </p>
                      </div>
                    )}
                    <p className="text-[9px] text-muted-foreground/70 italic">{verdict.desc}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground/80">{grScored} of {total} engagers scored</span>
                      <span className="text-[10px] text-muted-foreground/70">GrapeRank WoT</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PostBadgeToggle({ eventId, score, stats, size = "default" }: { eventId: string; score: number; stats?: EngagementStats | null; size?: "default" | "compact" }) {
  const { mode, toggle } = useBadgeMode();
  const { pubkey } = useNostrAuth();
  const { wotEnabled } = useGrapeRankScores();
  const { engagementScoreEnabled } = useFeedPrefs();

  // Honor the App Settings switches: "Signal check" = Web of Trust, "Engagement
  // score" = the per-post score badge. Hide whatever's turned off; only show the
  // swap toggle when both are available.
  const signalAvailable = wotEnabled && !!pubkey;
  const engagementAvailable = engagementScoreEnabled;
  if (!signalAvailable && !engagementAvailable) return null;
  const showSignal = signalAvailable && (!engagementAvailable || mode === "signal");
  const canToggle = signalAvailable && engagementAvailable && score > 0;

  return (
    <div className="flex items-center gap-0.5">
      {showSignal ? (
        <SignalCheckBadge eventId={eventId} statsTotal={stats ? (stats.replies + stats.reposts + stats.likes + stats.zaps) : 0} size={size} />
      ) : (
        <EngagementScoreBadge eventId={eventId} score={score} stats={stats} size={size} />
      )}
      {canToggle && (
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          title={showSignal ? "Switch to engagement score" : "Switch to signal check"}
          data-testid={`button-badge-toggle-${eventId}`}
        >
          <ArrowLeftRight className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}



function EngagementScoreBadge({ eventId, score, stats, size = "default" }: { eventId: string; score: number; stats?: EngagementStats | null; size?: "default" | "compact" }) {
  const [open, setOpen] = useState(false);
  const { pubkey } = useNostrAuth();
  const { total, loading: signalLoading, fetched: signalFetched, fetch: fetchSignal, participants } = useSignalCheck(eventId);
  const { scores: grScores, getAuthorTier, getAuthorInfluence, isAuthorFlagged, requestScoresBulk, wotEnabled } = useGrapeRankScores();

  useEffect(() => {
    if (!wotEnabled || !grScores || !signalFetched || participants.length === 0) return;
    const missing = participants.map(p => p.pubkey).filter(pk => !grScores.has(pk));
    if (missing.length > 0) requestScoresBulk(missing);
  }, [participants, grScores, signalFetched, requestScoresBulk, wotEnabled]);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && !signalFetched && pubkey) {
      fetchSignal();
    }
  }, [signalFetched, fetchSignal, pubkey]);

  if (score <= 0) return null;
  const tier = score >= 100 ? "high" : score >= 25 ? "mid" : "low";
  // Demoted to a plain muted number (secondary to the amber zap total); score
  // colours stay inside the popover.
  const sizeClass = size === "compact" ? "text-[9px]" : "text-[10px]";

  const tierLabel = tier === "high" ? "High" : tier === "mid" ? "Medium" : "Low";

  const ew = getEngagementWeights();
  const breakdownRows = stats ? [
    { label: "Replies", count: stats.replies, weight: ew.replies, points: stats.replies * ew.replies },
    { label: "Reposts", count: stats.reposts, weight: ew.reposts, points: stats.reposts * ew.reposts },
    { label: "Likes", count: stats.likes, weight: ew.likes, points: stats.likes * ew.likes },
    { label: "Zaps", count: stats.zaps, weight: ew.zaps, points: stats.zaps * ew.zaps },
    ...(stats.zapAmount > 0 ? [{ label: "Sats bonus", count: stats.zapAmount, weight: 0, points: Math.round(Math.log10(stats.zapAmount) * ew.satsBonus) }] : []),
  ] : [];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-0.5 font-mono cursor-pointer text-muted-foreground/55 hover:text-muted-foreground transition-colors ${sizeClass}`}
          data-testid="badge-engagement-score"
          onClick={(e) => e.stopPropagation()}
        >
          {formatEngagementScore(score)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0 border-border dark:border-brand/20 bg-popover dark:bg-[rgba(4,4,10,0.97)]"
        side="top"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-display text-brand">Engagement Score</p>
            <span className={`text-sm font-mono font-bold ${tier === "high" ? "text-brand dark:text-brand" : tier === "mid" ? "text-brand/80 dark:text-brand" : "text-muted-foreground"}`}>
              {score}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            A weighted score measuring how much interaction this post received. {tierLabel} engagement.
          </p>
          {stats && breakdownRows.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border dark:border-brand/10">
              <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">Breakdown</p>
              {breakdownRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground/70">
                    {row.label}
                    {row.weight > 0 && <span className="text-muted-foreground/30 ml-1">x{row.weight}</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground/50 font-mono">{row.count.toLocaleString()}</span>
                    <span className="text-brand/80 font-mono w-8 text-right">+{row.points}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border dark:border-brand/10">
                <span className="text-muted-foreground/70 font-medium">Total</span>
                <span className="text-brand font-mono font-bold">{score}</span>
              </div>
            </div>
          )}

          {pubkey && signalLoading && (
            <div className="flex items-center justify-center py-2">
              <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand/50" />
            </div>
          )}

          {pubkey && signalFetched && total > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border dark:border-brand/10">
              {wotEnabled && grScores && grScores.size > 0 && (() => {
                let grStrong = 0, grModerate = 0, grLow = 0, grWeak = 0, grFlagged = 0, grUnscored = 0;
                const allScores: number[] = [];
                let scoredCount = 0;
                let totalWeight = 0;

                for (const p of participants) {
                  const flagged = isAuthorFlagged(p.pubkey);
                  const t = getAuthorTier(p.pubkey);
                  const influence = getAuthorInfluence(p.pubkey);
                  const sc = influence ?? 0;
                  allScores.push(sc);
                  if (influence !== null) { scoredCount++; totalWeight += sc; }
                  if (flagged) { grFlagged++; continue; }
                  if (t === "strong") grStrong++;
                  else if (t === "moderate") grModerate++;
                  else if (t === "low") grLow++;
                  else if (t === "weak") grWeak++;
                  else grUnscored++;
                }

                const grScored = grStrong + grModerate + grLow + grWeak + grFlagged;
                if (grScored === 0 && grUnscored === 0) return null;

                const avgInfluence = scoredCount > 0 ? totalWeight / scoredCount : 0;
                const sorted = [...allScores].sort((a, b) => b - a);
                const topN = Math.max(1, Math.min(3, Math.ceil(total * 0.1)));
                const topWeight = sorted.slice(0, topN).reduce((s, v) => s + v, 0);
                const concentration = totalWeight > 0 ? topWeight / totalWeight : 0;

                const grAvgColor = avgInfluence >= 0.15 ? "text-emerald-600 dark:text-emerald-400"
                  : avgInfluence >= 0.02 ? "text-blue-600 dark:text-blue-400"
                  : avgInfluence > 0 ? "text-cyan-600 dark:text-cyan-400"
                  : "text-slate-500 dark:text-slate-400";
                const grConcColor = concentration > 0.85 ? "text-red-500 dark:text-red-400"
                  : concentration > 0.6 ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400";

                const trustedRatio = total > 0 ? (grStrong + grModerate) / total : 0;
                const verdict = grFlagged > 0 && grFlagged >= total * 0.2
                  ? { label: "Suspicious", color: "text-red-600 dark:text-red-400 bg-red-500/10", desc: `${grFlagged} flagged engager${grFlagged > 1 ? "s" : ""}` }
                  : total >= 10 && concentration > 0.85 && avgInfluence < 0.02
                  ? { label: "Inorganic", color: "text-red-600 dark:text-red-400 bg-red-500/10", desc: "Trust concentrated in few accounts" }
                  : trustedRatio >= 0.5
                  ? { label: "Organic", color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", desc: "Majority from trusted accounts" }
                  : trustedRatio >= 0.2
                  ? { label: "Mixed", color: "text-amber-600 dark:text-amber-400 bg-amber-500/10", desc: "Some trusted, some unknown" }
                  : { label: "Unverified", color: "text-slate-500 dark:text-slate-400 bg-slate-500/10", desc: "Few scored engagers" };

                const grSegments = [
                  { count: grStrong, color: "bg-emerald-500", label: "Highly Trusted" },
                  { count: grModerate, color: "bg-blue-500", label: "Trusted" },
                  { count: grLow, color: "bg-cyan-500", label: "Neutral" },
                  { count: grWeak, color: "bg-red-400", label: "Low Trust" },
                  { count: grFlagged, color: "bg-red-600", label: "Flagged" },
                  { count: grUnscored, color: "bg-slate-500/60 dark:bg-slate-400/50", label: "Unscored" },
                ].filter(s => s.count > 0);

                const grBarTotal = grScored + grUnscored;

                return (
                  <div className="pt-2 mt-2 border-t border-border dark:border-brand/10 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-medium text-brand">GrapeRank Trust</p>
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${verdict.color}`}>
                        {verdict.label}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden flex gap-px bg-slate-500/10">
                      {grSegments.map((seg, i) => (
                        <div
                          key={seg.label}
                          className={`${seg.color} transition-all duration-300 ${i === 0 ? "rounded-l-full" : ""} ${i === grSegments.length - 1 ? "rounded-r-full" : ""}`}
                          style={{ width: `${grBarTotal > 0 ? (seg.count / grBarTotal) * 100 : 0}%`, minWidth: seg.count > 0 ? "3px" : 0 }}
                          title={`${seg.label}: ${seg.count}`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {grSegments.map((seg) => (
                        <span key={seg.label} className="flex items-center gap-1 text-[9px] text-muted-foreground/80">
                          <span className={`w-1.5 h-1.5 rounded-full ${seg.color}`} />
                          {seg.label} {seg.count}
                        </span>
                      ))}
                    </div>
                    {scoredCount > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-muted-foreground/80" title="Average trust score of people who engaged with this post">
                            Avg Signal <span className={`font-mono font-bold ${grAvgColor}`}>{avgInfluence.toFixed(4)}</span>
                          </span>
                          {total >= 4 && (
                            <span className="text-[9px] text-muted-foreground/80" title={`Top ${topN} account${topN > 1 ? "s" : ""} hold ${Math.round(concentration * 100)}% of total trust`}>
                              Top {topN} <span className={`font-mono font-bold ${grConcColor}`}>{Math.round(concentration * 100)}%</span>
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-muted-foreground/70 leading-snug">
                          {avgInfluence >= 0.15 ? "High average trust among engagers" : avgInfluence >= 0.02 ? "Moderate trust among engagers" : avgInfluence > 0 ? "Low trust among engagers" : "No trust data available"}
                          {total >= 4 && (<>{" · "}{concentration > 0.85 ? "trust concentrated in few accounts" : concentration > 0.6 ? "trust somewhat concentrated" : "trust broadly distributed"}</>)}
                        </p>
                      </div>
                    )}
                    <p className="text-[9px] text-muted-foreground/70 italic">{verdict.desc}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground/80">{grScored} of {total} engagers scored</span>
                      <span className="text-[10px] text-muted-foreground/70">GrapeRank WoT</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


export function MentionProfileLink({ pubkey }: { pubkey: string }) {
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const profileContent = useMemo(() => {
    if (!profile) return null;
    return getProfileContent(profile);
  }, [profile]);
  const displayName = useMemo(() => {
    if (!profileContent) return null;
    return profileContent.display_name || profileContent.name || null;
  }, [profileContent]);

  useEffect(() => {
    fetchProfilesCached([pubkey]);
  }, [pubkey]);

  const avatarUrl = useMemo(() => getAvatarUrl(profile), [profile]);
  const nip05 = (profileContent as any)?.nip05 || null;
  const lud16 = (profileContent as any)?.lud16 || null;
  const about = (profileContent as any)?.about || null;
  const shortNpub = `${npub.slice(0, 12)}...${npub.slice(-6)}`;
  const [copied, setCopied] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const { toast } = useToast();

  const handleCopyNpub = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    copyNostrId(npub).then(() => {
      setCopied(true);
      toast({ title: "Copied", description: "npub copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  }, [npub, toast]);

  const handleZapClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowZapDialog(true);
  }, []);

  const linkEl = (
    <Link
      href={`/profile/${npub}`}
      className="text-brand dark:text-brand/90 font-medium no-underline cursor-pointer hover:text-brand/80 dark:hover:text-brand transition-colors"
      data-testid={`link-mention-profile-${npub.slice(0, 12)}`}
    >
      @{displayName || `${npub.slice(0, 9)}...${npub.slice(-4)}`}
    </Link>
  );

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        {linkEl}
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-72 p-0 border-0 bg-transparent shadow-none mention-hover-card"
        data-testid={`hover-card-${npub.slice(0, 12)}`}
      >
        <div
          className="relative rounded-xl overflow-hidden border border-border dark:border-brand/20"
          style={{ background: 'var(--mention-hover-solid-bg)', boxShadow: '0 8px 24px var(--mention-hover-shadow)' }}
        >
          <div className="absolute inset-0 mention-hover-radial pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-[1px] bg-gradient-to-r from-transparent via-brand/50 to-transparent pointer-events-none" />

          <div className="relative z-10 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Link href={`/profile/${npub}`} data-testid={`hover-avatar-${npub.slice(0, 12)}`}>
                <Avatar className="w-12 h-12 ring-2 ring-primary/30 dark:ring-brand/30 border-2 border-border dark:border-[#0d0d2b] shrink-0 cursor-pointer">
                  <AvatarImage src={avatarUrl} alt={displayName || "Profile"} />
                  <AvatarFallback className="bg-brand/10 text-brand dark:bg-brand/40 text-sm font-bold">
                    {(displayName || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link href={`/profile/${npub}`} className="no-underline min-w-0" data-testid={`hover-name-${npub.slice(0, 12)}`}>
                    <p className="text-sm font-semibold text-foreground truncate hover:text-brand transition-colors cursor-pointer">
                      {displayName || shortNpub}
                    </p>
                  </Link>
                  <HoverCardTrustBadge pubkey={pubkey} />
                </div>
                {nip05 && (
                  <Nip05Badge nip05={nip05} pubkey={pubkey} className="mt-0.5" textClassName="text-[11px] text-primary/70 dark:text-brand/70" iconClassName="w-3 h-3" />
                )}
              </div>
            </div>

            {about && (
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-2">
                {about}
              </p>
            )}

            <VouchedBySection pubkey={pubkey} />
            <TrustedBySection pubkey={pubkey} />

            <div className="space-y-1.5 pt-1">
              <button
                type="button"
                onClick={handleCopyNpub}
                className="flex items-center gap-2 group w-full text-left cursor-pointer hover:bg-muted/50 rounded-md px-1 -mx-1 py-0.5 transition-colors"
                data-testid={`button-copy-npub-${npub.slice(0, 12)}`}
              >
                <img src={nostrOstrichGif} alt="" className="w-4 h-4 object-contain shrink-0" />
                <span className="text-[11px] text-muted-foreground/60 font-mono truncate group-hover:text-muted-foreground/80 transition-colors">
                  {shortNpub}
                </span>
                {copied ? (
                  <Check className="w-3 h-3 text-green-800 dark:text-green-400 ml-auto shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-muted-foreground/50 ml-auto shrink-0 group-hover:text-muted-foreground/60 transition-colors" />
                )}
              </button>

              {lud16 && (
                <button
                  type="button"
                  onClick={handleZapClick}
                  className="flex items-center gap-2 group w-full text-left cursor-pointer hover:bg-muted/50 rounded-md px-1 -mx-1 py-0.5 transition-colors"
                  data-testid={`button-zap-${npub.slice(0, 12)}`}
                >
                  <BtcZapIcon className="w-4 h-4 text-amber-800/70 dark:text-amber-400/70 shrink-0" />
                  <span className="text-[11px] text-amber-600/60 dark:text-amber-300/60 truncate group-hover:text-amber-600/80 dark:group-hover:text-amber-300/80 transition-colors">
                    {lud16}
                  </span>
                  <Zap className="w-3 h-3 text-amber-500/30 dark:text-amber-400/25 ml-auto shrink-0 group-hover:text-amber-500/60 dark:group-hover:text-amber-400/60 transition-colors" />
                </button>
              )}
            </div>
          </div>
        </div>
      </HoverCardContent>
      {lud16 && (
        <ZapDialog
          open={showZapDialog}
          onOpenChange={setShowZapDialog}
          pubkey={pubkey}
          recipientName={displayName || shortNpub}
        />
      )}
    </HoverCard>
  );
}

export function ParsedPreviewText({ text }: { text: string }) {
  const segments = useMemo(() => {
    const parts: { type: "text" | "mention" | "strip"; value: string; pubkey?: string }[] = [];
    // naddr1 included: addressable refs (articles/wikis) must strip from
    // previews like note/nevent do — omitting it leaked raw "nostr:naddr1…"
    // text into the reply-context box.
    const regex = /nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
      }
      const bech32 = match[1];
      try {
        const decoded = nip19.decode(bech32);
        if (decoded.type === "npub") {
          parts.push({ type: "mention", value: bech32, pubkey: decoded.data as string });
        } else if (decoded.type === "nprofile") {
          parts.push({ type: "mention", value: bech32, pubkey: (decoded.data as any).pubkey });
        } else {
          parts.push({ type: "strip", value: "" });
        }
      } catch {
        parts.push({ type: "strip", value: "" });
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push({ type: "text", value: text.slice(lastIndex) });
    }
    return parts;
  }, [text]);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "mention" && seg.pubkey) {
          return <MentionProfileLink key={i} pubkey={seg.pubkey} />;
        }
        if (seg.type === "text") {
          return <span key={i}>{seg.value}</span>;
        }
        return null;
      })}
    </>
  );
}

// One shared fetch per quoted event id, so forty copies of one viral quote
// don't open forty subscriptions. Entries that settle "unreached" are evicted
// on settle: a retry must get a fresh ask, and a cached "we never got to ask"
// would pin every later mount of that quote to a dead answer.
type EmbeddedNoteFetch = { event: Event | null; outcome: "found" | "missing" | "unreached" };
const embeddedNoteFetchCache = new Map<string, Promise<EmbeddedNoteFetch>>();

export type NoteRef = { key: string; kind: "event" | "addr"; id?: string; coord?: { kind: number; pubkey: string; identifier: string }; encoded?: string; relays?: string[] };

/**
 * Every note/nevent/naddr reference in a post's content (plus its q-tag),
 * deduped — the refs the card layout pins BELOW the prose (quoted notes are
 * always surfaced, never hidden behind Show more). Exported so GuestPostBody
 * renders the same pinned cards: an embedded article/quote IS the shared
 * payload, and a guest preview without it was the post minus its point.
 */
export function extractNoteRefs(renderContent: string, quotedEventId: string | null): NoteRef[] {
  const out: NoteRef[] = [];
  const seen = new Set<string>();
  const re = new RegExp(NOTE_REF_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(renderContent)) !== null) {
    try {
      const decoded = nip19.decode(match[1]);
      if (decoded.type === "note") {
        const id = decoded.data as string;
        if (!seen.has(id)) { seen.add(id); out.push({ key: id, kind: "event", id, encoded: match[1] }); }
      } else if (decoded.type === "nevent") {
        const d = decoded.data as { id: string; relays?: string[] };
        if (!seen.has(d.id)) { seen.add(d.id); out.push({ key: d.id, kind: "event", id: d.id, encoded: match[1], relays: d.relays }); }
      } else if (decoded.type === "naddr") {
        const d = decoded.data as { identifier: string; pubkey: string; kind: number; relays?: string[] };
        const c = `${d.kind}:${d.pubkey}:${d.identifier}`;
        if (!seen.has(c)) { seen.add(c); out.push({ key: c, kind: "addr", coord: { kind: d.kind, pubkey: d.pubkey, identifier: d.identifier }, encoded: match[1], relays: d.relays }); }
      }
    } catch {}
  }
  if (quotedEventId) {
    const cm = quotedEventId.match(ADDR_COORD_RE);
    if (cm) {
      const c = `${cm[1]}:${cm[2]}:${cm[3]}`;
      if (!seen.has(c)) { seen.add(c); out.push({ key: c, kind: "addr", coord: { kind: Number(cm[1]), pubkey: cm[2], identifier: cm[3] } }); }
    } else if (/^[0-9a-f]{64}$/i.test(quotedEventId) && !seen.has(quotedEventId)) {
      seen.add(quotedEventId); out.push({ key: quotedEventId, kind: "event", id: quotedEventId });
    }
  }
  return out;
}

export function EmbeddedNote({ eventId, encoded, relays, parentEventId }: { eventId: string; encoded: string; relays?: string[]; parentEventId?: string }) {
  usePetnamesVersion(); // repaint author names/avatars when a petname changes (must precede early returns — rules of hooks)
  const isSelfRef = eventId === parentEventId;
  const [fetchedEvent, setFetchedEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(!isSelfRef);
  // "We never got to ask" is a distinct, settled state — same contract as the
  // reply-parent fetch: the spinner ends, and a tap retries. The old fetch
  // filed it as "not found", a claim about the note we had no basis for.
  const [unreached, setUnreached] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isSelfRef) return;
    const cachedEvents = eventStore.getByFilters({ ids: [eventId] });
    if (cachedEvents && cachedEvents.length > 0) {
      setFetchedEvent(cachedEvents[0]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let promise = embeddedNoteFetchCache.get(eventId);
    if (!promise) {
      // Most-likely relays first: the nevent's encoded hints, then the relays
      // the QUOTING post arrived on (in an outpost feed, the community relay),
      // then defaults. The old fetch asked hints OR defaults, never both — a
      // stale hint meant the defaults were never consulted, and vice versa.
      const candidates = orderedRelayCandidates([
        relays ?? [],
        parentEventId ? getEventRelays(parentEventId) : [],
        DEFAULT_RELAYS,
      ]);
      promise = queryAnswered(candidates, { ids: [eventId] }, 8_000)
        .then((res) => {
          const outcome = resolveFetchOutcome(res);
          const ev = outcome === "found" ? (res.events[0] as Event) : null;
          if (ev) eventStore.add(ev);
          if (outcome === "unreached") embeddedNoteFetchCache.delete(eventId);
          return { event: ev, outcome };
        })
        .catch((): EmbeddedNoteFetch => {
          embeddedNoteFetchCache.delete(eventId);
          return { event: null, outcome: "unreached" };
        });
      embeddedNoteFetchCache.set(eventId, promise);
    }
    // The shared promise settles regardless of which mounts are still alive —
    // its predecessor resolved only under the FIRST mount's cancelled flag, so
    // one unmount poisoned the cache with a spinner that could never end.
    promise.then((r) => {
      if (cancelled) return;
      setFetchedEvent(r.event);
      setUnreached(r.outcome === "unreached");
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [eventId, retryNonce]);

  useEffect(() => {
    if (fetchedEvent) {
      fetchProfilesCached([fetchedEvent.pubkey]);
    }
  }, [fetchedEvent]);

  const authorProfile = use$(
    () => fetchedEvent ? eventStore.replaceable(KIND_METADATA, fetchedEvent.pubkey) : undefined,
    [fetchedEvent?.pubkey]
  );

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/thread/${encoded}`);
  }, [encoded, navigate]);

  if (isSelfRef) return null;

  if (loading) {
    // min-h keeps the quoted-card slot close to a typical resolved card so the
    // fetch completing doesn't grow the row under the reader (feed-stability).
    return (
      <div className="my-2 rounded-lg border border-border dark:border-border/20 bg-muted/40 dark:bg-muted/10 p-3 flex items-center gap-2 min-h-[84px]" data-testid={`embedded-note-loading-${eventId.slice(0, 8)}`}>
        <RelayOutpostInlineLoader className="w-4 h-4" />
        <span className="text-xs text-muted-foreground/60 dark:text-muted-foreground/60">Loading referenced post...</span>
      </div>
    );
  }

  if (!fetchedEvent && unreached) {
    // Distinct from "not found": no relay answered, so nothing is known about
    // the note. A tap retries the fetch instead of claiming absence.
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setUnreached(false);
          setLoading(true);
          setRetryNonce((v) => v + 1);
        }}
        className="my-2 rounded-lg border border-border dark:border-border/20 bg-muted/40 dark:bg-muted/10 p-3 flex items-center gap-2 cursor-pointer min-h-[84px] w-full text-left"
        data-testid={`embedded-note-unreached-${eventId.slice(0, 8)}`}
      >
        <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground/50 dark:text-muted-foreground/50 shrink-0" />
        <span className="text-xs text-muted-foreground/60 dark:text-muted-foreground/60">Quoted post didn't load — tap to retry</span>
      </button>
    );
  }

  if (!fetchedEvent) {
    return (
      <div
        className="my-2 rounded-lg border border-border dark:border-border/20 bg-muted/40 dark:bg-muted/10 p-3 flex items-center gap-2 cursor-pointer min-h-[84px]"
        onClick={handleClick}
        data-testid={`embedded-note-fallback-${eventId.slice(0, 8)}`}
      >
        <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground/50 dark:text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground/60 dark:text-muted-foreground/60">Referenced post not found — tap to view thread</span>
      </div>
    );
  }

  const fallback = shortenNpub(formatNpub(fetchedEvent.pubkey));
  const name = authorProfile ? (getDisplayName(authorProfile, fallback) ?? fallback) : fallback;
  const avatar = getAvatarUrl(authorProfile);

  const timeAgo = (() => {
    try { return formatDistanceToNow(new Date(fetchedEvent.created_at * 1000), { addSuffix: true }); } catch { return ""; }
  })();

  const imageUrlRegex = /https?:\/\/\S+\.(jpeg|jpg|gif|png|webp)(\?[^\s]*)?/gi;
  const videoUrlRegex = /https?:\/\/\S+\.(mp4|webm|mov)(\?[^\s]*)?/gi;
  const audioUrlRegex = /https?:\/\/\S+\.(mp3|m4a|wav|ogg|opus|aac|flac)(\?[^\s]*)?/gi;
  const imageUrls = (fetchedEvent.content.match(imageUrlRegex) || []).slice(0, 4);
  const videoUrls = (fetchedEvent.content.match(videoUrlRegex) || []).slice(0, 1);
  // A quoted music/podcast post must arrive with its PLAYER, not as bare text
  // (live report: quoted Wavlake-style tracks rendered playerless). The imeta
  // tag's cover image (if any) rides along as the player's thumbnail.
  const audioUrls = (fetchedEvent.content.match(audioUrlRegex) || []).slice(0, 1);
  const audioCover = audioUrls.length > 0
    ? fetchedEvent.tags.find((t) => t[0] === "imeta")?.find?.((v) => typeof v === "string" && v.startsWith("image "))?.slice(6)
    : undefined;
  const textContent = fetchedEvent.content.replace(/https?:\/\/\S+/g, "").trim();
  // Token-preserving truncation: a naddr/nevent is 100s of chars, so a plain
  // slice(0,200) would cut it mid-token and leave it unresolvable (the raw
  // `nostr:naddr…` bug). This caps visible text but keeps nostr tokens whole so
  // an embedded event/article/wiki still resolves into its card.
  const previewText = truncatePreservingNostr(textContent, 200);

  return (
    <div
      className="my-2 rounded-lg border border-border dark:border-border/25 bg-muted/50 dark:bg-muted/10 p-3 space-y-2 cursor-pointer min-h-[84px]"
      onClick={handleClick}
      data-testid={`embedded-note-${eventId.slice(0, 8)}`}
    >
      <div className="flex items-center gap-2">
        <Avatar className="w-5 h-5 shrink-0 ring-1 ring-border/30">
          <AvatarImage src={avatar} alt={name} />
          <AvatarFallback className="bg-brand/10 text-brand text-[8px] font-bold">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-[11px] font-semibold text-foreground/80 truncate max-w-[160px]">{name}</span>
        <span className="text-[11px] text-muted-foreground/50">{timeAgo}</span>
      </div>
      {previewText && (
        // div (not p): the nested renderer can emit block-level cards (a resolved
        // event/article naddr → EmbeddedAddressCard), which are invalid inside <p>.
        // `nested` keeps note/nevent as shallow chips so a quoted note can't expand
        // another full EmbeddedNote (no infinite note-in-note).
        <div className="text-xs text-foreground/75 leading-relaxed whitespace-pre-wrap break-words">
          <TextWithUnresolvedNostr text={previewText} nested />
        </div>
      )}
      {imageUrls.length > 0 && (
        <div className={`grid gap-1.5 ${imageUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {imageUrls.map((url, i) => (
            // Fixed height (not max-h): a late-loading image can't change the
            // quoted card's height and shift the feed under the reader.
            <img
              key={url}
              src={url}
              alt={`Embedded image ${i + 1}`}
              className="w-full rounded-md object-cover h-[160px]"
              loading="lazy"
              decoding="async"
              data-testid={`embedded-note-img-${i}`}
            />
          ))}
        </div>
      )}
      {videoUrls.length > 0 && imageUrls.length === 0 && (
        <video
          src={videoUrls[0]}
          controls
          preload="metadata"
          className="w-full rounded-md aspect-video max-h-[200px] object-contain bg-black"
          onClick={(e) => e.stopPropagation()}
          data-testid="embedded-note-video"
        />
      )}
      {audioUrls.length > 0 && (
        <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
          {audioCover && (
            <img src={audioCover} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-md object-cover" />
          )}
          <audio
            src={audioUrls[0]}
            controls
            preload="metadata"
            className="h-10 w-full min-w-0"
            data-testid="embedded-note-audio"
          />
        </div>
      )}
    </div>
  );
}

function RelayPill({ url }: { url: string }) {
  const display = url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  return (
    <a
      href={`/outposts/${encodeURIComponent(url)}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.85em] font-medium cursor-pointer bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/25 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/25 transition-colors no-underline"
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        window.history.pushState(null, "", `/outposts/${encodeURIComponent(url)}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      <OutpostIcon className="w-3 h-3 shrink-0" />
      {display}
    </a>
  );
}

function GroupChatPill({ relayUrl, groupId }: { relayUrl: string; groupId: string }) {
  const relayDisplay = relayUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  const href = `/outposts/${encodeURIComponent(relayUrl)}?tab=chat&channel=${encodeURIComponent(groupId)}`;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.85em] font-medium cursor-pointer bg-sky-500/10 dark:bg-sky-500/15 border border-sky-500/25 dark:border-sky-400/20 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20 dark:hover:bg-sky-500/25 transition-colors no-underline"
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        window.history.pushState(null, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      <MessagesSquare className="w-3 h-3 shrink-0" />
      {relayDisplay}
      <span className="opacity-60">/</span>
      {groupId}
    </a>
  );
}

const COMBINED_REGEX = /(nostr:(?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+|wss?:\/\/[^\s<>"'`)\]},]+(?:'[a-zA-Z0-9_-]+)?)/g;

// Shallow, non-recursive reference to another note. Used at nested depth (inside
// an already-embedded note) in place of a full recursive EmbeddedNote so a
// note-in-note can't expand infinitely; taps through to the thread.
function NoteRefChip({ encoded }: { encoded?: string }) {
  const [, navigate] = useLocation();
  const href = encoded ? `/thread/${encoded}` : "#";
  return (
    <a
      href={href}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (encoded) navigate(href); }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.85em] bg-accent dark:bg-brand/10 border border-brand/20 text-brand/70 no-underline cursor-pointer hover:bg-accent/80 dark:hover:bg-brand/20 transition-colors"
      data-testid="note-ref-chip"
    >
      <CornerDownRight className="w-3 h-3 shrink-0" />
      Referenced post
    </a>
  );
}

export function TextWithUnresolvedNostr({ text, inlineOnly, nested }: { text: string; inlineOnly?: boolean; nested?: boolean }) {
  COMBINED_REGEX.lastIndex = 0;
  if (!COMBINED_REGEX.test(text)) return <span>{text}</span>;
  COMBINED_REGEX.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  while ((match = COMBINED_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const token = match[0];

    if (token.startsWith("nostr:")) {
      const bech32 = token.slice(6);
      let rendered = false;
      try {
        const decoded = nip19.decode(bech32);
        // Depth-guarded, shared with the top-level content renderer: addressable
        // embeds (naddr → event/article/wiki card) resolve at any depth; a
        // note/nevent expands into a full EmbeddedNote only at the top level and
        // degrades to a shallow chip when nested (no infinite note-in-note).
        const res = resolveNostrEmbed(decoded, { nested: !!nested });
        if (res.render === "mention") {
          parts.push(<MentionProfileLink key={`m${match.index}`} pubkey={res.pubkey} />);
          rendered = true;
        } else if (res.render === "address-card") {
          // inlineOnly (e.g. image-feed captions) must stay caption-sized — no card.
          if (!inlineOnly) {
            parts.push(<EmbeddedAddressCard key={`a${match.index}`} kind={res.kind} pubkey={res.pubkey} identifier={res.identifier} relays={res.relays} encoded={bech32} />);
            rendered = true;
          }
        } else if (res.render === "note-embed") {
          // inlineOnly (e.g. image-feed captions): a compact pill instead of a
          // full embedded-note card — captions must stay caption-sized.
          if (!inlineOnly) {
            parts.push(<EmbeddedNote key={`e${match.index}`} eventId={res.eventId} encoded={bech32} relays={res.relays} />);
            rendered = true;
          }
        } else if (res.render === "note-chip") {
          parts.push(<NoteRefChip key={`c${match.index}`} encoded={bech32} />);
          rendered = true;
        }
      } catch {}
      // NOTHING. This branch is only reached when a nostr: token matched the
      // pattern but failed to decode — a truncated or malformed identifier
      // pointing at nothing. It used to render a bordered "📎 Referenced note"
      // pill in the middle of the sentence: an emoji where the rest of the app
      // uses lucide, a box that looks tappable and isn't, and a claim that
      // there is a note to see when the identifier resolves to no note at all.
      // Every reference that DID decode is already carried by the card row
      // below the prose, so a broken one has nothing left to contribute.
    } else {
      const cleanUrl = token.replace(/[.,;:!?]+$/, "");
      const groupMatch = cleanUrl.match(/^(wss?:\/\/[^']+)'([a-zA-Z0-9_-]+)$/);
      if (groupMatch) {
        const relayUrl = groupMatch[1].replace(/\/+$/, "");
        const groupId = groupMatch[2];
        parts.push(<GroupChatPill key={`g${match.index}`} relayUrl={relayUrl} groupId={groupId} />);
      } else {
        parts.push(<RelayPill key={`r${match.index}`} url={cleanUrl} />);
      }
      if (cleanUrl.length < token.length) {
        parts.push(<span key={`rp${match.index}`}>{token.slice(cleanUrl.length)}</span>);
      }
    }

    lastIndex = COMBINED_REGEX.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
}

export const contentComponents: ComponentMap = {
  text: ({ node }) => <TextWithUnresolvedNostr text={node.value} />,
  link: ({ node }) => {
    return null;
  },
  emoji: ({ node }) => (
    <img
      src={node.url}
      alt={`:${node.code}:`}
      title={`:${node.code}:`}
      className="custom-emoji-inline"
      loading="eager"
      decoding="async"
    />
  ),
  mention: ({ node }) => {
    // Top-level (nested: false): naddr → addressable card, note/nevent → full
    // EmbeddedNote. Same shared resolver the embedded-note renderer uses, so the
    // two can't drift.
    const res = resolveNostrEmbed(node.decoded as any, { nested: false });
    if (res.render === "mention") return <MentionProfileLink pubkey={res.pubkey} />;
    if (res.render === "address-card") return <EmbeddedAddressCard kind={res.kind} pubkey={res.pubkey} identifier={res.identifier} relays={res.relays} encoded={node.encoded} />;
    if (res.render === "note-embed") return <EmbeddedNote eventId={res.eventId} encoded={node.encoded} relays={res.relays} />;
    return <span className="text-brand dark:text-brand/90">{node.encoded.slice(0, 16)}...</span>;
  },
  // X/Primal-style: inline colored link, same size as body text, no box.
  hashtag: ({ node }) => (
    <a
      href={`/search?tab=hashtags&q=${encodeURIComponent(`#${node.name}`)}`}
      data-testid={`link-hashtag-${node.name}`}
      className="font-medium cursor-pointer text-brand no-underline hover:underline"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = `/search?tab=hashtags&q=${encodeURIComponent(`#${node.name}`)}`;
        window.history.pushState(null, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      #{node.name}
    </a>
  ) };

const contentCacheKey = Symbol.for("nostr-post-content-v4");

/** Custom post-menu trigger glyph (user-supplied wifi.svg): a soft-opacity
 *  shield with signal arcs + dot inside. stroke=currentColor so it themes;
 *  the dot keeps its round cap, the arcs keep their square caps. While the
 *  menu is open the SIGNAL breathes — dot → arcs pulse softly in sequence
 *  (no rotation; a turning shield read wrong). Reduced-motion: static. */
function PostMenuCaret({ className, open }: { className?: string; open?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className ?? ""} ${open ? "post-menu-open" : ""}`}
      aria-hidden="true"
    >
      <path strokeLinecap="round" className="pm-signal" d="M12 14.7695C12.1369 14.7695 12.2319 14.8918 12.2302 15.0195C12.2286 15.145 12.1202 15.2595 11.99 15.2595C11.86 15.2595 11.75 15.1495 11.75 15.0195C11.75 14.8795 11.86 14.7695 12 14.7695Z" />
      <path className="pm-signal" style={{ animationDelay: "0.2s" }} d="M16 10.1101C13.64 8.29012 10.35 8.29012 8 10.1101" />
      <path className="pm-signal" style={{ animationDelay: "0.1s" }} d="M9.66992 12.5499C11.0499 11.4899 12.96 11.4899 14.34 12.5499" />
      <path opacity="0.4" d="M20.92 11.1201C20.92 16.1701 17.1101 20.9401 12.0001 22.0601C6.87006 20.9401 3.08008 16.1801 3.08008 11.1201V5.25008L11.9901 1.58008L20.91 5.25008L20.92 11.1201Z" />
    </svg>
  );
}

// Quick reactions kept intentionally small (5) to lower choice overhead (Hick's
// law); anything beyond these is available via the custom-emoji picker (+).
export const REACTIONS = [
  { content: "+", display: <Heart className="w-4.5 h-4.5" />, label: "like", emoji: "\u2764\uFE0F" },
  { content: "\u{1F525}", display: <span className="text-lg">{"\u{1F525}"}</span>, label: "fire", emoji: "\u{1F525}" },
  { content: "\u26A1", display: <span className="text-lg">{"\u26A1"}</span>, label: "zap", emoji: "\u26A1" },
  { content: "\u{1F4AF}", display: <span className="text-lg">{"\u{1F4AF}"}</span>, label: "hundred", emoji: "\u{1F4AF}" },
  { content: "\u{1F602}", display: <span className="text-lg">{"\u{1F602}"}</span>, label: "laugh", emoji: "\u{1F602}" },
];

export function closeAllReactionBars() {
  document.querySelectorAll(".reaction-bar-wrapper[data-open], .reaction-bar-wrapper[data-hover]").forEach((el) => {
    el.removeAttribute("data-open");
    el.removeAttribute("data-hover");
  });
}

export function dismissReactionBar(e: React.MouseEvent) {
  e.stopPropagation();
  const wrapper = (e.currentTarget as HTMLElement).closest(".reaction-bar-wrapper") as HTMLElement | null;
  if (wrapper) {
    wrapper.removeAttribute("data-open");
    wrapper.removeAttribute("data-hover");
    wrapper.setAttribute("data-closed", "true");
    wrapper.blur();
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

const reactionHoverTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function startReactionHoverDwell(e: React.PointerEvent | React.MouseEvent) {
  // Asked NOW, not at import: the answer changes when a tablet rotates.
  if (prefersTapForReactions()) return;
  const wrapper = (e.currentTarget as HTMLElement).closest(".reaction-bar-wrapper") || e.currentTarget;
  if (!(wrapper instanceof HTMLElement)) return;
  wrapper.removeAttribute("data-closed");
  const existing = reactionHoverTimers.get(wrapper);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    wrapper.setAttribute("data-hover", "true");
    reactionHoverTimers.delete(wrapper);
  }, 400);
  reactionHoverTimers.set(wrapper, timer);
}

export function cancelReactionHoverDwell(e: React.PointerEvent | React.MouseEvent) {
  const wrapper = (e.currentTarget as HTMLElement).closest(".reaction-bar-wrapper") || e.currentTarget;
  if (!(wrapper instanceof HTMLElement)) return;
  const timer = reactionHoverTimers.get(wrapper);
  if (timer) {
    clearTimeout(timer);
    reactionHoverTimers.delete(wrapper);
  }
  wrapper.removeAttribute("data-hover");
}

export function toggleMobileReactionBar(buttonEl: HTMLElement) {
  const wrapper = buttonEl.closest(".reaction-bar-wrapper") as HTMLElement | null;
  if (!wrapper) return;
  closeAllReactionBars();
  wrapper.removeAttribute("data-closed");
  wrapper.setAttribute("data-open", "true");
}

/**
 * Does this device want the TAP path to the reaction bar rather than the hover
 * one?
 *
 * This replaced `const isMobileDevice = window.innerWidth < 640`, which was
 * wrong twice over and is most of the reason the five quick reactions read as
 * "we only do hearts":
 *
 *  - It was a CONST evaluated once at module load. Rotate a tablet, resize a
 *    window, or open the app on a desktop and narrow it, and the answer stayed
 *    whatever it was at import time, forever.
 *  - It asked about WIDTH. The reaction bar opens on a 400ms hover DWELL, which
 *    a touch screen cannot produce at any width — and 640 is not even this app's
 *    own mobile breakpoint (`useIsMobile` is 768), so 640-767px got the desktop
 *    path on a touch device. That band is every tablet and every phone in
 *    landscape, and there the extra reactions were simply unreachable: a tap on
 *    the heart is all that ever happened.
 *
 * Asked as a capability, at call time, like `.reveal-on-hover` in index.css.
 */
export function prefersTapForReactions(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

if (typeof document !== "undefined") {
  // Registered unconditionally. It used to be gated on the module-load mobile
  // guess, so a device that guessed wrong could open a reaction bar it could
  // never dismiss by clicking away. Closing on an outside click is correct on
  // every device anyway — desktop simply also closes on mouse-leave.
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".reaction-bar-wrapper")) {
      closeAllReactionBars();
    }
  }, { capture: false });
}

export function normalizeReactionEmoji(content: string): string {
  if (content === "+" || content === "" || content === "\u2764\uFE0F" || content === "\u2764") return "\u2764\uFE0F";
  if (content === "-") return "\u{1F44E}";
  return content;
}

export function getReactionDisplay(content: string, emojiUrl?: string): React.ReactNode {
  if (isCustomEmoji(content) && emojiUrl) {
    const sc = getCustomEmojiShortcode(content);
    return <img src={emojiUrl} alt={sc || content} className="w-5 h-5 object-contain" loading="lazy" />;
  }
  const match = REACTIONS.find(r => r.content === content);
  if (match) return match.display;
  const normalized = normalizeReactionEmoji(content);
  return <span className="text-sm">{normalized}</span>;
}

export function CustomEmojiPicker({ emojis, onSelect, disabled, eventId }: {
  emojis: CustomEmoji[];
  onSelect: (emoji: CustomEmoji) => void;
  disabled?: boolean;
  eventId?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    const wrapper = triggerRef.current?.closest(".reaction-bar-wrapper") as HTMLElement | null;
    if (!wrapper) return;
    if (isOpen) {
      wrapper.setAttribute("data-open", "true");
    } else {
      wrapper.removeAttribute("data-open");
    }
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, CustomEmoji[]>();
    for (const e of emojis) {
      const list = map.get(e.packName) || [];
      list.push(e);
      map.set(e.packName, list);
    }
    return map;
  }, [emojis]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          className="reaction-bar-center"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); }}
          data-testid={`button-custom-emoji-picker-${eventId || "unknown"}`}
        >
          <SmilePlus className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 sm:w-72 p-0 border-border dark:border-brand/20 bg-popover dark:bg-[rgba(4,4,10,0.97)]"
        side="top"
        align="center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 max-h-56 overflow-y-auto">
          {[...grouped.entries()].map(([packName, packEmojis]) => (
            <div key={packName} className="mb-2 last:mb-0">
              <p className="text-[10px] font-display text-brand/70 dark:text-brand/60 px-1 mb-1 truncate">{packName}</p>
              <div className="grid grid-cols-6 sm:grid-cols-7 gap-1">
                {packEmojis.map((emoji) => (
                  <button
                    key={emoji.shortcode}
                    className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-accent dark:hover:bg-brand/15 transition-colors cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); onSelect(emoji); handleOpenChange(false); }}
                    title={`:${emoji.shortcode}:`}
                    disabled={disabled}
                    data-testid={`button-custom-emoji-${emoji.shortcode}`}
                  >
                    <img
                      src={emoji.url}
                      alt={emoji.shortcode}
                      className="w-7 h-7 sm:w-6 sm:h-6 object-contain"
                      loading="eager"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <a
          href="https://emojiverse.shakespeare.wtf/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] text-brand/50 dark:text-brand/40 hover:text-brand/80 dark:hover:text-brand/70 transition-colors border-t border-border dark:border-brand/10"
          onClick={(e) => e.stopPropagation()}
          data-testid="link-emojiverse"
        >
          Explore more on EmojiVerse
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </PopoverContent>
    </Popover>
  );
}

export function getEventEmojiMap(event: Event): Map<string, string> | null {
  const emojiTags = event.tags.filter((t) => t[0] === "emoji" && t[1] && t[2]);
  if (emojiTags.length === 0) return null;
  const map = new Map<string, string>();
  for (const tag of emojiTags) {
    map.set(tag[1], tag[2]);
  }
  return map;
}

export function emojifyChildren(children: React.ReactNode, emojiMap: Map<string, string>): React.ReactNode {
  return Array.isArray(children)
    ? children.map((child, i) => emojifyNode(child, emojiMap, i))
    : emojifyNode(children, emojiMap, 0);
}

function emojifyNode(node: React.ReactNode, emojiMap: Map<string, string>, key: number): React.ReactNode {
  if (typeof node === "string") {
    const parts = node.split(/:([a-zA-Z0-9_]+):/g);
    if (parts.length === 1) return node;
    const result: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) result.push(parts[i]);
      } else {
        const url = emojiMap.get(parts[i]);
        if (url) {
          result.push(
            <img key={`emoji-${key}-${i}`} src={url} alt={`:${parts[i]}:`} className="custom-emoji-inline" loading="lazy" />
          );
        } else {
          result.push(`:${parts[i]}:`);
        }
      }
    }
    return result;
  }
  if (isValidElement(node)) {
    const el = node as React.ReactElement<any>;
    const children = el.props?.children;
    if (children) {
      const emojified = emojifyChildren(children, emojiMap);
      if (emojified !== children) {
        return cloneElement(el, { key: el.key ?? key }, emojified);
      }
    }
  }
  return node;
}


export function RawFieldRow({ label, value, mono = true, description }: { label: string; value: string; mono?: boolean; description?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const handleCopy = async () => {
    try {
      const isNostrId = /^(npub1|note1|nevent1|nprofile1|[0-9a-f]{64}$)/i.test(value);
      if (isNostrId) {
        await copyNostrId(value);
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  return (
    <div className="group glass-dialog-field flex items-start gap-2" data-testid={`raw-field-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex-1 min-w-0">
        <span className="glass-dialog-field-label block">{label}</span>
        {description && (
          <span className="block text-[10px] text-muted-foreground/60 mb-0.5 leading-tight">{description}</span>
        )}
        <div className={`text-xs break-all ${mono ? "font-mono" : ""} text-foreground/80`}>
          {value.length > 300 ? value.slice(0, 300) + "..." : value}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="w-7 h-7 shrink-0 mt-2 text-muted-foreground/70 visibility-hidden group-hover:visibility-visible"
        style={{ visibility: copied ? "visible" : undefined }}
        onClick={handleCopy}
        data-testid={`button-copy-${label.toLowerCase().replace(/\s/g, "-")}`}
      >
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </Button>
    </div>
  );
}

export function ConsoleQuickCopyBtn({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="glass-console-btn justify-start gap-2 w-full text-xs"
      data-testid={`button-console-${label.toLowerCase().replace(/\s/g, "-")}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <Icon className="w-3.5 h-3.5 text-brand/70 shrink-0" />}
      <span className="text-foreground/80 truncate">{copied ? "Copied" : label}</span>
    </Button>
  );
}

export function RawEventDialog({ open, onOpenChange, event }: { open: boolean; onOpenChange: (v: boolean) => void; event: Event }) {
  const [fullCopied, setFullCopied] = useState(false);
  const { toast } = useToast();

  const fullJson = useMemo(() => JSON.stringify(event, null, 2), [event]);
  const noteId = useMemo(() => nip19.noteEncode(event.id), [event.id]);
  const npub = useMemo(() => nip19.npubEncode(event.pubkey), [event.pubkey]);
  const createdDate = useMemo(() => new Date(event.created_at * 1000).toLocaleString(), [event.created_at]);
  const tagsFormatted = useMemo(() => JSON.stringify(event.tags, null, 2), [event.tags]);

  const seenOnRelays = useMemo(() => getEventRelays(event.id), [event.id, open]);
  const eventFilter = useMemo(() => JSON.stringify({ ids: [event.id] }), [event.id]);
  const authorFilter = useMemo(() => JSON.stringify({ authors: [event.pubkey], kinds: [event.kind] }), [event.pubkey, event.kind]);
  const searchString = useMemo(() => {
    const parts = [
      `note: ${noteId}`,
      `kind: ${event.kind}`,
      `author: ${npub}`,
      `created: ${createdDate}`,
    ];
    if (event.tags.length > 0) {
      const eTags = event.tags.filter(t => t[0] === "e").map(t => t[1].slice(0, 12) + "...");
      const pTags = event.tags.filter(t => t[0] === "p").map(t => t[1].slice(0, 12) + "...");
      if (eTags.length > 0) parts.push(`refs: [${eTags.join(", ")}]`);
      if (pTags.length > 0) parts.push(`mentions: [${pTags.join(", ")}]`);
    }
    return parts.join("\n");
  }, [event, noteId, npub, createdDate]);

  const handleCopyFull = async () => {
    try {
      await navigator.clipboard.writeText(fullJson);
      setFullCopied(true);
      setTimeout(() => setFullCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-dialog max-w-lg max-h-[85vh] overflow-y-auto" data-testid={`dialog-raw-event-${event.id}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-brand uppercase tracking-widest text-brand dark:text-brand/90">
            <FileJson className="w-4 h-4 text-brand/70" />
            Raw Telemetry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          <RawFieldRow label="Event ID" value={event.id} description="Unique SHA-256 hash identifying this event on the Nostr network" />
          <RawFieldRow label="Note ID (NIP-19)" value={noteId} description="Human-readable Bech32-encoded version of the Event ID (starts with 'note1')" />
          <RawFieldRow label="Author Pubkey" value={event.pubkey} description="Hex-encoded public key of the account that created this event" />
          <RawFieldRow label="Author npub" value={npub} description="Human-readable Bech32-encoded version of the public key (starts with 'npub1')" />
          <RawFieldRow label="Kind" value={String(event.kind)} mono={false} description="Event type number — Kind 1 = short text note, Kind 6 = repost, Kind 7 = reaction, etc." />
          <RawFieldRow label="Created At" value={`${event.created_at} (${createdDate})`} mono={false} description="Unix timestamp (seconds since Jan 1 1970) when this event was signed" />

          <div data-testid={`field-seen-on-relays-${event.id}`} className="glass-dialog-field">
            <span className="glass-dialog-field-label block mb-0.5">Seen On Relays</span>
            <span className="block text-[10px] text-muted-foreground/60 mb-1 leading-tight">Which relay servers delivered this event to your client</span>
            {seenOnRelays.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {seenOnRelays.map((r) => {
                  const short = r.replace("wss://", "").replace("ws://", "").replace(/\/$/, "");
                  return (
                    <Badge key={r} variant="outline" className="text-[10px] font-mono text-brand/70 border-brand/20" data-testid={`badge-relay-${short}`}>
                      {short}
                    </Badge>
                  );
                })}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/50 italic">Not yet tracked — relay data appears for newly loaded events</span>
            )}
          </div>

          <RawFieldRow label="Content" value={event.content} mono={false} description="Raw text body of the event, before any rendering or media extraction" />
          {event.tags.length > 0 && (
            <RawFieldRow label="Tags" value={tagsFormatted} description="Structured metadata attached to this event — references to other events, pubkeys, relays, hashtags, etc." />
          )}
          <RawFieldRow label="Signature" value={event.sig} description="Schnorr signature proving this event was created by the author's private key" />
        </div>

        <div className="mt-4 pt-3 border-t border-border dark:border-brand/10">
          <span className="glass-dialog-field-label block">Console Quick Copy</span>
          <span className="block text-[10px] text-muted-foreground/60 mb-2 leading-tight">Pre-built filters and data you can paste into dev tools or other Nostr clients</span>
          <div className="grid grid-cols-2 gap-2">
            <ConsoleQuickCopyBtn icon={Filter} label="Event Filter" value={eventFilter} />
            <ConsoleQuickCopyBtn icon={User} label="Author Filter" value={authorFilter} />
            <ConsoleQuickCopyBtn icon={Search} label="Search Summary" value={searchString} />
            <ConsoleQuickCopyBtn icon={Terminal} label="Full JSON" value={fullJson} />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border dark:border-brand/10">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 font-brand uppercase tracking-widest text-xs"
            onClick={handleCopyFull}
            data-testid={`button-copy-full-json-${event.id}`}
          >
            {fullCopied ? <Check className="w-3.5 h-3.5 mr-1.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
            {fullCopied ? "Copied" : "Copy Full JSON"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// Addressable-event coordinate: "kind:pubkey:d-tag" (from a q-tag or decoded naddr).
const ADDR_COORD_RE = /^(\d+):([0-9a-f]{64}):(.*)$/i;
const NOTE_REF_RE = /nostr:(note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+)/gi;

// Resolves + renders an addressable (parameterized-replaceable) event embedded by
// naddr or a q-tag coordinate. Known kinds (30023 article, 30818 wiki) get a
// labelled card that opens the right viewer; unknown kinds (e.g. 30817) get a
// generic titled card with a content preview. Fixes "Quoted post not found" /
// raw naddr links for every addressable embed.
export function EmbeddedAddressCard({ kind, pubkey: authorPk, identifier, relays, encoded }: { kind: number; pubkey: string; identifier: string; relays?: string[]; encoded?: string }) {
  const petnamesVersion = usePetnamesVersion(); // author name below re-derives on petname changes
  const [, navigate] = useLocation();
  const [resolved, setResolved] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  // Same contract as EmbeddedNote: nobody answering is a settled, retryable
  // state, not "content unavailable" — that line is a claim about the content.
  const [unreached, setUnreached] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [shareEvent, setShareEvent] = useState<CalendarEventData | null>(null);

  useEffect(() => {
    setResolved(null);
    setLoading(true);
    setUnreached(false);
    const existing = eventStore.getByFilters({ kinds: [kind], authors: [authorPk], "#d": [identifier] });
    const found = existing ? [...existing].sort((a, b) => b.created_at - a.created_at)[0] : null;
    if (found) { setResolved(found); setLoading(false); return; }
    // Resolve via the naddr's own relay hints, then the AUTHOR'S write relays
    // (NIP-65 outbox — an event lives where its author published it, which is
    // usually NOT in a handful of generic defaults; without this, a shared
    // calendar event / article on the creator's own or an outpost relay never
    // resolved → "content unavailable"), then a broad default set.
    const relaySet = orderedRelayCandidates([
      relays ?? [],
      // Listings cluster on the marketplace's own relay (measured:
      // relay.conduit.market serves 30402 that general relays may lack).
      kind === KIND_CLASSIFIED_LISTING ? LISTING_RELAYS : [],
      getWriteRelays(authorPk, []),
      FAST_RELAYS,
      DEFAULT_RELAYS.slice(0, 6),
    ]);
    let cancelled = false;
    queryAnswered(relaySet, { kinds: [kind], authors: [authorPk], "#d": [identifier], limit: 1 }, 8_000).then((res) => {
      if (cancelled) return;
      // Addressable events are replaceable — relays may hold different
      // versions of the same coordinate, so keep the newest.
      const newest = [...res.events].sort((a, b) => b.created_at - a.created_at)[0] as Event | undefined;
      if (newest) {
        eventStore.add(newest);
        setResolved(newest);
      } else if (!res.answered) {
        setUnreached(true);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [kind, authorPk, identifier, relays, retryNonce]);

  const authorProfile = use$(() => resolved ? eventStore.replaceable(KIND_METADATA, resolved.pubkey) : undefined, [resolved?.pubkey]);
  useEffect(() => { if (resolved && !authorProfile) fetchProfilesCached([resolved.pubkey]); }, [resolved, authorProfile]);

  const displayName = useMemo(() => {
    if (!resolved) return "...";
    const fb = shortenNpub(formatNpub(resolved.pubkey));
    return authorProfile ? (getDisplayName(authorProfile, fb) ?? fb) : fb;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, authorProfile, petnamesVersion]);
  const avatarUrl = authorProfile ? getAvatarUrl(authorProfile) : undefined;

  const tagVal = (name: string) => resolved?.tags.find((t) => t[0] === name)?.[1];
  const isCalendarEventKind = kind === KIND_DATE_CALENDAR_EVENT || kind === KIND_TIME_CALENDAR_EVENT;
  const kindLabel = kind === 30023 ? "Article" : kind === 30818 ? "Wiki" : isCalendarEventKind ? "Event" : `Kind ${kind}`;
  // Shared calendar events (NIP-52) get the dedicated event card below.
  const calendarData = useMemo(
    () => (resolved && isCalendarEventKind ? parseCalendarEvent(resolved) : null),
    [resolved, isCalendarEventKind]
  );
  const title = useMemo(() => tagVal("title") || identifier || kindLabel, [resolved, identifier, kind]);
  const image = kind === 30023 ? tagVal("image") : undefined;
  const previewText = useMemo(() => {
    const raw = (tagVal("summary") || resolved?.content || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[#*_>`~\[\]]/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
    return raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
  }, [resolved]);

  const openTarget = useMemo(() => {
    if (!resolved) return "#";
    try {
      if (kind === 30023) return `/articles/${nip19.naddrEncode({ kind, pubkey: resolved.pubkey, identifier, relays: relays ?? [] })}`;
      return `/thread/${nip19.noteEncode(resolved.id)}`;
    } catch { return "#"; }
  }, [resolved, kind, identifier, relays]);

  if (loading) {
    // Calendar events reserve the full card footprint up front so the feed
    // doesn't shift when the event resolves.
    if (isCalendarEventKind) return <EventCardSkeleton variant="embed" />;
    return (
      <div className="mt-2 rounded-lg border border-border/30 bg-background/30 p-3 flex items-center gap-2">
        <RelayOutpostInlineLoader className="w-3 h-3" />
        <span className="text-xs text-muted-foreground">Loading {kindLabel.toLowerCase()}...</span>
      </div>
    );
  }

  if (!resolved && unreached) {
    // No relay answered — nothing is known about the content, so don't call
    // it unavailable. A tap retries the fetch.
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setRetryNonce((v) => v + 1); }}
        className="mt-2 rounded-lg border border-border/30 bg-background/20 p-2.5 flex items-center gap-2 w-full text-left cursor-pointer"
        data-testid={`address-card-unreached-${kind}`}
      >
        <FileJson className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
        <span className="text-xs text-muted-foreground/80 truncate flex-1">{kindLabel} didn't load — tap to retry</span>
      </button>
    );
  }

  if (!resolved) {
    const njump = encoded ? `https://njump.to/${encoded}` : undefined;
    return (
      <div className="mt-2 rounded-lg border border-border/30 bg-background/20 p-2.5 flex items-center gap-2" data-testid={`address-card-unavailable-${kind}`}>
        <FileJson className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
        <span className="text-xs text-muted-foreground/80 truncate flex-1">{kindLabel} · content unavailable</span>
        {njump && (
          <a href={njump} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-brand shrink-0 whitespace-nowrap">View on Nostr →</a>
        )}
      </div>
    );
  }

  // NIP-99 classified listings get the marketplace card — image-led, price
  // up front, in-app detail dialog (see components/ListingCard).
  if (kind === KIND_CLASSIFIED_LISTING) {
    const listing = parseListing(resolved);
    if (listing) return <div className="mt-2"><ListingCard listing={listing} /></div>;
  }

  if (calendarData) {
    return (
      <>
        <EventCard
          variant="embed"
          ce={calendarData}
          onOpen={() => {
            // No standalone event page yet — the Search → Events tab scoped to
            // the host surfaces this event alongside the host's others.
            try { navigate(`/search?tab=events&q=${nip19.npubEncode(calendarData.pubkey)}`); } catch {}
          }}
          onShare={(ce) => setShareEvent(ce)}
        />
        {shareEvent && <ShareEventDialog ce={shareEvent} onClose={() => setShareEvent(null)} />}
      </>
    );
  }

  // Live event (NIP-53, kind 30311): render a proper on-brand stream card
  // instead of the generic "Kind 30311 · <uuid>" fallback. zap.stream /
  // nostreamer streams arrive here as naddr embeds.
  if (kind === KIND_LIVE_EVENT) {
    const status = (tagVal("status") || "").toLowerCase();
    const isLive = status === "live";
    const streamTitle = tagVal("title") || tagVal("summary") || "Live stream";
    const poster = tagVal("image");
    const participants = tagVal("current_participants");
    const statusLabel = isLive ? "Live" : status === "ended" ? "Ended" : status === "planned" ? "Upcoming" : "Live stream";
    const statusClass = isLive
      ? "bg-red-600 text-white"
      : status === "ended"
        ? "bg-muted text-muted-foreground"
        : "bg-primary/15 text-primary";
    let liveNaddr = "";
    try { liveNaddr = nip19.naddrEncode({ kind, pubkey: resolved.pubkey, identifier, relays: relays ?? [] }); } catch {}
    const goLive = (e: React.MouseEvent) => { e.stopPropagation(); if (liveNaddr) navigate(`/live/${liveNaddr}`); };
    const StatusPill = (
      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusClass}`}>
        {isLive && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
        {statusLabel}
      </span>
    );
    return (
      <div
        className="mt-2 rounded-xl border border-border/60 bg-card overflow-hidden cursor-pointer hover:border-primary/40 transition-colors"
        onClick={goLive}
        data-testid="address-card-live-30311"
      >
        {poster && (
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted/30">
            <img src={poster} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <span className="absolute top-2 left-2">{StatusPill}</span>
            <div className="absolute bottom-2 right-2 w-10 h-10 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-lg">
              <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
            </div>
          </div>
        )}
        <div className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Avatar className="w-4 h-4">
              {avatarUrl && <AvatarImage src={avatarUrl} />}
              <AvatarFallback className="text-[8px]">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium truncate">{displayName}</span>
            {!poster && <span className="ml-auto shrink-0">{StatusPill}</span>}
          </div>
          <p className="text-sm font-semibold leading-snug line-clamp-2">{streamTitle}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Radio className="w-3 h-3 text-brand/70 shrink-0" />
            {participants ? `${participants} watching · ` : ""}Open in Relay Outpost
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 rounded-lg border border-border/30 bg-background/20 cursor-pointer overflow-hidden hover-elevate transition-colors"
      onClick={(e) => { e.stopPropagation(); if (openTarget !== "#") navigate(openTarget); }}
      data-testid={`address-card-${kind}`}
    >
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Avatar className="w-4 h-4">
            {avatarUrl && <AvatarImage src={avatarUrl} />}
            <AvatarFallback className="text-[8px]">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-xs font-medium truncate">{displayName}</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 ml-auto shrink-0">{kindLabel}</span>
        </div>
        <p className="text-sm font-semibold leading-snug line-clamp-2 mb-1">{title}</p>
        {image && (
          <img src={image} alt="" loading="lazy" className="w-full max-h-40 object-cover rounded-md mb-1.5" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        )}
        {previewText && (
          <p className="text-xs text-muted-foreground/85 whitespace-pre-wrap break-words leading-relaxed line-clamp-3">{previewText}</p>
        )}
      </div>
    </div>
  );
}

// Dispatch a quoted reference (q-tag value) to the right renderer: a bare hex id
// is a normal event; a "kind:pubkey:d" coordinate is an addressable event.
interface PostBodyProps {
  event: Event;
  compact?: boolean;
  onToggleThread?: () => void;
  threadExpanded?: boolean;
  onModeratorRemove?: (eventId: string) => void;
  onModeratorBanAuthor?: (pubkey: string, eventId: string) => void;
  priority?: boolean;
  focused?: boolean;
}

/**
 * How a fragment reports itself. A context rather than a prop chain because the
 * signal originates four levels down (PostBody) and is consumed by the feed —
 * threading it through PostFrame and NostrPost would put a parameter about
 * feed composition on two components that have no business knowing about it.
 */
export const ParentUnresolvedContext = createContext<((eventId: string) => void) | null>(null);

function PostBody({ event, compact = false, onToggleThread, threadExpanded, onModeratorRemove, onModeratorBanAuthor, priority = false, focused = false }: PostBodyProps) {
  usePetnamesVersion(); // repaint author names/avatars when a petname changes
  const { toast } = useToast();
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const [, navigate] = useLocation();
  const { isBookmarked: checkBookmarked, isPrivateBookmark, toggleBookmark, addBookmark, removeBookmark, setBookmarkPrivacy } = useNostrBookmarks();
  const { isUserLive } = useLiveStatus();
  const { enabled: ttsEnabled, startReading, isReading, sourceUrl: ttsSourceUrl, stop: stopTTS, isPaused, isLoading: ttsLoading, progress: ttsProgress, rate: ttsRate, setRate: setTTSRate, togglePause: toggleTTSPause } = useTTS();
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [showQuoteComposer, setShowQuoteComposer] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  // Context is shown by default now (Settings → Text can turn it off). A reply
  // with its parent hidden is a fragment — "Very good points" says nothing —
  // and charging a tap before a sentence means anything is the wrong default
  // for an app whose subject is conversation.
  const replyContextOn = useReplyContext();
  const [showParentPost, setShowParentPost] = useState(replyContextOn);
  // Follow the preference when it CHANGES, so flipping the switch in Settings
  // takes effect on posts already on screen instead of only after a reload.
  // Keyed on the preference alone, so a per-post collapse the reader chose by
  // hand is not undone on every render.
  useEffect(() => {
    setShowParentPost(replyContextOn);
  }, [replyContextOn]);
  const [parentEvent, setParentEvent] = useState<Event | null>(null);
  const [showRawData, setShowRawData] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showMuteConfirm, setShowMuteConfirm] = useState(false);
  const [showPrivateReply, setShowPrivateReply] = useState(false);
  const parentFetchedRef = useRef(false);

  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);

  const replyTargetId = useMemo(() => getReplyTargetId(event), [event]);
  const isReply = !!replyTargetId;

  const replyToPubkey = useMemo(() => {
    if (!isReply) return null;
    const eTags = event.tags.filter((t) => t[0] === "e");
    const replyETag = eTags.find((t) => t[3] === "reply") || eTags.find((t) => t[3] === "root");
    if (replyETag && replyETag[1]) {
      const parentInStore = eventStore.getByFilters({ ids: [replyETag[1]] });
      const parentEvt = parentInStore ? [...parentInStore][0] : null;
      if (parentEvt) return parentEvt.pubkey;
    }
    // NIP-10 orders p-tags root-first with the immediate parent LAST. The old
    // code took the FIRST p-tag — usually the thread root (often the author
    // themselves) — so a reply to someone else got mislabeled "replying to
    // <root/self>". Prefer the last p-tag that isn't this post's own author.
    const pTags = event.tags.filter((t) => t[0] === "p" && t[1]);
    const nonSelf = pTags.filter((t) => t[1] !== event.pubkey);
    const pick = nonSelf.length > 0 ? nonSelf : pTags;
    return pick.length > 0 ? pick[pick.length - 1][1] : null;
  }, [event, isReply]);

  const replyToProfile = use$(
    () => replyToPubkey ? eventStore.replaceable(KIND_METADATA, replyToPubkey) : undefined,
    [replyToPubkey]
  );

  useEffect(() => {
    if (replyToPubkey && !replyToProfile) {
      fetchProfiles([replyToPubkey], DEFAULT_RELAYS.slice(0, 3));
    }
  }, [replyToPubkey, replyToProfile]);

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
      return replyToPubkey.slice(0, 8) + "...";
    }
  }, [replyToPubkey, replyToProfile]);

  const replyToAvatarUrl = getAvatarUrl(replyToProfile);

  const replyToProfileUrl = useMemo(() => {
    if (!replyToPubkey) return "#";
    try {
      return `/profile/${nip19.npubEncode(replyToPubkey)}`;
    } catch {
      return "#";
    }
  }, [replyToPubkey]);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const [parentNotFound, setParentNotFound] = useState(false);
  // Tell the feed this post is a fragment so it can drop the row. Fired once,
  // and only after the lookup has SETTLED — "not fetched yet" must never be
  // mistaken for "does not exist", or slow relays would silently eat replies.
  const onUnresolved = useContext(ParentUnresolvedContext);
  useEffect(() => {
    if (parentNotFound && replyTargetId) onUnresolved?.(event.id);
  }, [parentNotFound, replyTargetId, event.id, onUnresolved]);

  // "We never got to ask" is a distinct, settled state: the spinner ends,
  // the reply is NOT dropped from the feed, and a tap retries.
  const [parentUnreached, setParentUnreached] = useState(false);
  const [parentRetryNonce, setParentRetryNonce] = useState(0);

  useEffect(() => {
    if (!replyTargetId || parentFetchedRef.current) return;
    const targetKind = classifyParentTarget(replyTargetId);
    if (targetKind !== "event") {
      // A malformed target can never be fetched. Settle as missing — the old
      // early return left "Loading parent post..." spinning forever.
      parentFetchedRef.current = true;
      setParentNotFound(true);
      return;
    }
    parentFetchedRef.current = true;
    const existingSet = eventStore.getByFilters({ ids: [replyTargetId] });
    const existing = existingSet ? [...existingSet][0] : null;
    if (existing) {
      setParentEvent(existing);
      fetchProfiles([existing.pubkey], DEFAULT_RELAYS.slice(0, 3));
      return;
    }
    // Most-likely relays first: the e-tag's hint, then the relays this reply
    // itself arrived on (in an outpost feed, the community relay — where the
    // old DEFAULT_RELAYS-only query never looked), then defaults.
    const relays = parentRelayCandidates({
      event,
      targetId: replyTargetId,
      seenOn: getEventRelays(event.id),
      defaults: DEFAULT_RELAYS,
    });
    queryAnswered(relays, { ids: [replyTargetId] }, 8_000).then((res) => {
      if (!mountedRef.current) return;
      const outcome = resolveFetchOutcome(res);
      if (outcome === "found") {
        const parent = res.events[0] as Event;
        eventStore.add(parent);
        setParentEvent(parent);
        fetchProfiles([parent.pubkey], DEFAULT_RELAYS.slice(0, 3));
      } else if (outcome === "missing") {
        setParentNotFound(true);
      } else {
        setParentUnreached(true);
        parentFetchedRef.current = false;
      }
    }).catch(() => {
      if (!mountedRef.current) return;
      setParentUnreached(true);
      parentFetchedRef.current = false;
    });
  }, [replyTargetId, event, parentRetryNonce]);

  const retryParentFetch = useCallback(() => {
    setParentUnreached(false);
    setParentRetryNonce((v) => v + 1);
  }, []);

  const handleShowParent = useCallback(() => {
    if (!replyTargetId) return;
    setShowParentPost((prev) => !prev);
  }, [replyTargetId]);

  const primalStats = usePrimalStats(event.id);
  const [localReactionCount, setLocalReactionCount] = useState(0);
  const replyCount = primalStats?.replies ?? 0;
  const repostCount = primalStats?.reposts ?? 0;
  // Every emoji reaction counts toward one tally. Use the larger of Primal's
  // server count and a live local count, so a reaction we already know about
  // (e.g. from a notification) shows before Primal indexes it.
  const likeCount = Math.max(primalStats?.likes ?? 0, localReactionCount);
  const zapCount = primalStats?.zaps ?? 0;
  const zapAmount = primalStats?.zapAmount ?? 0;

  const [hasReposted, setHasReposted] = useState(false);
  const [hasLiked, setHasLiked] = useState(false);
  const [hasReplied, setHasReplied] = useState(false);
  const [myReactionContent, setMyReactionContent] = useState<string | null>(null);
  const [myReactionEmojiUrl, setMyReactionEmojiUrl] = useState<string | undefined>(undefined);
  const { emojis: customEmojis } = useCustomEmojis();
  const [reactionPopping, setReactionPopping] = useState(false);
  const reactionPopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (reactionPopTimerRef.current) clearTimeout(reactionPopTimerRef.current); };
  }, []);

  // Reaction / repost / reply state derives from the shared interaction index
  // (one store subscription for the whole app) instead of each post opening its
  // own insert$ subscription and re-scanning the store on every event. The reads
  // are split per-kind — mirroring the old segregated check* handlers — so an
  // unrelated reaction never rewrites optimistic repost/reply state (which would
  // clobber a rollback). Optimistic setState in the action handlers below is
  // unchanged; the index reconciles once the event lands in the store.
  const derivedInteraction = useInteraction(event.id);
  useEffect(() => {
    setHasReposted(derivedInteraction.hasReposted);
  }, [derivedInteraction.hasReposted]);
  useEffect(() => {
    setLocalReactionCount(derivedInteraction.reactionCount);
  }, [derivedInteraction.reactionCount]);
  useEffect(() => {
    setHasLiked(derivedInteraction.hasLiked);
    setMyReactionContent(derivedInteraction.myReactionContent);
    setMyReactionEmojiUrl(derivedInteraction.myReactionEmojiUrl);
  }, [derivedInteraction.hasLiked, derivedInteraction.myReactionContent, derivedInteraction.myReactionEmojiUrl]);
  useEffect(() => {
    setHasReplied(derivedInteraction.hasReplied);
  }, [derivedInteraction.hasReplied]);

  const isBookmarked = checkBookmarked(event.id);

  const fallbackName = shortenNpub(formatNpub(event.pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(authorProfile);
  const npubShort = shortenNpub(formatNpub(event.pubkey));
  const lightningAddress = useMemo(() => {
    if (!authorProfile) return null;
    const content = getProfileContent(authorProfile);
    return (content as any)?.lud16 || null;
  }, [authorProfile]);
  const authorNip05 = useMemo(() => {
    if (!authorProfile) return null;
    const content = getProfileContent(authorProfile);
    return (content as any)?.nip05 || null;
  }, [authorProfile]);
  const quotedEventId = useMemo(() => {
    const qTag = event.tags.find((t) => t[0] === "q");
    return qTag ? qTag[1] : null;
  }, [event]);

  // Referenced/quoted notes are always surfaced as cards below the prose (X-style),
  // never hidden behind "Show more". We collect every inline nostr note/nevent/naddr
  // reference (in author order, deduped) plus the q-tag if it isn't already inline.
  // Rewrite plain links to Nostr web clients (njump, nostrudel, primal, …) into
  // their `nostr:<bech32>` form BEFORE any reference/media parsing runs — so a
  // pasted event link resolves into a real embedded card (and a profile link
  // into an @mention) instead of an ugly generic link preview.
  const renderContent = useMemo(() => normalizeNostrClientLinks(event.content), [event.content]);

  const noteRefs = useMemo(() => extractNoteRefs(renderContent, quotedEventId), [renderContent, quotedEventId]);

  /**
   * Does this post QUOTE the very note it is replying to?
   *
   * Two different code paths render a referenced note and neither knew about
   * the other: the reply-context preview renders `replyTargetId` (from the
   * e-tags), and the quote cards render every `nostr:note1…`/`nevent…` found in
   * the content. A "quote-reply" — reply to X, and paste X — satisfies both, so
   * the same note was drawn twice, back to back, with the author's own words
   * (often none at all, since the quote IS the post) nowhere between them.
   *
   * The quote card wins. It is unconditional, while the context preview depends
   * on a user setting and a per-post toggle, so keeping the card is the only
   * choice that shows the note exactly once in EVERY state.
   */
  const parentIsQuoted = useMemo(
    () => quotesItsParent(replyTargetId, noteRefs.map((r) => r.id)),
    [replyTargetId, noteRefs],
  );

  const { text: textContent, media: mediaItems } = useMemo(() => extractMediaFromContent(renderContent), [renderContent]);

  // Foreign-language posts carry a quiet Translate control; while a translation
  // is showing, the translated prose flows through the exact same truncation +
  // rich-render pipeline the original uses (in-place swap, media untouched).
  const tr = useTranslation(event);

  // Prose = the human message with reference tokens stripped out (they render as
  // cards below). "Show more" is decided on prose length only, so a short post
  // that merely quotes a note (raw bech32 is 60+ chars) no longer collapses.
  const proseText = useMemo(() => {
    const base = tr.showing && tr.translatedProse !== null ? tr.translatedProse : textContent;
    return base
      .replace(NOTE_REF_RE, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }, [textContent, tr.showing, tr.translatedProse]);

  const TRUNCATE_CHARS = 300;
  // The focused thread note is shown in full — never clamp it behind "Show more"
  // (the reader opened it to read it; collapsing the quote/reference is excise).
  const needsTruncation = !focused && proseText.length > TRUNCATE_CHARS;
  const isOwnPost = pubkey === event.pubkey;
  const hasMedia = mediaItems.length > 0;
  const hasOnlyMedia = hasMedia && proseText.length === 0;
  const isShortMessage = proseText.length <= 120 && proseText.length > 0 && !hasMedia && !needsTruncation;
  const feedStyle = useFeedStyle();
  const isBubbles = feedStyle === "bubbles";
  // Full-bleed applies to media-dominant posts only, and only in the `clean`
  // feed style — media escaping an SMS bubble would be incoherent, and that
  // style is an explicit choice to look like messages. `compact` is a quoted
  // or embedded context where the media is a reference, not the subject.
  const fullBleed = useMemo(
    () => isMediaFeedEnabled() && !isBubbles && !compact && isMediaDominant(event),
    [isBubbles, compact, event],
  );
  const [isExpanded, setIsExpanded] = useState(false);
  // Post-menu open state — drives the caret's 180° disclosure flip.
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  // Read the admin-relay records only while the menu is open — this component
  // renders per-post in feeds, and the gate must cost nothing when closed.
  const canFeature = useMemo(() => postMenuOpen && getAdminOutposts().length > 0, [postMenuOpen]);

  const displayText = useMemo(() => {
    if (!needsTruncation || isExpanded) return proseText;
    const truncated = proseText.slice(0, TRUNCATE_CHARS);
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > TRUNCATE_CHARS * 0.6 ? truncated.slice(0, lastSpace) : truncated) + "...";
  }, [proseText, needsTruncation, isExpanded]);

  const truncatedEvent = useMemo(() => {
    // A translated view must present a fresh object identity — the content
    // renderer caches per event, and handing it the original `event` would
    // serve the untranslated render back.
    if ((!needsTruncation || isExpanded) && !tr.showing) return event;
    const derived = { ...event, content: displayText };
    // The spread copies applesauce's parse cache too (it lives on the event as
    // an enumerable symbol property) — strip it, or the renderer serves the
    // ORIGINAL parse and the translated/truncated text never appears.
    Reflect.deleteProperty(derived, contentCacheKey);
    return derived;
  }, [event, needsTruncation, isExpanded, displayText, tr.showing]);

  const rawRenderedContent = useRenderedContent(truncatedEvent, contentComponents, {
    cacheKey: contentCacheKey,
    content: displayText });

  const eventEmojiMap = useMemo(() => getEventEmojiMap(event), [event]);
  const renderedContent = useMemo(() => {
    if (!rawRenderedContent || !eventEmojiMap) return rawRenderedContent;
    return emojifyChildren(rawRenderedContent, eventEmojiMap);
  }, [rawRenderedContent, eventEmojiMap]);

  const timeAgo = useMemo(() => formatCompactTime(event.created_at), [event.created_at]);

  // "via [App]" NIP-89 attribution — focused/thread view only, opt-in, and only
  // computed when both conditions hold so scrolling feed rows do zero work.
  const showClientTag = useShowClientTag();
  const clientDisplay = useMemo(
    () => (focused && showClientTag ? getClientDisplay(event) : null),
    [focused, showClientTag, event],
  );

  const profileUrl = useMemo(() => {
    try {
      return `/profile/${nip19.npubEncode(event.pubkey)}`;
    } catch {
      return "#";
    }
  }, [event.pubkey]);

  const noteId = useMemo(() => formatNoteId(event.id), [event.id]);

  const threadUrl = `/thread/${noteId}`;
  const isReadingThis = isReading && ttsSourceUrl === threadUrl;

  const handleListenClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReadingThis) {
      stopTTS();
      return;
    }
    const raw = event.content;
    const stripped = raw.replace(/nostr:\w+/g, "").replace(/https?:\/\/\S+/g, "").replace(/[*_~`#>\[\]()!|]/g, "").trim();
    if (!stripped || stripped.length < 10) {
      toast({ title: "Too short", description: "This post is too short to read aloud.", variant: "destructive" });
      return;
    }
    const authorName = authorProfile ? getDisplayName(authorProfile) : "Unknown";
    startReading(raw, `Post by ${authorName}`, threadUrl, { inline: true });
  }, [event.content, authorProfile, startReading, stopTTS, isReadingThis, threadUrl, toast]);

  const handleCardClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest("a, button, textarea, input, select, label, video, iframe, [role='menuitem'], [role='button'], [role='link'], [role='dialog'], [data-radix-popper-content-wrapper], [data-radix-dropdown-menu-trigger], [data-radix-collection-item], [data-no-navigate]")) return;
    const sel = window.getSelection();
    if (sel && sel.toString() && sel.anchorNode && (e.currentTarget as HTMLElement).contains(sel.anchorNode)) return;
    navigate(`/thread/${noteId}`);
  }, [navigate, noteId]);

  const handleReply = () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to reply.", variant: "destructive" });
      return;
    }
    setShowReplyComposer(!showReplyComposer);
  };

  const handlePrivateReply = () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to reply privately.", variant: "destructive" });
      return;
    }
    setShowPrivateReply(true);
  };

  const handleRepost = async () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to repost.", variant: "destructive" });
      return;
    }
    if (isProtectedEvent(event)) {
      toast({
        title: "Protected note",
        description: "This note is marked protected by its author (NIP-70) and can't be rebroadcast to other relays.",
        variant: "destructive",
      });
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
        content: JSON.stringify(event) };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      setHasReposted(true);
      setIsReposting(false);
      eventStore.add(signedEvent);
      window.dispatchEvent(new CustomEvent("nostr-repost-created", {
        detail: { repostEvent: signedEvent, originalEvent: event } }));
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
        content };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      setHasLiked(true);
      setIsLiking(false);
      setMyReactionContent(content);
      if (emojiTag) setMyReactionEmojiUrl(emojiTag[2]);
      setReactionPopping(true);
      if (reactionPopTimerRef.current) clearTimeout(reactionPopTimerRef.current);
      reactionPopTimerRef.current = setTimeout(() => setReactionPopping(false), 350);
      const existing = primalStatsCache.get(event.id);
      primalStatsCache.set(event.id, {
        replies: existing?.replies ?? 0,
        reposts: existing?.reposts ?? 0,
        likes: (existing?.likes ?? 0) + 1,
        zaps: existing?.zaps ?? 0,
        zapAmount: existing?.zapAmount ?? 0 });
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

  const handleBookmark = () => toggleBookmark(event.id);
  const isBookmarkPrivate = isPrivateBookmark(event.id);

  const handleUndoRepost = async () => {
    if (!signer || !pubkey) return;
    const all = eventStore.getByFilters({ kinds: [KIND_REPOST] });
    const myRepost = [...all].find(
      (e) => e.pubkey === pubkey && e.tags.some((t) => t[0] === "e" && t[1] === event.id)
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
        content: "" };
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
      window.dispatchEvent(new CustomEvent("nostr-repost-removed", {
        detail: { originalEventId: event.id, reposterPubkey: pubkey } }));
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

  const handleQuote = () => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to quote.", variant: "destructive" });
      return;
    }
    if (isProtectedEvent(event)) {
      toast({
        title: "Protected note",
        description: "This note is marked protected by its author (NIP-70) and can't be rebroadcast to other relays.",
        variant: "destructive",
      });
      return;
    }
    setShowQuoteComposer(!showQuoteComposer);
  };

  const handleCopyLink = async () => {
    try {
      // Shareable WEB url — it unfurls (server OG card) and opens a logged-out
      // guest preview, unlike a bare nostr: URI. "Copy ID" below still gives the
      // raw nostr identifier for pasting into other Nostr clients.
      await copyNostrId(`${window.location.origin}/thread/${nip19.noteEncode(event.id)}`);
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

  const handleShareNote = async () => {
    // nevent with seen-on hints + author (share-links.ts): a bare id gave
    // whoever opens the link nothing to follow to where the post lives.
    const url = `${window.location.origin}/thread/${noteShareId(event.id, event.pubkey, getEventRelays(event.id))}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Nostr Note", url });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "Copied", description: "Share link copied." });
      } catch {}
    }
  };

  const avatarSize = compact ? "w-7 h-7" : "w-9 h-9";
  const contentPadding = compact ? "px-2.5 sm:px-3.5 pt-2.5 sm:pt-3 pb-2 sm:pb-2.5" : "px-3.5 sm:px-5 pt-3.5 sm:pt-4 pb-2.5 sm:pb-3";
  const authorIsLive = isUserLive(event.pubkey);

  return (
    <article data-testid={`post-${event.id}`} onClick={handleCardClick} className="cursor-pointer">
      <div className={`flex items-center gap-2.5 sm:gap-3 glass-header rounded-t-xl ${contentPadding}`}>
        <AuthorHoverCard pubkey={event.pubkey} profile={authorProfile}>
          <Link href={profileUrl} data-testid={`link-avatar-${event.id}`} onMouseEnter={() => prefetchProfileOnHover(event.pubkey)}>
            <div className="relative">
              <Avatar className={`${avatarSize} shrink-0 ${authorIsLive ? "ring-2 ring-red-500/50" : "ring-1 ring-border dark:ring-white/10"} border border-background cursor-pointer`}>
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-brand/10 text-brand font-bold text-xs">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {authorIsLive && (
                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-background shadow-[0_0_6px_1px_rgba(239,68,68,0.4)] live-dot" title="Live now" data-testid={`indicator-live-dot-${event.id}`} />
              )}
            </div>
          </Link>
        </AuthorHoverCard>
        <div className="flex-1 min-w-0">
          {/* X/Primal-style single line: Name · nip05 · time */}
          <div className="flex items-center gap-1 min-w-0">
            <Link href={profileUrl} data-testid={`link-author-${event.id}`} className="min-w-0 shrink">
              <span className={`font-bold block truncate cursor-pointer text-foreground tracking-tight ${compact ? "text-sm sm:text-xs" : "text-[15px]"}`} data-testid={`text-author-name-${event.id}`}>
                {displayName}
              </span>
            </Link>
            <TrustTierDot pubkey={event.pubkey} />
            <PostBadgeIcons pubkey={event.pubkey} />
            {isProtectedEvent(event) && <ProtectedNoteBadge />}
            {authorNip05 && (
              <>
                <Nip05VerifiedCheck nip05={authorNip05} pubkey={event.pubkey} className="w-3 h-3 shrink-0" />
                <span className="text-[13px] text-muted-foreground/55 truncate shrink min-w-0 max-w-[42%] hidden min-[360px]:inline" data-testid={`text-nip05-${event.id}`}>
                  {authorNip05}
                </span>
              </>
            )}
            <span className="text-muted-foreground/40 select-none shrink-0">·</span>
            <span className="text-[13px] text-muted-foreground/70 whitespace-nowrap shrink-0" data-testid={`text-time-${event.id}`}>
              {timeAgo}
            </span>
          </div>
          {clientDisplay && (
            <div className="mt-0.5 min-w-0">
              <ClientTagBadge display={clientDisplay} />
            </div>
          )}
        </div>
        <DropdownMenu onOpenChange={setPostMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              // Disclosure cues so the caret can't read as a downvote: smaller +
              // quieter than an action icon, labeled "Post menu", and it flips
              // 180° while the menu is open (votes never rotate; menus do).
              className="w-7 h-7 shrink-0 text-muted-foreground/40 hover:text-muted-foreground/70 [&_svg]:size-3"
              onClick={(e) => e.stopPropagation()}
              aria-label="Post menu"
              title="Post menu"
              data-testid={`button-post-menu-${event.id}`}
            >
              <PostMenuCaret className="w-3 h-3" open={postMenuOpen} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-dropdown min-w-[190px]" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => setTimeout(handlePrivateReply, 0)} data-testid={`menu-private-reply-${event.id}`}>
              <Lock className="w-3.5 h-3.5 text-brand/70" />
              Reply privately
            </DropdownMenuItem>
            {/* Share + Bookmark relocated here from the action row (user call:
                free post real estate; the row keeps reply/repost/like/zap). */}
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleShareNote} data-testid={`menu-share-${event.id}`}>
              <Share2 className="w-3.5 h-3.5 text-brand/70" />
              Share Post
            </DropdownMenuItem>
            {/* Operators/mods only: feature this post on a relay they run —
                curation happens in the feed, not in a console. */}
            {canFeature && (
              <DropdownMenuItem
                className="gap-2.5 cursor-pointer"
                onSelect={() => setTimeout(() => setFeatureDialogOpen(true), 0)}
                data-testid={`menu-feature-${event.id}`}
              >
                <MagicStarIcon className="w-3.5 h-3.5 text-brand/70" />
                Add to Featured
              </DropdownMenuItem>
            )}
            {/* Bookmark: FLAT items in the main menu (a Radix submenu didn't
                reliably open on touch). Not-saved → two save options; saved →
                privacy toggle + remove. */}
            {!isBookmarked ? (
              <>
                <DropdownMenuItem
                  className="gap-2.5 cursor-pointer"
                  disabled={!pubkey}
                  onSelect={() => addBookmark(event.id, "e", true)}
                  data-testid={`button-bookmark-private-${event.id}`}
                >
                  <Lock className="w-3.5 h-3.5 text-brand/70" />
                  <div className="flex flex-col">
                    <span>Bookmark privately</span>
                    <span className="text-[10px] text-muted-foreground/60">Only visible to you</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2.5 cursor-pointer"
                  disabled={!pubkey}
                  onSelect={() => addBookmark(event.id, "e", false)}
                  data-testid={`button-bookmark-public-${event.id}`}
                >
                  <Globe className="w-3.5 h-3.5 text-brand/70" />
                  <div className="flex flex-col">
                    <span>Bookmark publicly</span>
                    <span className="text-[10px] text-muted-foreground/60">Visible on your profile</span>
                  </div>
                </DropdownMenuItem>
              </>
            ) : (
              <>
                {isBookmarkPrivate ? (
                  <DropdownMenuItem
                    className="gap-2.5 cursor-pointer"
                    onSelect={() => setBookmarkPrivacy(event.id, false)}
                    data-testid={`button-bookmark-make-public-${event.id}`}
                  >
                    <Globe className="w-3.5 h-3.5 text-brand/70" />
                    Make bookmark public
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className="gap-2.5 cursor-pointer"
                    onSelect={() => setBookmarkPrivacy(event.id, true)}
                    data-testid={`button-bookmark-make-private-${event.id}`}
                  >
                    <Lock className="w-3.5 h-3.5 text-brand/70" />
                    Make bookmark private
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="gap-2.5 cursor-pointer text-destructive"
                  onSelect={() => removeBookmark(event.id)}
                  data-testid={`button-bookmark-remove-${event.id}`}
                >
                  <BookmarkCheck className="w-3.5 h-3.5 fill-current" />
                  Remove bookmark
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="glass-dropdown-label">Copy</DropdownMenuLabel>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyLink} data-testid={`menu-copy-link-${event.id}`}>
              <Copy className="w-3.5 h-3.5 text-brand/70" />
              Note Link
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyText} data-testid={`menu-copy-text-${event.id}`}>
              <Type className="w-3.5 h-3.5 text-brand/70" />
              Note Text
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyNoteId} data-testid={`menu-copy-id-${event.id}`}>
              <Hash className="w-3.5 h-3.5 text-brand/70" />
              Note ID
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={handleCopyNpub} data-testid={`menu-copy-npub-${event.id}`}>
              <User className="w-3.5 h-3.5 text-brand/70" />
              Author npub
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="glass-dropdown-label">Inspect</DropdownMenuLabel>
            <DropdownMenuItem className="gap-2.5 cursor-pointer" onSelect={() => setTimeout(() => setShowRawData(true), 0)} data-testid={`menu-raw-data-${event.id}`}>
              <FileJson className="w-3.5 h-3.5 text-brand/70" />
              Raw Telemetry
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2.5 cursor-pointer"
              onSelect={() => setTimeout(() => {
                // Jump to the Event Console pre-filtered to this exact event,
                // seeded with a relay it was seen on when we know one.
                const seen = getEventRelays(event.id);
                const relayParam = seen.length > 0 ? `&relay=${encodeURIComponent(seen[0])}` : "";
                navigate(`/console?filter=${encodeURIComponent(JSON.stringify({ ids: [event.id] }))}${relayParam}`);
              }, 0)}
              data-testid={`menu-inspect-console-${event.id}`}
            >
              <Terminal className="w-3.5 h-3.5 text-brand/70" />
              Inspect raw event
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => setTimeout(() => setShowMuteConfirm(true), 0)} data-testid={`menu-mute-${event.id}`}>
              <VolumeX className="w-3.5 h-3.5" />
              Mute Signal
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => setTimeout(() => setShowReportDialog(true), 0)} data-testid={`menu-report-${event.id}`}>
              <Flag className="w-3.5 h-3.5" />
              Report Content
            </DropdownMenuItem>
            {(onModeratorRemove || onModeratorBanAuthor) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="glass-dropdown-label">Moderate</DropdownMenuLabel>
                {onModeratorRemove && (
                  <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => onModeratorRemove(event.id)} data-testid={`menu-mod-remove-${event.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove from relay
                  </DropdownMenuItem>
                )}
                {onModeratorBanAuthor && event.pubkey !== pubkey && (
                  <DropdownMenuItem className="gap-2.5 cursor-pointer text-destructive" onSelect={() => onModeratorBanAuthor(event.pubkey, event.id)} data-testid={`menu-mod-ban-${event.id}`}>
                    <Ban className="w-3.5 h-3.5" />
                    Ban author
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ReportDialog open={showReportDialog} onOpenChange={setShowReportDialog} event={event} />
      {showPrivateReply && (
        <PrivateReplyDialog open={showPrivateReply} onOpenChange={setShowPrivateReply} event={event} />
      )}
      {featureDialogOpen && (
        <AddToFeaturedDialog event={event} open={featureDialogOpen} onOpenChange={setFeatureDialogOpen} />
      )}
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

      {/* With the spine on, this whole row goes: the thread-line and the parent's
          own byline already say who is being answered, so "Replying to @x" plus
          a Show-context button is three controls for one fact. */}
      {isReply && !parentIsQuoted && !replyContextOn && (
        <div className={`flex items-center gap-1.5 ${compact ? "px-4 sm:px-5 pt-2.5" : "px-5 sm:px-8 pt-3.5"}`}>
          <CornerUpLeft className="w-3 h-3 text-muted-foreground/70 shrink-0" />
          {replyToName ? (
            <>
              <span className="text-xs sm:text-xs text-muted-foreground/80">Replying to</span>
              <Link href={replyToProfileUrl} data-testid={`link-reply-to-${event.id}`} className="flex items-center gap-1 cursor-pointer">
                <Avatar className="w-4 h-4 shrink-0 ring-1 ring-primary/30 dark:ring-brand/30 border border-background">
                  <AvatarImage src={replyToAvatarUrl} alt={replyToName} />
                  <AvatarFallback className="bg-brand/10 text-brand font-bold text-[7px]">
                    {replyToName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs sm:text-xs text-brand/80 font-medium">
                  @{replyToName}
                </span>
              </Link>
            </>
          ) : (
            <span className="text-xs sm:text-xs text-muted-foreground/80">Reply</span>
          )}
          <button
            className="text-xs sm:text-[11px] text-muted-foreground/70 cursor-pointer ml-auto flex items-center gap-0.5"
            onClick={handleShowParent}
            data-testid={`button-show-parent-${event.id}`}
          >
            <CornerDownRight className="w-2.5 h-2.5" />
            {showParentPost ? "Hide context" : "Show context"}
          </button>
        </div>
      )}

      {isReply && !parentIsQuoted && showParentPost && (
        <div className={`${compact ? "mx-4 sm:mx-5" : "mx-5 sm:mx-8"} ${replyContextOn ? (compact ? "pt-2.5" : "pt-3.5") : "mt-2.5"}`}>
          {parentEvent ? (
            <ParentPostPreview event={parentEvent} variant={replyContextOn ? "spine" : "card"} />
          ) : parentNotFound ? (
            // NOTHING. A reply whose parent cannot be fetched is a fragment —
            // "Yeah, on small stuff sure…" with no visible thing being replied
            // to — and the old notice told the reader that a relay lookup
            // failed, which is our problem and not information they can use.
            // The feed drops these posts entirely (see onParentUnresolved); a
            // thread view keeps the reply, because there the reader navigated
            // to it deliberately and its absence IS the answer.
            null
          ) : parentUnreached ? (
            // We never got to ask — a different fact from "missing", so the
            // reply stays in the feed and the reader can retry. Unlike the
            // old failure notice, a tap target is actionable.
            <button
              onClick={(e) => { e.stopPropagation(); retryParentFetch(); }}
              className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 dark:bg-muted/20 border border-border dark:border-border/20 text-[11px] text-muted-foreground/80 cursor-pointer w-full text-left"
              data-testid={`parent-retry-${event.id}`}
            >
              <CornerUpLeft className="w-3 h-3 shrink-0" />
              Context didn't load — tap to retry
            </button>
          ) : (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 dark:bg-muted/20 border border-border dark:border-border/20" data-testid={`parent-loading-${event.id}`}>
              <RelayOutpostInlineLoader />
              <span className="text-[11px] text-muted-foreground/80">Loading parent post...</span>
            </div>
          )}
        </div>
      )}

      <div className={`${compact ? "mx-4 sm:mx-5 mt-4 mb-5 sm:mb-6" : isBubbles ? "mx-5 sm:mx-8 mt-5 mb-6 sm:mb-8" : "mx-5 sm:mx-8 mt-4 mb-4 sm:mb-5"}`}>
        <div className={`${isBubbles ? "rounded-xl glass-inner" : ""} ${isBubbles && isShortMessage ? "w-fit max-w-[85%]" : ""} ${hasOnlyMedia ? "p-0 overflow-hidden" : isBubbles ? (compact ? "px-2.5 sm:px-3 py-2.5 sm:py-3" : "px-3 sm:px-4 py-3 sm:py-4") : ""}`}>
          {renderedContent && !hasOnlyMedia && proseText.length > 0 && (
            <div className={`post-content-text whitespace-pre-wrap break-words ${hasMedia ? "mb-2" : ""} ${compact ? "text-sm sm:text-xs leading-[1.7]" : isBubbles ? "post-bubbles-text leading-[1.85]" : "post-clean-text leading-[1.45]"}`} data-testid={`text-content-${event.id}`}>
              {renderedContent}
            </div>
          )}
          {needsTruncation && (
            <button
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
              className="text-xs text-brand/80 mt-1.5 cursor-pointer font-medium tracking-wide"
              data-testid={`button-toggle-expand-${event.id}`}
            >
              {isExpanded ? "Show less" : "Show more"}
            </button>
          )}

          <TranslateLine tr={tr} eventId={event.id} />

          {/* Full-bleed: the media escapes the prose margins and spans the whole
              card, so a photo post reads as the photo rather than as an
              attachment inside a box. The negative margin is exactly the
              wrapper's own margin — no magic numbers, they cancel.
              No clipping needed: media sits BETWEEN the header and the action
              bar, so it never reaches the card's rounded corners. */}
          <div
            className={fullBleed ? "-mx-5 sm:-mx-8" : ""}
            data-frame={fullBleed ? "full-bleed" : "inset"}
            // The frame sets the media's radius rather than the media choosing
            // it: spanning the card and staying rounded still reads as "image
            // in a box", which is the language full-bleed exists to leave.
            style={fullBleed ? ({ "--media-radius": "0px" } as React.CSSProperties) : undefined}
          >
            <MediaRenderer event={event} compact={compact} priority={priority} />
          </div>

          {noteRefs.length > 0 && (
            <div className="mt-1.5 space-y-2" data-testid={`quoted-refs-${event.id}`}>
              {noteRefs.slice(0, 2).map((r) =>
                r.kind === "addr" && r.coord ? (
                  <EmbeddedAddressCard key={r.key} kind={r.coord.kind} pubkey={r.coord.pubkey} identifier={r.coord.identifier} relays={r.relays} encoded={r.encoded} />
                ) : (
                  <EmbeddedNote key={r.key} eventId={r.id!} encoded={r.encoded || nip19.noteEncode(r.id!)} relays={r.relays} parentEventId={event.id} />
                )
              )}
              {noteRefs.length > 2 && (
                <div className="flex flex-wrap gap-1.5">
                  {noteRefs.slice(2).map((r) => {
                    let href: string | null = null;
                    try {
                      href = r.kind === "addr" && r.coord
                        ? `/thread/${nip19.naddrEncode({ kind: r.coord.kind, pubkey: r.coord.pubkey, identifier: r.coord.identifier, relays: r.relays ?? [] })}`
                        : `/thread/${r.encoded || nip19.noteEncode(r.id!)}`;
                    } catch { href = null; }
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (href) navigate(href); }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[0.8em] bg-accent dark:bg-brand/10 border border-brand/20 text-brand/70 hover:bg-accent/80 transition-colors"
                        data-testid={`quoted-ref-chip-${r.key.slice(0, 8)}`}
                      >
                        <Quote className="w-3 h-3" /> Referenced note
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <TopZapperAvatars eventId={event.id} hasZaps={zapCount > 0 || zapAmount > 0} />

      <div className={`${isBubbles ? "glass-footer rounded-b-xl" : ""} py-3 flex items-center gap-0.5 sm:gap-1 ${compact ? "px-2 sm:px-3.5" : "px-2.5 sm:px-5"}`}>
        <Button
          variant="ghost"
          size="icon"
          className={`w-8 h-8 sm:w-9 sm:h-9 gap-1 ${threadExpanded ? "text-foreground" : hasReplied ? "stat-glow-replies" : "text-muted-foreground"}`}
          onClick={onToggleThread}
          data-testid={`button-reply-${event.id}`}
        >
          <MessageSquare className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${hasReplied ? "fill-current" : ""}`} />
        </Button>
        <button
          className={`text-[11px] sm:text-xs -ml-0.5 sm:-ml-1 mr-0.5 sm:mr-1 shrink-0 cursor-pointer rounded ${FOCUS_RING} ${threadExpanded ? "text-foreground" : hasReplied ? "stat-glow-replies" : "text-muted-foreground"}`}
          onClick={onToggleThread}
          data-testid={`text-reply-count-${event.id}`}
        >
          {formatCount(replyCount || 0)}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`w-8 h-8 sm:w-9 sm:h-9 ${hasReposted ? "stat-glow-reposts" : "text-muted-foreground"}`}
              data-testid={`button-repost-${event.id}`}
            >
              {isReposting ? <RelayOutpostInlineLoader className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <Repeat className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="glass-dropdown min-w-[140px]">
            {isProtectedEvent(event) ? (
              <DropdownMenuItem
                disabled
                className="gap-2 text-muted-foreground/60"
                data-testid={`button-protected-blocked-${event.id}`}
              >
                <Lock className="w-3.5 h-3.5" />
                Protected — can't rebroadcast
              </DropdownMenuItem>
            ) : (
              <>
                {hasReposted ? (
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer text-destructive"
                    onClick={handleUndoRepost}
                    data-testid={`button-undo-repost-${event.id}`}
                  >
                    <Repeat className="w-3.5 h-3.5" />
                    Undo repost
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onClick={handleRepost}
                    disabled={isReposting}
                    data-testid={`button-do-repost-${event.id}`}
                  >
                    <Repeat className="w-3.5 h-3.5 text-brand/70" />
                    Repost
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="gap-2 cursor-pointer"
                  onClick={handleQuote}
                  data-testid={`button-quote-repost-${event.id}`}
                >
                  <Quote className="w-3.5 h-3.5 text-brand/70" />
                  Quote
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className={`text-[11px] sm:text-xs -ml-0.5 sm:-ml-1 mr-0.5 sm:mr-1 min-w-[1ch] shrink-0 transition-opacity duration-200 ${repostCount > 0 ? "opacity-100" : "opacity-0"} ${hasReposted ? "stat-glow-reposts" : "text-muted-foreground"}`} data-testid={`text-repost-count-${event.id}`}>
          {formatCount(repostCount || 0)}
        </span>

        {/* Single-tap like. The emoji / custom-emoji fan-out was removed for a
            lighter, faster, less distracting action row (heart-only). */}
        <Button
          variant="ghost"
          size="icon"
          className={`w-8 h-8 sm:w-9 sm:h-9 ${reactionPopping ? "reaction-pop" : ""} ${hasLiked ? "stat-glow-likes" : "text-muted-foreground"}`}
          onClick={(e) => { e.stopPropagation(); handleLike(); }}
          disabled={isLiking || hasLiked}
          data-testid={`button-like-${event.id}`}
        >
          {isLiking ? (
            <RelayOutpostInlineLoader className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          ) : (
            <Heart className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${hasLiked ? "fill-current" : ""}`} />
          )}
        </Button>
        <ReactionDetailsPopover
          eventId={event.id}
          likeCount={likeCount}
          trigger={
            <span className={`text-[11px] sm:text-xs -ml-0.5 sm:-ml-1 mr-0.5 sm:mr-1 min-w-[1ch] shrink-0 transition-opacity duration-200 cursor-pointer ${likeCount > 0 ? "opacity-100" : "opacity-0 pointer-events-none"} ${hasLiked ? "stat-glow-likes" : "text-muted-foreground"}`} data-testid={`text-like-count-${event.id}`}>
              {formatCount(likeCount || 0)}
            </span>
          }
        />

        <div className="flex-1" />

        {ttsEnabled && (isReadingThis ? (
          <div className="flex items-center gap-1 bg-accent dark:bg-brand/10 rounded-full px-1.5 py-0.5 border border-brand/20" onClick={(e) => e.stopPropagation()} data-testid={`container-inline-tts-${event.id}`}>
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6 text-brand"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTTSPause(); }}
              title={isPaused ? "Resume" : "Pause"}
              data-testid={`button-tts-pause-${event.id}`}
            >
              {ttsLoading ? <RelayOutpostInlineLoader className="w-3 h-3" /> : isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </Button>
            <div className="w-16 sm:w-20 h-1.5 bg-brand/15 rounded-full overflow-hidden" data-testid={`progress-tts-${event.id}`}>
              <div
                className="h-full bg-primary dark:bg-brand rounded-full transition-all duration-300"
                style={{ width: `${Math.max(ttsProgress, 2)}%` }}
              />
            </div>
            <button
              className="text-[10px] font-mono text-brand px-1 py-0.5 rounded hover:bg-accent dark:hover:bg-brand/10 transition-colors min-w-[28px] text-center"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rates = [1, 1.25, 1.5, 2, 0.75];
                const idx = rates.indexOf(ttsRate);
                setTTSRate(rates[(idx + 1) % rates.length]);
              }}
              title="Change speed"
              data-testid={`button-tts-rate-${event.id}`}
            >
              {ttsRate}x
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6 text-red-700/80 dark:text-red-400/80 hover:text-red-700 dark:hover:text-red-300"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); stopTTS(); }}
              title="Stop"
              data-testid={`button-tts-stop-${event.id}`}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 sm:w-9 sm:h-9 text-muted-foreground"
            onClick={handleListenClick}
            title="Listen to post"
            data-testid={`button-listen-${event.id}`}
          >
            <Volume2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          </Button>
        ))}

        {/* Zap anchors the bottom-right (user call): the row's only
            variable-width element (the sats amount) sits at the edge where it
            live at a FIXED right position (aligned with the top-right ⋯ menu)
            so it doesn't shift between empty and rich posts. The signal-check
            badge and the (variable-width) zap amount both sit to its LEFT and
            grow inward. Share + Bookmark live in the ⋯ post menu. */}
        <PostBadgeToggle
          eventId={event.id}
          score={computeEngagementScore(primalStats ?? null)}
          stats={primalStats ?? null}
          size={compact ? "compact" : "default"}
        />
        {/* Zap = the row's hero: standard ₿-then-amount unit, gapped away from
            the demoted signal-check. The icon goes amber only when the post has
            sats (bonding icon+amount into one amber "value" unit); a zapless
            post keeps a plain muted tap-to-zap target. */}
        <Button
          variant="ghost"
          size="icon"
          className={`w-8 h-8 sm:w-9 sm:h-9 shrink-0 ml-2 ${zapCount > 0 || zapAmount > 0 ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground"}`}
          onClick={() => {
            if (!signer) {
              toast({ title: "Sign in required", description: "Sign in to zap.", variant: "destructive" });
              return;
            }
            setShowZapDialog(true);
          }}
          data-testid={`button-zap-${event.id}`}
        >
          <BtcZapIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
        </Button>
        <span className={`shrink-0 -ml-1 transition-opacity duration-200 ${zapCount > 0 || zapAmount > 0 ? "opacity-100" : "opacity-0 pointer-events-none w-0 overflow-hidden"}`}>
          <ZapReceiptsPopover eventId={event.id} zapAmount={zapAmount} zapCount={zapCount} />
        </span>
      </div>

      {showReplyComposer && (
        <div className={compact ? "px-2.5 sm:px-3.5 pb-3" : "px-3.5 sm:px-5 pb-3.5"}>
          <ReplyComposer replyTo={event} onClose={() => setShowReplyComposer(false)} />
        </div>
      )}

      {showQuoteComposer && (
        <div className={compact ? "px-2.5 sm:px-3.5 pb-3" : "px-3.5 sm:px-5 pb-3.5"}>
          <QuoteComposer quotedEvent={event} noteId={noteId} onClose={() => setShowQuoteComposer(false)} />
        </div>
      )}

      <ZapDialog
        open={showZapDialog}
        onOpenChange={setShowZapDialog}
        event={event}
        recipientName={displayName}
      />

      <RawEventDialog
        open={showRawData}
        onOpenChange={setShowRawData}
        event={event}
      />
    </article>
  );
}


interface NostrPostProps {
  event: Event;
  showReplies?: boolean;
  repostedBy?: { pubkey: string; timestamp: number } | null;
  onModeratorRemove?: (eventId: string) => void;
  onModeratorBanAuthor?: (pubkey: string, eventId: string) => void;
  priority?: boolean;
  inlineReplyBar?: ReactNode;
  /** Focused post (e.g. the thread root the user opened) — render fully, no clamp. */
  focused?: boolean;
}

export const NostrPost = memo(function NostrPost({ event, showReplies = false, repostedBy, onModeratorRemove, onModeratorBanAuthor, priority = false, inlineReplyBar, focused = false }: NostrPostProps) {
  const [showRepliesThread, setShowRepliesThread] = useState(showReplies);

  const handleToggleThread = useCallback(() => {
    setShowRepliesThread((prev) => !prev);
  }, []);

  const repostProfile = use$(() => repostedBy ? eventStore.replaceable(KIND_METADATA, repostedBy.pubkey) : undefined, [repostedBy?.pubkey]);
  const repostDisplayName = useMemo(() => {
    if (!repostedBy) return null;
    if (repostProfile) {
      const content = getProfileContent(repostProfile);
      if (content) return content.display_name || content.name || null;
    }
    try {
      const npub = nip19.npubEncode(repostedBy.pubkey);
      return `${npub.slice(0, 9)}...${npub.slice(-4)}`;
    } catch {
      return "someone";
    }
  }, [repostedBy, repostProfile]);

  useEffect(() => {
    if (repostedBy) fetchProfilesCached([repostedBy.pubkey]);
  }, [repostedBy]);

  const repostNpub = useMemo(() => {
    if (!repostedBy) return null;
    try { return nip19.npubEncode(repostedBy.pubkey); } catch { return null; }
  }, [repostedBy]);

  const isReplyPost = useMemo(() => !!getReplyTargetId(event), [event]);

  // In-feed sensitive gate: a content-warning-tagged post is blurred as a whole
  // card (honoring the user's sensitiveContent setting, default = hide) until
  // tapped. Per-session reveal, shared with the media renderer's ledger.
  const contentWarning = useMemo(() => getContentWarning(event), [event]);
  const cwGated = !!contentWarning && getSensitiveContentSetting();
  const [cwRevealed, setCwRevealed] = useState(() => !cwGated || isCwRevealed(event.id));
  const revealSensitive = useCallback(() => {
    markCwRevealed(event.id);
    setCwRevealed(true);
  }, [event.id]);
  const isBlurred = cwGated && !cwRevealed;

  // The wrapper, repost line, sensitive gate and card surface now live in
  // PostFrame — identical markup, one owner. Articles, polls, audio and live
  // move onto the same shell rather than each re-inventing these edges.
  return (
    <PostFrame
      eventId={event.id}
      isReply={isReplyPost}
      sensitive={isBlurred ? { reason: contentWarning, onReveal: revealSensitive } : null}
      repostSlot={repostedBy ? (
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-1.5 text-xs text-brand/70 dark:text-brand/80" data-testid={`text-reposted-by-${event.id}`}>
          <Repeat className="w-3 h-3 shrink-0" />
          <Link href={repostNpub ? `/profile/${repostNpub}` : "#"} className="no-underline cursor-pointer truncate">
            <span className="font-medium text-brand/90">{repostDisplayName}</span>
          </Link>
          <span className="text-brand/50 dark:text-brand/60">reposted</span>
        </div>
      ) : undefined}
      footerSlot={(inlineReplyBar || showRepliesThread) ? (
        <>
          {inlineReplyBar && <div className="ml-1 sm:ml-3">{inlineReplyBar}</div>}
          {showRepliesThread && (
            <div className="ml-1 sm:ml-3">
              <ReplyThread rootId={event.id} rootEvent={event} onClose={() => setShowRepliesThread(false)} showFloatingCollapse={!focused} bare={focused} />
            </div>
          )}
        </>
      ) : undefined}
    >
      <PostBody
        event={event}
        onToggleThread={handleToggleThread}
        threadExpanded={showRepliesThread}
        onModeratorRemove={onModeratorRemove}
        onModeratorBanAuthor={onModeratorBanAuthor}
        priority={priority}
        focused={focused}
      />
    </PostFrame>
  );
}, (prev, next) => {
  return prev.event.id === next.event.id
    && prev.showReplies === next.showReplies
    && prev.repostedBy?.pubkey === next.repostedBy?.pubkey
    && prev.repostedBy?.timestamp === next.repostedBy?.timestamp
    && prev.onModeratorRemove === next.onModeratorRemove
    && prev.onModeratorBanAuthor === next.onModeratorBanAuthor
    && prev.priority === next.priority
    && prev.focused === next.focused
    && prev.inlineReplyBar === next.inlineReplyBar;
});
