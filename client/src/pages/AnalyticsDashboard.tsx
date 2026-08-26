import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { pool, DEFAULT_RELAYS, eventStore, sortByLatency, throttledPoolSubscribe, fetchProfilesCached } from "@/lib/nostr";
import { TrustTierDot } from "@/components/NostrPost";
import { fetchRelayLists, getRelayList } from "@/lib/outbox";
import { fetchUserProfileStats, type UserProfileStats } from "@/lib/primal-cache";
import { getDisplayName, getAvatarUrl, getProfileContent, formatNpub, shortenNpub as shortenNpubHelper } from "@/lib/nostr-helpers";
import { formatSats } from "@/lib/zap";
import { formatDistanceToNow, format } from "date-fns";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { use$ } from "applesauce-react/hooks";
import { UserAdoptionFunnel } from "@/components/analytics/UserAdoptionFunnel";
import { BatchFunnelAnalysis } from "@/components/analytics/BatchFunnelAnalysis";
import { ActivityHeatmap } from "@/components/analytics/ActivityHeatmap";
import { NetworkGrowthTimeline } from "@/components/analytics/NetworkGrowthTimeline";
import { UserSegmentation } from "@/components/analytics/UserSegmentation";
import { ChurnResurrection } from "@/components/analytics/ChurnResurrection";
import { EngagementVelocity } from "@/components/analytics/EngagementVelocity";
import { UserDiscoveryScanner } from "@/components/analytics/UserDiscoveryScanner";
import { ProfileLink } from "@/components/analytics/ProfileLink";
import { HashtagTrends } from "@/components/analytics/HashtagTrends";
import { ZapEconomy } from "@/components/analytics/ZapEconomy";
import { ContentFormatEvolution } from "@/components/analytics/ContentFormatEvolution";
import { ClientDiversity } from "@/components/analytics/ClientDiversity";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from "@/components/ui/dialog";
import {
  BarChart3,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  AreaChart as AreaChartIcon,
  Table as TableIcon,
  Play,
  Save,
  Trash2,
  ChevronDown,
  ChevronUp,
  Activity,
  Users,
  Hash,
  Clock,
  Calendar,
  Layers,
  Radio,
  X,
  RefreshCw,
  Zap,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  UserCircle,
  Target,
  Globe,
  ArrowLeft,
  ExternalLink,
  Repeat2,
  Heart,
  ShieldCheck,
  FileText } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend } from "recharts";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getSignalTier, getSignalTierLabel, formatInfluence, getActiveThresholds, type SignalTier } from "@/lib/graperank";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { fetchArchivesStats, fetchArchivesDailyStats, fetchArchivesZapStats, connectLiveMetrics, fetchActiveOnlineUsers, type ArchivesStats, type ArchivesDailyStats, type ArchivesZapStats, type LiveMetrics, type ActiveUser } from "@/lib/nostr-archives";

const ENGAGEMENT_KINDS = {
  ZAP: 9735,
  REACTION: 7,
  REPLY: 1,
  REPOST: 6,
  BOOKMARK: 10003,
  COMMENT: 1111,
  TEXT_NOTE: 1,
  LONG_FORM: 30023,
  PICTURE: 20,
  VIDEO: 21,
  FOLLOW: 3,
  DM: 4,
  GIFT_WRAP: 1059,
  REPORT: 1984,
  LABEL: 1985,
  MUTE_LIST: 10000,
  CHANNEL_MESSAGE: 42,
  BADGE_AWARD: 8,
  HIGHLIGHT: 9802,
  LIVE_EVENT: 30311,
  MARKETPLACE: 30402,
  CALENDAR_EVENT: 31923,
  CALENDAR_RSVP: 31925,
  SHORT_NOTE: 1,
  POLL: 1068,
  WIKI: 30818 };

const KIND_LABELS: Record<number, string> = {
  0: "Profile",
  1: "Text Note",
  3: "Follows",
  4: "DM",
  6: "Repost",
  7: "Reaction",
  8: "Badge Award",
  20: "Picture",
  21: "Video",
  42: "Channel Msg",
  1059: "Gift Wrap",
  1111: "Comment",
  1984: "Report",
  1985: "Label",
  9735: "Zap",
  9802: "Highlight",
  10000: "Mute List",
  10003: "Bookmark",
  30023: "Long-form",
  30311: "Live Event",
  30402: "Listing",
  30818: "Wiki",
  31923: "Calendar",
  31925: "RSVP",
  1068: "Poll" };

function getKindLabel(kind: number): string {
  return KIND_LABELS[kind] || `Kind ${kind}`;
}

const CHART_COLORS = [
  "#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd",
  "#ddd6fe", "#5b21b6", "#4c1d95", "#ede9fe", "#f5f3ff",
];

const WOT_TIER_RANK: Record<SignalTier, number> = {
  strong: 4,
  moderate: 3,
  low: 2,
  weak: 1,
  flagged: -1,
  none: 0 };

function getWotFilterOptions(): { tier: SignalTier; label: string }[] {
  const t = getActiveThresholds();
  return [
    { tier: "weak", label: `Weak+ (${Math.round(t.weak * 100)}%+)` },
    { tier: "low", label: `Low+ (${Math.round(t.low * 100)}%+)` },
    { tier: "moderate", label: `Moderate+ (${Math.round(t.moderate * 100)}%+)` },
    { tier: "strong", label: `Strong (${Math.round(t.strong * 100)}%+)` },
  ];
}

const ENGAGEMENT_GROUPS = [
  {
    label: "Engagement",
    options: [
      { label: "Zaps", kind: ENGAGEMENT_KINDS.ZAP },
      { label: "Reactions", kind: ENGAGEMENT_KINDS.REACTION },
      { label: "Notes & Replies", kind: ENGAGEMENT_KINDS.REPLY },
      { label: "Reposts", kind: ENGAGEMENT_KINDS.REPOST },
    ] },
  {
    label: "Content",
    options: [
      { label: "Long-form", kind: ENGAGEMENT_KINDS.LONG_FORM },
      { label: "Pictures", kind: ENGAGEMENT_KINDS.PICTURE },
      { label: "Videos", kind: ENGAGEMENT_KINDS.VIDEO },
      { label: "Wiki", kind: ENGAGEMENT_KINDS.WIKI },
      { label: "Polls", kind: ENGAGEMENT_KINDS.POLL },
      { label: "Listings", kind: ENGAGEMENT_KINDS.MARKETPLACE },
      { label: "Reports", kind: ENGAGEMENT_KINDS.REPORT },
    ] },
];

const ENGAGEMENT_OPTIONS = ENGAGEMENT_GROUPS.flatMap((g) => g.options);

const TIME_PRESETS = [
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 21600 },
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 604800 },
  { label: "30d", seconds: 2592000 },
];

const GROUPING_OPTIONS = [
  { value: "kind" as const, label: "By Event Kind", icon: Layers },
  { value: "author" as const, label: "By Author", icon: Users },
  { value: "hour" as const, label: "By Hour", icon: Clock },
  { value: "day" as const, label: "By Day", icon: Calendar },
  { value: "hashtag" as const, label: "By Hashtag", icon: Hash },
  { value: "contentType" as const, label: "By Content Type", icon: Activity },
];

const CHART_TYPES = [
  { value: "pie" as const, label: "Pie", icon: PieChartIcon },
  { value: "bar" as const, label: "Bar", icon: BarChart3 },
  { value: "line" as const, label: "Line", icon: LineChartIcon },
  { value: "area" as const, label: "Area", icon: AreaChartIcon },
  { value: "table" as const, label: "Table", icon: TableIcon },
];

interface AggregatedData {
  label: string;
  value: number;
  metadata?: Record<string, unknown>;
}

interface ReportConfig {
  id: string;
  title: string;
  engagementTypes: number[];
  timeRange: { since: number; until: number };
  groupBy: "kind" | "author" | "hour" | "day" | "hashtag" | "contentType";
  chartType: "pie" | "bar" | "line" | "area" | "table";
  relays: string[];
  limit: number;
  createdAt: number;
}

interface SavedReport extends ReportConfig {
  lastRunAt: number;
  lastData: AggregatedData[];
}

type SortDir = "asc" | "desc";

function shortenNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return npub.slice(0, 12) + "..." + npub.slice(-6);
  } catch {
    return pubkey.slice(0, 8) + "..." + pubkey.slice(-6);
  }
}

function aggregateByKind(events: Event[]): AggregatedData[] {
  const counts = new Map<number, number>();
  for (const e of events) {
    counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
  }
  const total = events.length;
  return Array.from(counts.entries())
    .map(([kind, count]) => ({
      label: getKindLabel(kind),
      value: count,
      metadata: { kind, percent: total > 0 ? ((count / total) * 100).toFixed(1) : "0" } }))
    .sort((a, b) => b.value - a.value);
}

function aggregateByAuthor(events: Event[]): AggregatedData[] {
  const authorMap = new Map<string, { count: number; kinds: Set<number>; lastActive: number }>();
  for (const e of events) {
    const existing = authorMap.get(e.pubkey);
    if (existing) {
      existing.count++;
      existing.kinds.add(e.kind);
      existing.lastActive = Math.max(existing.lastActive, e.created_at);
    } else {
      authorMap.set(e.pubkey, { count: 1, kinds: new Set([e.kind]), lastActive: e.created_at });
    }
  }
  return Array.from(authorMap.entries())
    .map(([pubkey, data]) => ({
      label: shortenNpub(pubkey),
      value: data.count,
      metadata: {
        pubkey,
        kindsUsed: Array.from(data.kinds).map(getKindLabel).join(", "),
        lastActive: data.lastActive } }))
    .sort((a, b) => b.value - a.value);
}

function aggregateByHour(events: Event[]): AggregatedData[] {
  const buckets = new Map<string, { count: number; kinds: Map<number, number> }>();
  for (const e of events) {
    const d = new Date(e.created_at * 1000);
    const key = format(d, "yyyy-MM-dd HH:00");
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.kinds.set(e.kind, (existing.kinds.get(e.kind) || 0) + 1);
    } else {
      const kinds = new Map<number, number>();
      kinds.set(e.kind, 1);
      buckets.set(key, { count: 1, kinds });
    }
  }
  return Array.from(buckets.entries())
    .map(([hour, data]) => {
      let topKind = 0;
      let topCount = 0;
      data.kinds.forEach((c, k) => {
        if (c > topCount) { topKind = k; topCount = c; }
      });
      return {
        label: hour,
        value: data.count,
        metadata: { topKind: getKindLabel(topKind) } };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function aggregateByDay(events: Event[]): AggregatedData[] {
  const buckets = new Map<string, { count: number; kinds: Map<number, number> }>();
  for (const e of events) {
    const d = new Date(e.created_at * 1000);
    const key = format(d, "yyyy-MM-dd");
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.kinds.set(e.kind, (existing.kinds.get(e.kind) || 0) + 1);
    } else {
      const kinds = new Map<number, number>();
      kinds.set(e.kind, 1);
      buckets.set(key, { count: 1, kinds });
    }
  }
  return Array.from(buckets.entries())
    .map(([day, data]) => {
      let topKind = 0;
      let topCount = 0;
      data.kinds.forEach((c, k) => {
        if (c > topCount) { topKind = k; topCount = c; }
      });
      return {
        label: day,
        value: data.count,
        metadata: { topKind: getKindLabel(topKind) } };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function aggregateByHashtag(events: Event[]): AggregatedData[] {
  const tags = new Map<string, { count: number; kinds: Map<number, number> }>();
  for (const e of events) {
    const tTags = e.tags.filter((t) => t[0] === "t" && t[1]);
    for (const tag of tTags) {
      const hashtag = tag[1].toLowerCase();
      const existing = tags.get(hashtag);
      if (existing) {
        existing.count++;
        existing.kinds.set(e.kind, (existing.kinds.get(e.kind) || 0) + 1);
      } else {
        const kinds = new Map<number, number>();
        kinds.set(e.kind, 1);
        tags.set(hashtag, { count: 1, kinds });
      }
    }
  }
  return Array.from(tags.entries())
    .map(([hashtag, data]) => {
      let topKind = 0;
      let topCount = 0;
      data.kinds.forEach((c, k) => {
        if (c > topCount) { topKind = k; topCount = c; }
      });
      return {
        label: `#${hashtag}`,
        value: data.count,
        metadata: { topKind: getKindLabel(topKind) } };
    })
    .sort((a, b) => b.value - a.value);
}

function aggregateByContentType(events: Event[]): AggregatedData[] {
  const types = new Map<string, number>();
  for (const e of events) {
    let contentType = "Other";
    if (e.kind === 9735) contentType = "Zap";
    else if (e.kind === 7) contentType = "Reaction";
    else if (e.kind === 6) contentType = "Repost";
    else if (e.kind === 30023) contentType = "Article";
    else if (e.kind === 20) contentType = "Picture";
    else if (e.kind === 21) contentType = "Video";
    else if (e.kind === 1111) contentType = "Comment";
    else if (e.kind === 10003) contentType = "Bookmark";
    else if (e.kind === 1) {
      const hasETag = e.tags.some((t) => t[0] === "e");
      contentType = hasETag ? "Reply" : "Note";
    }
    types.set(contentType, (types.get(contentType) || 0) + 1);
  }
  const total = events.length;
  return Array.from(types.entries())
    .map(([type, count]) => ({
      label: type,
      value: count,
      metadata: { avgEngagement: total > 0 ? (count / total * 100).toFixed(1) + "%" : "0%" } }))
    .sort((a, b) => b.value - a.value);
}

function runAggregation(events: Event[], groupBy: ReportConfig["groupBy"]): AggregatedData[] {
  switch (groupBy) {
    case "kind": return aggregateByKind(events);
    case "author": return aggregateByAuthor(events);
    case "hour": return aggregateByHour(events);
    case "day": return aggregateByDay(events);
    case "hashtag": return aggregateByHashtag(events);
    case "contentType": return aggregateByContentType(events);
  }
}

function loadSavedReports(): SavedReport[] {
  try {
    const stored = localStorage.getItem("analytics-dashboard-reports");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveSavedReports(reports: SavedReport[]) {
  try {
    localStorage.setItem("analytics-dashboard-reports", JSON.stringify(reports));
  } catch {}
}

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{label || payload[0]?.name}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-foreground">
          {entry.name || "Count"}: <span className="text-brand font-mono">{Number(entry.value).toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

function extractZapAmount(event: Event): number {
  const bolt11Tag = event.tags.find((t) => t[0] === "bolt11");
  if (bolt11Tag && bolt11Tag[1]) {
    const match = bolt11Tag[1].match(/lnbc(\d+)([munp]?)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      const unit = match[2]?.toLowerCase() || "";
      if (unit === "m") return num * 100000;
      if (unit === "u") return num * 100;
      if (unit === "n") return Math.round(num * 0.1);
      if (unit === "p") return Math.round(num * 0.0001);
      return num * 100000000;
    }
  }
  const descTag = event.tags.find((t) => t[0] === "description");
  if (descTag && descTag[1]) {
    try {
      const desc = JSON.parse(descTag[1]);
      const amountTag = desc.tags?.find((t: string[]) => t[0] === "amount");
      if (amountTag) return Math.round(parseInt(amountTag[1], 10) / 1000);
    } catch {}
  }
  return 0;
}

function ZapRevenueSummary({
  events,
  profileMap }: {
  events: Event[];
  profileMap: Map<string, { displayName: string; nip05?: string }>;
}) {
  const zapEvents = useMemo(() => events.filter((e) => e.kind === 9735), [events]);

  const zapData = useMemo(() => {
    if (zapEvents.length === 0) return null;

    let totalSats = 0;
    const zapperTotals = new Map<string, number>();
    const dailyTotals = new Map<string, number>();

    for (const zap of zapEvents) {
      const amount = extractZapAmount(zap);
      totalSats += amount;

      const zapperPubkey = zap.pubkey;
      zapperTotals.set(zapperPubkey, (zapperTotals.get(zapperPubkey) || 0) + amount);

      const day = format(new Date(zap.created_at * 1000), "yyyy-MM-dd");
      dailyTotals.set(day, (dailyTotals.get(day) || 0) + amount);
    }

    const topZappers = Array.from(zapperTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pubkey, sats]) => {
        const profile = profileMap.get(pubkey);
        return {
          pubkey,
          name: profile?.displayName || shortenNpub(pubkey),
          sats };
      });

    const trend = Array.from(dailyTotals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, sats]) => ({ name: day.slice(5), value: sats }));

    const avgZap = zapEvents.length > 0 ? Math.round(totalSats / zapEvents.length) : 0;

    return { totalSats, zapCount: zapEvents.length, topZappers, trend, avgZap };
  }, [zapEvents, profileMap]);

  if (!zapData || zapData.zapCount === 0) return null;

  return (
    <Card className="glass-card overflow-hidden" data-testid="zap-revenue-summary">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          <h2 className="text-sm font-display text-brand">Zap Revenue Summary</h2>
          <Badge variant="secondary" data-testid="badge-zap-count">
            {zapData.zapCount.toLocaleString()} zaps
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Total Sats</p>
            <p className="text-lg font-mono text-amber-600 dark:text-amber-400" data-testid="text-total-sats">
              {formatSats(zapData.totalSats)}
            </p>
          </div>
          <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Avg per Zap</p>
            <p className="text-lg font-mono text-brand" data-testid="text-avg-zap">
              {formatSats(zapData.avgZap)}
            </p>
          </div>
          <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10 col-span-2 sm:col-span-1">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Zap Count</p>
            <p className="text-lg font-mono text-foreground" data-testid="text-zap-total-count">
              {zapData.zapCount.toLocaleString()}
            </p>
          </div>
        </div>

        {zapData.trend.length > 1 && (
          <div data-testid="zap-trend-chart">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">Daily Trend</p>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={zapData.trend}>
                <defs>
                  <linearGradient id="zapGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "currentColor", className: "text-muted-foreground/40" }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltipContent />} />
                <Area type="monotone" dataKey="value" stroke="#f59e0b" fill="url(#zapGradient)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {zapData.topZappers.length > 0 && (
          <div data-testid="top-zappers">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">Top Zappers</p>
            <div className="space-y-1.5">
              {zapData.topZappers.map((zapper, i) => (
                <div key={zapper.pubkey} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground/40 w-4 text-right font-mono">{i + 1}</span>
                  <ProfileLink pubkey={zapper.pubkey} className="text-foreground flex-1" />
                  <span className="font-mono text-amber-600 dark:text-amber-400">{formatSats(zapper.sats)}</span>
                  <span className="text-muted-foreground/40">sats</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ContactDetailPanel({
  pubkey,
  open,
  onClose,
  profileMap,
  events }: {
  pubkey: string | null;
  open: boolean;
  onClose: () => void;
  profileMap: Map<string, { displayName: string; nip05?: string }>;
  events: Event[];
}) {
  const lookupPubkey = pubkey || "";
  const profile = use$(() => lookupPubkey ? eventStore.replaceable(0, lookupPubkey) : undefined, [lookupPubkey]);
  const [primalStats, setPrimalStats] = useState<UserProfileStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const profileContent = useMemo(() => {
    if (!profile) return null;
    return getProfileContent(profile);
  }, [profile]);

  useEffect(() => {
    if (!pubkey || !open) return;
    setLoadingStats(true);
    setPrimalStats(null);
    fetchUserProfileStats(pubkey)
      .then((stats) => setPrimalStats(stats))
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  }, [pubkey, open]);

  const interactionSummary = useMemo(() => {
    if (!pubkey || events.length === 0) return null;
    const authorEvents = events.filter((e) => e.pubkey === pubkey);
    const mentionsOfAuthor = events.filter(
      (e) => e.pubkey !== pubkey && e.tags.some((t) => t[0] === "p" && t[1] === pubkey)
    );
    const kindBreakdown = new Map<number, number>();
    for (const e of authorEvents) {
      kindBreakdown.set(e.kind, (kindBreakdown.get(e.kind) || 0) + 1);
    }
    return {
      totalEvents: authorEvents.length,
      mentionCount: mentionsOfAuthor.length,
      kindBreakdown: Array.from(kindBreakdown.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => ({ kind, label: getKindLabel(kind), count })) };
  }, [pubkey, events]);

  if (!pubkey) return null;

  const displayName = profileContent?.display_name || profileContent?.name || shortenNpub(pubkey);
  const avatarUrl = profileContent?.picture || "";
  const nip05 = profileContent?.nip05 || "";
  const about = profileContent?.about || "";
  const lud16 = (profileContent as any)?.lud16 || "";
  const website = profileContent?.website || "";

  let npub = "";
  try { npub = nip19.npubEncode(pubkey); } catch {}

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="glass-dialog-card border-brand/20 max-w-md max-h-[85vh] overflow-y-auto" data-testid="contact-detail-panel">
        <DialogHeader>
          <DialogTitle className="text-sm font-display text-brand">Contact Detail</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Avatar className="w-14 h-14 border-2 border-brand/30">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback className="bg-brand/10 text-brand text-sm">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 space-y-0.5">
              <ProfileLink pubkey={lookupPubkey} displayName={displayName !== shortenNpub(lookupPubkey) ? displayName : undefined} className="text-sm font-medium text-foreground" data-testid="contact-name" />
              {nip05 && <p className="text-xs text-brand/70 font-mono truncate" data-testid="contact-nip05">{nip05}</p>}
              <p className="text-[10px] text-muted-foreground/50 font-mono truncate">{npub.slice(0, 20)}...</p>
            </div>
          </div>

          {about && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3" data-testid="contact-about">
              {about}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-brand/5 border border-brand/10 space-y-0.5">
              <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">Followers</p>
              <p className="text-sm font-mono text-foreground" data-testid="contact-followers">
                {loadingStats ? "..." : primalStats ? primalStats.followersCount.toLocaleString() : "-"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-brand/5 border border-brand/10 space-y-0.5">
              <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">Following</p>
              <p className="text-sm font-mono text-foreground" data-testid="contact-following">
                {loadingStats ? "..." : primalStats ? primalStats.followingCount.toLocaleString() : "-"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-brand/5 border border-brand/10 space-y-0.5">
              <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">Notes</p>
              <p className="text-sm font-mono text-foreground" data-testid="contact-notes">
                {loadingStats ? "..." : primalStats ? primalStats.noteCount.toLocaleString() : "-"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-brand/5 border border-brand/10 space-y-0.5">
              <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">Replies</p>
              <p className="text-sm font-mono text-foreground" data-testid="contact-replies">
                {loadingStats ? "..." : primalStats ? primalStats.replyCount.toLocaleString() : "-"}
              </p>
            </div>
          </div>

          {interactionSummary && (
            <div className="space-y-2">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Activity in Report</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-brand/5 border border-brand/10">
                  <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Events</p>
                  <p className="text-sm font-mono text-brand">{interactionSummary.totalEvents.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-lg bg-brand/5 border border-brand/10">
                  <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Mentions</p>
                  <p className="text-sm font-mono text-brand">{interactionSummary.mentionCount.toLocaleString()}</p>
                </div>
              </div>
              {interactionSummary.kindBreakdown.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Event Types</p>
                  {interactionSummary.kindBreakdown.map((kb) => (
                    <div key={kb.kind} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{kb.label}</span>
                      <span className="font-mono text-foreground">{kb.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5 text-xs">
            {lud16 && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Zap className="w-3 h-3 text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="truncate font-mono">{lud16}</span>
              </div>
            )}
            {website && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <ArrowUpRight className="w-3 h-3 shrink-0" />
                <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="truncate text-brand/70">
                  {website}
                </a>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-brand/10">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                if (npub) window.location.href = `/profile/${npub}`;
              }}
              data-testid="button-view-profile"
            >
              <UserCircle className="w-4 h-4" />
              View Full Profile
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChartRenderer({
  data,
  chartType,
  profileMap }: {
  data: AggregatedData[];
  chartType: ReportConfig["chartType"];
  profileMap?: Map<string, { displayName: string; nip05?: string }>;
}) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground/50 text-sm" data-testid="chart-empty">
        No data to display
      </div>
    );
  }

  if (chartType === "table") return null;

  const chartData = data.slice(0, 20).map((d) => {
    let name = d.label;
    if (profileMap && d.metadata?.pubkey) {
      const profile = profileMap.get(d.metadata.pubkey as string);
      if (profile) name = profile.displayName;
    }
    return { name, value: d.value };
  });

  if (chartType === "pie") {
    return (
      <div data-testid="chart-pie" className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius={100}
              dataKey="value"
              nameKey="name"
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              labelLine={false}
              fontSize={10}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltipContent />} />
            <Legend
              wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-body)" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === "bar") {
    return (
      <div data-testid="chart-bar" className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,100,220,0.1)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} />
            <Tooltip content={<CustomTooltipContent />} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === "line") {
    return (
      <div data-testid="chart-line" className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,100,220,0.1)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} />
            <Tooltip content={<CustomTooltipContent />} />
            <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#a78bfa", r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div data-testid="chart-area" className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,100,220,0.1)" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} angle={-35} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} />
          <Tooltip content={<CustomTooltipContent />} />
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="url(#areaGrad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const TABLE_PAGE_SIZE = 50;

function SortableTable({
  data,
  groupBy,
  totalEvents,
  profileMap,
  rawEvents }: {
  data: AggregatedData[];
  groupBy: ReportConfig["groupBy"];
  totalEvents: number;
  profileMap?: Map<string, { displayName: string; nip05?: string }>;
  rawEvents?: Event[];
}) {
  const [sortCol, setSortCol] = useState<string>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(TABLE_PAGE_SIZE);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...data];
    arr.sort((a, b) => {
      let av: any, bv: any;
      if (sortCol === "value") { av = a.value; bv = b.value; }
      else if (sortCol === "label") { av = a.label; bv = b.label; }
      else { av = a.value; bv = b.value; }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [data, sortCol, sortDir]);

  const SortHeader = ({ col, children }: { col: string; children: string }) => (
    <th
      className="px-3 py-2 text-left text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 cursor-pointer select-none"
      onClick={() => toggleSort(col)}
      data-testid={`sort-header-${col}`}
    >
      <span className="flex items-center gap-1 flex-wrap">
        {children}
        {sortCol === col && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  const renderRows = () => {
    switch (groupBy) {
      case "kind":
        return sorted.map((row, i) => (
          <tr key={i} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`table-row-${i}`}>
            <td className="px-3 py-2 text-xs font-mono text-brand">{String(row.metadata?.kind ?? "")}</td>
            <td className="px-3 py-2 text-xs">{row.label}</td>
            <td className="px-3 py-2 text-xs font-mono">{row.value.toLocaleString()}</td>
            <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{row.metadata?.percent as string}%</td>
          </tr>
        ));
      case "author":
        return sorted.map((row, i) => {
          const pubkey = row.metadata?.pubkey as string;
          const profile = pubkey && profileMap ? profileMap.get(pubkey) : undefined;
          return (
            <tr
              key={i}
              className={`${i % 2 === 0 ? "opacity-100" : "opacity-80"} cursor-pointer hover-elevate`}
              onClick={() => pubkey && setSelectedPubkey(pubkey)}
              data-testid={`table-row-${i}`}
            >
              <td className="px-3 py-2 text-xs">
                <ProfileLink pubkey={pubkey} displayName={profile?.displayName} className="text-foreground font-medium" fallbackClassName="text-brand font-mono" />
              </td>
              <td className="px-3 py-2 text-xs font-mono">{row.value.toLocaleString()}</td>
              <td className="px-3 py-2 text-xs truncate max-w-[200px]">{row.metadata?.kindsUsed as string}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {row.metadata?.lastActive ? formatDistanceToNow(new Date((row.metadata.lastActive as number) * 1000), { addSuffix: true }) : "-"}
              </td>
            </tr>
          );
        });
      case "hour":
      case "day":
        return sorted.map((row, i) => (
          <tr key={i} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`table-row-${i}`}>
            <td className="px-3 py-2 text-xs font-mono text-brand">{row.label}</td>
            <td className="px-3 py-2 text-xs font-mono">{row.value.toLocaleString()}</td>
            <td className="px-3 py-2 text-xs">{row.metadata?.topKind as string}</td>
          </tr>
        ));
      case "hashtag":
        return sorted.map((row, i) => (
          <tr key={i} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`table-row-${i}`}>
            <td className="px-3 py-2 text-xs font-mono text-brand">{row.label}</td>
            <td className="px-3 py-2 text-xs font-mono">{row.value.toLocaleString()}</td>
            <td className="px-3 py-2 text-xs">{row.metadata?.topKind as string}</td>
          </tr>
        ));
      case "contentType":
        return sorted.map((row, i) => (
          <tr key={i} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`table-row-${i}`}>
            <td className="px-3 py-2 text-xs text-brand">{row.label}</td>
            <td className="px-3 py-2 text-xs font-mono">{row.value.toLocaleString()}</td>
            <td className="px-3 py-2 text-xs text-muted-foreground">{row.metadata?.avgEngagement as string}</td>
          </tr>
        ));
    }
  };

  const renderHeaders = () => {
    switch (groupBy) {
      case "kind":
        return (
          <tr>
            <SortHeader col="kind">Kind</SortHeader>
            <SortHeader col="label">Label</SortHeader>
            <SortHeader col="value">Count</SortHeader>
            <SortHeader col="percent">% of Total</SortHeader>
          </tr>
        );
      case "author":
        return (
          <tr>
            <SortHeader col="label">Author</SortHeader>
            <SortHeader col="value">Event Count</SortHeader>
            <SortHeader col="kinds">Kinds Used</SortHeader>
            <SortHeader col="lastActive">Last Active</SortHeader>
          </tr>
        );
      case "hour":
      case "day":
        return (
          <tr>
            <SortHeader col="label">Time Period</SortHeader>
            <SortHeader col="value">Event Count</SortHeader>
            <SortHeader col="topKind">Top Kind</SortHeader>
          </tr>
        );
      case "hashtag":
        return (
          <tr>
            <SortHeader col="label">Hashtag</SortHeader>
            <SortHeader col="value">Mention Count</SortHeader>
            <SortHeader col="topKind">Top Kind</SortHeader>
          </tr>
        );
      case "contentType":
        return (
          <tr>
            <SortHeader col="label">Type</SortHeader>
            <SortHeader col="value">Count</SortHeader>
            <SortHeader col="avg">Avg Engagement</SortHeader>
          </tr>
        );
    }
  };

  const paginatedSorted = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);
  const hasMore = sorted.length > visibleCount;

  const renderPaginatedRows = () => {
    const originalRender = renderRows();
    if (!originalRender) return null;
    return originalRender.slice(0, visibleCount);
  };

  return (
    <div className="overflow-x-auto -mx-3 sm:mx-0 rounded-md" data-testid="results-table">
      <div className="min-w-[360px]">
        <table className="w-full">
          <thead className="border-b border-brand/20">{renderHeaders()}</thead>
          <tbody>{renderPaginatedRows()}</tbody>
        </table>
      </div>
      <div className="px-3 py-2 flex items-center justify-between flex-wrap gap-2 border-t border-brand/10">
        <span className="text-[10px] text-muted-foreground/50 font-brand uppercase tracking-widest">
          Showing {Math.min(visibleCount, data.length).toLocaleString()} of {data.length.toLocaleString()} rows | {totalEvents.toLocaleString()} total events
        </span>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisibleCount((prev) => prev + TABLE_PAGE_SIZE)}
            className="text-xs text-brand h-7"
            data-testid="button-show-more-rows"
          >
            Show more ({Math.min(TABLE_PAGE_SIZE, sorted.length - visibleCount).toLocaleString()})
          </Button>
        )}
      </div>
      {groupBy === "author" && (
        <ContactDetailPanel
          pubkey={selectedPubkey}
          open={!!selectedPubkey}
          onClose={() => setSelectedPubkey(null)}
          profileMap={profileMap || new Map()}
          events={rawEvents || []}
        />
      )}
    </div>
  );
}

const EVENT_FEED_PAGE = 25;

const FEED_TIER_OPTIONS: { tier: SignalTier | "all"; label: string }[] = [
  { tier: "all", label: "All" },
  { tier: "strong", label: "Strong" },
  { tier: "moderate", label: "Moderate+" },
  { tier: "low", label: "Low+" },
  { tier: "weak", label: "Weak+" },
  { tier: "none", label: "Unscored" },
];

function getEventThreadUrl(event: Event): string | null {
  try {
    if (event.kind === 6) {
      const eTag = event.tags.find(t => t[0] === "e" && t[1]);
      if (eTag) return `/thread/${nip19.noteEncode(eTag[1])}`;
      try {
        const inner = JSON.parse(event.content);
        if (inner?.id) return `/thread/${nip19.noteEncode(inner.id)}`;
      } catch {}
      return null;
    }
    if (event.kind === 7 || event.kind === 9735) {
      const eTag = event.tags.find(t => t[0] === "e" && t[1]);
      if (eTag) return `/thread/${nip19.noteEncode(eTag[1])}`;
      return null;
    }
    return `/thread/${nip19.noteEncode(event.id)}`;
  } catch {
    return null;
  }
}

function getRenderedSnippet(event: Event, profileMap?: Map<string, { displayName: string; nip05?: string }>): { text: string; icon?: "repost" | "reaction" | "zap" } | null {
  if (event.kind === 6) {
    let innerText = "";
    try {
      const inner = JSON.parse(event.content);
      if (inner?.content) {
        innerText = inner.content;
      }
    } catch {}
    if (!innerText) {
      const eTag = event.tags.find(t => t[0] === "e" && t[1]);
      if (eTag) {
        try { innerText = `Reposted ${nip19.noteEncode(eTag[1]).slice(0, 16)}…`; } catch { innerText = "Reposted a note"; }
      } else innerText = "Repost";
    }
    const truncated = innerText.length > 200 ? innerText.slice(0, 200) + "..." : innerText;
    return { text: truncated, icon: "repost" };
  }

  if (event.kind === 7) {
    const emoji = event.content || "❤️";
    const eTag = event.tags.find(t => t[0] === "e" && t[1]);
    const text = eTag ? `Reacted ${emoji} to a note` : `Reaction: ${emoji}`;
    return { text, icon: "reaction" };
  }

  if (event.kind === 9735) {
    const sats = extractZapAmount(event);
    const amountStr = sats > 0 ? ` ${formatSats(sats)}` : "";
    let comment = "";
    const desc = event.tags.find(t => t[0] === "description" && t[1]);
    if (desc) {
      try {
        const zapReq = JSON.parse(desc[1]);
        if (zapReq?.content) comment = `: "${zapReq.content.slice(0, 100)}"`;
      } catch {}
    }
    return { text: `Zap${amountStr}${comment}`, icon: "zap" };
  }

  const content = event.content || "";
  if (!content) {
    const kindLabel = getKindLabel(event.kind);
    return { text: kindLabel };
  }

  const cleaned = content.replace(/nostr:(npub|nprofile|note|nevent|naddr)1[a-z0-9]+/gi, (match) => {
    try {
      const decoded = nip19.decode(match.replace("nostr:", ""));
      if (decoded.type === "npub") {
        const name = profileMap?.get(decoded.data as string)?.displayName;
        return name ? `@${name}` : `@${(decoded.data as string).slice(0, 8)}…`;
      }
      if (decoded.type === "nprofile") {
        const pk = (decoded.data as { pubkey: string }).pubkey;
        const name = profileMap?.get(pk)?.displayName;
        return name ? `@${name}` : `@${pk.slice(0, 8)}…`;
      }
      if (decoded.type === "note") return `note:${(decoded.data as string).slice(0, 8)}…`;
      if (decoded.type === "nevent") return `note:${(decoded.data as { id: string }).id.slice(0, 8)}…`;
    } catch {}
    return match.slice(0, 20) + "…";
  });
  const truncated = cleaned.length > 200 ? cleaned.slice(0, 200) + "..." : cleaned;
  return { text: truncated };
}

function EventFeed({ events, profileMap }: { events: Event[]; profileMap?: Map<string, { displayName: string; nip05?: string }> }) {
  const [visibleCount, setVisibleCount] = useState(EVENT_FEED_PAGE);
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedTierFilter, setFeedTierFilter] = useState<SignalTier | "all">("all");
  const { scores: wotScores, wotEnabled: globalWotEnabled } = useGrapeRankScores();

  const sortedEvents = useMemo(() => {
    if (!feedOpen) return [];
    return [...events].sort((a, b) => b.created_at - a.created_at);
  }, [events, feedOpen]);

  const filteredEvents = useMemo(() => {
    if (feedTierFilter === "all" || !wotScores || wotScores.size === 0) return sortedEvents;
    if (feedTierFilter === "none") {
      return sortedEvents.filter((e) => !wotScores.has(e.pubkey) || getSignalTier(wotScores.get(e.pubkey) ?? null) === "none");
    }
    const minRank = WOT_TIER_RANK[feedTierFilter];
    return sortedEvents.filter((e) => {
      const influence = wotScores.get(e.pubkey) ?? null;
      const tier = getSignalTier(influence);
      return WOT_TIER_RANK[tier] >= minRank;
    });
  }, [sortedEvents, feedTierFilter, wotScores]);

  const visible = filteredEvents.slice(0, visibleCount);
  const hasMore = filteredEvents.length > visibleCount;

  useEffect(() => {
    setVisibleCount(EVENT_FEED_PAGE);
  }, [events, feedTierFilter]);

  if (events.length === 0) return null;

  return (
    <Collapsible open={feedOpen} onOpenChange={setFeedOpen}>
      <div className="border-t border-brand/10 pt-3">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 w-full text-left" data-testid="toggle-event-feed">
            <Radio className="w-3.5 h-3.5 text-brand" />
            <span className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
              Event Feed
            </span>
            <Badge variant="secondary" className="text-[9px]">{events.length.toLocaleString()}</Badge>
            {feedOpen && (
              <span className="text-[9px] text-muted-foreground/30">
                Newest first · {Math.min(visibleCount, filteredEvents.length)} of {filteredEvents.length.toLocaleString()}
                {feedTierFilter !== "all" && ` (filtered from ${events.length.toLocaleString()})`}
              </span>
            )}
            <div className="flex-1" />
            {feedOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {globalWotEnabled && wotScores && wotScores.size > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap" data-testid="feed-tier-filter">
              <ShieldCheck className="w-3 h-3 text-muted-foreground/40" />
              {FEED_TIER_OPTIONS.map((opt) => (
                <button
                  key={opt.tier}
                  onClick={(e) => { e.stopPropagation(); setFeedTierFilter(opt.tier); }}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    feedTierFilter === opt.tier
                      ? "bg-brand dark:bg-brand/20 text-foreground border border-brand/40 dark:border-brand/30"
                      : "bg-secondary/50 text-foreground/70 border border-transparent hover:bg-secondary"
                  }`}
                  data-testid={`feed-tier-${opt.tier}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1" data-testid="event-feed">
            {visible.map((event) => {
              const kindLabel = getKindLabel(event.kind);
              const snippet = getRenderedSnippet(event, profileMap);
              const threadUrl = getEventThreadUrl(event);
              return (
                <div
                  key={event.id}
                  className="flex gap-2.5 p-2 rounded-md hover:bg-brand/5 transition-colors group"
                  data-testid={`feed-event-${event.id.slice(0, 8)}`}
                >
                  <div className="flex-shrink-0 pt-0.5">
                    <ProfileLink
                      pubkey={event.pubkey}
                      showAvatar={true}
                      avatarSize="md"
                      className="text-xs font-medium text-foreground"
                      fallbackClassName="text-xs font-mono text-brand"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${
                        event.kind === 6 ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                        event.kind === 7 ? "bg-pink-500/10 text-pink-500 border-pink-500/20" :
                        event.kind === 9735 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : ""
                      }`}>
                        {snippet?.icon === "repost" && <Repeat2 className="w-2.5 h-2.5 mr-0.5 inline" />}
                        {snippet?.icon === "reaction" && <Heart className="w-2.5 h-2.5 mr-0.5 inline" />}
                        {snippet?.icon === "zap" && <Zap className="w-2.5 h-2.5 mr-0.5 inline" />}
                        {kindLabel}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground/40">
                        {formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })}
                      </span>
                    </div>
                    {threadUrl ? (
                      <Link
                        href={threadUrl}
                        className="block text-[11px] text-muted-foreground/70 leading-relaxed break-words line-clamp-3 hover:text-foreground/80 transition-colors cursor-pointer"
                      >
                        {snippet?.text || "View event"}
                        <ExternalLink className="w-2.5 h-2.5 ml-1 inline opacity-0 group-hover:opacity-50 transition-opacity" />
                      </Link>
                    ) : snippet?.text ? (
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed break-words line-clamp-3">
                        {snippet.text}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {filteredEvents.length === 0 && events.length > 0 && (
              <p className="text-xs text-muted-foreground/50 text-center py-4">
                No events match the selected trust tier
              </p>
            )}
            {hasMore && (
              <div className="pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVisibleCount((prev) => prev + EVENT_FEED_PAGE)}
                  className="text-xs text-brand h-7 w-full"
                  data-testid="button-show-more-events"
                >
                  Show more ({Math.min(EVENT_FEED_PAGE, filteredEvents.length - visibleCount).toLocaleString()} more)
                </Button>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

const ACTIVITY_META: Record<string, { label: string; color: string; icon: string }> = {
  posted: { label: "Posted", color: "text-emerald-600 dark:text-emerald-400", icon: "✎" },
  reacted: { label: "Reacted", color: "text-pink-600 dark:text-pink-400", icon: "♥" },
  zapped: { label: "Zapped", color: "text-amber-600 dark:text-amber-400", icon: "⚡" },
  reposted: { label: "Reposted", color: "text-sky-600 dark:text-sky-400", icon: "↻" },
};

function OnlineUserCard({ pubkey, activity, score }: { pubkey: string; activity: string; score: number | null }) {
  const profile = use$(() => eventStore.replaceable(0, pubkey), [pubkey]);

  useEffect(() => {
    if (!profile) fetchProfilesCached([pubkey]);
  }, [pubkey, profile]);

  const { name, picture } = useMemo(() => {
    let resolvedName = "";
    let pic = "";
    if (profile) {
      const content = getProfileContent(profile);
      resolvedName = content?.display_name || content?.name || "";
      pic = content?.picture || "";
    }
    if (!resolvedName) {
      try {
        const npub = nip19.npubEncode(pubkey);
        resolvedName = npub.slice(0, 8) + "..." + npub.slice(-4);
      } catch {
        resolvedName = pubkey.slice(0, 8) + "..." + pubkey.slice(-4);
      }
    }
    return { name: resolvedName, picture: pic };
  }, [pubkey, profile]);

  let npubStr = "";
  try { npubStr = nip19.npubEncode(pubkey); } catch {}

  const meta = ACTIVITY_META[activity] || { label: activity, color: "text-muted-foreground/50", icon: "•" };

  return (
    <Link href={npubStr ? `/profile/${npubStr}` : "#"} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
      <div className="group flex flex-col items-center gap-0.5 p-2 sm:p-2.5 rounded-xl border border-black/[0.06] dark:border-white/[0.04] bg-black/[0.02] dark:bg-white/[0.02] hover:border-brand/20 hover:bg-brand/[0.04] transition-all duration-200 cursor-pointer min-w-0">
        <div className="relative mb-0.5">
          <Avatar className="w-9 h-9 sm:w-10 sm:h-10 ring-1 ring-black/[0.06] dark:ring-white/[0.06] group-hover:ring-brand/20 transition-all">
            {picture ? <AvatarImage src={picture} alt={name} /> : null}
            <AvatarFallback className="bg-brand/10 text-brand text-[10px] font-bold">
              {name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <TrustTierDot pubkey={pubkey} />
        </div>
        <span className="text-[10px] text-foreground/90 truncate w-full text-center leading-tight font-medium">{name}</span>
        <span className="text-[9px] text-muted-foreground/50 tabular-nums leading-none">{formatInfluence(score)}</span>
        <span className={`text-[8px] ${meta.color} flex items-center gap-0.5 leading-none`}>
          <span className="text-[7px]">{meta.icon}</span>
          {meta.label}
        </span>
      </div>
    </Link>
  );
}

function OnlineWotDialog({ open, onOpenChange, onlineCount }: { open: boolean; onOpenChange: (v: boolean) => void; onlineCount: number }) {
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [fetchingActive, setFetchingActive] = useState(false);
  const [tierFilter, setTierFilter] = useState<SignalTier | "all">("all");
  const [relationFilter, setRelationFilter] = useState<"all" | "following" | "followers">("all");
  const { scores: wotScores, requestScoresBulk, wotEnabled, followedByPubkeys } = useGrapeRankScores();
  const { pubkey: viewerPubkey, follows: viewerFollows } = useNostrAuth();
  const scoreMap = wotScores ?? new Map<string, number>();
  const followingSet = useMemo(() => new Set(viewerFollows ?? []), [viewerFollows]);
  const followersSet = useMemo(() => followedByPubkeys ?? new Set<string>(), [followedByPubkeys]);
  const hasFollowing = !!viewerPubkey && followingSet.size > 0;
  const hasFollowers = !!viewerPubkey && followersSet.size > 0;
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    setActiveUsers([]);
    setFetchingActive(true);

    fetchActiveOnlineUsers()
      .then((users) => {
        setActiveUsers(users);
        const unscored = users.map(u => u.pubkey).filter(pk => !wotScores?.has(pk));
        if (unscored.length > 0) requestScoresBulk(unscored);
      })
      .catch(() => setActiveUsers([]))
      .finally(() => setFetchingActive(false));
  }, [open]);

  useEffect(() => {
    if (!open) fetchedRef.current = false;
  }, [open]);

  const WOT_TIER_RANK: Record<string, number> = useMemo(() => ({
    strong: 4, moderate: 3, low: 2, weak: 1, none: 0,
  }), []);

  const filteredAndSorted = useMemo(() => {
    const withScores = activeUsers.map((u) => {
      const influence = scoreMap.get(u.pubkey) ?? null;
      const tier = getSignalTier(influence);
      return { ...u, influence, tier, rank: WOT_TIER_RANK[tier] ?? 0 };
    });

    const tierFiltered = tierFilter === "all"
      ? withScores
      : withScores.filter((u) => u.tier === tierFilter);

    const filtered = relationFilter === "all"
      ? tierFiltered
      : relationFilter === "following"
        ? tierFiltered.filter((u) => followingSet.has(u.pubkey))
        : tierFiltered.filter((u) => followersSet.has(u.pubkey));

    filtered.sort((a, b) => b.rank - a.rank || ((b.influence ?? -1) - (a.influence ?? -1)));
    return filtered;
  }, [activeUsers, scoreMap, tierFilter, relationFilter, followingSet, followersSet, WOT_TIER_RANK]);

  const hasWot = !!(wotEnabled && wotScores && wotScores.size > 0);

  useEffect(() => {
    if (!hasWot && tierFilter !== "all") setTierFilter("all");
  }, [hasWot, tierFilter]);

  useEffect(() => {
    if (relationFilter === "following" && !hasFollowing) setRelationFilter("all");
    if (relationFilter === "followers" && !hasFollowers) setRelationFilter("all");
  }, [relationFilter, hasFollowing, hasFollowers]);

  const followingOnlineCount = useMemo(
    () => activeUsers.reduce((n, u) => n + (followingSet.has(u.pubkey) ? 1 : 0), 0),
    [activeUsers, followingSet],
  );
  const followersOnlineCount = useMemo(
    () => activeUsers.reduce((n, u) => n + (followersSet.has(u.pubkey) ? 1 : 0), 0),
    [activeUsers, followersSet],
  );

  const TIER_BUTTON_STYLES: Record<string, string> = {
    strong: "border-green-500/40 dark:border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10",
    moderate: "border-blue-500/40 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10",
    low: "border-yellow-500/40 dark:border-yellow-500/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10",
    weak: "border-orange-500/40 dark:border-orange-500/30 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10",
    none: "border-muted-foreground/25 dark:border-muted-foreground/20 text-muted-foreground/70 dark:text-muted-foreground/60 hover:bg-muted/20",
  };

  const TIER_BUTTON_ACTIVE: Record<string, string> = {
    strong: "bg-green-500/15 border-green-500/50 dark:border-green-500/40 text-green-700 dark:text-green-300",
    moderate: "bg-blue-500/15 border-blue-500/50 dark:border-blue-500/40 text-blue-700 dark:text-blue-300",
    low: "bg-yellow-500/15 border-yellow-500/50 dark:border-yellow-500/40 text-yellow-700 dark:text-yellow-300",
    weak: "bg-orange-500/15 border-orange-500/50 dark:border-orange-500/40 text-orange-700 dark:text-orange-300",
    none: "bg-muted/30 border-muted-foreground/35 dark:border-muted-foreground/30 text-muted-foreground/80",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[88vh] sm:max-h-[85vh] flex flex-col p-0 gap-0 border-black/[0.08] dark:border-white/[0.06] bg-background/95 backdrop-blur-xl overflow-hidden rounded-2xl">
        <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b border-black/[0.08] dark:border-white/[0.06]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/10">
                <Users className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400" />
              </div>
              <span className="font-display">Active Today</span>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <Badge variant="outline" className="text-[10px] border-green-500/30 dark:border-green-500/20 text-green-600 dark:text-green-400/80 font-mono tabular-nums">
                {onlineCount.toLocaleString()} online
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {!fetchingActive && viewerPubkey && (hasFollowing || hasFollowers) && (
            <div className="flex flex-wrap gap-1.5 mt-3" role="group" aria-label="Filter by relationship" data-testid="container-relation-filters">
              <button
                type="button"
                className={`h-6 text-[10px] px-2.5 rounded-full border transition-all duration-150 ${
                  relationFilter === "all"
                    ? "bg-cyan-500/15 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                    : "border-black/[0.08] dark:border-white/[0.08] text-muted-foreground/70 dark:text-muted-foreground/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                }`}
                onClick={() => setRelationFilter("all")}
                aria-pressed={relationFilter === "all"}
                data-testid="button-relation-all"
              >
                Everyone
              </button>
              {hasFollowing && (
                <button
                  type="button"
                  className={`h-6 text-[10px] px-2.5 rounded-full border transition-all duration-150 inline-flex items-center gap-1.5 ${
                    relationFilter === "following"
                      ? "bg-cyan-500/15 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                      : "border-black/[0.08] dark:border-white/[0.08] text-muted-foreground/70 dark:text-muted-foreground/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  }`}
                  onClick={() => setRelationFilter("following")}
                  aria-pressed={relationFilter === "following"}
                  title="People you follow"
                  data-testid="button-relation-following"
                >
                  Following
                  <span className="font-mono tabular-nums text-[9px] opacity-70">{followingOnlineCount}</span>
                </button>
              )}
              {hasFollowers && (
                <button
                  type="button"
                  className={`h-6 text-[10px] px-2.5 rounded-full border transition-all duration-150 inline-flex items-center gap-1.5 ${
                    relationFilter === "followers"
                      ? "bg-cyan-500/15 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                      : "border-black/[0.08] dark:border-white/[0.08] text-muted-foreground/70 dark:text-muted-foreground/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  }`}
                  onClick={() => setRelationFilter("followers")}
                  aria-pressed={relationFilter === "followers"}
                  title="People who follow you"
                  data-testid="button-relation-followers"
                >
                  Followers
                  <span className="font-mono tabular-nums text-[9px] opacity-70">{followersOnlineCount}</span>
                </button>
              )}
            </div>
          )}

          {!fetchingActive && hasWot && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              <button
                type="button"
                className={`h-6 text-[10px] px-2.5 rounded-full border transition-all duration-150 ${
                  tierFilter === "all"
                    ? "bg-brand/15 border-brand/50 dark:border-brand/40 text-brand"
                    : "border-black/[0.08] dark:border-white/[0.08] text-muted-foreground/70 dark:text-muted-foreground/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                }`}
                onClick={() => setTierFilter("all")}
              >
                All
              </button>
              {(["strong", "moderate", "low", "weak", "none"] as SignalTier[]).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={`h-6 text-[10px] px-2.5 rounded-full border transition-all duration-150 ${
                    tierFilter === tier
                      ? TIER_BUTTON_ACTIVE[tier]
                      : TIER_BUTTON_STYLES[tier]
                  }`}
                  onClick={() => setTierFilter(tier)}
                >
                  {getSignalTierLabel(tier)}
                </button>
              ))}
            </div>
          )}
        </div>

        {fetchingActive ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <RelayOutpostInlineLoader className="w-6 h-6" />
            <p className="text-xs text-muted-foreground/50">Loading active users from Archives...</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 min-h-0 px-3 sm:px-4">
            {filteredAndSorted.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 text-center py-10">
                {activeUsers.length === 0 ? "No active users found" : "No users match this trust tier"}
              </p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 gap-1.5 sm:gap-2 py-3">
                {filteredAndSorted.slice(0, 120).map((u) => (
                  <OnlineUserCard key={u.pubkey} pubkey={u.pubkey} activity={u.activity} score={scoreMap.get(u.pubkey) ?? null} />
                ))}
              </div>
            )}
            {filteredAndSorted.length > 120 && (
              <p className="text-[10px] text-muted-foreground/30 text-center pb-2">
                Showing 120 of {filteredAndSorted.length} active users
              </p>
            )}
          </div>
        )}

        <div className="px-4 sm:px-5 py-2.5 border-t border-black/[0.06] dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.01]">
          <p className="text-[9px] text-muted-foreground/35 text-center tracking-wide">
            Powered by Archives &middot; Filtered by Brainstorm Web of Trust
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NetworkPulse({ pubkey }: { pubkey?: string }) {
  const [stats, setStats] = useState<ArchivesStats | null>(null);
  const [statsFetchedAt, setStatsFetchedAt] = useState<Date | null>(null);
  const [dailyStats, setDailyStats] = useState<ArchivesDailyStats[]>([]);
  const [zapStats, setZapStats] = useState<ArchivesZapStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [wsLiveMetrics, setWsLiveMetrics] = useState<LiveMetrics | null>(null);
  const [onlineWotOpen, setOnlineWotOpen] = useState(false);
  const globalLoadedRef = useRef(false);
  const lastPubkeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const conn = connectLiveMetrics(
      (data) => setWsLiveMetrics(data),
    );
    return () => conn.close();
  }, []);

  useEffect(() => {
    if (!globalLoadedRef.current) {
      globalLoadedRef.current = true;
      (async () => {
        try {
          const [statsRes, dailyRes] = await Promise.allSettled([
            fetchArchivesStats(),
            fetchArchivesDailyStats(7),
          ]);
          if (statsRes.status === "fulfilled") { setStats(statsRes.value); setStatsFetchedAt(new Date()); }
          else setError(true);
          if (dailyRes.status === "fulfilled") setDailyStats(dailyRes.value);
        } catch {
          setError(true);
        } finally {
          setLoading(false);
        }
      })();
    }

    if (!pubkey) {
      lastPubkeyRef.current = undefined;
      setZapStats(null);
    } else if (pubkey !== lastPubkeyRef.current) {
      lastPubkeyRef.current = pubkey;
      setZapStats(null);
      fetchArchivesZapStats(pubkey).then(setZapStats).catch(() => {});
    }
  }, [pubkey]);

  if (error && !stats) {
    return (
      <Card className="glass-card overflow-hidden" data-testid="network-pulse">
        <div className="p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-muted-foreground/40" />
            <span className="text-xs text-muted-foreground/50">Network Pulse temporarily unavailable</span>
          </div>
        </div>
      </Card>
    );
  }

  const formatBigNumber = (n: number | undefined) => {
    if (n === undefined || n === null) return "—";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return n.toLocaleString();
  };

  const uniquePubkeys = stats?.unique_pubkeys ?? stats?.total_profiles;
  const totalNotes = stats?.events_by_kind?.find(k => k.kind === 1)?.count;
  const totalZaps = stats?.events_by_kind?.find(k => k.kind === 9735)?.count;
  const ingestionRate = stats?.ingestion_rate_per_min;

  const liveMetrics = wsLiveMetrics;

  return (
    <Card className="glass-card overflow-hidden" data-testid="network-pulse">
      <div className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-brand" />
          <h3 className="text-xs font-display text-muted-foreground">Network Pulse</h3>
          <a href="https://nostrarchives.com" target="_blank" rel="noopener noreferrer">
            <Badge variant="secondary" className="text-[9px] cursor-pointer hover:bg-brand/20 hover:text-brand transition-colors gap-1"><span className="opacity-50 font-normal">powered by</span> Archives</Badge>
          </a>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <RelayOutpostInlineLoader className="w-5 h-5" />
          </div>
        ) : (
          <>
            {stats && (
              <>
                {liveMetrics && (
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <button
                      type="button"
                      className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.06] to-cyan-500/[0.02] p-2.5 sm:p-3 space-y-1 cursor-pointer hover:border-cyan-500/40 hover:from-cyan-500/[0.10] hover:to-cyan-500/[0.04] transition-all text-left w-full focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      onClick={() => setOnlineWotOpen(true)}
                      title="Click to see active users today filtered by WoT"
                    >
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3 h-3 text-cyan-600/70 dark:text-cyan-400/70" />
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        <p className="text-[9px] sm:text-[10px] text-cyan-600/70 dark:text-cyan-400/70 font-brand uppercase tracking-widest">Online Now</p>
                      </div>
                      <p className="text-xl sm:text-2xl font-mono font-bold text-foreground">{formatBigNumber(liveMetrics.online)}</p>
                      <p className="text-[9px] text-muted-foreground/40">click to view by WoT</p>
                    </button>
                    <div className="rounded-lg border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] to-amber-500/[0.02] p-2.5 sm:p-3 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-amber-600/70 dark:text-amber-400/70" />
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <p className="text-[9px] sm:text-[10px] text-amber-600/70 dark:text-amber-400/70 font-brand uppercase tracking-widest">Live Sats</p>
                      </div>
                      <p className="text-xl sm:text-2xl font-mono font-bold text-foreground">{formatBigNumber(liveMetrics.sats)}</p>
                      <p className="text-[9px] text-muted-foreground/40">live from archives</p>
                    </div>
                    <div className="rounded-lg border border-blue-500/20 bg-gradient-to-br from-blue-500/[0.06] to-blue-500/[0.02] p-2.5 sm:p-3 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-blue-600/70 dark:text-blue-400/70" />
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        <p className="text-[9px] sm:text-[10px] text-blue-600/70 dark:text-blue-400/70 font-brand uppercase tracking-widest">Live Notes</p>
                      </div>
                      <p className="text-xl sm:text-2xl font-mono font-bold text-foreground">{formatBigNumber(liveMetrics.notes)}</p>
                      <p className="text-[9px] text-muted-foreground/40">live from archives</p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] text-muted-foreground/50 font-brand uppercase tracking-widest">All-time totals · powered by Archives</p>
                    {statsFetchedAt && (
                      <p className="text-[9px] text-muted-foreground/40">
                        updated {statsFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5 sm:p-3 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3 h-3 text-emerald-600/70 dark:text-emerald-400/70" />
                        <p className="text-[9px] sm:text-[10px] text-emerald-600/70 dark:text-emerald-400/70 font-brand uppercase tracking-widest">Unique Pubkeys</p>
                      </div>
                      <p className="text-xl sm:text-2xl font-mono font-bold text-foreground">{formatBigNumber(uniquePubkeys)}</p>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5 sm:p-3 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-amber-600/70 dark:text-amber-400/70" />
                        <p className="text-[9px] sm:text-[10px] text-amber-600/70 dark:text-amber-400/70 font-brand uppercase tracking-widest">Zap Events</p>
                      </div>
                      <p className="text-xl sm:text-2xl font-mono font-bold text-foreground">{formatBigNumber(totalZaps)}</p>
                    </div>
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-2.5 sm:p-3 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-blue-600/70 dark:text-blue-400/70" />
                        <p className="text-[9px] sm:text-[10px] text-blue-600/70 dark:text-blue-400/70 font-brand uppercase tracking-widest">Total Notes</p>
                      </div>
                      <p className="text-xl sm:text-2xl font-mono font-bold text-foreground">{formatBigNumber(totalNotes)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50 font-brand uppercase tracking-widest">Total Events</p>
                    <p className="text-lg font-mono font-semibold text-foreground">{formatBigNumber(stats.total_events)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50 font-brand uppercase tracking-widest">Reactions</p>
                    <p className="text-lg font-mono font-semibold text-foreground">{formatBigNumber(stats.events_by_kind?.find(k => k.kind === 7)?.count)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50 font-brand uppercase tracking-widest">Reposts</p>
                    <p className="text-lg font-mono font-semibold text-foreground">{formatBigNumber(stats.events_by_kind?.find(k => k.kind === 6)?.count)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50 font-brand uppercase tracking-widest">Ingestion Rate</p>
                    <p className="text-lg font-mono font-semibold text-brand">
                      {ingestionRate != null ? `${formatBigNumber(Math.round(ingestionRate))}/min` : "—"}
                    </p>
                  </div>
                </div>
              </>
            )}

            {dailyStats.length > 0 && (
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyStats.map(d => ({
                    date: d.date?.slice(5) || "",
                    events: d.events || 0,
                  }))}>
                    <defs>
                      <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="#666" />
                    <Tooltip content={<CustomTooltipContent />} />
                    <Area type="monotone" dataKey="events" stroke="#8b5cf6" fill="url(#pulseGradient)" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {zapStats && (
              <div className="border-t border-border/20 pt-2">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3 h-3 text-yellow-500" />
                  <span className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Your Zap Economy</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50">Received</p>
                    <p className="text-sm font-mono font-semibold text-green-600 dark:text-green-400">{formatBigNumber(zapStats.total_received)} sats</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50">Sent</p>
                    <p className="text-sm font-mono font-semibold text-orange-600 dark:text-orange-400">{formatBigNumber(zapStats.total_sent)} sats</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50">Zaps In</p>
                    <p className="text-sm font-mono">{formatBigNumber(zapStats.zap_count_received)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50">Zaps Out</p>
                    <p className="text-sm font-mono">{formatBigNumber(zapStats.zap_count_sent)}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <OnlineWotDialog
        open={onlineWotOpen}
        onOpenChange={setOnlineWotOpen}
        onlineCount={wsLiveMetrics?.online ?? 0}
      />
    </Card>
  );
}

export default function AnalyticsDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  useDocumentTitle("Console");
  const goBack = useGoBack();

  const urlPubkey = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("npub") || params.get("pubkey") || "";
    if (!raw) return "";
    if (/^[0-9a-f]{64}$/i.test(raw)) return raw;
    try {
      if (raw.startsWith("npub")) {
        const decoded = nip19.decode(raw);
        if (decoded.type === "npub") return decoded.data as string;
      }
    } catch {}
    return raw;
  }, []);

  useEffect(() => {
    const target = window.location.hash === "#adoption-funnel" || urlPubkey ? "adoption-funnel" : null;
    if (!target) return;
    const t = setTimeout(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => clearTimeout(t);
  }, [urlPubkey]);

  const { scores: wotScores, requestScoresBulk, wotEnabled: globalWotEnabled } = useGrapeRankScores();
  const [selectedEngagementTypes, setSelectedEngagementTypes] = useState<number[]>([]);
  const [wotFilterEnabled, setWotFilterEnabled] = useState(false);
  const [wotMinTier, setWotMinTier] = useState<SignalTier>("low");
  const [wotFilteredCount, setWotFilteredCount] = useState(0);
  const unfilteredEventsRef = useRef<Event[]>([]);
  const [timePreset, setTimePreset] = useState<number>(86400);
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [groupBy, setGroupBy] = useState<ReportConfig["groupBy"]>("kind");
  const [chartType, setChartType] = useState<ReportConfig["chartType"]>("table");
  const [selectedRelays, setSelectedRelays] = useState<string[]>([...DEFAULT_RELAYS]);
  const [limit, setLimit] = useState(500);
  const [isLoading, setIsLoading] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [resultData, setResultData] = useState<AggregatedData[]>([]);
  const [rawEvents, setRawEvents] = useState<Event[]>([]);
  const [hasResults, setHasResults] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>(loadSavedReports);
  const [savedReportsOpen, setSavedReportsOpen] = useState(false);
  const [cohortOpen, setCohortOpen] = useState(false);
  const [cohortTimeRange, setCohortTimeRange] = useState(2592000);
  const [cohortWindow, setCohortWindow] = useState(30);
  const [cohortMetric, setCohortMetric] = useState("any");
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortData, setCohortData] = useState<{ label: string; windows: number[] }[]>([]);
  const [cohortWindows, setCohortWindows] = useState<string[]>([]);
  const [profileMap, setProfileMap] = useState<Map<string, { displayName: string; nip05?: string }>>(new Map());
  const subRef = useRef<any>(null);
  const [individualOpen, setIndividualOpen] = useState(!!urlPubkey);
  const [cohortGroupOpen, setCohortGroupOpen] = useState(false);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [adoptionOpen, setAdoptionOpen] = useState(!!urlPubkey);
  const [batchFunnelOpen, setBatchFunnelOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(!!urlPubkey);
  const [networkGrowthOpen, setNetworkGrowthOpen] = useState(false);
  const [segmentationOpen, setSegmentationOpen] = useState(false);
  const [churnOpen, setChurnOpen] = useState(false);
  const [velocityOpen, setVelocityOpen] = useState(!!urlPubkey);
  const [hashtagTrendsOpen, setHashtagTrendsOpen] = useState(false);
  const [zapEconomyOpen, setZapEconomyOpen] = useState(false);
  const [contentFormatOpen, setContentFormatOpen] = useState(false);
  const [clientDiversityOpen, setClientDiversityOpen] = useState(false);
  const [discoveryScannerOpen, setDiscoveryScannerOpen] = useState(false);
  const [customRelayInput, setCustomRelayInput] = useState("");
  const [customRelays, setCustomRelays] = useState<string[]>([]);
  const [userRelayUrls, setUserRelayUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!urlPubkey) return;
    fetchRelayLists([urlPubkey]);
    let cancelled = false;
    let attempts = 0;
    const MAX_USER_RELAYS = 8;
    const MAX_ATTEMPTS = 16;
    const normalizedDefaults = new Set(DEFAULT_RELAYS.map(u => u.replace(/\/+$/, "").toLowerCase()));
    const ingest = () => {
      const relayList = getRelayList(urlPubkey);
      if (relayList.length === 0) return false;
      const seen = new Set<string>();
      const writeRelays: string[] = [];
      for (const r of relayList) {
        if (r.mode !== "write" && r.mode !== "both") continue;
        const norm = r.url.replace(/\/+$/, "").toLowerCase();
        if (normalizedDefaults.has(norm) || seen.has(norm)) continue;
        seen.add(norm);
        writeRelays.push(r.url);
        if (writeRelays.length >= MAX_USER_RELAYS) break;
      }
      if (writeRelays.length === 0) return true;
      if (cancelled) return true;
      const urlSet = new Set(writeRelays);
      setUserRelayUrls(urlSet);
      setCustomRelays(prev => {
        const combined = [...prev];
        for (const r of writeRelays) {
          if (!combined.includes(r)) combined.push(r);
        }
        return combined;
      });
      setSelectedRelays(prev => {
        const combined = [...prev];
        for (const r of writeRelays) {
          if (!combined.includes(r)) combined.push(r);
        }
        return combined;
      });
      return true;
    };
    if (ingest()) return;
    const interval = setInterval(() => {
      attempts++;
      if (ingest() || attempts >= MAX_ATTEMPTS) clearInterval(interval);
    }, 500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [urlPubkey]);

  const allRelays = useMemo(() => {
    const combined = [...DEFAULT_RELAYS];
    for (const r of customRelays) {
      if (!combined.includes(r)) combined.push(r);
    }
    return combined;
  }, [customRelays]);

  const addCustomRelay = useCallback(() => {
    let url = customRelayInput.trim();
    if (!url) return;
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
      url = "wss://" + url;
    }
    try { new URL(url); } catch { return; }
    if (!allRelays.includes(url)) {
      setCustomRelays((prev) => [...prev, url]);
      setSelectedRelays((prev) => [...prev, url]);
    }
    setCustomRelayInput("");
  }, [customRelayInput, allRelays]);

  const removeCustomRelay = useCallback((relay: string) => {
    setCustomRelays((prev) => prev.filter((r) => r !== relay));
    setSelectedRelays((prev) => prev.filter((r) => r !== relay));
  }, []);

  const toggleEngagementType = useCallback((kind: number) => {
    setSelectedEngagementTypes((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]
    );
  }, []);

  const toggleRelay = useCallback((relay: string) => {
    setSelectedRelays((prev) =>
      prev.includes(relay) ? prev.filter((r) => r !== relay) : [...prev, relay]
    );
  }, []);

  const getTimeRange = useCallback(() => {
    if (useCustomTime && customSince) {
      const since = Math.floor(new Date(customSince).getTime() / 1000);
      const until = customUntil ? Math.floor(new Date(customUntil).getTime() / 1000) : Math.floor(Date.now() / 1000);
      return { since, until };
    }
    const now = Math.floor(Date.now() / 1000);
    return { since: now - timePreset, until: now };
  }, [useCustomTime, customSince, customUntil, timePreset]);

  const runReport = useCallback(() => {
    if (selectedRelays.length === 0 || selectedEngagementTypes.length === 0) return;

    if (subRef.current) {
      try { subRef.current.close(); } catch {}
    }

    setIsLoading(true);
    setEventCount(0);
    setResultData([]);
    setHasResults(false);

    const { since, until } = getTimeRange();
    const events: Event[] = [];
    const seenEventIds = new Set<string>();
    const uniqueKinds = Array.from(new Set(selectedEngagementTypes));

    const filter = {
      kinds: uniqueKinds,
      since,
      until,
      limit };

    const sortedRelays = sortByLatency(selectedRelays);
    let reportFinalized = false;
    let reportTimeout: ReturnType<typeof setTimeout>;

    function finalizeReport() {
      if (reportFinalized) return;
      reportFinalized = true;
      clearTimeout(reportTimeout);
      try { sub.close(); } catch {}
      subRef.current = null;

      unfilteredEventsRef.current = events;

      const uniqueAuthors = Array.from(new Set(events.map((e) => e.pubkey)));
      if (uniqueAuthors.length > 0) {
        requestScoresBulk(uniqueAuthors);
      }

      const aggregated = runAggregation(events, groupBy);
      setResultData(aggregated);
      setRawEvents(events);
      setWotFilteredCount(0);
      setHasResults(true);
      setIsLoading(false);

      if (groupBy === "author" && aggregated.length > 0) {
        const pubkeys = aggregated
          .slice(0, 100)
          .map((d) => d.metadata?.pubkey as string)
          .filter(Boolean);
        if (pubkeys.length > 0) {
          const profiles = new Map<string, { displayName: string; nip05?: string }>();
          let profileDone = false;
          const profileSub = throttledPoolSubscribe(
            sortByLatency(selectedRelays).slice(0, 3),
            { kinds: [0], authors: pubkeys } as any,
            {
              onevent(profileEvent: Event) {
                try {
                  const content = JSON.parse(profileEvent.content);
                  const name = content.display_name || content.name || "";
                  if (name) {
                    profiles.set(profileEvent.pubkey, {
                      displayName: name,
                      nip05: content.nip05 || undefined });
                  }
                } catch {}
              },
              oneose() {
                if (profileDone) return;
                profileDone = true;
                profileSub.close();
                if (profiles.size > 0) {
                  setProfileMap((prev) => {
                    const next = new Map(prev);
                    profiles.forEach((v, k) => next.set(k, v));
                    return next;
                  });
                }
              } }
          );
          setTimeout(() => {
            if (!profileDone) {
              profileDone = true;
              try { profileSub.close(); } catch {}
              if (profiles.size > 0) {
                setProfileMap((prev) => {
                  const next = new Map(prev);
                  profiles.forEach((v, k) => next.set(k, v));
                  return next;
                });
              }
            }
          }, 8000);
        }
      }
    }

    const sub = throttledPoolSubscribe(sortedRelays, filter as any, {
      onevent(event: Event) {
        if (seenEventIds.has(event.id)) return;
        if (events.length < limit) {
          seenEventIds.add(event.id);
          events.push(event);
          setEventCount(events.length);
        }
      },
      oneose() {
        finalizeReport();
      } });

    reportTimeout = setTimeout(() => {
      finalizeReport();
    }, 10000);

    subRef.current = sub;
  }, [selectedRelays, selectedEngagementTypes, getTimeRange, limit, groupBy, requestScoresBulk]);

  useEffect(() => {
    const unfiltered = unfilteredEventsRef.current;
    if (unfiltered.length === 0 || !hasResults || isLoading) return;

    if (wotFilterEnabled && wotScores && wotScores.size > 0) {
      const minRank = WOT_TIER_RANK[wotMinTier];
      const filtered = unfiltered.filter((e) => {
        const influence = wotScores.get(e.pubkey) ?? null;
        const tier = getSignalTier(influence);
        return WOT_TIER_RANK[tier] >= minRank;
      });
      setWotFilteredCount(unfiltered.length - filtered.length);
      setRawEvents(filtered);
      setResultData(runAggregation(filtered, groupBy));
    } else {
      setWotFilteredCount(0);
      setRawEvents(unfiltered);
      setResultData(runAggregation(unfiltered, groupBy));
    }
  }, [wotScores, wotFilterEnabled, wotMinTier, hasResults, isLoading, groupBy]);

  const saveReport = useCallback(() => {
    const { since, until } = getTimeRange();
    const report: SavedReport = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: `${GROUPING_OPTIONS.find((g) => g.value === groupBy)?.label || groupBy} Report`,
      engagementTypes: [...selectedEngagementTypes],
      timeRange: { since, until },
      groupBy,
      chartType,
      relays: [...selectedRelays],
      limit,
      createdAt: Date.now(),
      lastRunAt: Date.now(),
      lastData: resultData.slice(0, 50) };
    const updated = [report, ...savedReports];
    setSavedReports(updated);
    saveSavedReports(updated);
  }, [getTimeRange, groupBy, chartType, selectedRelays, limit, selectedEngagementTypes, resultData, savedReports]);

  const deleteReport = useCallback((id: string) => {
    const updated = savedReports.filter((r) => r.id !== id);
    setSavedReports(updated);
    saveSavedReports(updated);
  }, [savedReports]);

  const loadReport = useCallback((report: SavedReport) => {
    setSelectedEngagementTypes(report.engagementTypes);
    setGroupBy(report.groupBy);
    setChartType(report.chartType);
    setSelectedRelays(report.relays);
    setLimit(report.limit);
    setResultData(report.lastData);
    setHasResults(true);
  }, []);

  const runCohortAnalysis = useCallback(() => {
    if (selectedRelays.length === 0) return;
    setCohortLoading(true);
    setCohortData([]);
    setCohortWindows([]);

    const MAX_CONCURRENT = 5;
    const STAGGER_DELAY_MS = 250;
    const AUTHOR_CHUNK_SIZE = 100;
    const MAX_RELAYS = 3;

    const now = Math.floor(Date.now() / 1000);
    const since = now - cohortTimeRange;
    const relaysToUse = sortByLatency(selectedRelays).slice(0, MAX_RELAYS);
    let profileQueryDone = false;

    const profileEvents: Event[] = [];

    function processCohortPipeline() {
      if (profileQueryDone) return;
      profileQueryDone = true;
      try { sub.close(); } catch {}
      clearTimeout(profileTimeout);

      if (profileEvents.length === 0) {
        setCohortLoading(false);
        return;
      }

      const cohortBuckets = new Map<string, string[]>();
      const windowDays = cohortWindow;

      for (const e of profileEvents) {
        const d = new Date(e.created_at * 1000);
        const weekKey = format(d, "yyyy-'W'ww");
        const existing = cohortBuckets.get(weekKey) || [];
        existing.push(e.pubkey);
        cohortBuckets.set(weekKey, existing);
      }

      const windowLabels: string[] = [];
      const windowCount = 5;
      for (let w = 0; w < windowCount; w++) {
        windowLabels.push(`${w * windowDays}-${(w + 1) * windowDays}d`);
      }
      setCohortWindows(windowLabels);

      const metricKinds = cohortMetric === "posts" ? [1]
        : cohortMetric === "replies" ? [1]
        : cohortMetric === "zaps" ? [9735]
        : [1, 6, 7, 9735, 1111];

      let completedCohorts = 0;
      const totalCohorts = cohortBuckets.size;
      const results: { label: string; windows: number[] }[] = [];

      if (totalCohorts === 0) {
        setCohortLoading(false);
        return;
      }

      type QueuedJob = {
        weekLabel: string;
        windowIndex: number;
        chunk: string[];
        activePubkeys: Set<string>;
        uniquePubkeys: string[];
        windowResults: number[];
        completedChunksRef: { count: number; total: number };
        completedWindowsRef: { count: number };
        done: boolean;
      };

      const jobQueue: QueuedJob[] = [];
      let inFlight = 0;

      const cohortState = new Map<string, {
        uniquePubkeys: string[];
        windowResults: number[];
        completedWindowsRef: { count: number };
        windowActivePubkeys: Map<number, Set<string>>;
        windowChunkRefs: Map<number, { count: number; total: number }>;
        windowFinalized: Set<number>;
        finalized: boolean;
      }>();

      cohortBuckets.forEach((pubkeys, weekLabel) => {
        const uniquePubkeys = Array.from(new Set(pubkeys)).slice(0, 500);
        const windowResults: number[] = [];
        const completedWindowsRef = { count: 0 };
        const windowActivePubkeys = new Map<number, Set<string>>();
        const windowChunkRefs = new Map<number, { count: number; total: number }>();

        cohortState.set(weekLabel, {
          uniquePubkeys, windowResults, completedWindowsRef,
          windowActivePubkeys, windowChunkRefs,
          windowFinalized: new Set(),
          finalized: false });

        for (let w = 0; w < windowCount; w++) {
          const authorChunks: string[][] = [];
          for (let i = 0; i < uniquePubkeys.length; i += AUTHOR_CHUNK_SIZE) {
            authorChunks.push(uniquePubkeys.slice(i, i + AUTHOR_CHUNK_SIZE));
          }
          if (authorChunks.length === 0) authorChunks.push([]);

          const activePubkeys = new Set<string>();
          windowActivePubkeys.set(w, activePubkeys);
          const completedChunksRef = { count: 0, total: authorChunks.length };
          windowChunkRefs.set(w, completedChunksRef);

          for (const chunk of authorChunks) {
            jobQueue.push({
              weekLabel,
              windowIndex: w,
              chunk,
              activePubkeys,
              uniquePubkeys,
              windowResults,
              completedChunksRef,
              completedWindowsRef,
              done: false });
          }
        }
      });

      function processNext() {
        while (inFlight < MAX_CONCURRENT && jobQueue.length > 0) {
          const job = jobQueue.shift()!;
          launchJob(job);
        }
      }

      function finalizeWindow(job: QueuedJob) {
        const state = cohortState.get(job.weekLabel);
        if (!state || state.windowFinalized.has(job.windowIndex)) return;
        state.windowFinalized.add(job.windowIndex);
        state.completedWindowsRef.count++;
        state.windowResults[job.windowIndex] = job.uniquePubkeys.length > 0
          ? Math.round((job.activePubkeys.size / job.uniquePubkeys.length) * 100)
          : 0;
        checkCohortDone(job.weekLabel);
      }

      function launchJob(job: QueuedJob) {
        if (job.chunk.length === 0) {
          if (job.done) return;
          job.done = true;
          job.completedChunksRef.count++;
          if (job.completedChunksRef.count === job.completedChunksRef.total) {
            finalizeWindow(job);
          }
          setTimeout(processNext, STAGGER_DELAY_MS);
          return;
        }

        inFlight++;
        const wSince = since + (job.windowIndex * windowDays * 86400);
        const wUntil = wSince + (windowDays * 86400);

        const activitySub = throttledPoolSubscribe(relaysToUse, {
          kinds: metricKinds,
          authors: job.chunk,
          since: wSince,
          until: wUntil,
          limit: 1000 } as any, {
          onevent(event: Event) {
            if (cohortMetric === "replies") {
              if (event.tags.some((t: string[]) => t[0] === "e")) {
                job.activePubkeys.add(event.pubkey);
              }
            } else {
              job.activePubkeys.add(event.pubkey);
            }
          },
          oneose() {
            if (job.done) return;
            job.done = true;
            clearTimeout(jobTimeout);
            activitySub.close();
            inFlight--;
            job.completedChunksRef.count++;

            if (job.completedChunksRef.count === job.completedChunksRef.total) {
              finalizeWindow(job);
            }

            setTimeout(processNext, STAGGER_DELAY_MS);
          } });

        const jobTimeout = setTimeout(() => {
          if (job.done) return;
          job.done = true;
          try { activitySub.close(); } catch {}
          inFlight--;
          job.completedChunksRef.count++;

          if (job.completedChunksRef.count === job.completedChunksRef.total) {
            finalizeWindow(job);
          }

          setTimeout(processNext, STAGGER_DELAY_MS);
        }, 8000);
      }

      function checkCohortDone(weekLabel: string) {
        const state = cohortState.get(weekLabel);
        if (!state || state.finalized) return;
        if (state.completedWindowsRef.count === windowCount) {
          state.finalized = true;
          results.push({ label: weekLabel, windows: [...state.windowResults] });
          completedCohorts++;
          if (completedCohorts === totalCohorts) {
            results.sort((a, b) => a.label.localeCompare(b.label));
            setCohortData(results);
            setCohortLoading(false);
          }
        }
      }

      processNext();
    }

    const sub = throttledPoolSubscribe(relaysToUse, {
      kinds: [0],
      since,
      until: now,
      limit: 5000 } as any, {
      onevent(event: Event) {
        profileEvents.push(event);
      },
      oneose() {
        processCohortPipeline();
      } });

    const profileTimeout = setTimeout(() => {
      processCohortPipeline();
    }, 10000);
  }, [selectedRelays, cohortTimeRange, cohortWindow, cohortMetric]);

  const chartTypeIcon = (ct: ReportConfig["chartType"]) => {
    switch (ct) {
      case "pie": return <PieChartIcon className="w-3 h-3" />;
      case "bar": return <BarChart3 className="w-3 h-3" />;
      case "line": return <LineChartIcon className="w-3 h-3" />;
      case "area": return <AreaChartIcon className="w-3 h-3" />;
      case "table": return <TableIcon className="w-3 h-3" />;
    }
  };

  return (
    <div className={embedded ? "space-y-6" : "max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-6 space-y-6 pb-24"} data-testid="analytics-dashboard">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {!embedded && (
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 sm:w-8 sm:h-8 shrink-0"
              onClick={() => goBack("/")}
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-brand/70 shrink-0" />
          <h1 className="text-base sm:text-lg font-semibold text-foreground" data-testid="page-title">
            Analytics Dashboard
          </h1>
        </div>
        <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground ml-9 sm:ml-10">
          Engagement analytics & reporting
        </p>
      </div>
      <NetworkPulse pubkey={urlPubkey || undefined} />
      <Card className="glass-card overflow-hidden min-w-0" data-testid="report-builder">
        <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand shrink-0" />
            <h2 className="text-xs sm:text-sm font-display text-muted-foreground">Report Builder</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                  Data Source
                </Label>
                <div className="space-y-2">
                  {ENGAGEMENT_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/30 mb-1">{group.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.options.map((opt) => (
                          <button
                            key={opt.kind}
                            onClick={() => toggleEngagementType(opt.kind)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                              selectedEngagementTypes.includes(opt.kind)
                                ? "bg-brand dark:bg-brand/20 text-foreground border border-brand/40 dark:border-brand/30"
                                : "bg-secondary/50 text-foreground/70 dark:text-foreground/70 border border-transparent hover:bg-secondary"
                            }`}
                            data-testid={`toggle-engagement-${opt.label.toLowerCase().replace(/\s+/g, "-")}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    Time Range
                  </Label>
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px] text-muted-foreground/50">Custom</Label>
                    <Switch
                      checked={useCustomTime}
                      onCheckedChange={setUseCustomTime}
                      data-testid="switch-custom-time"
                    />
                  </div>
                </div>
                {!useCustomTime ? (
                  <div className="flex flex-wrap gap-1.5">
                    {TIME_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => setTimePreset(preset.seconds)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          timePreset === preset.seconds
                            ? "bg-brand dark:bg-brand/20 text-foreground border border-brand/40 dark:border-brand/30"
                            : "bg-secondary/50 text-foreground/70 dark:text-foreground/70 border border-transparent hover:bg-secondary"
                        }`}
                        data-testid={`button-time-${preset.label}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <div className="space-y-1 flex-1 min-w-[140px]">
                      <Label className="text-[10px] text-muted-foreground/50">Start</Label>
                      <Input
                        type="datetime-local"
                        value={customSince}
                        onChange={(e) => setCustomSince(e.target.value)}
                        className="text-sm sm:text-xs"
                        style={{ fontSize: "16px" }}
                        data-testid="input-custom-since"
                      />
                    </div>
                    <div className="space-y-1 flex-1 min-w-[140px]">
                      <Label className="text-[10px] text-muted-foreground/50">End</Label>
                      <Input
                        type="datetime-local"
                        value={customUntil}
                        onChange={(e) => setCustomUntil(e.target.value)}
                        className="text-sm sm:text-xs"
                        style={{ fontSize: "16px" }}
                        data-testid="input-custom-until"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                  Grouping
                </Label>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as ReportConfig["groupBy"])}>
                  <SelectTrigger className="text-sm sm:text-xs" style={{ fontSize: "16px" }} data-testid="select-grouping">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUPING_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} data-testid={`option-group-${opt.value}`}>
                        <span className="flex items-center gap-2">
                          <opt.icon className="w-3.5 h-3.5 text-brand" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                  Chart Type
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {CHART_TYPES.map((ct) => (
                    <button
                      key={ct.value}
                      onClick={() => setChartType(ct.value)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        chartType === ct.value
                          ? "bg-brand dark:bg-brand/20 text-foreground border border-brand/40 dark:border-brand/30"
                          : "bg-secondary/50 text-foreground/70 dark:text-foreground/70 border border-transparent hover:bg-secondary"
                      }`}
                      data-testid={`button-chart-${ct.value}`}
                    >
                      <ct.icon className="w-3.5 h-3.5" />
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    Relays
                  </Label>
                  <Badge variant="secondary">{selectedRelays.length} selected</Badge>
                  {userRelayUrls.size > 0 && (
                    <Badge variant="outline" className="text-[9px] border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
                      +{userRelayUrls.size} from user
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1.5 mb-1">
                  <Input
                    value={customRelayInput}
                    onChange={(e) => setCustomRelayInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomRelay(); } }}
                    placeholder="wss://relay.example.com"
                    className="text-base sm:text-xs h-7 font-mono bg-background/50"
                    data-testid="input-custom-relay"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[10px] shrink-0"
                    onClick={addCustomRelay}
                    disabled={!customRelayInput.trim()}
                    data-testid="button-add-relay"
                  >
                    Add
                  </Button>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 scrollbar-hide">
                  {allRelays.map((relay) => {
                    const isCustom = customRelays.includes(relay);
                    const isUserRelay = userRelayUrls.has(relay);
                    return (
                      <div key={relay} className="flex items-center gap-1">
                        <button
                          onClick={() => toggleRelay(relay)}
                          className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-mono text-left transition-colors ${
                            selectedRelays.includes(relay)
                              ? isUserRelay ? "bg-cyan-500/10 text-foreground" : "bg-brand/10 text-foreground"
                              : "text-muted-foreground/50"
                          }`}
                          data-testid={`relay-toggle-${relay.replace(/[^a-z0-9]/gi, "-")}`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${selectedRelays.includes(relay) ? isUserRelay ? "bg-cyan-500" : "bg-green-500" : "bg-muted-foreground/30"}`} />
                          <span className="truncate">{relay}</span>
                          {isUserRelay && (
                            <span className="text-[9px] text-cyan-600 dark:text-cyan-400 shrink-0 ml-auto">user</span>
                          )}
                        </button>
                        {isCustom && !isUserRelay && (
                          <button
                            onClick={() => removeCustomRelay(relay)}
                            className="p-1 text-muted-foreground/40 hover:text-red-600 dark:hover:text-red-400 transition-colors shrink-0"
                            data-testid={`button-remove-relay-${relay.replace(/[^a-z0-9]/gi, "-")}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    WoT Filter
                  </Label>
                  <div className="flex items-center gap-2">
                    {!globalWotEnabled && (
                      <span className="text-[9px] text-amber-600 dark:text-amber-400">WoT disabled in settings</span>
                    )}
                    <Switch
                      checked={wotFilterEnabled}
                      onCheckedChange={setWotFilterEnabled}
                      disabled={!globalWotEnabled || !wotScores || wotScores.size === 0}
                      data-testid="switch-wot-filter"
                    />
                  </div>
                </div>
                {wotFilterEnabled && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {getWotFilterOptions().map((opt) => (
                        <button
                          key={opt.tier}
                          onClick={() => setWotMinTier(opt.tier)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                            wotMinTier === opt.tier
                              ? "bg-brand dark:bg-brand/20 text-foreground border border-brand/40 dark:border-brand/30"
                              : "bg-secondary/50 text-foreground/70 dark:text-foreground/70 border border-transparent hover:bg-secondary"
                          }`}
                          data-testid={`wot-tier-${opt.tier}`}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {hasResults && (() => {
                      const unfiltered = unfilteredEventsRef.current;
                      const uniqueAuthors = new Set(unfiltered.map((e) => e.pubkey));
                      const scored = wotScores ? Array.from(uniqueAuthors).filter((pk) => wotScores.has(pk)).length : 0;
                      return (
                        <div className="space-y-0.5">
                          {wotFilteredCount > 0 && (
                            <p className="text-[10px] text-muted-foreground/60">
                              {wotFilteredCount.toLocaleString()} events filtered out by WoT
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground/40">
                            {scored}/{uniqueAuthors.size} authors scored
                            {scored < uniqueAuthors.size && " (scores loading...)"}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    Limit
                  </Label>
                  <span className="text-xs font-mono text-brand" data-testid="text-limit-value">
                    {limit.toLocaleString()}
                  </span>
                </div>
                <Slider
                  value={[limit]}
                  onValueChange={(v) => setLimit(v[0])}
                  min={50}
                  max={5000}
                  step={50}
                  data-testid="slider-limit"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Button
              onClick={runReport}
              disabled={isLoading || selectedRelays.length === 0 || selectedEngagementTypes.length === 0}
              className="gap-2"
              data-testid="button-run-report"
            >
              {isLoading ? (
                <>
                  <RelayOutpostInlineLoader className="w-4 h-4" />
                  Querying... ({eventCount.toLocaleString()})
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Report
                </>
              )}
            </Button>
            {hasResults && (
              <Button variant="outline" onClick={saveReport} className="gap-2" data-testid="button-save-report">
                <Save className="w-4 h-4" />
                Save Report
              </Button>
            )}
          </div>
        </div>
      </Card>
      {(isLoading || hasResults) && (
        <Card className="glass-card overflow-hidden min-w-0" data-testid="report-results">
          <div className="p-3 sm:p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {chartTypeIcon(chartType)}
                <h2 className="text-sm font-display text-muted-foreground">Results</h2>
                <Badge variant="secondary" data-testid="badge-event-count">
                  {rawEvents.length.toLocaleString()} events
                </Badge>
                {wotFilterEnabled && wotFilteredCount > 0 && (
                  <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-400/40 dark:border-emerald-500/30" data-testid="badge-wot-filter">
                    <ShieldCheck className="w-3 h-3" />
                    WoT: {getSignalTierLabel(wotMinTier)}+
                  </Badge>
                )}
              </div>
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                {GROUPING_OPTIONS.find((g) => g.value === groupBy)?.label}
              </p>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3" data-testid="loading-state">
                <RelayOutpostInlineLoader className="w-8 h-8 text-brand" />
                <p className="text-sm text-muted-foreground">
                  Fetching events... <span className="text-brand font-mono">{eventCount.toLocaleString()}</span>
                </p>
              </div>
            ) : (
              <>
                {chartType !== "table" && <ChartRenderer data={resultData} chartType={chartType} profileMap={profileMap} />}
                <SortableTable data={resultData} groupBy={groupBy} totalEvents={rawEvents.length} profileMap={profileMap} rawEvents={rawEvents} />
                <EventFeed events={rawEvents} profileMap={profileMap} />
              </>
            )}
          </div>
        </Card>
      )}
      {hasResults && <ZapRevenueSummary events={rawEvents} profileMap={profileMap} />}
      <div className="space-y-3" data-testid="section-individual">
        <button
          onClick={() => setIndividualOpen(!individualOpen)}
          className="flex items-center gap-2 w-full text-left group"
          data-testid="button-toggle-individual-section"
        >
          <UserCircle className="w-4 h-4 text-brand" />
          <h2 className="text-xs font-display text-muted-foreground uppercase tracking-widest">Individual Analysis</h2>
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-brand uppercase tracking-wider text-amber-700 dark:text-amber-300" title="Experimental — these analytics may be incomplete or inaccurate while we refine them.">Experimental</span>
          <div className="flex-1 h-px bg-brand/10" />
          {individualOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {urlPubkey && individualOpen && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-brand/10 border border-brand/20">
            <UserCircle className="w-3.5 h-3.5 text-brand shrink-0" />
            <span className="text-xs text-brand">Analyzing:</span>
            <ProfileLink pubkey={urlPubkey} className="text-xs text-foreground" fallbackClassName="text-xs font-mono text-foreground" />
          </div>
        )}
        {individualOpen && (
          <div className="space-y-4">
            <Collapsible open={adoptionOpen} onOpenChange={setAdoptionOpen}>
              <Card id="adoption-funnel" className="glass-card overflow-hidden scroll-mt-20" data-testid="adoption-funnel-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-adoption">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Target className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">User Adoption Funnel</h2>
                    </div>
                    {adoptionOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <UserAdoptionFunnel pubkey={urlPubkey || undefined} relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={heatmapOpen} onOpenChange={setHeatmapOpen}>
              <Card className="glass-card overflow-hidden" data-testid="heatmap-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-heatmap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Calendar className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Activity Heatmap</h2>
                    </div>
                    {heatmapOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <ActivityHeatmap pubkey={urlPubkey || undefined} relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={velocityOpen} onOpenChange={setVelocityOpen}>
              <Card className="glass-card overflow-hidden" data-testid="velocity-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-velocity">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Activity className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Engagement Velocity</h2>
                    </div>
                    {velocityOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <EngagementVelocity pubkey={urlPubkey || undefined} relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={discoveryScannerOpen} onOpenChange={setDiscoveryScannerOpen}>
              <Card className="glass-card overflow-hidden" data-testid="discovery-scanner-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-discovery">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Users className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">User Discovery Scanner</h2>
                    </div>
                    {discoveryScannerOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <UserDiscoveryScanner relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        )}
      </div>
      <div className="space-y-3" data-testid="section-cohort">
        <button
          onClick={() => setCohortGroupOpen(!cohortGroupOpen)}
          className="flex items-center gap-2 w-full text-left group"
          data-testid="button-toggle-cohort-section"
        >
          <Users className="w-4 h-4 text-brand" />
          <h2 className="text-xs font-display text-muted-foreground uppercase tracking-widest">Cohort Analysis</h2>
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-brand uppercase tracking-wider text-amber-700 dark:text-amber-300" title="Experimental — these analytics may be incomplete or inaccurate while we refine them.">Experimental</span>
          <div className="flex-1 h-px bg-brand/10" />
          {cohortGroupOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {cohortGroupOpen && (
          <div className="space-y-4">
            <Collapsible open={cohortOpen} onOpenChange={setCohortOpen}>
              <Card className="glass-card overflow-hidden" data-testid="cohort-section">
                <CollapsibleTrigger asChild>
                  <button
                    className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left"
                    data-testid="button-toggle-cohort"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Users className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Retention Cohorts</h2>
                    </div>
                    {cohortOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 border-t border-brand/10 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    Cohort Time Range
                  </Label>
                  <Select value={String(cohortTimeRange)} onValueChange={(v) => setCohortTimeRange(Number(v))}>
                    <SelectTrigger className="text-sm sm:text-xs" style={{ fontSize: "16px" }} data-testid="select-cohort-range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="604800">Last 7 days</SelectItem>
                      <SelectItem value="2592000">Last 30 days</SelectItem>
                      <SelectItem value="7776000">Last 90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    Tracking Window
                  </Label>
                  <Select value={String(cohortWindow)} onValueChange={(v) => setCohortWindow(Number(v))}>
                    <SelectTrigger className="text-sm sm:text-xs" style={{ fontSize: "16px" }} data-testid="select-cohort-window">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="60">60 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    Metric
                  </Label>
                  <Select value={cohortMetric} onValueChange={setCohortMetric}>
                    <SelectTrigger className="text-sm sm:text-xs" style={{ fontSize: "16px" }} data-testid="select-cohort-metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any Activity</SelectItem>
                      <SelectItem value="posts">Posts Created</SelectItem>
                      <SelectItem value="replies">Replies Made</SelectItem>
                      <SelectItem value="zaps">Zaps Sent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={runCohortAnalysis}
                disabled={cohortLoading || selectedRelays.length === 0}
                className="gap-2"
                data-testid="button-run-cohort"
              >
                {cohortLoading ? (
                  <>
                    <RelayOutpostInlineLoader className="w-4 h-4" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run Cohort Analysis
                  </>
                )}
              </Button>

              {cohortData.length > 0 && (
                <div className="space-y-4">
                  <div data-testid="cohort-chart" className="w-full h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={cohortWindows.map((w, wi) => {
                          const point: Record<string, any> = { name: w };
                          cohortData.forEach((c) => {
                            point[c.label] = c.windows[wi] || 0;
                          });
                          return point;
                        })}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,100,220,0.1)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} />
                        <YAxis tick={{ fontSize: 10, fill: "currentColor", className: "text-muted-foreground/50" }} unit="%" />
                        <Tooltip content={<CustomTooltipContent />} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {cohortData.map((c, i) => (
                          <Line
                            key={c.label}
                            type="monotone"
                            dataKey={c.label}
                            stroke={CHART_COLORS[i % CHART_COLORS.length]}
                            strokeWidth={2}
                            dot={{ r: 2 }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="overflow-x-auto" data-testid="cohort-table">
                    <table className="w-full">
                      <thead className="border-b border-brand/20">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                            Cohort
                          </th>
                          {cohortWindows.map((w) => (
                            <th key={w} className="px-3 py-2 text-left text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                              {w}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cohortData.map((row, i) => (
                          <tr key={row.label} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`cohort-row-${i}`}>
                            <td className="px-3 py-2 text-xs font-mono text-brand">{row.label}</td>
                            {row.windows.map((val, wi) => (
                              <td key={wi} className="px-3 py-2 text-xs font-mono">
                                {val}%
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!cohortLoading && cohortData.length === 0 && (
                <div className="text-center py-8 text-muted-foreground/50 text-sm" data-testid="cohort-empty">
                  Run cohort analysis to see retention data
                </div>
              )}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={batchFunnelOpen} onOpenChange={setBatchFunnelOpen}>
              <Card className="glass-card overflow-hidden" data-testid="batch-funnel-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-batch-funnel">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TrendingUp className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Batch Funnel Analysis</h2>
                    </div>
                    {batchFunnelOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <BatchFunnelAnalysis relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={segmentationOpen} onOpenChange={setSegmentationOpen}>
              <Card className="glass-card overflow-hidden" data-testid="segmentation-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-segmentation">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Layers className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">User Segmentation</h2>
                    </div>
                    {segmentationOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <UserSegmentation relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={churnOpen} onOpenChange={setChurnOpen}>
              <Card className="glass-card overflow-hidden" data-testid="churn-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-churn">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Radio className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Churn & Resurrection</h2>
                    </div>
                    {churnOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <ChurnResurrection relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        )}
      </div>
      <div className="space-y-3" data-testid="section-global">
        <button
          onClick={() => setGlobalOpen(!globalOpen)}
          className="flex items-center gap-2 w-full text-left group"
          data-testid="button-toggle-global-section"
        >
          <Globe className="w-4 h-4 text-brand" />
          <h2 className="text-xs font-display text-muted-foreground uppercase tracking-widest">Global / Network</h2>
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-brand uppercase tracking-wider text-amber-700 dark:text-amber-300" title="Experimental — these analytics may be incomplete or inaccurate while we refine them.">Experimental</span>
          <div className="flex-1 h-px bg-brand/10" />
          {globalOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {globalOpen && (
          <div className="space-y-4">
            <Collapsible open={networkGrowthOpen} onOpenChange={setNetworkGrowthOpen}>
              <Card className="glass-card overflow-hidden" data-testid="network-growth-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-network-growth">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Users className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Network Growth Timeline</h2>
                    </div>
                    {networkGrowthOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <NetworkGrowthTimeline relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={hashtagTrendsOpen} onOpenChange={setHashtagTrendsOpen}>
              <Card className="glass-card overflow-hidden" data-testid="hashtag-trends-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-hashtag-trends">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Hash className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Hashtag Trends</h2>
                    </div>
                    {hashtagTrendsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <HashtagTrends relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={zapEconomyOpen} onOpenChange={setZapEconomyOpen}>
              <Card className="glass-card overflow-hidden" data-testid="zap-economy-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-zap-economy">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                      <h2 className="text-sm font-display text-muted-foreground">Zap Economy</h2>
                    </div>
                    {zapEconomyOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <ZapEconomy relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={contentFormatOpen} onOpenChange={setContentFormatOpen}>
              <Card className="glass-card overflow-hidden" data-testid="content-format-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-content-format">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Layers className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Content Format Evolution</h2>
                    </div>
                    {contentFormatOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <ContentFormatEvolution relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={clientDiversityOpen} onOpenChange={setClientDiversityOpen}>
              <Card className="glass-card overflow-hidden" data-testid="client-diversity-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-client-diversity">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Globe className="w-4 h-4 text-brand" />
                      <h2 className="text-sm font-display text-muted-foreground">Client Diversity</h2>
                    </div>
                    {clientDiversityOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
                    <ClientDiversity relays={selectedRelays} />
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        )}
      </div>
      <Collapsible open={savedReportsOpen} onOpenChange={setSavedReportsOpen}>
        <Card className="glass-card overflow-hidden" data-testid="saved-reports-section">
          <CollapsibleTrigger asChild>
            <button
              className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left"
              data-testid="button-toggle-saved"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Save className="w-4 h-4 text-brand" />
                <h2 className="text-sm font-display text-muted-foreground">Saved Reports</h2>
                {savedReports.length > 0 && (
                  <Badge variant="secondary">{savedReports.length}</Badge>
                )}
              </div>
              {savedReportsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-brand/10 pt-4">
              {savedReports.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground/50 text-sm" data-testid="saved-empty">
                  No saved reports yet. Run a report and save it.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {savedReports.map((report) => (
                    <Card
                      key={report.id}
                      className="border border-brand/10 bg-secondary/20 p-3 space-y-2"
                      data-testid={`saved-report-${report.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {chartTypeIcon(report.chartType)}
                            <span className="text-xs font-display text-brand truncate">{report.title}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                            {formatDistanceToNow(new Date(report.lastRunAt), { addSuffix: true })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => loadReport(report)}
                            data-testid={`button-load-report-${report.id}`}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteReport(report.id)}
                            data-testid={`button-delete-report-${report.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {report.lastData.length > 0 && (
                        <div className="h-16" data-testid={`preview-chart-${report.id}`}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={report.lastData.slice(0, 8).map((d) => ({ name: d.label, value: d.value }))}>
                              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                                {report.lastData.slice(0, 8).map((_, i) => (
                                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
      <Card className="glass-card px-3 sm:px-4 py-2.5 sm:py-3 overflow-hidden opacity-60" data-testid="analytics-disclaimer-bottom">
        <div className="flex gap-2.5 sm:gap-3">
          <div className="shrink-0 mt-0.5">
            <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand/40" />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-foreground/60 tracking-wide font-mono uppercase">Signal Intelligence Disclosure</p>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Analytics show activity from your connected sources. Some data may be incomplete due to server availability or filtering. This is a snapshot, not the full picture.
            </p>
            <p className="text-[10px] leading-relaxed text-muted-foreground/70 italic">
              Your signal, your ownership — what you put out there is yours.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}