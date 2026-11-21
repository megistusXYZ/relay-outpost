import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { DEFAULT_RELAYS, eventStore, sortByLatency, throttledPoolSubscribe } from "@/lib/nostr";
import { fetchRelayLists, getRelayList } from "@/lib/outbox";
import { fetchUserProfileStats, type UserProfileStats } from "@/lib/primal-cache";
import { getProfileContent } from "@/lib/nostr-helpers";
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
  UserCircle,
  Target,
  Globe,
  ExternalLink,
  Repeat2,
  Heart,
  ShieldCheck,
} from "lucide-react";
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
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTier, getSignalTierLabel, getActiveThresholds, type SignalTier } from "@/lib/graperank";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

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
  1: "Post",
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

// Series on the theme's cool blues and greys; Ember leads (design canvas, 2026-11-16).
const CHART_COLORS = [
  "#3D6BFF", "#7C9BFF", "#A3ACBA", "#565D69", "#C8D4F0",
  "#2A3A6A", "#FF6A3D", "#E6E8EC", "#8EA4C8", "#1F2430",
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
      { label: "Posts & replies", kind: ENGAGEMENT_KINDS.REPLY },
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


const TIME_PRESETS = [
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 21600 },
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 604800 },
  { label: "30d", seconds: 2592000 },
];

const GROUPING_OPTIONS = [
  { value: "kind" as const, label: "By event kind", icon: Layers },
  { value: "author" as const, label: "By author", icon: Users },
  { value: "hour" as const, label: "By hour", icon: Clock },
  { value: "day" as const, label: "By day", icon: Calendar },
  { value: "hashtag" as const, label: "By hashtag", icon: Hash },
  { value: "contentType" as const, label: "By content type", icon: Activity },
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
      contentType = hasETag ? "Reply" : "Post";
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
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-foreground mb-1">{label || payload[0]?.name}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-foreground">
          {entry.name || "Count"}: <span className="font-semibold tabular-nums">{Number(entry.value).toLocaleString()}</span>
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
          <h2 className="text-[15px] font-semibold text-foreground">Zap revenue</h2>
          <Badge variant="secondary" data-testid="badge-zap-count">
            {zapData.zapCount.toLocaleString()} zaps
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1 p-3 rounded-lg bg-foreground/[0.03] border border-border/60">
            <p className="text-[13px] text-muted-foreground font-medium">Total sats</p>
            <p className="text-lg font-semibold tabular-nums text-warning" data-testid="text-total-sats">
              {formatSats(zapData.totalSats)}
            </p>
          </div>
          <div className="space-y-1 p-3 rounded-lg bg-foreground/[0.03] border border-border/60">
            <p className="text-[13px] text-muted-foreground font-medium">Avg per Zap</p>
            <p className="text-lg font-semibold tabular-nums text-foreground" data-testid="text-avg-zap">
              {formatSats(zapData.avgZap)}
            </p>
          </div>
          <div className="space-y-1 p-3 rounded-lg bg-foreground/[0.03] border border-border/60 col-span-2 sm:col-span-1">
            <p className="text-[13px] text-muted-foreground font-medium">Zap count</p>
            <p className="text-lg font-semibold tabular-nums text-foreground" data-testid="text-zap-total-count">
              {zapData.zapCount.toLocaleString()}
            </p>
          </div>
        </div>

        {zapData.trend.length > 1 && (
          <div data-testid="zap-trend-chart">
            <p className="text-[13px] text-muted-foreground mb-2 font-medium">Daily trend</p>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={zapData.trend}>
                <defs>
                  <linearGradient id="zapGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltipContent />} />
                <Area type="monotone" dataKey="value" stroke="#f59e0b" fill="url(#zapGradient)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {zapData.topZappers.length > 0 && (
          <div data-testid="top-zappers">
            <p className="text-[13px] text-muted-foreground mb-2 font-medium">Top zappers</p>
            <div className="space-y-1.5">
              {zapData.topZappers.map((zapper, i) => (
                <div key={zapper.pubkey} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-4 text-right font-mono">{i + 1}</span>
                  <ProfileLink pubkey={zapper.pubkey} className="text-foreground flex-1" />
                  <span className="font-mono text-warning">{formatSats(zapper.sats)}</span>
                  <span className="text-muted-foreground">sats</span>
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
      <DialogContent className="glass-dialog-card border-border max-w-md max-h-[85vh] overflow-y-auto" data-testid="contact-detail-panel">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">Contact</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Avatar className="w-14 h-14 border border-border/60">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback className="bg-foreground/[0.08] text-foreground/80 text-sm">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 space-y-0.5">
              <ProfileLink pubkey={lookupPubkey} displayName={displayName !== shortenNpub(lookupPubkey) ? displayName : undefined} className="text-sm font-medium text-foreground" data-testid="contact-name" />
              {nip05 && <p className="text-xs text-muted-foreground truncate" data-testid="contact-nip05">{nip05}</p>}
              <p className="text-[12px] text-muted-foreground font-mono truncate">{npub.slice(0, 20)}...</p>
            </div>
          </div>

          {about && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3" data-testid="contact-about">
              {about}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-foreground/[0.03] border border-border/60 space-y-0.5">
              <p className="text-[12px] text-muted-foreground font-medium">Followers</p>
              <p className="text-sm font-semibold tabular-nums text-foreground" data-testid="contact-followers">
                {loadingStats ? "..." : primalStats ? primalStats.followersCount.toLocaleString() : "-"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-foreground/[0.03] border border-border/60 space-y-0.5">
              <p className="text-[12px] text-muted-foreground font-medium">Following</p>
              <p className="text-sm font-semibold tabular-nums text-foreground" data-testid="contact-following">
                {loadingStats ? "..." : primalStats ? primalStats.followingCount.toLocaleString() : "-"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-foreground/[0.03] border border-border/60 space-y-0.5">
              <p className="text-[12px] text-muted-foreground font-medium">Posts</p>
              <p className="text-sm font-semibold tabular-nums text-foreground" data-testid="contact-notes">
                {loadingStats ? "..." : primalStats ? primalStats.noteCount.toLocaleString() : "-"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-foreground/[0.03] border border-border/60 space-y-0.5">
              <p className="text-[12px] text-muted-foreground font-medium">Replies</p>
              <p className="text-sm font-semibold tabular-nums text-foreground" data-testid="contact-replies">
                {loadingStats ? "..." : primalStats ? primalStats.replyCount.toLocaleString() : "-"}
              </p>
            </div>
          </div>

          {interactionSummary && (
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground font-medium">Activity in report</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-foreground/[0.03] border border-border/60">
                  <p className="text-[12px] text-muted-foreground font-medium">Events</p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{interactionSummary.totalEvents.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-lg bg-foreground/[0.03] border border-border/60">
                  <p className="text-[12px] text-muted-foreground font-medium">Mentions</p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{interactionSummary.mentionCount.toLocaleString()}</p>
                </div>
              </div>
              {interactionSummary.kindBreakdown.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[12px] text-muted-foreground font-medium">Event types</p>
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
                <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="truncate text-brand">
                  {website}
                </a>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-border/60">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                if (npub) window.location.href = `/profile/${npub}`;
              }}
              data-testid="button-view-profile"
            >
              <UserCircle className="w-4 h-4" />
              View full profile
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
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm" data-testid="chart-empty">
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
              fontSize={12}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltipContent />} />
            <Legend
              wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-body)" }}
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
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} />
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
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} />
            <Tooltip content={<CustomTooltipContent />} />
            <Line type="monotone" dataKey="value" stroke="#FF6A3D" strokeWidth={2} dot={{ fill: "#FF8A61", r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div data-testid="chart-area" className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} angle={-35} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} />
          <Tooltip content={<CustomTooltipContent />} />
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#FF6A3D" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#FF6A3D" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke="#FF6A3D" fill="url(#areaGrad)" strokeWidth={2} />
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
      className="px-3 py-2 text-left text-[13px] text-muted-foreground cursor-pointer select-none font-medium"
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
            <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{String(row.metadata?.kind ?? "")}</td>
            <td className="px-3 py-2 text-xs">{row.label}</td>
            <td className="px-3 py-2 text-xs tabular-nums">{row.value.toLocaleString()}</td>
            <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{row.metadata?.percent as string}%</td>
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
              <td className="px-3 py-2 text-xs tabular-nums">{row.value.toLocaleString()}</td>
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
            <td className="px-3 py-2 text-xs text-foreground">{row.label}</td>
            <td className="px-3 py-2 text-xs tabular-nums">{row.value.toLocaleString()}</td>
            <td className="px-3 py-2 text-xs">{row.metadata?.topKind as string}</td>
          </tr>
        ));
      case "hashtag":
        return sorted.map((row, i) => (
          <tr key={i} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`table-row-${i}`}>
            <td className="px-3 py-2 text-xs text-foreground">{row.label}</td>
            <td className="px-3 py-2 text-xs tabular-nums">{row.value.toLocaleString()}</td>
            <td className="px-3 py-2 text-xs">{row.metadata?.topKind as string}</td>
          </tr>
        ));
      case "contentType":
        return sorted.map((row, i) => (
          <tr key={i} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`table-row-${i}`}>
            <td className="px-3 py-2 text-xs text-foreground">{row.label}</td>
            <td className="px-3 py-2 text-xs tabular-nums">{row.value.toLocaleString()}</td>
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
            <SortHeader col="percent">% of total</SortHeader>
          </tr>
        );
      case "author":
        return (
          <tr>
            <SortHeader col="label">Author</SortHeader>
            <SortHeader col="value">Event count</SortHeader>
            <SortHeader col="kinds">Kinds used</SortHeader>
            <SortHeader col="lastActive">Last active</SortHeader>
          </tr>
        );
      case "hour":
      case "day":
        return (
          <tr>
            <SortHeader col="label">Time period</SortHeader>
            <SortHeader col="value">Event count</SortHeader>
            <SortHeader col="topKind">Top kind</SortHeader>
          </tr>
        );
      case "hashtag":
        return (
          <tr>
            <SortHeader col="label">Hashtag</SortHeader>
            <SortHeader col="value">Mention count</SortHeader>
            <SortHeader col="topKind">Top kind</SortHeader>
          </tr>
        );
      case "contentType":
        return (
          <tr>
            <SortHeader col="label">Type</SortHeader>
            <SortHeader col="value">Count</SortHeader>
            <SortHeader col="avg">Avg engagement</SortHeader>
          </tr>
        );
    }
  };

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
          <thead className="border-b border-border/60">{renderHeaders()}</thead>
          <tbody>{renderPaginatedRows()}</tbody>
        </table>
      </div>
      <div className="px-3 py-2 flex items-center justify-between flex-wrap gap-2 border-t border-border/60">
        <span className="text-[13px] text-muted-foreground font-medium">
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
        try { innerText = `Reposted ${nip19.noteEncode(eTag[1]).slice(0, 16)}…`; } catch { innerText = "Reposted a post"; }
      } else innerText = "Repost";
    }
    const truncated = innerText.length > 200 ? innerText.slice(0, 200) + "..." : innerText;
    return { text: truncated, icon: "repost" };
  }

  if (event.kind === 7) {
    const emoji = event.content || "❤️";
    const eTag = event.tags.find(t => t[0] === "e" && t[1]);
    const text = eTag ? `Reacted ${emoji} to a post` : `Reaction: ${emoji}`;
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
      <div className="border-t border-border/60 pt-3">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 w-full text-left" data-testid="toggle-event-feed">
            <Radio className="w-3.5 h-3.5 text-foreground/70" />
            <span className="text-[13px] text-muted-foreground font-medium">
              Event feed
            </span>
            <Badge variant="secondary" className="text-[12px]">{events.length.toLocaleString()}</Badge>
            {feedOpen && (
              <span className="text-[12px] text-muted-foreground">
                Newest first · {Math.min(visibleCount, filteredEvents.length)} of {filteredEvents.length.toLocaleString()}
                {feedTierFilter !== "all" && ` (filtered from ${events.length.toLocaleString()})`}
              </span>
            )}
            <div className="flex-1" />
            {feedOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {globalWotEnabled && wotScores && wotScores.size > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap" data-testid="feed-tier-filter">
              <ShieldCheck className="w-3 h-3 text-muted-foreground" />
              {FEED_TIER_OPTIONS.map((opt) => (
                <button
                  key={opt.tier}
                  onClick={(e) => { e.stopPropagation(); setFeedTierFilter(opt.tier); }}
                  className={`px-2 py-0.5 rounded text-[12px] font-medium transition-colors ${
                    feedTierFilter === opt.tier
                      ? "bg-foreground text-background border border-foreground"
                      : "bg-secondary/50 text-foreground border border-transparent hover:bg-secondary"
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
                      <Badge variant="secondary" className={`text-[12px] px-1.5 py-0 ${
                        event.kind === 6 ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                        event.kind === 7 ? "bg-pink-500/10 text-pink-500 border-pink-500/20" :
                        event.kind === 9735 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : ""
                      }`}>
                        {snippet?.icon === "repost" && <Repeat2 className="w-2.5 h-2.5 mr-0.5 inline" />}
                        {snippet?.icon === "reaction" && <Heart className="w-2.5 h-2.5 mr-0.5 inline" />}
                        {snippet?.icon === "zap" && <Zap className="w-2.5 h-2.5 mr-0.5 inline" />}
                        {kindLabel}
                      </Badge>
                      <span className="text-[12px] text-muted-foreground">
                        {formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })}
                      </span>
                    </div>
                    {threadUrl ? (
                      <Link
                        href={threadUrl}
                        className="block text-[12px] text-muted-foreground leading-relaxed break-words line-clamp-3 transition-colors cursor-pointer"
                      >
                        {snippet?.text || "View event"}
                        <ExternalLink className="w-2.5 h-2.5 ml-1 inline opacity-0 group-hover:opacity-50 transition-opacity" />
                      </Link>
                    ) : snippet?.text ? (
                      <p className="text-[12px] text-muted-foreground leading-relaxed break-words line-clamp-3">
                        {snippet.text}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {filteredEvents.length === 0 && events.length > 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
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

export default function AnalyticsDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  // No title of its own: it only shows inside Account, which names the tab
  // after the open tool. (It set "Console" here, racing Account's.)

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
      <Card className="glass-card overflow-hidden min-w-0" data-testid="report-builder">
        <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-foreground/70 shrink-0" />
            <h2 className="text-[15px] font-semibold text-foreground">Report builder</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[13px] text-muted-foreground font-medium">
                  Data source
                </Label>
                <div className="space-y-2">
                  {ENGAGEMENT_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="text-[12px] text-muted-foreground mb-1 font-medium">{group.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.options.map((opt) => (
                          <button
                            key={opt.kind}
                            onClick={() => toggleEngagementType(opt.kind)}
                            className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                              selectedEngagementTypes.includes(opt.kind)
                                ? "bg-foreground text-background border border-foreground"
                                : "bg-secondary/50 text-foreground border border-transparent hover:bg-secondary"
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
                  <Label className="text-[13px] text-muted-foreground font-medium">
                    Time range
                  </Label>
                  <div className="flex items-center gap-2">
                    <Label className="text-[12px] text-muted-foreground">Custom</Label>
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
                            ? "bg-foreground text-background border border-foreground"
                            : "bg-secondary/50 text-foreground border border-transparent hover:bg-secondary"
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
                      <Label className="text-[12px] text-muted-foreground">Start</Label>
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
                      <Label className="text-[12px] text-muted-foreground">End</Label>
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
                <Label className="text-[13px] text-muted-foreground font-medium">
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
                          <opt.icon className="w-3.5 h-3.5 text-foreground" />
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
                <Label className="text-[13px] text-muted-foreground font-medium">
                  Chart type
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {CHART_TYPES.map((ct) => (
                    <button
                      key={ct.value}
                      onClick={() => setChartType(ct.value)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        chartType === ct.value
                          ? "bg-foreground text-background border border-foreground"
                          : "bg-secondary/50 text-foreground border border-transparent hover:bg-secondary"
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
                  <Label className="text-[13px] text-muted-foreground font-medium">
                    Relays
                  </Label>
                  <Badge variant="secondary">{selectedRelays.length} selected</Badge>
                  {userRelayUrls.size > 0 && (
                    <Badge variant="outline" className="text-[12px] border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
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
                    className="h-7 px-2 text-[12px] shrink-0"
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
                              ? isUserRelay ? "bg-cyan-500/10 text-foreground" : "bg-foreground/[0.06] text-foreground"
                              : "text-muted-foreground"
                          }`}
                          data-testid={`relay-toggle-${relay.replace(/[^a-z0-9]/gi, "-")}`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${selectedRelays.includes(relay) ? isUserRelay ? "bg-cyan-500" : "bg-green-500" : "bg-muted-foreground/30"}`} />
                          <span className="truncate">{relay}</span>
                          {isUserRelay && (
                            <span className="text-[12px] text-cyan-600 dark:text-cyan-400 shrink-0 ml-auto">user</span>
                          )}
                        </button>
                        {isCustom && !isUserRelay && (
                          <button
                            onClick={() => removeCustomRelay(relay)}
                            className="p-1 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors shrink-0"
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
                  <Label className="text-[13px] text-muted-foreground font-medium">
                    Trust filter
                  </Label>
                  <div className="flex items-center gap-2">
                    {!globalWotEnabled && (
                      <span className="text-[12px] text-warning">Trust filter is off in settings</span>
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
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                            wotMinTier === opt.tier
                              ? "bg-foreground text-background border border-foreground"
                              : "bg-secondary/50 text-foreground border border-transparent hover:bg-secondary"
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
                            <p className="text-[12px] text-muted-foreground">
                              {wotFilteredCount.toLocaleString()} events hidden by the trust filter
                            </p>
                          )}
                          <p className="text-[12px] text-muted-foreground">
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
                  <Label className="text-[13px] text-muted-foreground font-medium">
                    Limit
                  </Label>
                  <span className="text-[13px] font-medium tabular-nums text-foreground" data-testid="text-limit-value">
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
                  Run report
                </>
              )}
            </Button>
            {hasResults && (
              <Button variant="outline" onClick={saveReport} className="gap-2" data-testid="button-save-report">
                <Save className="w-4 h-4" />
                Save report
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
                <h2 className="text-[15px] font-semibold text-foreground">Results</h2>
                <Badge variant="secondary" data-testid="badge-event-count">
                  {rawEvents.length.toLocaleString()} events
                </Badge>
                {wotFilterEnabled && wotFilteredCount > 0 && (
                  <Badge variant="outline" className="gap-1 text-success dark:text-emerald-400 border-emerald-400/40 dark:border-emerald-500/30" data-testid="badge-wot-filter">
                    <ShieldCheck className="w-3 h-3" />
                    {getSignalTierLabel(wotMinTier)} and up
                  </Badge>
                )}
              </div>
              <p className="text-[13px] text-muted-foreground font-medium">
                {GROUPING_OPTIONS.find((g) => g.value === groupBy)?.label}
              </p>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3" data-testid="loading-state">
                <RelayOutpostInlineLoader className="w-8 h-8 text-brand" />
                <p className="text-sm text-muted-foreground">
                  Fetching events… <span className="font-semibold tabular-nums text-foreground">{eventCount.toLocaleString()}</span>
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
          <UserCircle className="w-4 h-4 text-foreground" />
          <h2 className="text-[15px] font-semibold text-foreground">Individual analysis</h2>
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[12px] text-muted-foreground font-medium" title="Experimental — these analytics may be incomplete or inaccurate while we refine them.">Experimental</span>
          <div className="flex-1 h-px bg-border/60" />
          {individualOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {urlPubkey && individualOpen && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-foreground/[0.05] border border-border/60">
            <UserCircle className="w-3.5 h-3.5 text-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">Analyzing:</span>
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
                      <Target className="w-4 h-4 text-foreground" />
                      <h2 className="text-[15px] font-semibold text-foreground">User adoption funnel</h2>
                    </div>
                    {adoptionOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Calendar className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Activity heatmap</h2>
                    </div>
                    {heatmapOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Activity className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Engagement velocity</h2>
                    </div>
                    {velocityOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Users className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">User discovery scanner</h2>
                    </div>
                    {discoveryScannerOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
          <Users className="w-4 h-4 text-foreground/70" />
          <h2 className="text-[15px] font-semibold text-foreground">Cohort analysis</h2>
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[12px] text-muted-foreground font-medium" title="Experimental — these analytics may be incomplete or inaccurate while we refine them.">Experimental</span>
          <div className="flex-1 h-px bg-border/60" />
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
                      <Users className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Retention cohorts</h2>
                    </div>
                    {cohortOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 border-t border-border/60 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-[13px] text-muted-foreground font-medium">
                    Cohort time range
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
                  <Label className="text-[13px] text-muted-foreground font-medium">
                    Tracking window
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
                  <Label className="text-[13px] text-muted-foreground font-medium">
                    Metric
                  </Label>
                  <Select value={cohortMetric} onValueChange={setCohortMetric}>
                    <SelectTrigger className="text-sm sm:text-xs" style={{ fontSize: "16px" }} data-testid="select-cohort-metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any activity</SelectItem>
                      <SelectItem value="posts">Posts created</SelectItem>
                      <SelectItem value="replies">Replies made</SelectItem>
                      <SelectItem value="zaps">Zaps sent</SelectItem>
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
                    Run cohort analysis
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
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} />
                        <YAxis tick={{ fontSize: 12, fill: "currentColor", className: "text-muted-foreground" }} unit="%" />
                        <Tooltip content={<CustomTooltipContent />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
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
                      <thead className="border-b border-border/60">
                        <tr>
                          <th className="px-3 py-2 text-left text-[13px] text-muted-foreground font-medium">
                            Cohort
                          </th>
                          {cohortWindows.map((w) => (
                            <th key={w} className="px-3 py-2 text-left text-[13px] text-muted-foreground font-medium">
                              {w}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cohortData.map((row, i) => (
                          <tr key={row.label} className={i % 2 === 0 ? "opacity-100" : "opacity-80"} data-testid={`cohort-row-${i}`}>
                            <td className="px-3 py-2 text-xs text-foreground">{row.label}</td>
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
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="cohort-empty">
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
                      <TrendingUp className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Batch funnel analysis</h2>
                    </div>
                    {batchFunnelOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Layers className="w-4 h-4 text-foreground" />
                      <h2 className="text-[15px] font-semibold text-foreground">User segmentation</h2>
                    </div>
                    {segmentationOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Radio className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Churn & resurrection</h2>
                    </div>
                    {churnOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
          <Globe className="w-4 h-4 text-foreground/70" />
          <h2 className="text-[15px] font-semibold text-foreground">Global network</h2>
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[12px] text-muted-foreground font-medium" title="Experimental — these analytics may be incomplete or inaccurate while we refine them.">Experimental</span>
          <div className="flex-1 h-px bg-border/60" />
          {globalOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {globalOpen && (
          <div className="space-y-4">
            <Collapsible open={networkGrowthOpen} onOpenChange={setNetworkGrowthOpen}>
              <Card className="glass-card overflow-hidden" data-testid="network-growth-section">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-network-growth">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Users className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Network growth timeline</h2>
                    </div>
                    {networkGrowthOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Hash className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Hashtag trends</h2>
                    </div>
                    {hashtagTrendsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <h2 className="text-[15px] font-semibold text-foreground">Zap economy</h2>
                    </div>
                    {zapEconomyOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Layers className="w-4 h-4 text-foreground" />
                      <h2 className="text-[15px] font-semibold text-foreground">Content format evolution</h2>
                    </div>
                    {contentFormatOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                      <Globe className="w-4 h-4 text-foreground/70" />
                      <h2 className="text-[15px] font-semibold text-foreground">Client diversity</h2>
                    </div>
                    {clientDiversityOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
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
                <Save className="w-4 h-4 text-foreground" />
                <h2 className="text-[15px] font-semibold text-foreground">Saved reports</h2>
                {savedReports.length > 0 && (
                  <Badge variant="secondary">{savedReports.length}</Badge>
                )}
              </div>
              {savedReportsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border/60 pt-4">
              {savedReports.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm" data-testid="saved-empty">
                  No saved reports yet. Run a report and save it.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {savedReports.map((report) => (
                    <Card
                      key={report.id}
                      className="border border-border/60 bg-secondary/20 p-3 space-y-2"
                      data-testid={`saved-report-${report.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {chartTypeIcon(report.chartType)}
                            <span className="text-[13px] font-medium text-foreground truncate">{report.title}</span>
                          </div>
                          <p className="text-[12px] text-muted-foreground mt-0.5">
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
      <Card className="rounded-[16px] border border-border/60 bg-card px-3 sm:px-4 py-2.5 sm:py-3 overflow-hidden" data-testid="analytics-disclaimer-bottom">
        <div className="flex gap-2.5 sm:gap-3">
          <div className="shrink-0 mt-0.5">
            <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-foreground">How these trust numbers are made</p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Analytics show activity from your connected sources. Some data may be incomplete due to server availability or filtering. This is a snapshot, not the full picture.
            </p>
            <p className="text-[12px] leading-relaxed text-muted-foreground italic">
              Your data, your ownership — what you put out there is yours.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}