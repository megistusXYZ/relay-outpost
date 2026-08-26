import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RelayPanel } from "@/components/RelayPanel";
import { RelayOutpostIcon, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useNostrAuth, isPWAStandalone } from "@/contexts/NostrAuthContext";
import { ShieldMatrixIcon } from "@/components/icons/ShieldMatrixIcon";
import { AccountIcon } from "@/components/icons/AccountIcon";
import {
  Settings as SettingsIcon, ExternalLink, Zap, Unplug, Fingerprint,
  CheckCircle2, ShieldAlert, X, Plus, Radio, Check,
  Radar, Clock, TrendingUp, Award, Sun, Moon, Eclipse, Search, Volume2, MessageCircle,
  HardDrive, Trash2, Satellite, Type, Sliders, Film, ImageIcon, Antenna, MessageSquare, CornerUpLeft,
  ChevronDown, RotateCcw, BarChart3, ChevronRight, Flame, Share,
  Wallet, Bell, Newspaper, Compass, BookOpen, MessageSquarePlus, KeyRound, QrCode, Puzzle,
  Smartphone, Globe, Eye, EyeOff, Lock, Inbox, Tag, Wrench, ShieldCheck, PanelLeft, Bug, Sparkles,
  Copy, RefreshCw, LifeBuoy, Info, LayoutGrid } from "lucide-react";
import { useIaCollapsed, setIaCollapsed } from "@/lib/ia-prefs";
import { useNewsTrendingOn, setNewsTrendingOn } from "@/lib/news-trending";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClassicSidebar, setClassicSidebar } from "@/lib/desktop-chrome";
import { openFeedbackDrawer, APP_VERSION, appVersionLabel } from "@/lib/nip34-feedback";
import { checkForUpdatesNow, repairApp } from "@/lib/app-update";
import { getHideMessagePreviews, setHideMessagePreviews } from "@/lib/message-previews";
import { getPrivateModeSetting, setPrivateModeSetting } from "@/lib/private-mode";
import { useFeedbackUnread } from "@/hooks/use-feedback-unread";
import { useLocation } from "wouter";
import { FOCUS_RING } from "@/lib/a11y";
import { useTheme } from "@/hooks/use-theme";
import { useContrast, type ContrastLevel } from "@/hooks/use-contrast";
import { usePerfMode, type PerfMode } from "@/hooks/use-perf-mode";
import { useTTS } from "@/contexts/TextToSpeechContext";
import { VoiceSettingsPanel } from "@/components/SpeechReaderBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { areBadgesEnabled, setBadgesEnabled } from "@/components/BadgeDisplay";
import { hasPassedAgeScreen, isAdultBirthDate, recordAgeScreenPassed } from "@/lib/age-gate";
import { fetchDMRelayList, getLocalDMRelays, setLocalDMRelays, publishDMRelayList, DM_FALLBACK_RELAYS } from "@/lib/outbox";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { Link } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { usePWAInstall } from "@/hooks/use-pwa-install";
import { getSchedulerBaseUrl, setSchedulerBaseUrl } from "@/lib/schedule";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { Switch } from "@/components/ui/switch";
import { isFeedRankingEnabled, setFeedRankingEnabled, isEngagementScoreEnabled, setEngagementScoreEnabled } from "@/lib/feed-prefs";
import { readFeedStyle, setFeedStyle, type FeedStyle } from "@/hooks/use-feed-style";
import { readReplyContext, setReplyContext } from "@/hooks/use-reply-context";
import { readProfileLayout, setProfileLayout, type ProfileLayout } from "@/hooks/use-profile-layout";
import { getShowClientTag, setShowClientTag } from "@/hooks/use-show-client-tag";
import { isDiscoverV2, setDiscoverV2 } from "@/lib/discover-prefs";
import { getPreferredLanguages, setPreferredLanguages, isLanguagesAuto, clearPreferredLanguages, getDeviceLanguages } from "@/lib/language";
import { translationEnabled, setTranslationEnabled, translationCapable, getAutoTranslateLangs, removeAutoTranslateLang, languageName } from "@/lib/translate";
import { isConcordEnabled, setConcordEnabled } from "@/lib/concord/concord-prefs";
import { hasUnseenChangelog } from "@/lib/changelog";
import {
  getBlossomServers, setBlossomServers, fetchBlossomServerList, publishBlossomServerList, DEFAULT_BLOSSOM_SERVERS } from "@/lib/media-upload";
import { isAutoplayMediaEnabled, AUTOPLAY_CHANGED_EVENT } from "@/lib/video-prefs";
import { getEngagementWeights, saveEngagementWeights, DEFAULT_ENGAGEMENT_WEIGHTS, type EngagementWeights } from "@/lib/engagement-weights";
import { useNewsAlertPrefs, NEWS_MUTE_CAP } from "@/lib/news-alert-settings";

/* ---------------------------------------------------------------------------
 * Row primitives — every setting is ONE slim, uniform row:
 * [ small violet icon | label (+ optional one-line sub) | control / chevron ]
 * Rows live inside RowSection containers separated by tiny uppercase headers.
 * ------------------------------------------------------------------------- */

type IconComponent = React.ComponentType<{ className?: string }>;

function RowIcon({ icon: Icon }: { icon: IconComponent }) {
  return <Icon className="w-4 h-4 shrink-0 text-brand/70" aria-hidden />;
}

function RowText({ label, sub, labelTestId }: { label: React.ReactNode; sub?: React.ReactNode; labelTestId?: string }) {
  return (
    <div className="flex-1 min-w-0 py-1.5">
      <p className="text-[13px] font-medium text-foreground/90 leading-tight truncate" data-testid={labelTestId}>{label}</p>
      {sub != null && <p className="text-[11px] text-muted-foreground/60 leading-tight truncate mt-0.5">{sub}</p>}
    </div>
  );
}

const ROW_CLS = "flex items-center gap-3 px-3 min-h-[48px] sm:min-h-[44px]";

/** Static row: label on the left, an inline control (Switch/segment/Select) on the right. */
function Row({ icon, label, sub, children, testId, labelTestId }: {
  icon: IconComponent; label: React.ReactNode; sub?: React.ReactNode;
  children?: React.ReactNode; testId?: string; labelTestId?: string;
}) {
  return (
    <div className={ROW_CLS} data-testid={testId}>
      <RowIcon icon={icon} />
      <RowText label={label} sub={sub} labelTestId={labelTestId} />
      {children != null && <div className="shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** Tappable row ending in a chevron (opens a page, drawer or dialog). */
function ActionRow({ icon, label, sub, onClick, right, testId }: {
  icon: IconComponent; label: React.ReactNode; sub?: React.ReactNode;
  onClick?: () => void; right?: React.ReactNode; testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${ROW_CLS} w-full text-left transition-colors hover:bg-foreground/[0.03] cursor-pointer ${FOCUS_RING}`}
      data-testid={testId}
    >
      <RowIcon icon={icon} />
      <RowText label={label} sub={sub} />
      {right}
      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

function LinkRow({ href, icon, label, sub, right, testId }: {
  href: string; icon: IconComponent; label: React.ReactNode; sub?: React.ReactNode;
  right?: React.ReactNode; testId?: string;
}) {
  return (
    <Link
      href={href}
      className={`${ROW_CLS} w-full text-left transition-colors hover:bg-foreground/[0.03] cursor-pointer ${FOCUS_RING}`}
      data-testid={testId}
    >
      <RowIcon icon={icon} />
      <RowText label={label} sub={sub} />
      {right}
      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
    </Link>
  );
}

/** Row that expands in place to reveal richer controls (editors, chip grids…). */
function ExpandRow({ icon, label, sub, value, children, testId, id, defaultOpen }: {
  icon: IconComponent; label: React.ReactNode; sub?: React.ReactNode; value?: React.ReactNode;
  children: React.ReactNode; testId?: string; id?: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div id={id}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${ROW_CLS} w-full text-left transition-colors hover:bg-foreground/[0.03] cursor-pointer ${FOCUS_RING}`}
        data-testid={testId}
      >
        <RowIcon icon={icon} />
        <RowText label={label} sub={sub} />
        {value != null && <span className="text-xs text-muted-foreground/60 shrink-0 max-w-[40%] truncate">{value}</span>}
        <ChevronDown className={`w-4 h-4 text-muted-foreground/40 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3 pt-0.5">{children}</div>}
    </div>
  );
}

/** Compact inline segmented control for a row's right side. */
function Seg<T extends string>({ value, onChange, options, testIdBase, ariaLabel }: {
  value: T; onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  testIdBase: string; ariaLabel: string;
}) {
  return (
    <div className="flex rounded-md border border-border dark:border-brand/15 overflow-hidden shrink-0" role="group" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-2.5 h-8 text-[11px] font-medium transition-colors cursor-pointer ${i > 0 ? "border-l border-border dark:border-brand/15" : ""} ${ value === o.value ? "bg-accent text-brand" : "text-muted-foreground/60 hover:text-foreground/80 hover:bg-foreground/[0.03]" }`}
          data-testid={`button-${testIdBase}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SELECT_TRIGGER_CLS = "h-8 w-auto min-w-0 gap-1.5 px-2.5 text-xs border-border dark:border-brand/15 bg-transparent shrink-0";

/** Bordered container of uniform rows with a tiny uppercase section header. */
function RowSection({ id, label, children, testId }: {
  id?: string; label?: string; children: React.ReactNode; testId?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24" data-testid={testId}>
      {label && (
        <h3 className="px-1 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand/80 dark:text-brand/60">
          {label}
        </h3>
      )}
      <div className="relative rounded-md border border-border dark:border-brand/15 glass-settings-section shadow-sm dark:shadow-none overflow-hidden">
        <div className="absolute inset-0 rounded-md opacity-25 pointer-events-none glass-settings-glow" />
        <div className="relative divide-y divide-border/60 dark:divide-violet-500/10">
          {children}
        </div>
      </div>
    </section>
  );
}

/** Chip editor for a capped mute list (sources by URL, or keywords). */
function MuteListEditor({
  label,
  placeholder,
  values,
  onChange,
  testIdBase,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  testIdBase: string;
}) {
  const [draft, setDraft] = useState("");
  const atCap = values.length >= NEWS_MUTE_CAP;

  const add = () => {
    const v = draft.trim();
    if (!v || atCap) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground/70 dark:text-foreground/60">{label}</p>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {values.length}/{NEWS_MUTE_CAP}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={atCap ? "List is full" : placeholder}
          disabled={atCap}
          className="h-9 text-sm bg-white/[0.03] border-border dark:border-brand/15"
          data-testid={`input-${testIdBase}`}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 border-border dark:border-brand/15"
          onClick={add}
          disabled={!draft.trim() || atCap}
          aria-label={`Add to ${label}`}
          data-testid={`button-add-${testIdBase}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1" data-testid={`list-${testIdBase}`}>
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 max-w-full rounded-full border border-border dark:border-brand/15 bg-white/[0.03] pl-2.5 pr-1 py-0.5 text-[11px] text-foreground/80"
            >
              <span className="truncate max-w-[220px]">{v}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="w-5 h-5 flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-destructive hover:bg-muted/50 transition-colors"
                aria-label={`Remove ${v}`}
                data-testid={`button-remove-${testIdBase}-${v}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * News alerts — smart alert controls for the News/RSS reader (NIP-78-synced).
 * "Notify" is IN-APP prominence (Priority strip + News unread count).
 */
function NewsAlertsSection() {
  const prefs = useNewsAlertPrefs();
  const mutedCount = prefs.mutedSources.length + prefs.mutedKeywords.length;
  return (
    <RowSection id="news-alerts" label="News alerts" testId="section-news-alerts">
      <Row icon={Bell} label="Only notify about my presets" sub="Alerts only from sources in your saved categories">
        <Switch checked={prefs.onlyPresets} onCheckedChange={prefs.setOnlyPresets} data-testid="switch-news-only-presets" />
      </Row>
      <Row icon={Newspaper} label="Only notify about followed creators" sub="Alerts only from podcasts and shows you added">
        <Switch checked={prefs.onlyCreators} onCheckedChange={prefs.setOnlyCreators} data-testid="switch-news-only-creators" />
      </Row>
      <Row icon={Inbox} label="Digest only" sub="One bundled digest per session, not individual rows">
        <Switch checked={prefs.digestOnly} onCheckedChange={prefs.setDigestOnly} data-testid="switch-news-digest-only" />
      </Row>
      <Row icon={Sparkles} label="Show &ldquo;Worth your time&rdquo;" sub="A priority strip of your top unread picks on the News page (off by default)">
        <Switch checked={prefs.showWorthYourTime} onCheckedChange={prefs.setShowWorthYourTime} data-testid="switch-news-worth-your-time" />
      </Row>
      <ExpandRow
        icon={EyeOff}
        label="Muted sources & keywords"
        value={mutedCount > 0 ? String(mutedCount) : "None"}
        testId="toggle-news-muted-lists"
      >
        <div className="space-y-3">
          <MuteListEditor
            label="Muted sources"
            placeholder="Feed URL, e.g. https://example.com/feed"
            values={prefs.mutedSources}
            onChange={prefs.setMutedSources}
            testIdBase="news-muted-source"
          />
          <MuteListEditor
            label="Muted keywords"
            placeholder="Keyword or phrase"
            values={prefs.mutedKeywords}
            onChange={prefs.setMutedKeywords}
            testIdBase="news-muted-keyword"
          />
          <p className="text-[10px] text-muted-foreground/50">
            Muted items never alert and are hidden from the combined News thread — they stay visible
            inside the source's own feed view.
          </p>
        </div>
      </ExpandRow>
    </RowSection>
  );
}

interface SettingsCategory { id: string; label: string }

/** A labeled, anchored group of settings sections that the nav can jump to. */
function CategoryGroup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4" data-testid={`settings-group-${id}`}>
      <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">{title}</h2>
      {children}
    </section>
  );
}

/** Category navigation: a sticky left rail on desktop only. Highlights the
 *  in-view category (scrollspy) and jumps on click. Mobile has no jump-nav —
 *  it relies on the grouped scroll and category headings. */
function SettingsNav({ items }: { items: SettingsCategory[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
  };

  return (
    <>
      {/* Mobile (< lg): a "jump to section" selector that pins flush to the top as
          a solid full-bleed sub-bar when scrolling (desktop rail is hidden). */}
      <div className="lg:hidden sticky top-0 z-30 -mx-3 sm:-mx-4 mb-4 border-b border-border/50 bg-background/95 backdrop-blur-md px-3 sm:px-4 py-2.5">
        <Select value={active} onValueChange={(v) => go(v)}>
          <SelectTrigger className="w-full min-h-11 border-border bg-accent" data-testid="settings-mobile-nav">
            <SelectValue placeholder="Jump to a section" />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.id} value={i.id} data-testid={`settings-nav-mobile-${i.id}`}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop (>= lg): a sticky vertical rail with scrollspy highlight. */}
      <nav className="hidden lg:block sticky top-4 self-start">
        <ul className="space-y-0.5">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => go(i.id)}
                data-testid={`settings-nav-${i.id}`}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${active === i.id ? "bg-accent font-medium text-brand" : "text-muted-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"}`}
              >
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

const SCAN_FILTER_OPTIONS = [
  { value: "rising", label: "Rising", icon: TrendingUp, group: "Engagement" },
  { value: "hot", label: "Hot", icon: Flame, group: "Engagement" },
  { value: "weekly_top", label: "Top Signal", icon: Award, group: "Engagement" },
  { value: "trending_1h", label: "Trending 1h", icon: Clock, group: "Time" },
  { value: "trending_4h", label: "Trending 4h", icon: Clock, group: "Time" },
  { value: "trending_12h", label: "Trending 12h", icon: Clock, group: "Time" },
  { value: "trending_24h", label: "Trending 24h", icon: Clock, group: "Time" },
  { value: "mostzapped_4h", label: "Most Zapped Today", icon: Zap, group: "Zaps" },
] as const;

type LaunchOption =
  | { kind: "feed"; value: "open_comms" | "deep_scan" | "raw_signal"; label: string; icon: IconComponent }
  | { kind: "route"; value: string; label: string; icon: IconComponent };

const LAUNCH_OPTIONS: readonly LaunchOption[] = [
  { kind: "route", value: "/account", label: "Account", icon: AccountIcon },
  { kind: "feed", value: "open_comms", label: "Following", icon: MessageSquare },
  { kind: "feed", value: "raw_signal", label: "For you", icon: Antenna },
  { kind: "feed", value: "deep_scan", label: "Trending", icon: Radar },
  { kind: "route", value: "/search", label: "Search", icon: Search },
  { kind: "route", value: "/articles", label: "Articles", icon: BookOpen },
  { kind: "route", value: "/rss", label: "News", icon: Newspaper },
  { kind: "route", value: "/wallet", label: "Wallet", icon: Wallet },
  { kind: "route", value: "/messages", label: "Chats", icon: MessageCircle },
  { kind: "route", value: "/notifications", label: "Notifications", icon: Bell },
  { kind: "route", value: "/outposts", label: "Communities", icon: Compass },
] as const;

function LaunchSection() {
  const iaCollapsed = useIaCollapsed();
  const newsTrending = useNewsTrendingOn();
  const [feedMode, setFeedMode] = useState(() => {
    try {
      const saved = localStorage.getItem("relay-outpost-default-feed-mode");
      if (saved && ["deep_scan", "raw_signal", "open_comms"].includes(saved)) return saved;
    } catch {}
    return "open_comms";
  });

  const [landing, setLanding] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("relay-outpost-default-landing-page");
      // Legacy stored value from before the own-account page moved to /account
      // (also arrives via NIP-78 settings sync from other devices).
      if (saved === "/outpost") return "/account";
      if (saved) return saved;
    } catch {}
    return "/";
  });

  const [scanFilter, setScanFilter] = useState(() => {
    try {
      let val = localStorage.getItem("relay-outpost-default-filter") || "rising";
      if (val === "mostzapped_24h" || val === "mostzapped_yesterday" || val === "mostzapped_week") {
        val = "mostzapped_4h";
        localStorage.setItem("relay-outpost-default-filter", val);
      }
      return val;
    } catch { return "rising"; }
  });

  const activeKey = landing === "/" ? feedMode : landing;

  const handleLaunchSelect = (value: string) => {
    const opt = LAUNCH_OPTIONS.find((o) => o.value === value);
    if (!opt) return;
    try {
      sessionStorage.removeItem("relay-outpost-landing-redirected");
      if (opt.kind === "feed") {
        setFeedMode(opt.value);
        setLanding("/");
        localStorage.setItem("relay-outpost-default-feed-mode", opt.value);
        localStorage.setItem("relay-outpost-default-landing-page", "/");
      } else {
        setLanding(opt.value);
        localStorage.setItem("relay-outpost-default-landing-page", opt.value);
      }
    } catch {}
  };

  const handleScanFilterChange = (value: string) => {
    setScanFilter(value);
    try { localStorage.setItem("relay-outpost-default-filter", value); } catch {}
  };

  const [commentSort, setCommentSort] = useState<"oldest" | "newest">(() => {
    try {
      const saved = localStorage.getItem("relay-outpost-default-comment-sort");
      if (saved === "newest") return "newest";
    } catch {}
    return "oldest";
  });

  const handleCommentSortChange = (value: "oldest" | "newest") => {
    setCommentSort(value);
    try { localStorage.setItem("relay-outpost-default-comment-sort", value); } catch {}
  };

  return (
    <RowSection label="Launch" testId="section-default-feed">
      {/* Now the default, so this switch is the way BACK rather than the way in.
          It stays because a navigation change is the kind of thing people need
          to be able to undo without hunting — and because it was the switch,
          not the flag, that made the IA real: shipped with zero callers, four
          merged stages existed only for whoever typed into a devtools console,
          and the first defect (the rail marking Discover as current on every
          route) survived all of them and 2184 green tests. */}
      <Row icon={LayoutGrid} label="Simplified navigation" sub="Four places instead of eight — Chats, Activity, Discover, You. Turn off for the classic eight-item menu.">
        <Switch
          checked={iaCollapsed}
          onCheckedChange={setIaCollapsed}
          data-testid="switch-ia-collapsed"
        />
      </Row>
      <Row icon={Newspaper} label="Trending news (beta)" sub="Open News on what's trending — ranked by how many outlets are covering a story, lifted by what your network is sharing. Turn off for the classic feed reader.">
        <Switch
          checked={newsTrending}
          onCheckedChange={setNewsTrendingOn}
          data-testid="switch-news-trending"
        />
      </Row>
      <Row icon={Radar} label="Open at launch" sub="Feed or page shown when the app starts">
        <Select value={activeKey} onValueChange={handleLaunchSelect}>
          <SelectTrigger className={SELECT_TRIGGER_CLS} data-testid="select-launch-page">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent align="end">
            {LAUNCH_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const testIdSuffix = opt.kind === "feed" ? opt.value : (opt.value.replace(/\//g, "-") || "home");
              return (
                <SelectItem key={opt.value} value={opt.value} data-testid={`button-launch-${testIdSuffix}`}>
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
                    {opt.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </Row>

      {activeKey === "deep_scan" && (
        <Row icon={Clock} label="Scan filter" sub="Default Trending chart">
          <Select value={scanFilter} onValueChange={handleScanFilterChange}>
            <SelectTrigger className={SELECT_TRIGGER_CLS} data-testid="select-default-filter">
              <SelectValue placeholder="Choose default filter" />
            </SelectTrigger>
            <SelectContent align="end">
              {SCAN_FILTER_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <SelectItem key={opt.value} value={opt.value} data-testid={`option-preset-${opt.value}`}>
                    <span className="flex items-center gap-2">
                      <Icon className="w-3 h-3 text-muted-foreground/60" />
                      {opt.label}
                      <span className="text-[10px] text-muted-foreground/70">{opt.group}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Row>
      )}

      <Row icon={MessageCircle} label="Comment sort">
        <Seg
          value={commentSort}
          onChange={handleCommentSortChange}
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
          ] as const}
          testIdBase="comment-sort"
          ariaLabel="Default comment sort order"
        />
      </Row>
    </RowSection>
  );
}

// Single source of truth in outbox.ts (shared with the DM send/receive paths).
const DEFAULT_DM_RELAYS = DM_FALLBACK_RELAYS;

function DMRelaysExpandRow() {
  const { pubkey, signer } = useNostrAuth();
  const [dmRelays, setDmRelays] = useState<string[]>([]);
  const [newDmRelay, setNewDmRelay] = useState("");
  const [loadingDm, setLoadingDm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!pubkey) return;
    const local = getLocalDMRelays();
    if (local.length > 0) {
      setDmRelays(local);
    }
    setLoadingDm(true);
    fetchDMRelayList(pubkey).then((relays) => {
      if (relays.length > 0) {
        setDmRelays(relays);
      }
      setLoadingDm(false);
    }).catch(() => setLoadingDm(false));
  }, [pubkey]);

  const addRelay = () => {
    let url = newDmRelay.trim();
    if (!url) return;
    if (!url.startsWith("wss://")) {
      url = "wss://" + url;
    }
    try {
      new URL(url);
    } catch {
      toast({ title: "Invalid relay URL", variant: "destructive" });
      return;
    }
    if (dmRelays.includes(url)) {
      toast({ title: "Relay already added", variant: "destructive" });
      return;
    }
    setDmRelays((prev) => [...prev, url]);
    setNewDmRelay("");
  };

  const removeRelay = (url: string) => {
    setDmRelays((prev) => prev.filter((r) => r !== url));
  };

  const handlePublish = async () => {
    if (!signer || !pubkey) return;
    setPublishing(true);
    try {
      const ok = await publishDMRelayList(dmRelays, signer);
      if (ok) {
        toast({ title: "DM relay list published" });
      } else {
        toast({ title: "Failed to publish DM relay list", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to publish DM relay list", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  if (!pubkey) return null;

  return (
    <ExpandRow
      icon={MessageCircle}
      label="Direct message relays"
      sub="Where other apps deliver your private messages"
      value={loadingDm ? "…" : String(dmRelays.length)}
      testId="section-dm-relays"
    >
      {loadingDm ? (
        <div className="flex items-center gap-2 py-2">
          <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand" />
          <span className="text-xs text-muted-foreground/60">Loading DM relay list...</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={newDmRelay}
              onChange={(e) => setNewDmRelay(e.target.value)}
              placeholder="wss://relay.example.com"
              className="font-mono text-xs bg-white/[0.03] border-border dark:border-brand/15 focus-visible:border-brand/40 dark:focus-visible:border-brand/30"
              data-testid="input-dm-relay"
              onKeyDown={(e) => {
                if (e.key === "Enter") addRelay();
              }}
            />
            <Button
              size="icon"
              variant="outline"
              onClick={addRelay}
              disabled={!newDmRelay.trim()}
              className="border-border dark:border-brand/15 bg-muted"
              data-testid="button-add-dm-relay"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {dmRelays.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-foreground/65 dark:text-muted-foreground/70" data-testid="text-no-dm-relays">
                No DM relays configured yet. Use the recommended set or add your own.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setDmRelays(DEFAULT_DM_RELAYS);
                  setLocalDMRelays(DEFAULT_DM_RELAYS);
                  toast({ title: "Recommended DM relays added" });
                }}
                className="w-full text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15 bg-muted"
                data-testid="button-use-recommended-dm-relays"
              >
                <Satellite className="w-3.5 h-3.5 mr-2" />
                Use Recommended Relays
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5" data-testid="list-dm-relays">
              {dmRelays.map((url) => (
                <div
                  key={url}
                  className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
                  style={{ background: "rgba(140, 100, 220, 0.06)", border: "1px solid rgba(140, 100, 220, 0.15)" }}
                  data-testid={`dm-relay-${url}`}
                >
                  <Radio className="w-3 h-3 text-brand shrink-0" />
                  <span className="flex-1 text-xs font-mono text-foreground/70 dark:text-muted-foreground/80 truncate">
                    {url}
                  </span>
                  <button
                    onClick={() => removeRelay(url)}
                    className="rounded-full p-0.5 shrink-0"
                    data-testid={`button-remove-dm-relay-${url}`}
                  >
                    <X className="w-2.5 h-2.5 text-muted-foreground/50" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            onClick={handlePublish}
            disabled={publishing}
            className="w-full text-xs font-brand uppercase tracking-widest"
            data-testid="button-publish-dm-relays"
          >
            {publishing ? (
              <>
                <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-2" />
                Publishing...
              </>
            ) : (
              <>
                <MessageCircle className="w-3.5 h-3.5 mr-2" />
                Publish DM Relay List
              </>
            )}
          </Button>
        </div>
      )}
    </ExpandRow>
  );
}

function ReadAloudSection() {
  const { enabled, setEnabled, rate, voice, voices, setRate, setVoice } = useTTS();
  return (
    <RowSection label="Read aloud" testId="section-voice">
      <Row icon={Volume2} label="Listen buttons on posts" sub="Read posts and threads aloud">
        <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-tts-enabled" />
      </Row>
      <ExpandRow icon={Sliders} label="Voice & speed" sub="For Articles and News read-aloud" testId="toggle-voice-settings">
        <div className="space-y-3">
          <VoiceSettingsPanel
            rate={rate}
            voice={voice}
            voices={voices}
            onSetRate={setRate}
            onSetVoice={setVoice}
            compact
          />
        </div>
      </ExpandRow>
    </RowSection>
  );
}

// Curated set — each entry earns its slot with a distinct personality. Must
// stay in sync with FONT_MAP in main.tsx and the Google Fonts <link> in
// client/index.html. Values removed from this list may still arrive from an
// old localStorage entry or NIP-78 sync from another device: the read paths
// (currentFont/applyTypography here, FONT_MAP clamp in main.tsx) fall back to
// Inter at render time WITHOUT writing the clamp back to storage, so the
// user's saved choice survives for devices that still offer it.
const FONT_OPTIONS = [
  { value: "inter", label: "Inter", family: "'Inter', system-ui, sans-serif", desc: "Modern UI standard — used by X/Twitter", category: "sans" },
  { value: "geist", label: "Geist", family: "'Geist', system-ui, sans-serif", desc: "Vercel's modern sans-serif", category: "sans" },
  { value: "poppins", label: "Poppins", family: "'Poppins', system-ui, sans-serif", desc: "Geometric with personality", category: "sans" },
  { value: "space-grotesk", label: "Space Grotesk", family: "'Space Grotesk', system-ui, sans-serif", desc: "Techy proportional sans", category: "sans" },
  { value: "clean", label: "Nunito", family: "'Nunito', system-ui, sans-serif", desc: "Soft and easy on the eyes", category: "sans" },
  { value: "analog", label: "Lora", family: "'Lora', 'Georgia', serif", desc: "Classic serif, like old radio manuals", category: "serif" },
  { value: "source-serif", label: "Source Serif", family: "'Source Serif 4', 'Georgia', serif", desc: "Adobe's reading serif", category: "serif" },
  { value: "playfair", label: "Playfair Display", family: "'Playfair Display', 'Georgia', serif", desc: "Elegant high-contrast serif", category: "serif" },
  { value: "default", label: "Station Default", family: "'Space Mono', 'Courier New', monospace", desc: "Monospace terminal feel", category: "mono" },
  { value: "tactical", label: "Tactical", family: "'JetBrains Mono', monospace", desc: "Geometric ops monospace", category: "mono" },
] as const;

// Fallback for removed/unknown stored font values (see comment above).
const FALLBACK_FONT = FONT_OPTIONS[0]; // inter

const FONT_CATEGORIES = [
  { key: "sans", label: "Modern Sans-Serif" },
  { key: "mono", label: "Monospace" },
  { key: "serif", label: "Classic Serif" },
] as const;

const SIZE_OPTIONS = [
  { value: "compact", label: "Compact", px: "16px", preview: "15px", post: "14px" },
  { value: "default", label: "Default", px: "17px", preview: "16px", post: "15px" },
  { value: "comfortable", label: "Comfortable", px: "18px", preview: "17px", post: "16px" },
  { value: "large", label: "Large", px: "20px", preview: "19px", post: "18px" },
  { value: "xlarge", label: "Huge", px: "22px", preview: "20px", post: "20px" },
] as const;

/** Categorized font list, rendered inside the Font row's expansion. */
function FontPanel({ font, onFontChange, currentFont }: {
  font: string;
  onFontChange: (value: string) => void;
  currentFont: typeof FONT_OPTIONS[number];
}) {
  const [activeCategory, setActiveCategory] = useState<string>(currentFont.category);

  useEffect(() => {
    setActiveCategory(currentFont.category);
  }, [currentFont.category]);

  return (
    <div className="glass-card rounded-lg border overflow-hidden" data-testid="font-picker-panel">
      <div className="flex border-b border-border" role="tablist" aria-label="Font categories">
        {FONT_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            role="tab"
            aria-selected={activeCategory === cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`flex-1 py-2 text-[10px] sm:text-[11px] font-medium uppercase tracking-wider transition-colors ${FOCUS_RING} ${ activeCategory === cat.key ? "text-brand bg-accent border-b-2 border-brand" : "text-muted-foreground/60 hover:text-muted-foreground/85 hover:bg-accent" }`}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="max-h-[200px] overflow-y-auto overscroll-contain" role="listbox" aria-label="Font options">
        {FONT_OPTIONS.filter(f => f.category === activeCategory).map((opt) => (
          <button
            key={opt.value}
            role="option"
            aria-selected={font === opt.value}
            onClick={() => onFontChange(opt.value)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
              font === opt.value
                ? "bg-accent dark:bg-brand/15"
                : "hover:bg-accent dark:hover:bg-brand/[0.06]"
            }`}
            data-testid={`button-font-${opt.value}`}
          >
            <span className="w-10 text-center text-xl text-foreground/80 shrink-0" style={{ fontFamily: opt.family, fontWeight: 400 }}>Aa</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground/80 truncate" style={{ fontFamily: opt.family }}>{opt.label}</p>
              <p className="text-[10px] text-muted-foreground/65 truncate">{opt.desc}</p>
            </div>
            {font === opt.value && <Check className="w-3.5 h-3.5 text-brand shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function applyTypography(font: string, size: string) {
  const fontOpt = FONT_OPTIONS.find(f => f.value === font) || FALLBACK_FONT;
  const sizeOpt = SIZE_OPTIONS.find(s => s.value === size) || SIZE_OPTIONS[1];
  document.documentElement.style.setProperty("--font-body", fontOpt.family);
  document.documentElement.style.setProperty("--post-text-size", sizeOpt.post);
  document.documentElement.style.fontSize = sizeOpt.px;
  document.body.style.fontFamily = `var(--font-body)`;
}

const DISCOVER_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" }, { code: "es", label: "Español" }, { code: "pt", label: "Português" },
  { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" }, { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" }, { code: "ru", label: "Русский" }, { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" }, { code: "ko", label: "한국어" }, { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" }, { code: "tr", label: "Türkçe" }, { code: "id", label: "Indonesia" },
];

function langLabel(code: string): string {
  return DISCOVER_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

function ChatsSection() {
  const [on, setOn] = useState(() => isConcordEnabled());
  const toggle = (v: boolean) => { setOn(v); setConcordEnabled(v); };
  return (
    <RowSection label="Chats" testId="section-concord">
      <Row icon={ShieldCheck} label="Private chats (beta)" sub="End-to-end-encrypted communities — keys stay on this device">
        <Switch checked={on} onCheckedChange={toggle} data-testid="switch-concord-enabled" />
      </Row>
    </RowSection>
  );
}

function DiscoverSection() {
  const [v2, setV2] = useState(() => isDiscoverV2());
  const [langs, setLangs] = useState<string[]>(() => getPreferredLanguages());
  // Auto = no stored override; languages follow the device. Customize stores an
  // explicit list (seeded from the device) and reveals the chip grid.
  const [auto, setAuto] = useState(() => isLanguagesAuto());

  const toggleV2 = (on: boolean) => { setV2(on); setDiscoverV2(on); };
  const startCustomize = () => {
    setPreferredLanguages(getDeviceLanguages());
    setLangs(getPreferredLanguages());
    setAuto(false);
  };
  const backToAuto = () => {
    clearPreferredLanguages();
    setLangs(getPreferredLanguages());
    setAuto(true);
  };
  const toggleLang = (code: string) => {
    setLangs((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      const finalLangs = next.length ? next : ["en"];
      setPreferredLanguages(finalLangs);
      return finalLangs;
    });
  };

  const deviceLangLabels = getDeviceLanguages().map(langLabel).join(", ");

  return (
    <RowSection label="Discover" testId="section-discover">
      <Row icon={Compass} label="Discover feed" sub="Ranked For You from active relays — off = classic feed">
        <Switch checked={v2} onCheckedChange={toggleV2} data-testid="switch-discover-v2" />
      </Row>
      {v2 && (
        <ExpandRow
          icon={Globe}
          label="Content languages"
          value={auto ? "Auto" : `${langs.length} selected`}
          testId="toggle-content-languages"
        >
          {auto ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2.5 py-1 rounded-full text-xs font-medium border border-brand/40 bg-brand/10 text-brand" data-testid="chip-lang-auto">
                Auto — matches your device ({deviceLangLabels})
              </span>
              <button
                onClick={startCustomize}
                className="px-2.5 py-1 rounded-full text-xs font-medium border border-border dark:border-brand/10 bg-muted text-muted-foreground/70 hover:border-brand/25 transition-colors"
                data-testid="button-lang-customize"
              >
                Customize
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {DISCOVER_LANGUAGES.map((l) => {
                  const on = langs.includes(l.code);
                  return (
                    <button
                      key={l.code}
                      onClick={() => toggleLang(l.code)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? "border-brand/40 bg-brand/10 text-brand" : "border-border dark:border-brand/10 bg-muted text-muted-foreground/70 hover:border-brand/25"}`}
                      data-testid={`chip-lang-${l.code}`}
                    >
                      {l.label}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={backToAuto}
                className="mt-2 text-[11px] text-brand/80 hover:underline"
                data-testid="button-lang-auto"
              >
                Back to Auto (match my device)
              </button>
            </>
          )}
          <p className="text-[10px] text-muted-foreground/60 mt-1.5">Posts in other languages are hidden from Discover. Short/undetectable posts always show.</p>
        </ExpandRow>
      )}
    </RowSection>
  );
}

function SchedulerExpandRow() {
  const { toast } = useToast();
  const saved = getSchedulerBaseUrl();
  const [url, setUrl] = useState(saved);
  const normalized = url.trim().replace(/\/+$/, "");
  const dirty = normalized !== saved;

  const apply = () => {
    if (normalized && !/^https?:\/\//i.test(normalized)) {
      toast({ title: "Invalid URL", description: "Enter a full URL starting with http:// or https://", variant: "destructive" });
      return;
    }
    setSchedulerBaseUrl(normalized);
    setUrl(normalized);
    toast({
      title: normalized ? "Scheduler server set" : "Using default scheduler",
      description: normalized ? "Server-scheduled posts will go to your own backend." : "Reverted to this app's scheduler.",
    });
  };

  return (
    <ExpandRow
      icon={Globe}
      label="Scheduler server"
      sub="Advanced — send server-scheduled posts to your own backend"
      value={saved ? "Custom" : "Default"}
      testId="section-custom-scheduler"
    >
      <div className="space-y-2">
        <p className="text-xs text-foreground/50 dark:text-muted-foreground/60">
          Send <em>server</em>-scheduled posts to a Relay Outpost backend you run yourself instead of
          this one. Leave blank to use the default. Your server must list this site in its
          <code className="mx-1">ALLOWED_ORIGINS</code>. Does not affect "This device" scheduling.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://my-outpost.example.com"
            className="text-xs"
            data-testid="input-scheduler-url"
          />
          <Button size="sm" variant="outline" className="text-xs shrink-0" disabled={!dirty} onClick={apply} data-testid="button-save-scheduler-url">
            Save
          </Button>
        </div>
        {saved && (
          <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/70">Active: {saved}</p>
        )}
      </div>
    </ExpandRow>
  );
}

/**
 * Install app — a single slim row that only renders when the app is NOT
 * already installed. Tapping it fires the captured native install prompt when
 * available (see use-pwa-install.ts module-level capture), otherwise opens a
 * small dialog with the two-line platform instructions.
 */
function InstallAppRow() {
  const { isStandalone, installed, canPromptInstall, promptInstall, isIOS } = usePWAInstall();
  const [helpOpen, setHelpOpen] = useState(false);

  if (isStandalone || installed) return null;

  const handleTap = async () => {
    if (canPromptInstall) {
      const r = await promptInstall();
      if (r === "unavailable") setHelpOpen(true);
      return;
    }
    setHelpOpen(true);
  };

  return (
    <>
      <ActionRow
        icon={Smartphone}
        label="Install app"
        sub="Full-screen, home-screen experience — no app store"
        onClick={handleTap}
        testId="button-install-app"
      />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-install-help">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Smartphone className="w-4 h-4 text-brand dark:text-brand/80" />
              Install Relay Outpost
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add it to your device from your browser — no app store needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 text-[13px] text-foreground/85">
            {isIOS ? (
              <>
                <p className="flex items-start gap-2">
                  <Share className="w-4 h-4 mt-0.5 shrink-0 text-brand dark:text-brand/80" aria-hidden />
                  <span>iPhone/iPad (Safari): tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</span>
                </p>
                <p className="flex items-start gap-2 text-foreground/60">
                  <Globe className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/60" aria-hidden />
                  <span>Chrome/Edge/Brave: browser menu → <strong>Install app</strong>.</span>
                </p>
              </>
            ) : (
              <>
                <p className="flex items-start gap-2">
                  <Globe className="w-4 h-4 mt-0.5 shrink-0 text-brand dark:text-brand/80" aria-hidden />
                  <span>Chrome/Edge/Brave: browser menu → <strong>Install app</strong>.</span>
                </p>
                <p className="flex items-start gap-2 text-foreground/60">
                  <Share className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/60" aria-hidden />
                  <span>iPhone/iPad (Safari): <strong>Share</strong> → <strong>Add to Home Screen</strong>.</span>
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** App: version (copyable), manual update check, and cache repair. Lives next
 *  to Appearance so it's reachable signed-out — a broken install must be
 *  fixable without logging in. */
function AppSection() {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const copyVersion = async () => {
    // Copy the full label (release + build hash) so it's paste-ready into a
    // support ticket: "Relay Outpost 1.6.0 (a3202be)".
    try {
      await navigator.clipboard.writeText(`Relay Outpost ${appVersionLabel()}`);
      toast({ title: "Version copied" });
    } catch {
      toast({ title: "Couldn't copy", description: appVersionLabel() });
    }
  };

  const handleCheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await checkForUpdatesNow();
      if (result === "update-ready") {
        toast({ title: "Update ready", description: "Tap Restart on the pill below to switch over." });
      } else if (result === "up-to-date") {
        toast({ title: "You're up to date", description: `Relay Outpost ${appVersionLabel()}` });
      } else {
        toast({ title: "Couldn't check right now", description: "You may be offline — try again in a bit." });
      }
    } finally {
      setChecking(false);
    }
  };

  const handleRepair = async () => {
    if (repairing) return;
    setRepairing(true);
    // repairApp unregisters service workers + clears Cache Storage, then
    // reloads. localStorage/IndexedDB (accounts, keys, settings) untouched.
    await repairApp();
  };

  return (
    <RowSection id="app" label="App" testId="section-app">
      <Row icon={Info} label="Relay Outpost" sub={`Version ${appVersionLabel()}`} testId="row-app-version" labelTestId="text-app-version">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground/60 hover:text-foreground"
          onClick={copyVersion}
          aria-label="Copy version"
          data-testid="button-copy-version"
        >
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </Row>

      <ActionRow
        icon={RefreshCw}
        label="Check for updates"
        sub="See if a newer version is available right now"
        onClick={handleCheck}
        right={checking ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground/60 shrink-0" aria-hidden /> : undefined}
        testId="button-check-updates"
      />

      <ActionRow
        icon={LifeBuoy}
        label="Repair app"
        sub="Reload fresh files — you stay signed in"
        onClick={() => setRepairOpen(true)}
        testId="button-repair-app"
      />

      <Dialog open={repairOpen} onOpenChange={(o) => { if (!repairing) setRepairOpen(o); }}>
        <DialogContent className="max-w-sm" data-testid="dialog-repair-app">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <LifeBuoy className="w-4 h-4 text-brand dark:text-brand/80" />
              Repair app
            </DialogTitle>
            <DialogDescription className="text-xs">
              Clears the app's cached files and reloads fresh. Your accounts, keys and settings stay on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRepairOpen(false)}
              disabled={repairing}
              data-testid="button-repair-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRepair}
              disabled={repairing}
              data-testid="button-repair-confirm"
            >
              {repairing ? "Repairing…" : "Repair & reload"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </RowSection>
  );
}

const CONTRAST_OPTIONS: readonly { value: ContrastLevel; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "maximum", label: "Max" },
];

const PERF_OPTIONS: readonly { value: PerfMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "lite", label: "Lite" },
  { value: "full", label: "Full" },
];

/** Appearance: install, theme, typography, feed style, performance, contrast —
 *  all as uniform rows. */
function AppearanceSection() {
  const { theme, setTheme, isDark } = useTheme();
  const { level, setLevel } = useContrast();
  const { mode: perfMode, setMode: setPerfMode, isLite } = usePerfMode();
  const isMobile = useIsMobile();
  const classicSidebar = useClassicSidebar();

  const [font, setFont] = useState(() => {
    try { return localStorage.getItem("relay-outpost-font") || "inter"; } catch { return "inter"; }
  });
  const [size, setSize] = useState(() => {
    try { return localStorage.getItem("relay-outpost-font-size") || "default"; } catch { return "default"; }
  });
  const [feedStyle, setFeedStyleState] = useState<FeedStyle>(() => readFeedStyle());
  const [replyContext, setReplyContextState] = useState<boolean>(() => readReplyContext());
  const handleReplyContextChange = (on: boolean) => {
    setReplyContextState(on);
    setReplyContext(on);
  };
  const [profileLayout, setProfileLayoutState] = useState<ProfileLayout>(() => readProfileLayout());

  useEffect(() => {
    applyTypography(font, size);
  }, [font, size]);

  const handleFontChange = (value: string) => {
    setFont(value);
    try { localStorage.setItem("relay-outpost-font", value); } catch {}
  };

  const handleSizeChange = (value: string) => {
    setSize(value);
    try { localStorage.setItem("relay-outpost-font-size", value); } catch {}
  };

  const handleFeedStyleChange = (value: FeedStyle) => {
    setFeedStyleState(value);
    setFeedStyle(value);
  };

  const handleProfileLayoutChange = (value: ProfileLayout) => {
    setProfileLayoutState(value);
    setProfileLayout(value);
  };

  const currentFont = FONT_OPTIONS.find(f => f.value === font) || FALLBACK_FONT;

  return (
    <RowSection testId="section-appearance">
      <InstallAppRow />

      <Row icon={theme === "black" ? Eclipse : isDark ? Moon : Sun} label="Theme" testId="section-theme">
        <Seg
          value={theme}
          onChange={(v) => setTheme(v)}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "black", label: "Black" },
          ] as const}
          testIdBase="theme"
          ariaLabel="Color theme"
        />
      </Row>

      <ExpandRow
        icon={Type}
        label="Font"
        value={currentFont.label}
        testId="button-font-picker-toggle"
      >
        <FontPanel font={font} onFontChange={handleFontChange} currentFont={currentFont} />
      </ExpandRow>

      <Row icon={Type} label="Text size" testId="section-text-size">
        <Select value={size} onValueChange={handleSizeChange}>
          <SelectTrigger className={SELECT_TRIGGER_CLS} data-testid="select-text-size">
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent align="end">
            {SIZE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} data-testid={`button-size-${opt.value}`}>
                {opt.label} ({opt.px})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {/* Sits beside Feed style because it is the same kind of choice — how a
          post is presented, not what appears. On (the default) draws the reply
          and the post it answers as one threaded exchange; off collapses the
          context behind a "Show context" button, which is where this started. */}
      <Row
        icon={CornerUpLeft}
        label="Conversation context"
        sub="Show the post a reply is answering, threaded above it"
        testId="section-reply-context"
      >
        <Switch
          checked={replyContext}
          onCheckedChange={handleReplyContextChange}
          data-testid="switch-reply-context"
        />
      </Row>

      <Row icon={MessageSquare} label="Feed style" testId="section-feed-style">
        <Seg
          value={feedStyle}
          onChange={handleFeedStyleChange}
          options={[
            { value: "clean", label: "Clean" },
            { value: "bubbles", label: "Bubbles" },
          ] as const}
          testIdBase="feed-style"
          ariaLabel="Feed post style"
        />
      </Row>

      {/* Profile pages render either in the classic X-style column or the
          living-identity layout, on every size. This row is the ONLY way back to
          Classic on a phone — the switch that floats over the profile banner is
          hidden below lg, where it would collide with the back button — so it
          must not be gated on viewport. It was, which left the identity layout
          (the default) unreachable and un-leaveable on mobile at once. */}
      <Row icon={PanelLeft} label="Profile layout" sub="How profile pages are laid out" testId="section-profile-layout">
        <Seg
          value={profileLayout}
          onChange={handleProfileLayoutChange}
          options={[
            { value: "classic", label: "Classic" },
            { value: "identity", label: "Identity" },
          ] as const}
          testIdBase="profile-layout"
          ariaLabel="Profile page layout"
        />
      </Row>

      <TranslationRow />

      <Row
        icon={Zap}
        label="Performance"
        sub={perfMode === "auto" ? (isLite ? "Auto chose Lite for this device" : "Auto chose Full for this device") : undefined}
        testId="section-performance"
      >
        <Seg
          value={perfMode}
          onChange={setPerfMode}
          options={PERF_OPTIONS}
          testIdBase="perf"
          ariaLabel="Performance mode"
        />
      </Row>

      <Row icon={Eye} label="Contrast" testId="section-accessibility">
        <Seg
          value={level}
          onChange={setLevel}
          options={CONTRAST_OPTIONS}
          testIdBase="contrast"
          ariaLabel="Contrast level"
        />
      </Row>

      {/* Desktop-only: the new Stories rail is the default; this is the escape
          hatch back to the classic labeled sidebar. Hidden on mobile (mobile
          chrome is unaffected). */}
      {!isMobile && (
        <Row
          icon={PanelLeft}
          label="Classic sidebar"
          sub="Use the labeled sidebar instead of the icon rail (desktop)"
          testId="section-classic-sidebar"
        >
          <Switch
            checked={classicSidebar}
            onCheckedChange={setClassicSidebar}
            data-testid="switch-classic-sidebar"
          />
        </Row>
      )}
    </RowSection>
  );
}

const WEIGHT_FIELDS: { key: keyof EngagementWeights; label: string; icon: string }[] = [
  { key: "replies", label: "Replies", icon: "💬" },
  { key: "reposts", label: "Reposts", icon: "🔁" },
  { key: "likes", label: "Likes", icon: "❤️" },
  { key: "zaps", label: "Zaps", icon: "⚡" },
  { key: "satsBonus", label: "Sats Bonus", icon: "₿" },
];

function EngagementWeightsEditor() {
  const [weights, setWeights] = useState<EngagementWeights>(() => getEngagementWeights());
  const { toast } = useToast();

  const updateWeight = (key: keyof EngagementWeights, delta: number) => {
    const current = weights[key];
    const next = Math.max(0, Math.min(10, current + delta));
    if (next === current) return;
    const updated = { ...weights, [key]: next };
    setWeights(updated);
    saveEngagementWeights(updated);
  };

  const isDefault = JSON.stringify(weights) === JSON.stringify(DEFAULT_ENGAGEMENT_WEIGHTS);

  const resetToDefaults = () => {
    setWeights({ ...DEFAULT_ENGAGEMENT_WEIGHTS });
    saveEngagementWeights({ ...DEFAULT_ENGAGEMENT_WEIGHTS });
    toast({ title: "Engagement weights reset to defaults" });
  };

  return (
    <div className="space-y-2.5" data-testid="section-engagement-weights">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground/70 dark:text-foreground/60 flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3 text-brand" />
          Ranking weights
        </p>
        {!isDefault && (
          <button
            onClick={resetToDefaults}
            className="text-[10px] text-muted-foreground/65 hover:text-muted-foreground/90 flex items-center gap-1 transition-colors"
            data-testid="button-reset-engagement-weights"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>
      <p className="text-[11px] text-foreground/65 dark:text-muted-foreground/70">
        Control which interactions matter most when ranking posts in your feed.
      </p>

      <div className="space-y-1">
        {WEIGHT_FIELDS.map(({ key, label, icon }) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-lg px-2.5 py-2 border border-border dark:border-brand/8 bg-muted"
            data-testid={`weight-row-${key}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm leading-none shrink-0">{icon}</span>
              <span className="text-[11px] sm:text-xs text-foreground/70 dark:text-foreground/60 font-medium truncate">{label}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => updateWeight(key, -1)}
                disabled={weights[key] <= 0}
                className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-md border border-border dark:border-brand/12 text-foreground/50 hover:text-foreground/80 hover:bg-accent disabled:opacity-25 disabled:cursor-not-allowed transition-all cursor-pointer text-sm font-medium"
                aria-label={`Decrease ${label} weight`}
                data-testid={`button-weight-minus-${key}`}
              >
                −
              </button>
              <span
                className={`w-8 text-center font-mono text-xs sm:text-sm font-bold ${ weights[key] === 0 ? "text-muted-foreground/30" : weights[key] >= 5 ? "text-brand" : "text-foreground/70" }`}
                data-testid={`text-weight-value-${key}`}
              >
                x{weights[key]}
              </span>
              <button
                onClick={() => updateWeight(key, 1)}
                disabled={weights[key] >= 10}
                className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-md border border-border dark:border-brand/12 text-foreground/50 hover:text-foreground/80 hover:bg-accent disabled:opacity-25 disabled:cursor-not-allowed transition-all cursor-pointer text-sm font-medium"
                aria-label={`Increase ${label} weight`}
                data-testid={`button-weight-plus-${key}`}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md p-3 space-y-2"
        style={{ background: "rgba(140, 100, 220, 0.06)", border: "1px solid rgba(140, 100, 220, 0.15)" }}
      >
        <p className="text-[10px] text-brand/70 dark:text-brand/50 font-mono uppercase tracking-wider font-semibold">
          How It Works
        </p>
        <ul className="text-[11px] text-foreground/50 dark:text-muted-foreground/60 space-y-1 list-disc list-inside">
          <li>Each weight multiplies that interaction's contribution to a post's score</li>
          <li>Higher-scored posts appear closer to the top of your feed</li>
          <li>Set a weight to x0 to ignore that signal entirely</li>
          <li>Sats Bonus rewards zapped posts, but the boost levels off as the amount grows — a 10k sat zap doesn't score 10x more than a 1k sat zap, it only scores about 2x more. This keeps big-wallet zaps from dominating your feed.</li>
        </ul>
      </div>
    </div>
  );
}

/** Media rendering + feed intelligence, one row per setting. */
function ContentSection() {
  const [autoplayMedia, setAutoplayMedia] = useState(() => isAutoplayMediaEnabled());
  const [imageLoading, setImageLoading] = useState<"always" | "blur">(() => {
    try {
      const saved = localStorage.getItem("imageLoading");
      if (saved === "blur") return "blur";
    } catch {}
    return "always";
  });
  const [sensitiveContent, setSensitiveContent] = useState<"hide" | "show">(() => {
    try {
      const saved = localStorage.getItem("sensitiveContent");
      if (saved === "show") return "show";
    } catch {}
    return "hide";
  });
  const [showBadges, setShowBadges] = useState(() => areBadgesEnabled());
  const [showClientTag, setShowClientTagState] = useState(getShowClientTag);

  const { wotEnabled, setWotEnabled } = useGrapeRankScores();
  const [ranking, setRanking] = useState(isFeedRankingEnabled);
  const [engagement, setEngagement] = useState(isEngagementScoreEnabled);

  const handleAutoplayChange = (enabled: boolean) => {
    setAutoplayMedia(enabled);
    try { localStorage.setItem("autoplayMedia", String(enabled)); } catch {}
    // Tell this tab. localStorage only fires `storage` in OTHER tabs, so
    // without this the posts already mounted keep the old answer — which in a
    // thread is every post on screen, since rows there mount once and stay.
    try { window.dispatchEvent(new Event(AUTOPLAY_CHANGED_EVENT)); } catch {}
  };

  const handleImageBlurChange = (blur: boolean) => {
    setImageLoading(blur ? "blur" : "always");
    try { localStorage.setItem("imageLoading", blur ? "blur" : "always"); } catch {}
  };

  // Store QA 2.3 (Play answer/12923286): the sensitive-content filter ships
  // ON and may only be disabled behind a NEUTRAL age screen plus two
  // deliberate actions. Toggle → (age screen, once per device) → explicit
  // confirm. Re-enabling is always instant and unguarded.
  const [ageScreenOpen, setAgeScreenOpen] = useState(false);
  const [confirmShowOpen, setConfirmShowOpen] = useState(false);
  const [dob, setDob] = useState("");

  const applySensitive = (mode: "hide" | "show") => {
    setSensitiveContent(mode);
    try { localStorage.setItem("sensitiveContent", mode); } catch {}
  };

  const handleSensitiveChange = (hide: boolean) => {
    if (hide) { applySensitive("hide"); return; }
    if (!hasPassedAgeScreen()) { setDob(""); setAgeScreenOpen(true); return; }
    setConfirmShowOpen(true);
  };

  const handleAgeScreenContinue = () => {
    // Neutral by design: an ineligible answer closes the screen with the
    // filter unchanged — nothing states what answer would have passed.
    const ok = isAdultBirthDate(dob, new Date());
    setAgeScreenOpen(false);
    if (!ok) return;
    recordAgeScreenPassed();
    setConfirmShowOpen(true);
  };

  const handleShowBadgesChange = (enabled: boolean) => {
    setShowBadges(enabled);
    setBadgesEnabled(enabled);
  };

  const handleShowClientTag = (enabled: boolean) => {
    setShowClientTagState(enabled);
    setShowClientTag(enabled);
  };

  return (
    <RowSection label="Content" testId="section-content-prefs">
      <Row icon={Film} label="Auto-play videos" sub="Play videos as you scroll — off = tap to play">
        <Switch checked={autoplayMedia} onCheckedChange={handleAutoplayChange} data-testid="switch-autoplay-media" />
      </Row>
      <Row icon={ImageIcon} label="Blur images until tapped" sub="Off shows images immediately">
        <Switch checked={imageLoading === "blur"} onCheckedChange={handleImageBlurChange} data-testid="switch-image-blur" />
      </Row>
      <Row icon={ShieldAlert} label="Blur sensitive content" sub="Flagged posts stay hidden until revealed">
        <Switch checked={sensitiveContent === "hide"} onCheckedChange={handleSensitiveChange} data-testid="switch-sensitive-blur" />
      </Row>
      <Dialog open={ageScreenOpen} onOpenChange={(open) => { if (!open) setAgeScreenOpen(false); }}>
        <DialogContent className="max-w-sm" data-testid="dialog-age-screen">
          <DialogHeader>
            <DialogTitle>Confirm your date of birth</DialogTitle>
            <DialogDescription>Some settings depend on your age.</DialogDescription>
          </DialogHeader>
          <Input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            data-testid="input-age-screen-dob"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAgeScreenOpen(false)} data-testid="button-age-screen-cancel">Cancel</Button>
            <Button onClick={handleAgeScreenContinue} disabled={!dob} data-testid="button-age-screen-continue">Continue</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmShowOpen} onOpenChange={(open) => { if (!open) setConfirmShowOpen(false); }}>
        <DialogContent className="max-w-sm" data-testid="dialog-sensitive-confirm">
          <DialogHeader>
            <DialogTitle>Show sensitive content?</DialogTitle>
            <DialogDescription>
              Posts and media flagged as sensitive will display without blurring. You can turn the filter back on any time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmShowOpen(false)} data-testid="button-sensitive-confirm-cancel">Keep blurring</Button>
            <Button onClick={() => { applySensitive("show"); setConfirmShowOpen(false); }} data-testid="button-sensitive-confirm-show">Show sensitive content</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Row icon={Award} label="Show badges" sub="NIP-58 badge icons on posts and profiles">
        <Switch checked={showBadges} onCheckedChange={handleShowBadgesChange} data-testid="switch-show-badges" />
      </Row>
      <Row icon={Smartphone} label="Show posting app" sub="“via [App]” on opened posts (self-reported)">
        <Switch checked={showClientTag} onCheckedChange={handleShowClientTag} data-testid="switch-show-client-tag" />
      </Row>

      <Row icon={TrendingUp} label="Feed ranking" sub="Order feeds by engagement — off = newest-first" testId="row-feed-intel-ranking">
        <Switch checked={ranking} onCheckedChange={(v) => { setFeedRankingEnabled(v); setRanking(v); }} data-testid="toggle-feed-intel-ranking" />
      </Row>
      {/* Fine-grained ranking weights are an expert tool — only shown while Feed ranking is on. */}
      {ranking && (
        <ExpandRow
          icon={Sliders}
          label="Ranking weights"
          sub="Advanced — tune which interactions rank posts"
          testId="toggle-advanced-ranking-weights"
        >
          <EngagementWeightsEditor />
        </ExpandRow>
      )}
      <Row icon={BarChart3} label="Engagement score" sub="Interaction-score badge on posts" testId="row-feed-intel-engagement">
        <Switch checked={engagement} onCheckedChange={(v) => { setEngagementScoreEnabled(v); setEngagement(v); }} data-testid="toggle-feed-intel-engagement" />
      </Row>
      <Row icon={ShieldCheck} label="Signal check (Web of Trust)" sub="Trust scores from your social graph" testId="row-feed-intel-signal">
        <Switch checked={wotEnabled} onCheckedChange={(v) => setWotEnabled(v)} data-testid="toggle-feed-intel-signal" />
      </Row>
    </RowSection>
  );
}

function OutpostsEmptyStateRow() {
  const [, setLocation] = useLocation();
  const [hasOutposts, setHasOutposts] = useState(() => getOutpostRelays().length > 0);
  useEffect(() => {
    const sync = () => setHasOutposts(getOutpostRelays().length > 0);
    window.addEventListener("outpost-relays-changed", sync);
    return () => window.removeEventListener("outpost-relays-changed", sync);
  }, []);

  if (hasOutposts) return null;

  return (
    <ActionRow
      icon={Compass}
      label="No Outposts joined yet"
      sub="Community relays around a topic — browse and join"
      onClick={() => setLocation("/outposts")}
      testId="card-outposts-empty-state"
    />
  );
}

function MediaServersExpandRow() {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [servers, setServers] = useState<string[]>(() => getBlossomServers());
  const [newServer, setNewServer] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);
    fetchBlossomServerList(pubkey).then((fetched) => {
      if (fetched.length > 0) {
        setServers(fetched);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pubkey]);

  const addServer = () => {
    let url = newServer.trim();
    if (!url) return;
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      url = "https://" + url;
    }
    try {
      new URL(url);
    } catch {
      toast({ title: "Invalid server URL", variant: "destructive" });
      return;
    }
    if (servers.includes(url)) {
      toast({ title: "Server already added", variant: "destructive" });
      return;
    }
    const updated = [...servers, url];
    setServers(updated);
    setBlossomServers(updated);
    setNewServer("");
  };

  const removeServer = (url: string) => {
    const updated = servers.filter((s) => s !== url);
    setServers(updated);
    setBlossomServers(updated);
  };

  const handlePublish = async () => {
    if (!signer || !pubkey) return;
    setPublishing(true);
    try {
      const ok = await publishBlossomServerList(servers, signer);
      if (ok) {
        toast({ title: "Media server list published" });
      } else {
        toast({ title: "Failed to publish server list", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to publish server list", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  if (!pubkey) return null;

  return (
    <ExpandRow
      icon={HardDrive}
      label="Media servers"
      sub="Blossom servers for your uploads — signed, saved to your profile"
      value={loading ? "…" : String(servers.length)}
      testId="section-media-servers"
    >
      {loading ? (
        <div className="flex items-center gap-2 py-2">
          <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand" />
          <span className="text-xs text-muted-foreground/60">Fetching server list...</span>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/60">
            Uploads try your servers first, then fall back to the default host.
          </p>
          <div className="flex gap-2">
            <Input
              value={newServer}
              onChange={(e) => setNewServer(e.target.value)}
              placeholder="https://blossom.example.com"
              className="text-xs bg-white/[0.03] border-border dark:border-brand/15 focus-visible:border-brand/40 dark:focus-visible:border-brand/30"
              data-testid="input-blossom-server"
              onKeyDown={(e) => {
                if (e.key === "Enter") addServer();
              }}
            />
            <Button
              size="icon"
              variant="outline"
              onClick={addServer}
              disabled={!newServer.trim()}
              className="border-border dark:border-brand/15 bg-muted"
              data-testid="button-add-blossom-server"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {servers.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-foreground/65 dark:text-muted-foreground/70" data-testid="text-no-blossom-servers">
                No media servers configured yet. Use the recommended set or add your own.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setServers(DEFAULT_BLOSSOM_SERVERS);
                  setBlossomServers(DEFAULT_BLOSSOM_SERVERS);
                  toast({ title: "Recommended media servers added" });
                }}
                className="w-full text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15 bg-muted"
                data-testid="button-use-recommended-blossom-servers"
              >
                <Satellite className="w-3.5 h-3.5 mr-2" />
                Use Recommended Servers
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5" data-testid="list-blossom-servers">
              {servers.map((server) => (
                <div
                  key={server}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2"
                  style={{ border: "1px solid rgba(140, 100, 220, 0.12)" }}
                  data-testid={`blossom-server-${server.replace(/[^a-z0-9]/gi, "-")}`}
                >
                  <HardDrive className="w-3.5 h-3.5 text-brand shrink-0" />
                  <span className="flex-1 min-w-0 text-xs font-mono text-foreground/80 truncate">
                    {server}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeServer(server)}
                    data-testid={`button-remove-blossom-${server.replace(/[^a-z0-9]/gi, "-")}`}
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground/60" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {servers.length > 0 && signer && (
            <Button
              onClick={handlePublish}
              disabled={publishing}
              variant="outline"
              className="w-full text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15 bg-muted"
              data-testid="button-publish-blossom-servers"
            >
              {publishing ? (
                <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-2" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5 mr-2" />
              )}
              Publish Server List
            </Button>
          )}

          {/* Full sync UI lives on /media-servers — just point there. */}
          <button
            type="button"
            onClick={() => setLocation("/media-servers")}
            className={`text-[11px] text-brand/80 hover:text-brand transition-colors ${FOCUS_RING}`}
            data-testid="link-sync-media-to-server"
          >
            Sync media to a server →
          </button>
        </div>
      )}
    </ExpandRow>
  );
}

const MATRIX_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*!?<>{}[]~^";

function MatrixBrandBlock() {
  const [phase, setPhase] = useState<"idle" | "scramble1" | "reveal1" | "scramble2" | "reveal2">("idle");
  const [displayText, setDisplayText] = useState("Relay Outpost");
  const [versionText, setVersionText] = useState(`v${APP_VERSION}`);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRef = useRef(false);

  const MSG1 = "Built on Nostr";
  const MSG2 = "Verify Your Digital Identity";

  const cleanup = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  const scrambleReveal = useCallback((target: string, onDone: () => void) => {
    const len = target.length;
    let tick = 0;
    const totalTicks = len * 2;
    intervalRef.current = setInterval(() => {
      tick++;
      const revealed = Math.floor((tick / totalTicks) * len);
      const chars = target.split("").map((ch, i) => {
        if (i < revealed) return ch;
        if (ch === " ") return " ";
        return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
      });
      setDisplayText(chars.join(""));
      if (tick >= totalTicks) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setDisplayText(target);
        onDone();
      }
    }, 55);
  }, []);

  const handleEnter = useCallback(() => {
    hoverRef.current = true;
    cleanup();
    timeoutRef.current = setTimeout(() => {
      if (!hoverRef.current) return;
      setPhase("scramble1");
      setVersionText("");
      scrambleReveal(MSG1, () => {
        setPhase("reveal1");
        timeoutRef.current = setTimeout(() => {
          if (!hoverRef.current) return;
          setPhase("scramble2");
          scrambleReveal(MSG2, () => {
            setPhase("reveal2");
          });
        }, 2200);
      });
    }, 400);
  }, [cleanup, scrambleReveal]);

  const handleLeave = useCallback(() => {
    hoverRef.current = false;
    cleanup();
    setPhase("idle");
    setDisplayText("Relay Outpost");
    setVersionText(`v${APP_VERSION}`);
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  const isMatrix = phase !== "idle";

  return (
    <div
      className="flex items-center gap-2 min-w-0 cursor-default select-none"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <RelayOutpostIcon className={`w-5 h-5 shrink-0 transition-all duration-500 ${isMatrix ? "text-brand drop-shadow-[0_0_6px_rgba(139,92,246,0.6)]" : "text-brand/70 dark:text-brand/60"}`} />
      <p className={`text-[11px] font-semibold tracking-wide transition-all duration-300 whitespace-nowrap ${isMatrix ? "font-mono text-brand drop-shadow-[0_0_4px_rgba(139,92,246,0.4)]" : "text-foreground/70"}`}>
        {displayText}
        {versionText && (
          <span className="text-[9px] text-foreground/25 dark:text-muted-foreground/35 font-mono font-normal ml-1" data-testid="text-about-version">{versionText}</span>
        )}
      </p>
    </div>
  );
}

// PRIVACY setting (default OFF = previews shown): when ON, the Chats list
// shows a generic line instead of message text — one toggle for BOTH 1:1 DMs
// and encrypted group chats, like a phone's lock-screen preview switch.
function HideMessagePreviewsRow() {
  const [hidden, setHidden] = useState(getHideMessagePreviews);
  const handleToggle = (value: boolean) => {
    setHidden(value);
    setHideMessagePreviews(value);
  };
  return (
    <Row icon={EyeOff} label="Hide message previews" sub="Chat list shows a generic line instead of message text">
      <Switch checked={hidden} onCheckedChange={handleToggle} data-testid="switch-hide-message-previews" />
    </Row>
  );
}

// Private mode's STANDING half: Chats opens masked and re-arms whenever the
// app goes to background. The eye in the chat-list header is the instant half
// — "the eye hides your chats now; the setting makes them start hidden."
// A screen-share shield, not a lock: names/avatars/previews blur until tapped.
function PrivateModeRow() {
  const [enabled, setEnabled] = useState(getPrivateModeSetting);
  const handleToggle = (value: boolean) => {
    setEnabled(value);
    setPrivateModeSetting(value);
  };
  return (
    <Row icon={ShieldCheck} label="Open chats in private mode" sub="Chats start hidden — tap to reveal. Hides again when you leave the app">
      <Switch checked={enabled} onCheckedChange={handleToggle} data-testid="switch-private-mode" />
    </Row>
  );
}

// Controls how private-message history is decrypted with your signer. ON =
// history waits for an explicit "Decrypt" tap, grouping signer prompts into
// one action (recommended for Amber/nsec.app-style signers).
function BatchedDecryptionRow() {
  const [batched, setBatched] = useState(() => {
    try { return localStorage.getItem("relay-outpost-batch-decryption") === "true"; } catch { return false; }
  });
  const handleToggle = (value: boolean) => {
    setBatched(value);
    try { localStorage.setItem("relay-outpost-batch-decryption", String(value)); } catch {}
  };
  return (
    <Row icon={Lock} label="Batched decryption" sub="Group signer prompts — for Amber / nsec.app-style signers">
      <Switch checked={batched} onCheckedChange={handleToggle} data-testid="switch-batch-decryption" />
    </Row>
  );
}

// Default ON — only the literal "false" disables it (matches clientTags() in
// nostr-helpers). Synced across devices via the NIP-78 settings map.
function AttributionRow() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem("relay-outpost-client-tag-enabled") !== "false"; } catch { return true; }
  });
  const handleToggle = (value: boolean) => {
    setEnabled(value);
    try { localStorage.setItem("relay-outpost-client-tag-enabled", String(value)); } catch {}
  };
  return (
    <Row icon={Tag} label="Attribute posts to Relay Outpost" sub="Tiny “client” tag so apps can show what you posted with">
      <Switch checked={enabled} onCheckedChange={handleToggle} data-testid="switch-client-tag" />
    </Row>
  );
}

function TranslationRow() {
  const [enabled, setEnabled] = useState(() => translationEnabled());
  const [autoLangs, setAutoLangs] = useState<string[]>(() => getAutoTranslateLangs());
  const handleToggle = (value: boolean) => {
    setEnabled(value);
    setTranslationEnabled(value);
  };
  const removeLang = (lang: string) => {
    removeAutoTranslateLang(lang);
    setAutoLangs(getAutoTranslateLangs());
  };
  return (
    <>
      <Row icon={Globe} label="Translate foreign posts" sub="Shows a Translate link on posts in languages you don't read. Free — translated on your device when possible, or through Relay Outpost." testId="section-translation">
        <Switch checked={enabled} onCheckedChange={handleToggle} data-testid="switch-translation" />
      </Row>
      {enabled && !translationCapable() && (
        <div className="pl-12 pr-3 pb-3 -mt-1 text-[11px] text-muted-foreground/60" data-testid="text-translation-unsupported">
          Not active in this browser yet — it needs built-in translation (Chrome or Edge) or a network translator. Links appear automatically once available.
        </div>
      )}
      {enabled && autoLangs.length > 0 && (
        <div className="pl-12 pr-3 pb-3 -mt-1 flex items-center gap-1.5 flex-wrap" data-testid="translation-auto-langs">
          <span className="text-[11px] text-muted-foreground/60">Always translating:</span>
          {autoLangs.map((lang) => (
            <button
              key={lang}
              onClick={() => removeLang(lang)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/50 text-[11px] text-foreground/80 hover:border-destructive/40 hover:text-destructive"
              title={`Stop auto-translating ${languageName(lang)}`}
              data-testid={`button-remove-auto-lang-${lang}`}
            >
              {languageName(lang)} <X className="w-2.5 h-2.5" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function CrashReportsRow() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem("relay-outpost-crash-reports-enabled") !== "false"; } catch { return true; }
  });
  const handleToggle = (value: boolean) => {
    setEnabled(value);
    try { localStorage.setItem("relay-outpost-crash-reports-enabled", String(value)); } catch {}
  };
  return (
    <Row icon={Bug} label="Send anonymous crash reports" sub="Helps us fix bugs faster. Anonymous — never tied to your account.">
      <Switch checked={enabled} onCheckedChange={handleToggle} data-testid="switch-crash-reports" />
    </Row>
  );
}

function FeedbackTicketsRow() {
  const { pubkey } = useNostrAuth();
  const unread = useFeedbackUnread();
  if (!pubkey) return null;
  return (
    <LinkRow
      href="/tickets"
      icon={Inbox}
      label={
        <span className="inline-flex items-center gap-2">
          Your tickets
          {unread > 0 && (
            <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-primary text-primary-foreground" data-testid="badge-tickets-unread">{unread}</span>
          )}
        </span>
      }
      sub="Feedback you've sent and operator replies"
      testId="link-settings-your-tickets"
    />
  );
}

export default function Settings() {
  const { pubkey, loginMethod } = useNostrAuth();
  useDocumentTitle("Settings");
  const { wotEnabled } = useGrapeRankScores();

  useEffect(() => {
    if (window.innerWidth >= 640) return;
    const handleFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 350);
      }
    };
    document.addEventListener("focusin", handleFocus);
    return () => document.removeEventListener("focusin", handleFocus);
  }, []);

  // Deep-link support: /settings#news-alerts (linked from the News priority
  // strip) scrolls to that section once the page has painted.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const t = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(t);
  }, []);

  const settingsCategories: SettingsCategory[] = [
    { id: "appearance", label: "Appearance" },
    { id: "feed", label: "Feed & content" },
    { id: "network", label: "Network" },
    { id: "safety", label: "Safety" },
    ...(pubkey ? [{ id: "tools", label: "Tools" }] : []),
    { id: "help", label: "Help" },
    ...(pubkey ? [{ id: "account", label: "Account" }] : []),
  ];

  // Real-world sign-in methods. The labels describe what the user actually did
  // to connect; the sub-line is the key-custody guarantee.
  const signInRow = pubkey && (() => {
    const standalone = isPWAStandalone();

    let Icon: IconComponent = Fingerprint;
    let title = "Connected";
    let trustLine = "Your private key is held by your signer";

    if (loginMethod === "extension") {
      Icon = Puzzle;
      title = "Browser Extension";
      trustLine = "Your private key stays inside your extension";
    } else if (loginMethod === "bunker") {
      Icon = Unplug;
      title = "Remote Signer";
      trustLine = "Your private key never leaves your remote signer";
    } else if (loginMethod === "qr") {
      Icon = QrCode;
      title = "Remote Signer (paired by QR)";
      trustLine = "Your private key never leaves your remote signer";
    } else if (loginMethod === "local") {
      Icon = standalone ? Smartphone : KeyRound;
      title = standalone ? "On-Device Key (installed app)" : "On-Device Key";
      trustLine = standalone
        ? "Your private key is encrypted on this device"
        : "Your private key is encrypted in this browser's storage";
    }

    return (
      <Row icon={Icon} label={title} sub={trustLine} testId="section-auth-status" labelTestId="text-auth-method">
        <CheckCircle2 className="w-4 h-4 text-emerald-500/80 shrink-0" />
      </Row>
    );
  })();

  return (
    <div className="px-3 sm:px-4 py-4 sm:py-6 pb-[calc(7rem+env(safe-area-inset-bottom))]" data-testid="page-settings">
      <div className="max-w-2xl lg:max-w-5xl mx-auto">

        <div className="relative rounded-md overflow-hidden border border-border dark:border-brand/15 glass-settings-header shadow-sm dark:shadow-none mb-4">
          <div className="absolute inset-0 pointer-events-none glass-settings-header-glow" />
          <div className="relative px-3 py-2.5 flex items-center gap-2.5">
            <SettingsIcon className="w-4 h-4 text-brand/70" />
            <h1 className="text-base font-semibold text-foreground" data-testid="text-settings-title">
              Settings
            </h1>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[12rem_1fr] lg:gap-8 lg:items-start">
          <SettingsNav items={settingsCategories} />

          <div className="min-w-0 space-y-7">

            <CategoryGroup id="appearance" title="Appearance">
              <AppearanceSection />
              <AppSection />
            </CategoryGroup>

            <CategoryGroup id="feed" title="Feed & content">
              <LaunchSection />
              <DiscoverSection />
              <NewsAlertsSection />
              <ContentSection />
              <ChatsSection />
              <ReadAloudSection />
            </CategoryGroup>

            <CategoryGroup id="network" title="Network">
              <RowSection label="Relays" testId="section-relay-status">
                <LinkRow
                  href="/relays"
                  icon={Radio}
                  label="Manage relays"
                  sub="Add, remove and curate your relay set"
                  testId="button-edit-relays"
                />
                <OutpostsEmptyStateRow />
                <ExpandRow icon={Antenna} label="Relay status" sub="Connection health for your current relays" testId="toggle-relay-status">
                  <RelayPanel />
                </ExpandRow>
                <DMRelaysExpandRow />
              </RowSection>
              <RowSection label="Servers">
                <MediaServersExpandRow />
                <SchedulerExpandRow />
              </RowSection>
            </CategoryGroup>

            <CategoryGroup id="safety" title="Safety">
              <RowSection testId="section-privacy">
                <HideMessagePreviewsRow />
                <PrivateModeRow />
                <LinkRow
                  href="/shield-matrix"
                  icon={ShieldMatrixIcon}
                  label="Trust & safety"
                  sub="Web of Trust & moderation"
                  right={
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground/40 shrink-0">
                      <span className={`w-2 h-2 rounded-full ${wotEnabled ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-slate-500/50"}`} />
                      <span>{wotEnabled ? "Active" : "Off"}</span>
                    </span>
                  }
                  testId="link-shield-matrix"
                />
              </RowSection>
            </CategoryGroup>

            {pubkey && (
              <CategoryGroup id="tools" title="Tools">
                <RowSection>
                  <LinkRow
                    href="/tools"
                    icon={Wrench}
                    label="Open Tools"
                    sub="Wallet, relays, bookmarks, analytics & more"
                    testId="link-open-tools"
                  />
                </RowSection>
              </CategoryGroup>
            )}

            <CategoryGroup id="help" title="Help">
              <RowSection>
                <ActionRow
                  icon={MessageSquarePlus}
                  label="Send Feedback"
                  sub="Report bugs, share ideas, ask the operator"
                  onClick={() => openFeedbackDrawer()}
                  testId="button-settings-send-feedback"
                />
                <FeedbackTicketsRow />
              </RowSection>
            </CategoryGroup>

            {pubkey && (
              <CategoryGroup id="account" title="Account">
                <RowSection>
                  {/* The menu's "Account" chip moved onto the identity chip's
                      sheet — this row keeps /account one tap from Settings. */}
                  <LinkRow
                    href="/account"
                    icon={AccountIcon}
                    label="Account & keys"
                    sub="Your dashboard, profile and key backup"
                    testId="link-settings-account-keys"
                  />
                  {signInRow}
                  <BatchedDecryptionRow />
                  <AttributionRow />
                  <CrashReportsRow />
                  {/* Destructive account tools live on their own page so the
                      main Settings scroll stays calm — see SettingsDanger.tsx. */}
                  <LinkRow
                    href="/settings/danger"
                    icon={ShieldAlert}
                    label="Advanced & danger zone"
                    testId="link-settings-danger-zone"
                  />
                </RowSection>
              </CategoryGroup>
            )}

          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mt-8 pt-3" data-testid="section-about">
          <MatrixBrandBlock />
          <a
            href="https://megistus.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex items-center gap-2.5 px-3 py-2 rounded-2xl transition-all duration-500 ease-out hover:scale-[1.04] hover:-translate-y-0.5 active:scale-[0.97] cursor-pointer bg-transparent hover:shadow-[0_4px_24px_rgba(139,92,246,0.15),0_8px_40px_rgba(139,92,246,0.08)] dark:hover:shadow-[0_4px_24px_rgba(167,139,250,0.2),0_8px_40px_rgba(167,139,250,0.12)]"
            data-testid="link-megistus"
          >
            <div className="absolute -inset-3 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 blur-2xl bg-brand/[0.1]/[0.15]" />
            <div className="absolute -inset-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-1000 blur-3xl bg-brand/[0.06]/[0.08]" />
            <div className="relative">
              <img src="/images/megistus-logo-white.webp" alt="Megistus" className="w-12 h-12 object-contain transition-all duration-500 group-hover:scale-[1.3] group-active:scale-[1.35] group-hover:drop-shadow-[0_0_12px_rgba(167,139,250,0.5)] hidden dark:block" />
              <img src="/images/megistus-logo-black.webp" alt="Megistus" className="w-12 h-12 object-contain transition-all duration-500 group-hover:scale-[1.3] group-active:scale-[1.35] group-hover:drop-shadow-[0_0_12px_rgba(139,92,246,0.4)] block dark:hidden" />
            </div>
            <div className="relative flex items-center gap-1 text-[10px] text-foreground/45 dark:text-foreground/35 transition-colors duration-300 group-hover:text-brand/70">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 pick-hammer-icon transition-all duration-500 group-hover:drop-shadow-[0_0_6px_rgba(139,92,246,0.5)] dark:group-hover:drop-shadow-[0_0_6px_rgba(167,139,250,0.6)]">
                <g clipPath="url(#clip0_3261_13891)">
                  <path d="M7.31005 9.15001L6.38005 9.37001C5.71005 9.52001 5.19005 10.05 5.03005 10.71L4.81005 11.64C4.79005 11.74 4.64005 11.74 4.62005 11.64L4.40005 10.71C4.25005 10.04 3.72005 9.52001 3.06005 9.36001L2.13005 9.14001C2.03005 9.12001 2.03005 8.97001 2.13005 8.95001L3.06005 8.73001C3.73005 8.58001 4.25005 8.05001 4.41005 7.39001L4.63005 6.46001C4.65005 6.36001 4.80005 6.36001 4.82005 6.46001L5.04005 7.39001C5.19005 8.06001 5.72005 8.58001 6.38005 8.74001L7.31005 8.96001C7.41005 8.98001 7.41005 9.13001 7.31005 9.15001Z" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" />
                  <path d="M17.38 4.90993L18.73 3.55993C19.41 2.87993 20.51 2.87993 21.19 3.55993C21.87 4.23993 21.87 5.33993 21.19 6.01993L19.84 7.36993" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.49 13.86L5.90001 21.45C5.18001 22.17 4.02001 22.17 3.30001 21.45C2.58001 20.73 2.58001 19.57 3.30001 18.85L10.89 11.26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M16.34 12.93L20.87 17.46C21.16 17.75 21.58 17.84 21.96 17.72C22.34 17.59 22.62 17.26 22.68 16.86C22.97 14.86 22.29 12.85 20.87 11.43L19.36 9.91996L20.13 9.14996C20.33 8.94996 20.44 8.68996 20.44 8.40996C20.44 8.12996 20.33 7.85996 20.13 7.66996L17.09 4.62996C16.68 4.21996 16.01 4.21996 15.6 4.62996L14.83 5.39996L13.32 3.88996C11.89 2.45996 9.88005 1.78996 7.89005 2.07996C7.49005 2.13996 7.16005 2.41996 7.03005 2.79996C6.90005 3.17996 7.00005 3.60996 7.29005 3.88996L11.82 8.41996L10.68 9.55996C10.27 9.96996 10.27 10.64 10.68 11.05L13.72 14.09C13.92 14.29 14.18 14.4 14.46 14.4C14.74 14.4 15.01 14.29 15.2 14.09L16.34 12.95V12.93Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </g>
                <defs>
                  <clipPath id="clip0_3261_13891">
                    <rect width="24" height="24" fill="white"/>
                  </clipPath>
                </defs>
              </svg>
              <span>Crafted by{" "}
                <span className="text-brand/60 group-hover:text-brand-strong transition-colors duration-300 font-medium">
                  Megistus
                </span>
              </span>
            </div>
          </a>
        </div>
        <div className="border-t border-black/[0.06] dark:border-white/[0.04] mt-3" />

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/65 mt-3" data-testid="section-legal-links">
          <Link href="/whats-new" className="inline-flex items-center gap-1 hover:text-foreground/70 transition-colors underline decoration-dotted underline-offset-2" data-testid="link-settings-whats-new">
            What's new
            {hasUnseenChangelog() && <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-label="new updates" />}
          </Link>
          <span className="text-muted-foreground/20">·</span>
          <Link href="/privacy" className="hover:text-foreground/70 transition-colors underline decoration-dotted underline-offset-2" data-testid="link-settings-privacy">
            Privacy
          </Link>
          <span className="text-muted-foreground/20">·</span>
          <Link href="/terms" className="hover:text-foreground/70 transition-colors underline decoration-dotted underline-offset-2" data-testid="link-settings-covenant">
            Terms
          </Link>
          <span className="text-muted-foreground/20">·</span>
          <Link href="/child-safety" className="hover:text-foreground/70 transition-colors underline decoration-dotted underline-offset-2" data-testid="link-settings-child-safety">
            Child safety
          </Link>
        </div>

      </div>
    </div>
  );
}
