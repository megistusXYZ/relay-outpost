import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense, memo, startTransition } from "react";
import { Switch, Route, useLocation, useSearch, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { FeedbackDrawer } from "@/components/FeedbackDrawer";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NostrAuthProvider, useNostrAuth, LOGIN_METHOD_KEY } from "@/contexts/NostrAuthContext";
// Eager side-effect import: registers the module-level `beforeinstallprompt`
// listener at boot so the lazily-loaded Settings page can still offer the
// native PWA install prompt (Chromium fires the event once, early).
import "@/hooks/use-pwa-install";
import { loadLocalAccount } from "@/lib/local-account";
import { InviteAcceptCard } from "@/components/InviteAcceptCard";
import { NWCProvider, useNWC } from "@/contexts/NWCContext";
import type { NWCTransaction } from "@/contexts/NWCContext";

import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import { PiPProvider } from "@/contexts/PiPContext";
import { PersistentMediaProvider } from "@/contexts/PersistentMediaContext";
import { LiveMiniPlayerProvider } from "@/contexts/LiveMiniPlayerContext";
import { TTSProvider } from "@/contexts/TextToSpeechContext";
import { OutpostComposeProvider } from "@/contexts/OutpostComposeContext";
import { SpeechReaderBar } from "@/components/SpeechReaderBar";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopStoriesRail } from "@/components/DesktopStoriesRail";
import { BrandMark } from "@/components/BrandMark";
import { useClassicSidebar } from "@/lib/desktop-chrome";
import { OrbitMenu, openOrbitMenu } from "@/components/OrbitMenu";
import { CreatePostFAB } from "@/components/CreatePost";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { ScrollRestoreDebugOverlay } from "@/components/ScrollRestoreDebugOverlay";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PullToRefresh } from "@/components/PullToRefresh";
import { MobileFooter } from "@/components/MobileFooter";
import { UpdateReadyPill } from "@/components/UpdateReadyPill";
import { CreateStudio } from "@/components/CreateStudio";
import { MiniPlayer } from "@/components/MiniPlayer";
import { SignerDisconnectedBanner } from "@/components/SignerDisconnectedBanner";
import { UnifiedBtcBadge } from "@/components/BtcPriceTracker";
import { useTTS } from "@/contexts/TextToSpeechContext";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatNpub, shortenNpub, getProfileContent } from "@/lib/nostr-helpers";
import { parseInviteParams } from "@/lib/invite-links";
import { useNostrMuteList } from "@/hooks/use-nostr-mute-list";
import { fetchProfilesCached, eventStore } from "@/lib/nostr";
import { setSchedulerPubkey, startLocalScheduleRunner } from "@/lib/local-schedule";
import { KIND_METADATA } from "@/lib/nostr-helpers";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Search as SearchIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { primeKeyboard } from "@/lib/keyboard-handoff";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { RelayOutpostIcon, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { RelayHubHeaderControl } from "@/components/RelayHubPopover";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
import { NotificationProvider, useNotifications } from "@/contexts/NotificationContext";
import { NeedsYouProvider } from "@/contexts/NeedsYouContext";
import { NotificationIcon } from "@/components/icons/NotificationIcon";
import { LiveStatusProvider } from "@/contexts/LiveStatusContext";
import { GrapeRankScoresProvider } from "@/contexts/GrapeRankScoresContext";
import { InteractionIndexProvider } from "@/contexts/InteractionIndexContext";
import { useScrollRestore } from "@/hooks/use-scroll-restore";
import { useGoBack } from "@/hooks/use-go-back";
import { isEdgeBackSwipe, shouldAttachCustomBackSwipe, detectBackGestureEnv } from "@/lib/edge-swipe";
import { useIaCollapsed, isIaCollapsed } from "@/lib/ia-prefs";
import { parentRouteOf } from "@/lib/back-affordance";
import { useNewsTrendingOn } from "@/lib/news-trending";
import { shouldLandOnChats, hasLanded, markLanded, postAuthLandingPath, CHATS_PATH } from "@/lib/ia-landing";
// Chunk-load resilience (retry → one-shot stale-deploy reload) for every
// React.lazy site app-wide — extracted to lib/lazy-retry.ts so pages that
// code-split locally (Home, Search, MyOutpost, ChatList) share it too.
import { lazyRetry, lazyNamed } from "@/lib/lazy-retry";

const lazyChunks = {
  Home: () => lazyRetry(() => import("@/pages/Home")),
  Discover: () => lazyRetry(() => import("@/pages/Discover")),
  Marketplace: () => lazyRetry(() => import("@/pages/Marketplace")),
  NewsTrending: () => lazyRetry(() => import("@/pages/NewsTrending")),
  Profile: () => lazyRetry(() => import("@/pages/Profile")),
  Search: () => lazyRetry(() => import("@/pages/Search")),
  Thread: () => lazyRetry(() => import("@/pages/Thread")),
  Notifications: () => lazyRetry(() => import("@/pages/Notifications")),
  Login: () => lazyRetry(() => import("@/pages/Login")),
  Following: () => lazyRetry(() => import("@/pages/Following")),
  Followers: () => lazyRetry(() => import("@/pages/Followers")),
  Bookmarks: () => lazyRetry(() => import("@/pages/Bookmarks")),
  ImagesFeed: () => lazyRetry(() => import("@/pages/ImagesFeed")),
  VideoFeed: () => lazyRetry(() => import("@/pages/VideoFeed")),
  AudioFeed: () => lazyRetry(() => import("@/pages/AudioFeed")),
  ArticlesFeed: () => lazyRetry(() => import("@/pages/ArticlesFeed")),
  ArticleDetail: () => lazyRetry(() => import("@/pages/ArticleDetail")),
  Widget: () => lazyRetry(() => import("@/pages/Widget")),
  Generator: () => lazyRetry(() => import("@/pages/Generator")),
  Settings: () => lazyRetry(() => import("@/pages/Settings")),
  SettingsDanger: () => lazyRetry(() => import("@/pages/SettingsDanger")),
  Account: () => lazyRetry(() => import("@/pages/Account")),
  MyTickets: () => lazyRetry(() => import("@/pages/MyTickets")),
  RecoverFollows: () => lazyRetry(() => import("@/pages/RecoverFollows")),
  TrustReviews: () => lazyRetry(() => import("@/pages/TrustReviews")),
  MediaServers: () => lazyRetry(() => import("@/pages/MediaServers")),
  MuteList: () => lazyRetry(() => import("@/pages/MuteList")),
  KeyBackup: () => lazyRetry(() => import("@/pages/KeyBackup")),
  ArticleEditor: () => lazyRetry(() => import("@/pages/ArticleEditor")),
  RSSFeed: () => lazyRetry(() => import("@/pages/RSSFeed")),
  WalletPage: () => lazyRetry(() => import("@/pages/Wallet")),
  Messages: () => lazyRetry(() => import("@/pages/Messages")),
  EventConsole: () => lazyRetry(() => import("@/pages/EventConsole")),
  AnalyticsDashboard: () => lazyRetry(() => import("@/pages/AnalyticsDashboard")),
  RelayDashboard: () => lazyRetry(() => import("@/pages/RelayDashboard")),
  Tools: () => lazyRetry(() => import("@/pages/Tools")),
  MyOutpost: () => lazyRetry(() => import("@/pages/MyOutpost")),
  Community: () => lazyRetry(() => import("@/pages/Community")),
  LiveStreams: () => lazyRetry(() => import("@/pages/LiveStreams")),
  RelayOpsCenter: () => lazyRetry(() => import("@/pages/RelayOpsCenter")),
  Outposts: () => lazyRetry(() => import("@/pages/Outposts")),
  ContentCalendar: () => lazyRetry(() => import("@/pages/ContentCalendar")),
  Privacy: () => lazyRetry(() => import("@/pages/Privacy")),
  Covenant: () => lazyRetry(() => import("@/pages/Covenant")),
  ChildSafety: () => lazyRetry(() => import("@/pages/ChildSafety")),
  WhatsNew: () => lazyRetry(() => import("@/pages/WhatsNew")),
  ShieldMatrix: () => lazyRetry(() => import("@/pages/ShieldMatrix")),
  WtfIsThis: () => lazyRetry(() => import("@/pages/WtfIsThis")),
  FirstTenMinutes: () => lazyRetry(() => import("@/pages/FirstTenMinutes")),
  SettingUpOutpost: () => lazyRetry(() => import("@/pages/SettingUpOutpost")),
  ConnectingWallet: () => lazyRetry(() => import("@/pages/ConnectingWallet")),
  UsingContentCalendar: () => lazyRetry(() => import("@/pages/UsingContentCalendar")),
  EncryptedMessages: () => lazyRetry(() => import("@/pages/EncryptedMessages")),
  PublishingPrivacy: () => lazyRetry(() => import("@/pages/PublishingPrivacy")),
  ManagingCrew: () => lazyRetry(() => import("@/pages/ManagingCrew")),
  WhyDecentralization: () => lazyRetry(() => import("@/pages/WhyDecentralization")),
  WotVsAlgorithms: () => lazyRetry(() => import("@/pages/WotVsAlgorithms")),
  RelayCommunities: () => lazyRetry(() => import("@/pages/RelayCommunities")),
  DataSovereignty: () => lazyRetry(() => import("@/pages/DataSovereignty")),
  WhereNostrIsHeading: () => lazyRetry(() => import("@/pages/WhereNostrIsHeading")),
  NostrVsAlternatives: () => lazyRetry(() => import("@/pages/NostrVsAlternatives")),
};

const WhatsNew = lazy(lazyChunks.WhatsNew);
const Home = lazy(lazyChunks.Home);
const Profile = lazy(lazyChunks.Profile);
const Search = lazy(lazyChunks.Search);
const Thread = lazy(lazyChunks.Thread);
const Notifications = lazy(lazyChunks.Notifications);
const Login = lazy(lazyChunks.Login);
const Following = lazy(lazyChunks.Following);
const Followers = lazy(lazyChunks.Followers);
const Bookmarks = lazy(lazyChunks.Bookmarks);
const ImagesFeed = lazy(lazyChunks.ImagesFeed);
const VideoFeed = lazy(lazyChunks.VideoFeed);
const AudioFeed = lazy(lazyChunks.AudioFeed);
const ArticlesFeed = lazy(lazyChunks.ArticlesFeed);
const Discover = lazy(lazyChunks.Discover);
const Marketplace = lazy(lazyChunks.Marketplace);
const NewsTrending = lazy(lazyChunks.NewsTrending);

/** /news picks the trending front page or the classic reader by the flag. The
 *  branch is in the parent's render (not an early-return inside a page), so
 *  flipping the flag cleanly unmounts one subtree and mounts the other. */
function NewsRoute() {
  const trending = useNewsTrendingOn();
  return trending ? <NewsTrending /> : <RSSFeed />;
}
const ArticleDetail = lazy(lazyChunks.ArticleDetail);
const Widget = lazy(lazyChunks.Widget);
const Generator = lazy(lazyChunks.Generator);
const Settings = lazy(lazyChunks.Settings);
const SettingsDanger = lazy(lazyChunks.SettingsDanger);
const Account = lazy(lazyChunks.Account);
const MyTickets = lazy(lazyChunks.MyTickets);
const RecoverFollows = lazy(lazyChunks.RecoverFollows);
const TrustReviews = lazy(lazyChunks.TrustReviews);
const MediaServers = lazy(lazyChunks.MediaServers);
const MuteList = lazy(lazyChunks.MuteList);
const KeyBackup = lazy(lazyChunks.KeyBackup);
const ArticleEditor = lazy(lazyChunks.ArticleEditor);
const RSSFeed = lazy(lazyChunks.RSSFeed);
const WalletPage = lazy(lazyChunks.WalletPage);
const Messages = lazy(lazyChunks.Messages);
const EventConsole = lazy(lazyChunks.EventConsole);
const AnalyticsDashboard = lazy(lazyChunks.AnalyticsDashboard);
const RelayDashboard = lazy(lazyChunks.RelayDashboard);
const Tools = lazy(lazyChunks.Tools);
const MyOutpost = lazy(lazyChunks.MyOutpost);
const Community = lazy(lazyChunks.Community);
const LiveStreams = lazy(lazyChunks.LiveStreams);
const RelayOpsCenter = lazy(lazyChunks.RelayOpsCenter);
const Outposts = lazy(lazyChunks.Outposts);
const ContentCalendar = lazy(lazyChunks.ContentCalendar);
const Privacy = lazy(lazyChunks.Privacy);
const Covenant = lazy(lazyChunks.Covenant);
const ChildSafety = lazy(lazyChunks.ChildSafety);
const ShieldMatrix = lazy(lazyChunks.ShieldMatrix);
const WtfIsThis = lazy(lazyChunks.WtfIsThis);
const FirstTenMinutes = lazy(lazyChunks.FirstTenMinutes);
const SettingUpOutpost = lazy(lazyChunks.SettingUpOutpost);
const ConnectingWallet = lazy(lazyChunks.ConnectingWallet);
const UsingContentCalendar = lazy(lazyChunks.UsingContentCalendar);
const EncryptedMessages = lazy(lazyChunks.EncryptedMessages);
const PublishingPrivacy = lazy(lazyChunks.PublishingPrivacy);
const ManagingCrew = lazy(lazyChunks.ManagingCrew);
const WhyDecentralization = lazy(lazyChunks.WhyDecentralization);
const WotVsAlgorithms = lazy(lazyChunks.WotVsAlgorithms);
const RelayCommunities = lazy(lazyChunks.RelayCommunities);
const DataSovereignty = lazy(lazyChunks.DataSovereignty);
const WhereNostrIsHeading = lazy(lazyChunks.WhereNostrIsHeading);
const NostrVsAlternatives = lazy(lazyChunks.NostrVsAlternatives);
const LazyOutpostFeedBrowser = lazy(() => lazyNamed(() => import("@/pages/Outposts"), "OutpostFeedBrowser"));
const ConcordOutpostLazy = lazy(() => lazyRetry(() => import("@/pages/ConcordOutpost")));
function LazyConcordOutpost({ communityId }: { communityId: string }) {
  return <Suspense fallback={null}><ConcordOutpostLazy communityId={communityId} /></Suspense>;
}
const ConcordInviteAcceptLazy = lazy(() => lazyRetry(() => import("@/pages/ConcordInviteAccept")));
function LazyConcordInviteAccept({ naddr }: { naddr: string }) {
  return <Suspense fallback={null}><ConcordInviteAcceptLazy naddr={naddr} /></Suspense>;
}

// App-shell components moved off the eager entry chunk. Each is either
// mount-gated (HeaderAudioPlayer only renders while audio is active),
// guest-only (share-link previews for logged-out visitors), or an overlay that
// renders null for signed-in users (GalaxyWarpOverlay) — none belong on the
// signed-in first-paint critical path. HeaderAudioPlayer and GalaxyWarpOverlay
// in particular dragged NostrPost/ZapDialog/AudioFeed and the whole
// login/onboarding tree into the entry bundle via static imports.
const GuestChannelPreview = lazy(() => lazyNamed(() => import("@/components/GuestChannelPreview"), "GuestChannelPreview"));
const GuestNotePreview = lazy(() => lazyNamed(() => import("@/components/GuestNotePreview"), "GuestNotePreview"));
const GuestProfilePreview = lazy(() => lazyNamed(() => import("@/components/GuestProfilePreview"), "GuestProfilePreview"));
const GuestArticlePreview = lazy(() => lazyNamed(() => import("@/components/GuestArticlePreview"), "GuestArticlePreview"));
const GuestDiscussionPreview = lazy(() => lazyNamed(() => import("@/components/GuestDiscussionPreview"), "GuestDiscussionPreview"));
const GalaxyWarpOverlay = lazy(() => lazyNamed(() => import("@/components/GalaxyWarpOverlay"), "GalaxyWarpOverlay"));
const HeaderAudioPlayer = lazy(() => lazyNamed(() => import("@/components/HeaderAudioPlayer"), "HeaderAudioPlayer"));

function OutpostDetail({ relayEncoded }: { relayEncoded: string }) {
  const relayUrl = decodeURIComponent(relayEncoded);
  return <LazyOutpostFeedBrowser relayUrl={relayUrl} />;
}

// Permanent client-side redirect for routes that moved into a consolidated hub
// (media pages -> Search Media tab; utility pages -> Command Post). Keeps old
// bookmarks/links working.
function RouteRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to, { replace: true });
  }, [to, setLocation]);
  return <LazyFallback />;
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

if (typeof window !== "undefined") {
  const conn = "connection" in navigator
    ? (navigator as Navigator & { connection: NetworkInformation }).connection
    : undefined;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  // Constrained devices (metered/slow connection or ≤4GB RAM — most budget phones)
  // prefetch nothing; routes still load on demand via lazyRetry. This avoids
  // burning data/CPU in the background on exactly the devices we want to keep light.
  const skipPrefetch =
    conn?.saveData ||
    ["slow-2g", "2g", "3g"].includes(conn?.effectiveType || "") ||
    (typeof deviceMemory === "number" && deviceMemory <= 4);

  if (!skipPrefetch) {
    // Capable devices prefetch only the few routes users hit next — not all 48
    // chunks (which re-downloaded the whole app and bloated memory/data).
    const HOT_ROUTES: (keyof typeof lazyChunks)[] = ["Home", "Search", "Notifications", "Profile", "Messages", "Outposts"];
    const prefetchDelay = window.innerWidth < 768 ? 45000 : 30000;
    let prefetched = false;
    const doPrefetch = () => {
      if (prefetched) return;
      prefetched = true;
      document.removeEventListener("visibilitychange", onVisible);
      HOT_ROUTES.forEach((k) => lazyChunks[k]?.());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") doPrefetch();
    };
    const prefetchTimer = setTimeout(() => {
      if (document.visibilityState === "hidden") {
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      doPrefetch();
    }, prefetchDelay);
    if (import.meta.hot) {
      import.meta.hot.dispose(() => { clearTimeout(prefetchTimer); document.removeEventListener("visibilitychange", onVisible); });
    }
  }
}

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px] animate-in fade-in duration-300">
      <div className="flex flex-col items-center gap-2">
        <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
      </div>
    </div>
  );
}

function RouteErrorFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 gap-3 text-center">
      <p className="text-neutral-500 text-sm">Something went wrong loading this page.</p>
      <p className="text-neutral-600 text-xs max-w-sm">
        If the app was recently updated, reloading usually fixes it.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
      >
        Reload
      </button>
    </div>
  );
}

function LandingRedirect() {
  const [location, setLocation] = useLocation();
  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (location !== "/") return;
    try {
      if (sessionStorage.getItem("relay-outpost-landing-redirected") === "1") return;
      const saved = localStorage.getItem("relay-outpost-default-landing-page");
      sessionStorage.setItem("relay-outpost-landing-redirected", "1");
      // Default landing is the home feed ("/") so users land on populated signal
      // right away (new accounts auto-follow curated seeds, so Following isn't
      // empty). Users can override the destination from Settings.
      const dest = saved && saved.startsWith("/") ? saved : "/";
      if (dest !== "/") {
        setLocation(dest, { replace: true });
      }
    } catch {}
  }, [location, setLocation]);
  return null;
}

function Router() {
  const [location] = useLocation();
  const routeBase = location.split("/").slice(0, 2).join("/");
  return (
    <ErrorBoundary key={routeBase} fallback={<RouteErrorFallback />}>
      <Suspense fallback={<LazyFallback />}>
        <Switch>
        <Route path="/" component={Home} />
        <Route path="/discover" component={Discover} />
        <Route path="/marketplace" component={Marketplace} />
        <Route path="/generator" component={Generator} />
        <Route path="/following">{() => <RouteRedirect to="/account?tab=crew" />}</Route>
        <Route path="/followers">{() => <RouteRedirect to="/account?tab=orbit" />}</Route>
        <Route path="/profile/:npub" component={Profile} />
        <Route path="/bookmarks">{() => <RouteRedirect to="/account?tab=bookmarks" />}</Route>
        <Route path="/search" component={Search} />
        <Route path="/settings" component={Settings} />
        <Route path="/settings/danger" component={SettingsDanger} />
        {/* /account is the user's own account dashboard (MyOutpost); the mobile
            grouped-rows account menu now lives under /account/menu. */}
        <Route path="/account/menu" component={Account} />
        <Route path="/account" component={MyOutpost} />
        <Route path="/tickets" component={MyTickets} />
        <Route path="/recover-follows" component={RecoverFollows} />
        <Route path="/follow-list" component={RecoverFollows} />
        <Route path="/trust-reviews" component={TrustReviews} />
        <Route path="/media-servers" component={MediaServers} />
        <Route path="/muted" component={MuteList} />
        <Route path="/key-backup" component={KeyBackup} />
        <Route path="/shield-matrix">{() => <RouteRedirect to="/account?tab=shield" />}</Route>
        <Route path="/help/first-10-minutes" component={FirstTenMinutes} />
        <Route path="/help/setting-up-outpost" component={SettingUpOutpost} />
        <Route path="/help/connecting-wallet" component={ConnectingWallet} />
        <Route path="/help/content-calendar" component={UsingContentCalendar} />
        <Route path="/help/encrypted-messages" component={EncryptedMessages} />
        <Route path="/help/publishing-privacy" component={PublishingPrivacy} />
        <Route path="/help/managing-crew" component={ManagingCrew} />
        <Route path="/help/why-decentralization" component={WhyDecentralization} />
        <Route path="/help/wot-vs-algorithms" component={WotVsAlgorithms} />
        <Route path="/help/relay-communities" component={RelayCommunities} />
        <Route path="/help/data-sovereignty" component={DataSovereignty} />
        <Route path="/help/where-nostr-is-heading" component={WhereNostrIsHeading} />
        <Route path="/help/nostr-vs-alternatives" component={NostrVsAlternatives} />
        <Route path="/whats-new" component={WhatsNew} />
        <Route path="/help" component={WtfIsThis} />
        {/* Legacy /wtf links → /help (keeps old bookmarks/shares working) */}
        <Route path="/wtf/:rest*">{(params) => <RouteRedirect to={`/help/${(params as { rest?: string }).rest ?? ""}`} />}</Route>
        <Route path="/wtf">{() => <RouteRedirect to="/help" />}</Route>
        <Route path="/images">{() => <RouteRedirect to="/search?tab=media&type=images" />}</Route>
        <Route path="/videos">{() => <RouteRedirect to="/search?tab=media&type=videos" />}</Route>
        <Route path="/audio">{() => <RouteRedirect to="/search?tab=media&type=audio" />}</Route>
        <Route path="/articles/write" component={ArticleEditor} />
        <Route path="/articles/:naddr" component={ArticleDetail} />
        {/* The real page again: a Discover tile labelled Articles must land on
            Articles, not inside search chrome. Stays AFTER /articles/write and
            /articles/:naddr — wouter's Switch is first-match. */}
        <Route path="/articles">{() => <ArticlesFeed />}</Route>
        <Route path="/rss">{() => <RouteRedirect to="/news" />}</Route>
        {/* /news is the External-Discussion share/funnel entry (…/news?discuss=<anchor>).
            Redirect into the News reader, PRESERVING the query so RSSFeed's
            ?discuss= handler opens the link's Discussion tab. */}
        {/* /news switches on the trending flag (ro_news_trending, default
            off): the new trending front page when on, the proven reader when
            off. Both are lazy; the switch lives in NewsRoute so flipping the
            flag remounts the right subtree. RSSFeed's ?discuss=/?item= handlers
            are path-agnostic and unaffected. */}
        <Route path="/news">{() => <NewsRoute />}</Route>
        <Route path="/wallet">{() => <RouteRedirect to="/account?tab=wallet" />}</Route>
        <Route path="/messages" component={Messages} />
        <Route path="/messages/:id" component={Messages} />
        <Route path="/console/dashboard">{() => <RouteRedirect to="/account?tab=analytics" />}</Route>
        <Route path="/console">{() => {
          // Preserve the deep-link query (?filter=…&relay=…) built by the Feedback
          // hand-offs (FeedbackDrawer, relay-ops FeedbackTab) and the post / relay /
          // profile entry points — the embedded console reads it on mount. A
          // hardcoded target dropped these params, so hand-offs landed on an
          // empty console.
          const sp = new URLSearchParams(window.location.search);
          sp.set("tab", "console");
          return <RouteRedirect to={`/account?${sp.toString()}`} />;
        }}</Route>
        <Route path="/thread/:noteId" component={Thread} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/relay-ops-center/:relayEncoded">{(params) => <RelayOpsCenter relayUrl={decodeURIComponent(params.relayEncoded)} />}</Route>
        <Route path="/relays/admin" component={RelayOpsCenter} />
        <Route path="/relays" component={RelayDashboard} />
        <Route path="/tools" component={Tools} />
        <Route path="/outposts" component={Outposts} />
        <Route path="/outposts/c/:communityId">{(params) => <LazyConcordOutpost communityId={params.communityId} />}</Route>
        <Route path="/invite/:naddr">{(params) => <LazyConcordInviteAccept naddr={params.naddr} />}</Route>
        <Route path="/outposts/:relayEncoded">{(params) => <OutpostDetail relayEncoded={params.relayEncoded} />}</Route>
        {/* Legacy slug — the own-account page moved to /account when "outpost"
            was rebranded to Communities. Preserve query (?tab=…) and hash so
            old bookmarks, NIP-78-synced landing-page values, and deep links
            keep working. */}
        <Route path="/outpost">{() => <RouteRedirect to={`/account${window.location.search}${window.location.hash}`} />}</Route>
        <Route path="/calendar" component={ContentCalendar} />
        <Route path="/community/:naddr" component={Community} />
        <Route path="/live/:naddr" component={LiveStreams} />
        {/* The streams page, restored (owner request 2026-08-15): the list view
            inside LiveStreams was the old /live page and never left — it only
            lost its route to the IA-collapse redirect. Discover's Live tile
            and the stream detail's cold-entry back both land here now; the
            Search Live tab remains for search-context arrivals. */}
        <Route path="/live" component={LiveStreams} />
        <Route component={NotFound} />
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}

function ScrollToTop({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  // The app's main scroll container: it owns token minting and the global
  // restore-window flags that VirtualFeed / Home read. Nested page containers
  // (e.g. Profile) call the same hook with their own keySuffix — see
  // hooks/use-scroll-restore.ts.
  useScrollRestore(containerRef, { driveGlobalWindow: true });
  return null;
}

function useScrollHide(containerRef: React.RefObject<HTMLElement | null>) {
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);
  const accumulated = useRef(0);
  const ticking = useRef(false);

  const HIDE_THRESHOLD = 40;
  const SHOW_THRESHOLD = 25;

  const handleScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;

    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) { ticking.current = false; return; }

      const currentY = el.scrollTop;
      const delta = currentY - lastScrollY.current;

      if (currentY <= 30) {
        setHidden(false);
        accumulated.current = 0;
      } else if (delta > 0) {
        accumulated.current = Math.max(0, accumulated.current + delta);
        if (accumulated.current > HIDE_THRESHOLD) {
          setHidden(true);
        }
      } else if (delta < 0) {
        accumulated.current = Math.min(0, accumulated.current + delta);
        if (accumulated.current < -SHOW_THRESHOLD) {
          setHidden(false);
        }
      }

      lastScrollY.current = currentY;
      ticking.current = false;
    });
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [containerRef, handleScroll]);

  return hidden;
}

function MobileSidebarTrigger() {
  // Mobile-only trigger (md:hidden): opens the full-screen Orbit menu instead
  // of the old slide-out Sheet. Desktop keeps the shadcn sidebar untouched.
  //
  // THE MARK, ALWAYS — never the signed-in user's avatar. Your own face already
  // has exactly one home on a phone: the You tab in the footer. Putting it in
  // the top-left too meant two of the same photo on screen at all times, and on
  // someone else's profile a THIRD face, yours, sitting beside theirs. Anchoring
  // the corner with the app mark instead matches desktop, says "you are in Relay
  // Outpost" rather than "you are you", and deletes ~70 lines of :has() CSS that
  // existed only to guess when the avatar would clash with the page.
  return (
    <button
      onClick={openOrbitMenu}
      aria-label="Open menu"
      className="flex items-center gap-2 -ml-1 px-1.5 py-1 rounded-md hover-elevate md:hidden"
      data-testid="button-mobile-sidebar-trigger"
    >
      {/* Theme foreground on normal chrome; the on-banner white + legibility
          shadow is applied by the .header-trigger-mark rule in index.css. */}
      <BrandMark className="header-trigger-mark w-9 h-9 text-brand/80 dark:text-white/85" />
    </button>
  );
}

const TOP_LEVEL_ROUTES = new Set([
  "/", "/discover", "/search", "/notifications", "/messages", "/outpost", "/outposts",
  "/images", "/videos", "/audio", "/articles", "/rss", "/news",
  "/bookmarks", "/following", "/followers", "/wallet", "/relays", "/tools", "/console", "/console/dashboard", "/settings", "/shield-matrix", "/help", "/live",
  // The You tab's destination (nav-destinations id "you"): a bottom-bar root
  // carries no chrome back — the tab bar IS the way back (ChatList precedent,
  // 2026-08-18).
  "/account/menu",
]);

function isTopLevelRoute(path: string) {
  return TOP_LEVEL_ROUTES.has(path);
}

/**
 * Conversation routes that render their OWN back button, right beside the
 * person or channel it dismisses.
 *
 * Two back arrows were stacked about 160px apart on a phone — one here in the
 * app bar, one in the conversation header below it. The conversation's own back
 * is the one to keep: it goes to a fixed destination (Chats) rather than
 * wherever history happens to lead, it sits next to the thing it closes the way
 * every messaging app puts it, and it is a full 44px target. So this one steps
 * aside rather than the other way round — no change to what Back DOES, only to
 * how many of them there are.
 *
 * PHONE ONLY. The group chat's own back row is md:hidden, so standing down at
 * every width would leave the desktop group view with no back at all.
 */
const OWNS_ITS_BACK = [/^\/messages(\/|$)/, /^\/outposts\/c\//];

function HeaderBackButton() {
  const [location] = useLocation();
  const goBack = useGoBack();
  const isMobile = useIsMobile();

  if (isTopLevelRoute(location)) return null;
  if (isMobile && OWNS_ITS_BACK.some((re) => re.test(location))) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0 w-9 h-9 rounded-full"
      onClick={() => goBack(parentRouteOf(location) ?? (isIaCollapsed() ? "/messages" : "/"))}
      data-testid="button-header-back"
    >
      <ArrowLeft className="w-4 h-4" />
    </Button>
  );
}

function DesktopBackButton() {
  const [location] = useLocation();
  const goBack = useGoBack();
  const { state, isMobile } = useSidebar();
  const classicSidebar = useClassicSidebar();
  const isCollapsed = state === "collapsed";
  // In rail mode the header shows its own Back button, so this in-content row
  // would double up.
  const railActive = !isMobile && !classicSidebar;

  if (isTopLevelRoute(location) || isCollapsed || isMobile || railActive) return null;

  // Profile pages carry their own back chip inside the banner strip (see
  // Profile.tsx) — a standalone Back row above it would be a wasted row.
  if (location.startsWith("/profile/")) return null;

  return (
    <div className="sticky top-2 z-40 flex items-center px-3 pt-2">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => goBack(parentRouteOf(location) ?? (isIaCollapsed() ? "/messages" : "/"))}
        data-testid="button-desktop-back"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </Button>
    </div>
  );
}

function useSwipeNavigation(containerRef: React.RefObject<HTMLElement | null>) {
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const goBack = useGoBack();
  // The app's root differs by IA (collapsed lands on Chats); a swipe with
  // nothing to pop should land THERE, not push the feed on top of the root.
  const iaCollapsed = useIaCollapsed();
  const fallbackRef = useRef("/");
  fallbackRef.current = iaCollapsed ? "/messages" : "/";

  useEffect(() => {
    // iOS standalone PWA ONLY. Everywhere else the platform already turns this
    // gesture into history.back() (Safari's chrome swipe, Android's system
    // gesture), and running ours on top made ONE swipe navigate back TWICE —
    // the "back skips where I should return" report. See edge-swipe.ts.
    if (!shouldAttachCustomBackSwipe(detectBackGestureEnv())) return;
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // A rightward flick that STARTS inside a horizontal scroller (the chat
      // filter chips, the people strip, the podcasts rail — several now live
      // near the left edge) is scrolling, not a back gesture. Walk up from
      // the touch target; any scrollable-x ancestor claims the gesture.
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 1) {
          const o = getComputedStyle(el).overflowX;
          if (o === "auto" || o === "scroll") { touchStartRef.current = null; return; }
        }
        el = el.parentElement;
      }
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start || e.changedTouches.length !== 1) return;
      const touch = e.changedTouches[0];
      if (!isEdgeBackSwipe({
        startX: start.x,
        dx: touch.clientX - start.x,
        dy: touch.clientY - start.y,
        elapsedMs: Date.now() - start.time,
      })) return;
      // goBack() decides via the in-app history index (lib/app-history.ts) —
      // pop when the previous entry is ours, no-op at the app's root. NEVER
      // history.length: it counts the whole tab session and was the PWA
      // blank-screen bug.
      goBack(fallbackRef.current);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [containerRef, goBack]);
}


function ZapToastIcon({ isIncoming, profilePic, profileName }: {
  isIncoming: boolean;
  profilePic: string | null;
  profileName: string | null;
}) {
  return (
    <div className="relative shrink-0">
      <Avatar className="w-9 h-9 border border-brand/20">
        {profilePic ? (
          <AvatarImage src={profilePic} alt={profileName || ""} />
        ) : null}
        <AvatarFallback className="bg-brand/10 text-brand text-xs">
          {profileName ? profileName.slice(0, 2).toUpperCase() : "⚡"}
        </AvatarFallback>
      </Avatar>
      <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center ${
        isIncoming ? "bg-emerald-500" : "bg-amber-500"
      }`}>
        {isIncoming
          ? <ArrowDownLeft className="w-2.5 h-2.5 text-white" />
          : <ArrowUpRight className="w-2.5 h-2.5 text-white" />
        }
      </div>
    </div>
  );
}

function ZapToastContent({ amountSats, isIncoming, message, profileName }: {
  amountSats: number;
  isIncoming: boolean;
  message: string;
  profileName: string | null;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        {profileName && (
          <span className="text-sm font-semibold text-foreground/90 truncate max-w-[140px]">{profileName}</span>
        )}
        <span className={`text-sm font-semibold tabular-nums ${
          isIncoming ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400"
        }`}>
          {isIncoming ? "+" : "-"}{amountSats.toLocaleString()} sats
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
        {isIncoming ? "Received zap" : "Sent zap"}
        {profileName && (isIncoming ? ` from ${profileName}` : ` to ${profileName}`)}
      </p>
      {message && (
        <p className="text-[11px] text-muted-foreground/70 italic truncate mt-0.5">"{message}"</p>
      )}
    </div>
  );
}

function ZapNotificationWatcher() {
  const { isConnected, subscribeToNewTransactions, unsubscribeFromNewTransactions } = useNWC();
  const { toast } = useToast();
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    if (!isConnected) return;
    const timers = pendingTimersRef.current;

    const handleNewTx = (tx: NWCTransaction) => {
      const amountSats = Math.floor((tx.amount || 0) / 1000);
      const isIncoming = tx.type === "incoming";

      let message = "";
      let counterpartyPubkey: string | null = null;

      if (tx.description) {
        try {
          const parsed = JSON.parse(tx.description);
          if (parsed.kind === 9734) {
            if (parsed.content) message = parsed.content;
            if (isIncoming && parsed.pubkey) {
              counterpartyPubkey = parsed.pubkey;
            }
            if (!isIncoming) {
              const pTag = (parsed.tags || []).find((t: string[]) => t[0] === "p");
              if (pTag?.[1]) counterpartyPubkey = pTag[1];
            }
          } else {
            if (parsed.pubkey && typeof parsed.pubkey === "string" && parsed.pubkey.length === 64) {
              counterpartyPubkey = isIncoming ? parsed.pubkey : null;
            }
            if (!isIncoming && parsed.tags && Array.isArray(parsed.tags)) {
              const pTag = parsed.tags.find((t: string[]) => t[0] === "p");
              if (pTag?.[1]) counterpartyPubkey = pTag[1];
            }
            if (parsed.content && typeof parsed.content === "string") message = parsed.content;
          }
        } catch {
          if (!tx.description.startsWith("{")) message = tx.description;
        }
      }
      if (message.length > 60) message = message.slice(0, 60) + "…";

      let profileName: string | null = null;
      let profilePic: string | null = null;

      if (counterpartyPubkey) {
        const cached = eventStore.getReplaceable(KIND_METADATA, counterpartyPubkey);
        if (cached) {
          const content = getProfileContent(cached);
          profileName = content.display_name || content.name || null;
          profilePic = content.picture || null;
        }
        if (!profileName) {
          profileName = counterpartyPubkey.slice(0, 8) + "…";
        }
      }

      const { update: updateToast } = toast({
        title: (
          <ZapToastContent
            amountSats={amountSats}
            isIncoming={isIncoming}
            message={message}
            profileName={profileName}
          />
        ),
        customIcon: (
          <ZapToastIcon
            isIncoming={isIncoming}
            profilePic={profilePic}
            profileName={profileName}
          />
        ),
      });

      if (counterpartyPubkey && (!profilePic || !profileName || profileName === counterpartyPubkey.slice(0, 8) + "…")) {
        fetchProfilesCached([counterpartyPubkey]);
        let cancelled = false;
        const checkProfile = (attempt: number) => {
          if (cancelled) return;
          const evt = eventStore.getReplaceable(KIND_METADATA, counterpartyPubkey!);
          if (evt) {
            const content = getProfileContent(evt);
            const name = content.display_name || content.name || counterpartyPubkey!.slice(0, 8) + "…";
            const pic = content.picture || null;
            if (pic || name !== counterpartyPubkey!.slice(0, 8) + "…") {
              updateToast({
                id: "",
                title: (
                  <ZapToastContent
                    amountSats={amountSats}
                    isIncoming={isIncoming}
                    message={message}
                    profileName={name}
                  />
                ),
                customIcon: (
                  <ZapToastIcon
                    isIncoming={isIncoming}
                    profilePic={pic}
                    profileName={name}
                  />
                ),
              });
              return;
            }
          }
          if (attempt < 7) {
            const delay = Math.min(300 * Math.pow(1.5, attempt), 2000);
            const tid = setTimeout(() => {
              timers.delete(tid);
              checkProfile(attempt + 1);
            }, delay);
            timers.add(tid);
          }
        };
        const initTid = setTimeout(() => {
          timers.delete(initTid);
          checkProfile(0);
        }, 150);
        timers.add(initTid);
      }
    };

    subscribeToNewTransactions(handleNewTx);
    return () => {
      unsubscribeFromNewTransactions(handleNewTx);
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [isConnected, subscribeToNewTransactions, unsubscribeFromNewTransactions, toast]);

  return null;
}

const HeaderBar = memo(function HeaderBar({ scrollHidden }: { scrollHidden: boolean }) {
  const { state, isMobile } = useSidebar();
  const classicSidebar = useClassicSidebar();
  // Desktop Stories rail: the labeled sidebar is gone, so the top header must
  // stay visible (it hosts search / the bell / the identity portal) and offset
  // by the slim rail's width instead of the sidebar's.
  const railActive = !isMobile && !classicSidebar;
  const isCollapsed = state === "collapsed";
  const { isReading, inline } = useTTS();
  const { unreadCount } = useNotifications();
  const { currentTrack } = useAudioPlayer();
  const hasHeaderAudio = (isReading && !inline) || !!currentTrack;

  // A "sticky" version of `hasHeaderAudio` that flips on immediately when
  // audio starts but waits ~600ms before flipping off. Without this, brief
  // transitions (track changes, the sidebar collapse animation while audio
  // is loading, currentTrack flickering) can make the early-return below
  // momentarily fire and unmount the player mid-interaction — which is
  // what users see as "the music player disappeared when I opened the
  // sidebar". The sticky flag also keeps the popover panel mounted while
  // the user is interacting with it.
  const [stickyHasAudio, setStickyHasAudio] = useState(hasHeaderAudio);
  useEffect(() => {
    if (hasHeaderAudio) {
      setStickyHasAudio(true);
      return;
    }
    const t = setTimeout(() => setStickyHasAudio(false), 600);
    return () => clearTimeout(t);
  }, [hasHeaderAudio]);

  // In rail mode the sidebar never counts as "expanded" — the header owns the
  // chrome (search/bell/identity) and always renders on desktop.
  const sidebarExpanded = !isCollapsed && !isMobile && !railActive;

  // Identity-portal pages (profile/account) fill the header with the avatar ·
  // name · action cluster plus their own action icons — adding the bell there
  // overcrowds the bar (8 controls on mobile). The bell steps back on those
  // routes; Alerts stays one tap away via the menu's story ring.
  // NOTE: this hook must stay ABOVE the early return below — hooks after a
  // conditional return change the hook order when the condition flips and
  // crash the whole tree ("Rendered fewer hooks than expected").
  const [headerLocation] = useLocation();
  const identityPortalActive = headerLocation.startsWith("/profile/") || headerLocation === "/account";
  // Same rule — must stay above the early return.
  const iaCollapsed = useIaCollapsed();

  if (sidebarExpanded && !stickyHasAudio) return null;

  const effectiveScrollHidden = scrollHidden && !stickyHasAudio;

  // Notifications moved out of the mobile bottom nav — they live here as a
  // header bell beside Search, on mobile and desktop. The bell speaks the
  // app's "glow = new" light-language (same story-ring vocabulary as the
  // Stories rail): at rest (zero unread) it stays put but RECEDES — dimmed
  // icon inside a thin violet-alpha hairline ring, part of the chrome. With
  // unread it lights up: full-opacity icon, the count pill, and a glowing
  // violet conic story-ring. The ring is one masked-border layer (padding
  // trick — background shows only in the 1.5px padding band), no filters or
  // blurred shadows; the slow spin is transform-only and turns off under
  // prefers-reduced-motion, leaving a static glow (see index.css).
  const bellLit = unreadCount > 0;
  // ...but only while notifications have no nav entry of their own. The
  // collapsed IA promotes them to Activity — a destination in both the rail and
  // the footer — so keeping the bell would put two differently-named controls
  // for one route on screen at once, including while you are already on it.
  // Expanded IA keeps the bell: there it is the only way in.
  const notificationsBell = iaCollapsed ? null : (
    <Link
      href="/notifications"
      aria-label="Notifications"
      className={`relative flex shrink-0 items-center justify-center w-9 h-9 rounded-full transition-colors hover:bg-muted/50 ${
        bellLit ? "text-foreground/90 hover:text-foreground" : "text-foreground/45 hover:text-foreground/70"
      }`}
      data-testid="header-notifications"
    >
      {/* Invisible hit-area extender: the visible circle is 36px to match the
          header's other icon buttons; this pads taps out to 44px. */}
      <span className="absolute -inset-1 rounded-full" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full pointer-events-none ${bellLit ? "header-bell-ring-spin" : ""}`}
        style={{
          padding: bellLit ? "1.5px" : "1px",
          background: bellLit
            ? "conic-gradient(from 0deg, #7c3aed, #a855f7 26%, rgba(168,85,247,0.35) 50%, #a855f7 72%, #7c3aed)"
            : "rgba(150,120,255,0.18)",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          maskComposite: "exclude",
        }}
        data-testid={bellLit ? "header-notifications-ring-live" : "header-notifications-ring-quiet"}
      />
      <NotificationIcon className="w-5 h-5" />
      {bellLit && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1" data-testid="header-notification-badge">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );

  return (
    <header
      className={`fixed top-0 right-0 z-50 flex items-center gap-1.5 px-3 h-[4.25rem] md:h-12 md:gap-3 md:px-3 border-b border-border/40 bg-background md:bg-sidebar/90 md:backdrop-blur-md transition-all ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none ${
        railActive
          ? "left-0 md:left-[4.25rem]"
          : sidebarExpanded
            ? "md:left-[var(--sidebar-width)]"
            : "left-0 md:pl-[calc(var(--sidebar-width-icon)+0.75rem)]"
      } ${
        effectiveScrollHidden
          ? "-translate-y-full opacity-0 pointer-events-none duration-300"
          : "translate-y-0 opacity-100 duration-300"
      }`}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      id="app-header"
      data-testid="header-bar"
    >
      <MobileSidebarTrigger />
      {!sidebarExpanded && !railActive && (
        <SidebarTrigger data-testid="button-sidebar-toggle" className="hidden md:flex -ml-2.5 sm:-ml-3.5 text-brand dark:text-white/90 [&_svg]:drop-shadow-none dark:[&_svg]:drop-shadow-[0_0_4px_rgba(255,255,255,0.3)]" />
      )}
      {!sidebarExpanded && <HeaderBackButton />}
      {/* Identity slot: profile/account pages portal "avatar · name · action · ⌄"
          in here (see Profile/MyOutpost), replacing their old banner strip. Empty
          it's the header's flex spacer. When the audio player is docked the slot
          shrinks and its content collapses to avatar-only via group-data CSS —
          audio keeps its controls, identity stays one tap from the expanded block. */}
      <div
        id="header-identity-slot"
        data-audio={stickyHasAudio ? "true" : undefined}
        className={`group flex items-center min-w-0 ${stickyHasAudio ? "shrink-0" : "flex-1"}`}
        data-testid="header-identity-slot"
      />
      {stickyHasAudio ? (
        // Use the sticky flag here too. Otherwise a brief drop in
        // `hasHeaderAudio` (track change, currentTrack flicker mid-load)
        // unmounts <HeaderAudioPlayer />, tearing down its popover and
        // any in-progress user interaction with it. The sticky flag keeps
        // the player mounted across these short gaps.
        <div className="flex items-center gap-1 md:gap-1.5 min-w-0 flex-1">
          <div className="flex-1 hidden md:block" />
          <Link href="/search" aria-label="Search" onClick={() => primeKeyboard()} className="flex shrink-0 items-center justify-center w-9 h-9 rounded-full text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors" data-testid="mobile-header-search-audio">
            <SearchIcon className="w-5 h-5" />
          </Link>
          {!identityPortalActive && notificationsBell}
          <RelayHubHeaderControl />
          {!sidebarExpanded && <div className="hidden md:flex"><UnifiedBtcBadge /></div>}
          {/* Own boundary: while the lazy chunk loads (first audio play), the
              header simply renders without the player instead of suspending the
              whole app shell up to the root fallback. */}
          <Suspense fallback={null}><HeaderAudioPlayer /></Suspense>
        </div>
      ) : (
        <>
          <Link href="/search" aria-label="Search" onClick={() => primeKeyboard()} className="flex items-center justify-center w-9 h-9 rounded-full text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors" data-testid="mobile-header-search">
            <SearchIcon className="w-5 h-5" />
          </Link>
          {!identityPortalActive && notificationsBell}
          <RelayHubHeaderControl />
          <UnifiedBtcBadge />
        </>
      )}
    </header>
  );
});

function useScrollSaver() {}

function AppContent({ mainRef, scrollHidden }: { mainRef: React.RefObject<HTMLElement>; scrollHidden: boolean }) {
  const { state: sidebarState, isMobile: sidebarIsMobile } = useSidebar();
  const { isReading, inline } = useTTS();
  const { currentTrack } = useAudioPlayer();
  const hasAudioActive = (isReading && !inline) || !!currentTrack;
  // Mirror HeaderBar's sticky audio behavior so the main content's
  // `headerVisible` padding stays in sync with whether the header is
  // actually rendered (avoids a brief content jump on transitions).
  const [stickyAudioActive, setStickyAudioActive] = useState(hasAudioActive);
  useEffect(() => {
    if (hasAudioActive) {
      setStickyAudioActive(true);
      return;
    }
    const t = setTimeout(() => setStickyAudioActive(false), 600);
    return () => clearTimeout(t);
  }, [hasAudioActive]);
  // Desktop Stories rail is the default primary chrome; "Classic sidebar" (a
  // desktop-only escape hatch) swaps back to the old AppSidebar. Mobile always
  // keeps AppSidebar (its Sheet) so the mobile chrome is untouched.
  const classicSidebar = useClassicSidebar();
  const railActive = !sidebarIsMobile && !classicSidebar;
  // In rail mode the header always renders on desktop (it owns search/bell/
  // identity), so the main content keeps its top padding.
  const headerVisible = railActive || sidebarState === "collapsed" || sidebarIsMobile || stickyAudioActive;

  return (
    <div className="flex h-[100dvh] w-full">
      {classicSidebar || sidebarIsMobile ? <AppSidebar /> : <DesktopStoriesRail />}
      <div className="flex flex-col flex-1 min-w-0 relative">
        <HeaderBar scrollHidden={scrollHidden} />
        <main ref={mainRef} className={`relative z-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain feed-scroll-container pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-8 pt-[calc(4.25rem+env(safe-area-inset-top,0px))] ${headerVisible ? "md:pt-12" : "md:pt-0"}`}>
          <ScrollToTop containerRef={mainRef} />
          <SignerDisconnectedBanner />
          <DesktopBackButton />
          <PullToRefresh onRefresh={async () => { await queryClient.invalidateQueries(); window.dispatchEvent(new CustomEvent("nostr-soft-refresh")); }} scrollContainerSelector="main">
            <LandingRedirect />
            <Router />
          </PullToRefresh>
        </main>
      </div>
      <ScrollToTopButton containerRef={mainRef} />
      <ScrollRestoreDebugOverlay />
      <ZapNotificationWatcher />
      <CreatePostFAB />
      <CreateStudio />
      <OrbitMenu />
      <MiniPlayer hidden={scrollHidden} />
      <SpeechReaderBar hidden={scrollHidden} />
      <MobileFooter hidden={scrollHidden} />
      {/* "Update ready · Restart" — only renders on a confirmed new build
          (waiting SW / version poll mismatch). See lib/app-update.ts. */}
      <UpdateReadyPill />
      {/* PWAInstallNudge removed: no auto install popups — installing lives in
          Settings and the Help & Guides install guide. */}
    </div>
  );
}

function AppLayout() {
  useScrollSaver();
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  const mainRef = useRef<HTMLElement>(null);
  const scrollHidden = useScrollHide(mainRef);
  // Swipe-to-navigate disabled: users were accidentally triggering
  // back/forward while scrolling and losing their page. The app has
  // explicit nav controls everywhere this could be useful.
  // Swipe-from-the-left-edge to go back. An installed PWA has no system edge
  // gesture, so without this the only way out of a full-screen thread is one
  // small arrow. The previous attempt was disabled for firing mid-scroll — it
  // matched a horizontal swipe anywhere and ran inverted; isEdgeBackSwipe pins
  // the thresholds that made it misfire (see edge-swipe.test.ts).
  useSwipeNavigation(mainRef);
  const { pubkey, loginMethod, isLoggingIn, isReconnecting } = useNostrAuth();
  useNostrMuteList();
  const [location, navigate] = useLocation();
  const iaCollapsedForLanding = useIaCollapsed();
  const prevPubkeyRef = useRef<string | null | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(!!pubkey || location.startsWith("/help") || location.startsWith("/wtf"));
  // Frictionless onboarding: there is no post-create flow anymore. Account
  // creation itself anchors the follow graph (jack + inviter), enables WoT,
  // and fires the first score calc — new users land straight in the app.
  // On-device scheduler: publish locally-scheduled posts when due (while the app is
  // open). No-op unless the user picked "This device" scheduling. Never hits a server.
  useEffect(() => { setSchedulerPubkey(pubkey ?? null); startLocalScheduleRunner(); }, [pubkey]);
  // Session-survival fallback: if a previous session left an encrypted local
  // account on disk AND the saved login method was "local" but the pubkey
  // is intentionally not auto-restored (Task #292), skip the full launch
  // screen and surface the cockpit overlay (which renders LoginOptions →
  // UnlockScreen). This way an existing local-account user is greeted
  // with the unlock prompt, not the marketing launch screen they have to
  // dismiss before they can sign in. Both conditions must hold so we
  // don't misclassify former extension/bunker sessions where a leftover
  // local blob exists from an earlier flow. Computed once at mount;
  // once they unlock, pubkey hides the overlay entirely.
  const initialLocalUnlockFallback = useMemo<boolean>(() => {
    try {
      if (pubkey) return false;
      const savedMethod = localStorage.getItem(LOGIN_METHOD_KEY);
      if (savedMethod !== "local") return false;
      return !!loadLocalAccount();
    } catch {
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // One-shot: starts true if initial conditions held, clears the moment the
  // user logs in (pubkey becomes non-null) or logs out (so a subsequent
  // logout reverts to normal redirect-to-"/" behavior). Without this, a
  // stale memoized value would permanently suppress the route guard.
  const [localUnlockFallbackActive, setLocalUnlockFallbackActive] = useState<boolean>(initialLocalUnlockFallback);
  useEffect(() => {
    if (localUnlockFallbackActive && pubkey) setLocalUnlockFallbackActive(false);
  }, [pubkey, localUnlockFallbackActive]);
  const [overlayState, setOverlayState] = useState<"full" | "cockpit" | "dimmed" | "warping_to_cockpit">(
    initialLocalUnlockFallback ? "cockpit" : "full",
  );
  const [warpingOut, setWarpingOut] = useState(false);

  const onWtfPage = location.startsWith("/help") || location.startsWith("/wtf");
  // Standalone info/legal pages should be readable directly (e.g. from the
  // landing footer) without the warp overlay covering them.
  const onInfoPage = onWtfPage || location.startsWith("/privacy") || location.startsWith("/covenant") || location.startsWith("/terms");
  // A Concord invite link must show ITS page to a logged-out visitor — the
  // route guard below already renders /invite in place instead of bouncing,
  // but the full-screen launch overlay (opaque, z-100) was still covering it,
  // so recipients saw the marketing landing and the invite looked broken.
  const onInvitePage = location.startsWith("/invite/");
  // /discover is the signed-out visitor's ENTIRE navigation (buildNavDestinations
  // returns only Discover for guests), so the launch overlay must stand aside
  // there — the bento IS the shop window, with its own sign-in row. And the
  // shop window is only a window if its doors open: every tile destination
  // (/news, /articles, the /outposts hub, /search from the universal bar) has
  // to be walkable too, or the bento shows four live lanes that all dead-end
  // at the signup funnel. All four are public content; community DETAIL pages
  // stay gated (joining needs keys), which is why the bar routes guests to the
  // hub instead.
  const onDiscoverPage = location.startsWith("/discover")
    || location === "/news" || location === "/articles" || location === "/outposts"
    || location.startsWith("/search");
  const overlayMode: "full" | "cockpit" | "dimmed" | "hidden" | "warping_to_cockpit" = warpingOut ? "cockpit" : ((pubkey || onInfoPage || onInvitePage || onDiscoverPage) ? "hidden" : overlayState);

  // Introduce logged-out visitors to the Help hub with the nav expanded on
  // desktop (so they can see Search / Feed / News while they read). Auto-opens
  // once when they arrive on /help; a manual collapse afterward is respected.
  // (On mobile the SidebarProvider uses a separate sheet, so this is a no-op there.)
  const autoOpenedHelpRef = useRef(false);
  useEffect(() => {
    if (!pubkey && onWtfPage) {
      if (!autoOpenedHelpRef.current) { setSidebarOpen(true); autoOpenedHelpRef.current = true; }
    } else if (!onWtfPage) {
      autoOpenedHelpRef.current = false;
    }
  }, [pubkey, onWtfPage]);

  useEffect(() => {
    const isFirstMount = prevPubkeyRef.current === undefined;
    const wasLoggedOut = prevPubkeyRef.current === null;
    prevPubkeyRef.current = pubkey ?? null;
    if (pubkey) {
      if (wasLoggedOut && !isFirstMount) {
      // Under the collapsed IA "/search" IS Discover — the surface decision 2
      // deliberately demoted — so this default contradicted Decision 8
      // ("Everyone lands on Chats"). It fires on every null -> pubkey
      // transition inside a mounted shell: unlocking an encrypted local key,
      // signing in through the overlay, AND creating a new account. A brand-new
      // member's first screen after signup was the public firehose.
      //
      // A genuine invite deep link is unaffected: the stashed
      // relay-outpost-post-auth-redirect is consumed later with {replace:true}
      // and wins over whatever this chose.
        let dest = postAuthLandingPath(null, isIaCollapsed());
        try {
          dest = postAuthLandingPath(localStorage.getItem("relay-outpost-default-landing-page"), isIaCollapsed());
          sessionStorage.setItem("relay-outpost-landing-redirected", "1");
          // Keep the two landing ledgers coherent. This path performs an
          // arrival, so the IA rule must not perform a second one later; it
          // wrote only its own key before, leaving `ro_ia_landed` unset.
          markLanded();
        } catch {}
        navigate(dest);
        setSidebarOpen(false);
      }
      if (isFirstMount) {
        setSidebarOpen(false);
      }
      if (overlayState === "warping_to_cockpit") {
        setOverlayState("dimmed");
      }
    } else {
      setSidebarOpen(false);
      // Preserve the local-unlock fallback at first mount: if the user has a
      // saved local account, leave overlayState at its initial "cockpit"
      // value so they see the unlock prompt instead of the full launch
      // screen. On subsequent transitions to logged-out (logout/vanish),
      // always reset to "full".
      if (!(isFirstMount && localUnlockFallbackActive)) {
        setOverlayState("full");
      }
      if (!isFirstMount && !wasLoggedOut) {
        navigate("/");
      }
    }
  }, [pubkey]);

  // Invite capture — UNCONDITIONAL, mount-once, before any auth/unlock gating.
  // A friend opening `/?inviter=…` may be logged out, mid-login, OR (on a device that
  // already has a saved local account) staring at the unlock overlay — and the redirect
  // effect below early-returns in all three cases, which silently dropped the inviter.
  // Capturing here is a harmless sessionStorage write; only the REDIRECT needs guards.
  useEffect(() => {
    try {
      const { inviterHex, relayUrl } = parseInviteParams(window.location.search, window.location.pathname);
      if (inviterHex) sessionStorage.setItem("relay-outpost-inviter", inviterHex);
      if (relayUrl) sessionStorage.setItem("relay-outpost-invite-relay", relayUrl);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everyone lands on Chats (decision 8) — one behaviour for everyone, no
  // new-vs-existing branch. Runs AFTER the invite capture above, and refuses
  // any URL carrying a query string anyway, so `/?inviter=…` is untouched
  // twice over.
  //
  // Deliberately an arrival rule and NOT a redirect on `/`: under the collapsed
  // IA `/` is Discover's own path, so redirecting it would bounce you out of
  // Discover every time you tapped it. Landing is marked per TAB, so a reload
  // while reading Discover keeps you there and a fresh tab lands again.
  //
  // Waits for `pubkey`: sign-in is async, and firing while it is still null
  // would send a returning user to Discover on the one load that was supposed
  // to introduce the new front door.
  useEffect(() => {
    if (!shouldLandOnChats({
      pubkey,
      collapsed: iaCollapsedForLanding,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      landed: hasLanded(),
    })) return;
    markLanded();
    navigate(CHATS_PATH, { replace: true });
  }, [pubkey, iaCollapsedForLanding, navigate]);

  // Guest chat preview: a LOGGED-OUT visitor opening a shared channel deep link
  // (/outposts/<relay>?channel=<id>) gets a slim read-only preview instead of a
  // bounce to the landing page. Keyed on wouter's reactive `location` (pathname)
  // + `guestSearch` (query string) so it tracks both path and ?channel changes.
  // When active, the redirect effect below skips the bounce and AppLayout
  // early-returns <GuestChannelPreview> (so the pubkey-dependent app shell never
  // mounts for the guest).
  const guestSearch = useSearch();
  const guestChannelId = useMemo(() => {
    try { return new URLSearchParams(guestSearch).get("channel"); } catch { return null; }
  }, [guestSearch]);
  const guestRelayUrl = useMemo(() => {
    const m = location.match(/^\/outposts\/([^/?]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }, [location]);
  // Only real identifier prefixes trigger a guest preview (like guestNaddr's naddr1
  // guard) — so a future authed sub-route like /profile/settings falls through to
  // the normal login bounce instead of rendering an empty guest view.
  const guestNoteId = useMemo(() => { const m = location.match(/^\/thread\/((?:note1|nevent1)[a-z0-9]+|[0-9a-f]{64})/i); return m ? m[1] : null; }, [location]);
  const guestNpub = useMemo(() => { const m = location.match(/^\/profile\/((?:npub1|nprofile1)[a-z0-9]+|[0-9a-f]{64})/i); return m ? m[1] : null; }, [location]);
  const guestNaddr = useMemo(() => { const m = location.match(/^\/articles\/(naddr1[a-z0-9]+)/i); return m ? m[1] : null; }, [location]);
  // Shared external-discussion link (`/news?discuss=<anchor>`, which redirects to
  // `/search?tab=media&type=news&discuss=<anchor>`) — a guest opens the read-only
  // discussion preview instead of bouncing to marketing. Read the anchor off the
  // reactive query string so it works on either path, before the RouteRedirect.
  const guestDiscussAnchor = useMemo(() => {
    try {
      const raw = new URLSearchParams(guestSearch).get("discuss");
      return raw && /^https?:\/\//i.test(raw) ? raw : null;
    } catch { return null; }
  }, [guestSearch]);
  const guestPreview = !pubkey && !isLoggingIn && !isReconnecting && (
    (!!guestRelayUrl && !!guestChannelId) || !!guestNoteId || !!guestNpub || !!guestNaddr || !!guestDiscussAnchor
  );

  // Logged-out gating: only the launch screen ("/") and the FAQ ("/help*") are reachable.
  // Anything else bounces back to the launch screen so the cockpit overlay can take over.
  //
  // IMPORTANT — gate on `isLoggingIn` and `isReconnecting`. Without that
  // gate, this effect can fire during the brief commit window where a
  // login flow has set sessionStorage / localStorage but pubkey hasn't
  // yet propagated through the auth context, bouncing a successfully-
  // authenticated user back to "/" before they ever land. This is the
  // observed "kicked out after entering nsec" regression.
  useEffect(() => {
    if (pubkey || isLoggingIn || isReconnecting) return;
    // Local-unlock fallback: a user refreshing on `/account` (or any other
    // app route) with a saved local account should see the unlock overlay
    // *in place* on their current route — don't bounce them to `/` first.
    // The cockpit overlay is rendered above the route, so once they
    // unlock, they stay where they were.
    if (localUnlockFallbackActive) return;

    // Guest channel preview: don't bounce — render the read-only preview in place.
    // Still stash the deep link so signing in returns them to the real channel.
    if (guestPreview) {
      try {
        // Include the hash — Concord invite secrets live in the URL fragment.
        const dest = window.location.pathname + window.location.search + window.location.hash;
        if (dest && dest !== "/") sessionStorage.setItem("relay-outpost-post-auth-redirect", dest);
      } catch {}
      return;
    }

    // Concord invite: render the preview in place (don't bounce to marketing),
    // and remember the FULL url incl. #fragment + mark it pending so onboarding
    // is skipped and the invite auto-joins once the new account exists.
    if (window.location.pathname.startsWith("/invite/")) {
      try {
        const dest = window.location.pathname + window.location.search + window.location.hash;
        sessionStorage.setItem("relay-outpost-post-auth-redirect", dest);
        sessionStorage.setItem("relay-outpost-concord-invite-pending", "1");
      } catch {}
      return;
    }

    // The Discover-bento lanes are all public reads — see onDiscoverPage above
    // for why each is listed. Detail pages under them are NOT: /outposts/<url>
    // still gates, /articles/<naddr> has its own guest preview.
    const isAllowed = location === "/" || location === "/discover" || location === "/news" || location === "/articles" || location === "/outposts" || location.startsWith("/search") || location === "/login" || location.startsWith("/help") || location.startsWith("/wtf") || location === "/privacy" || location === "/covenant" || location === "/terms";
    if (!isAllowed) {
      // Remember where they were headed (e.g. an invite / deep link with its
      // ?tab=…&channel=… query) so we can drop them there after they sign in or
      // create an account — instead of the default landing page.
      try {
        // Include the hash — Concord invite secrets live in the URL fragment,
        // so pathname+search alone would strip the token and break the invite.
        const dest = window.location.pathname + window.location.search + window.location.hash;
        if (dest && dest !== "/") sessionStorage.setItem("relay-outpost-post-auth-redirect", dest);
      } catch {}
      // DM deep links (e.g. /messages?to=npub…) land on a focused sign-in that
      // preserves intent, instead of the marketing landing — which on mobile
      // (signer living in another browser/app) dead-ends with no way forward.
      // Invites and other routes keep their existing landing-page experience.
      const toLogin = window.location.pathname.startsWith("/messages");
      // Wrap in startTransition so suspending lazy routes don't trigger the
      // "component suspended while responding to synchronous input" warning.
      startTransition(() => navigate(toLogin ? "/login" : "/"));
    }
  }, [pubkey, isLoggingIn, isReconnecting, localUnlockFallbackActive, location, navigate, guestPreview]);

  // Once authenticated, honor a saved invite/deep-link destination (the section
  // they were invited to) over the default landing redirect.
  useEffect(() => {
    if (!pubkey) return;
    try {
      const dest = sessionStorage.getItem("relay-outpost-post-auth-redirect");
      if (dest) {
        sessionStorage.removeItem("relay-outpost-post-auth-redirect");
        sessionStorage.setItem("relay-outpost-landing-redirected", "1"); // suppress the default landing redirect
        startTransition(() => navigate(dest, { replace: true }));
      }
    } catch {}
  }, [pubkey, navigate]);

  const handleLaunch = useCallback(() => {
    setOverlayState("warping_to_cockpit");
  }, []);

  const handleWarpToCockpitComplete = useCallback(() => {
    setOverlayState("cockpit");
  }, []);

  const handleCockpitBack = useCallback(() => {
    setOverlayState("full");
  }, []);

  const handleDimmedSignIn = useCallback(() => {
    setOverlayState("warping_to_cockpit");
  }, []);

  const handleCockpitWarpStarted = useCallback(() => {
    setWarpingOut(true);
  }, []);

  const handleWarpComplete = useCallback(() => {
    setWarpingOut(false);
    setOverlayState("dimmed");
  }, []);

  // Logged-out guest opening a shared deep link (channel / note / profile):
  // render the slim read-only preview standalone, bypassing the pubkey-dependent
  // app shell.
  if (guestPreview) {
    if (guestRelayUrl && guestChannelId) return <Suspense fallback={<LazyFallback />}><GuestChannelPreview relayUrl={guestRelayUrl} channelId={guestChannelId} /></Suspense>;
    if (guestNoteId) return <Suspense fallback={<LazyFallback />}><GuestNotePreview noteId={guestNoteId} /></Suspense>;
    if (guestNpub) return <Suspense fallback={<LazyFallback />}><GuestProfilePreview npub={guestNpub} /></Suspense>;
    if (guestNaddr) return <Suspense fallback={<LazyFallback />}><GuestArticlePreview naddr={guestNaddr} /></Suspense>;
    if (guestDiscussAnchor) return <Suspense fallback={<LazyFallback />}><GuestDiscussionPreview anchor={guestDiscussAnchor} /></Suspense>;
  }

  return (
    <SidebarProvider
      style={style as React.CSSProperties}
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
    >
      <AppContent mainRef={mainRef} scrollHidden={scrollHidden} />
      {/* Signed-in recipient invite prompt. New accounts consume + remove the
          invite markers inside CreateAccountFlow, so this never double-fires. */}
      {!!pubkey && <InviteAcceptCard />}
      {/* Own boundary: signed-in users mount this in "hidden" mode (renders
          null), so the lazy chunk must never suspend the app shell itself. */}
      <Suspense fallback={null}>
        <GalaxyWarpOverlay mode={overlayMode} onLaunch={handleLaunch} onWarpStarted={handleCockpitWarpStarted} onWarpComplete={handleWarpComplete} onDimmedSignIn={handleDimmedSignIn} onCockpitBack={handleCockpitBack} onWarpToCockpitComplete={handleWarpToCockpitComplete} />
      </Suspense>
    </SidebarProvider>
  );
}

function SpaceBackground() {
  return (
    <>
      <div className="light-galaxy-specks" aria-hidden="true" />
      <div className="light-galaxy-drift" aria-hidden="true" />
      <div className="space-bg-nebula" aria-hidden="true" />
      <div className="space-bg-nebula-glow" aria-hidden="true" />
      <div className="space-bg-stars-deep" aria-hidden="true" />
      <div className="space-bg-stars" aria-hidden="true" />
      <div className="space-bg-shooting-star" aria-hidden="true" />
      <div className="space-bg-vignette" aria-hidden="true" />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <NostrAuthProvider>
          <GrapeRankScoresProvider>
          <NotificationProvider>
            <NeedsYouProvider>
            <InteractionIndexProvider>
            <NWCProvider>
            <LiveStatusProvider>
            <AudioPlayerProvider>
            <PiPProvider>
            <PersistentMediaProvider>
              <LiveMiniPlayerProvider>
              <TTSProvider>
              <OutpostComposeProvider>
              <SpaceBackground />
              <Suspense fallback={<LazyFallback />}>
                <Switch>
                  <Route path="/widget" component={Widget} />
                  <Route path="/login" component={Login} />
                  <Route path="/privacy" component={Privacy} />
                  <Route path="/terms" component={Covenant} />
                  {/* Guest-accessible like /terms — Play's Child Safety
                      declaration links here; it must load with no account. */}
                  <Route path="/child-safety" component={ChildSafety} />
                  {/* Legacy /covenant → /terms */}
                  <Route path="/covenant">{() => <RouteRedirect to="/terms" />}</Route>
                  <Route>
                    <AppLayout />
                  </Route>
                </Switch>
              </Suspense>
              <Toaster />
              <FeedbackDrawer />
              </OutpostComposeProvider>
              </TTSProvider>
              </LiveMiniPlayerProvider>
            </PersistentMediaProvider>
            </PiPProvider>
            </AudioPlayerProvider>
            </LiveStatusProvider>
            </NWCProvider>
            </InteractionIndexProvider>
            </NeedsYouProvider>
          </NotificationProvider>
          </GrapeRankScoresProvider>
        </NostrAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
