import { SearchPill } from "@/components/SearchPill";
import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useSearch } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { use$ } from "applesauce-react/hooks";
import { eventStore, subscribeToFeed, DEFAULT_RELAYS, pool, publishEvent, fetchProfilesCached, throttledPoolSubscribe, verifySignedEventKind } from "@/lib/nostr";
import { isVideoUrl as sharedIsVideoUrl } from "@/lib/media-frame";
import { KIND_TEXT_NOTE, KIND_METADATA, KIND_FOLLOW_LIST, KIND_REPOST, KIND_REACTION, KIND_ZAP_REQUEST, KIND_LIVE_EVENT, LIVE_STREAM_RELAYS, getDisplayName, getAvatarUrl, getProfileContent, formatNpub, shortenNpub, parseFollowList } from "@/lib/nostr-helpers";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { peekAccountHeaderExpand, clearAccountHeaderExpand } from "@/lib/account-expand";
import { fetchUserProfileStats, fetchUserAuthoredFeed, fetchEventCounts, primalStatsCache, prefetchStatsImmediate, fetchBulkProfiles, fetchFollowersList, fetchContactListHistory, fetchMuteListHistory, type UserProfileStats } from "@/lib/primal-cache";
import { fetchRelayLists, getUserNotesFetchRelays } from "@/lib/outbox";
import { prefetchProfilesBulkFromBrainstorm } from "@/lib/brainstorm-search";
import { NostrPost } from "@/components/NostrPost";
import { BtcZapIcon } from "@/components/NostrPost";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { openCreateStudio } from "@/components/CreateStudio";
import { InviteFriend } from "@/components/InviteFriend";
import { QRCodeSVG } from "qrcode.react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Copy, Check, BadgeCheck, UsersRound, FileText, Globe, ImageIcon,
  BookOpen, Users, Radio, Pencil, X, Save, Satellite, Settings,
  Signal, Orbit, CornerUpLeft, MessageSquare, MessageCircle, RotateCcw,
  Eye, EyeOff, ArrowUpRight, ArrowDownLeft, Wallet as WalletIcon,
  Music, Zap, QrCode, ScrollText, Heart, Repeat2, Filter, ChevronDown, ChevronUp, ChevronRight,
  Upload, ShieldCheck, Search, ArrowUpDown, ExternalLink, Lock,
  Calendar, Clock, Plus, Trash2, Play, Video, Bookmark, Terminal, BarChart3, ArrowLeft, Wrench } from "lucide-react";
import { format, addDays, addWeeks, addMonths, getDay } from "date-fns";
import type { ISigner } from "applesauce-signers";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import relayOutpostBanner from "../assets/images/relay-outpost-banner.webp";
import bannerNebula from "../assets/images/banner-nebula.webp";
import bannerStation from "../assets/images/banner-station.webp";
import bannerRelayTower from "../assets/images/banner-relay-tower.webp";
import bannerNetwork from "../assets/images/banner-network.webp";
import bannerWormhole from "../assets/images/banner-wormhole.webp";
import bannerWasteland from "../assets/images/banner-outpost-wasteland.webp";
import nostrOstrich from "@assets/219719339-5eff628c-3470-4cc3-81eb-404f8902de9f_1771392554698.gif";
import amethystLogo from "@assets/amethyst-logo_1774145064312.jpg";
import nostriaLogo from "@assets/icon-128x128_1774145065737.png";

import { BrainstormIcon } from "@/components/icons/BrainstormIcon";
import { Nip05Badge } from "@/components/Nip05Badge";
import { useNip05Verified } from "@/hooks/use-nip05-verified";
import { isProfileDirty, lud16ToLnurlpUrl, isValidLnurlPayResponse, type ProfileEditSnapshot } from "@/lib/profile-editor";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { getOutpostRelays, getBadgeCustomNames, setBadgeCustomName, getBadgeDisplayName, reorderOutpostRelays, publishCommunitySubscriptions } from "@/lib/outpost-relays";
import { useHeaderIdentitySlot } from "@/hooks/use-header-identity-slot";
import { fetchNip11 } from "@/lib/nip11";

const DEFAULT_BANNERS = [
  relayOutpostBanner,
  bannerNebula,
  bannerStation,
  bannerRelayTower,
  bannerNetwork,
  bannerWormhole,
  bannerWasteland,
];

const BANNER_LQIP: Record<string, string> = {
  [relayOutpostBanner]: "data:image/webp;base64,UklGRjwAAABXRUJQVlA4IDAAAABQAwCdASogABEAP1Wcwlexq6cjsBgIAjAqiWkAADpwMRjAAAD+7lRLBuvfssJ2UAA=",
  [bannerNebula]: "data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAADwAwCdASogABEAP0mQulWwKj+jMAwD8CkJQBYdhDrwjcVzuSc61c8AAP7oy0x0XoyxCNMDoNNE3UuTeZbuBtPqvh1+k2GRh7dLYW8lwAA=",
  [bannerStation]: "data:image/webp;base64,UklGRkoAAABXRUJQVlA4ID4AAACQAwCdASogABEAP1WSv1WxqiajMAgCMCqJZwAAW+i1zMmOipSAAP7jBeFa5Qjqr40IPS7lhhXU5eOHGUgAAA==",
  [bannerRelayTower]: "data:image/webp;base64,UklGRk4AAABXRUJQVlA4IEIAAAAQAwCdASogABEAP1WYwFYxqycksAgCMCqJYwDHMCoYiwAA/uoBl3JQB8Xnkgzr/bXay1YR9n//RMbKvdcBsf/sgAA=",
  [bannerNetwork]: "data:image/webp;base64,UklGRlgAAABXRUJQVlA4IEwAAADQAwCdASogABEAP1Wax1mxqyijqAqqMCqJYwCzgBEcypHbqnlBdgAA/stNq7Lcx6xWTv2xQ4fdAOa+z5H/xVN1DOaDIp8/bJAT2AAA",
  [bannerWormhole]: "data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAACQAwCdASogABEAP02Qt1WwqjE7MAwDYCmJQBjPhTd6kOkZ5OU4AP7r+vPp/Y8vidrU9yoDKQl0YR/HC6ypaSelw7u3WLpKA87SPl9YQAA=",
  [bannerWasteland]: "data:image/webp;base64,UklGRoIAAABXRUJQVlA4IHYAAAAwBACdASofABEAPzmGuVOvKSWisAgB4CcJaQAOcAFerBFPL9QmEHafGAAA6Xi3TQYv6F4f/6a0OCJ2uGUf1BCdy96qpSI3SvhNMuXj0peo2RIPu1l4XlGuUNReAZsbJldbwXJpG1D/EkZhIrhVVQ0yptB7gAAA" };
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNWC } from "@/contexts/NWCContext";
import { MUSIC_KINDS, MUSIC_RELAYS, parseMusicEvents, fetchWavlakeTracksByNpub, fetchPodcastFromRSS, discoverPodcastFeed, isKnownPodcaster, getSavedPodcastFeed, isPodcastDisabled, savePodcastFeed, removePodcastFeed, publishPodcastFeed, fetchNostrPodcastFeed, clearNostrPodcastCache, type MusicTrack, KIND_MUSIC_TRACK } from "@/lib/music";
import { parseLiveEvent, type LiveEventData } from "@/lib/live-events";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { UploadTrackDialog } from "@/components/UploadTrackDialog";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import type { NWCTransaction } from "@/contexts/NWCContext";
import { uploadToNostrBuild, UploadError } from "@/lib/media-upload";
import { MediaSection } from "@/components/MediaSection";
import { PageTabs, TabCountLine } from "@/components/PageTabs";
import { useConnectionScores } from "@/hooks/use-graperank";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTier, getSignalTierColor, getSignalTierBg, triggerGrapeRankCalculation } from "@/lib/graperank";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { lazyRetry } from "@/lib/lazy-retry";

const KIND_LONG_FORM = 30023;
const KIND_RELAY_LIST = 10002;
const PROFILE_RELAYS = DEFAULT_RELAYS.slice(0, 5);
const PEOPLE_BATCH_SIZE = 50;

type OutpostTab = "notes" | "replies" | "articles" | "media" | "network" | "crew" | "orbit" | "relays" | "flight_log"
  | "shield" | "wallet" | "bookmarks" | "analytics" | "console";
type NetworkView = "crew" | "orbit" | "relays";
// Operator tools that live behind the "Manage" slide-over (owner-only — never
// shown on other users' profiles).
const MANAGE_TABS: OutpostTab[] = ["wallet", "bookmarks", "analytics", "console", "flight_log", "shield"];

// Consolidated utility sections — the standalone pages render embedded as tab
// bodies (lazy so their bundles only load when the section opens).
const ShieldMatrixLazy = lazy(() => lazyRetry(() => import("./ShieldMatrix")));
const WalletLazy = lazy(() => lazyRetry(() => import("./Wallet")));
const BookmarksLazy = lazy(() => lazyRetry(() => import("./Bookmarks")));
const AnalyticsDashboardLazy = lazy(() => lazyRetry(() => import("./AnalyticsDashboard")));
const EventConsoleLazy = lazy(() => lazyRetry(() => import("./EventConsole")));

function formatGrapeRankTime(isoDate: string | null): string {
  if (!isoDate) return "Unknown";
  try {
    let raw = isoDate.trim();
    if (!/[Zz]$/.test(raw) && !/[+-]\d{2}:\d{2}$/.test(raw)) raw += "Z";
    const date = new Date(raw);
    if (isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "Unknown";
  }
}

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

function extractMediaFromEvents(events: Event[]): { urls: string[]; orientationMap: Record<string, "portrait" | "landscape"> } {
  const urls: string[] = [];
  const seen = new Set<string>();
  const orientationMap: Record<string, "portrait" | "landscape"> = {};
  // Shared classifier — four copies of this regex had already drifted apart.
  const isVideoUrl = sharedIsVideoUrl;

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
      }
      if (isVideoUrl(clean)) videoUrlsInEvent.push(clean);
    }
    for (const tag of ev.tags) {
      if (tag[0] === "image" || tag[0] === "thumb" || tag[0] === "url") {
        const u = tag[1];
        if (u && !seen.has(u)) {
          seen.add(u);
          urls.push(u);
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
  return { urls, orientationMap };
}

interface RelayInfo {
  url: string;
  mode: "read" | "write" | "both";
}

function parseRelayListFromEvent(event: Event): RelayInfo[] {
  const relays: RelayInfo[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "r" && tag[1]) {
      const url = tag[1];
      if (!url.startsWith("wss://")) continue;
      const marker = tag[2];
      if (marker === "read") relays.push({ url, mode: "read" });
      else if (marker === "write") relays.push({ url, mode: "write" });
      else relays.push({ url, mode: "both" });
    }
  }
  return relays;
}

export default function MyOutpost() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  const search = useSearch();
  const { pubkey, signer, profile, follows, attemptReconnect } = useNostrAuth();
  const { livePubkeys } = useLiveStatus();
  useDocumentTitle("Account");
  const connectionScoresData = useConnectionScores(pubkey);
  const { recalculating, notifyRecalculating, wotEnabled, wotReady, setWotEnabled } = useGrapeRankScores();
  const [triggeringWot, setTriggeringWot] = useState(false);
  const [showRecalcConfirm, setShowRecalcConfirm] = useState(false);

  // Gate the (re)calculation behind a confirm — it's a heavy ~15-20 min job on
  // Brainstorm and signs an auth challenge with the user's key, so it shouldn't
  // fire on a single stray tap. The zero-follow guard runs up front so we don't
  // open the dialog for a calc that would come back empty.
  const requestRecalc = () => {
    if (!pubkey || triggeringWot || recalculating) return;
    if ((follows?.length ?? 0) === 0) {
      toast({ title: "Follow a few people first", description: "Your trust score reads your social graph. Follow at least one account, then calculate.", variant: "destructive" });
      return;
    }
    setShowRecalcConfirm(true);
  };

  // (Re)calculate the user's web of trust IN-APP — sign the auth challenge with
  // their key, trigger the calc, then let the recalc poller pick up the result.
  const handleCalculateWot = async () => {
    if (!pubkey || triggeringWot) return;
    // A trust score reads your social graph — with zero follows the calc comes
    // back empty. Nudge the user to follow someone first.
    if ((follows?.length ?? 0) === 0) {
      toast({ title: "Follow a few people first", description: "Your trust score reads your social graph. Follow at least one account, then calculate.", variant: "destructive" });
      return;
    }
    setTriggeringWot(true);
    try {
      const r = await triggerGrapeRankCalculation(pubkey);
      if (r.ok) {
        notifyRecalculating();
        toast({ title: "Calculating your web of trust…", description: "This takes a few minutes — scores update automatically when it's ready." });
      } else if (r.error === "rate_limited") {
        notifyRecalculating();
        toast({ title: "Calculation already in progress", description: "You requested one recently — results are on the way." });
      } else if (r.error === "auth") {
        toast({ title: "Couldn't start", description: "Approve the signing request with your key to calculate.", variant: "destructive" });
      } else {
        toast({ title: "Couldn't start calculation", description: "Brainstorm is unreachable right now. Please try again shortly.", variant: "destructive" });
      }
    } finally {
      setTriggeringWot(false);
    }
  };

  const [copied, setCopied] = useState(false);
  const [badgesExpanded, setBadgesExpanded] = useState(false);
  const [showLightningQR, setShowLightningQR] = useState(false);
  const [showWotInfo, setShowWotInfo] = useState(false);
  const [wotBadgeDetailed, setWotBadgeDetailed] = useState(() => {
    try { return localStorage.getItem("relay-outpost-wot-badge-detailed") === "true"; } catch { return false; }
  });
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "relay-outpost-wot-badge-detailed") {
        setWotBadgeDetailed(e.newValue === "true");
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  const [lnCopied, setLnCopied] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [hasMoreNotes, setHasMoreNotes] = useState(true);
  const [loadingMoreNotes, setLoadingMoreNotes] = useState(false);
  const notesCursorRef = useRef<number | null>(null);
  const [profileStats, setProfileStats] = useState<UserProfileStats | null>(null);
  const validTabs: OutpostTab[] = ["notes", "replies", "articles", "media", "network", "crew", "orbit", "relays", "flight_log", "shield", "wallet", "bookmarks", "analytics", "console"];
  const urlTab = new URLSearchParams(window.location.search).get("tab") as OutpostTab | null;
  // crew/orbit/relays are now sub-views of the single "Network" tab; map legacy
  // deep-links (e.g. /following -> ?tab=crew) onto it.
  const initialNetworkView: NetworkView = urlTab === "orbit" ? "orbit" : urlTab === "relays" ? "relays" : "crew";
  const initialTab: OutpostTab =
    urlTab === "crew" || urlTab === "orbit" || urlTab === "relays" ? "network"
    // Articles folded into Media as a sub-tab; keep legacy ?tab=articles links working.
    : urlTab === "articles" ? "media"
    : (urlTab && validTabs.includes(urlTab) ? urlTab : "notes");
  const [activeTab, setActiveTab] = useState<OutpostTab>(initialTab);
  const [networkView, setNetworkView] = useState<NetworkView>(initialNetworkView);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Reflect the active tab in the URL so sections deep-link and old utility
  // routes can redirect here (e.g. /wallet -> /account?tab=wallet).
  const selectTab = useCallback((id: OutpostTab) => {
    setActiveTab(id);
    try { window.history.replaceState(null, "", id === "notes" ? "/account" : `/account?tab=${id}`); } catch {}
  }, []);
  // Network sub-view keeps deep-linking to ?tab=crew|orbit|relays so old links work.
  const selectNetworkView = useCallback((v: NetworkView) => {
    setNetworkView(v);
    setActiveTab("network");
    try { window.history.replaceState(null, "", `/account?tab=${v}`); } catch {}
  }, []);
  const repostMapRef = useRef<Map<string, { pubkey: string; timestamp: number }>>(new Map());
  const [repostVersion, setRepostVersion] = useState(0);
  const [repostedEvents, setRepostedEvents] = useState<Event[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editAbout, setEditAbout] = useState("");
  const [editPicture, setEditPicture] = useState("");
  const [editBanner, setEditBanner] = useState("");
  const [editNip05, setEditNip05] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editLud16, setEditLud16] = useState("");
  // Snapshot of every editable value at the moment the editor opened. Drives the
  // dirty-aware sticky save bar and Discard (revert-to-original).
  const [editOriginal, setEditOriginal] = useState<ProfileEditSnapshot | null>(null);
  // Debounced NIP-05 for live verification — avoids a request per keystroke.
  const [debouncedNip05, setDebouncedNip05] = useState("");

  const [articles, setArticles] = useState<Event[]>([]);
  const [articlesLoaded, setArticlesLoaded] = useState(false);
  const [audioTracks, setAudioTracks] = useState<MusicTrack[]>([]);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [liveStreams, setLiveStreams] = useState<LiveEventData[]>([]);
  const [followingProfiles, setFollowingProfiles] = useState<Event[]>([]);
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [followingBatchIndex, setFollowingBatchIndex] = useState(0);
  const [loadingMoreFollowing, setLoadingMoreFollowing] = useState(false);
  const [followerProfiles, setFollowerProfiles] = useState<Event[]>([]);
  const [followersLoaded, setFollowersLoaded] = useState(false);
  const allFollowerProfilesRef = useRef<Event[]>([]);
  const [followerDisplayCount, setFollowerDisplayCount] = useState(PEOPLE_BATCH_SIZE);
  const [loadingMoreFollowers, setLoadingMoreFollowers] = useState(false);
  const [hasMoreArticles, setHasMoreArticles] = useState(true);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);
  const [relayList, setRelayList] = useState<RelayInfo[]>([]);
  const [relayListLoaded, setRelayListLoaded] = useState(false);
  const [bannerIndex, setBannerIndex] = useState(() => {
    const oldPref = localStorage.getItem("outpost-banner-pref");
    if (oldPref !== null) localStorage.removeItem("outpost-banner-pref");
    const saved = localStorage.getItem("outpost-banner-index");
    if (!saved) return -1;
    if (saved === "custom" || saved === "-1") return -1;
    const idx = parseInt(saved, 10);
    return isNaN(idx) || idx < 0 || idx >= DEFAULT_BANNERS.length ? -1 : idx;
  });

  const [walletVisible, setWalletVisible] = useState(() => {
    return localStorage.getItem("outpost-wallet-visible") === "true";
  });
  const [walletTransactions, setWalletTransactions] = useState<NWCTransaction[]>([]);
  const [walletTxLoaded, setWalletTxLoaded] = useState(false);

  const { isConnected: walletConnected, balance, balanceLoading, listTransactions, refreshBalance } = useNWC();

  useEffect(() => {
    if (!walletConnected) {
      setWalletTransactions([]);
      setWalletTxLoaded(false);
      return;
    }
    let cancelled = false;
    listTransactions(20).then(txs => {
      if (!cancelled) {
        setWalletTransactions(txs);
        setWalletTxLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setWalletTxLoaded(true);
    });
    return () => { cancelled = true; };
  }, [walletConnected, listTransactions]);

  useEffect(() => {
    if (walletConnected) refreshBalance();
  }, [walletConnected, refreshBalance]);

  const toggleWalletVisibility = useCallback(() => {
    setWalletVisible(prev => {
      const next = !prev;
      localStorage.setItem("outpost-wallet-visible", next ? "true" : "false");
      return next;
    });
  }, []);

  const hiddenKey = pubkey ? `relay-outpost-hidden-badges:${pubkey}` : null;
  const getHiddenSet = (): Set<string> => {
    try {
      if (!hiddenKey) return new Set();
      const stored = localStorage.getItem(hiddenKey);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  };
  const [hiddenUrls, setHiddenUrls] = useState<Set<string>>(getHiddenSet);
  const [badgeList, setBadgeList] = useState<{ url: string; name: string; access: "public" | "private" }[]>([]);

  useEffect(() => {
    setHiddenUrls(getHiddenSet());
  }, [hiddenKey]);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    const resolve = async () => {
      const relays = getOutpostRelays();
      if (relays.length === 0) { if (!cancelled) setBadgeList([]); return; }
      const badges = await Promise.all(
        relays.map(async (r) => {
          const doc = await fetchNip11(r.url);
          const name = doc?.name || r.label || r.url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
          return { url: r.url.replace(/\/+$/, ""), name, access: r.access };
        }),
      );
      if (!cancelled) setBadgeList(badges);
    };
    resolve();
    const handler = () => { resolve(); };
    window.addEventListener("outpost-relays-changed", handler);
    return () => { cancelled = true; window.removeEventListener("outpost-relays-changed", handler); };
  }, [pubkey]);

  const toggleHidden = useCallback((url: string) => {
    if (!hiddenKey) return;
    const next = new Set(hiddenUrls);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    localStorage.setItem(hiddenKey, JSON.stringify(Array.from(next)));
    setHiddenUrls(next);
    // Re-publish the public community list so the eye toggle actually changes
    // what appears on the profile (not just this device's own view).
    // Hiding your LAST visible outpost must clear the profile list — that is
    // exactly what this toggle means, so empty is intentional here.
    void publishCommunitySubscriptions({ allowEmpty: true });
  }, [hiddenKey, hiddenUrls]);

  const npubFull = pubkey ? formatNpub(pubkey) : "";
  const npubShort = pubkey ? shortenNpub(npubFull) : "";

  const metadataEvent = use$(() => pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined, [pubkey]);
  const followListEvent = use$(() => pubkey ? eventStore.replaceable(KIND_FOLLOW_LIST, pubkey) : undefined, [pubkey]);

  const userFollowList = useMemo(() => followListEvent ? parseFollowList(followListEvent) : [], [followListEvent]);

  const allNotes = use$(() => pubkey ? eventStore.timeline({ kinds: [KIND_TEXT_NOTE], authors: [pubkey] }) : undefined, [pubkey]);
  const notes = useMemo(() => notesLoaded ? (allNotes ?? []) : [], [allNotes, notesLoaded]);

  const originalNotes = useMemo(() => {
    const ownNotes = notes.filter((e) => {
      const eTags = e.tags.filter((t) => t[0] === "e");
      return eTags.length === 0;
    });
    const seen = new Set<string>(ownNotes.map((e) => e.id));
    const combined = [
      ...ownNotes,
      ...repostedEvents.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      }),
    ];
    combined.sort((a, b) => {
      const aTime = repostMapRef.current.get(a.id)?.timestamp ?? a.created_at;
      const bTime = repostMapRef.current.get(b.id)?.timestamp ?? b.created_at;
      return bTime - aTime;
    });
    return combined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, repostedEvents, repostVersion]);

  const replyNotes = useMemo(() => notes.filter((e) => {
    const eTags = e.tags.filter((t) => t[0] === "e");
    return eTags.length > 0;
  }), [notes]);

  const mediaExtraction = useMemo(() => extractMediaFromEvents(notes), [notes]);
  const mediaUrls = mediaExtraction.urls;
  const orientationMap = mediaExtraction.orientationMap;

  const profileContent = useMemo<ProfileContentData | null>(() => {
    if (!metadataEvent) return null;
    const raw = getProfileContent(metadataEvent);
    return raw ? (raw as ProfileContentData) : null;
  }, [metadataEvent]);

  const userBannerUrl = profileContent?.banner || null;

  const rawBannerSrc = useMemo(() => {
    if (bannerIndex === -1 && userBannerUrl) return userBannerUrl;
    const idx = bannerIndex >= 0 && bannerIndex < DEFAULT_BANNERS.length ? bannerIndex : 0;
    return DEFAULT_BANNERS[idx];
  }, [bannerIndex, userBannerUrl]);

  const activeBannerSrc = useMemo(() => {
    try {
      const u = new URL(rawBannerSrc);
      if (u.hostname === "wsrv.nl" || rawBannerSrc.startsWith("data:")) return rawBannerSrc;
      return `https://wsrv.nl/?url=${encodeURIComponent(rawBannerSrc)}&w=800&h=400&fit=cover&default=${encodeURIComponent(rawBannerSrc)}`;
    } catch {
      return rawBannerSrc;
    }
  }, [rawBannerSrc]);

  const activeLqip = BANNER_LQIP[rawBannerSrc] || null;
  const [bannerLoaded, setBannerLoaded] = useState(false);
  // Condensed-by-default header (same pattern as profiles): identity (avatar ·
  // name · Edit · ⌄) portals into the global top bar's #header-identity-slot.
  // Editing force-expands (the inline edit form lives in the expanded region).
  // The slot is tracked live because the header bar unmounts entirely on
  // desktop while the sidebar is expanded; whenever it's gone the same
  // condensed strip renders inline above the tabs instead (pre-slot layout).
  // Arriving via the Stories menu's Account entries force-expands the header
  // (explicit intent to see the account); any other arrival stays condensed.
  // Peek (not consume) in the initializer so the first paint is already
  // expanded and StrictMode's double-invoke sees a stable value; the marker
  // is cleared once on mount below.
  const [headerCollapsed, setHeaderCollapsed] = useState(() => !peekAccountHeaderExpand());
  useEffect(() => { clearAccountHeaderExpand(); }, []);
  const headerSlotEl = useHeaderIdentitySlot();
  useEffect(() => { setBannerLoaded(false); }, [activeBannerSrc]);

  const fallbackName = pubkey ? shortenNpub(formatNpub(pubkey)) : "Unknown";
  const displayName = pubkey && metadataEvent ? (getDisplayName(metadataEvent, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = metadataEvent ? getAvatarUrl(metadataEvent) : undefined;

  useEffect(() => {
    if (!pubkey) return;
    fetchUserProfileStats(pubkey).then(setProfileStats).catch(console.error);
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey) return;
    setNotesLoaded(false);
    setHasMoreNotes(true);
    notesCursorRef.current = null;
    repostMapRef.current.clear();
    setRepostedEvents([]);
    let cancelled = false;
    const timeout = setTimeout(() => setNotesLoaded(true), 10000);

    const collectedNotePubkeys: string[] = [];
    const collectedNoteIds: string[] = [];
    let oldestSeen = Infinity;
    const NOTES_BATCH = 50;

    fetchRelayLists([pubkey]);
    const notesInitialRelays = getUserNotesFetchRelays(pubkey);
    let initialDone = false;
    let topUpResolved = false;
    let topUpNotesCount = 0;
    const seenNoteIds = new Set<string>();
    const finalizeHasMore = () => {
      if (!initialDone || !topUpResolved) return;
      const total = collectedNoteIds.length + topUpNotesCount;
      if (total < NOTES_BATCH) {
        setHasMoreNotes(false);
      } else {
        setHasMoreNotes(true);
        notesCursorRef.current = oldestSeen;
      }
    };
    const notesSub = throttledPoolSubscribe(notesInitialRelays, { kinds: [KIND_TEXT_NOTE], authors: [pubkey], limit: NOTES_BATCH }, {
      onevent(event) {
        if (seenNoteIds.has(event.id)) return;
        seenNoteIds.add(event.id);
        eventStore.add(event);
        collectedNoteIds.push(event.id);
        collectedNotePubkeys.push(event.pubkey);
        if (event.created_at < oldestSeen) oldestSeen = event.created_at;
      },
      oneose() {
        notesSub.close();
        clearTimeout(timeout);
        setNotesLoaded(true);
        initialDone = true;
        finalizeHasMore();
        if (collectedNotePubkeys.length > 0) {
          fetchProfilesCached(Array.from(new Set(collectedNotePubkeys)));
        }
        if (collectedNoteIds.length > 0) {
          prefetchStatsImmediate(collectedNoteIds);
        }
      } });

    const addRepostOriginal = (original: Event, reposterPubkey: string, repostTimestamp: number) => {
      eventStore.add(original);
      const existing = repostMapRef.current.get(original.id);
      if (!existing || repostTimestamp > existing.timestamp) {
        repostMapRef.current.set(original.id, {
          pubkey: reposterPubkey,
          timestamp: repostTimestamp });
      }
    };

    const resolvedOriginals = new Map<string, Event>();
    const pendingFetchIds: { eventId: string; repostEvent: Event }[] = [];
    let fetchSubRef: { close: () => void } | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushResolved = () => {
      if (cancelled) return;
      const vals = Array.from(resolvedOriginals.values());
      if (vals.length > 0) {
        const pubkeys = vals.map(e => e.pubkey);
        fetchProfilesCached(Array.from(new Set(pubkeys)));
        prefetchStatsImmediate(vals.map(e => e.id));
        setRepostedEvents(vals);
        setRepostVersion((v) => v + 1);
      }
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushResolved();
      }, 100);
    };

    const repostSub = throttledPoolSubscribe(notesInitialRelays, { kinds: [KIND_REPOST], authors: [pubkey], limit: 30 }, {
      onevent(repostEvent) {
        let parsed = false;
        if (repostEvent.content && repostEvent.content.trim().startsWith("{")) {
          try {
            const original = JSON.parse(repostEvent.content) as Event;
            if (original && original.id && original.kind === KIND_TEXT_NOTE) {
              addRepostOriginal(original, repostEvent.pubkey, repostEvent.created_at);
              resolvedOriginals.set(original.id, original);
              parsed = true;
              scheduleFlush();
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
              resolvedOriginals.set(cached.id, cached);
              scheduleFlush();
            } else {
              pendingFetchIds.push({ eventId: eTag[1], repostEvent });
            }
          }
        }
      },
      oneose() {
        repostSub.close();
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        flushResolved();

        if (pendingFetchIds.length > 0) {
          const ids = pendingFetchIds.map((p) => p.eventId);
          const rpMap = new Map(pendingFetchIds.map((p) => [p.eventId, p.repostEvent]));
          const sub = throttledPoolSubscribe(DEFAULT_RELAYS, { kinds: [KIND_TEXT_NOTE], ids }, {
            onevent(original) {
              const rp = rpMap.get(original.id);
              if (rp) {
                addRepostOriginal(original, rp.pubkey, rp.created_at);
                resolvedOriginals.set(original.id, original);
              }
            },
            oneose() {
              sub.close();
              fetchSubRef = null;
              flushResolved();
            } });
          fetchSubRef = sub;
        }
      } });

    fetchUserAuthoredFeed(pubkey, 50).then((result) => {
      if (cancelled) return;
      const originalMap = new Map<string, Event>();
      for (const orig of result.repostOriginals) {
        originalMap.set(orig.id, orig);
      }
      for (const repost of result.reposts) {
        let originalId: string | undefined;
        let parsedOriginal: Event | undefined;
        if (repost.content && repost.content.trim().startsWith("{")) {
          try {
            const parsed = JSON.parse(repost.content) as Event;
            if (parsed && parsed.id && parsed.kind === KIND_TEXT_NOTE) {
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
          resolvedOriginals.set(parsedOriginal.id, parsedOriginal);
        } else {
          const fromMap = originalMap.get(originalId);
          if (fromMap) {
            addRepostOriginal(fromMap, repost.pubkey, repost.created_at);
            resolvedOriginals.set(fromMap.id, fromMap);
          }
        }
      }
      flushResolved();
    }).catch(() => {});

    let notesTopUpSub: { close: () => void } | null = null;
    let repostTopUpSub: { close: () => void } | null = null;
    let topUpInterval: ReturnType<typeof setInterval> | null = null;
    const topUpDeadline = Date.now() + 6000;
    const tryTopUp = () => {
      if (cancelled || notesTopUpSub) return;
      const updated = getUserNotesFetchRelays(pubkey);
      const extras = updated.filter((r) => !notesInitialRelays.includes(r));
      if (extras.length > 0) {
        notesTopUpSub = throttledPoolSubscribe(extras, { kinds: [KIND_TEXT_NOTE], authors: [pubkey], limit: NOTES_BATCH }, {
          onevent(event) {
            if (seenNoteIds.has(event.id)) return;
            seenNoteIds.add(event.id);
            eventStore.add(event);
            topUpNotesCount++;
            if (event.created_at < oldestSeen) oldestSeen = event.created_at;
          },
          oneose() {
            if (notesTopUpSub) notesTopUpSub.close();
            topUpResolved = true;
            finalizeHasMore();
          },
        });
        repostTopUpSub = throttledPoolSubscribe(extras, { kinds: [KIND_REPOST], authors: [pubkey], limit: 30 }, {
          onevent(repostEvent) {
            if (repostEvent.content && repostEvent.content.trim().startsWith("{")) {
              try {
                const original = JSON.parse(repostEvent.content) as Event;
                if (original && original.id && original.kind === KIND_TEXT_NOTE) {
                  addRepostOriginal(original, repostEvent.pubkey, repostEvent.created_at);
                  resolvedOriginals.set(original.id, original);
                  scheduleFlush();
                }
              } catch {}
            }
          },
          oneose() { if (repostTopUpSub) repostTopUpSub.close(); },
        });
        if (topUpInterval) { clearInterval(topUpInterval); topUpInterval = null; }
      } else if (Date.now() >= topUpDeadline) {
        if (topUpInterval) { clearInterval(topUpInterval); topUpInterval = null; }
        topUpResolved = true;
        finalizeHasMore();
      }
    };
    topUpInterval = setInterval(tryTopUp, 300);

    return () => {
      cancelled = true;
      notesSub.close();
      repostSub.close();
      if (fetchSubRef) { fetchSubRef.close(); fetchSubRef = null; }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      clearTimeout(timeout);
      if (topUpInterval) clearInterval(topUpInterval);
      if (notesTopUpSub) notesTopUpSub.close();
      if (repostTopUpSub) repostTopUpSub.close();
    };
  }, [pubkey]);

  const loadMoreNotes = useCallback(() => {
    if (!pubkey || loadingMoreNotes || !hasMoreNotes || !notesLoaded || notesCursorRef.current === null) return;
    setLoadingMoreNotes(true);
    const NOTES_BATCH = 50;
    const collectedIds: string[] = [];
    let oldestSeen = Infinity;

    const sub = throttledPoolSubscribe(getUserNotesFetchRelays(pubkey), {
      kinds: [KIND_TEXT_NOTE],
      authors: [pubkey],
      limit: NOTES_BATCH,
      until: notesCursorRef.current - 1 }, {
      onevent(event: Event) {
        eventStore.add(event);
        collectedIds.push(event.id);
        if (event.created_at < oldestSeen) oldestSeen = event.created_at;
      },
      oneose() {
        sub.close();
        if (collectedIds.length < NOTES_BATCH) {
          setHasMoreNotes(false);
        } else {
          notesCursorRef.current = oldestSeen;
        }
        if (collectedIds.length > 0) {
          prefetchStatsImmediate(collectedIds);
        }
        setLoadingMoreNotes(false);
      } });
  }, [pubkey, loadingMoreNotes, hasMoreNotes, notesLoaded]);

  useEffect(() => {
    if (!pubkey) return;
    setRelayListLoaded(false);
    const sub = throttledPoolSubscribe(
      ["wss://purplepag.es", ...PROFILE_RELAYS.slice(0, 3)],
      { kinds: [KIND_RELAY_LIST], authors: [pubkey] },
      {
        onevent(event: Event) {
          eventStore.add(event);
          setRelayList(parseRelayListFromEvent(event));
        },
        oneose() {
          sub.close();
          setRelayListLoaded(true);
        } }
    );
    return () => { sub.close(); };
  }, [pubkey]);

  const loadArticles = useCallback(async () => {
    if (!pubkey || articlesLoaded) return;
    try {
      const events = await pool.querySync(PROFILE_RELAYS, {
        kinds: [KIND_LONG_FORM],
        authors: [pubkey],
        limit: 30 });
      setArticles(events.sort((a, b) => b.created_at - a.created_at));
      if (events.length < 30) setHasMoreArticles(false);
    } catch (err) {
      console.error("Failed to fetch articles:", err);
    } finally {
      setArticlesLoaded(true);
    }
  }, [pubkey, articlesLoaded]);

  const loadAudio = useCallback(async () => {
    if (!pubkey || audioLoaded) return;
    try {
      const [musicEvents, liveEvents] = await Promise.all([
        pool.querySync(MUSIC_RELAYS, {
          kinds: MUSIC_KINDS,
          authors: [pubkey],
          limit: 30 }),
        pool.querySync(LIVE_STREAM_RELAYS, {
          kinds: [KIND_LIVE_EVENT],
          authors: [pubkey],
          limit: 20 }).catch(() => [] as Event[]),
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

  const podcastLoadedForRef = useRef<string>("");
  const [connectedPodcastFeed, setConnectedPodcastFeed] = useState<string | null>(null);

  useEffect(() => {
    if (pubkey) setConnectedPodcastFeed(getSavedPodcastFeed(pubkey));
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey) return;
    const website = profileContent?.website;
    const displayName = profileContent?.display_name || profileContent?.name;
    const savedFeed = connectedPodcastFeed;
    const disabled = isPodcastDisabled(pubkey);
    const shouldDiscover = !disabled && isKnownPodcaster(pubkey) && (website || displayName);
    const hasSigner = !!signer;
    const loadKey = `${pubkey}::${savedFeed || ""}::${website || ""}::${displayName || ""}::${hasSigner}`;
    if (podcastLoadedForRef.current === loadKey) return;
    podcastLoadedForRef.current = loadKey;
    (async () => {
      try {
        let feedUrl = savedFeed;
        const relayFeed = await fetchNostrPodcastFeed(pubkey);
        if (!feedUrl) {
          if (relayFeed) {
            feedUrl = relayFeed;
            savePodcastFeed(pubkey, relayFeed);
            setConnectedPodcastFeed(relayFeed);
          }
        } else if (!relayFeed && signer) {
          publishPodcastFeed(feedUrl, signer).catch(() => {});
        }
        if (!feedUrl && shouldDiscover) {
          feedUrl = await discoverPodcastFeed(website || "", displayName);
        }
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
      } catch {}
    })();
  }, [pubkey, connectedPodcastFeed, signer, profileContent?.website, profileContent?.display_name, profileContent?.name]);

  const refreshAudio = useCallback(async () => {
    if (!pubkey) return;
    try {
      const events = await pool.querySync(MUSIC_RELAYS, {
        kinds: MUSIC_KINDS,
        authors: [pubkey],
        limit: 30 });
      const musicTracks = parseMusicEvents(events);
      setAudioTracks(prev => {
        const podcastTracks = prev.filter(t => t.source === "podcast");
        return [...musicTracks, ...podcastTracks];
      });
    } catch (err) {
      console.error("Failed to refresh audio tracks:", err);
    }
  }, [pubkey]);

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
    } catch (err) {
      console.error("Failed to fetch following:", err);
    } finally {
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
      const profiles = await fetchBulkProfiles(batch);
      setFollowingProfiles(prev => {
        const existing = new Set(prev.map(e => e.pubkey));
        const unique = profiles.filter(e => !existing.has(e.pubkey));
        return [...prev, ...unique];
      });
      setFollowingBatchIndex(prev => prev + 1);
    } catch (err) {
      console.error("Failed to load more following:", err);
    } finally {
      setLoadingMoreFollowing(false);
    }
  }, [pubkey, loadingMoreFollowing, hasMoreFollowing, followingBatchIndex, userFollowList]);

  const loadFollowers = useCallback(async () => {
    if (!pubkey || followersLoaded) return;
    try {
      const { profiles } = await fetchFollowersList(pubkey, 500);
      allFollowerProfilesRef.current = profiles;
      setFollowerProfiles(profiles.slice(0, PEOPLE_BATCH_SIZE));
      setFollowerDisplayCount(PEOPLE_BATCH_SIZE);
    } catch (err) {
      console.error("Failed to fetch followers:", err);
    } finally {
      setFollowersLoaded(true);
    }
  }, [pubkey, followersLoaded]);

  const hasMoreFollowers = followerDisplayCount < allFollowerProfilesRef.current.length;

  const loadMoreFollowers = useCallback(() => {
    if (loadingMoreFollowers || !hasMoreFollowers) return;
    setLoadingMoreFollowers(true);
    const nextCount = followerDisplayCount + PEOPLE_BATCH_SIZE;
    setFollowerProfiles(allFollowerProfilesRef.current.slice(0, nextCount));
    setFollowerDisplayCount(nextCount);
    setLoadingMoreFollowers(false);
  }, [loadingMoreFollowers, hasMoreFollowers, followerDisplayCount]);

  const loadMoreArticles = useCallback(async () => {
    if (!pubkey || loadingMoreArticles || !hasMoreArticles || articles.length === 0) return;
    setLoadingMoreArticles(true);
    try {
      const oldestTimestamp = articles[articles.length - 1].created_at;
      const events = await pool.querySync(PROFILE_RELAYS, {
        kinds: [KIND_LONG_FORM],
        authors: [pubkey],
        limit: 30,
        until: oldestTimestamp - 1 });
      if (events.length < 30) setHasMoreArticles(false);
      if (events.length > 0) {
        setArticles(prev => [...prev, ...events.sort((a, b) => b.created_at - a.created_at)]);
      }
    } catch (err) {
      console.error("Failed to load more articles:", err);
    } finally {
      setLoadingMoreArticles(false);
    }
  }, [pubkey, loadingMoreArticles, hasMoreArticles, articles]);

  useEffect(() => {
    if (activeTab === "articles") loadArticles();
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

  const startEditing = () => {
    const name = profileContent?.name || "";
    const displayName = profileContent?.display_name || "";
    const about = profileContent?.about || "";
    const picture = profileContent?.picture || "";
    const banner = profileContent?.banner || "";
    const nip05 = profileContent?.nip05 || "";
    const website = profileContent?.website || "";
    const lud16 = profileContent?.lud16 || "";
    setEditName(name);
    setEditDisplayName(displayName);
    setEditAbout(about);
    setEditPicture(picture);
    setEditBanner(banner);
    setEditNip05(nip05);
    setEditWebsite(website);
    setEditLud16(lud16);
    setDebouncedNip05(nip05);
    // Capture the baseline (incl. current outpost order + hidden set) so the
    // sticky bar only appears once something actually changes.
    setEditOriginal({
      name, displayName, about, picture, banner, nip05, website, lud16,
      badgeOrder: badgeList.map(b => b.url),
      hidden: Array.from(hiddenUrls),
    });
    setEditing(true);
  };

  // Discard: revert every edited value (profile fields + outpost order/hidden)
  // back to the opening snapshot, then leave edit mode.
  const cancelEditing = () => {
    if (editOriginal) {
      setEditName(editOriginal.name);
      setEditDisplayName(editOriginal.displayName);
      setEditAbout(editOriginal.about);
      setEditPicture(editOriginal.picture);
      setEditBanner(editOriginal.banner);
      setEditNip05(editOriginal.nip05);
      setEditWebsite(editOriginal.website);
      setEditLud16(editOriginal.lud16);
      // Restore outpost ordering + hidden set (both persisted eagerly on change).
      const curOrder = badgeList.map(b => b.url);
      const orderChanged = curOrder.length !== editOriginal.badgeOrder.length
        || curOrder.some((u, i) => u !== editOriginal!.badgeOrder[i]);
      if (orderChanged) {
        const byUrl = new Map(badgeList.map(b => [b.url, b]));
        const restored = editOriginal.badgeOrder
          .map(url => byUrl.get(url))
          .filter((b): b is { url: string; name: string; access: "public" | "private" } => !!b);
        if (restored.length === badgeList.length) {
          setBadgeList(restored);
          reorderOutpostRelays(editOriginal.badgeOrder);
        }
      }
      const origHidden = new Set(editOriginal.hidden);
      const curHidden = hiddenUrls;
      const sameHidden = origHidden.size === curHidden.size && Array.from(origHidden).every(u => curHidden.has(u));
      if (!sameHidden) {
        setHiddenUrls(origHidden);
        if (hiddenKey) localStorage.setItem(hiddenKey, JSON.stringify(Array.from(origHidden)));
      }
    }
    setEditing(false);
  };

  // Live NIP-05 verification status for the debounced value (shared by the form
  // field's inline state and the preview card's verified check).
  const nip05Status = useNip05Verified(debouncedNip05 || undefined, pubkey || "");

  // Current edit state as a snapshot, for the dirty comparison.
  const currentEditSnapshot: ProfileEditSnapshot = {
    name: editName, displayName: editDisplayName, about: editAbout,
    picture: editPicture, banner: editBanner, nip05: editNip05,
    website: editWebsite, lud16: editLud16,
    badgeOrder: badgeList.map(b => b.url),
    hidden: Array.from(hiddenUrls),
  };
  const isDirty = editing && editOriginal != null && isProfileDirty(editOriginal, currentEditSnapshot);

  // Debounce editNip05 → debouncedNip05 (~500ms) while editing.
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => setDebouncedNip05(editNip05.trim()), 500);
    return () => clearTimeout(t);
  }, [editNip05, editing]);

  // React to deep-links from the sidebar account menu even when Command Post is
  // ALREADY open (so "Wallet" / "Edit profile" reliably jump to that section
  // instead of just landing on the page). Keyed on the reactive query string.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const t = params.get("tab") as OutpostTab | null;
    if (t) {
      if (t === "crew" || t === "orbit" || t === "relays") {
        const nv: NetworkView = t === "orbit" ? "orbit" : t === "relays" ? "relays" : "crew";
        if (networkView !== nv) setNetworkView(nv);
        if (activeTab !== "network") selectTab("network");
      } else {
        const resolved: OutpostTab = t === "articles" ? "media" : (validTabs.includes(t) ? t : activeTab);
        if (resolved !== activeTab) selectTab(resolved);
      }
    }
    if (params.get("edit") === "profile" && pubkey) {
      startEditing();
      params.delete("edit");
      const qs = params.toString();
      window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
    // Deep-link to open the Invite-a-friend dialog (e.g. from the sidebar menu).
    if (params.get("invite") === "1") {
      setInviteOpen(true);
      params.delete("invite");
      const qs = params.toString();
      window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, pubkey]);

  const saveProfile = async () => {
    if (!pubkey || !signer) return;
    setSaving(true);
    try {
      // Never blank a profile we just haven't loaded yet: merge onto the freshest
      // kind-0 we can get, fetching it if the local store doesn't have it.
      let baseEvent: any = metadataEvent;
      if (!baseEvent) {
        try {
          const fetched = await pool.querySync(DEFAULT_RELAYS.slice(0, 5), { kinds: [KIND_METADATA], authors: [pubkey], limit: 1 });
          if (fetched.length > 0) baseEvent = fetched[0];
        } catch {}
      }
      let existingContent: Record<string, any> = {};
      if (baseEvent) {
        try {
          const parsed = JSON.parse(baseEvent.content);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existingContent = parsed;
          }
        } catch {}
      }
      // Race guard: an existing profile exists but the edit form is empty (opened
      // before it loaded) — saving now would wipe name/about/picture. Refuse.
      const formEmpty = !editName && !editDisplayName && !editAbout && !editPicture && !editBanner && !editNip05 && !editWebsite && !editLud16;
      if (formEmpty && Object.keys(existingContent).length > 0) {
        toast({ title: "Profile still loading", description: "Your existing profile hadn't loaded yet, so nothing was changed. Reopen the editor and try again.", variant: "destructive" });
        return;
      }
      const updatedContent: Record<string, any> = {
        ...existingContent,
        name: editName || undefined,
        display_name: editDisplayName || undefined,
        about: editAbout || undefined,
        picture: editPicture || undefined,
        banner: editBanner || undefined,
        nip05: editNip05 || undefined,
        website: editWebsite || undefined,
        lud16: editLud16 || undefined };

      for (const key of Object.keys(updatedContent)) {
        if (updatedContent[key] === undefined || updatedContent[key] === "") {
          delete updatedContent[key];
        }
      }

      const event = {
        kind: KIND_METADATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(updatedContent) };

      const signed = await signWithTimeout(signer, event);
      if (!verifySignedEventKind(signed, KIND_METADATA)) {
        toast({ title: "Signer error", description: "Your signer modified the event type — profile was not updated. Please try again.", variant: "destructive" });
        return;
      }
      const success = await publishEvent(signed as Event);
      if (success) {
        setEditing(false);
        // Relay transparency: N = the user's advertised WRITE relays (NIP-65).
        const n = writeRelays.length;
        toast({
          title: n > 0 ? `Published to ${n} relay${n === 1 ? "" : "s"}` : "Profile published",
          description: n > 0
            ? "Your profile changes were broadcast to your write relays."
            : "Your profile changes were broadcast to relays.",
        });
      } else {
        toast({ title: "Broadcast failed", description: "Could not publish to relays", variant: "destructive" });
      }
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to save profile:", err);
        toast({ title: "Failed", description: "Could not update profile", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const writeRelays = relayList.filter(r => r.mode === "write" || r.mode === "both");
  const readRelays = relayList.filter(r => r.mode === "read" || r.mode === "both");

  const crewCount = profileStats?.followingCount || userFollowList.length || 0;
  const orbitCount = profileStats?.followersCount || 0;

  const crewHasLive = useMemo(() => {
    if (livePubkeys.size === 0 || userFollowList.length === 0) return false;
    return userFollowList.some(pk => livePubkeys.has(pk));
  }, [livePubkeys, userFollowList]);

  const orbitHasLive = useMemo(() => {
    if (livePubkeys.size === 0 || followerProfiles.length === 0) return false;
    return followerProfiles.some(e => livePubkeys.has(e.pubkey));
  }, [livePubkeys, followerProfiles]);

  // ONE content strip — the identity view that also renders on other profiles.
  // Same PageTabs glass-pill switcher as Profile.tsx; counts moved out of the
  // tab labels (they overflowed the row at 375px) into a muted TabCountLine at
  // the top of each tab's content.
  const contentTabs: { id: OutpostTab; label: string; icon: typeof FileText }[] = [
    { id: "notes", label: "Notes", icon: FileText },
    { id: "replies", label: "Replies", icon: CornerUpLeft },
    { id: "media", label: "Media", icon: ImageIcon },
    { id: "network", label: "Network", icon: Users },
  ];
  const tabCounts: { notes?: number; replies?: number; media?: number } = {
    notes: profileStats?.noteCount,
    replies: profileStats?.replyCount || replyNotes.length || undefined,
    media: (mediaUrls.length + audioTracks.length + (profileStats?.longFormCount || 0)) || undefined,
  };
  // Crew / Orbit / Relays collapse into the Network tab's sub-view selector.
  const networkViewDefs: { id: NetworkView; label: string; subtitle?: string; icon: typeof FileText; hasLive?: boolean }[] = [
    { id: "crew", label: "Following", icon: Users, hasLive: crewHasLive },
    { id: "orbit", label: "Followers", icon: Orbit, hasLive: orbitHasLive },
    { id: "relays", label: "Relays", icon: Radio },
  ];
  // Operator tools — tucked behind the "Manage" slide-over, grouped.
  const manageGroups: { label: string; items: { id: OutpostTab; label: string; icon: typeof FileText; desc: string }[] }[] = [
    { label: "Vault", items: [
      { id: "wallet", label: "Wallet", icon: WalletIcon, desc: "Lightning balance & zaps" },
      { id: "bookmarks", label: "Bookmarks", icon: Bookmark, desc: "Saved posts & articles" },
    ] },
    { label: "Insights", items: [
      { id: "analytics", label: "Analytics", icon: BarChart3, desc: "Engagement & reach" },
      { id: "console", label: "Console", icon: Terminal, desc: "Raw relay queries" },
      { id: "flight_log", label: "Flight Log", icon: ScrollText, desc: "Your activity log" },
    ] },
    { label: "Operations", items: [
      { id: "shield", label: "Trust & safety", icon: ShieldCheck, desc: "Web of Trust & moderation" },
    ] },
  ];
  const activeManageItem = manageGroups.flatMap(g => g.items).find(i => i.id === activeTab) || null;

  if (!pubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 py-16 text-center" data-testid="page-myoutpost-signin">
        <Satellite className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-brand uppercase tracking-wider text-foreground/80 mb-2">No Outpost Established</h2>
        <p className="text-sm text-muted-foreground/60 max-w-sm mb-6">
          Sign in to set up your outpost. Your identity, your crew, your broadcasts - all in one place.
        </p>
        <Button variant="default" className="gap-2 font-medium" asChild data-testid="button-signin-prompt">
          <Link href="/login">
            <Satellite className="w-4 h-4" />
            Establish Your Outpost
          </Link>
        </Button>
      </div>
    );
  }

  const headerCondensed = headerCollapsed && !editing;

  // Edit + expand chevron — shared by the top-bar portal strip and the inline
  // fallback strip (rendered when the top bar is unmounted, i.e. desktop with
  // the sidebar expanded).
  const stripActions = (
    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 group-data-[audio=true]:hidden">
      {/* Edit renders in the nav ONLY when collapsed — the expanded header's own
          Edit + Create cluster owns it otherwise, so the nav doesn't duplicate
          the action. Edit, not Create — the bottom nav's center button creates. */}
      {headerCollapsed && (
        <button
          type="button"
          onClick={() => { setHeaderCollapsed(false); startEditing(); }}
          className="flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold border bg-muted/70 hover:bg-muted text-foreground border-border active:scale-95 transition-[background-color,color,transform]"
          data-testid="button-edit-profile-strip"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
      )}
      {/* Expand/condense chevron — hidden on phones, where it's redundant
          (tapping the identity button toggles the same state); matches the
          profile strip so the two bars stay in lockstep. */}
      <button
        type="button"
        onClick={() => setHeaderCollapsed((c) => !c)}
        className="hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-muted/70 border border-border text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-[background-color,color,transform]"
        aria-expanded={!headerCollapsed}
        aria-label={headerCollapsed ? "Show full header" : "Condense header"}
        title={headerCollapsed ? "Show full header" : "Condense header"}
        data-testid="button-toggle-account-header"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${headerCollapsed ? "" : "rotate-180"}`} />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col relative" data-testid="page-myoutpost" data-manage-view={activeManageItem ? "" : undefined}>
      <div className="outpost-galaxy-dust dark:hidden" aria-hidden="true" />
      {/* Strip + full banner both live inside container-outpost-banner so the
          data-manage-view CSS hides them together on settings sub-pages. */}
      <div className="relative w-full" data-testid="container-outpost-banner">
        {/* Identity lives in the global top bar (portal into #header-identity-slot):
            avatar · name · +Create · ⌄ — no separate strip. Hidden on manage
            sub-pages (the old strip was CSS-hidden there) and while editing (the
            expanded editor owns the header then). Edit lives in the expanded
            header's action cluster. Audio-docked → avatar-only via group-data CSS. */}
        {headerSlotEl && !activeManageItem && !editing && createPortal(
          <div className="flex w-full items-center gap-2 min-w-0 pr-1" data-testid="container-account-strip">
            {/* The .header-identity-solid marker that used to sit here is gone
                with the menu-trigger avatar swap it existed to drive — see the
                same deletion in Profile.tsx. The bar keeps its normal solid
                surface either way; that was never this div's doing. */}
            <button
              type="button"
              onClick={() => setHeaderCollapsed((c) => !c)}
              className="flex items-center gap-2 min-w-0 flex-1 text-left"
              aria-label={headerCollapsed ? "Show full header" : "Condense header"}
              data-testid="button-header-identity"
            >
              {/* No avatar here: the mobile menu trigger (left of this slot)
                  already shows the signed-in user's avatar. It reappears in
                  audio-docked mode, where it's the only expand handle left. */}
              <Avatar className="w-7 h-7 shrink-0 border border-border hidden group-data-[audio=true]:flex">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-brand/25 text-brand text-[10px] font-bold">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-bold text-foreground truncate group-data-[audio=true]:hidden" data-testid="text-account-strip-name">
                {displayName}
              </span>
            </button>
            {stripActions}
          </div>,
          headerSlotEl,
        )}
        {/* Inline fallback strip: on desktop with the sidebar expanded the top
            bar (and its identity slot) is unmounted, so the condensed identity
            renders here instead — the pre-slot ~56px banner strip above the
            tabs. Same chevron expands the full banner/HUD/bio block below. */}
        {!headerSlotEl && headerCondensed && !activeManageItem && (
          <div className="relative h-14 w-full overflow-hidden bg-background border-b border-border" data-testid="container-account-strip">
            <div className="absolute inset-y-0 left-3 right-2 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setHeaderCollapsed(false)}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                aria-label="Show full header"
                data-testid="button-header-identity"
              >
                <Avatar className="w-8 h-8 shrink-0 border border-border">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="bg-brand/25 text-brand text-[11px] font-bold">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate" data-testid="text-account-strip-name">
                    {displayName}
                  </p>
                  {profileContent?.nip05 && pubkey && (
                    <div className="hidden min-[420px]:block">
                      <Nip05Badge nip05={profileContent.nip05} pubkey={pubkey} className="text-[10px] font-mono" textClassName="text-muted-foreground truncate" iconClassName="w-3 h-3" />
                    </div>
                  )}
                </div>
              </button>
              {stripActions}
            </div>
          </div>
        )}
        {!headerCondensed && !editing && (
          <button
            type="button"
            onClick={() => setHeaderCollapsed(true)}
            className="absolute bottom-3 right-3 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 border border-white/20 text-white/85 hover:text-white hover:bg-black/55 active:scale-95 transition-[background-color,color,transform]"
            aria-expanded
            aria-label="Condense header"
            title="Condense header"
            data-testid="button-toggle-account-header"
          >
            <ChevronDown className="w-4 h-4 rotate-180" />
          </button>
        )}
        <div
          className={`h-36 sm:h-48 md:h-56 w-full overflow-hidden ${headerCondensed ? "hidden" : ""}`}
          style={{
            backgroundColor: "hsl(260 20% 7%)",
            backgroundImage: activeLqip ? `url(${activeLqip})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center" }}
        >
          <img
            src={activeBannerSrc}
            alt="Station banner"
            className={`w-full h-full object-cover transition-opacity duration-300 ${bannerLoaded ? "opacity-100" : "opacity-0"}`}
            loading="eager"
            fetchPriority="high"
            onLoad={() => setBannerLoaded(true)}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              if (bannerIndex === -1) {
                setBannerIndex(0);
                localStorage.setItem("outpost-banner-index", "0");
              } else if (img.src !== DEFAULT_BANNERS[0]) {
                img.src = DEFAULT_BANNERS[0];
                setBannerIndex(0);
                localStorage.setItem("outpost-banner-index", "0");
              }
            }}
            data-testid="img-outpost-banner"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent dark:from-background/80 dark:via-background/20 hidden dark:block" />
          <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent dark:hidden" />
          <div
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{
              background: "linear-gradient(90deg, transparent 10%, rgba(140, 80, 220, 0.15) 30%, rgba(100, 60, 180, 0.22) 50%, rgba(140, 80, 220, 0.15) 70%, transparent 90%)" }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-[4px] pointer-events-none"
            style={{
              background: "linear-gradient(90deg, transparent 10%, rgba(140, 80, 220, 0.04) 30%, rgba(100, 60, 180, 0.07) 50%, rgba(140, 80, 220, 0.04) 70%, transparent 90%)",
              filter: "blur(2px)" }}
          />
        </div>
        <div className={`absolute top-3 right-3 z-20 items-center gap-2 ${headerCondensed ? "hidden" : "flex"}`}>
          {connectionScoresData.scores && connectionScoresData.scores.size > 0 && wotEnabled ? (
            wotBadgeDetailed ? (
              <div
                onClick={(e) => {
                  if (!(e.target instanceof HTMLAnchorElement) && !(e.target as HTMLElement).closest("a")) {
                    setShowWotInfo(true);
                  }
                }}
                className="rounded-lg overflow-hidden max-w-[300px] bg-[rgba(10,10,20,0.82)] dark:bg-[rgba(8,8,18,0.88)] backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.4)] border border-white/[0.08] cursor-pointer hover:border-white/[0.15] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <BrainstormIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5 drop-shadow-[0_0_4px_rgba(52,211,153,0.3)]" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-white/95 block leading-snug whitespace-nowrap">
                        WoT Service Provider
                      </span>
                      <p className="text-[9px] text-white/55 leading-snug">NIP-85 Declaration</p>
                      {recalculating ? (
                        <p className="text-[9px] text-brand/70 leading-snug inline-flex items-center gap-1 whitespace-nowrap">
                          <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
                          Recalculating… ~15-20 min
                        </p>
                      ) : (
                        <p className="text-[9px] text-white/45 leading-snug whitespace-nowrap">Updated {formatGrapeRankTime(connectionScoresData.lastCalculated)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[9px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 leading-none ${recalculating ? "text-brand bg-brand/10 border border-brand/20 shadow-[0_0_6px_rgba(139,92,246,0.15)]" : "text-emerald-800 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_6px_rgba(52,211,153,0.15)]"}`}>{recalculating ? "Processing" : "Active"}</span>
                    {recalculating ? (
                      <a
                        href="https://brainstorm.nosfabrica.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] font-semibold text-muted-foreground/50 hover:text-brand transition-colors"
                      >
                        View on Brainstorm
                      </a>
                    ) : (
                      <button
                        onClick={requestRecalc}
                        disabled={triggeringWot || !pubkey}
                        className="text-[9px] font-semibold text-brand hover:text-brand-strong transition-colors disabled:opacity-50"
                        data-testid="button-recalculate-wot-command"
                      >
                        {triggeringWot ? "Starting…" : "Recalculate"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/[0.06] bg-white/[0.02]">
                  <span className="text-[8px] text-white/35 uppercase tracking-wider font-semibold shrink-0">Compatible Clients</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <a href="https://amethyst.social/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 opacity-75 hover:opacity-100 transition-opacity" title="Amethyst">
                      <img src={amethystLogo} alt="Amethyst" className="w-3.5 h-3.5 rounded-sm" />
                      <span className="text-[9px] text-white/60 font-medium">Amethyst</span>
                    </a>
                    <a href="https://www.nostria.app/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 opacity-75 hover:opacity-100 transition-opacity" title="Nostria">
                      <img src={nostriaLogo} alt="Nostria" className="w-3.5 h-3.5 rounded-sm" />
                      <span className="text-[9px] text-white/60 font-medium">Nostria</span>
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowWotInfo(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-bold bg-[rgba(10,10,20,0.75)] dark:bg-[rgba(8,8,18,0.8)] backdrop-blur-xl text-white/80 hover:text-white transition-colors border border-emerald-500/25 cursor-pointer hover:border-emerald-500/40 hover:scale-105 active:scale-95 transition-transform shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
              >
                <BrainstormIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0 drop-shadow-[0_0_4px_rgba(52,211,153,0.3)]" />
                {recalculating ? (
                  <>
                    <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
                    <span className="normal-case tracking-normal text-brand/80">Processing</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)] shrink-0" />
                    WoT Active
                    <span className="normal-case tracking-normal text-white/40 hidden sm:inline">· {formatGrapeRankTime(connectionScoresData.lastCalculated)}</span>
                  </>
                )}
              </button>
            )
          ) : connectionScoresData.scores && connectionScoresData.scores.size > 0 && !wotEnabled ? (
            <button
              type="button"
              onClick={() => setShowWotInfo(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-bold bg-[rgba(10,10,20,0.75)] dark:bg-[rgba(8,8,18,0.8)] backdrop-blur-xl text-white/50 hover:text-white/80 transition-colors border border-amber-500/20 cursor-pointer hover:scale-105 active:scale-95 transition-transform shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              WoT Paused
              <span className="normal-case tracking-normal text-amber-400">· Re-enable</span>
            </button>
          ) : wotEnabled && !wotReady ? (
            // First calculation still running (new account / first sign-in):
            // honest "building" state instead of the misleading "WoT Offline".
            <button
              type="button"
              onClick={() => setShowWotInfo(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-bold bg-[rgba(10,10,20,0.75)] dark:bg-[rgba(8,8,18,0.8)] backdrop-blur-xl text-white/70 hover:text-white/90 transition-colors border border-brand/25 cursor-pointer hover:scale-105 active:scale-95 transition-transform shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
              data-testid="badge-wot-building"
            >
              <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
              <span className="normal-case tracking-normal text-brand/90">Building trust network · ~15-20 min</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowWotInfo(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-bold bg-[rgba(10,10,20,0.75)] dark:bg-[rgba(8,8,18,0.8)] backdrop-blur-xl text-white/50 hover:text-white/80 transition-colors border border-white/[0.08] cursor-pointer hover:scale-105 active:scale-95 transition-transform shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
            >
              <BrainstormIcon className="w-3.5 h-3.5 text-white/50" />
              WoT Offline
              <span className="normal-case tracking-normal text-brand">· Learn more</span>
            </button>
          )}
        </div>
      </div>

      <div className={`${editing ? "max-w-5xl" : "max-w-3xl"} mx-auto w-full px-3 sm:px-4`}>
        <div className={`flex-col sm:flex-row sm:items-end gap-3 -mt-12 sm:-mt-14 relative z-10 ${headerCondensed ? "hidden" : "flex"}`} data-testid="container-outpost-identity">
          <Avatar className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 border-2 border-brand/25 dark:border-brand/30 shadow-[0_0_16px_rgba(139,92,246,0.25),0_0_4px_rgba(139,92,246,0.15)] dark:shadow-[0_0_20px_rgba(139,92,246,0.3),0_0_6px_rgba(139,92,246,0.2)]" data-testid="avatar-outpost">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="bg-muted text-muted-foreground text-2xl font-bold">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 pb-1">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2.5 sm:gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold font-display truncate" data-testid="text-outpost-name">
                    {displayName}
                  </h1>
                </div>
                {profileContent?.nip05 && pubkey && (
                  <div className="mt-0.5" data-testid="text-outpost-nip05">
                    <Nip05Badge nip05={profileContent.nip05} pubkey={pubkey} className="text-xs font-mono" textClassName="text-primary/80 truncate" iconClassName="w-3.5 h-3.5" />
                  </div>
                )}
              </div>

              <div className="shrink-0">
                {/* When editing, the sticky bottom bar owns Save/Discard — the
                    header keeps only the entry actions, shown when not editing. */}
                {!editing && (
                  <div
                    className="flex items-center gap-1.5 flex-wrap"
                    data-testid="container-outpost-actions"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation("/tools")}
                      className="h-8 w-8 p-0 rounded-full flex items-center justify-center"
                      aria-label="Tools"
                      title="Tools"
                      data-testid="button-account-tools"
                    >
                      <Wrench className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={startEditing}
                      className="h-8 gap-1.5 rounded-full px-2.5 sm:px-3"
                      data-testid="button-edit-profile"
                    >
                      <Pencil className="w-4 h-4" /><span className="hidden sm:inline text-xs font-medium">Edit profile</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={openCreateStudio}
                      className="h-8 gap-1.5 rounded-full px-2.5 sm:px-3"
                      data-testid="button-open-create"
                    >
                      <Plus className="w-4 h-4" /><span className="hidden sm:inline text-xs font-medium">Create</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {editing ? (
          <div
            className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start pb-28"
            data-testid="container-edit-layout"
          >
            {/* Live preview: how others see your public profile card. Stacks on
                top on mobile (< lg); sticky on the right on desktop. */}
            <div className="lg:order-2 lg:sticky lg:top-4" data-testid="container-profile-preview">
              <ProfilePreviewCard
                name={editName}
                displayName={editDisplayName}
                about={editAbout}
                picture={editPicture}
                banner={editBanner}
                nip05={editNip05}
                website={editWebsite}
                lud16={editLud16}
                nip05Verified={
                  editNip05.trim().length > 0 &&
                  debouncedNip05.trim() === editNip05.trim() &&
                  nip05Status === "verified"
                }
                npubShort={npubShort}
              />
            </div>
            <div className="lg:order-1 min-w-0">
              <EditProfileForm
                editName={editName} setEditName={setEditName}
                editDisplayName={editDisplayName} setEditDisplayName={setEditDisplayName}
                editAbout={editAbout} setEditAbout={setEditAbout}
                editPicture={editPicture} setEditPicture={setEditPicture}
                editBanner={editBanner} setEditBanner={setEditBanner}
                editNip05={editNip05} setEditNip05={setEditNip05}
                editWebsite={editWebsite} setEditWebsite={setEditWebsite}
                editLud16={editLud16} setEditLud16={setEditLud16}
                nip05Status={debouncedNip05.trim() === editNip05.trim() ? nip05Status : "loading"}
                nip05HasValue={editNip05.trim().length > 0}
                badgeList={badgeList}
                hiddenUrls={hiddenUrls}
                toggleHidden={toggleHidden}
                pubkey={pubkey}
                liveStreams={liveStreams}
                setLiveStreams={setLiveStreams}
                onReorderBadges={(newList) => {
                  setBadgeList(newList);
                  reorderOutpostRelays(newList.map(b => b.url));
                }}
              />
            </div>
          </div>
        ) : (
          <div className={headerCondensed ? "hidden" : "mt-3 space-y-3"}>
            {profileContent?.about && (
              <p className="text-sm text-foreground/80 dark:text-foreground/70 whitespace-pre-wrap leading-relaxed" data-testid="text-outpost-about">
                {profileContent.about}
              </p>
            )}

            <div className="flex flex-col gap-1.5 text-xs text-foreground/60 dark:text-foreground/50" data-testid="container-outpost-meta">
              {profileContent?.website && (
                <a
                  href={profileContent.website.startsWith("http") ? profileContent.website : `https://${profileContent.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:text-foreground/80 transition-colors w-fit"
                  data-testid="link-website"
                >
                  <Globe className="w-3.5 h-3.5 shrink-0 text-brand/60" />
                  <span className="truncate">{profileContent.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                </a>
              )}
              {profileContent?.lud16 && (
                <span className="inline-flex items-center gap-2 w-fit" data-testid="text-lightning-address">
                  <BtcZapIcon className="w-3.5 h-3.5 shrink-0 text-amber-500/70" />
                  <span className="truncate">{profileContent.lud16}</span>
                </span>
              )}
              <button
                onClick={handleCopyNpub}
                className="inline-flex items-center gap-2 font-mono hover:text-foreground/80 transition-colors cursor-pointer w-fit"
                data-testid="button-copy-npub"
              >
                <img src={nostrOstrich} alt="" className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="truncate">{npubShort}</span>
                {copied ? <Check className="w-3 h-3 text-green-500 shrink-0" /> : <Copy className="w-3 h-3 opacity-50 shrink-0" />}
              </button>
              {badgeList.length > 0 && (() => {
                const visibleBadges = badgeList.filter((b) => !hiddenUrls.has(b.url));
                if (visibleBadges.length === 0) return null;
                const first = visibleBadges[0];
                const rest = visibleBadges.slice(1);
                const firstName = pubkey ? getBadgeDisplayName(pubkey, first.url, first.name) : first.name;
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
                      const displayName = pubkey ? getBadgeDisplayName(pubkey, b.url, b.name) : b.name;
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

          </div>
        )}

        {/* Focused edit mode: hide the content tabs + notes/media/network feed
            entirely so the editor + live preview stand alone. */}
        {!editing && (<>
        <div className="mt-4 min-w-0" data-testid="container-outpost-tabs">
          <PageTabs
            ariaLabel="Outpost sections"
            active={activeManageItem ? "" : activeTab}
            onChange={(key) => key === "network" ? selectNetworkView(networkView) : selectTab(key as OutpostTab)}
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
              <NotesTab notes={originalNotes} loaded={notesLoaded} repostMap={repostMapRef.current} onLoadMore={loadMoreNotes} hasMore={hasMoreNotes} loadingMore={loadingMoreNotes} />
            </>
          )}
          {activeTab === "replies" && (
            <>
              <TabCountLine count={tabCounts.replies} singular="reply" plural="replies" />
              <RepliesTab replies={replyNotes} loaded={notesLoaded} onLoadMore={loadMoreNotes} hasMore={hasMoreNotes} loadingMore={loadingMoreNotes} />
            </>
          )}
          {activeTab === "media" && (
            <TabCountLine count={tabCounts.media} singular="media post" plural="media posts" />
          )}
          {activeTab === "media" && (
            <MediaSection
              mediaUrls={mediaUrls}
              mediaLoaded={notesLoaded}
              audioTracks={audioTracks}
              audioLoaded={audioLoaded}
              isOwnProfile={true}
              articleCount={profileStats?.longFormCount}
              onArticlesOpen={loadArticles}
              articlesSlot={
                <ArticlesTab articles={articles} loaded={articlesLoaded} onLoadMore={loadMoreArticles} hasMore={hasMoreArticles} loadingMore={loadingMoreArticles} />
              }
              onLoadAudio={loadAudio}
              onRefreshAudio={refreshAudio}
              liveStreams={liveStreams}
              onLoadMore={loadMoreNotes}
              hasMore={hasMoreNotes}
              loadingMore={loadingMoreNotes}
              orientationMap={orientationMap}
              connectedPodcastFeed={connectedPodcastFeed}
              onConnectPodcast={async (feedUrl) => {
                if (!pubkey) return;
                savePodcastFeed(pubkey, feedUrl);
                setConnectedPodcastFeed(feedUrl);
                podcastLoadedForRef.current = "";
                if (signer) {
                  const ok = await publishPodcastFeed(feedUrl, signer);
                  if (ok) {
                    toast({ title: "Podcast published", description: "Your podcast feed is now visible to anyone viewing your profile." });
                  } else {
                    toast({ title: "Saved locally", description: "Podcast connected but couldn't publish to relays. Others may not see it yet.", variant: "destructive" });
                  }
                }
              }}
              onDisconnectPodcast={async () => {
                if (!pubkey) return;
                removePodcastFeed(pubkey);
                setConnectedPodcastFeed(null);
                podcastLoadedForRef.current = "";
                setAudioTracks(prev => prev.filter(t => t.source !== "podcast"));
                clearNostrPodcastCache(pubkey);
                if (signer) {
                  const ok = await publishPodcastFeed(null, signer);
                  if (!ok) {
                    toast({ title: "Disconnect issue", description: "Removed locally but couldn't update relays. Others may still see your podcast temporarily.", variant: "destructive" });
                  }
                }
              }}
            />
          )}
          {activeTab === "network" && (
            <div>
              {/* ONE-ROW invariant (like the feed pills): equal flex-1 segments
                  that truncate their labels — never wraps and never scroll-hides
                  a tab. Same PageTabs family as the feed switcher. */}
              <PageTabs
                className="mb-4"
                testId="container-network-views"
                ariaLabel="Network views"
                active={networkView}
                onChange={(key) => selectNetworkView(key as NetworkView)}
                tabs={networkViewDefs.map((v) => ({
                  key: v.id,
                  label: v.label,
                  icon: v.icon,
                  testId: `network-view-${v.id}`,
                  badge: v.hasLive ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot shrink-0" /> : undefined,
                }))}
              />
              {networkView === "crew" && (
                <PeopleTab profiles={followingProfiles} loaded={followingLoaded} emptyText="You're not following anyone yet. Follow people to build your network." onLoadMore={loadMoreFollowing} hasMore={hasMoreFollowing} loadingMore={loadingMoreFollowing} livePubkeys={livePubkeys} followOrder={userFollowList} tabKey="outpost_crew" connectionScores={connectionScoresData.scores} totalCount={userFollowList.length} />
              )}
              {networkView === "orbit" && (
                <PeopleTab profiles={followerProfiles} loaded={followersLoaded} emptyText="No followers yet. Broadcast to attract followers." onLoadMore={loadMoreFollowers} hasMore={hasMoreFollowers} loadingMore={loadingMoreFollowers} livePubkeys={livePubkeys} tabKey="outpost_orbit" connectionScores={connectionScoresData.scores} totalCount={allFollowerProfilesRef.current.length} />
              )}
              {networkView === "relays" && (
                <RelaysTab relayList={relayList} writeRelays={writeRelays} readRelays={readRelays} loaded={relayListLoaded} />
              )}
            </div>
          )}
          {activeManageItem && (
            <div data-testid="container-manage-body">
              <button
                type="button"
                onClick={() => goBack("/account/menu")}
                className="inline-flex items-center gap-1.5 mb-4 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-manage-back"
              >
                <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back
              </button>
              {activeTab === "flight_log" && pubkey && <FlightLogTab pubkey={pubkey} />}
              {activeTab !== "flight_log" && (
                <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}>
                  {activeTab === "shield" && <ShieldMatrixLazy embedded />}
                  {activeTab === "wallet" && <WalletLazy embedded />}
                  {activeTab === "bookmarks" && <BookmarksLazy embedded />}
                  {activeTab === "analytics" && <AnalyticsDashboardLazy embedded />}
                  {activeTab === "console" && <EventConsoleLazy embedded />}
                </Suspense>
              )}
            </div>
          )}
        </div>
        </>)}

      </div>

      {/* Dirty-aware sticky save bar — the single Save/Discard affordance while
          editing. Safe-area-inset aware; only visible once something changed.
          Portaled to <body> so its position:fixed anchors to the viewport and
          isn't trapped by an ancestor transform (glass/theme layers), and sits
          above the bottom nav (z-50) during the focused edit. */}
      {editing && isDirty && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-x-0 bottom-0 z-[60] border-t border-brand/20 bg-background/95 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.18)]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          data-testid="container-sticky-save-bar"
        >
          <div className="max-w-5xl mx-auto w-full px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground truncate hidden sm:block">
              Unsaved changes{writeRelays.length > 0 ? ` · will publish to ${writeRelays.length} relay${writeRelays.length === 1 ? "" : "s"}` : ""}
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={cancelEditing}
                disabled={saving}
                className="h-10 min-w-[44px] gap-1.5 font-medium"
                data-testid="button-discard-profile"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Discard
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={saveProfile}
                disabled={saving}
                className="h-10 min-w-[44px] gap-1.5 font-medium"
                data-testid="button-save-profile"
              >
                {saving ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {pubkey && <InviteFriend npub={npubFull} open={inviteOpen} onOpenChange={setInviteOpen} />}

      <AlertDialog open={showRecalcConfirm} onOpenChange={setShowRecalcConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalculate your web of trust?</AlertDialogTitle>
            <AlertDialogDescription>
              This runs a fresh calculation on Brainstorm and takes about 15-20 minutes. Your scores update automatically when it's ready — you don't need to wait here. You'll be asked to sign the request with your key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-recalc-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowRecalcConfirm(false); void handleCalculateWot(); }}
              data-testid="button-recalc-confirm"
            >
              Recalculate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showWotInfo} onOpenChange={setShowWotInfo}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm p-0 overflow-hidden border-brand/30 rounded-xl sm:rounded-lg max-h-[calc(100dvh-3rem)] overflow-y-auto">
          <div className="relative flex flex-col px-4 sm:px-5 pt-4 sm:pt-5 pb-4 sm:pb-5 glass-settings-section">
            <div className="absolute inset-0 pointer-events-none glass-settings-glow opacity-30" />
            <div className="relative space-y-3 sm:space-y-4">
              {connectionScoresData.scores && connectionScoresData.scores.size > 0 && wotEnabled ? (
                <>
                  <div className="flex items-center gap-2 pr-6">
                    <BrainstormIcon className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                    <DialogTitle className="text-sm font-bold text-foreground">Web of Trust Active</DialogTitle>
                  </div>
                  <DialogDescription className="sr-only">What Web of Trust does for your Outpost</DialogDescription>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-foreground/50 leading-snug">NIP-85 Declaration · Updated {formatGrapeRankTime(connectionScoresData.lastCalculated)}</p>
                  </div>
                  <p className="text-xs text-foreground/70 dark:text-foreground/60 leading-relaxed">
                    Your personalized trust scores are live. Here's what that unlocks:
                  </p>
                </>
              ) : connectionScoresData.scores && connectionScoresData.scores.size > 0 && !wotEnabled ? (
                <>
                  <div className="flex items-center gap-2 pr-6">
                    <BrainstormIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <DialogTitle className="text-sm font-bold text-foreground">Web of Trust Paused</DialogTitle>
                  </div>
                  <DialogDescription className="sr-only">Your Web of Trust scores are paused</DialogDescription>
                  <p className="text-xs text-foreground/70 dark:text-foreground/60 leading-relaxed">
                    Your trust scores are saved (last updated {formatGrapeRankTime(connectionScoresData.lastCalculated)}) but currently paused. Trust dots, signal checks, and spam filtering are off.
                  </p>
                  <button
                    onClick={() => { setWotEnabled(true); setShowWotInfo(false); }}
                    className="inline-flex items-center gap-2 w-full justify-center rounded-md px-3 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
                  >
                    <BrainstormIcon className="w-3.5 h-3.5 shrink-0" />
                    Re-enable Web of Trust
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 pr-6">
                    <BrainstormIcon className="w-5 h-5 text-brand shrink-0" />
                    <DialogTitle className="text-sm font-bold text-foreground">What is Web of Trust?</DialogTitle>
                  </div>
                  <DialogDescription className="sr-only">How Web of Trust enhances your Outpost</DialogDescription>
                  <p className="text-xs text-foreground/70 dark:text-foreground/60 leading-relaxed">
                    Calculate your trust scores to unlock these enhancements:
                  </p>
                </>
              )}
              <div className="space-y-2 sm:space-y-2.5">
                <div className="flex items-start gap-2 sm:gap-2.5">
                  <Filter className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground/90 dark:text-foreground/80">Smarter Feeds</p>
                    <p className="text-[10px] text-foreground/55 dark:text-foreground/45 leading-relaxed">Trusted content surfaces higher in your feeds.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 sm:gap-2.5">
                  <Search className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground/90 dark:text-foreground/80">Clearer Search</p>
                    <p className="text-[10px] text-foreground/55 dark:text-foreground/45 leading-relaxed">See trust scores on profiles so you know who's legit at a glance.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 sm:gap-2.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground/90 dark:text-foreground/80">Verified vs Unknown</p>
                    <p className="text-[10px] text-foreground/55 dark:text-foreground/45 leading-relaxed">Following and Followers show trust badges — spot who's trusted and who's unscored.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 sm:gap-2.5">
                  <Signal className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground/90 dark:text-foreground/80">Spam Protection</p>
                    <p className="text-[10px] text-foreground/55 dark:text-foreground/45 leading-relaxed">Low-trust accounts get flagged automatically. Your relay stays clean.</p>
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t border-brand/20 dark:border-brand/15 space-y-2">
                <button
                  onClick={requestRecalc}
                  disabled={triggeringWot || recalculating || !pubkey}
                  className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-brand hover:text-brand/80 dark:hover:text-brand transition-colors py-1 disabled:opacity-60"
                  data-testid="button-calculate-wot-feature"
                >
                  <BrainstormIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {recalculating
                      ? "Recalculating (~15-20 min)…"
                      : triggeringWot
                        ? "Starting…"
                        : connectionScoresData.scores && connectionScoresData.scores.size > 0
                          ? "Recalculate my scores"
                          : "Calculate my scores"}
                  </span>
                  {!recalculating && !triggeringWot && <ArrowUpRight className="w-3 h-3 shrink-0" />}
                </button>
                {connectionScoresData.scores && connectionScoresData.scores.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-foreground/35 uppercase tracking-wider font-semibold shrink-0">Also on</span>
                    <div className="flex items-center gap-2">
                      <a href="https://amethyst.social/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity" title="Amethyst">
                        <img src={amethystLogo} alt="Amethyst" className="w-3.5 h-3.5 rounded-sm" />
                        <span className="text-[10px] text-foreground/50 font-medium">Amethyst</span>
                      </a>
                      <a href="https://www.nostria.app/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity" title="Nostria">
                        <img src={nostriaLogo} alt="Nostria" className="w-3.5 h-3.5 rounded-sm" />
                        <span className="text-[10px] text-foreground/50 font-medium">Nostria</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showLightningQR} onOpenChange={setShowLightningQR}>
        <DialogContent className="sm:max-w-sm p-0 overflow-hidden border-brand/30" data-testid="dialog-lightning-qr">
          <div className="relative flex flex-col items-center px-6 pt-8 pb-6 glass-settings-section">
            <div className="absolute inset-0 pointer-events-none glass-settings-glow opacity-40" />
            <div className="relative flex flex-col items-center gap-4">
              <Avatar className="w-16 h-16 border-2 border-brand/30 dark:border-brand/40 shadow-lg shadow-brand/10 dark:shadow-brand/20">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-accent dark:bg-brand/50 text-accent-foreground dark:text-brand text-lg">
                  {(displayName || "?")[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">{displayName}</p>
                <p className="text-[11px] text-brand/50 dark:text-brand/60 mt-0.5">Scan to send sats</p>
              </div>
              {profileContent?.lud16 && (
                <>
                  <div className="bg-white p-3 rounded-lg shadow-md">
                    <QRCodeSVG
                      value={`lightning:${profileContent.lud16}`}
                      size={200}
                      data-testid="qr-outpost-lightning-address"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full max-w-[240px]">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0 rounded-md bg-accent dark:bg-white/5 border border-primary/20 px-2.5 py-1.5">
                      <Zap className="w-3 h-3 text-amber-500/70 shrink-0" />
                      <span className="text-xs font-mono text-brand/80 truncate">
                        {profileContent.lud16}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0 border-primary/20 hover:border-primary/40"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(profileContent.lud16!);
                          setLnCopied(true);
                          setTimeout(() => setLnCopied(false), 2000);
                        } catch {}
                      }}
                      data-testid="button-copy-outpost-lightning-address"
                    >
                      {lnCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Live preview of the public profile card — mirrors how MyOutpost/Profile render
// the header identity, reading straight from the edit* state so it updates as the
// user types. Kept intentionally close to the non-editing summary above.
function ProfilePreviewCard({
  name, displayName, about, picture, banner, nip05, website, lud16, nip05Verified, npubShort,
}: {
  name: string;
  displayName: string;
  about: string;
  picture: string;
  banner: string;
  nip05: string;
  website: string;
  lud16: string;
  nip05Verified: boolean;
  npubShort: string;
}) {
  const shownName = displayName || name || "Anonymous";
  const handle = name ? `@${name}` : "";
  const cleanNip05 = nip05.startsWith("_@") ? nip05.slice(2) : nip05;
  const cleanWebsite = website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className="rounded-xl border border-brand/20 dark:border-brand/15 overflow-hidden bg-card shadow-sm" data-testid="card-profile-preview">
      <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/50">Live preview</p>
      {/* Banner */}
      <div className="relative w-full h-20 bg-gradient-to-br from-brand/20 via-brand/10 to-brand/20 dark:from-brand/10 dark:via-brand/5 dark:to-brand/10">
        {banner && <img src={banner} alt="" className="w-full h-full object-cover" data-testid="preview-banner" />}
      </div>
      <div className="px-3 pb-3">
        {/* Avatar overlapping the banner */}
        <div className="-mt-8 mb-1.5">
          <Avatar className="w-16 h-16 border-2 border-background dark:border-[#0d0d2b] shadow-md" data-testid="preview-avatar">
            <AvatarImage src={picture || undefined} alt={shownName} />
            <AvatarFallback className="bg-muted text-muted-foreground text-lg font-bold">
              {shownName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="text-base font-bold font-display truncate" data-testid="preview-name">{shownName}</h3>
          {nip05Verified && <BadgeCheck className="w-4 h-4 shrink-0 text-brand" data-testid="preview-verified" />}
        </div>
        {(handle || cleanNip05) && (
          <p className="text-xs text-muted-foreground truncate" data-testid="preview-handle">
            {handle}
            {handle && cleanNip05 ? " · " : ""}
            {cleanNip05 && <span className={nip05Verified ? "text-primary/80" : "text-muted-foreground"}>{cleanNip05}</span>}
          </p>
        )}
        {about && (
          <p className="mt-2 text-xs text-foreground/80 dark:text-foreground/70 whitespace-pre-wrap leading-relaxed line-clamp-4" data-testid="preview-about">
            {about}
          </p>
        )}
        <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
          {cleanWebsite && (
            <span className="inline-flex items-center gap-1.5 min-w-0" data-testid="preview-website">
              <Globe className="w-3 h-3 shrink-0 text-brand/60" />
              <span className="truncate">{cleanWebsite}</span>
            </span>
          )}
          {lud16 && (
            <span className="inline-flex items-center gap-1.5 min-w-0" data-testid="preview-lud16">
              <BtcZapIcon className="w-3 h-3 shrink-0 text-amber-500/70" />
              <span className="truncate">{lud16}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 min-w-0 font-mono">
            <span className="truncate opacity-60">{npubShort}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function EditProfileForm({
  editName, setEditName,
  editDisplayName, setEditDisplayName,
  editAbout, setEditAbout,
  editPicture, setEditPicture,
  editBanner, setEditBanner,
  editNip05, setEditNip05,
  editWebsite, setEditWebsite,
  editLud16, setEditLud16,
  nip05Status,
  nip05HasValue,
  badgeList,
  hiddenUrls,
  toggleHidden,
  pubkey,
  liveStreams,
  setLiveStreams,
  onReorderBadges }: {
  editName: string; setEditName: (v: string) => void;
  editDisplayName: string; setEditDisplayName: (v: string) => void;
  editAbout: string; setEditAbout: (v: string) => void;
  editPicture: string; setEditPicture: (v: string) => void;
  editBanner: string; setEditBanner: (v: string) => void;
  editNip05: string; setEditNip05: (v: string) => void;
  editWebsite: string; setEditWebsite: (v: string) => void;
  editLud16: string; setEditLud16: (v: string) => void;
  nip05Status: "unknown" | "loading" | "verified" | "unverified";
  nip05HasValue: boolean;
  badgeList: { url: string; name: string; access: "public" | "private" }[];
  hiddenUrls: Set<string>;
  toggleHidden: (url: string) => void;
  pubkey: string | null;
  liveStreams: LiveEventData[];
  setLiveStreams: React.Dispatch<React.SetStateAction<LiveEventData[]>>;
  onReorderBadges: (newList: { url: string; name: string; access: "public" | "private" }[]) => void;
}) {
  const { signer } = useNostrAuth();
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [avatarUploadStatus, setAvatarUploadStatus] = useState("");
  const [bannerUploadStatus, setBannerUploadStatus] = useState("");
  // Lightning address reachability test (RESOLVE-ONLY — never calls the callback,
  // never initiates a payment). "ok" = LNURL-pay JSON with a callback resolved.
  const [lnTest, setLnTest] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  // Reset the last test result whenever the address changes.
  useEffect(() => { setLnTest("idle"); }, [editLud16]);

  const runLightningTest = useCallback(async () => {
    const url = lud16ToLnurlpUrl(editLud16);
    if (!url) { setLnTest("fail"); return; }
    setLnTest("checking");
    try {
      // Resolve pay metadata only. We read the JSON to confirm a `callback`
      // exists; we deliberately never fetch that callback or move any sats.
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) { setLnTest("fail"); return; }
      const body = await resp.json().catch(() => null);
      setLnTest(isValidLnurlPayResponse(body) ? "ok" : "fail");
    } catch {
      setLnTest("fail");
    }
  }, [editLud16]);
  const [badgeNames, setBadgeNames] = useState<Record<string, string>>(() =>
    pubkey ? getBadgeCustomNames(pubkey) : {}
  );
  useEffect(() => {
    setBadgeNames(pubkey ? getBadgeCustomNames(pubkey) : {});
  }, [pubkey]);

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const result = await uploadToNostrBuild(file, setAvatarUploadStatus, signer, { maxDimension: 512 });
      setEditPicture(result.url);
      toast({ title: "Avatar uploaded", description: "Optimized and uploaded." });
    } catch (err: any) {
      console.error("Avatar upload failed:", err);
      toast({ title: "Upload failed", description: err?.message || "Could not upload avatar.", variant: "destructive" });
    }
    setAvatarUploading(false);
    setAvatarUploadStatus("");
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }, [setEditPicture, signer, toast]);

  const handleBannerUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerUploading(true);
    try {
      const result = await uploadToNostrBuild(file, setBannerUploadStatus, signer, { maxDimension: 1920 });
      setEditBanner(result.url);
      toast({ title: "Banner uploaded", description: "Optimized and uploaded." });
    } catch (err: any) {
      console.error("Banner upload failed:", err);
      toast({ title: "Upload failed", description: err?.message || "Could not upload banner.", variant: "destructive" });
    }
    setBannerUploading(false);
    setBannerUploadStatus("");
    if (bannerInputRef.current) bannerInputRef.current.value = "";
  }, [setEditBanner, signer, toast]);

  useEffect(() => {
    if (window.innerWidth >= 640) return;
    const container = containerRef.current;
    if (!container) return;
    const handleFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 350);
      }
    };
    container.addEventListener("focusin", handleFocus);
    return () => container.removeEventListener("focusin", handleFocus);
  }, []);

  return (
    <div
      ref={containerRef}
      className="rounded-md border border-brand/30 dark:border-brand/20 overflow-visible relative glass-settings-section"
      data-testid="container-edit-profile"
    >
      <div className="absolute inset-0 rounded-md opacity-25 pointer-events-none glass-settings-glow" />
      <div className="relative p-4 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-brand/80 flex items-center gap-1.5">
          <Settings className="w-3.5 h-3.5" />
          Profile
        </h3>
        <div className="relative rounded-lg overflow-hidden border border-brand/20 dark:border-brand/15 bg-muted/30">
          <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} data-testid="input-upload-banner" />
          <div
            className="relative w-full h-24 sm:h-32 bg-gradient-to-br from-brand/20 via-brand/10 to-brand/20 dark:from-brand/10 dark:via-brand/5 dark:to-brand/10 cursor-pointer group/banner"
            onClick={() => bannerInputRef.current?.click()}
            data-testid="banner-upload-zone"
          >
            {editBanner ? (
              <img src={editBanner} alt="Banner preview" className="w-full h-full object-cover" data-testid="img-banner-preview" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-center gap-1.5 text-brand/40 group-hover/banner:text-brand-strong/70 transition-colors">
                  <ImageIcon className="w-4 h-4" />
                  <span className="text-[11px] font-medium">Add banner</span>
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover/banner:bg-black/20 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover/banner:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm rounded-full p-2">
                {bannerUploading ? <RelayOutpostInlineLoader className="w-4 h-4 text-white" /> : <Upload className="w-4 h-4 text-white" />}
              </div>
            </div>
            {editBanner && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1.5 right-1.5 h-7 w-7 bg-black/40 hover:bg-black/60 text-white/70 hover:text-white rounded-full opacity-0 group-hover/banner:opacity-100 transition-opacity z-10"
                onClick={(e) => { e.stopPropagation(); setEditBanner(""); }}
                data-testid="button-remove-banner"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          {bannerUploading && bannerUploadStatus && (
            <div className="absolute top-1.5 left-1.5 z-10">
              <span className="text-[10px] text-white/80 bg-black/50 backdrop-blur-sm rounded-full px-2 py-0.5 flex items-center gap-1">
                <ShieldCheck className="w-2.5 h-2.5" />
                {bannerUploadStatus}
              </span>
            </div>
          )}
          <div className="relative -mt-8 sm:-mt-10 px-3 pb-3">
            <div className="flex items-end gap-3">
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} data-testid="input-upload-avatar" />
              <div
                className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full border-[3px] border-background dark:border-[#0d0d2b] bg-muted shrink-0 cursor-pointer group/avatar overflow-hidden shadow-lg"
                onClick={() => avatarInputRef.current?.click()}
                data-testid="button-upload-avatar"
              >
                {editPicture ? (
                  <img src={editPicture} alt="Avatar preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand/20 to-brand/20">
                    <Upload className="w-5 h-5 text-brand/40 group-hover/avatar:text-brand-strong/70 transition-colors" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover/avatar:bg-black/30 transition-colors rounded-full flex items-center justify-center">
                  <div className="opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                    {avatarUploading ? <RelayOutpostInlineLoader className="w-4 h-4 text-white" /> : <Upload className="w-4 h-4 text-white" />}
                  </div>
                </div>
                {editPicture && (
                  <button
                    type="button"
                    className="absolute -top-0.5 -right-0.5 h-5 w-5 bg-destructive/80 hover:bg-destructive text-white rounded-full flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity z-10 shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setEditPicture(""); }}
                    data-testid="button-remove-avatar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex-1 min-w-0 pb-1">
                {avatarUploading && avatarUploadStatus && (
                  <span className="text-[10px] text-brand/60 flex items-center gap-1">
                    <ShieldCheck className="w-2.5 h-2.5" />
                    {avatarUploadStatus}
                  </span>
                )}
                {!avatarUploading && (
                  <p className="text-[10px] text-muted-foreground/40">Tap avatar or banner to change</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-brand/60 mb-1 block">Username</label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="name" className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40" style={{ fontSize: 16 }} enterKeyHint="next" autoCorrect="off" data-testid="input-edit-name" />
          </div>
          <div>
            <label className="text-xs text-brand/60 mb-1 block">Display Name</label>
            <Input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} placeholder="Display Name" className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40" style={{ fontSize: 16 }} enterKeyHint="next" autoCorrect="off" data-testid="input-edit-display-name" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-brand/60 mb-1 block">Bio</label>
            <Textarea value={editAbout} onChange={e => setEditAbout(e.target.value)} placeholder="Tell the network about yourself..." rows={3} className="resize-none bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40" style={{ fontSize: 16 }} autoComplete="off" data-testid="input-edit-about" />
          </div>
          <div>
            <label className="text-xs text-brand/60 mb-1 block">NIP-05 Verification</label>
            <Input value={editNip05} onChange={e => setEditNip05(e.target.value)} placeholder="you@domain.com" className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40" style={{ fontSize: 16 }} inputMode="email" enterKeyHint="next" autoCapitalize="off" autoCorrect="off" data-testid="input-edit-nip05" />
            {nip05HasValue && (
              <div className="mt-1 min-h-[1rem]" data-testid="status-nip05-verify">
                {nip05Status === "verified" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                    <BadgeCheck className="w-3.5 h-3.5" /> Verified
                  </span>
                ) : nip05Status === "loading" || nip05Status === "unknown" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <RelayOutpostInlineLoader className="w-3 h-3" /> Checking…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                    Not verified yet
                  </span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-brand/60 mb-1 block">Website</label>
            <Input value={editWebsite} onChange={e => setEditWebsite(e.target.value)} placeholder="https://..." className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40" style={{ fontSize: 16 }} inputMode="url" enterKeyHint="next" autoCapitalize="off" autoCorrect="off" autoComplete="off" data-testid="input-edit-website" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-brand/60 mb-1 block">Lightning Address</label>
            <div className="flex items-center gap-2">
              <Input value={editLud16} onChange={e => setEditLud16(e.target.value)} placeholder="you@walletofsatoshi.com" className="flex-1 bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40" style={{ fontSize: 16 }} inputMode="email" enterKeyHint="done" autoCapitalize="off" autoCorrect="off" data-testid="input-edit-lud16" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={runLightningTest}
                disabled={lnTest === "checking" || !editLud16.trim()}
                className="h-10 min-w-[44px] shrink-0 gap-1.5 font-medium"
                data-testid="button-test-lud16"
              >
                {lnTest === "checking" ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                Test
              </Button>
            </div>
            {lnTest !== "idle" && (
              <div className="mt-1 min-h-[1rem]" data-testid="status-lud16-test">
                {lnTest === "ok" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                    <Check className="w-3.5 h-3.5" /> Reachable
                  </span>
                ) : lnTest === "fail" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                    Couldn't reach
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <RelayOutpostInlineLoader className="w-3 h-3" /> Checking…
                  </span>
                )}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/40 mt-1">Test only checks that your address resolves — it never sends or requests any sats.</p>
          </div>
        </div>

        {badgeList.length > 0 && pubkey && (
          <div className="pt-3 border-t border-brand/15 dark:border-brand/10">
            <div className="flex items-center gap-1.5 mb-1">
              <RelayOutpostIcon className="w-3.5 h-3.5 text-brand/60" />
              <span className="text-xs font-semibold text-brand/60 uppercase tracking-wider">My Outposts</span>
              <span className="text-[10px] text-muted-foreground/40 ml-auto">
                {hiddenUrls.size > 0
                  ? `${badgeList.filter(b => !hiddenUrls.has(b.url)).length} of ${badgeList.length} shown`
                  : `${badgeList.length} joined`}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/40 dark:text-muted-foreground/30 mb-2 leading-relaxed">
              Relay communities you belong to. Reorder with arrows, rename, or use the eye icon to control which ones appear on your public profile.
            </p>
            <div className="space-y-2">
              {badgeList.map((b, idx) => {
                const isFeatured = !hiddenUrls.has(b.url);
                const AccessIcon = b.access === "private" ? Lock : Globe;
                const key = b.url.replace(/\/+$/, "").toLowerCase();
                const currentCustom = badgeNames[key] || "";
                const isFirst = idx === 0;
                const isLast = idx === badgeList.length - 1;
                return (
                  <div key={b.url} className={`flex items-center gap-2 rounded-md p-2 border transition-colors ${ isFeatured ? "border-brand/20 dark:border-brand/15 bg-brand/5" : "border-border/20 dark:border-border/10 bg-muted/20 dark:bg-muted/5 opacity-60" }`}>
                    {badgeList.length > 1 && (
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (isFirst) return;
                            const arr = [...badgeList];
                            [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                            onReorderBadges(arr);
                          }}
                          disabled={isFirst}
                          aria-label={`Move ${b.name} up`}
                          className={`p-0.5 rounded transition-colors ${isFirst ? "text-muted-foreground/15 cursor-default" : "text-muted-foreground/40 hover:text-foreground/70"}`}
                          title="Move up"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (isLast) return;
                            const arr = [...badgeList];
                            [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                            onReorderBadges(arr);
                          }}
                          disabled={isLast}
                          aria-label={`Move ${b.name} down`}
                          className={`p-0.5 rounded transition-colors ${isLast ? "text-muted-foreground/15 cursor-default" : "text-muted-foreground/40 hover:text-foreground/70"}`}
                          title="Move down"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <AccessIcon className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground/50 truncate mb-0.5">{b.name}</p>
                      <Input
                        value={currentCustom}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBadgeCustomName(pubkey!, b.url, val);
                          setBadgeNames((prev) => ({ ...prev, [key]: val }));
                        }}
                        placeholder={b.name}
                        className="h-7 bg-white/50 dark:bg-white/5 border-brand/20 dark:border-brand/15 focus-visible:border-brand/40 text-xs"
                        style={{ fontSize: 16 }}
                        autoCorrect="off"
                      />
                    </div>
                    <button
                      onClick={() => toggleHidden(b.url)}
                      className={`p-1 rounded transition-colors shrink-0 ${ isFeatured ? "text-brand/60 hover:text-brand" : "text-muted-foreground/30 hover:text-muted-foreground/60" }`}
                      title={isFeatured ? "Hide from profile" : "Show on profile"}
                    >
                      {isFeatured ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <UpcomingStreamsSection
          pubkey={pubkey}
          liveStreams={liveStreams}
          setLiveStreams={setLiveStreams}
          signer={signer}
        />

        <p className="text-[11px] text-brand/40">
          Changes are signed by your key and broadcast to relays. Your private key never leaves your signer.
        </p>
      </div>
    </div>
  );
}

function UpcomingStreamsSection({
  pubkey,
  liveStreams,
  setLiveStreams,
  signer }: {
  pubkey: string | null;
  liveStreams: LiveEventData[];
  setLiveStreams: React.Dispatch<React.SetStateAction<LiveEventData[]>>;
  signer: ISigner | null;
}) {
  type RecurrenceType = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "custom";
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingStream, setEditingStream] = useState<LiveEventData | null>(null);
  const [goLiveStream, setGoLiveStream] = useState<LiveEventData | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [streamingUrl, setStreamingUrl] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadStatus, setImageUploadStatus] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceType>("none");
  const [recurrenceCount, setRecurrenceCount] = useState(4);
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [chatEnabled, setChatEnabled] = useState(true);

  const plannedStreams = useMemo(
    () => liveStreams.filter(s => s.status === "planned").sort((a, b) => (a.starts || 0) - (b.starts || 0)),
    [liveStreams]
  );

  const resetForm = useCallback(() => {
    setTitle("");
    setSummary("");
    setImageUrl("");
    setScheduledDate("");
    setScheduledTime("");
    setStreamingUrl("");
    setEditingStream(null);
    setGoLiveStream(null);
    setShowForm(false);
    setRecurrence("none");
    setRecurrenceCount(4);
    setCustomDays([]);
    setChatEnabled(true);
  }, []);

  const startEdit = useCallback((stream: LiveEventData) => {
    setEditingStream(stream);
    setGoLiveStream(null);
    setTitle(stream.title === "Untitled Stream" ? "" : stream.title);
    setSummary(stream.summary || "");
    setImageUrl(stream.image || "");
    if (stream.starts) {
      const d = new Date(stream.starts * 1000);
      setScheduledDate(format(d, "yyyy-MM-dd"));
      setScheduledTime(format(d, "HH:mm"));
    }
    setStreamingUrl("");
    setChatEnabled(stream.chatEnabled);
    setShowForm(true);
  }, []);

  const startGoLive = useCallback((stream: LiveEventData) => {
    setGoLiveStream(stream);
    setEditingStream(null);
    setTitle(stream.title === "Untitled Stream" ? "" : stream.title);
    setSummary(stream.summary || "");
    setImageUrl(stream.image || "");
    setStreamingUrl(stream.streamUrl || "");
    setScheduledDate("");
    setScheduledTime("");
    setChatEnabled(stream.chatEnabled);
    setShowForm(true);
  }, []);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const result = await uploadToNostrBuild(file, setImageUploadStatus, signer);
      setImageUrl(result.url);
      toast({ title: "Image uploaded", description: "Stream image set." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Could not upload image.", variant: "destructive" });
    }
    setImageUploading(false);
    setImageUploadStatus("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, [signer, toast]);

  const generateRecurrenceDates = useCallback((baseDate: Date, rec: RecurrenceType, count: number, days: number[]): Date[] => {
    const dates: Date[] = [baseDate];
    if (rec === "none") return dates;

    if (rec === "custom") {
      if (days.length === 0) return dates;
      let cursor = baseDate;
      while (dates.length < count) {
        cursor = addDays(cursor, 1);
        if (days.includes(getDay(cursor))) {
          dates.push(new Date(cursor));
        }
        if (cursor.getTime() - baseDate.getTime() > 365 * 24 * 60 * 60 * 1000) break;
      }
      return dates;
    }

    for (let i = 1; i < count; i++) {
      let next: Date;
      if (rec === "daily") next = addDays(baseDate, i);
      else if (rec === "weekly") next = addWeeks(baseDate, i);
      else if (rec === "biweekly") next = addWeeks(baseDate, i * 2);
      else if (rec === "monthly") next = addMonths(baseDate, i);
      else next = addDays(baseDate, i);
      dates.push(next);
    }
    return dates;
  }, []);

  const handlePublish = useCallback(async () => {
    if (!pubkey || !signer) return;
    if (!title.trim()) {
      toast({ title: "Title required", description: "Please enter a stream title.", variant: "destructive" });
      return;
    }

    const isGoLive = !!goLiveStream;
    let startsTs: number;

    if (isGoLive) {
      if (!streamingUrl.trim()) {
        toast({ title: "Stream URL required", description: "Please enter a streaming URL to go live.", variant: "destructive" });
        return;
      }
      startsTs = Math.floor(Date.now() / 1000);
    } else {
      if (!scheduledDate || !scheduledTime) {
        toast({ title: "Date & time required", description: "Please select when the stream will start.", variant: "destructive" });
        return;
      }
      startsTs = Math.floor(new Date(`${scheduledDate}T${scheduledTime}`).getTime() / 1000);
      if (!Number.isFinite(startsTs)) {
        toast({ title: "Invalid date", description: "Please enter a valid date and time.", variant: "destructive" });
        setPublishing(false);
        return;
      }
      if (startsTs <= Math.floor(Date.now() / 1000)) {
        toast({ title: "Invalid time", description: "Scheduled time must be in the future.", variant: "destructive" });
        return;
      }
    }

    const useRecurrence = !isGoLive && !editingStream && recurrence !== "none";
    if (useRecurrence && recurrence === "custom" && customDays.length === 0) {
      toast({ title: "Select days", description: "Pick at least one day of the week for your recurring schedule.", variant: "destructive" });
      return;
    }

    setPublishing(true);
    try {
      const baseDate = new Date(startsTs * 1000);
      const allDates = useRecurrence
        ? generateRecurrenceDates(baseDate, recurrence, recurrenceCount, customDays)
        : [baseDate];

      let publishedCount = 0;
      const newParsed: LiveEventData[] = [];
      let signerFailed = false;

      for (let idx = 0; idx < allDates.length; idx++) {
        const occTs = Math.floor(allDates[idx].getTime() / 1000);
        const dTag = editingStream?.dTag || goLiveStream?.dTag || `stream-${Date.now()}-${idx}`;
        const status = isGoLive ? "live" : "planned";

        const tags: string[][] = [
          ["d", dTag],
          ["title", title.trim()],
          ["status", status],
          ["starts", String(occTs)],
          ["p", pubkey, "", "Host"],
        ];
        if (summary.trim()) tags.push(["summary", summary.trim()]);
        if (imageUrl.trim()) tags.push(["image", imageUrl.trim()]);
        if (isGoLive && streamingUrl.trim()) tags.push(["streaming", streamingUrl.trim()]);
        tags.push(["chat", chatEnabled ? "enabled" : "disabled"]);

        const eventTemplate = {
          kind: KIND_LIVE_EVENT,
          created_at: Math.floor(Date.now() / 1000) + idx,
          tags,
          content: "" };

        const signed = await signWithTimeout(signer, eventTemplate);
        if (!verifySignedEventKind(signed, KIND_LIVE_EVENT)) {
          signerFailed = true;
          break;
        }

        const success = await publishEvent(signed as Event, LIVE_STREAM_RELAYS);
        if (success) {
          publishedCount++;
          const parsed = parseLiveEvent(signed as Event);
          if (parsed) newParsed.push(parsed);
        }
      }

      if (newParsed.length > 0) {
        setLiveStreams(prev => {
          const existingDTags = new Set(newParsed.map(p => p.dTag));
          const filtered = prev.filter(s => !existingDTags.has(s.dTag));
          return [...filtered, ...newParsed].sort((a, b) => b.event.created_at - a.event.created_at);
        });
        if (isGoLive) {
          toast({ title: "You're live!", description: `"${title.trim()}" is now live.` });
        } else if (publishedCount === 1) {
          toast({
            title: "Stream scheduled",
            description: `"${title.trim()}" scheduled for ${format(allDates[0], "MMM d 'at' h:mm a")}.` });
        } else {
          toast({
            title: `${publishedCount} streams scheduled`,
            description: `"${title.trim()}" — ${publishedCount} upcoming dates created.` });
        }
        resetForm();
      }

      if (signerFailed) {
        toast({
          title: publishedCount > 0 ? "Signer error (partial)" : "Signer error",
          description: publishedCount > 0
            ? `${publishedCount} streams published before your signer modified an event. Please try again for remaining dates.`
            : "Your signer modified the event type. Please try again.",
          variant: "destructive" });
      } else if (publishedCount === 0) {
        toast({ title: "Publish failed", description: "Could not broadcast to relays.", variant: "destructive" });
      }
    } catch (err: any) {
      console.error("Failed to publish stream event:", err);
      toast({ title: "Failed", description: err?.message || "Could not publish stream event.", variant: "destructive" });
    }
    setPublishing(false);
  }, [pubkey, signer, title, summary, imageUrl, scheduledDate, scheduledTime, streamingUrl, editingStream, goLiveStream, toast, resetForm, setLiveStreams, recurrence, recurrenceCount, customDays, generateRecurrenceDates, chatEnabled]);

  const handleCancel = useCallback(async (stream: LiveEventData) => {
    if (!signer) return;
    setPublishing(true);
    try {
      const deleteEvent = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", stream.event.id],
          ["a", `${KIND_LIVE_EVENT}:${stream.pubkey}:${stream.dTag}`],
        ],
        content: "Stream cancelled" };
      const signed = await signWithTimeout(signer, deleteEvent);
      const success = await publishEvent(signed as Event, LIVE_STREAM_RELAYS);
      if (success) {
        setLiveStreams(prev => prev.filter(s => s.dTag !== stream.dTag));
        toast({ title: "Stream cancelled", description: `"${stream.title}" has been removed.` });
      } else {
        toast({ title: "Failed", description: "Could not cancel stream.", variant: "destructive" });
      }
    } catch (err: any) {
      console.error("Failed to cancel stream:", err);
      toast({ title: "Failed", description: err?.message || "Could not cancel stream.", variant: "destructive" });
    }
    setPublishing(false);
  }, [signer, toast, setLiveStreams]);

  return (
    <div className="pt-3 border-t border-brand/15 dark:border-brand/10">
      <div className="flex items-center gap-1.5 mb-1">
        <Calendar className="w-3.5 h-3.5 text-brand/60" />
        <span className="text-xs font-semibold text-brand/60 uppercase tracking-wider">Upcoming Streams</span>
        <span className="text-[10px] text-muted-foreground/40 ml-auto">
          {plannedStreams.length > 0 ? `${plannedStreams.length} scheduled` : "none scheduled"}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground/40 dark:text-muted-foreground/30 mb-2 leading-relaxed">
        Schedule upcoming streams so your audience knows when you'll be live.
      </p>

      {plannedStreams.length > 0 && (
        <div className="space-y-2 mb-3">
          {plannedStreams.map(stream => {
            const scheduledTs = stream.starts || stream.event.created_at;
            const scheduledDate = new Date(scheduledTs * 1000);
            const isPast = scheduledTs < Math.floor(Date.now() / 1000);
            return (
              <div key={stream.dTag} className="flex items-center gap-2 rounded-md p-2 border border-brand/20 dark:border-brand/15 bg-brand/5">
                {stream.image && (
                  <div className="w-10 h-10 rounded overflow-hidden border border-primary/20 shrink-0 bg-muted">
                    <img src={stream.image} alt={`${stream.title} stream thumbnail`} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground/80 truncate">{stream.title}</p>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{format(scheduledDate, "MMM d, yyyy 'at' h:mm a")}</span>
                    {isPast && <span className="text-amber-500/70 ml-1">(past due)</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => startGoLive(stream)}
                    className="p-1 rounded text-green-600/60 dark:text-green-400/60 hover:text-green-700 dark:hover:text-green-300 transition-colors"
                    title="Go Live"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(stream)}
                    className="p-1 rounded text-brand/60 hover:text-brand transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancel(stream)}
                    disabled={publishing}
                    className="p-1 rounded text-red-500/50 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    title="Cancel stream"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm ? (
        <div className="space-y-2 p-2 rounded-md border border-brand/20 dark:border-brand/10 bg-brand/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-brand/70">
              {goLiveStream ? "Go Live" : editingStream ? "Edit Stream" : "Schedule a Stream"}
            </span>
            <button type="button" onClick={resetForm} className="p-0.5 text-muted-foreground/40 hover:text-foreground/60">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div>
            <label className="text-xs text-brand/60 mb-1 block">Title *</label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Stream title"
              className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40"
              style={{ fontSize: 16 }}
              autoCorrect="off"
            />
          </div>
          <div>
            <label className="text-xs text-brand/60 mb-1 block">Description</label>
            <Textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="What will you be streaming?"
              rows={2}
              className="resize-none bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40"
              style={{ fontSize: 16 }}
            />
          </div>
          <div>
            <label className="text-xs text-brand/60 mb-1 block">Image</label>
            <div className="flex items-center gap-2">
              {imageUrl && (
                <div className="w-10 h-10 rounded overflow-hidden border border-primary/20 shrink-0 bg-muted">
                  <img src={imageUrl} alt="Stream image preview" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex gap-1.5">
                  <Input
                    value={imageUrl}
                    onChange={e => setImageUrl(e.target.value)}
                    placeholder="https://... or upload"
                    className="flex-1 bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40"
                    style={{ fontSize: 16 }}
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 border-brand/25 dark:border-brand/20 hover:border-brand/40"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={imageUploading}
                  >
                    {imageUploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  </Button>
                </div>
                {imageUploading && imageUploadStatus && (
                  <span className="text-[10px] text-brand/60 flex items-center gap-1 mt-1">
                    <ShieldCheck className="w-2.5 h-2.5" />
                    {imageUploadStatus}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-3.5 h-3.5 text-brand/50" />
              <label className="text-xs text-brand/60">Enable live chat</label>
            </div>
            <button
              type="button"
              onClick={() => setChatEnabled(prev => !prev)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                chatEnabled
                  ? "bg-primary"
                  : "bg-muted-foreground/20"
              }`}
              aria-pressed={chatEnabled}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                chatEnabled ? "translate-x-4" : "translate-x-0"
              }`} />
            </button>
          </div>

          {goLiveStream ? (
            <div>
              <label className="text-xs text-brand/60 mb-1 block">Streaming URL *</label>
              <Input
                value={streamingUrl}
                onChange={e => setStreamingUrl(e.target.value)}
                placeholder="https://... (HLS, RTMP, etc.)"
                className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40"
                style={{ fontSize: 16 }}
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand/60 mb-1 block">Date *</label>
                  <Input
                    type="date"
                    value={scheduledDate}
                    onChange={e => setScheduledDate(e.target.value)}
                    min={format(new Date(), "yyyy-MM-dd")}
                    className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40"
                    style={{ fontSize: 16 }}
                  />
                </div>
                <div>
                  <label className="text-xs text-brand/60 mb-1 block">Time *</label>
                  <Input
                    type="time"
                    value={scheduledTime}
                    onChange={e => setScheduledTime(e.target.value)}
                    className="bg-white/50 dark:bg-white/5 border-brand/25 dark:border-brand/20 focus-visible:border-brand/40"
                    style={{ fontSize: 16 }}
                  />
                </div>
              </div>

              {!editingStream && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <Repeat2 className="w-3.5 h-3.5 text-brand/50" />
                    <label className="text-xs text-brand/60">Repeat</label>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {([
                      ["none", "Once"],
                      ["daily", "Daily"],
                      ["weekly", "Weekly"],
                      ["biweekly", "Every 2 weeks"],
                      ["monthly", "Monthly"],
                      ["custom", "Custom days"],
                    ] as [RecurrenceType, string][]).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setRecurrence(val);
                          if (val === "custom" && customDays.length === 0 && scheduledDate) {
                            const dayIdx = getDay(new Date(`${scheduledDate}T12:00`));
                            setCustomDays([dayIdx]);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${ recurrence === val ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-brand/15 dark:border-brand/10 text-muted-foreground/50 hover:text-muted-foreground/70 hover:border-brand/25" }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {recurrence === "custom" && (
                    <div className="flex flex-wrap gap-1 pl-0.5">
                      {DAY_LABELS.map((day, idx) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            setCustomDays(prev =>
                              prev.includes(idx)
                                ? prev.filter(d => d !== idx)
                                : [...prev, idx].sort()
                            );
                          }}
                          className={`w-9 h-7 rounded text-[10px] font-semibold transition-colors border ${ customDays.includes(idx) ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-brand/10 text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-brand/20" }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  )}

                  {recurrence !== "none" && (
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted-foreground/50 shrink-0">Create</label>
                      <select
                        value={recurrenceCount}
                        onChange={e => setRecurrenceCount(Number(e.target.value))}
                        className="text-xs rounded-md border border-brand/20 dark:border-brand/15 bg-white/50 dark:bg-white/5 text-foreground/80 px-2 py-1"
                        style={{ fontSize: 16 }}
                      >
                        {[2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 26, 52].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <span className="text-[11px] text-muted-foreground/50">
                        {recurrence === "custom"
                          ? "occurrences"
                          : recurrence === "daily" ? "days" : recurrence === "weekly" ? "weeks" : recurrence === "biweekly" ? "sessions (every 2 weeks)" : "months"}
                      </span>
                    </div>
                  )}

                  {recurrence !== "none" && scheduledDate && scheduledTime && (
                    <div className="text-[10px] text-brand/60 dark:text-brand/40 bg-brand/5 rounded-md px-2 py-1.5 leading-relaxed">
                      {(() => {
                        const base = new Date(`${scheduledDate}T${scheduledTime}`);
                        if (isNaN(base.getTime())) return null;
                        const dates = generateRecurrenceDates(base, recurrence, recurrenceCount, customDays);
                        return (
                          <>
                            <span className="font-medium">{dates.length} streams</span> will be created:
                            <span className="block mt-0.5">
                              {dates.slice(0, 5).map((d, i) => format(d, "EEE, MMM d")).join(" · ")}
                              {dates.length > 5 && ` · +${dates.length - 5} more`}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <Button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !signer}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {publishing ? (
              <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
            ) : goLiveStream ? (
              <Video className="w-4 h-4 mr-2" />
            ) : (
              <Calendar className="w-4 h-4 mr-2" />
            )}
            {publishing ? "Publishing..." : goLiveStream ? "Go Live Now" : editingStream ? "Update Stream" : recurrence !== "none" ? `Schedule ${recurrenceCount} Streams` : "Schedule Stream"}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { resetForm(); setShowForm(true); }}
          className="w-full border-brand/20 dark:border-brand/15 hover:border-brand/40 text-brand/70 dark:text-brand/60"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Schedule a Stream
        </Button>
      )}
    </div>
  );
}


function NotesTab({ notes, loaded, repostMap, onLoadMore, hasMore, loadingMore }: { notes: Event[]; loaded: boolean; repostMap?: Map<string, { pubkey: string; timestamp: number }>; onLoadMore?: () => void; hasMore?: boolean; loadingMore?: boolean }) {
  if (!loaded && notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12" data-testid="container-loading-notes">
        <RelayOutpostLoader size="md" label="Loading broadcasts..." />
      </div>
    );
  }
  if (loaded && notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-no-notes">
        <Signal className="w-8 h-8 text-foreground/30 dark:text-foreground/20 mb-2" />
        <p className="text-sm text-foreground/60 dark:text-foreground/50 font-medium">No broadcasts yet</p>
        <p className="text-xs text-foreground/40 dark:text-foreground/30 mt-1">Create your first post to start transmitting</p>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="container-outpost-notes">
      {notes.map((event) => (
        <NostrPost key={event.id} event={event} repostedBy={repostMap?.get(event.id) || null} />
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
        <CornerUpLeft className="w-8 h-8 text-foreground/30 dark:text-foreground/20 mb-2" />
        <p className="text-sm text-foreground/60 dark:text-foreground/50 font-medium">No replies yet</p>
        <p className="text-xs text-foreground/40 dark:text-foreground/30 mt-1">Join conversations to see your replies here</p>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="container-outpost-replies">
      {replies.map((event) => (
        <NostrPost key={event.id} event={event} />
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
        <BookOpen className="w-8 h-8 text-foreground/30 dark:text-foreground/20 mb-2" />
        <p className="text-sm text-foreground/60 dark:text-foreground/50 font-medium">No articles published yet</p>
        <Button variant="outline" size="sm" className="mt-3 gap-1.5 font-medium" asChild>
          <Link href="/articles/write">
            <Pencil className="w-3.5 h-3.5" />
            Write Your First Article
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="container-outpost-articles">
      {articles.map((article) => {
        const title = article.tags.find(t => t[0] === "title")?.[1] || "Untitled";
        const summary = article.tags.find(t => t[0] === "summary")?.[1] || "";
        const image = article.tags.find(t => t[0] === "image")?.[1];
        const dTag = article.tags.find(t => t[0] === "d")?.[1] || "";
        const publishedAt = article.tags.find(t => t[0] === "published_at")?.[1];
        const hashtags = article.tags.filter(t => t[0] === "t").map(t => t[1]);
        const date = publishedAt ? new Date(parseInt(publishedAt) * 1000) : new Date(article.created_at * 1000);

        let naddr = "";
        try {
          naddr = nip19.naddrEncode({
            identifier: dTag,
            pubkey: article.pubkey,
            kind: KIND_LONG_FORM });
        } catch {}

        return (
          <Link key={article.id} href={`/articles/${naddr}`} className="block" data-testid={`article-${article.id.slice(0, 8)}`}>
            <div className="glass-card rounded-md hover-elevate">
              <div className="p-3 sm:p-4">
                <div className="flex gap-3">
                  {image && (
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-md overflow-hidden shrink-0 bg-muted">
                      <img src={image} alt={title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold line-clamp-2">{title}</h3>
                    {summary && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{summary}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[11px] text-muted-foreground/80">
                        {date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      {hashtags.slice(0, 3).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[11px]">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
      {onLoadMore && hasMore !== undefined && loadingMore !== undefined && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} isLoading={loadingMore} hasMore={hasMore} />
      )}
    </div>
  );
}


type PeopleSortMode = "a-z" | "z-a" | "newest" | "oldest" | "strong" | "weak";
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

function getProfileName(event: Event): string {
  const raw = getProfileContent(event);
  const content = raw as ProfileContentData | undefined;
  return (content?.display_name || content?.name || shortenNpub(formatNpub(event.pubkey))).toLowerCase();
}

function PeopleTab({ profiles, loaded, emptyText, onLoadMore, hasMore, loadingMore, livePubkeys, followOrder, tabKey, connectionScores, totalCount }: { profiles: Event[]; loaded: boolean; emptyText: string; onLoadMore?: () => void; hasMore?: boolean; loadingMore?: boolean; livePubkeys?: Set<string>; followOrder?: string[]; tabKey?: string; connectionScores?: Map<string, number> | null; totalCount?: number }) {
  const { wotEnabled } = useGrapeRankScores();
  const hasWot = !!(wotEnabled && connectionScores && connectionScores.size > 0);
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
      result.sort((a, b) => getProfileName(a).localeCompare(getProfileName(b)));
    } else if (sortMode === "z-a") {
      result.sort((a, b) => getProfileName(b).localeCompare(getProfileName(a)));
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

  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <RelayOutpostLoader size="md" label="Loading..." />
      </div>
    );
  }
  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <UsersRound className="w-8 h-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="container-outpost-people">
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
              <div className="fixed inset-0 z-40 sm:bg-transparent bg-black/30" onClick={() => setShowSortMenu(false)} />
              <div className="fixed sm:absolute left-0 right-0 bottom-0 sm:left-auto sm:right-0 sm:bottom-auto sm:top-full sm:mt-1 z-50 sm:min-w-[140px] sm:w-auto rounded-t-xl sm:rounded-t-md sm:rounded-b-md border border-border/40 dark:border-border/20 bg-card shadow-lg py-1 sm:py-1" data-testid="menu-people-sort">
                <div className="sm:hidden relative border-b border-border/20">
                  {/* Grab handle doubles as tap-to-close; the ✕ is the explicit escape. */}
                  <button
                    type="button"
                    onClick={() => setShowSortMenu(false)}
                    className="flex w-full items-center justify-center py-3"
                    aria-label="Close sort menu"
                    data-testid="button-close-people-sort"
                  >
                    <span className="w-8 h-1 rounded-full bg-muted-foreground/20" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSortMenu(false)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground/60 active:bg-muted/40 transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleSortChange(opt.value)}
                    className={`w-full text-left px-4 sm:px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs transition-colors ${
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
          let npub = "";
          try { npub = nip19.npubEncode(event.pubkey); } catch {}

          return (
            <Link key={event.pubkey} href={`/profile/${npub}`} className="block" data-testid={`person-${event.pubkey.slice(0, 8)}`}>
              <div className={`rounded-md bg-white/70 dark:bg-muted/20 border hover-elevate ${isLive ? "border-red-500/30 dark:border-red-500/25 shadow-[0_1px_4px_rgba(239,68,68,0.1),0_0_8px_1px_rgba(239,68,68,0.08)] dark:shadow-[0_0_8px_1px_rgba(239,68,68,0.15),0_0_2px_rgba(239,68,68,0.2)]" : "border-brand/20 dark:border-brand/15 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_rgba(168,85,247,0.06),0_0_8px_rgba(168,85,247,0.04)] dark:shadow-[0_0_8px_rgba(168,85,247,0.08),0_0_2px_rgba(168,85,247,0.15)]"}`}>
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
                      {scorePct !== null && tier && (
                        <span className={`shrink-0 inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-[11px] font-bold tabular-nums border shadow-sm dark:shadow-none ${getSignalTierBg(tier)} ${getSignalTierColor(tier)}`}>
                          {scorePct}
                        </span>
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

        return (
          <>
            {liveCount > 0 && liveCount < processedProfiles.length ? (
              <>
                <div className="rounded-lg border border-red-500/20 dark:border-red-500/15 bg-red-500/[0.03] dark:bg-red-500/[0.04] p-2.5 sm:p-3">
                  <div className="flex items-center gap-2 mb-2.5 px-0.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">Live Now</span>
                    <span className="text-[10px] text-red-500/60 dark:text-red-400/50 font-medium">{liveCount} broadcasting</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {processedProfiles.slice(0, liveCount).map(renderCard)}
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
            )}
          </>
        );
      })()}
      {!searchQuery.trim() && onLoadMore && hasMore !== undefined && loadingMore !== undefined && (
        <InfiniteScrollSentinel onLoadMore={onLoadMore} isLoading={loadingMore} hasMore={hasMore} />
      )}
    </div>
  );
}

function WalletSection({ visible, onToggleVisibility, balance, balanceLoading, transactions, txLoaded }: {
  visible: boolean;
  onToggleVisibility: () => void;
  balance: number | null;
  balanceLoading: boolean;
  transactions: NWCTransaction[];
  txLoaded: boolean;
}) {
  const incomingTotal = useMemo(() => transactions.filter(t => t.type === "incoming").reduce((sum, t) => sum + t.amount, 0), [transactions]);
  const outgoingTotal = useMemo(() => transactions.filter(t => t.type === "outgoing").reduce((sum, t) => sum + t.amount, 0), [transactions]);
  const incomingCount = transactions.filter(t => t.type === "incoming").length;
  const outgoingCount = transactions.filter(t => t.type === "outgoing").length;

  const masked = "••••••";

  const msatToSats = (msat: number) => Math.floor(msat / 1000);
  const formatSats = (sats: number) => sats.toLocaleString();

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m ago`;
    if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;
    if (diffHrs < 48) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="mt-4 glass-card rounded-md border" data-testid="container-outpost-wallet">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/15 text-amber-500">
            <span className="text-sm font-bold">₿</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Lightning Wallet</span>
            {visible && balance !== null && !balanceLoading && (
              <Badge variant="secondary" className="text-[11px] tabular-nums">
                {formatSats(balance)} sats
              </Badge>
            )}
            {visible && balanceLoading && (
              <RelayOutpostInlineLoader className="w-3.5 h-3.5" />
            )}
            {!visible && (
              <span className="text-[11px] text-muted-foreground/50">Hidden</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleVisibility}
            className="gap-1.5 text-xs font-medium"
            data-testid="button-toggle-wallet-visibility"
          >
            {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {visible ? "Hide" : "Show"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs font-medium" asChild data-testid="button-open-wallet">
            <Link href="/wallet">
              <WalletIcon className="w-3.5 h-3.5" />
              Manage
            </Link>
          </Button>
        </div>
      </div>

      {visible && (
        <div className="border-t border-border/30 px-3 py-2.5 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md bg-muted/20 px-3 py-2" data-testid="wallet-stat-balance">
              <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider">Balance</p>
              <p className="text-sm font-semibold tabular-nums mt-0.5">
                {balanceLoading ? (
                  <RelayOutpostInlineLoader className="w-3.5 h-3.5" />
                ) : balance !== null ? (
                  `${formatSats(balance)} sats`
                ) : (
                  "—"
                )}
              </p>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2" data-testid="wallet-stat-received">
              <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
                <ArrowDownLeft className="w-2.5 h-2.5 text-green-500/80" />
                Received
              </p>
              <p className="text-sm font-semibold tabular-nums mt-0.5">
                {!txLoaded ? masked : `${formatSats(msatToSats(incomingTotal))} sats`}
              </p>
              {txLoaded && (
                <p className="text-[11px] text-muted-foreground/60 tabular-nums">{incomingCount} zaps</p>
              )}
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2" data-testid="wallet-stat-sent">
              <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
                <ArrowUpRight className="w-2.5 h-2.5 text-orange-500/80" />
                Sent
              </p>
              <p className="text-sm font-semibold tabular-nums mt-0.5">
                {!txLoaded ? masked : `${formatSats(msatToSats(outgoingTotal))} sats`}
              </p>
              {txLoaded && (
                <p className="text-[11px] text-muted-foreground/60 tabular-nums">{outgoingCount} zaps</p>
              )}
            </div>
          </div>

          {txLoaded && transactions.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground/50 uppercase tracking-wider mb-1.5">Recent Activity</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {transactions.slice(0, 8).map((tx, i) => (
                  <div
                    key={tx.payment_hash || i}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/10 text-xs"
                    data-testid={`wallet-tx-${i}`}
                  >
                    {tx.type === "incoming" ? (
                      <ArrowDownLeft className="w-3 h-3 text-green-500/80 shrink-0" />
                    ) : (
                      <ArrowUpRight className="w-3 h-3 text-orange-500/80 shrink-0" />
                    )}
                    <span className="truncate flex-1 text-muted-foreground">
                      {tx.description || (tx.type === "incoming" ? "Received" : "Sent")}
                    </span>
                    <span className={`tabular-nums font-medium shrink-0 ${tx.type === "incoming" ? "text-green-500/90" : "text-orange-500/90"}`}>
                      {tx.type === "incoming" ? "+" : "-"}{formatSats(msatToSats(tx.amount))}
                    </span>
                    <span className="text-[11px] text-muted-foreground/50 shrink-0 tabular-nums">
                      {formatDate(tx.settled_at || tx.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {txLoaded && transactions.length === 0 && (
            <p className="text-xs text-muted-foreground/60 text-center py-2">No recent transactions</p>
          )}
        </div>
      )}
    </div>
  );
}

function RelaysTab({ relayList, writeRelays, readRelays, loaded }: {
  relayList: RelayInfo[];
  writeRelays: RelayInfo[];
  readRelays: RelayInfo[];
  loaded: boolean;
}) {
  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <RelayOutpostLoader size="md" label="Scanning relay stations..." />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="container-outpost-relays">
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Satellite className="w-3.5 h-3.5 text-green-600 dark:text-green-500/80" />
          <span className="text-xs text-foreground/70 dark:text-muted-foreground uppercase tracking-wider font-medium">Connected App Relays</span>
          <Badge variant="secondary" className="text-[10px] ml-auto">{DEFAULT_RELAYS.length} active</Badge>
        </div>
        <div className="space-y-1">
          {DEFAULT_RELAYS.map(url => (
            <div key={url} className="flex items-center gap-2 px-3 py-2 rounded-md glass-card border text-sm" data-testid={`relay-app-${url}`}>
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-500/80 shrink-0 animate-pulse" />
              <span className="font-mono text-xs truncate text-foreground/80 dark:text-foreground">{url.replace("wss://", "")}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <Satellite className="w-3.5 h-3.5 text-brand" />
          <span className="text-xs text-foreground/70 dark:text-muted-foreground uppercase tracking-wider font-medium">Inbox</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-border/40">NIP-65 read</Badge>
          <Badge variant="secondary" className="text-[10px] ml-auto">{readRelays.length}</Badge>
        </div>
        <p className="text-[11px] text-foreground/55 dark:text-muted-foreground/70 mb-2">Relays where people can reach you with mentions, replies, and DMs.</p>
        {readRelays.length > 0 ? (
          <div className="space-y-1">
            {readRelays.map(r => (
              <div key={`in-${r.url}`} className="flex items-center gap-2 px-3 py-2 rounded-md glass-card border text-sm" data-testid={`relay-read-${r.url}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-500/80 shrink-0" />
                <span className="font-mono text-xs truncate text-foreground/80 dark:text-foreground">{r.url.replace("wss://", "")}</span>
                {r.mode === "both" && (
                  <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">read + write</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 rounded-md border border-dashed border-border/40 dark:border-border/15 text-[11px] text-muted-foreground/60">No inbox relays declared yet.</div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <Signal className="w-3.5 h-3.5 text-brand" />
          <span className="text-xs text-foreground/70 dark:text-muted-foreground uppercase tracking-wider font-medium">Outbox</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-border/40">NIP-65 write</Badge>
          <Badge variant="secondary" className="text-[10px] ml-auto">{writeRelays.length}</Badge>
        </div>
        <p className="text-[11px] text-foreground/55 dark:text-muted-foreground/70 mb-2">Relays you broadcast from — other clients fetch your posts here.</p>
        {writeRelays.length > 0 ? (
          <div className="space-y-1">
            {writeRelays.map(r => (
              <div key={`out-${r.url}`} className="flex items-center gap-2 px-3 py-2 rounded-md glass-card border text-sm" data-testid={`relay-write-${r.url}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-500/80 shrink-0" />
                <span className="font-mono text-xs truncate text-foreground/80 dark:text-foreground">{r.url.replace("wss://", "")}</span>
                {r.mode === "both" && (
                  <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">read + write</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 rounded-md border border-dashed border-border/40 dark:border-border/15 text-[11px] text-muted-foreground/60">No outbox relays declared yet.</div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <Bookmark className="w-3.5 h-3.5 text-amber-500/80" />
          <span className="text-xs text-foreground/70 dark:text-muted-foreground uppercase tracking-wider font-medium">Favorites</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-border/40">kind 10065</Badge>
          <Badge variant="outline" className="text-[9px] ml-auto border-amber-500/30 text-amber-600/80 dark:text-amber-400/70">Coming soon</Badge>
        </div>
        <p className="text-[11px] text-foreground/55 dark:text-muted-foreground/70 mb-2">Your starred relays — clients can use this list to suggest where to reach you.</p>
        <div className="px-3 py-2 rounded-md border border-dashed border-border/40 dark:border-border/15 text-[11px] text-muted-foreground/60">
          Favorites publishing isn't wired up yet. For now, manage your set in <Link href="/relays" className="underline hover:text-foreground/80">Relays</Link>.
        </div>
      </div>

      <div className="pt-2">
        <Button variant="outline" size="sm" className="gap-1.5 font-medium" asChild data-testid="button-manage-relays">
          <Link href="/relays">
            <Radio className="w-3.5 h-3.5" />
            Manage Relay Stations
          </Link>
        </Button>
      </div>
    </div>
  );
}

type ActivityType = "post" | "reply" | "reaction" | "repost" | "zap" | "follow" | "unfollow" | "mute" | "unmute" | "report";

interface ActivityEntry {
  id: string;
  type: ActivityType;
  timestamp: number;
  event: Event;
  targetEventId?: string;
  targetPubkey?: string;
  reactionContent?: string;
  zapAmount?: number;
  reportReason?: string;
}

interface PersistedListChange {
  id: string;
  type: "follow" | "unfollow" | "mute" | "unmute";
  timestamp: number;
  targetPubkey: string;
}

function getPersistedListChanges(pubkey: string): PersistedListChange[] {
  try {
    const raw = localStorage.getItem(`flight_log_list_changes_${pubkey.slice(0, 16)}`);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function savePersistedListChanges(pubkey: string, changes: PersistedListChange[]) {
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  const filtered = changes.filter(c => c.timestamp >= since);
  const deduped = new Map<string, PersistedListChange>();
  for (const c of filtered) {
    if (!deduped.has(c.id)) deduped.set(c.id, c);
  }
  try {
    localStorage.setItem(
      `flight_log_list_changes_${pubkey.slice(0, 16)}`,
      JSON.stringify(Array.from(deduped.values()))
    );
  } catch {}
}

const ACTIVITY_TYPE_CONFIG: Record<ActivityType, { label: string; icon: typeof FileText; colorClass: string }> = {
  post: { label: "Posted", icon: FileText, colorClass: "text-blue-600 dark:text-blue-400" },
  reply: { label: "Replied", icon: CornerUpLeft, colorClass: "text-brand" },
  reaction: { label: "Reacted", icon: Heart, colorClass: "text-pink-600 dark:text-pink-400" },
  repost: { label: "Reposted", icon: Repeat2, colorClass: "text-green-600 dark:text-green-400" },
  zap: { label: "Zapped", icon: BtcZapIcon as unknown as typeof FileText, colorClass: "text-amber-600 dark:text-amber-400" },
  follow: { label: "Followed", icon: Users, colorClass: "text-emerald-600 dark:text-emerald-400" },
  unfollow: { label: "Unfollowed", icon: EyeOff, colorClass: "text-slate-500 dark:text-slate-400" },
  mute: { label: "Muted", icon: EyeOff, colorClass: "text-orange-600 dark:text-orange-400" },
  unmute: { label: "Unmuted", icon: Eye, colorClass: "text-teal-600 dark:text-teal-400" },
  report: { label: "Reported", icon: ShieldCheck, colorClass: "text-red-600 dark:text-red-400" } };

const ACTIVITY_FILTERS: { value: ActivityType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "post", label: "Posts" },
  { value: "reply", label: "Replies" },
  { value: "reaction", label: "Reactions" },
  { value: "repost", label: "Reposts" },
  { value: "zap", label: "Zaps" },
  { value: "follow", label: "Follows" },
  { value: "mute", label: "Mutes" },
  { value: "report", label: "Reports" },
];

function parseZapAmount(event: Event): number {
  const amountTag = event.tags.find(t => t[0] === "amount");
  if (amountTag?.[1]) {
    const msats = parseInt(amountTag[1]);
    if (!isNaN(msats) && msats > 0) return Math.floor(msats / 1000);
  }
  const bolt11Tag = event.tags.find(t => t[0] === "bolt11");
  if (!bolt11Tag?.[1]) return 0;
  const bolt11 = bolt11Tag[1].toLowerCase();
  const mMatch = bolt11.match(/lnbc(\d+)m/);
  if (mMatch) return parseInt(mMatch[1]) * 100000;
  const uMatch = bolt11.match(/lnbc(\d+)u/);
  if (uMatch) return parseInt(uMatch[1]) * 100;
  const nMatch = bolt11.match(/lnbc(\d+)n/);
  if (nMatch) return Math.floor(parseInt(nMatch[1]) / 10);
  const pMatch = bolt11.match(/lnbc(\d+)p/);
  if (pMatch) return Math.floor(parseInt(pMatch[1]) / 10000);
  return 0;
}

function groupByDay(entries: ActivityEntry[]): { label: string; date: string; entries: ActivityEntry[] }[] {
  const groups = new Map<string, ActivityEntry[]>();
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();

  for (const entry of entries) {
    const d = new Date(entry.timestamp * 1000);
    const key = d.toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  return Array.from(groups.entries()).map(([dateStr, items]) => {
    let label: string;
    if (dateStr === today) label = "Today";
    else if (dateStr === yesterday) label = "Yesterday";
    else {
      const d = new Date(items[0].timestamp * 1000);
      label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    }
    return { label, date: dateStr, entries: items.sort((a, b) => b.timestamp - a.timestamp) };
  }).sort((a, b) => b.entries[0].timestamp - a.entries[0].timestamp);
}

function FlightLogTab({ pubkey }: { pubkey: string }) {
  const [, setLocation] = useLocation();
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ActivityType | "all">("all");
  const [expandedDays, setExpandedDays] = useState<Set<string> | null>(null);
  const [targetProfiles, setTargetProfiles] = useState<Map<string, { name: string; picture?: string }>>(new Map());
  const { isConnected: nwcConnected, listTransactions } = useNWC();

  const toggleDay = useCallback((date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev ?? []);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  const handleStatTap = useCallback((filterType: ActivityType | "all") => {
    setActiveFilter(prev => prev === filterType ? "all" : filterType);
  }, []);

  useEffect(() => {
    if (!pubkey) return;
    setLoaded(false);
    setActivities([]);
    const activityMap = new Map<string, ActivityEntry>();
    const targetPubkeys = new Set<string>();
    let cancelled = false;
    let completedSubs = 0;
    const totalSubs = nwcConnected ? 6 : 7;

    const timeout = setTimeout(() => {
      if (!cancelled) setLoaded(true);
    }, 12000);

    const flushActivities = () => {
      if (cancelled) return;
      setActivities(Array.from(activityMap.values()));
    };

    const onSubComplete = () => {
      if (cancelled) return;
      completedSubs++;
      flushActivities();
      if (completedSubs >= totalSubs) {
        setLoaded(true);
        clearTimeout(timeout);
        const pkArray = Array.from(targetPubkeys);
        if (pkArray.length > 0) {
          fetchProfilesCached(pkArray);
          const resolveProfiles = () => {
            if (cancelled) return;
            const profiles = new Map<string, { name: string; picture?: string }>();
            for (const pk of pkArray) {
              const prof = eventStore.getReplaceable(0, pk);
              if (prof) {
                profiles.set(pk, { name: getDisplayName(prof), picture: getAvatarUrl(prof) });
              }
            }
            setTargetProfiles(profiles);
          };
          setTimeout(resolveProfiles, 2000);
          setTimeout(resolveProfiles, 5000);
        }
      }
    };

    const addEntry = (entry: ActivityEntry) => {
      if (cancelled || activityMap.has(entry.id)) return;
      activityMap.set(entry.id, entry);
    };

    const since = Math.floor(Date.now() / 1000) - 90 * 86400;

    fetchRelayLists([pubkey]);
    const flightInitialRelays = getUserNotesFetchRelays(pubkey);

    const postsSub = throttledPoolSubscribe(flightInitialRelays, {
      kinds: [KIND_TEXT_NOTE],
      authors: [pubkey],
      since,
      limit: 100 }, {
      onevent(event) {
        const isReply = event.tags.some((t: string[]) => t[0] === "e");
        const targetE = event.tags.find((t: string[]) => t[0] === "e");
        const targetP = event.tags.find((t: string[]) => t[0] === "p");
        if (targetP?.[1]) targetPubkeys.add(targetP[1]);
        addEntry({
          id: event.id,
          type: isReply ? "reply" : "post",
          timestamp: event.created_at,
          event,
          targetEventId: targetE?.[1],
          targetPubkey: targetP?.[1] });
      },
      oneose() { onSubComplete(); } });

    const reactionsSub = throttledPoolSubscribe(flightInitialRelays, {
      kinds: [KIND_REACTION],
      authors: [pubkey],
      since,
      limit: 100 }, {
      onevent(event) {
        const targetE = event.tags.find((t: string[]) => t[0] === "e");
        const targetP = event.tags.find((t: string[]) => t[0] === "p");
        if (targetP?.[1]) targetPubkeys.add(targetP[1]);
        addEntry({
          id: event.id,
          type: "reaction",
          timestamp: event.created_at,
          event,
          targetEventId: targetE?.[1],
          targetPubkey: targetP?.[1],
          reactionContent: event.content || "+" });
      },
      oneose() { onSubComplete(); } });

    const repostsSub = throttledPoolSubscribe(flightInitialRelays, {
      kinds: [KIND_REPOST],
      authors: [pubkey],
      since,
      limit: 100 }, {
      onevent(event) {
        const targetE = event.tags.find((t: string[]) => t[0] === "e");
        const targetP = event.tags.find((t: string[]) => t[0] === "p");
        if (targetP?.[1]) targetPubkeys.add(targetP[1]);
        addEntry({
          id: event.id,
          type: "repost",
          timestamp: event.created_at,
          event,
          targetEventId: targetE?.[1],
          targetPubkey: targetP?.[1] });
      },
      oneose() { onSubComplete(); } });

    let zapsSub: ReturnType<typeof throttledPoolSubscribe> | null = null;
    if (!nwcConnected) {
      zapsSub = throttledPoolSubscribe(flightInitialRelays, {
        kinds: [KIND_ZAP_REQUEST],
        authors: [pubkey],
        since,
        limit: 100 }, {
        onevent(event) {
          const targetE = event.tags.find((t: string[]) => t[0] === "e");
          const targetP = event.tags.find((t: string[]) => t[0] === "p");
          if (targetP?.[1]) targetPubkeys.add(targetP[1]);
          const amount = parseZapAmount(event);
          addEntry({
            id: event.id,
            type: "zap",
            timestamp: event.created_at,
            event,
            targetEventId: targetE?.[1],
            targetPubkey: targetP?.[1],
            zapAmount: amount });
        },
        oneose() { onSubComplete(); } });
    }

    function diffListEvents(
      events: Event[],
      snapshotKey: string,
      addLabel: "follow" | "mute",
      removeLabel: "unfollow" | "unmute",
    ): PersistedListChange[] {
      if (events.length === 0) return [];
      events.sort((a, b) => a.created_at - b.created_at);
      const newChanges: PersistedListChange[] = [];

      let savedSnapshot: { pubkeys: string[]; timestamp: number } | null = null;
      try {
        const raw = localStorage.getItem(snapshotKey);
        if (raw) savedSnapshot = JSON.parse(raw);
      } catch {}

      const oldest = events[0];
      if (savedSnapshot && events.length === 1 && savedSnapshot.timestamp < oldest.created_at) {
        const prev = new Set(savedSnapshot.pubkeys);
        const curr = new Set(oldest.tags.filter(t => t[0] === "p").map(t => t[1]));
        const ts = oldest.created_at;
        if (ts >= since) {
          for (const pk of curr) {
            if (!prev.has(pk)) {
              targetPubkeys.add(pk);
              const id = `${addLabel}-${ts}-${pk.slice(0, 8)}`;
              addEntry({ id, type: addLabel, timestamp: ts, event: oldest, targetPubkey: pk });
              newChanges.push({ id, type: addLabel, timestamp: ts, targetPubkey: pk });
            }
          }
          for (const pk of prev) {
            if (!curr.has(pk)) {
              targetPubkeys.add(pk);
              const id = `${removeLabel}-${ts}-${pk.slice(0, 8)}`;
              addEntry({ id, type: removeLabel, timestamp: ts, event: oldest, targetPubkey: pk });
              newChanges.push({ id, type: removeLabel, timestamp: ts, targetPubkey: pk });
            }
          }
        }
      }

      for (let i = 1; i < events.length; i++) {
        const ts = events[i].created_at;
        if (ts < since) continue;
        const prev = new Set(events[i - 1].tags.filter(t => t[0] === "p").map(t => t[1]));
        const curr = new Set(events[i].tags.filter(t => t[0] === "p").map(t => t[1]));
        for (const pk of curr) {
          if (!prev.has(pk)) {
            targetPubkeys.add(pk);
            const id = `${addLabel}-${ts}-${pk.slice(0, 8)}`;
            addEntry({ id, type: addLabel, timestamp: ts, event: events[i], targetPubkey: pk });
            newChanges.push({ id, type: addLabel, timestamp: ts, targetPubkey: pk });
          }
        }
        for (const pk of prev) {
          if (!curr.has(pk)) {
            targetPubkeys.add(pk);
            const id = `${removeLabel}-${ts}-${pk.slice(0, 8)}`;
            addEntry({ id, type: removeLabel, timestamp: ts, event: events[i], targetPubkey: pk });
            newChanges.push({ id, type: removeLabel, timestamp: ts, targetPubkey: pk });
          }
        }
      }

      const latest = events[events.length - 1];
      const latestPubkeys = latest.tags.filter(t => t[0] === "p").map(t => t[1]);
      try {
        localStorage.setItem(snapshotKey, JSON.stringify({
          pubkeys: latestPubkeys,
          timestamp: latest.created_at }));
      } catch {}

      return newChanges;
    }

    function mergeDedupeEvents(sources: Event[][]): Event[] {
      const seen = new Map<string, Event>();
      for (const list of sources) {
        for (const e of list) {
          const key = `${e.created_at}-${e.id}`;
          if (!seen.has(key)) seen.set(key, e);
        }
      }
      return Array.from(seen.values());
    }

    function applyPersistedFallback(
      types: string[],
      kind: number,
    ) {
      const persistedChanges = getPersistedListChanges(pubkey);
      const dummyEvent = { id: "", pubkey, kind, content: "", tags: [], created_at: 0, sig: "" } as Event;
      for (const pc of persistedChanges) {
        if (types.includes(pc.type)) {
          if (pc.targetPubkey) targetPubkeys.add(pc.targetPubkey);
          addEntry({
            id: pc.id,
            type: pc.type as ActivityType,
            timestamp: pc.timestamp,
            event: { ...dummyEvent, created_at: pc.timestamp },
            targetPubkey: pc.targetPubkey });
        }
      }
      return persistedChanges;
    }

    const contactListEvents: Event[] = [];
    const CONTACT_SNAPSHOT_KEY = `flight_log_contacts_${pubkey.slice(0, 16)}`;
    const contactRelays = Array.from(new Set([...flightInitialRelays, "wss://purplepag.es"]));
    const contactSub = throttledPoolSubscribe(contactRelays, {
      kinds: [KIND_FOLLOW_LIST],
      authors: [pubkey],
      limit: 50 }, {
      onevent(event) {
        contactListEvents.push(event);
      },
      async oneose() {
        if (cancelled) { onSubComplete(); return; }
        let primalHistory: Event[] = [];
        try {
          primalHistory = await fetchContactListHistory(pubkey, 50);
        } catch {}
        if (cancelled) { onSubComplete(); return; }
        const merged = mergeDedupeEvents([contactListEvents, primalHistory]);
        const newChanges = diffListEvents(merged, CONTACT_SNAPSHOT_KEY, "follow", "unfollow");
        const persistedChanges = applyPersistedFallback(["follow", "unfollow"], KIND_FOLLOW_LIST);
        if (newChanges.length > 0) {
          savePersistedListChanges(pubkey, [...persistedChanges, ...newChanges]);
        }
        onSubComplete();
      } });

    const muteListEvents: Event[] = [];
    const MUTE_SNAPSHOT_KEY = `flight_log_mutes_${pubkey.slice(0, 16)}`;
    const muteSub = throttledPoolSubscribe(flightInitialRelays, {
      kinds: [10000],
      authors: [pubkey],
      limit: 50 }, {
      onevent(event) {
        muteListEvents.push(event);
      },
      async oneose() {
        if (cancelled) { onSubComplete(); return; }
        let primalHistory: Event[] = [];
        try {
          primalHistory = await fetchMuteListHistory(pubkey, 50);
        } catch {}
        if (cancelled) { onSubComplete(); return; }
        const merged = mergeDedupeEvents([muteListEvents, primalHistory]);
        const newChanges = diffListEvents(merged, MUTE_SNAPSHOT_KEY, "mute", "unmute");
        const persistedChanges = applyPersistedFallback(["mute", "unmute"], 10000);
        if (newChanges.length > 0) {
          savePersistedListChanges(pubkey, [...persistedChanges, ...newChanges]);
        }
        onSubComplete();
      } });

    const reportSub = throttledPoolSubscribe(flightInitialRelays, {
      kinds: [1984],
      authors: [pubkey],
      since,
      limit: 50 }, {
      onevent(event) {
        const targetP = event.tags.find((t: string[]) => t[0] === "p");
        const reasonTag = event.tags.find((t: string[]) => t[0] === "l");
        if (targetP?.[1]) targetPubkeys.add(targetP[1]);
        addEntry({
          id: event.id,
          type: "report",
          timestamp: event.created_at,
          event,
          targetPubkey: targetP?.[1],
          targetEventId: event.tags.find(t => t[0] === "e")?.[1],
          reportReason: reasonTag?.[1] || event.content?.slice(0, 100) || undefined });
      },
      oneose() { onSubComplete(); } });

    const topUpSubs: Array<{ close: () => void }> = [];
    let topUpInterval: ReturnType<typeof setInterval> | null = null;
    let topUpLaunched = false;
    const topUpDeadline = Date.now() + 6000;
    const tryFlightTopUp = () => {
      if (cancelled || topUpLaunched) return;
      const updated = getUserNotesFetchRelays(pubkey);
      const extras = updated.filter((r) => !flightInitialRelays.includes(r));
      if (extras.length > 0) {
        topUpLaunched = true;
        topUpSubs.push(throttledPoolSubscribe(extras, { kinds: [KIND_TEXT_NOTE], authors: [pubkey], since, limit: 100 }, {
          onevent(event) {
            const isReply = event.tags.some((t: string[]) => t[0] === "e");
            const targetE = event.tags.find((t: string[]) => t[0] === "e");
            const targetP = event.tags.find((t: string[]) => t[0] === "p");
            if (targetP?.[1]) targetPubkeys.add(targetP[1]);
            addEntry({ id: event.id, type: isReply ? "reply" : "post", timestamp: event.created_at, event, targetEventId: targetE?.[1], targetPubkey: targetP?.[1] });
          },
          oneose() { flushActivities(); },
        }));
        topUpSubs.push(throttledPoolSubscribe(extras, { kinds: [KIND_REACTION], authors: [pubkey], since, limit: 100 }, {
          onevent(event) {
            const targetE = event.tags.find((t: string[]) => t[0] === "e");
            const targetP = event.tags.find((t: string[]) => t[0] === "p");
            if (targetP?.[1]) targetPubkeys.add(targetP[1]);
            addEntry({ id: event.id, type: "reaction", timestamp: event.created_at, event, targetEventId: targetE?.[1], targetPubkey: targetP?.[1], reactionContent: event.content || "+" });
          },
          oneose() { flushActivities(); },
        }));
        topUpSubs.push(throttledPoolSubscribe(extras, { kinds: [KIND_REPOST], authors: [pubkey], since, limit: 100 }, {
          onevent(event) {
            const targetE = event.tags.find((t: string[]) => t[0] === "e");
            const targetP = event.tags.find((t: string[]) => t[0] === "p");
            if (targetP?.[1]) targetPubkeys.add(targetP[1]);
            addEntry({ id: event.id, type: "repost", timestamp: event.created_at, event, targetEventId: targetE?.[1], targetPubkey: targetP?.[1] });
          },
          oneose() { flushActivities(); },
        }));
        if (!nwcConnected) {
          topUpSubs.push(throttledPoolSubscribe(extras, { kinds: [KIND_ZAP_REQUEST], authors: [pubkey], since, limit: 100 }, {
            onevent(event) {
              const targetE = event.tags.find((t: string[]) => t[0] === "e");
              const targetP = event.tags.find((t: string[]) => t[0] === "p");
              if (targetP?.[1]) targetPubkeys.add(targetP[1]);
              const amount = parseZapAmount(event);
              addEntry({ id: event.id, type: "zap", timestamp: event.created_at, event, targetEventId: targetE?.[1], targetPubkey: targetP?.[1], zapAmount: amount });
            },
            oneose() { flushActivities(); },
          }));
        }
        topUpSubs.push(throttledPoolSubscribe(extras, { kinds: [1984], authors: [pubkey], since, limit: 50 }, {
          onevent(event) {
            const targetP = event.tags.find((t: string[]) => t[0] === "p");
            const reasonTag = event.tags.find((t: string[]) => t[0] === "l");
            if (targetP?.[1]) targetPubkeys.add(targetP[1]);
            addEntry({ id: event.id, type: "report", timestamp: event.created_at, event, targetPubkey: targetP?.[1], targetEventId: event.tags.find(t => t[0] === "e")?.[1], reportReason: reasonTag?.[1] || event.content?.slice(0, 100) || undefined });
          },
          oneose() { flushActivities(); },
        }));
        if (topUpInterval) { clearInterval(topUpInterval); topUpInterval = null; }
      } else if (Date.now() >= topUpDeadline) {
        if (topUpInterval) { clearInterval(topUpInterval); topUpInterval = null; }
      }
    };
    topUpInterval = setInterval(tryFlightTopUp, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (topUpInterval) clearInterval(topUpInterval);
      postsSub?.close?.();
      reactionsSub?.close?.();
      repostsSub?.close?.();
      zapsSub?.close?.();
      contactSub?.close?.();
      muteSub?.close?.();
      reportSub?.close?.();
      topUpSubs.forEach((s) => { try { s.close(); } catch {} });
    };
  }, [pubkey, nwcConnected]);

  useEffect(() => {
    if (!pubkey || !nwcConnected) return;
    let cancelled = false;
    listTransactions(50).then(txs => {
      if (cancelled) return;
      const since = Math.floor(Date.now() / 1000) - 90 * 86400;
      const zapEntries: ActivityEntry[] = [];
      for (const tx of txs) {
        if (tx.type !== "outgoing") continue;
        const ts = tx.settled_at || tx.created_at;
        if (ts < since) continue;
        const amountSats = Math.floor((tx.amount || 0) / 1000);
        if (amountSats <= 0) continue;
        zapEntries.push({
          id: `nwc-${tx.payment_hash}`,
          type: "zap",
          timestamp: ts,
          event: { id: tx.payment_hash, pubkey, kind: 9734, content: tx.description || "", tags: [], created_at: ts, sig: "" } as any,
          zapAmount: amountSats });
      }
      if (zapEntries.length > 0) {
        setActivities(prev => {
          const existing = new Map(prev.map(a => [a.id, a]));
          for (const entry of zapEntries) {
            if (!existing.has(entry.id)) existing.set(entry.id, entry);
          }
          return Array.from(existing.values());
        });
      }
    });
    return () => { cancelled = true; };
  }, [pubkey, nwcConnected, listTransactions]);

  const filtered = useMemo(() => {
    const deduped = new Map<string, ActivityEntry>();
    for (const a of activities) {
      if (!deduped.has(a.id)) deduped.set(a.id, a);
    }
    const all = Array.from(deduped.values());
    if (activeFilter === "all") return all;
    if (activeFilter === "follow") return all.filter(a => a.type === "follow" || a.type === "unfollow");
    if (activeFilter === "mute") return all.filter(a => a.type === "mute" || a.type === "unmute");
    return all.filter(a => a.type === activeFilter);
  }, [activities, activeFilter]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  const weekStats = useMemo(() => {
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const deduped = new Map<string, ActivityEntry>();
    for (const a of activities) {
      if (!deduped.has(a.id) && a.timestamp >= weekAgo) deduped.set(a.id, a);
    }
    const week = Array.from(deduped.values());
    return {
      posts: week.filter(a => a.type === "post").length,
      replies: week.filter(a => a.type === "reply").length,
      reactions: week.filter(a => a.type === "reaction").length,
      reposts: week.filter(a => a.type === "repost").length,
      zaps: week.filter(a => a.type === "zap").length,
      totalSats: week.filter(a => a.type === "zap").reduce((sum, a) => sum + (a.zapAmount || 0), 0),
      follows: week.filter(a => a.type === "follow").length,
      unfollows: week.filter(a => a.type === "unfollow").length,
      mutes: week.filter(a => a.type === "mute").length,
      unmutes: week.filter(a => a.type === "unmute").length,
      reports: week.filter(a => a.type === "report").length };
  }, [activities]);

  const handleNavigate = (entry: ActivityEntry) => {
    if (entry.type === "follow" || entry.type === "unfollow" || entry.type === "mute" || entry.type === "unmute") {
      if (entry.targetPubkey) {
        const npub = nip19.npubEncode(entry.targetPubkey);
        setLocation(`/profile/${npub}`);
      }
      return;
    }
    if (entry.type === "report") {
      if (entry.targetEventId) {
        setLocation(`/thread/${entry.targetEventId}`);
      } else if (entry.targetPubkey) {
        const npub = nip19.npubEncode(entry.targetPubkey);
        setLocation(`/profile/${npub}`);
      }
      return;
    }
    if (entry.targetEventId) {
      setLocation(`/thread/${entry.targetEventId}`);
    } else if (entry.type === "post") {
      setLocation(`/thread/${entry.id}`);
    }
  };

  if (!loaded && activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12" data-testid="container-loading-flight-log">
        <RelayOutpostLoader size="md" label="Scanning flight records..." />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="container-flight-log">
      <div
        className="rounded-lg p-3 sm:p-4 border border-brand/25 dark:border-brand/10 bg-brand/5 dark:bg-transparent shadow-sm dark:shadow-none"
        style={{
          backgroundImage: "linear-gradient(135deg, rgba(140, 80, 220, 0.08) 0%, rgba(200, 160, 60, 0.04) 100%)" }}
        data-testid="container-flight-log-stats"
      >
        <div className="flex items-center gap-2 mb-3">
          <ScrollText className="w-4 h-4 text-brand dark:text-brand/70" />
          <span className="text-xs text-foreground/60 dark:text-muted-foreground/70 uppercase tracking-wider font-medium">This Week</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
          {[
            { label: "Posts", value: weekStats.posts, color: "text-blue-600 dark:text-blue-400", icon: FileText, filter: "post" as ActivityType | "all" },
            { label: "Replies", value: weekStats.replies, color: "text-brand", icon: CornerUpLeft, filter: "reply" as ActivityType | "all" },
            { label: "Reactions", value: weekStats.reactions, color: "text-pink-600 dark:text-pink-400", icon: Heart, filter: "reaction" as ActivityType | "all" },
            { label: "Reposts", value: weekStats.reposts, color: "text-green-600 dark:text-green-400", icon: Repeat2, filter: "repost" as ActivityType | "all" },
            { label: "Zaps", value: weekStats.zaps, color: "text-amber-600 dark:text-amber-400", icon: BtcZapIcon as typeof FileText, filter: "zap" as ActivityType | "all" },
            { label: "Sats Sent", value: weekStats.totalSats > 999 ? `${(weekStats.totalSats / 1000).toFixed(1)}k` : weekStats.totalSats, color: "text-amber-600 dark:text-amber-300", icon: BtcZapIcon as typeof FileText, filter: "zap" as ActivityType | "all" },
            { label: "Follows", value: weekStats.follows + weekStats.unfollows, color: "text-emerald-600 dark:text-emerald-400", icon: Users, filter: "follow" as ActivityType | "all" },
            { label: "Mutes", value: weekStats.mutes + weekStats.unmutes, color: "text-orange-600 dark:text-orange-400", icon: EyeOff, filter: "mute" as ActivityType | "all" },
            { label: "Reports", value: weekStats.reports, color: "text-red-600 dark:text-red-400", icon: ShieldCheck, filter: "report" as ActivityType | "all" },
          ].map((stat) => (
            <button
              key={stat.label}
              onClick={() => handleStatTap(stat.filter)}
              className={`flex flex-col items-center py-2 rounded-md cursor-pointer transition-all ${ activeFilter === stat.filter ? "bg-accent dark:bg-brand/10 border border-brand/20 dark:border-brand/25 ring-1 ring-primary/20" : "bg-white/60 dark:bg-white/[0.02] border border-border/30 dark:border-transparent hover:bg-white/80 dark:hover:bg-white/[0.04]" }`}
              data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}
            >
              <stat.icon className={`w-3.5 h-3.5 ${stat.color} mb-1`} />
              <span className={`text-base sm:text-lg font-semibold tabular-nums ${stat.color}`}>
                {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
              </span>
              <span className="text-[11px] text-foreground/45 dark:text-muted-foreground/50">{stat.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap" data-testid="container-flight-log-filters">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${ activeFilter === f.value ? "bg-accent text-accent-foreground dark:text-brand border border-brand/20 dark:border-brand/30" : "bg-muted/30 text-foreground/50 dark:text-muted-foreground/60 border border-border/50 dark:border-border/40 hover:text-foreground/70 dark:hover:text-muted-foreground" }`}
            data-testid={`filter-${f.value}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {grouped.length === 0 && loaded && (
        <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-no-activities">
          <ScrollText className="w-8 h-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No activity recorded</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Your flight log will populate as you interact on the network</p>
        </div>
      )}

      {grouped.map((group, groupIdx) => {
        const isExpanded = expandedDays === null ? groupIdx === 0 : expandedDays.has(group.date);
        return (
          <div key={group.date} data-testid={`flight-log-group-${group.date}`}>
            <button
              onClick={() => toggleDay(group.date)}
              className="w-full flex items-center gap-2 mb-1 mt-1 cursor-pointer group/day hover:opacity-80 transition-opacity"
              data-testid={`toggle-day-${group.date}`}
            >
              {isExpanded
                ? <ChevronDown className="w-3.5 h-3.5 text-foreground/40 dark:text-muted-foreground/50 shrink-0" />
                : <ChevronRight className="w-3.5 h-3.5 text-foreground/40 dark:text-muted-foreground/50 shrink-0" />
              }
              <span className="text-xs font-medium text-foreground/55 dark:text-muted-foreground/70 uppercase tracking-wider">{group.label}</span>
              <div className="flex-1 h-px bg-border/50 dark:bg-border/30" />
              <span className="text-[11px] tabular-nums text-foreground/45 dark:text-muted-foreground/50 bg-muted/40 dark:bg-muted/20 px-1.5 py-0.5 rounded-full">{group.entries.length}</span>
            </button>
            {isExpanded && (
              <div className="space-y-1 ml-1">
                {group.entries.map((entry) => {
                  const config = ACTIVITY_TYPE_CONFIG[entry.type];
                  const targetProfile = entry.targetPubkey ? targetProfiles.get(entry.targetPubkey) : null;
                  const timeStr = new Date(entry.timestamp * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

                  return (
                    <button
                      key={entry.id}
                      onClick={() => handleNavigate(entry)}
                      className="w-full flex items-start gap-3 p-2.5 rounded-lg text-left transition-colors hover:bg-muted/30 group cursor-pointer border border-border/30 dark:border-transparent hover:border-border/50 dark:hover:border-border/20"
                      data-testid={`activity-entry-${entry.id}`}
                    >
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 bg-brand/15 dark:bg-brand/8 border border-brand/25 dark:border-brand/10"
                      >
                        <config.icon className={`w-3.5 h-3.5 ${config.colorClass}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-medium ${config.colorClass}`}>{config.label}</span>
                          {entry.type === "zap" && entry.zapAmount ? (
                            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                              {entry.zapAmount.toLocaleString()} sats
                            </span>
                          ) : null}
                          {entry.type === "reaction" && entry.reactionContent && entry.reactionContent !== "+" && (
                            <span className="text-sm">{entry.reactionContent}</span>
                          )}
                          {entry.type === "report" && entry.reportReason && (
                            <span className="text-[10px] text-red-500/70 dark:text-red-400/60 font-mono uppercase">{entry.reportReason}</span>
                          )}
                          {targetProfile && (
                            <span className="text-xs text-foreground/45 dark:text-muted-foreground/50 truncate">
                              → {targetProfile.name}
                            </span>
                          )}
                          <span className="text-[11px] text-foreground/45 dark:text-muted-foreground/50 ml-auto shrink-0 tabular-nums">{timeStr}</span>
                        </div>
                        {(entry.type === "post" || entry.type === "reply") && entry.event.content && (
                          <p className="text-xs text-foreground/50 dark:text-muted-foreground/60 mt-0.5 line-clamp-2 leading-relaxed">
                            {entry.event.content.slice(0, 200)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {!loaded && activities.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-4">
          <RelayOutpostInlineLoader />
          <span className="text-xs text-muted-foreground/50">Loading more...</span>
        </div>
      )}
    </div>
  );
}
