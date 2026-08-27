import { SearchPill } from "@/components/SearchPill";
import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useLocation } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { use$ } from "applesauce-react/hooks";
import { eventStore, subscribeToFeed, fetchProfiles, fetchProfilesCached, DEFAULT_RELAYS, pool, publishEvent, throttledPoolSubscribe, verifySignedEventKind } from "@/lib/nostr";
import { KIND_TEXT_NOTE, KIND_METADATA, KIND_FOLLOW_LIST, KIND_REPOST, KIND_GENERIC_REPOST, getDisplayName, getRealName, getAvatarUrl, getOptimizedImageUrl, getProfileContent, formatNpub, shortenNpub, parseFollowList, getMediaUrls } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { loadFollowBase, cacheFollowEvent } from "@/lib/follow-list";
import { fetchUserProfileStats, fetchUserAuthoredFeed, fetchUserNotesPaginated, fetchEventCounts, primalStatsCache, prefetchStatsImmediate, fetchBulkProfiles, fetchFollowersList, type UserProfileStats } from "@/lib/primal-cache";
import { NostrPost, BtcZapIcon } from "@/components/NostrPost";
import { capForGuest } from "@/lib/guest-limits";
import { GuestWall } from "@/components/GuestWall";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { Nip05Badge } from "@/components/Nip05Badge";
import { ImpersonationChip } from "@/components/ImpersonationChip";
import nostrOstrich from "@assets/219719339-5eff628c-3470-4cc3-81eb-404f8902de9f_1771392554698.gif";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageTabs, TabCountLine } from "@/components/PageTabs";
import { InviteFriend } from "@/components/InviteFriend";
import { InviteToGroupDialog } from "@/components/concord/InviteToGroupDialog";
import { useGroupChats } from "@/pages/messages/useGroupChats";
import { invitableCommunities } from "@/lib/concord/concord-invite-targets";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MessageCircle, Copy, Check, UsersRound, FileText,
  UserPlus, UserMinus, Globe, VolumeX, Volume2, ImageIcon, Pencil,
  BookOpen, Users, CornerUpLeft, Orbit, Satellite, Radio, RadioTower, Signal, Plus, Search, ArrowUpDown, Lock, ChevronDown, ShieldCheck, ArrowLeft, MoreHorizontal, Share2, Flag, Terminal, Clock, ArrowRight, Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BitcoinIcon } from "@/components/FeedIcons";
import { ReportDialog } from "@/components/ReportDialog";
import { useScrollRestore } from "@/hooks/use-scroll-restore";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ZapDialog } from "@/components/ZapDialog";
import { ConfirmAction } from "@/components/ConfirmAction";
import relayOutpostBanner from "../assets/images/relay-outpost-banner.webp";
import { bannerSrcFor, presetBannerFor } from "@/lib/profile-banner";

const PROFILE_BANNER_LQIP = "data:image/webp;base64,UklGRjwAAABXRUJQVlA4IDAAAABQAwCdASogABEAP1Wcwlexq6cjsBgIAjAqiWkAADpwMRjAAAD+7lRLBuvfssJ2UAA=";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { PROFILE_POST_KINDS } from "@/lib/feed-kinds";
import { useIsMobile } from "@/hooks/use-mobile";
import { useProfileLayout } from "@/hooks/use-profile-layout";
import { getPetname, usePetnamesVersion } from "@/lib/petnames";
import { PetnameDialog } from "@/components/PetnameDialog";
import { IdentityProfileLayout } from "@/components/profile/IdentityProfileLayout";
import { IdentityCommunitiesCard, useSubjectCommunityRows } from "@/components/profile/IdentityCommunitiesCard";
import { LiveNowBanner } from "@/components/profile/LiveNowBanner";
import { ProfileLayoutSwitch } from "@/components/profile/ProfileLayoutSwitch";
import { IdentityProfileMain } from "@/components/profile/IdentityProfileMain";
import { IdentityNetworkCard } from "@/components/profile/IdentityNetworkCard";
import { IdentityCircleCard } from "@/components/profile/IdentityCircleCard";
import { isMutedPubkey, mutePubkey, unmutePubkey } from "@/lib/spam-filter";
import { recordProfileVisit } from "@/lib/recent-profiles";
import { MUSIC_KINDS, MUSIC_RELAYS, parseMusicEvents, fetchWavlakeTracksByNpub, fetchPodcastFromRSS, discoverPodcastFeed, isKnownPodcaster, getSavedPodcastFeed, isPodcastDisabled, fetchNostrPodcastFeed, isPodcastFeedUrl, type MusicTrack } from "@/lib/music";
import { MediaSection } from "@/components/MediaSection";
import { ProfileListingsStrip } from "@/components/ListingCard";
import { fetchRelayLists, getRelayList, getRelayListMeta, parseRelayList, getUserNotesFetchRelays, type RelayPreference } from "@/lib/outbox";
import { parseLiveEvent, type LiveEventData } from "@/lib/live-events";
import { getLastActivity } from "@/lib/follow-activity";
import { isCreatorSubscribed, subscribeCreator, unsubscribeCreator } from "@/lib/creator-subscriptions";
import { LIVE_STREAM_RELAYS, KIND_LIVE_EVENT } from "@/lib/nostr-helpers";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useGrapeRank, useConnectionScores } from "@/hooks/use-graperank";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTier, getSignalTierColor, getSignalTierBg, formatInfluence } from "@/lib/graperank";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { BrainstormIcon } from "@/components/icons/BrainstormIcon";
import { TrustReviewsPanel } from "@/components/TrustReviewsPanel";
import { useAttestations } from "@/hooks/use-attestations";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { fetchCommunitySubscriptions, getOutpostRelays, getBadgeDisplayName, getHiddenBadgeUrls, joinOutpostWithEnrichment } from "@/lib/outpost-relays";
import { fetchNip11 } from "@/lib/nip11";
import { useBadges } from "@/hooks/use-badges";
import { ProfileBadgesSection } from "@/components/BadgeDisplay";
import { prefetchProfileFromBrainstorm, prefetchProfilesBulkFromBrainstorm } from "@/lib/brainstorm-search";
import { useHeaderIdentitySlot } from "@/hooks/use-header-identity-slot";

const KIND_LONG_FORM = 30023;
const PROFILE_RELAYS = DEFAULT_RELAYS.slice(0, 5);
const PEOPLE_BATCH_SIZE = 100;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRelativeTime(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function formatActivityRate(noteCount: number, timeJoined: number): string {
  const now = Math.floor(Date.now() / 1000);
  const daysSinceJoin = Math.max(1, (now - timeJoined) / 86400);
  const perDay = noteCount / daysSinceJoin;
  if (perDay >= 1) return `~${Math.round(perDay)} posts/day`;
  const perWeek = perDay * 7;
  if (perWeek >= 1) return `~${Math.round(perWeek)} posts/week`;
  const perMonth = perDay * 30;
  return `~${Math.max(1, Math.round(perMonth))} posts/month`;
}

function formatJoinDate(unixTimestamp: number): string {
  const date = new Date(unixTimestamp * 1000);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function getSignalStrength(lastSeen?: number): "strong" | "fading" | "cold" | "none" {
  if (!lastSeen) return "none";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - lastSeen;
  if (diff < 86400) return "strong";
  if (diff < 604800) return "fading";
  return "cold";
}

function getSignalRingClass(strength: "strong" | "fading" | "cold" | "none"): string {
  switch (strength) {
    case "strong": return "signal-ring-strong";
    case "fading": return "signal-ring-fading";
    case "cold": return "signal-ring-cold";
    default: return "border-2 border-primary/20 dark:border-brand/20";
  }
}

const COMBINED_REGEX = /(https?:\/\/[^\s<>"')\]]+|(?:nostr:)?(?:npub1[a-z0-9]{58}|nprofile1[a-z0-9]+)|#[A-Za-z0-9_]+)/gi;

function InlineProfileMention({ bech32 }: { bech32: string }) {
  const pubkey = useMemo(() => {
    try {
      const decoded = nip19.decode(bech32);
      if (decoded.type === "npub") return decoded.data as string;
      if (decoded.type === "nprofile") return (decoded.data as { pubkey: string }).pubkey;
      return null;
    } catch {
      return null;
    }
  }, [bech32]);

  useEffect(() => {
    if (pubkey) fetchProfilesCached([pubkey]);
  }, [pubkey]);

  const profileEvent = use$(() =>
    pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined,
    [pubkey]
  );

  const fallbackName = pubkey ? shortenNpub(formatNpub(pubkey)) : shortenNpub(bech32);
  const displayName = profileEvent ? (getDisplayName(profileEvent, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = profileEvent ? getAvatarUrl(profileEvent) : undefined;
  const npubPath = pubkey ? `/profile/${nip19.npubEncode(pubkey)}` : null;

  const chip = (
    <span className="inline-flex items-center gap-1 align-baseline rounded-full bg-brand/10 dark:bg-brand/15 border border-brand/20 dark:border-brand/15 px-1.5 py-0.5 max-w-[200px] hover:bg-brand/20 dark:hover:bg-brand/25 transition-colors cursor-pointer group">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-3.5 h-3.5 rounded-full object-cover shrink-0"
          loading="lazy"
        />
      ) : (
        <span className="w-3.5 h-3.5 rounded-full bg-brand/30 shrink-0 flex items-center justify-center">
          <span className="text-[8px] text-brand font-bold">{displayName[0]?.toUpperCase()}</span>
        </span>
      )}
      <span className="text-xs font-medium text-brand truncate leading-tight group-hover:text-brand/80 dark:group-hover:text-brand transition-colors">
        {displayName}
      </span>
    </span>
  );

  if (npubPath) {
    return (
      <Link href={npubPath} onClick={(e) => e.stopPropagation()}>
        {chip}
      </Link>
    );
  }
  return chip;
}

function LinkifiedText({ text, className, ...rest }: { text: string; className?: string; "data-testid"?: string }) {
  const parts = text.split(COMBINED_REGEX);
  return (
    <p className={className} {...rest}>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline break-all"
              onClick={(e) => e.stopPropagation()}
              data-testid={`link-about-url-${i}`}
            >
              {part}
            </a>
          );
        }
        const nostrMatch = part.match(/^(?:nostr:)?(npub1[a-z0-9]{58}|nprofile1[a-z0-9]+)$/i);
        if (nostrMatch) {
          try {
            const decoded = nip19.decode(nostrMatch[1]);
            if (decoded.type === "npub" || decoded.type === "nprofile") {
              return <InlineProfileMention key={i} bech32={nostrMatch[1]} />;
            }
          } catch {}
          return <span key={i}>{part}</span>;
        }
        if (/^#[A-Za-z0-9_]+$/.test(part)) {
          const tag = part.slice(1);
          return (
            <Link
              key={i}
              href={`/search?tab=hashtags&q=${encodeURIComponent(`#${tag}`)}`}
              className="text-brand hover:underline"
              onClick={(e) => e.stopPropagation()}
              data-testid={`link-about-hashtag-${tag}`}
            >
              {part}
            </Link>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

type ProfileTab = "notes" | "replies" | "articles" | "media" | "network" | "crew" | "orbit" | "relays";
type ProfileNetworkView = "crew" | "orbit" | "relays" | "trust";

interface ProfileContentData {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  banner?: string;
  website?: string;
  lud16?: string;
  lud06?: string;
}

// Max pages of author history to auto-fetch when the Media tab is open (100
// notes/page via Primal's fast server feed = up to ~5000 notes). Media is often
// sparse (a heavy account had 336 images spread across 5000+ notes), so we page
// deep; the cap still bounds runaway fetching and the grid's scroll loads more.
const MEDIA_DEEP_MAX_PAGES = 50;

export interface MediaMeta {
  eventId: string;
  pubkey: string;
  content: string;
  createdAt: number;
  /** Poster frame declared by the event's own `imeta` (NIP-92 `image`). */
  poster?: string;
  /** Title from a NIP-71 video event — these carry one; a kind-1 does not. */
  title?: string;
  /**
   * The event SAID this is a video (`imeta … m video/*`).
   *
   * Carried explicitly because the URL cannot be asked: divine.video serves
   * `https://media.divine.video/<sha256>` with no extension, so every guess
   * based on the filename files it as an image.
   */
  isVideo?: boolean;
}

function extractMediaFromEvents(events: Event[]): { urls: string[]; orientationMap: Record<string, "portrait" | "landscape">; mediaMeta: Record<string, MediaMeta> } {
  const urls: string[] = [];
  const seen = new Set<string>();
  const orientationMap: Record<string, "portrait" | "landscape"> = {};
  const mediaMeta: Record<string, MediaMeta> = {};
  // Extension-sniffing is a heuristic, not a rule, and it fails on exactly the
  // accounts this matters most for: divine.video serves
  // `https://media.divine.video/<sha256>` with NO extension at all, so 82
  // videos read as zero. Kept as a fallback for plain links in prose, but the
  // event's own declared MIME type wins wherever there is one.
  const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(u);

  /**
   * Parse a NIP-92 `imeta` tag into its key/value pairs.
   *
   * The old loop looked for a tag whose FIRST element was "url" — but NIP-71
   * nests the url inside `imeta` ("imeta", "url …", "m video/mp4", "image …"),
   * so it matched nothing and the richest media events in the protocol were the
   * ones we could not see.
   */
  const parseImeta = (tag: string[]): Record<string, string> => {
    const kv: Record<string, string> = {};
    for (const part of tag.slice(1)) {
      const sp = part.indexOf(" ");
      if (sp > 0) kv[part.slice(0, sp)] = part.slice(sp + 1).trim();
    }
    return kv;
  };

  for (const ev of events) {
    const orientationTag = ev.tags.find((t) => t[0] === "orientation");
    const dimTag = ev.tags.find((t) => t[0] === "dim");
    let evOrientation: "portrait" | "landscape" | null = null;
    if (orientationTag && (orientationTag[1] === "portrait" || orientationTag[1] === "landscape")) {
      evOrientation = orientationTag[1];
    } else if (dimTag && dimTag[1]) {
      const parts = dimTag[1].split("x");
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (w > 0 && h > 0) evOrientation = h > w ? "portrait" : "landscape";
      }
    }

    const videoUrlsInEvent: string[] = [];
    const urlRegex = /(https?:\/\/[^\s]+\.(jpeg|jpg|gif|png|webp|mp4|mov|webm)(\?[^\s]*)?)/gi;
    const matches = ev.content.match(urlRegex) || [];
    for (const url of matches) {
      const clean = url.replace(/[)}\]]+$/, "");
      if (!seen.has(clean)) {
        seen.add(clean);
        urls.push(clean);
        mediaMeta[clean] = { eventId: ev.id, pubkey: ev.pubkey, content: ev.content, createdAt: ev.created_at };
      }
      if (isVideoUrl(clean)) videoUrlsInEvent.push(clean);
    }
    // NIP-71 / NIP-92: the whole media description lives in `imeta`.
    const evTitle = ev.tags.find((t) => t[0] === "title")?.[1];
    for (const tag of ev.tags) {
      if (tag[0] !== "imeta") continue;
      const kv = parseImeta(tag);
      const u = kv.url;
      if (!u) continue;
      const declaredVideo = (kv.m || "").startsWith("video/");
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
        mediaMeta[u] = {
          eventId: ev.id,
          pubkey: ev.pubkey,
          content: ev.content,
          createdAt: ev.created_at,
          // The event HANDS us a poster. Using it is what stops a video-first
          // profile rendering as a wall of black tiles waiting on a decoder.
          poster: kv.image || undefined,
          title: evTitle,
          isVideo: declaredVideo || isVideoUrl(u),
        };
      }
      if (declaredVideo || isVideoUrl(u)) videoUrlsInEvent.push(u);
      // `dim` lives on the imeta too, not only as a top-level tag.
      if (!evOrientation && kv.dim) {
        const [w, h] = kv.dim.split("x").map((n) => parseInt(n, 10));
        if (w > 0 && h > 0) evOrientation = h > w ? "portrait" : "landscape";
      }
    }
    for (const tag of ev.tags) {
      if (tag[0] === "image" || tag[0] === "thumb" || tag[0] === "url") {
        const u = tag[1];
        if (u && !seen.has(u)) {
          seen.add(u);
          urls.push(u);
          mediaMeta[u] = { eventId: ev.id, pubkey: ev.pubkey, content: ev.content, createdAt: ev.created_at };
        }
        if (u && isVideoUrl(u)) videoUrlsInEvent.push(u);
      }
    }

    if (evOrientation && videoUrlsInEvent.length === 1) {
      orientationMap[videoUrlsInEvent[0]] = evOrientation;
    } else if (evOrientation && videoUrlsInEvent.length > 1) {
      for (const vu of videoUrlsInEvent) {
        if (!orientationMap[vu]) orientationMap[vu] = evOrientation;
      }
    }
  }
  return { urls, orientationMap, mediaMeta };
}


function formatLiveDuration(startUnix: number): string | null {
  const now = Math.floor(Date.now() / 1000);
  if (startUnix > now) return null;
  const diff = now - startUnix;
  const mins = Math.floor(diff / 60);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    const remainHrs = hrs % 24;
    return remainHrs > 0 ? `${days}d ${remainHrs}h` : `${days}d`;
  }
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

function LiveDuration({ starts }: { starts?: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!starts) return;
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [starts]);

  if (!starts) return null;

  const label = formatLiveDuration(starts);
  if (!label) return null;

  return (
    <span className="text-[10px] font-mono text-red-700/70 dark:text-red-400/60 tabular-nums shrink-0">
      {label}
    </span>
  );
}

export default function Profile() {
  const params = useParams<{ npub: string }>();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  const { pubkey: myPubkey, signer, follows, updateFollows } = useNostrAuth();
  const profileLayout = useProfileLayout();
  const isMobileProfile = useIsMobile();
  const { isUserLive, getLiveStream, livePubkeys } = useLiveStatus();

  const [copied, setCopied] = useState(false);
  // Petnames: re-render on edits; dialog opened from the "you call them" line.
  usePetnamesVersion();
  const [petnameEditOpen, setPetnameEditOpen] = useState(false);
  const [badgesExpanded, setBadgesExpanded] = useState(false);
  useEffect(() => { setBadgesExpanded(false); }, [params.npub]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [profileBannerLoaded, setProfileBannerLoaded] = useState(false);
  // Condensed-by-default profile header: identity (avatar · name · Follow/Edit
  // · ⌄) portals into the global top bar's #header-identity-slot — no separate
  // strip. Chevron expands the full banner/HUD/bio; scrolling only re-condenses.
  // The slot is tracked live because the header bar unmounts entirely on
  // desktop while the sidebar is expanded; whenever it's gone the same
  // condensed strip renders inline above the tabs instead (pre-slot layout).
  const [headerCollapsed, setHeaderCollapsed] = useState(true);
  const headerSlotEl = useHeaderIdentitySlot();
  const profileScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = profileScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop > 80) setHeaderCollapsed(true);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // Profile scrolls in its OWN container (above), not the app's <main>, so the
  // global <ScrollToTop> restorer never sees it — this wires the same
  // per-history-token save/restore to profileScrollRef so back-navigation from
  // a thread (or another profile) lands on the exact post the viewer left. The
  // ":profile" keySuffix namespaces it apart from <main>'s position under the
  // same history entry. The active tab + notes count are already restored from
  // sessionStorage above, so the anchored row is present to pin to.
  useScrollRestore(profileScrollRef, { keySuffix: ":profile" });
  const [profileStats, setProfileStats] = useState<UserProfileStats | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("notes");
  const [networkView, setNetworkView] = useState<ProfileNetworkView>("crew");
  const [followProcessing, setFollowProcessing] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const [showInviteToGroup, setShowInviteToGroup] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showUnfollowConfirm, setShowUnfollowConfirm] = useState(false);
  const [showMuteConfirm, setShowMuteConfirm] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showNetworkDialog, setShowNetworkDialog] = useState(false);
  const [streamSubscribed, setStreamSubscribed] = useState(false);

  const [articles, setArticles] = useState<Event[]>([]);
  const [articlesLoaded, setArticlesLoaded] = useState(false);
  const [followingProfiles, setFollowingProfiles] = useState<Event[]>([]);
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [followerProfiles, setFollowerProfiles] = useState<Event[]>([]);
  const [followersLoaded, setFollowersLoaded] = useState(false);
  const [userFollowList, setUserFollowList] = useState<string[]>([]);
  const [audioTracks, setAudioTracks] = useState<MusicTrack[]>([]);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [liveStreams, setLiveStreams] = useState<LiveEventData[]>([]);

  const [notesLimit, setNotesLimit] = useState(50);
  const [hasMoreNotes, setHasMoreNotes] = useState(true);
  const [loadingMoreNotes, setLoadingMoreNotes] = useState(false);

  // Persist the viewer's place on this profile (tab + notes loaded) per npub so
  // back-navigation restores it (see the reset effect below).
  useEffect(() => {
    if (!params.npub) return;
    try {
      sessionStorage.setItem(
        `relay-outpost-profile-view:${params.npub}`,
        JSON.stringify({ tab: activeTab, notesLimit }),
      );
    } catch {}
  }, [params.npub, activeTab, notesLimit]);

  const [hasMoreArticles, setHasMoreArticles] = useState(true);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);

  const [followingBatchIndex, setFollowingBatchIndex] = useState(0);
  const [loadingMoreFollowing, setLoadingMoreFollowing] = useState(false);

  const [followerDisplayCount, setFollowerDisplayCount] = useState(PEOPLE_BATCH_SIZE);
  const [followerApiOffset, setFollowerApiOffset] = useState(0);
  const [hasMoreFollowersApi, setHasMoreFollowersApi] = useState(true);
  const [loadingMoreFollowers, setLoadingMoreFollowers] = useState(false);
  const allFollowerProfilesRef = useRef<Event[]>([]);
  const followerSeenRef = useRef<Set<string>>(new Set());
  // A ranked page of THIS profile's follower pubkeys, loaded eagerly to power the
  // identity "Followed by people you follow" circle (viewer∩followers). Distinct
  // from the lazy Network-tab follower list above.
  const [circleFollowerPubkeys, setCircleFollowerPubkeys] = useState<string[]>([]);

  const lastFetchedPubkey = useRef<string | null>(null);
  const podcastLoadedForRef = useRef<string>("");
  const [discoveredPodcastFeed, setDiscoveredPodcastFeed] = useState<string | null>(null);

  const pubkey = useMemo(() => {
    try {
      const decoded = nip19.decode(params.npub);
      if (decoded.type === "npub") return decoded.data as string;
      return null;
    } catch {
      return null;
    }
  }, [params.npub]);
  // At component TOP (rules of hooks — the petnames lesson): the subject's
  // public communities, fetched HERE so the layout slot is only passed when
  // rows exist. The card deciding emptiness internally left a labelled empty
  // section box on every no-list profile (owner QA, 2026-08-18).
  const subjectCommunityRows2 = useSubjectCommunityRows(pubkey ?? null);

  const npubFull = pubkey ? formatNpub(pubkey) : "";
  const npubShort = pubkey ? shortenNpub(npubFull) : "";
  const isOwnProfile = myPubkey && pubkey && myPubkey === pubkey;
  // Group chats you could bring THIS person into. Computed here so the Invite
  // action only appears when it would actually lead somewhere — offering it and
  // then showing an empty picker is a dead end.
  const { groups: myGroupChats } = useGroupChats(myPubkey);
  const canInviteToGroup = !isOwnProfile && !!pubkey && invitableCommunities(myGroupChats, myPubkey).length > 0;
  const isFollowing = pubkey ? follows.includes(pubkey) : false;
  const { wotEnabled } = useGrapeRankScores();
  const { badges: nip58Badges, refresh: refreshNip58Badges } = useBadges(pubkey);
  const { score: grapeRankScore, loading: grapeRankLoading } = useGrapeRank(wotEnabled ? (pubkey ?? null) : null, myPubkey ?? null);
  const grapeRankTier = getSignalTier(grapeRankScore?.influence ?? null);
  const connectionScoresData = useConnectionScores(wotEnabled ? (pubkey ?? null) : null, myPubkey ?? null);

  useEffect(() => {
    if (pubkey) setMuted(isMutedPubkey(pubkey));
  }, [pubkey]);

  // Local per-viewer MRU feeding the Stories menu's "Recent people" row —
  // records the VIEWED profile (recordProfileVisit skips your own).
  useEffect(() => {
    if (pubkey) recordProfileVisit(myPubkey, pubkey);
  }, [pubkey, myPubkey]);

  // "Last posted" — observed feed presence, from the shared outbox-aware cache
  // (same source as the Follow-list-health page, so they can never disagree).
  // Arriving here from that page hits the cache = no extra relay cost. Shown
  // only when known; we observe posts, so we label it "Last posted", not "active".
  const [lastPostedAt, setLastPostedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!pubkey) { setLastPostedAt(null); return; }
    let cancelled = false;
    const ac = new AbortController();
    setLastPostedAt(null);
    getLastActivity(pubkey, myPubkey ?? undefined, { signal: ac.signal })
      .then((ts) => { if (!cancelled && ts !== undefined) setLastPostedAt(ts); })
      .catch(() => {});
    return () => { cancelled = true; ac.abort(); };
  }, [pubkey, myPubkey]);

  useEffect(() => {
    if (pubkey && myPubkey && pubkey !== myPubkey) {
      setStreamSubscribed(isCreatorSubscribed(myPubkey, pubkey));
    } else {
      setStreamSubscribed(false);
    }
  }, [pubkey, myPubkey]);

  useEffect(() => {
    if (!pubkey || pubkey === lastFetchedPubkey.current) return;
    lastFetchedPubkey.current = pubkey;
    setProfileStats(null);
    setArticles([]);
    setArticlesLoaded(false);
    setFollowingProfiles([]);
    setFollowingLoaded(false);
    setFollowerProfiles([]);
    setFollowersLoaded(false);
    setUserFollowList([]);
    setNotesLoaded(false);
    // Every profile LOADS with the header condensed (mirrors the outpost banner).
    setHeaderCollapsed(true);
    // Restore the viewer's place on this profile (which tab + how many notes were
    // loaded) so coming back from a thread / another profile doesn't reset them to
    // the top of "Notes". Other caches above are intentionally refetched.
    let savedView: { tab?: ProfileTab; notesLimit?: number } | null = null;
    try {
      const raw = sessionStorage.getItem(`relay-outpost-profile-view:${params.npub}`);
      if (raw) savedView = JSON.parse(raw);
    } catch {}
    // Articles folded into Media (sub-tab); keep legacy saved/linked ?tab=articles working.
    setActiveTab(savedView?.tab === "articles" ? "media" : (savedView?.tab ?? "notes"));
    setNotesLimit(savedView?.notesLimit ?? 50);
    setHasMoreNotes(true);
    setLoadingMoreNotes(false);
    consecutiveEmptyRef.current = 0;
    setHasMoreArticles(true);
    setLoadingMoreArticles(false);
    setFollowingBatchIndex(0);
    setLoadingMoreFollowing(false);
    setFollowerDisplayCount(PEOPLE_BATCH_SIZE);
    setFollowerApiOffset(0);
    setHasMoreFollowersApi(true);
    setLoadingMoreFollowers(false);
    allFollowerProfilesRef.current = [];
    followerSeenRef.current = new Set();
    setAudioTracks([]);
    setAudioLoaded(false);
    setLiveStreams([]);
    podcastLoadedForRef.current = "";
    setDiscoveredPodcastFeed(null);
    setShowUnfollowConfirm(false);
    setShowMuteConfirm(false);
    // Close the network dialog when navigating to a NEW profile: the Profile
    // component persists across profile→profile navigation, so tapping a person
    // in "…'s network" would otherwise leave the dialog open over the person you
    // just opened — showing THEIR network instead of their profile.
    setShowNetworkDialog(false);
    setFollowProcessing(false);

    prefetchProfileFromBrainstorm(pubkey);
    fetchProfiles([pubkey], DEFAULT_RELAYS);
    // force: re-query on every profile open so a stale negative (e.g. an earlier
    // indexer miss before the broadened discovery set) isn't cached as "no list".
    fetchRelayLists([pubkey], { force: true });
    fetchUserProfileStats(pubkey).then((stats) => {
      setProfileStats(stats);
    }).catch(console.error);
  }, [pubkey]);

  const repostMapRef = useRef<Map<string, { pubkey: string; timestamp: number }>>(new Map());
  const [repostVersion, setRepostVersion] = useState(0);
  const [repostedEvents, setRepostedEvents] = useState<Event[]>([]);

  useEffect(() => {
    if (!pubkey) return;
    setNotesLoaded(false);
    repostMapRef.current.clear();
    setRepostedEvents([]);
    const now = Math.floor(Date.now() / 1000);
    const timeout = setTimeout(() => setNotesLoaded(true), 10000);
    const initialRelays = getUserNotesFetchRelays(pubkey);
    const notesFilter = { kinds: PROFILE_POST_KINDS, authors: [pubkey], limit: 50 };
    const sub = subscribeToFeed(
      notesFilter,
      initialRelays,
      () => { clearTimeout(timeout); setNotesLoaded(true); }
    );

    let cancelled = false;
    let topUpSub: { close: () => void } | null = null;
    // Repost-hydration subscriptions live inside fetchReposts() but MUST be
    // closable from the effect cleanup — the Profile page stays mounted across
    // /profile/A → /profile/B navigation (only `pubkey` changes), so a left-open
    // repost stream from the previous profile keeps firing addRepostOriginal(),
    // writing that profile's reposts into the shared eventStore + the persistent
    // repostMapRef and leaking them onto the profile you navigated to.
    let repostSub: { close: () => void } | null = null;
    let repostFetchSub: { close: () => void } | null = null;
    let topUpInterval: ReturnType<typeof setInterval> | null = null;
    const topUpDeadline = Date.now() + 6000;
    const tryTopUp = () => {
      if (cancelled || topUpSub) return;
      const updated = getUserNotesFetchRelays(pubkey);
      const extras = updated.filter((r) => !initialRelays.includes(r));
      if (extras.length > 0) {
        topUpSub = subscribeToFeed(notesFilter, extras);
        if (topUpInterval) { clearInterval(topUpInterval); topUpInterval = null; }
      } else if (Date.now() >= topUpDeadline) {
        if (topUpInterval) { clearInterval(topUpInterval); topUpInterval = null; }
      }
    };
    topUpInterval = setInterval(tryTopUp, 300);

    const addRepostOriginal = (original: Event, reposterPubkey: string, repostTimestamp: number) => {
      if (cancelled) return; // don't hydrate a profile we've already navigated away from
      eventStore.add(original);
      const existing = repostMapRef.current.get(original.id);
      if (!existing || repostTimestamp > existing.timestamp) {
        repostMapRef.current.set(original.id, {
          pubkey: reposterPubkey,
          timestamp: repostTimestamp,
        });
      }
    };

    const fetchReposts = async () => {
      const allOriginals: Event[] = [];

      try {
        const result = await fetchUserAuthoredFeed(pubkey, 50);
        if (cancelled) return;

        const originalMap = new Map<string, Event>();
        for (const orig of result.repostOriginals) {
          originalMap.set(orig.id, orig);
        }

        const unmatchedIds: string[] = [];
        const repostByOrigId = new Map<string, Event>();

        for (const repost of result.reposts) {
          let originalId: string | undefined;
          let parsedOriginal: Event | undefined;

          if (repost.content && repost.content.trim().startsWith("{")) {
            try {
              const parsed = JSON.parse(repost.content) as Event;
              // Any profile-renderable kind, not just kind 1 — a kind-16
              // generic repost embeds a picture/video original.
              if (parsed && parsed.id && PROFILE_POST_KINDS.includes(parsed.kind)) {
                parsedOriginal = parsed;
                originalId = parsed.id;
              }
            } catch {}
          }

          if (!originalId) {
            const eTag = repost.tags.find((t: string[]) => t[0] === "e");
            originalId = eTag?.[1];
          }

          if (!originalId) continue;

          if (parsedOriginal) {
            addRepostOriginal(parsedOriginal, repost.pubkey, repost.created_at);
            allOriginals.push(parsedOriginal);
          } else {
            const fromMap = originalMap.get(originalId);
            if (fromMap) {
              addRepostOriginal(fromMap, repost.pubkey, repost.created_at);
              allOriginals.push(fromMap);
            } else {
              const cachedSet = eventStore.getByFilters({ ids: [originalId] });
              const cached = cachedSet ? [...cachedSet].find((ev) => ev.id === originalId) : undefined;
              if (cached) {
                addRepostOriginal(cached, repost.pubkey, repost.created_at);
                allOriginals.push(cached);
              } else {
                unmatchedIds.push(originalId);
                repostByOrigId.set(originalId, repost);
              }
            }
          }
        }

        if (unmatchedIds.length > 0 && !cancelled) {
          try {
            const fetched = await pool.querySync(DEFAULT_RELAYS.slice(0, 5), {
              kinds: PROFILE_POST_KINDS,
              ids: unmatchedIds,
            });
            for (const original of fetched) {
              const rp = repostByOrigId.get(original.id);
              if (rp) {
                addRepostOriginal(original, rp.pubkey, rp.created_at);
                allOriginals.push(original);
              }
            }
          } catch (err) {
            console.warn("[Profile] Failed to fetch unmatched originals:", err);
          }
        }

        if (allOriginals.length > 0 && !cancelled) {
          const idsToFetch = allOriginals.map(e => e.id).filter(id => !primalStatsCache.has(id));
          if (idsToFetch.length > 0) {
            try {
              const stats = await fetchEventCounts(idsToFetch);
              primalStatsCache.update(stats);
            } catch {}
          }
          setRepostedEvents(allOriginals);
          setRepostVersion((v) => v + 1);
          return;
        }
      } catch (err) {
        console.warn("[Profile] Primal feed fetch failed:", err);
      }

      if (cancelled) return;

      const unwrappedMap = new Map<string, Event>();
      const pendingFetchIds: { eventId: string; repostEvent: Event }[] = [];

      // Kind 16 (generic repost, NIP-18) rides along: a media-first account
      // reposts pictures/videos as 16, not 6, and fetching only kind 6 showed
      // their entire repost activity as nothing.
      const rSub = throttledPoolSubscribe(DEFAULT_RELAYS, { kinds: [KIND_REPOST, KIND_GENERIC_REPOST], authors: [pubkey], limit: 30 }, {
        onevent(repostEvent) {
          let parsed = false;
          if (repostEvent.content && repostEvent.content.trim().startsWith("{")) {
            try {
              const original = JSON.parse(repostEvent.content) as Event;
              // Same widening as the Primal path above: kind-16 embeds
              // non-kind-1 originals.
              if (original && original.id && PROFILE_POST_KINDS.includes(original.kind)) {
                addRepostOriginal(original, repostEvent.pubkey, repostEvent.created_at);
                unwrappedMap.set(original.id, original);
                parsed = true;
              }
            } catch {}
          }
          if (!parsed) {
            const eTag = repostEvent.tags.find((t) => t[0] === "e");
            if (eTag && eTag[1]) {
              const cachedSet = eventStore.getByFilters({ ids: [eTag[1]] });
              const cached = cachedSet ? [...cachedSet].find((ev) => ev.id === eTag[1]) : undefined;
              if (cached) {
                addRepostOriginal(cached, repostEvent.pubkey, repostEvent.created_at);
                unwrappedMap.set(cached.id, cached);
              } else {
                pendingFetchIds.push({ eventId: eTag[1], repostEvent });
              }
            }
          }
        },
        oneose() {
          rSub.close();
          if (pendingFetchIds.length > 0) {
            const ids = pendingFetchIds.map((p) => p.eventId);
            const rpMap = new Map(pendingFetchIds.map((p) => [p.eventId, p.repostEvent]));
            const fSub = throttledPoolSubscribe(DEFAULT_RELAYS, { kinds: PROFILE_POST_KINDS, ids }, {
              onevent(original) {
                const rp = rpMap.get(original.id);
                if (rp) {
                  addRepostOriginal(original, rp.pubkey, rp.created_at);
                  unwrappedMap.set(original.id, original);
                }
              },
              async oneose() {
                fSub.close();
                if (!cancelled) {
                  const vals = Array.from(unwrappedMap.values());
                  const statsIds = vals.map(e => e.id).filter(id => !primalStatsCache.has(id));
                  if (statsIds.length > 0) { try { const s = await fetchEventCounts(statsIds); primalStatsCache.update(s); } catch {} }
                  setRepostedEvents(vals);
                  setRepostVersion((v) => v + 1);
                }
              },
            });
            repostFetchSub = fSub;
          } else {
            if (!cancelled) {
              const vals = Array.from(unwrappedMap.values());
              const statsIds = vals.map(e => e.id).filter(id => !primalStatsCache.has(id));
              if (statsIds.length > 0) { fetchEventCounts(statsIds).then(s => primalStatsCache.update(s)).catch(() => {}); }
              setRepostedEvents(vals);
              setRepostVersion((v) => v + 1);
            }
          }
        },
      });
      repostSub = rSub;
    };

    fetchReposts();

    return () => { cancelled = true; sub.close(); clearTimeout(timeout); if (topUpInterval) clearInterval(topUpInterval); if (topUpSub) topUpSub.close(); if (repostSub) repostSub.close(); if (repostFetchSub) repostFetchSub.close(); };
  }, [pubkey]);

  useEffect(() => {
    const handleLocalRepost = ((e: CustomEvent) => {
      const detail = e.detail;
      if (detail?.repostEvent && detail?.originalEvent && detail.repostEvent.pubkey === pubkey) {
        const original = detail.originalEvent as Event;
        eventStore.add(original);
        const existing = repostMapRef.current.get(original.id);
        if (!existing || detail.repostEvent.created_at > existing.timestamp) {
          repostMapRef.current.set(original.id, {
            pubkey: detail.repostEvent.pubkey,
            timestamp: detail.repostEvent.created_at,
          });
        }
        setRepostedEvents((prev) => {
          if (prev.some((e) => e.id === original.id)) return prev;
          return [original, ...prev];
        });
        setRepostVersion((v) => v + 1);
      }
    }) as EventListener;
    const handleLocalUnrepost = ((e: CustomEvent) => {
      const detail = e.detail;
      if (detail?.originalEventId && detail?.reposterPubkey === pubkey) {
        repostMapRef.current.delete(detail.originalEventId);
        setRepostedEvents((prev) => prev.filter((ev) => ev.id !== detail.originalEventId));
        setRepostVersion((v) => v + 1);
      }
    }) as EventListener;
    window.addEventListener("nostr-repost-created", handleLocalRepost);
    window.addEventListener("nostr-repost-removed", handleLocalUnrepost);
    return () => {
      window.removeEventListener("nostr-repost-created", handleLocalRepost);
      window.removeEventListener("nostr-repost-removed", handleLocalUnrepost);
    };
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey) return;
    const sub = subscribeToFeed(
      { kinds: [KIND_FOLLOW_LIST], authors: [pubkey], limit: 1 },
      PROFILE_RELAYS,
      () => {}
    );
    return () => { sub.close(); };
  }, [pubkey]);

  const metadataEvent = use$(() => pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined, [pubkey]);
  const followListEvent = use$(() => pubkey ? eventStore.replaceable(KIND_FOLLOW_LIST, pubkey) : undefined, [pubkey]);

  useEffect(() => {
    if (followListEvent) {
      setUserFollowList(parseFollowList(followListEvent));
    }
  }, [followListEvent]);

  const allNotes = use$(() => pubkey ? eventStore.timeline({ kinds: PROFILE_POST_KINDS, authors: [pubkey] }) : undefined, [pubkey]);
  const notes = useMemo(() => (allNotes ?? []).slice(0, notesLimit), [allNotes, notesLimit]);

  const originalNotes = useMemo(() => {
    const ownNotes = notes.filter((e) => {
      const eTags = e.tags.filter((t) => t[0] === "e");
      return eTags.length === 0;
    });
    const repostIds = new Set(ownNotes.map((e) => e.id));
    const uniqueReposts = repostedEvents.filter((e) => !repostIds.has(e.id));
    const combined = [...ownNotes, ...uniqueReposts];
    return combined.sort((a, b) => {
      const aTime = repostMapRef.current.get(a.id)?.timestamp ?? a.created_at;
      const bTime = repostMapRef.current.get(b.id)?.timestamp ?? b.created_at;
      return bTime - aTime;
    });
  }, [notes, repostedEvents, repostVersion]);

  const replyNotes = useMemo(() => notes.filter((e) => {
    const eTags = e.tags.filter((t) => t[0] === "e");
    return eTags.length > 0;
  }), [notes]);

  // Media is extracted from ALL fetched notes, not the Notes-tab display window
  // (`notes` = allNotes.slice(0, notesLimit)). Otherwise the media grid + counts
  // were artificially capped at the first ~50 notes even when hundreds were
  // available — Primal/Damus/Amethyst show the full media library.
  // Media accumulates INCREMENTALLY as history pages in, committed to the grid on
  // a short debounce. Re-extracting from the whole (growing, up-to-5000-note)
  // timeline on every page — plus a grid re-render per page — caused jank on
  // mobile. Now each note is scanned exactly once and the grid re-renders a few
  // times/sec, coalescing many page loads into one update.
  const [mediaState, setMediaState] = useState<{ urls: string[]; orientationMap: Record<string, "portrait" | "landscape">; mediaMeta: Record<string, MediaMeta> }>({ urls: [], orientationMap: {}, mediaMeta: {} });
  const mediaAccRef = useRef<{ urls: string[]; seen: Set<string>; orientationMap: Record<string, "portrait" | "landscape">; mediaMeta: Record<string, MediaMeta>; processed: Set<string> }>({ urls: [], seen: new Set(), orientationMap: {}, mediaMeta: {}, processed: new Set() });
  const mediaCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // New profile → reset the accumulator.
    if (mediaCommitTimerRef.current) { clearTimeout(mediaCommitTimerRef.current); mediaCommitTimerRef.current = null; }
    mediaAccRef.current = { urls: [], seen: new Set(), orientationMap: {}, mediaMeta: {}, processed: new Set() };
    setMediaState({ urls: [], orientationMap: {}, mediaMeta: {} });
  }, [pubkey]);

  useEffect(() => {
    const list = allNotes ?? [];
    const acc = mediaAccRef.current;
    const fresh = list.filter((e) => !acc.processed.has(e.id));
    if (fresh.length === 0) return;
    for (const e of fresh) acc.processed.add(e.id);
    const { urls, orientationMap, mediaMeta } = extractMediaFromEvents(fresh);
    let added = false;
    for (const u of urls) if (!acc.seen.has(u)) { acc.seen.add(u); acc.urls.push(u); added = true; }
    for (const k of Object.keys(orientationMap)) if (!acc.orientationMap[k]) acc.orientationMap[k] = orientationMap[k];
    for (const k of Object.keys(mediaMeta)) if (!acc.mediaMeta[k]) acc.mediaMeta[k] = mediaMeta[k];
    if (!added) return;
    // Coalesce: if a commit is already queued it will flush the latest accumulator.
    if (mediaCommitTimerRef.current) return;
    mediaCommitTimerRef.current = setTimeout(() => {
      mediaCommitTimerRef.current = null;
      const cur = mediaAccRef.current;
      setMediaState({ urls: cur.urls.slice(), orientationMap: { ...cur.orientationMap }, mediaMeta: { ...cur.mediaMeta } });
    }, 300);
  }, [allNotes]);

  useEffect(() => () => { if (mediaCommitTimerRef.current) clearTimeout(mediaCommitTimerRef.current); }, []);

  const mediaUrls = mediaState.urls;
  const orientationMap = mediaState.orientationMap;
  const mediaMeta = mediaState.mediaMeta;

  const fallbackName = pubkey ? shortenNpub(formatNpub(pubkey)) : "Unknown";
  const displayName = pubkey && metadataEvent ? (getDisplayName(metadataEvent, fallbackName) ?? fallbackName) : fallbackName;
  // The RAW profile name: the rename dialog's "Real name:" line and the
  // header's reveal caption must never show the petname back.
  const realDisplayName = pubkey && metadataEvent ? (getRealName(metadataEvent, fallbackName) ?? fallbackName) : fallbackName;
  useDocumentTitle(displayName || "Profile");
  const avatarUrl = metadataEvent ? getAvatarUrl(metadataEvent) : undefined;
  const profileContent = useMemo<ProfileContentData | null>(() => {
    if (!metadataEvent) return null;
    const raw = getProfileContent(metadataEvent);
    return raw ? (raw as ProfileContentData) : null;
  }, [metadataEvent]);

  // Proxy rules live in lib/profile-banner.ts so the two profile layouts cannot
  // disagree about what a banner loads — animated images skip the proxy, and a
  // profile with no banner gets a preset chosen from its own pubkey.
  const profileBannerSrc = useMemo(
    () => bannerSrcFor(profileContent?.banner, pubkey),
    [profileContent?.banner, pubkey],
  );
  /** Where a broken banner lands. Stable per account, so it reads as theirs. */
  const bannerFallback = useMemo(() => presetBannerFor(pubkey), [pubkey]);
  useEffect(() => { setProfileBannerLoaded(false); }, [profileBannerSrc]);

  useEffect(() => {
    if (!profileBannerSrc || profileBannerSrc === relayOutpostBanner) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = profileBannerSrc;
    document.head.appendChild(link);
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, [profileBannerSrc]);

  const loadMoreNotesRef = useRef(false);
  const consecutiveEmptyRef = useRef(0);
  const loadMoreNotes = useCallback(async () => {
    if (!pubkey || loadMoreNotesRef.current || !hasMoreNotes || !notesLoaded) return;
    loadMoreNotesRef.current = true;
    setLoadingMoreNotes(true);
    try {
      const currentNotes = (allNotes ?? []).slice(0, notesLimit);
      const oldestTimestamp = currentNotes.length > 0
        ? Math.min(...currentNotes.map(e => e.created_at))
        : Math.floor(Date.now() / 1000);
      const until = oldestTimestamp - 1;
      const PAGE_SIZE = 100;

      let relayEvents: Event[] = [];
      let relayOk = false;
      const relayQuery = async (): Promise<void> => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            pool.querySync(getUserNotesFetchRelays(pubkey), {
              kinds: PROFILE_POST_KINDS,
              authors: [pubkey],
              limit: PAGE_SIZE,
              until,
            }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error("timeout")), 8000);
            }),
          ]);
          relayEvents = result;
          relayOk = true;
        } catch {
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
      };

      let primalEvents: Event[] = [];
      let primalOk = false;
      const primalQuery = async (): Promise<void> => {
        const result = await fetchUserNotesPaginated(pubkey, until, PAGE_SIZE);
        primalEvents = result.events;
        primalOk = result.ok;
      };

      await Promise.allSettled([primalQuery(), relayQuery()]);

      const merged = new Map<string, Event>();
      for (const ev of primalEvents) merged.set(ev.id, ev);
      for (const ev of relayEvents) merged.set(ev.id, ev);

      const newEvents = Array.from(merged.values());
      for (const event of newEvents) {
        eventStore.add(event);
      }

      const anySourceOk = primalOk || relayOk;
      if (!anySourceOk) {
        consecutiveEmptyRef.current = 0;
      } else if (newEvents.length === 0) {
        consecutiveEmptyRef.current++;
        if (consecutiveEmptyRef.current >= 2) {
          setHasMoreNotes(false);
        }
      } else if (newEvents.length < PAGE_SIZE) {
        const bothShort = (!primalOk || primalEvents.length < PAGE_SIZE)
          && (!relayOk || relayEvents.length < PAGE_SIZE);
        if (bothShort) {
          setHasMoreNotes(false);
        }
        consecutiveEmptyRef.current = 0;
      } else {
        consecutiveEmptyRef.current = 0;
      }
      setNotesLimit(prev => prev + Math.max(newEvents.length, PAGE_SIZE));

      const pubkeys = Array.from(new Set(newEvents.map(e => e.pubkey)));
      if (pubkeys.length > 0) {
        fetchProfilesCached(pubkeys);
      }

      const eventIds = newEvents.map(e => e.id);
      if (eventIds.length > 0) {
        prefetchStatsImmediate(eventIds).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to load more notes:", err);
    } finally {
      loadMoreNotesRef.current = false;
      setLoadingMoreNotes(false);
    }
  }, [pubkey, hasMoreNotes, notesLoaded, allNotes, notesLimit]);

  // Deep-load the author's history while the Media tab is open so the grid
  // reflects their full media library (like Primal/Damus/Amethyst) instead of
  // just the first page. Each successful page bumps notesLimit, which re-runs
  // this effect for the next page; bounded by MEDIA_DEEP_MAX_PAGES so a huge
  // account can't fetch forever (the grid's own scroll handles anything beyond).
  const mediaDeepPagesRef = useRef(0);
  useEffect(() => { mediaDeepPagesRef.current = 0; }, [pubkey]);
  useEffect(() => {
    if (activeTab !== "media" || !notesLoaded || !hasMoreNotes) return;
    if (mediaDeepPagesRef.current >= MEDIA_DEEP_MAX_PAGES) return;
    mediaDeepPagesRef.current += 1;
    loadMoreNotes();
  }, [activeTab, notesLoaded, hasMoreNotes, notesLimit, loadMoreNotes]);

  const loadArticles = useCallback(async () => {
    if (!pubkey || articlesLoaded) return;
    try {
      const events = await pool.querySync(PROFILE_RELAYS, {
        kinds: [KIND_LONG_FORM],
        authors: [pubkey],
        limit: 100,
      });
      const sorted = events.sort((a, b) => b.created_at - a.created_at);
      setArticles(sorted);
      if (events.length < 100) {
        setHasMoreArticles(false);
      }
    } catch (err) {
      console.error("Failed to fetch articles:", err);
    } finally {
      setArticlesLoaded(true);
    }
  }, [pubkey, articlesLoaded]);

  // The Identity skin folds articles into the All stream (owner call
  // 2026-08-08: "do we show their articles in the all section too" — we
  // didn't; kind-30023 isn't in PROFILE_POST_KINDS and only loaded when the
  // Articles chip was tapped). Eager-load them for that layout only, through
  // the SAME loadArticles the chip uses — one code path, one cache, and the
  // chip becomes instant as a side effect. Classic layout keeps its lazy load.
  useEffect(() => {
    if (profileLayout === "identity" && pubkey && !articlesLoaded) void loadArticles();
  }, [profileLayout, pubkey, articlesLoaded, loadArticles]);

  const loadAudio = useCallback(async () => {
    if (!pubkey || audioLoaded) return;
    try {
      const [musicEvents, liveEvents] = await Promise.all([
        pool.querySync(MUSIC_RELAYS, {
          kinds: MUSIC_KINDS,
          authors: [pubkey],
          limit: 100,
        }),
        pool.querySync(LIVE_STREAM_RELAYS, {
          kinds: [KIND_LIVE_EVENT],
          authors: [pubkey],
          limit: 20,
        }).catch(() => [] as Event[]),
      ]);

      const parsed: LiveEventData[] = [];
      const seen = new Set<string>();
      for (const ev of liveEvents) {
        const p = parseLiveEvent(ev);
        if (p && !seen.has(p.dTag)) {
          seen.add(p.dTag);
          parsed.push(p);
        }
      }
      parsed.sort((a, b) => b.event.created_at - a.event.created_at);
      setLiveStreams(parsed);

      let tracks = parseMusicEvents(musicEvents);
      if (tracks.length === 0) {
        try {
          const userNpub = nip19.npubEncode(pubkey);
          const wavlakeTracks = await fetchWavlakeTracksByNpub(userNpub, pubkey);
          tracks = wavlakeTracks;
        } catch {}
      }

      setAudioTracks(prev => {
        const podcastTracks = prev.filter(t => t.source === "podcast");
        const existingIds = new Set(tracks.map(t => t.id));
        const keepPodcasts = podcastTracks.filter(t => !existingIds.has(t.id));
        return [...tracks, ...keepPodcasts];
      });
    } catch (err) {
      console.error("Failed to fetch audio tracks:", err);
    } finally {
      setAudioLoaded(true);
    }
  }, [pubkey, audioLoaded]);

  useEffect(() => {
    if (pubkey && !audioLoaded) {
      loadAudio();
    }
  }, [pubkey, audioLoaded, loadAudio]);

  useEffect(() => {
    if (!pubkey) return;
    const website = profileContent?.website;
    const displayName = profileContent?.display_name || profileContent?.name;
    const savedFeed = isOwnProfile ? getSavedPodcastFeed(pubkey) : null;
    const disabled = isOwnProfile ? isPodcastDisabled(pubkey) : false;
    const shouldDiscover = !disabled && isKnownPodcaster(pubkey) && (website || displayName);
    const websiteIsPodcast = !disabled && website && isPodcastFeedUrl(website);
    const loadKey = `${pubkey}::${savedFeed || ""}::${website || ""}::${displayName || ""}`;
    if (podcastLoadedForRef.current === loadKey) return;
    podcastLoadedForRef.current = loadKey;
    (async () => {
      try {
        let feedUrl = savedFeed;
        if (!feedUrl) {
          feedUrl = await fetchNostrPodcastFeed(pubkey);
        }
        if (!feedUrl && websiteIsPodcast) {
          feedUrl = website!.startsWith("http://") || website!.startsWith("https://") ? website! : `https://${website!}`;
        }
        if (!feedUrl && shouldDiscover) {
          feedUrl = await discoverPodcastFeed(website || "", displayName);
        }
        setDiscoveredPodcastFeed(feedUrl);
        if (feedUrl) {
          const podcastEpisodes = await fetchPodcastFromRSS(feedUrl, pubkey);
          if (podcastEpisodes.length > 0) {
            setAudioTracks(prev => {
              const existingIds = new Set(prev.map(t => t.id));
              const newEpisodes = podcastEpisodes.filter(ep => !existingIds.has(ep.id));
              return newEpisodes.length > 0 ? [...prev, ...newEpisodes] : prev;
            });
          }
        }
      } catch (err) {
        console.error("[Profile] Podcast discovery error:", err);
      }
    })();
  }, [pubkey, profileContent?.website, profileContent?.display_name, profileContent?.name]);

  const loadMoreArticles = useCallback(async () => {
    if (!pubkey || loadingMoreArticles || !hasMoreArticles) return;
    setLoadingMoreArticles(true);
    try {
      const oldest = articles.length > 0
        ? Math.min(...articles.map(e => e.created_at))
        : Math.floor(Date.now() / 1000);
      const newEvents = await pool.querySync(PROFILE_RELAYS, {
        kinds: [KIND_LONG_FORM],
        authors: [pubkey],
        limit: 30,
        until: oldest - 1,
      });
      if (newEvents.length < 30) {
        setHasMoreArticles(false);
      }
      if (newEvents.length > 0) {
        setArticles(prev => [...prev, ...newEvents].sort((a, b) => b.created_at - a.created_at));
      }
    } catch (err) {
      console.error("Failed to load more articles:", err);
    } finally {
      setLoadingMoreArticles(false);
    }
  }, [pubkey, loadingMoreArticles, hasMoreArticles, articles]);

  const loadFollowing = useCallback(async () => {
    if (!pubkey || followingLoaded || userFollowList.length === 0) return;
    try {
      const batch = userFollowList.slice(0, PEOPLE_BATCH_SIZE);
      const batchSet = new Set(batch);
      const liveMissing = livePubkeys.size > 0
        ? userFollowList.filter(pk => livePubkeys.has(pk) && !batchSet.has(pk))
        : [];
      const authors = liveMissing.length > 0 ? [...batch, ...liveMissing] : batch;
      prefetchProfilesBulkFromBrainstorm(authors.slice(0, 50));
      const profiles = await fetchBulkProfiles(authors);
      setFollowingProfiles(profiles);
      setFollowingBatchIndex(1);
      if (PEOPLE_BATCH_SIZE >= userFollowList.length) {
        setFollowingLoaded(true);
      }
    } catch (err) {
      console.error("Failed to fetch following:", err);
      setFollowingLoaded(true);
    }
  }, [pubkey, followingLoaded, userFollowList, livePubkeys]);

  const hasMoreFollowing = followingBatchIndex * PEOPLE_BATCH_SIZE < userFollowList.length;

  const loadMoreFollowing = useCallback(async () => {
    if (!pubkey || loadingMoreFollowing || !hasMoreFollowing) return;
    setLoadingMoreFollowing(true);
    try {
      const start = followingBatchIndex * PEOPLE_BATCH_SIZE;
      const end = (followingBatchIndex + 1) * PEOPLE_BATCH_SIZE;
      const batch = userFollowList.slice(start, end);
      if (batch.length === 0) {
        setFollowingLoaded(true);
        return;
      }
      const profiles = await fetchBulkProfiles(batch);
      setFollowingProfiles(prev => {
        const existing = new Set(prev.map(e => e.pubkey));
        const unique = profiles.filter(e => !existing.has(e.pubkey));
        return [...prev, ...unique];
      });
      setFollowingBatchIndex(prev => prev + 1);
      if (end >= userFollowList.length) {
        setFollowingLoaded(true);
      }
    } catch (err) {
      console.error("Failed to load more following:", err);
    } finally {
      setLoadingMoreFollowing(false);
    }
  }, [pubkey, loadingMoreFollowing, hasMoreFollowing, followingBatchIndex, userFollowList]);

  const FOLLOWER_API_BATCH = 500;

  const appendFollowersFromApi = useCallback(async (offset: number): Promise<boolean> => {
    if (!pubkey) return false;
    const { profiles, hasMore } = await fetchFollowersList(pubkey, FOLLOWER_API_BATCH, offset);
    const unique = profiles.filter(p => !followerSeenRef.current.has(p.pubkey));
    unique.forEach(p => followerSeenRef.current.add(p.pubkey));
    if (unique.length > 0) {
      allFollowerProfilesRef.current = [...allFollowerProfilesRef.current, ...unique];
    }
    setFollowerApiOffset(offset + FOLLOWER_API_BATCH);
    const apiHasMore = hasMore && unique.length > 0;
    setHasMoreFollowersApi(apiHasMore);
    return apiHasMore;
  }, [pubkey]);

  const loadFollowers = useCallback(async () => {
    if (!pubkey || followersLoaded) return;
    try {
      await appendFollowersFromApi(0);
      setFollowerProfiles(allFollowerProfilesRef.current.slice(0, PEOPLE_BATCH_SIZE));
      setFollowerDisplayCount(PEOPLE_BATCH_SIZE);
    } catch (err) {
      console.error("Failed to fetch followers:", err);
    } finally {
      setFollowersLoaded(true);
    }
  }, [pubkey, followersLoaded, appendFollowersFromApi]);

  // Eagerly pull a ranked page of THIS profile's followers so the identity
  // Circle can compute the profile's MUTUALS (their follows ∩ their followers).
  // Viewer-independent — guests get the Circle too — so it runs for every
  // profile; the viewer relationship is only a ranking bonus applied later.
  useEffect(() => {
    setCircleFollowerPubkeys([]);
    if (!pubkey) return;
    let cancelled = false;
    fetchFollowersList(pubkey, 500, 0)
      .then(({ profiles }) => { if (!cancelled) setCircleFollowerPubkeys(profiles.map((p) => p.pubkey)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pubkey]);

  const hasMoreFollowers = followerDisplayCount < allFollowerProfilesRef.current.length || hasMoreFollowersApi;

  const loadMoreFollowers = useCallback(async () => {
    if (!hasMoreFollowers || loadingMoreFollowers) return;
    const nextCount = followerDisplayCount + PEOPLE_BATCH_SIZE;
    if (nextCount <= allFollowerProfilesRef.current.length) {
      setFollowerProfiles(allFollowerProfilesRef.current.slice(0, nextCount));
      setFollowerDisplayCount(nextCount);
      return;
    }
    if (!hasMoreFollowersApi) {
      setFollowerProfiles(allFollowerProfilesRef.current);
      setFollowerDisplayCount(allFollowerProfilesRef.current.length);
      return;
    }
    setLoadingMoreFollowers(true);
    try {
      await appendFollowersFromApi(followerApiOffset);
      const newCount = Math.min(nextCount, allFollowerProfilesRef.current.length);
      setFollowerProfiles(allFollowerProfilesRef.current.slice(0, newCount));
      setFollowerDisplayCount(newCount);
    } catch (err) {
      console.error("Failed to load more followers:", err);
    } finally {
      setLoadingMoreFollowers(false);
    }
  }, [hasMoreFollowers, hasMoreFollowersApi, loadingMoreFollowers, followerDisplayCount, followerApiOffset, appendFollowersFromApi]);

  useEffect(() => {
    if (activeTab === "network") {
      if (networkView === "crew") loadFollowing();
      if (networkView === "orbit") loadFollowers();
    }
  }, [activeTab, networkView, loadArticles, loadFollowing, loadFollowers]);

  const handleCopyNpub = async () => {
    try {
      await copyNostrId(npubFull);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Error", description: "Failed to copy", variant: "destructive" });
    }
  };

  const handleFollow = async () => {
    if (!myPubkey || !signer || !pubkey || isOwnProfile) return;
    const wasFollowing = isFollowing;
    setFollowProcessing(true);
    try {
      // Load the authoritative current kind-3 (eventStore → broad relay fetch →
      // durable cache). blocked = we couldn't get a base but the account is known
      // to have follows → abort rather than publish a wipe.
      const { base: freshFollowEvent, blocked } = await loadFollowBase(myPubkey, follows?.length ?? 0);
      if (blocked) {
        toast({ title: "Couldn't load your follow list", description: "Try again in a moment — your follows are safe, we just need to fetch the list first.", variant: "destructive" });
        return;
      }

      const existingTags: string[][] = freshFollowEvent ? [...freshFollowEvent.tags] : [];

      let newTags: string[][];
      if (wasFollowing) {
        newTags = existingTags.filter(t => !(t[0] === "p" && t[1] === pubkey));
      } else {
        if (!existingTags.some(t => t[0] === "p" && t[1] === pubkey)) {
          newTags = [...existingTags, ["p", pubkey]];
        } else {
          newTags = existingTags;
        }
      }

      const event = {
        kind: KIND_FOLLOW_LIST,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
        content: freshFollowEvent?.content || "",
      };

      if (wasFollowing) {
        updateFollows((prev) => prev.filter((pk) => pk !== pubkey));
      } else {
        updateFollows((prev) => prev.includes(pubkey) ? prev : [...prev, pubkey]);
      }

      const signed = await signWithTimeout(signer, event);
      if (!verifySignedEventKind(signed, KIND_FOLLOW_LIST)) {
        toast({ title: "Signer error", description: "Your signer modified the event type — follow was not updated.", variant: "destructive" });
        if (wasFollowing) {
          updateFollows((prev) => prev.includes(pubkey!) ? prev : [...prev, pubkey!]);
        } else {
          updateFollows((prev) => prev.filter((pk) => pk !== pubkey));
        }
        return;
      }
      await publishEvent(signed as Event);
      cacheFollowEvent(signed as Event, { force: true }); // keep durable base current with user intent
    } catch (err) {
      console.error("Follow toggle failed:", err);
      if (wasFollowing) {
        updateFollows((prev) => prev.includes(pubkey!) ? prev : [...prev, pubkey!]);
      } else {
        updateFollows((prev) => prev.filter((pk) => pk !== pubkey));
      }
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setFollowProcessing(false);
    }
  };

  const handleZap = () => {
    if (!profileContent?.lud16) {
      toast({ title: "No Lightning address", description: "This user hasn't set a Lightning address.", variant: "destructive" });
      return;
    }
    setShowZapDialog(true);
  };

  const handleDM = () => {
    if (!pubkey) return;
    setLocation(`/messages`);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("open-dm", { detail: { pubkey } }));
    }, 100);
  };

  const handleMute = () => {
    if (!pubkey) return;
    if (muted) {
      unmutePubkey(pubkey);
      setMuted(false);
    } else {
      mutePubkey(pubkey);
      setMuted(true);
    }
  };

  const hasPlannedOrLiveStreams = useMemo(() => {
    return liveStreams.some((s) => s.status === "planned" || s.status === "live");
  }, [liveStreams]);

  const handleToggleStreamSubscription = () => {
    if (!pubkey || !myPubkey) return;
    if (streamSubscribed) {
      unsubscribeCreator(myPubkey, pubkey);
      setStreamSubscribed(false);
      toast({ title: "Unsubscribed", description: "Removed from your stream calendar." });
    } else {
      subscribeCreator(myPubkey, pubkey);
      setStreamSubscribed(true);
      toast({ title: "Subscribed", description: "Planned streams will appear on your calendar." });
    }
  };

  const crewCount = profileStats?.followingCount || userFollowList.length || 0;
  const orbitCount = profileStats?.followersCount || 0;
  const signalStrength = useMemo(() => getSignalStrength(profileStats?.lastSeen), [profileStats?.lastSeen]);
  const profileIsLive = pubkey ? isUserLive(pubkey) : false;
  const liveHref = useMemo(() => {
    if (!profileIsLive || !pubkey) return "/live";
    const stream = getLiveStream(pubkey);
    if (!stream) return "/live";
    try {
      // stream.pubkey, NOT the profile's pubkey. A kind-30311's address is
      // author + d, and now that hosts resolve as live the two are routinely
      // different people: the stream is authored by zap.stream while the
      // profile belongs to the human hosting it. Encoding the profile here
      // produced an naddr for an event that does not exist.
      return `/live/${nip19.naddrEncode({ identifier: stream.dTag, pubkey: stream.pubkey, kind: KIND_LIVE_EVENT })}`;
    } catch { return "/live"; }
  }, [profileIsLive, pubkey, getLiveStream]);
  const signalRingClass = useMemo(() => profileIsLive ? "signal-ring-live" : getSignalRingClass(signalStrength), [signalStrength, profileIsLive]);

  // Vouch count for the Trust tab badge. The hook auto-caches and filters to
  // human vouches only, so reading attestations.length here is cheap and matches
  // what the Trust tab renders. Badge only shows when > 0 (like other tabs).
  const { attestations: profileVouches } = useAttestations(pubkey || "");
  const vouchCount = profileVouches.length;

  // Label-only tabs: the counts used to live in the tab labels, which overflowed
  // the row on mobile (375px) and clipped Network off-screen. They now render as
  // a muted micro-copy line at the top of each tab's content instead (only for
  // tabs that already had a count — Network never did).
  const contentTabs: { id: ProfileTab; label: string; icon: typeof FileText }[] = [
    { id: "notes", label: "Notes", icon: FileText },
    { id: "replies", label: "Replies", icon: CornerUpLeft },
    { id: "media", label: "Media", icon: ImageIcon },
    { id: "network", label: "Network", icon: Users },
  ];
  const tabCounts: { notes?: number; replies?: number; media?: number } = {
    notes: profileStats?.noteCount,
    replies: profileStats?.replyCount,
    media: (mediaUrls.length + audioTracks.length + (profileStats?.longFormCount || 0)) || undefined,
  };

  const relayListEvent = use$(() => pubkey ? eventStore.replaceable(10002, pubkey) : undefined, [pubkey]);
  // Derive from the eventStore 10002 event directly — same source as the
  // re-render trigger above. Once the kind-10002 lands in the store (which also
  // triggers this re-render), the list renders immediately, with no dependence
  // on the separate relayListCache fetch-subscription race. Fall back to the
  // cache only when the eventStore has no event yet.
  const userRelayList = useMemo(
    () => (relayListEvent ? parseRelayList(relayListEvent) : (pubkey ? getRelayList(pubkey) : [])),
    [pubkey, relayListEvent],
  );

  // Loading vs empty: only show the "No relay list published" empty state after
  // a fetch has actually been attempted/resolved for this pubkey. Until then,
  // ProfileRelaysTab shows a loader instead of a false negative.
  const [relaysFetched, setRelaysFetched] = useState(false);
  useEffect(() => {
    setRelaysFetched(false);
    if (!pubkey) return;
    // If the eventStore already has the 10002, we're done immediately.
    if (relayListEvent) { setRelaysFetched(true); return; }
    // If a prior fetch already attempted this pubkey, reflect that.
    if (getRelayListMeta(pubkey).attempted) { setRelaysFetched(true); return; }
    // Otherwise treat the attempt as resolved after a bounded window so a user
    // with genuinely no list isn't stuck on the spinner forever.
    const t = setTimeout(() => setRelaysFetched(true), 6000);
    return () => clearTimeout(t);
  }, [pubkey, relayListEvent]);

  const [outpostBadges, setOutpostBadges] = useState<{ url: string; name: string; access: "public" | "private" }[]>([]);
  useEffect(() => {
    setOutpostBadges([]);
    if (!pubkey) return;
    let cancelled = false;

    if (isOwnProfile) {
      const localRelays = getOutpostRelays();
      if (localRelays.length > 0) {
        const resolve = async () => {
          const badges: { url: string; name: string; access: "public" | "private" }[] = [];
          await Promise.all(
            localRelays.map(async (r) => {
              const doc = await fetchNip11(r.url);
              const name = doc?.name || r.label || r.url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
              badges.push({ url: r.url.replace(/\/+$/, ""), name, access: r.access });
            }),
          );
          if (!cancelled) setOutpostBadges(badges);
        };
        resolve();
        return () => { cancelled = true; };
      }
    }

    fetchCommunitySubscriptions(pubkey).then(async (urls) => {
      if (cancelled) return;
      if (urls.length === 0) { setOutpostBadges([]); return; }
      const seen = new Set<string>();
      const deduped = urls.filter((u) => {
        const key = u.replace(/\/+$/, "").toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const badges: { url: string; name: string; access: "public" | "private" }[] = [];
      await Promise.all(
        deduped.map(async (url) => {
          const doc = await fetchNip11(url);
          const name = doc?.name || url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
          const isAuth = doc?.limitation?.auth_required === true;
          badges.push({ url: url.replace(/\/+$/, ""), name, access: isAuth ? "private" : "public" });
        }),
      );
      if (!cancelled) setOutpostBadges(badges);
    });
    return () => { cancelled = true; };
  }, [pubkey, myPubkey]);


  const crewHasLive = useMemo(() => {
    if (livePubkeys.size === 0 || userFollowList.length === 0) return false;
    return userFollowList.some(pk => livePubkeys.has(pk));
  }, [livePubkeys, userFollowList]);

  const orbitHasLive = useMemo(() => {
    if (livePubkeys.size === 0 || followerProfiles.length === 0) return false;
    return followerProfiles.some(e => livePubkeys.has(e.pubkey));
  }, [livePubkeys, followerProfiles]);

  const networkViewDefs: { id: ProfileNetworkView; label: string; subtitle?: string; icon: typeof FileText; hasLive?: boolean; count?: number }[] = [
    { id: "crew", label: "Following", icon: Users, hasLive: crewHasLive },
    { id: "orbit", label: "Followers", icon: Orbit, hasLive: orbitHasLive },
    { id: "relays", label: "Relays", icon: Radio },
    { id: "trust", label: "Trust", icon: ShieldCheck, count: vouchCount },
  ];

  if (!pubkey) {
    return (
      <div className="px-4 py-16 text-center" data-testid="page-profile-invalid">
        <p className="text-muted-foreground">Invalid profile key</p>
        <Button variant="outline" size="sm" className="mt-4" asChild data-testid="button-go-back">
          <Link href="/">Go back</Link>
        </Button>
      </div>
    );
  }

  // Desktop-with-sidebar-expanded has no top bar (and no HeaderBackButton), so
  // the profile header carries its own back affordance: this chip renders at
  // the left edge of the inline strip and on the expanded banner. Same
  // navigation as the global back buttons — the shared useGoBack helper does a
  // real history.back() so the scroll-restore token round-trips (see
  // lib/scroll-restore.ts), falling back to home for a cold deep-link.
  const bannerBackButton = (
    <button
      type="button"
      onClick={() => goBack("/")}
      // Visual chip matches the other on-banner controls (32px black glass);
      // the ::before overlay pads the hit area out to 40px.
      className="relative flex items-center justify-center w-8 h-8 rounded-full bg-black/40 border border-white/20 text-white/85 hover:text-white hover:bg-black/55 active:scale-95 transition-[background-color,color,transform] shrink-0 before:content-[''] before:absolute before:-inset-1"
      aria-label="Back"
      title="Back"
      data-testid="button-strip-back"
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  );

  // Solid-surface variant of the back chip: the collapsed strip now sits on the
  // top bar's solid background (X-style — no banner behind the name), so black
  // glass would read wrong in light mode. Theme tokens keep it legible in both.
  const bannerBackButtonSolid = (
    <button
      type="button"
      onClick={() => goBack("/")}
      className="relative flex items-center justify-center w-8 h-8 rounded-full bg-muted/70 border border-border text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-[background-color,color,transform] shrink-0 before:content-[''] before:absolute before:-inset-1"
      aria-label="Back"
      title="Back"
      data-testid="button-strip-back"
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  );

  // Secondary actions for other-user profiles, consolidated into one ⋯ overflow
  // menu (X/Instagram pattern) so the header shows only the primary Follow +
  // Message beside it. Reuses the existing handlers — nothing new is wired.
  const overflowMenuItems = (
    <>
      <DropdownMenuItem onClick={handleZap} className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0" data-testid="menu-item-zap">
        <BitcoinIcon className="w-4 h-4 text-brand/70" /> Zap
      </DropdownMenuItem>
      {/* The identity layout gets a dedicated button, but mobile falls back to
          the classic header — whose action row is already full at 375px. The
          overflow is the only place this fits on a phone. */}
      {canInviteToGroup && (
        <DropdownMenuItem onClick={() => setShowInviteToGroup(true)} className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0" data-testid="menu-item-invite-to-group">
          <Users className="w-4 h-4 text-brand/70" /> Invite to a group chat
        </DropdownMenuItem>
      )}
      {(hasPlannedOrLiveStreams || streamSubscribed) && (
        <DropdownMenuItem onClick={handleToggleStreamSubscription} className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0" data-testid="menu-item-stream-subscribe">
          <RadioTower className="w-4 h-4 text-brand/70" /> {streamSubscribed ? "Unsubscribe from schedule" : "Subscribe to schedule"}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={handleCopyNpub} className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0" data-testid="menu-item-copy-npub">
        <Copy className="w-4 h-4 text-brand/70" /> Copy npub
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => { setShareCopied(false); setShowShareDialog(true); }} className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0" data-testid="menu-item-share-profile">
        <Share2 className="w-4 h-4 text-brand/70" /> Share profile
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => { if (pubkey) setLocation(`/console?filter=${encodeURIComponent(JSON.stringify({ authors: [pubkey] }))}`); }}
        className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0"
        data-testid="menu-item-query-console"
      >
        <Terminal className="w-4 h-4 text-brand/70" /> Query this author's events
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={muted ? handleMute : () => setShowMuteConfirm(true)}
        className={`gap-2.5 cursor-pointer min-h-11 sm:min-h-0 ${muted ? "" : "text-red-500 focus:text-red-500"}`}
        data-testid="menu-item-mute"
      >
        <VolumeX className="w-4 h-4" /> {muted ? "Unmute" : "Mute"}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => setShowReportDialog(true)}
        className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0 text-red-500 focus:text-red-500"
        data-testid="menu-item-report"
      >
        <Flag className="w-4 h-4" /> Report
      </DropdownMenuItem>
    </>
  );

  const renderOverflowMenu = (trigger: React.ReactNode) => (
    // modal={false}: a modal Radix dropdown locks `body { pointer-events: none }`
    // while open and restores it on close — but when a menu item opens a Dialog
    // (Zap/Share/Mute/Report) or navigates (Query events), that restore races the
    // dialog's own lock and the page stays frozen. Non-modal never sets the lock,
    // so nothing can leak. (Same fix AudioFeed uses on its ⋯ menus.)
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-dropdown w-52 rounded-lg p-1.5">
        {overflowMenuItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Primary action cluster on other-user profiles for the EXPANDED header:
  // Follow/Following + Message (both labeled + prominent) + ⋯ overflow. Shared
  // by the mobile and desktop header rows so they stay in lockstep; the suffix
  // keeps their data-testids distinct across the two responsive variants.
  const renderOtherUserHeaderActions = (idSuffix: string, opts?: { hideOverflow?: boolean }) => (
    <>
      <Button
        variant={isFollowing ? "outline" : "default"}
        size="sm"
        onClick={isFollowing ? () => setShowUnfollowConfirm(true) : handleFollow}
        disabled={followProcessing}
        className={`h-9 gap-1.5 rounded-full px-4 ${!isFollowing ? "cta-pop font-semibold" : ""}`}
        data-testid={`button-follow-toggle${idSuffix}`}
        title={isFollowing ? "Unfollow" : "Follow"}
      >
        {followProcessing ? (
          <RelayOutpostInlineLoader className="w-4 h-4" />
        ) : isFollowing ? (
          <UserMinus className="w-4 h-4" />
        ) : (
          <UserPlus className="w-4 h-4" />
        )}
        <span>{isFollowing ? "Following" : "Follow"}</span>
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDM}
        className="h-9 gap-1.5 rounded-full px-4"
        data-testid={`button-dm${idSuffix}`}
        title="Message"
      >
        <MessageCircle className="w-4 h-4" />
        <span>Message</span>
      </Button>
      {!opts?.hideOverflow && renderOverflowMenu(
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 p-0 rounded-full text-muted-foreground hover:text-foreground before:content-[''] before:absolute before:-inset-1"
          title="More"
          aria-label="More options"
          data-testid={`button-profile-overflow${idSuffix}`}
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>,
      )}
    </>
  );

  // Follow/unfollow + DM (or Edit for own profile) + expand chevron — shared
  // by the top-bar portal strip and the inline fallback strip (rendered when
  // the top bar is unmounted, i.e. desktop with the sidebar expanded).
  const stripActions = (
    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 group-data-[audio=true]:hidden">
      {/* Actions render in the nav ONLY when the header is collapsed — the
          identity block below the banner is then out of view, so this is the
          only home for Follow/Message/⋯. When expanded, the identity block owns
          those actions and the nav shows just the chevron (no duplicated set). */}
      {headerCollapsed && (isOwnProfile && myPubkey ? (
        <Link
          href="/account"
          className="flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold border bg-muted/70 hover:bg-muted text-foreground border-border active:scale-95 transition-[background-color,color,transform]"
          data-testid="button-edit-profile-strip"
        >
          Edit
        </Link>
      ) : myPubkey ? (
        <>
          {isFollowing ? (
            <button
              type="button"
              onClick={() => setShowUnfollowConfirm(true)}
              disabled={followProcessing}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/70 border border-border text-muted-foreground hover:text-red-500 hover:bg-muted active:scale-95 transition-[background-color,color,transform]"
              aria-label="Unfollow"
              title="Following — tap to unfollow"
              data-testid="button-follow-strip"
            >
              {followProcessing ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <UserMinus className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFollow}
              disabled={followProcessing}
              className="flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold border bg-primary hover:bg-primary/90 text-primary-foreground border-transparent active:scale-95 transition-[background-color,color,transform]"
              data-testid="button-follow-strip"
            >
              {followProcessing ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              Follow
            </button>
          )}
          <button
            type="button"
            onClick={handleDM}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/70 border border-border text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-[background-color,color,transform]"
            aria-label="Send a message"
            title="Message"
            data-testid="button-dm-strip"
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
          {renderOverflowMenu(
            <button
              type="button"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/70 border border-border text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-[background-color,color,transform]"
              aria-label="More options"
              title="More"
              data-testid="button-profile-overflow-strip"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>,
          )}
        </>
      ) : null)}
      {/* Expand/condense chevron — hidden on phones, where it's redundant
          (tapping the avatar · name identity button toggles the same state)
          and was the straw that overcrowded the 375px bar. */}
      <button
        type="button"
        onClick={() => setHeaderCollapsed((c) => !c)}
        className="hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-muted/70 border border-border text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-[background-color,color,transform]"
        aria-expanded={!headerCollapsed}
        aria-label={headerCollapsed ? "Show full profile header" : "Condense profile header"}
        title={headerCollapsed ? "Show full profile header" : "Condense profile header"}
        data-testid="button-toggle-profile-header"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${headerCollapsed ? "" : "rotate-180"}`} />
      </button>
    </div>
  );

  // Tab bar + tab content, hoisted so BOTH the classic layout and the
  // identity layout render the exact same data (no data-layer fork).
  // Guest taste-then-wall (owner decision, 2026-08-14 — the Instagram
  // pattern): a shared "look at this person" link renders the header and a
  // first screen of posts, then the wall. Deeper slices — replies, media,
  // the network graph — are membership: an open network tab would be
  // connection enumeration, the exact browse surface the /discover wall
  // closes. Signed-in viewers pass through untouched (same-ref, capForGuest).
  const guestNotes = capForGuest(originalNotes, !!myPubkey);
  const guestTabWall = !myPubkey && (
    <div className="pt-4">
      <GuestWall context={`See more of ${displayName || "this person"}'s world`} />
    </div>
  );

  const profileTabsAndContent = (
    <>
      {/* "For sale" rail (NIP-99, Conduit et al) — self-hiding: renders
          nothing unless this person's listings actually resolve. */}
      {pubkey && myPubkey && <ProfileListingsStrip pubkey={pubkey} />}
      <div className="mt-4 min-w-0" data-testid="container-profile-tabs">
        <PageTabs
          ariaLabel="Profile sections"
          active={activeTab}
          onChange={(key) => setActiveTab(key as typeof activeTab)}
          tabs={contentTabs.map((tab) => ({
            key: tab.id,
            label: tab.label,
            icon: tab.icon,
            badge: tab.id === "network" && (crewHasLive || orbitHasLive) ? (
              <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_4px_1px_rgba(239,68,68,0.4)] live-dot shrink-0" data-testid="indicator-live-network" />
            ) : undefined,
          }))}
        />
      </div>

      <div className="mt-4 pb-8">
        {activeTab === "notes" && (
          <>
            <TabCountLine count={tabCounts.notes} singular="note" plural="notes" />
            <NotesTab notes={guestNotes.shown} loaded={notesLoaded} repostMap={repostMapRef.current} onLoadMore={loadMoreNotes} hasMore={guestNotes.walled ? false : hasMoreNotes} loadingMore={loadingMoreNotes} isOwnProfile={!!isOwnProfile} />
            {guestNotes.walled && guestTabWall}
          </>
        )}
        {activeTab === "replies" && (myPubkey ? (
          <>
            <TabCountLine count={tabCounts.replies} singular="reply" plural="replies" />
            <RepliesTab replies={replyNotes} loaded={notesLoaded} onLoadMore={loadMoreNotes} hasMore={hasMoreNotes} loadingMore={loadingMoreNotes} />
          </>
        ) : guestTabWall)}
        {activeTab === "media" && !myPubkey && guestTabWall}
        {activeTab === "media" && myPubkey && (
          <TabCountLine count={tabCounts.media} singular="media post" plural="media posts" />
        )}
        {activeTab === "media" && myPubkey && (
          <MediaSection
            mediaUrls={mediaUrls}
            mediaMeta={mediaMeta}
            mediaAuthor={{ displayName, avatarUrl }}
            mediaLoaded={notesLoaded}
            audioTracks={audioTracks}
            audioLoaded={audioLoaded}
            isOwnProfile={false}
            onLoadAudio={loadAudio}
            liveStreams={liveStreams}
            onLoadMore={loadMoreNotes}
            hasMore={hasMoreNotes}
            loadingMore={loadingMoreNotes}
            connectedPodcastFeed={discoveredPodcastFeed}
            orientationMap={orientationMap}
            articleCount={profileStats?.longFormCount}
            onArticlesOpen={loadArticles}
            articlesSlot={
              <ArticlesTab articles={articles} loaded={articlesLoaded} onLoadMore={loadMoreArticles} hasMore={hasMoreArticles} loadingMore={loadingMoreArticles} />
            }
          />
        )}
        {activeTab === "network" && !myPubkey && guestTabWall}
        {activeTab === "network" && myPubkey && (
          <div>
            <PageTabs
              className="mb-4"
              testId="container-network-views"
              ariaLabel="Network views"
              active={networkView}
              onChange={(key) => { setNetworkView(key as typeof networkView); setActiveTab("network"); }}
              tabs={networkViewDefs.map((v) => ({
                key: v.id,
                label: v.label,
                icon: v.icon,
                testId: `network-view-${v.id}`,
                count: typeof v.count === "number" && v.count > 0 ? v.count : undefined,
                badge: v.hasLive ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot shrink-0" /> : undefined,
              }))}
            />
            {networkView === "crew" && (
              <PeopleTab profiles={followingProfiles} loaded={followingBatchIndex > 0 || followingLoaded} emptyText="Not following anyone yet" onLoadMore={loadMoreFollowing} hasMore={hasMoreFollowing} loadingMore={loadingMoreFollowing} livePubkeys={livePubkeys} followOrder={userFollowList} tabKey="profile_crew" connectionScores={connectionScoresData.scores} totalCount={userFollowList.length} />
            )}
            {networkView === "orbit" && (
              <PeopleTab profiles={followerProfiles} loaded={followersLoaded} emptyText="No followers found" onLoadMore={loadMoreFollowers} hasMore={hasMoreFollowers} loadingMore={loadingMoreFollowers} livePubkeys={livePubkeys} tabKey="profile_orbit" connectionScores={connectionScoresData.scores} totalCount={orbitCount || followerProfiles.length} />
            )}
            {networkView === "relays" && (
              <ProfileRelaysTab relayList={userRelayList} fetched={relaysFetched} />
            )}
            {networkView === "trust" && pubkey && (
              <TrustReviewsPanel pubkey={pubkey} embedded />
            )}
          </div>
        )}
      </div>
    </>
  );

  // Zap / confirm / share / report dialogs, shared by both layouts.
  const profileDialogs = (
    <>
      {pubkey && (
        <ZapDialog
          open={showZapDialog}
          onOpenChange={setShowZapDialog}
          pubkey={pubkey}
          recipientName={profileContent ? (profileContent.display_name || profileContent.name || shortenNpub(nip19.npubEncode(pubkey))) : "user"}
        />
      )}
      {pubkey && !isOwnProfile && (
        <PetnameDialog
          open={petnameEditOpen}
          onOpenChange={setPetnameEditOpen}
          kind="person"
          id={pubkey}
          realName={realDisplayName}
        />
      )}
      {pubkey && !isOwnProfile && (
        <InviteToGroupDialog
          open={showInviteToGroup}
          onOpenChange={setShowInviteToGroup}
          recipientPubkey={pubkey}
          recipientName={profileContent ? (profileContent.display_name || profileContent.name || shortenNpub(nip19.npubEncode(pubkey))) : "them"}
        />
      )}
      <ConfirmAction
        open={showUnfollowConfirm}
        onOpenChange={setShowUnfollowConfirm}
        title={`Unfollow ${displayName}?`}
        description="You will no longer see their posts in your feed."
        confirmLabel="Unfollow"
        variant="destructive"
        onConfirm={() => {
          setShowUnfollowConfirm(false);
          if (isFollowing) handleFollow();
        }}
      />
      <ConfirmAction
        open={showMuteConfirm}
        onOpenChange={setShowMuteConfirm}
        title={`Mute ${displayName}?`}
        description="You won't see their posts anymore. You can unmute them anytime."
        confirmLabel="Mute"
        variant="destructive"
        onConfirm={() => {
          setShowMuteConfirm(false);
          if (!muted) handleMute();
        }}
      />
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm max-h-[85dvh] overflow-y-auto grid-cols-[minmax(0,1fr)]" data-testid="dialog-share-profile">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-base min-w-0">
              <Share2 className="w-4 h-4 text-brand shrink-0" /> <span className="truncate min-w-0">Share {displayName}</span>
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const shareUrl = npubFull ? `${window.location.origin}/profile/${npubFull}` : "";
            return (
              <div className="space-y-3 min-w-0">
                <div className="mx-auto w-fit rounded-xl bg-white p-3" data-testid="share-profile-qr">
                  <QRCodeSVG value={shareUrl} size={196} marginSize={2} bgColor="#ffffff" fgColor="#000000" />
                </div>
                <p className="text-[11px] text-center text-muted-foreground/60">Scan to open this profile, or copy the link below</p>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(shareUrl); setShareCopied(true); setTimeout(() => setShareCopied(false), 1500); }}
                  className="w-full flex items-center gap-2 min-h-11 md:min-h-9 px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-left min-w-0"
                  data-testid="button-share-profile-copy"
                >
                  {shareCopied ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />}
                  <span className="text-[10px] font-mono text-muted-foreground/70 truncate min-w-0 flex-1">{shareUrl}</span>
                </button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      {pubkey && (
        <ReportDialog
          open={showReportDialog}
          onOpenChange={setShowReportDialog}
          event={metadataEvent ?? ({ id: "", pubkey, kind: KIND_METADATA, content: "", created_at: 0, tags: [], sig: "" } as Event)}
        />
      )}
      {/* Network dialog — the identity layout's rail card opens the full lists here. */}
      <Dialog open={showNetworkDialog} onOpenChange={setShowNetworkDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[80dvh] overflow-y-auto grid-cols-[minmax(0,1fr)]" data-testid="dialog-identity-network">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base truncate">{displayName}'s network</DialogTitle>
          </DialogHeader>
          <PageTabs
            ariaLabel="Network views"
            // Sized to content, not four equal segments. At 375px the dialog
            // gives this row 286px; equal width made every tab 68px, leaving 49
            // for text where "Following" needs 58 — so BOTH it and "Followers"
            // clipped to the identical string "Follo…" and the first two tabs
            // became indistinguishable. Content-sized they total ~257px and all
            // four fit, with the row's existing overflow-x as the safety net.
            equalWidth={false}
            active={networkView}
            onChange={(key) => { setNetworkView(key as typeof networkView); if (key === "crew") loadFollowing(); if (key === "orbit") loadFollowers(); }}
            tabs={networkViewDefs.map((v) => ({ key: v.id, label: v.label, icon: v.icon, count: typeof v.count === "number" && v.count > 0 ? v.count : undefined }))}
          />
          <div className="mt-3">
            {networkView === "crew" && (
              <PeopleTab profiles={followingProfiles} loaded={followingBatchIndex > 0 || followingLoaded} emptyText="Not following anyone yet" onLoadMore={loadMoreFollowing} hasMore={hasMoreFollowing} loadingMore={loadingMoreFollowing} livePubkeys={livePubkeys} followOrder={userFollowList} tabKey="identity_crew" connectionScores={connectionScoresData.scores} totalCount={userFollowList.length} />
            )}
            {networkView === "orbit" && (
              <PeopleTab profiles={followerProfiles} loaded={followersLoaded} emptyText="No followers found" onLoadMore={loadMoreFollowers} hasMore={hasMoreFollowers} loadingMore={loadingMoreFollowers} livePubkeys={livePubkeys} tabKey="identity_orbit" connectionScores={connectionScoresData.scores} totalCount={orbitCount || followerProfiles.length} />
            )}
            {networkView === "relays" && (
              <ProfileRelaysTab relayList={userRelayList} fetched={relaysFetched} />
            )}
            {networkView === "trust" && pubkey && (
              <TrustReviewsPanel pubkey={pubkey} embedded />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  // Living-identity layout (viewer skin). Reuses the SAME tab content + dialogs
  // as the classic layout; only the surrounding frame changes.
  //
  // Runs on mobile too. The frame was always responsive (grid-cols-1 below lg),
  // and the layout order already reads correctly stacked — identity, then how to
  // reach them, then their Circle, then the timeline. What mobile needs is not a
  // different structure but a tighter one, so three things compact below:
  // the two primaries share a row, Circle scrolls sideways instead of wrapping
  // to two rows, and the Connections button drops (the headline counts are the
  // way in, and showing 289·39 twice within one screen is just noise).
  //
  // Gating it to desktop also made the preference dishonest: it's stored per
  // account regardless of viewport and DEFAULTS to identity, while the switch is
  // hidden below lg — so on a phone the setting was invisible AND inert.
  if (profileLayout === "identity" && pubkey) {
    const identityActions = isOwnProfile ? (
      <Link href="/account" className="inline-flex items-center justify-center h-9 rounded-full px-4 text-sm font-semibold border bg-muted/70 hover:bg-muted text-foreground border-border" data-testid="button-edit-profile-identity">
        Edit profile
      </Link>
    ) : (
      <>
        {/* On a phone the two primaries share one row instead of stacking, so
            the Connect box costs one line here rather than two. On desktop the
            column has the height to spare and full-width buttons read better. */}
        {isMobileProfile ? (
          <div className="flex gap-2 [&>button]:flex-1" data-testid="identity-primaries-row">
            {renderOtherUserHeaderActions("-identity", { hideOverflow: true })}
          </div>
        ) : (
          renderOtherUserHeaderActions("-identity", { hideOverflow: true })
        )}
        {/* Second-tier ways to reach someone, side by side so the two primaries
            stay the biggest thing in the box. Each only appears when it would
            actually work — no group chats to invite into, or no Lightning
            address, and the button simply isn't there. */}
        {(canInviteToGroup || !!profileContent?.lud16) && (
          <div className="flex gap-2">
            {canInviteToGroup && (
              <Button variant="outline" size="sm" onClick={() => setShowInviteToGroup(true)}
                className="flex-1 h-9 gap-1.5 rounded-full" data-testid="button-invite-to-group">
                <Users className="w-4 h-4" /> Invite
              </Button>
            )}
            {!!profileContent?.lud16 && (
              <Button variant="outline" size="sm" onClick={handleZap}
                className="flex-1 h-9 gap-1.5 rounded-full" data-testid="button-zap-identity">
                <Zap className="w-4 h-4" /> Zap
              </Button>
            )}
          </div>
        )}
      </>
    );
    // The ⋯ overflow sits at the BOTTOM of the Connect box, under Network.
    const identityOverflow = !isOwnProfile ? renderOverflowMenu(
      <Button variant="outline" size="sm" className="w-full h-9 rounded-full gap-1.5 text-muted-foreground hover:text-foreground" title="More" aria-label="More options" data-testid="button-profile-overflow-identity">
        <MoreHorizontal className="w-4 h-4" /> More
      </Button>
    ) : null;
    // Circle = this profile's MUTUALS: people they follow who follow them back
    // (theirFollows ∩ theirFollowers). Two-way ties can't be manufactured — a
    // spam account following 100 celebrities gets no follow-backs, so its
    // Circle stays empty — while a real account shows a full grid for every
    // viewer (including guests). The viewer relationship is a RANKING bonus:
    // mutuals you also follow (shared friends) float to the front. Renders
    // only with a populated grid (≥4 resolved) — one lonely avatar read as
    // broken. Under-counts when followers are partially loaded; never
    // over-claims.
    const followerSet = new Set(circleFollowerPubkeys);
    const myFollowSet = new Set(follows ?? []);
    const circleMutuals = userFollowList
      .filter((pk) => followerSet.has(pk) && pk !== pubkey && pk !== myPubkey)
      .sort((a, b) => Number(myFollowSet.has(b)) - Number(myFollowSet.has(a)));
    const identityCircle = circleMutuals.length >= 4
      ? <IdentityCircleCard pubkeys={circleMutuals} horizontal={isMobileProfile} />
      : null;
    // One way into the following/followers list, shared by the rail card and the
    // headline counts, so the two can't drift apart.
    const openNetwork = () => { setShowNetworkDialog(true); loadFollowing(); };
    const identityVouches = vouchCount > 0 ? (
      <button onClick={() => { setNetworkView("trust"); setShowNetworkDialog(true); }} className="w-full text-left" data-testid="identity-vouch-card">
        <p className="text-sm text-foreground/90 leading-snug">
          <span className="font-bold">{vouchCount}</span> {vouchCount === 1 ? "person has" : "people have"} vouched for {displayName}.
        </p>
        <span className="text-[11px] text-brand mt-1 inline-block">See who vouched →</span>
      </button>
    ) : null;
    return (
      <div ref={profileScrollRef} className="flex flex-col h-full overflow-y-auto" data-testid="page-profile">
        <IdentityProfileLayout
          data={{
            pubkey,
            npub: npubFull,
            isOwnProfile: !!isOwnProfile,
            bannerSrc: profileBannerSrc,
            bannerFallbackSrc: bannerFallback,
            avatarUrl,
            displayName,
            realName: realDisplayName,
            about: profileContent?.about,
            // Render the bio through the shared note renderer so nostr: mentions
            // resolve to @names and URLs linkify — not raw npub/event strings.
            aboutNode: profileContent?.about
              ? <LinkifiedText text={profileContent.about} className="text-sm text-foreground/85 whitespace-pre-wrap break-words leading-relaxed" data-testid="identity-about" />
              : undefined,
            nip05: profileContent?.nip05,
            website: profileContent?.website,
            lud16: profileContent?.lud16,
            joinedAt: profileStats?.timeJoined,
            followers: profileStats?.followersCount,
            following: profileStats?.followingCount,
            notes: profileStats?.noteCount,
            grapeRankTier,
            wotEnabled,
          }}
          actions={identityActions}
          onZapLud16={handleZap}
          networkSlot={
            // Dropped on mobile: stacked into one column it lands a few hundred
            // pixels from the headline "289 FOLLOWING / 39 FOLLOWERS" showing
            // the same two numbers. The counts themselves are now the way in.
            isMobileProfile ? undefined : (
              <IdentityNetworkCard
                following={crewCount}
                // Raw, so "we don't know" stays undefined instead of becoming
                // a zero the card would print. orbitCount coerces to 0.
                // `measured` is what makes that true: without it an unanswered
                // Primal delivered a real 0, not undefined.
                followers={profileStats?.measured ? profileStats.followersCount : undefined}
                onSeeAll={openNetwork}
              />
            )
          }
          overflowSlot={identityOverflow}
          circleSlot={identityCircle}
          communitiesSlot={subjectCommunityRows2.length > 0 ? <IdentityCommunitiesCard rows={subjectCommunityRows2} /> : undefined}
          vouchSlot={identityVouches}
        >
          {/* "For sale" rail (NIP-99) — self-hiding; also rendered in the
              classic layout above its tab row, so both skins carry it. */}
          {myPubkey && <ProfileListingsStrip pubkey={pubkey} />}
          <IdentityProfileMain
            allNotes={allNotes ?? []}
            repostedEvents={repostedEvents}
            articleEvents={articles}
            replyNotes={replyNotes}
            mediaUrls={mediaUrls}
            mediaMeta={mediaMeta}
            repostMap={repostMapRef.current}
            notesLoaded={notesLoaded}
            articlesLoaded={articlesLoaded}
            onLoadMore={loadMoreNotes}
            hasMore={hasMoreNotes}
            loadingMore={loadingMoreNotes}
            // `measured` gates every count. parseUserProfileStats zero-fills
            // its struct and only overwrites on a kind-10000105, so an
            // unanswered Primal used to arrive here as a confident 0 rather
            // than as undefined — and Primal's cache flaps (measured ~50%
            // 502s on 2026-08-03). Genuinely-zero accounts DO get the event
            // with followers_count: 0, so a real zero still shows 0; only the
            // unknown dashes.
            stats={{
              following: profileStats?.measured ? profileStats.followingCount : undefined,
              followers: profileStats?.measured ? profileStats.followersCount : undefined,
              totalPosts: profileStats?.measured ? profileStats.noteCount : undefined,
              totalReplies: profileStats?.measured ? profileStats.replyCount : undefined,
              totalArticles: profileStats?.measured ? profileStats.longFormCount : undefined,
              joinedAt: profileStats?.timeJoined,
              lastActiveAt: profileStats?.lastSeen,
            }}
            onSelectMedia={() => loadAudio()}
            onSelectArticles={() => loadArticles()}
            articlesSlot={
              <ArticlesTab articles={articles} loaded={articlesLoaded} onLoadMore={loadMoreArticles} hasMore={hasMoreArticles} loadingMore={loadingMoreArticles} />
            }
            onSeeNetwork={openNetwork}
            mediaSlot={
              <MediaSection
                mediaUrls={mediaUrls}
            mediaMeta={mediaMeta}
                mediaAuthor={{ displayName, avatarUrl }}
                mediaLoaded={notesLoaded}
                audioTracks={audioTracks}
                audioLoaded={audioLoaded}
                isOwnProfile={false}
                onLoadAudio={loadAudio}
                liveStreams={liveStreams}
                onLoadMore={loadMoreNotes}
                hasMore={hasMoreNotes}
                loadingMore={loadingMoreNotes}
                connectedPodcastFeed={discoveredPodcastFeed}
                orientationMap={orientationMap}
              />
            }
          />
        </IdentityProfileLayout>
        {profileDialogs}
      </div>
    );
  }

  return (
    <div ref={profileScrollRef} className="flex flex-col h-full overflow-y-auto" data-testid="page-profile">
      {/* Identity lives in the global top bar (portal into #header-identity-slot):
          avatar · name · Follow/Edit · ⌄ — the old banner strip is gone, so the
          tabs + content start immediately. When the header audio player is docked
          the slot's group-data CSS collapses this to avatar-only (tap = expand). */}
      {headerSlotEl && createPortal(
        <div className="flex w-full items-center gap-2 min-w-0 pr-1" data-testid="container-profile-strip">
          {/* An invisible marker div lived here whose entire job was to tell
              index.css that a foreign identity owned the bar, so the menu
              trigger could swap the signed-in user's avatar for the app mark.
              The trigger is the mark unconditionally now, so the marker had no
              reader left — deleted rather than kept "just in case". */}
          <button
            type="button"
            onClick={() => setHeaderCollapsed((c) => !c)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left"
            aria-label={headerCollapsed ? "Show full profile header" : "Condense profile header"}
            data-testid="button-header-identity"
          >
            {/* Own profile: skip the avatar — the mobile menu trigger (left of
                this slot) already shows it. Kept in audio-docked mode, where
                it's the only expand handle left. */}
            <Avatar className={`w-7 h-7 border border-border shrink-0 ${isOwnProfile && myPubkey ? "hidden group-data-[audio=true]:flex" : ""}`}>
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-brand/25 text-brand text-[10px] font-bold">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-bold text-foreground truncate group-data-[audio=true]:hidden" data-testid="text-strip-name">
              {displayName}
            </span>
          </button>
          {stripActions}
        </div>,
        headerSlotEl,
      )}
      {/* Inline fallback strip: on desktop with the sidebar expanded the top
          bar (and its identity slot) is unmounted, so the condensed identity
          renders here instead — the pre-slot ~56px banner strip above the tabs.
          Same chevron expands the full banner/HUD/bio block below. */}
      {!headerSlotEl && headerCollapsed && (
        <div className="relative h-14 w-full overflow-hidden shrink-0 bg-background border-b border-border" data-testid="container-profile-strip">
          <div className="absolute inset-y-0 left-3 right-2 flex items-center gap-2.5">
            {bannerBackButtonSolid}
            <button
              type="button"
              onClick={() => setHeaderCollapsed(false)}
              className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
              aria-label="Show full profile header"
              data-testid="button-header-identity"
            >
              <Avatar className="w-8 h-8 border border-border shrink-0">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-brand/25 text-brand text-[11px] font-bold">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate" data-testid="text-strip-name">
                  {displayName}
                </p>
                {profileContent?.nip05 && (
                  <div className="hidden min-[420px]:block">
                    <Nip05Badge nip05={profileContent.nip05} pubkey={pubkey!} className="text-[10px] font-mono" textClassName="text-muted-foreground truncate" iconClassName="w-3 h-3" />
                  </div>
                )}
              </div>
            </button>
            {stripActions}
          </div>
        </div>
      )}

      <div className={headerCollapsed ? "hidden" : "relative w-full"} data-testid="container-profile-banner">
        <div
          className="h-36 sm:h-48 md:h-56 w-full overflow-hidden"
          style={{
            backgroundColor: "hsl(260 20% 7%)",
            backgroundImage: profileContent?.banner ? undefined : `url(${PROFILE_BANNER_LQIP})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {/* No top bar on desktop with the sidebar expanded (headerSlotEl is
              null), so the expanded banner carries the back chip too — the
              collapsed strip's copy unmounts with it. With the top bar present
              its HeaderBackButton already covers back. */}
          {!headerSlotEl && <div className="absolute top-3 left-3 z-20">{bannerBackButton}</div>}
          <button
            type="button"
            onClick={() => setHeaderCollapsed(true)}
            // z-20: the identity block below overlaps the banner bottom (-mt-12,
            // z-10), which would otherwise sit over this button and eat its taps.
            className="absolute bottom-3 right-3 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 border border-white/20 text-white/85 hover:text-white hover:bg-black/55 active:scale-95 transition-[background-color,color,transform]"
            aria-expanded
            aria-label="Condense profile header"
            title="Condense profile header"
            data-testid="button-toggle-profile-header"
          >
            <ChevronDown className="w-4 h-4 rotate-180" />
          </button>
          <img
            src={profileBannerSrc}
            alt="Profile banner"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className={`w-full h-full object-cover transition-opacity duration-300 ${profileBannerLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setProfileBannerLoaded(true)}
            onError={(e) => { const img = e.target as HTMLImageElement; if (img.src !== bannerFallback) img.src = bannerFallback; }}
            data-testid="img-profile-banner"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
          <div
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{
              background: "linear-gradient(90deg, transparent 10%, rgba(140, 80, 220, 0.15) 30%, rgba(100, 60, 180, 0.22) 50%, rgba(140, 80, 220, 0.15) 70%, transparent 90%)",
            }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-[4px] pointer-events-none"
            style={{
              background: "linear-gradient(90deg, transparent 10%, rgba(140, 80, 220, 0.04) 30%, rgba(100, 60, 180, 0.07) 50%, rgba(140, 80, 220, 0.04) 70%, transparent 90%)",
              filter: "blur(2px)",
            }}
          />
          {profileStats && (profileStats.lastSeen || profileStats.timeJoined || lastPostedAt) && (
            <div className="absolute top-3 right-3 z-10 banner-hud rounded-md px-2.5 py-1.5 flex flex-col items-center" data-testid="container-banner-hud">
              <div className="flex items-stretch">
                {profileStats.lastSeen && (
                  <>
                    <div className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-0.5" data-testid="hud-last-signal">
                      <span className="banner-hud-label">Last Signal</span>
                      <span className="banner-hud-value font-mono">{formatRelativeTime(profileStats.lastSeen)}</span>
                    </div>
                    {(profileStats.noteCount > 0 && profileStats.timeJoined || profileStats.timeJoined) && (
                      <div className="banner-hud-divider" />
                    )}
                  </>
                )}
                {profileStats.noteCount > 0 && profileStats.timeJoined && (
                  <>
                    <div className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-0.5" data-testid="hud-frequency">
                      <span className="banner-hud-label">Frequency</span>
                      <span className="banner-hud-value font-mono">{formatActivityRate(profileStats.noteCount, profileStats.timeJoined)}</span>
                    </div>
                    {profileStats.timeJoined && (
                      <div className="banner-hud-divider" />
                    )}
                  </>
                )}
                {profileStats.timeJoined && (
                  <div className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-0.5" data-testid="hud-first-contact">
                    <span className="banner-hud-label">First Contact</span>
                    <span className="banner-hud-value font-mono">{formatJoinDate(profileStats.timeJoined)}</span>
                  </div>
                )}
                {lastPostedAt && (
                  <>
                    {(profileStats.lastSeen || profileStats.timeJoined) && (
                      <div className="banner-hud-divider" />
                    )}
                    <div className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-0.5" data-testid="hud-last-posted">
                      <span className="banner-hud-label">Last Posted</span>
                      <span className="banner-hud-value font-mono">~{formatRelativeTime(lastPostedAt)}</span>
                    </div>
                  </>
                )}
              </div>
              <span className="text-[7px] leading-none tracking-wider text-white/30 italic mt-1" data-testid="text-hud-disclaimer">Based on available relay data</span>
              {grapeRankScore && grapeRankTier !== "none" && (
                <>
                  <div className="banner-hud-rule mt-1.5" />
                  <div className="flex items-center gap-2 mt-1.5" data-testid="hud-trust-signal">
                    <BrainstormIcon className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400 drop-shadow-[0_0_4px_rgba(52,211,153,0.3)]" />
                    <span className="text-[9px] tracking-[0.14em] uppercase font-semibold leading-none text-brand/90">Signal</span>
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center gap-[2px]">
                        {[0, 1, 2, 3].map((i) => {
                          const filled = grapeRankTier === "strong" ? i < 4
                            : grapeRankTier === "moderate" ? i < 3
                            : grapeRankTier === "low" ? i < 2
                            : i < 1;
                          return (
                            <div
                              key={i}
                              className={`rounded-[1px] ${filled
                                ? grapeRankTier === "strong" ? "bg-emerald-400"
                                  : grapeRankTier === "moderate" ? "bg-blue-400"
                                  : grapeRankTier === "low" ? "bg-cyan-400"
                                  : "bg-amber-400"
                                : "bg-white/15"
                              }`}
                              style={{ width: 3, height: 6 + i * 2 }}
                            />
                          );
                        })}
                      </div>
                      <span className={`banner-hud-value font-mono text-[11px] font-bold ${
                        grapeRankTier === "strong" ? "text-emerald-800 dark:text-emerald-300" :
                        grapeRankTier === "moderate" ? "text-blue-700 dark:text-blue-300" :
                        grapeRankTier === "low" ? "text-cyan-800 dark:text-cyan-300" :
                        "text-amber-800 dark:text-amber-300"
                      }`}>
                        {formatInfluence(grapeRankScore.influence)}
                      </span>
                    </div>
                  </div>
                  <a href="https://brainstorm.nosfabrica.com" target="_blank" rel="noopener noreferrer" className="text-[7px] leading-none tracking-wider text-white/25 hover:text-white/40 transition-colors mt-0.5">Powered by Brainstorm · NIP-85</a>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="max-w-3xl mx-auto w-full px-3 sm:px-4">
        <div className={`flex-col sm:flex-row sm:items-end gap-3 -mt-12 sm:-mt-14 relative z-10 ${headerCollapsed ? "hidden" : "flex"}`}>
          <div className="flex items-end justify-between sm:contents">
            <div className="relative shrink-0" data-testid="avatar-signal-container">
              <Avatar className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full ${signalRingClass}`} data-testid="avatar-profile">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-muted text-muted-foreground text-2xl font-bold">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {profileIsLive ? (
                <Link href={liveHref}>
                  <div
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold uppercase tracking-wider shadow-[0_0_8px_2px_rgba(239,68,68,0.4)] live-dot cursor-pointer border border-red-400/50"
                    title="Currently streaming live"
                    data-testid="indicator-live-badge"
                  >
                    LIVE
                  </div>
                </Link>
              ) : signalStrength !== "none" && (
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background ${
                    signalStrength === "strong" ? "bg-brand shadow-[0_0_6px_2px_rgba(139,92,246,0.4)]" :
                    signalStrength === "fading" ? "bg-amber-500 shadow-[0_0_4px_1px_rgba(245,158,11,0.3)]" :
                    "bg-slate-500/40"
                  }`}
                  title={signalStrength === "strong" ? "Active today" : signalStrength === "fading" ? "Active this week" : "Inactive"}
                  data-testid="indicator-signal-strength"
                />
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:hidden pb-1">
              {isOwnProfile && myPubkey && (
                <InviteFriend
                  npub={npubFull}
                  trigger={
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground/60 hover:text-foreground/80" title="Invite a friend" data-testid="button-invite-friend-profile-mobile">
                      <UserPlus className="w-3 h-3" />
                    </Button>
                  }
                />
              )}
              {!isOwnProfile && myPubkey && renderOtherUserHeaderActions("-mobile")}
            </div>
          </div>

          <div className="flex-1 min-w-0 pb-1">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold font-display truncate" data-testid="text-profile-name">
                  {displayName}
                </h1>
                {profileContent?.nip05 && (
                  <div className="mt-0.5" data-testid="text-profile-nip05">
                    <Nip05Badge nip05={profileContent.nip05} pubkey={pubkey!} className="text-xs font-mono" textClassName="text-primary/80 truncate" iconClassName="w-3.5 h-3.5" />
                  </div>
                )}
                {!isOwnProfile && (
                  <ImpersonationChip
                    pubkey={pubkey}
                    displayName={profileContent?.display_name || profileContent?.name}
                    nip05={profileContent?.nip05}
                    className="mt-1"
                  />
                )}
                {/* Petname reveal + edit. The profile always shows the REAL
                    name above — a name YOU assigned can't be spoofed, but the
                    page that verifies identity must never hide the claimed
                    one. This line is the "what do I call them" surface. */}
                {!isOwnProfile && pubkey && (
                  <button
                    type="button"
                    onClick={() => setPetnameEditOpen(true)}
                    className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                    data-testid="profile-petname-line"
                  >
                    <Pencil className="w-3 h-3" />
                    {getPetname("person", pubkey)?.name
                      ? <>You call them <span className="text-foreground/85 font-medium">“{getPetname("person", pubkey)!.name}”</span></>
                      : "Rename for you"}
                  </button>
                )}
              </div>

              <div className="hidden sm:flex items-center gap-1.5 flex-wrap shrink-0">
                {isOwnProfile && myPubkey && (
                  <InviteFriend
                    npub={npubFull}
                    trigger={
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground/60 hover:text-foreground/80" title="Invite a friend" data-testid="button-invite-friend-profile">
                        <UserPlus className="w-3 h-3" />
                        <span className="text-xs">Invite</span>
                      </Button>
                    }
                  />
                )}
                {!isOwnProfile && myPubkey && renderOtherUserHeaderActions("")}
                {/* Desktop-only viewer switch so the Identity layout is
                    discoverable without opening Settings. */}
                <ProfileLayoutSwitch />
              </div>
            </div>
          </div>
        </div>

        {/* Live now — the classic layout is what MOBILE always renders, so this
            is the mobile half of "noticeable on desktop and mobile". Outside
            the headerCollapsed block below on purpose: collapsing the header to
            read someone's posts should not hide the fact that they are on air.
            Renders nothing when they are not. */}
        <LiveNowBanner pubkey={pubkey || ""} className="mt-3" />

        <div className={headerCollapsed ? "hidden" : "mt-3"}>
          {profileContent?.about && (
            <LinkifiedText
              text={profileContent.about}
              className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed"
              data-testid="text-profile-about"
            />
          )}

          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground/80 mt-3">
            {profileContent?.website && (
              <a
                href={profileContent.website.startsWith("http") ? profileContent.website : `https://${profileContent.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 hover:text-foreground/80 transition-colors w-fit"
                data-testid="link-website"
              >
                <Globe className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />
                <span className="truncate">{profileContent.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
              </a>
            )}
            {profileContent?.lud16 && (
              <span className="inline-flex items-center gap-2 w-fit" data-testid="text-lightning-address">
                <BtcZapIcon className="w-3.5 h-3.5 shrink-0 text-amber-500/60" />
                <span className="truncate">{profileContent.lud16}</span>
              </span>
            )}
            <button
              onClick={handleCopyNpub}
              className="inline-flex items-center gap-2 font-mono hover:text-foreground/80 transition-colors cursor-pointer w-fit"
              data-testid="button-copy-npub"
            >
              <img src={nostrOstrich} alt="" className="w-3.5 h-3.5 shrink-0 opacity-50" />
              <span className="truncate">{npubShort}</span>
              {copied ? <Check className="w-3 h-3 text-green-500 shrink-0" /> : <Copy className="w-3 h-3 opacity-40 shrink-0" />}
            </button>
            {outpostBadges.length > 0 && (() => {
              const hidden = (isOwnProfile && myPubkey) ? getHiddenBadgeUrls(myPubkey) : new Set<string>();
              const visible = outpostBadges.filter((b) => !hidden.has(b.url));
              if (visible.length === 0) return null;
              const first = visible[0];
              const rest = visible.slice(1);
              const firstName = (isOwnProfile && myPubkey) ? getBadgeDisplayName(myPubkey, first.url, first.name) : first.name;
              return (
                <>
                  <div className="inline-flex items-center gap-2 min-w-0 max-w-full">
                    <Link href={`/outposts/${encodeURIComponent(first.url)}`} className="inline-flex items-center gap-2 hover:text-foreground/80 transition-colors min-w-0">
                      <RelayOutpostIcon className="w-3.5 h-3.5 shrink-0 text-brand/60" />
                      <span className="truncate min-w-0">{firstName}</span>
                      {first.access === "private" && <Lock className="w-2.5 h-2.5 shrink-0 opacity-40" />}
                    </Link>
                    {rest.length > 0 && (
                      <button
                        onClick={() => setBadgesExpanded(!badgesExpanded)}
                        aria-expanded={badgesExpanded}
                        aria-label={`Show ${rest.length} more outpost${rest.length > 1 ? "s" : ""}`}
                        className="inline-flex items-center gap-0.5 text-brand/50 hover:text-brand/80 transition-colors shrink-0"
                      >
                        <span className="text-[10px]">+{rest.length} more</span>
                        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${badgesExpanded ? "rotate-180" : ""}`} />
                      </button>
                    )}
                  </div>
                  {badgesExpanded && rest.map((b) => {
                    const displayName = (isOwnProfile && myPubkey) ? getBadgeDisplayName(myPubkey, b.url, b.name) : b.name;
                    return (
                      <Link key={b.url} href={`/outposts/${encodeURIComponent(b.url)}`} className="inline-flex items-center gap-2 hover:text-foreground/80 transition-colors w-fit min-w-0 max-w-full">
                        <RelayOutpostIcon className="w-3.5 h-3.5 shrink-0 text-brand/60" />
                        <span className="truncate min-w-0">{displayName}</span>
                        {b.access === "private" && <Lock className="w-2.5 h-2.5 shrink-0 opacity-40" />}
                      </Link>
                    );
                  })}
                </>
              );
            })()}
          </div>

          {/* The bio "More/Show less" toggle is gone: the header chevron is now the
              single expand-all/collapse-all — expanded shows the full bio + details. */}
        </div>

        {!headerCollapsed && nip58Badges.length > 0 && pubkey && (
          <ErrorBoundary fallback={null}>
            <div className="mt-4 px-1">
              <ProfileBadgesSection badges={nip58Badges} pubkey={pubkey} onRefresh={refreshNip58Badges} />
            </div>
          </ErrorBoundary>
        )}

        {profileIsLive && (() => {
          const liveStream = pubkey ? getLiveStream(pubkey) : undefined;
          return (
            <Link href={liveHref}>
              <div
                className="mt-4 rounded-xl border border-red-500/30 dark:border-red-500/25 bg-card/60 dark:bg-card/30 backdrop-blur-sm shadow-[0_0_12px_2px_rgba(239,68,68,0.1)] dark:shadow-[0_0_12px_2px_rgba(239,68,68,0.15)] cursor-pointer hover:shadow-[0_0_16px_4px_rgba(239,68,68,0.15)] dark:hover:shadow-[0_0_16px_4px_rgba(239,68,68,0.2)] transition-all duration-300"
                data-testid="banner-live-stream"
              >
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_2px_rgba(239,68,68,0.4)] live-dot shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-red-500">Live Now</span>
                      <LiveDuration starts={liveStream?.starts} />
                      {liveStream?.currentParticipants != null && liveStream.currentParticipants > 0 && (
                        <span className="text-[10px] text-muted-foreground/60">{liveStream.currentParticipants} watching</span>
                      )}
                    </div>
                    {liveStream?.title && (
                      <p className="text-sm font-medium truncate mt-0.5">{liveStream.title}</p>
                    )}
                  </div>
                  <Radio className="w-4 h-4 text-red-500/60 shrink-0" />
                </div>
              </div>
            </Link>
          );
        })()}

        {/* Profile-completion nudge removed — no auto-showing new-user prompts;
            profile editing is one tap away via the bar's Edit chip. */}

        {profileTabsAndContent}
      </div>
      {profileDialogs}
    </div>
  );
}

function NotesTab({ notes, loaded, repostMap, onLoadMore, hasMore, loadingMore, isOwnProfile }: { notes: Event[]; loaded: boolean; repostMap?: Map<string, { pubkey: string; timestamp: number }>; onLoadMore?: () => void; hasMore?: boolean; loadingMore?: boolean; isOwnProfile?: boolean }) {
  if (!loaded && notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12" data-testid="container-loading-notes">
        <RelayOutpostLoader size="md" label="Loading notes..." />
      </div>
    );
  }
  if (loaded && notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4" data-testid="container-no-notes">
        <FileText className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">{isOwnProfile ? "You haven't posted yet" : "No recent notes"}</p>
        {isOwnProfile && (
          <>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">Share your first note — it goes out to everyone who follows you.</p>
            <Button asChild size="sm" className="mt-4" data-testid="button-share-first-post">
              <Link href="/">Share your first post</Link>
            </Button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="container-profile-notes">
      {notes.map((event) => (
        <ErrorBoundary key={event.id} fallback={<div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-muted-foreground" data-testid="error-post-fallback">This note couldn't be displayed</div>}>
          <NostrPost event={event} repostedBy={repostMap?.get(event.id) || null} />
        </ErrorBoundary>
      ))}
      {onLoadMore && hasMore !== undefined && loadingMore !== undefined && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} isLoading={loadingMore} hasMore={hasMore} />
      )}
    </div>
  );
}

function RepliesTab({ replies, loaded, onLoadMore, hasMore, loadingMore }: { replies: Event[]; loaded: boolean; onLoadMore?: () => void; hasMore?: boolean; loadingMore?: boolean }) {
  if (!loaded && replies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12" data-testid="container-loading-replies">
        <RelayOutpostLoader size="md" label="Loading replies..." />
      </div>
    );
  }
  if (loaded && replies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-no-replies">
        <CornerUpLeft className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No replies found</p>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="container-profile-replies">
      {replies.map((event) => (
        <ErrorBoundary key={event.id} fallback={<div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-muted-foreground" data-testid="error-post-fallback">This note couldn't be displayed</div>}>
          <NostrPost event={event} />
        </ErrorBoundary>
      ))}
      {onLoadMore && hasMore !== undefined && loadingMore !== undefined && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} isLoading={loadingMore} hasMore={hasMore} />
      )}
    </div>
  );
}

function ArticlesTab({ articles, loaded, onLoadMore, hasMore, loadingMore }: { articles: Event[]; loaded: boolean; onLoadMore?: () => void; hasMore?: boolean; loadingMore?: boolean }) {
  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <RelayOutpostLoader size="md" label="Loading articles..." />
      </div>
    );
  }
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BookOpen className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No articles published yet</p>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="container-profile-articles">
      {articles.map((article) => {
        const title = article.tags.find(t => t[0] === "title")?.[1] || "Untitled";
        const summary = article.tags.find(t => t[0] === "summary")?.[1] || "";
        const image = article.tags.find(t => t[0] === "image")?.[1];
        const dTag = article.tags.find(t => t[0] === "d")?.[1] || "";
        const publishedAt = article.tags.find(t => t[0] === "published_at")?.[1];
        const hashtags = article.tags.filter(t => t[0] === "t").map(t => t[1]);
        const date = publishedAt ? new Date(parseInt(publishedAt) * 1000) : new Date(article.created_at * 1000);
        // Read time from the article body (kind-30023 content is the markdown).
        const words = article.content ? article.content.trim().split(/\s+/).filter(Boolean).length : 0;
        const minutes = words > 0 ? Math.max(1, Math.round(words / 200)) : 0;

        let naddr = "";
        try {
          naddr = nip19.naddrEncode({
            identifier: dTag,
            pubkey: article.pubkey,
            kind: KIND_LONG_FORM,
          });
        } catch {}

        return (
          <Link
            key={article.id}
            href={`/articles/${naddr}`}
            className="group/article block"
            data-testid={`article-${article.id.slice(0, 8)}`}
          >
            {/* Editorial card — a "reading" object, deliberately unlike the note
                stream: brand hairline spine, eyebrow kicker, cover as a banner. */}
            <article className="relative overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
              <span className="absolute inset-y-0 left-0 w-0.5 bg-primary/70 opacity-70 group-hover/article:opacity-100 transition-opacity" aria-hidden="true" />
              <div className="flex gap-4 p-4 pl-5">
                {image && (
                  <div className="w-20 h-24 sm:w-28 sm:h-32 rounded-lg overflow-hidden shrink-0 bg-muted ring-1 ring-border/40">
                    <img src={image} alt={title} className="w-full h-full object-cover transition-transform duration-500 group-hover/article:scale-105" loading="lazy" decoding="async" />
                  </div>
                )}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-brand/70">
                    <BookOpen className="w-3 h-3" />
                    <span>Article</span>
                    {minutes > 0 && (
                      <span className="flex items-center gap-1 text-muted-foreground/50">
                        <span className="text-muted-foreground/30">·</span>
                        <Clock className="w-2.5 h-2.5" /> {minutes} min read
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1.5 text-[15px] sm:text-base font-semibold leading-snug tracking-tight line-clamp-2 text-foreground group-hover/article:text-brand transition-colors">
                    {title}
                  </h3>
                  {summary && (
                    <p className="text-xs sm:text-[13px] text-muted-foreground line-clamp-2 mt-1 leading-relaxed">{summary}</p>
                  )}
                  <div className="flex items-center gap-2 mt-auto pt-2.5 flex-wrap">
                    <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                      {date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    {hashtags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[10px] font-medium text-muted-foreground/70 border border-border/60 rounded-full px-2 py-0.5">
                        #{tag}
                      </span>
                    ))}
                    <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-brand opacity-0 group-hover/article:opacity-100 translate-x-1 group-hover/article:translate-x-0 transition-all duration-300">
                      Read <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </div>
            </article>
          </Link>
        );
      })}
      {onLoadMore && hasMore !== undefined && loadingMore !== undefined && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} isLoading={loadingMore} hasMore={hasMore} />
      )}
    </div>
  );
}

type PeopleSortMode = "strong" | "weak" | "a-z" | "z-a" | "newest" | "oldest";
function getSortOptions(tabKey?: string, hasWot?: boolean): { value: PeopleSortMode; label: string }[] {
  const isCrew = tabKey?.includes("crew");
  const opts: { value: PeopleSortMode; label: string }[] = [];
  if (hasWot) {
    opts.push({ value: "strong", label: "Highly Trusted" });
    opts.push({ value: "weak", label: "Low Trust" });
  }
  opts.push({ value: "a-z", label: "A → Z" });
  opts.push({ value: "z-a", label: "Z → A" });
  opts.push({ value: "newest", label: isCrew ? "Newest Following" : "Newest Followers" });
  opts.push({ value: "oldest", label: isCrew ? "Oldest Following" : "Oldest Followers" });
  return opts;
}

function getProfileNameLower(event: Event): string {
  const raw = getProfileContent(event);
  const content = raw as ProfileContentData | undefined;
  return (content?.display_name || content?.name || shortenNpub(formatNpub(event.pubkey))).toLowerCase();
}

function PeopleTab({ profiles, loaded, emptyText, onLoadMore, hasMore, loadingMore, livePubkeys, followOrder, tabKey, connectionScores, totalCount }: { profiles: Event[]; loaded: boolean; emptyText: string; onLoadMore?: () => void; hasMore?: boolean; loadingMore?: boolean; livePubkeys?: Set<string>; followOrder?: string[]; tabKey?: string; connectionScores?: Map<string, number> | null; totalCount?: number }) {
  const hasWot = !!(connectionScores && connectionScores.size > 0);
  const sortOptions = useMemo(() => getSortOptions(tabKey, hasWot), [tabKey, hasWot]);
  const storageKey = `people_sort_${tabKey || "default"}`;
  const [sortMode, setSortMode] = useState<PeopleSortMode>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v && ["a-z","z-a","newest","oldest","strong","weak"].includes(v)) {
        if (!hasWot && (v === "strong" || v === "weak")) return "a-z";
        return v as PeopleSortMode;
      }
    } catch {}
    return hasWot ? "strong" : "a-z";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const { isAuthorFlagged, wotEnabled } = useGrapeRankScores();

  const handleSortChange = useCallback((mode: PeopleSortMode) => {
    setSortMode(mode);
    setShowSortMenu(false);
    try { localStorage.setItem(storageKey, mode); } catch {}
  }, [storageKey]);

  const followIndexMap = useMemo(() => {
    if (!followOrder) return undefined;
    const map = new Map<string, number>();
    followOrder.forEach((pk, i) => map.set(pk, i));
    return map;
  }, [followOrder]);

  const processedProfiles = useMemo(() => {
    let result = [...profiles];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(event => {
        const raw = getProfileContent(event);
        const content = raw as ProfileContentData | undefined;
        const name = content?.display_name || content?.name || "";
        const nip05 = content?.nip05 || "";
        const about = content?.about || "";
        return name.toLowerCase().includes(q) || nip05.toLowerCase().includes(q) || about.toLowerCase().includes(q) || formatNpub(event.pubkey).includes(q);
      });
    }

    if (sortMode === "strong" && connectionScores) {
      result.sort((a, b) => (connectionScores.get(b.pubkey) ?? -1) - (connectionScores.get(a.pubkey) ?? -1));
    } else if (sortMode === "weak" && connectionScores) {
      result.sort((a, b) => {
        const sa = connectionScores.get(a.pubkey);
        const sb = connectionScores.get(b.pubkey);
        if (sa === undefined && sb === undefined) return 0;
        if (sa === undefined) return 1;
        if (sb === undefined) return -1;
        return sa - sb;
      });
    } else if (sortMode === "a-z") {
      result.sort((a, b) => getProfileNameLower(a).localeCompare(getProfileNameLower(b)));
    } else if (sortMode === "z-a") {
      result.sort((a, b) => getProfileNameLower(b).localeCompare(getProfileNameLower(a)));
    } else if (sortMode === "newest" && followIndexMap) {
      result.sort((a, b) => (followIndexMap.get(b.pubkey) ?? 0) - (followIndexMap.get(a.pubkey) ?? 0));
    } else if (sortMode === "oldest" && followIndexMap) {
      result.sort((a, b) => (followIndexMap.get(a.pubkey) ?? 0) - (followIndexMap.get(b.pubkey) ?? 0));
    } else if (sortMode === "newest" && !followIndexMap) {
      result.sort((a, b) => b.created_at - a.created_at);
    } else if (sortMode === "oldest" && !followIndexMap) {
      result.sort((a, b) => a.created_at - b.created_at);
    }

    if (livePubkeys && livePubkeys.size > 0) {
      const live: Event[] = [];
      const rest: Event[] = [];
      for (const p of result) {
        if (livePubkeys.has(p.pubkey)) live.push(p);
        else rest.push(p);
      }
      result = [...live, ...rest];
    }

    return result;
  }, [profiles, livePubkeys, sortMode, searchQuery, followIndexMap, connectionScores]);

  if (!loaded && profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <RelayOutpostLoader size="md" label="Loading..." />
      </div>
    );
  }
  if (loaded && profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <UsersRound className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="container-profile-people">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-3">
        <SearchPill
          containerClassName="flex-1 min-w-0 basis-full sm:basis-0"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid="input-people-search"
        />
        {profiles.length > 1 && (
          <div className="flex items-center gap-1 order-last sm:order-none w-full sm:w-auto">
            <button
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors border cursor-pointer ${
                sortMode !== "a-z" && sortMode !== "z-a"
                  ? "border-brand/30 bg-brand/10 text-brand"
                  : "border-transparent text-foreground/40 dark:text-foreground/30 hover:text-foreground/60"
              }`}
              onClick={() => handleSortChange(hasWot ? "strong" : "newest")}
            >
              All
            </button>
            <button
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors border cursor-pointer ${
                sortMode === "a-z"
                  ? "border-brand/30 bg-brand/10 text-brand"
                  : "border-transparent text-foreground/40 dark:text-foreground/30 hover:text-foreground/60"
              }`}
              onClick={() => handleSortChange(sortMode === "a-z" ? (hasWot ? "strong" : "newest") : "a-z")}
            >
              A → Z
            </button>
            <button
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors border cursor-pointer ${
                sortMode === "z-a"
                  ? "border-brand/30 bg-brand/10 text-brand"
                  : "border-transparent text-foreground/40 dark:text-foreground/30 hover:text-foreground/60"
              }`}
              onClick={() => handleSortChange(sortMode === "z-a" ? (hasWot ? "strong" : "newest") : "z-a")}
            >
              Z → A
            </button>
          </div>
        )}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors border-border/40 dark:border-border/20 text-muted-foreground hover:text-foreground bg-muted/20 dark:bg-muted/10"
            data-testid="button-people-sort"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{sortOptions.find(o => o.value === sortMode)?.label || "Sort"}</span>
          </button>
          {showSortMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
              <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border/40 dark:border-border/20 bg-card shadow-lg py-1" data-testid="menu-people-sort">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleSortChange(opt.value)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      sortMode === opt.value
                        ? "text-brand bg-brand/5 font-medium"
                        : "text-foreground hover:bg-muted/30"
                    }`}
                    data-testid={`sort-option-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {searchQuery.trim() && processedProfiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Search className="w-6 h-6 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No results for "{searchQuery}"</p>
        </div>
      ) : (() => {
        const liveCount = livePubkeys ? processedProfiles.filter(p => livePubkeys.has(p.pubkey)).length : 0;
        const renderCard = (event: Event) => {
          const raw = getProfileContent(event);
          const content = raw as ProfileContentData | undefined;
          const name = content?.display_name || content?.name || shortenNpub(formatNpub(event.pubkey));
          const avatar = content?.picture;
          const about = content?.about || "";
          const isLive = livePubkeys?.has(event.pubkey);
          const influence = connectionScores?.get(event.pubkey) ?? null;
          const scorePct = influence !== null ? Math.round(influence * 100) : null;
          const tier = influence !== null ? getSignalTier(influence) : null;
          const flagged = wotEnabled && isAuthorFlagged(event.pubkey);
          let npub = "";
          try { npub = nip19.npubEncode(event.pubkey); } catch {}

          return (
            <Link key={event.pubkey} href={`/profile/${npub}`} className="block" data-testid={`person-${event.pubkey.slice(0, 8)}`}>
              <div className={`rounded-md bg-card/70 dark:bg-muted/20 border hover-elevate ${isLive ? "border-red-500/30 dark:border-red-500/25 shadow-[0_1px_4px_rgba(239,68,68,0.1),0_0_8px_1px_rgba(239,68,68,0.08)] dark:shadow-[0_0_8px_1px_rgba(239,68,68,0.15),0_0_2px_rgba(239,68,68,0.2)]" : flagged ? "border-red-500/25 dark:border-red-500/20" : "border-brand/20 dark:border-brand/15 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_rgba(168,85,247,0.06),0_0_8px_rgba(168,85,247,0.04)] dark:shadow-[0_0_8px_rgba(168,85,247,0.08),0_0_2px_rgba(168,85,247,0.15)]"}`}>
                <div className="p-3 flex items-center gap-3">
                  <div className="relative shrink-0">
                    <Avatar className={`w-10 h-10 border shrink-0 ${isLive ? "border-red-500/40 signal-ring-live" : "border-border/60 dark:border-border"}`}>
                      <AvatarImage src={avatar} alt={name} />
                      <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                        {name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {isLive && (
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0 rounded-full bg-red-500 text-white text-[7px] font-bold uppercase tracking-wider shadow-[0_0_4px_1px_rgba(239,68,68,0.4)] live-dot border border-red-400/50">
                        LIVE
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate text-foreground">{name}</p>
                      {flagged && (
                        <TrustTierGlyph tier="flagged" size="w-4 h-4" className="drop-shadow-[0_0_4px_rgba(239,68,68,0.4)]" title="Flagged" />
                      )}
                      {scorePct !== null && tier && (
                        <span className={`shrink-0 inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-[11px] font-bold tabular-nums border shadow-sm dark:shadow-none ${getSignalTierBg(tier)} ${getSignalTierColor(tier)}`}>
                          {scorePct}
                        </span>
                      )}
                      {!flagged && scorePct === null && wotEnabled && (
                        <TrustTierGlyph tier="none" size="w-2.5 h-2.5" title="No trust signal" />
                      )}
                    </div>
                    {about && (
                      <p className="text-xs text-foreground/50 dark:text-muted-foreground truncate mt-0.5">{about}</p>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          );
        };

        return liveCount > 0 && liveCount < processedProfiles.length ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {processedProfiles.slice(0, liveCount).map(renderCard)}
            </div>
            <div className="relative py-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full h-[2px] bg-gradient-to-r from-transparent via-brand/50 dark:via-brand/40 to-transparent" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {processedProfiles.slice(liveCount).map(renderCard)}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {processedProfiles.map(renderCard)}
          </div>
        );
      })()}
      {!searchQuery.trim() && onLoadMore && hasMore !== undefined && loadingMore !== undefined && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} isLoading={loadingMore} hasMore={hasMore} />
      )}
    </div>
  );
}

const CUSTOM_RELAYS_KEY = "nostr_custom_relays";
const normalizeRelayUrl = (url: string) => url.replace(/\/+$/, "");

function getMyRelays(): Set<string> {
  const all = new Set(DEFAULT_RELAYS.map(normalizeRelayUrl));
  try {
    const stored = localStorage.getItem(CUSTOM_RELAYS_KEY);
    if (stored) {
      const custom: string[] = JSON.parse(stored);
      custom.forEach(r => all.add(normalizeRelayUrl(r)));
    }
  } catch {}
  return all;
}

function ProfileRelaysTab({ relayList, fetched }: { relayList: RelayPreference[]; fetched: boolean }) {
  const { pubkey: myPubkey } = useNostrAuth();
  const { toast } = useToast();
  const writeRelays = useMemo(() => relayList.filter(r => r.mode === "write" || r.mode === "both"), [relayList]);
  const readOnlyRelays = useMemo(() => relayList.filter(r => r.mode === "read"), [relayList]);
  const [myRelays, setMyRelays] = useState(() => getMyRelays());

  const handleAddRelay = useCallback((url: string) => {
    const normalized = normalizeRelayUrl(url);
    try {
      pool.ensureRelay(normalized).catch(() => {});
      // Promote to a full outpost so the user actually sees it in
      // Your Outposts. NIP-11 enrichment runs in the background to upgrade
      // the label and access model.
      void joinOutpostWithEnrichment(normalized, undefined, myPubkey);
      setMyRelays(prev => new Set([...prev, normalized]));
      toast({ title: "Joined outpost", description: normalized.replace("wss://", "") });
    } catch {
      toast({ title: "Failed to join outpost", variant: "destructive" });
    }
  }, [toast, myPubkey]);

  if (relayList.length === 0) {
    // Loading: a fetch is still in flight. Don't render the empty state yet —
    // that would be a false "No relay list published" before the kind-10002
    // lands. Only the resolved-and-truly-empty case shows the empty message.
    if (!fetched) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-profile-relays-loading">
          <RelayOutpostInlineLoader />
          <p className="text-xs text-muted-foreground/60 mt-2">Looking for relay list…</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-profile-relays-empty">
        <Radio className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No relay list published</p>
        <p className="text-xs text-muted-foreground/60 mt-1">This user hasn't published a NIP-65 relay list yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="container-profile-relays">
      {writeRelays.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Signal className="w-3.5 h-3.5 text-brand" />
            <span className="text-xs text-foreground/70 dark:text-muted-foreground uppercase tracking-wider font-medium">Transmitting To</span>
            <Badge variant="secondary" className="text-[10px] ml-auto">{writeRelays.length}</Badge>
          </div>
          <div className="space-y-1">
            {writeRelays.map(r => {
              const connected = myRelays.has(normalizeRelayUrl(r.url));
              return (
                <div key={r.url} className="flex items-center gap-2 px-3 py-2 rounded-md glass-card border text-sm" data-testid={`relay-write-${r.url}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-500/80 shrink-0" />
                  <span className="font-mono text-xs truncate text-foreground/80 dark:text-foreground">{r.url.replace("wss://", "")}</span>
                  {r.mode === "both" && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">read + write</Badge>
                  )}
                  <div className="ml-auto shrink-0">
                    {connected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400/80 font-medium" data-testid={`badge-connected-${r.url}`}>
                        <Check className="w-3 h-3" />
                        Connected
                      </span>
                    ) : myPubkey ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAddRelay(r.url); }}
                        className="inline-flex items-center gap-0.5 text-[10px] text-brand font-medium px-1.5 py-0.5 rounded-md bg-brand/10 hover:bg-brand/20 transition-colors cursor-pointer"
                        data-testid={`button-add-relay-${r.url}`}
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {readOnlyRelays.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Satellite className="w-3.5 h-3.5 text-brand" />
            <span className="text-xs text-foreground/70 dark:text-muted-foreground uppercase tracking-wider font-medium">Receiving From</span>
            <Badge variant="secondary" className="text-[10px] ml-auto">{readOnlyRelays.length}</Badge>
          </div>
          <div className="space-y-1">
            {readOnlyRelays.map(r => {
              const connected = myRelays.has(normalizeRelayUrl(r.url));
              return (
                <div key={r.url} className="flex items-center gap-2 px-3 py-2 rounded-md glass-card border text-sm" data-testid={`relay-read-${r.url}`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-500/80 shrink-0" />
                  <span className="font-mono text-xs truncate text-foreground/80 dark:text-foreground">{r.url.replace("wss://", "")}</span>
                  <div className="ml-auto shrink-0">
                    {connected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400/80 font-medium" data-testid={`badge-connected-${r.url}`}>
                        <Check className="w-3 h-3" />
                        Connected
                      </span>
                    ) : myPubkey ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAddRelay(r.url); }}
                        className="inline-flex items-center gap-0.5 text-[10px] text-brand font-medium px-1.5 py-0.5 rounded-md bg-brand/10 hover:bg-brand/20 transition-colors cursor-pointer"
                        data-testid={`button-add-relay-${r.url}`}
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
