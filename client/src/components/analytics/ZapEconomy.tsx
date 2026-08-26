import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { DEFAULT_RELAYS, throttledPoolSubscribe, eventStore } from "@/lib/nostr";
import { getProfileContent, getAvatarUrl } from "@/lib/nostr-helpers";
import { ProfileLink } from "./ProfileLink";
import { formatSats } from "@/lib/zap";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend } from "recharts";
import {
  Zap,
  Play,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  X } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = ["#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd"];

const TIME_RANGES = [
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 7 * 86400 },
  { label: "30d", seconds: 30 * 86400 },
];

const ZAP_BUCKETS = [
  { label: "<100", min: 0, max: 100 },
  { label: "100-500", min: 100, max: 500 },
  { label: "500-1k", min: 500, max: 1000 },
  { label: "1k-5k", min: 1000, max: 5000 },
  { label: "5k-10k", min: 5000, max: 10000 },
  { label: "10k-50k", min: 10000, max: 50000 },
  { label: "50k+", min: 50000, max: Infinity },
];

function extractZapAmount(event: Event): number {
  const bolt11Tag = event.tags.find((t) => t[0] === "bolt11");
  if (!bolt11Tag?.[1]) {
    const descTag = event.tags.find((t) => t[0] === "description");
    if (descTag?.[1]) {
      try {
        const desc = JSON.parse(descTag[1]);
        const amountTag = desc.tags?.find((t: string[]) => t[0] === "amount");
        if (amountTag) return Math.round(parseInt(amountTag[1], 10) / 1000);
      } catch {}
    }
    return 0;
  }
  try {
    const bolt11 = bolt11Tag[1].toLowerCase();
    const match = bolt11.match(/ln(?:bc|tb|ts)(\d+)([munp]?)/);
    if (!match) return 0;
    const amount = parseInt(match[1]);
    const multiplier = match[2];
    if (multiplier === "m") return amount * 100000;
    if (multiplier === "u") return amount * 100;
    if (multiplier === "n") return Math.round(amount * 0.1);
    if (multiplier === "p") return Math.round(amount * 0.0001);
    return amount * 100000000;
  } catch {
    return 0;
  }
}

function shortenNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return npub.slice(0, 12) + "..." + npub.slice(-6);
  } catch {
    return pubkey.slice(0, 8) + "..." + pubkey.slice(-6);
  }
}

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-foreground">
          {entry.name}: <span className="text-brand font-mono">{Number(entry.value).toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

function RecipientAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(0, pubkey), [pubkey]);
  const { avatarUrl, initial } = useMemo(() => {
    if (!profile) return { avatarUrl: "", initial: "?" };
    const content = getProfileContent(profile);
    const name = content?.display_name || content?.name || "";
    return {
      avatarUrl: getAvatarUrl(profile) || "",
      initial: name ? name.slice(0, 1).toUpperCase() : "?" };
  }, [profile]);

  return (
    <Avatar className="w-5 h-5 shrink-0">
      <AvatarImage src={avatarUrl} />
      <AvatarFallback className="bg-brand/20 text-[8px]">{initial}</AvatarFallback>
    </Avatar>
  );
}

export function ZapEconomy({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [timeRange, setTimeRange] = useState("7d");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [drilldown, setDrilldown] = useState<"zappers" | "recipients" | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setEvents([]);
    setHasRun(true);

    const rangeConfig = TIME_RANGES.find((r) => r.label === timeRange) || TIME_RANGES[1];
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const sinceTimestamp = nowTimestamp - rangeConfig.seconds;

    const collected: Event[] = [];

    const sub = throttledPoolSubscribe(
      relaysToUse,
      { kinds: [9735], since: sinceTimestamp, until: nowTimestamp, limit: 10000 },
      {
        onevent(event: Event) {
          collected.push(event);
        },
        oneose() {
          sub.close();
          setEvents(collected);
          setLoading(false);
        } }
    );
  }, [timeRange, relaysToUse]);

  const zapAmounts = useMemo(() => {
    return events.map((e) => ({ event: e, amount: extractZapAmount(e) })).filter((z) => z.amount > 0);
  }, [events]);

  const summary = useMemo(() => {
    if (zapAmounts.length === 0) return null;

    const amounts = zapAmounts.map((z) => z.amount);
    const totalVolume = amounts.reduce((s, a) => s + a, 0);
    const sorted = [...amounts].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : sorted[Math.floor(sorted.length / 2)];
    const average = Math.round(totalVolume / amounts.length);

    const uniqueZappers = new Set(zapAmounts.map((z) => z.event.pubkey));
    const uniqueRecipients = new Set<string>();
    for (const z of zapAmounts) {
      const recipient = z.event.tags.find((t) => t[0] === "p")?.[1];
      if (recipient) uniqueRecipients.add(recipient);
    }

    return {
      totalVolume,
      totalZaps: zapAmounts.length,
      median,
      average,
      uniqueZappers: uniqueZappers.size,
      uniqueRecipients: uniqueRecipients.size };
  }, [zapAmounts]);

  const distributionData = useMemo(() => {
    if (zapAmounts.length === 0) return [];
    return ZAP_BUCKETS.map((bucket) => ({
      range: bucket.label,
      count: zapAmounts.filter((z) => z.amount >= bucket.min && z.amount < bucket.max).length }));
  }, [zapAmounts]);

  const dailyVolumeData = useMemo(() => {
    if (zapAmounts.length === 0) return [];
    const buckets = new Map<string, number>();
    for (const z of zapAmounts) {
      const day = format(new Date(z.event.created_at * 1000), "yyyy-MM-dd");
      buckets.set(day, (buckets.get(day) || 0) + z.amount);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, sats]) => ({
        date: format(new Date(date), "MMM dd"),
        sats }));
  }, [zapAmounts]);

  const topRecipients = useMemo(() => {
    if (zapAmounts.length === 0) return [];
    const recipientMap = new Map<string, { sats: number; count: number }>();
    for (const z of zapAmounts) {
      const recipient = z.event.tags.find((t) => t[0] === "p")?.[1];
      if (!recipient) continue;
      const existing = recipientMap.get(recipient);
      if (existing) {
        existing.sats += z.amount;
        existing.count++;
      } else {
        recipientMap.set(recipient, { sats: z.amount, count: 1 });
      }
    }
    return Array.from(recipientMap.entries())
      .sort((a, b) => b[1].sats - a[1].sats)
      .slice(0, 10)
      .map(([pubkey, data]) => ({
        pubkey,
        name: shortenNpub(pubkey),
        sats: data.sats,
        count: data.count }));
  }, [zapAmounts]);

  const allZappers = useMemo(() => {
    if (zapAmounts.length === 0) return [];
    const zapperMap = new Map<string, { sats: number; count: number }>();
    for (const z of zapAmounts) {
      const existing = zapperMap.get(z.event.pubkey);
      if (existing) {
        existing.sats += z.amount;
        existing.count++;
      } else {
        zapperMap.set(z.event.pubkey, { sats: z.amount, count: 1 });
      }
    }
    return Array.from(zapperMap.entries())
      .sort((a, b) => b[1].sats - a[1].sats)
      .map(([pubkey, data]) => ({ pubkey, sats: data.sats, count: data.count }));
  }, [zapAmounts]);

  const allRecipients = useMemo(() => {
    if (zapAmounts.length === 0) return [];
    const recipientMap = new Map<string, { sats: number; count: number }>();
    for (const z of zapAmounts) {
      const recipient = z.event.tags.find((t) => t[0] === "p")?.[1];
      if (!recipient) continue;
      const existing = recipientMap.get(recipient);
      if (existing) {
        existing.sats += z.amount;
        existing.count++;
      } else {
        recipientMap.set(recipient, { sats: z.amount, count: 1 });
      }
    }
    return Array.from(recipientMap.entries())
      .sort((a, b) => b[1].sats - a[1].sats)
      .map(([pubkey, data]) => ({ pubkey, sats: data.sats, count: data.count }));
  }, [zapAmounts]);

  const velocity = useMemo(() => {
    if (zapAmounts.length < 4) return null;
    const sorted = [...zapAmounts].sort((a, b) => a.event.created_at - b.event.created_at);
    const half = Math.floor(sorted.length / 2);
    const firstHalfTotal = sorted.slice(0, half).reduce((s, z) => s + z.amount, 0);
    const secondHalfTotal = sorted.slice(half).reduce((s, z) => s + z.amount, 0);
    const firstHalfCount = half;
    const secondHalfCount = sorted.length - half;

    const diff = secondHalfTotal - firstHalfTotal;
    const pctChange = firstHalfTotal > 0 ? Math.round((diff / firstHalfTotal) * 100) : 0;

    let trend: "up" | "down" | "flat" = "flat";
    if (pctChange > 10) trend = "up";
    else if (pctChange < -10) trend = "down";

    return {
      firstHalfTotal,
      secondHalfTotal,
      firstHalfCount,
      secondHalfCount,
      pctChange,
      trend };
  }, [zapAmounts]);

  const TrendIcon = velocity?.trend === "up" ? TrendingUp : velocity?.trend === "down" ? TrendingDown : Minus;
  const trendColor = velocity?.trend === "up" ? "text-emerald-800 dark:text-emerald-400" : velocity?.trend === "down" ? "text-red-700 dark:text-red-400" : "text-muted-foreground";
  const trendLabel = velocity?.trend === "up" ? "Accelerating" : velocity?.trend === "down" ? "Decelerating" : "Steady";

  return (
    <div className="overflow-visible" data-testid="zap-economy">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap className="w-4 h-4 text-amber-800 dark:text-amber-400" />
          <h2 className="text-sm font-display text-brand">Zap Economy</h2>
          <Badge variant="secondary" data-testid="badge-zap-count">
            {events.length.toLocaleString()} zaps
          </Badge>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
              Time Range
            </Label>
            <Select value={timeRange} onValueChange={setTimeRange} data-testid="select-time-range">
              <SelectTrigger className="w-[100px]" style={{ fontSize: "16px" }} data-testid="select-time-range-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGES.map((r) => (
                  <SelectItem key={r.label} value={r.label} data-testid={`select-time-range-${r.label}`}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={fetchData}
            disabled={loading}
            data-testid="button-run-zap-economy"
          >
            {loading ? (
              <RelayOutpostInlineLoader className="w-4 h-4 mr-1.5" />
            ) : (
              <Play className="w-4 h-4 mr-1.5" />
            )}
            {loading ? "Fetching..." : "Run"}
          </Button>
        </div>

        {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3" data-testid="summary-cards">
            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Total Volume</p>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                <p className="text-lg font-mono text-amber-800 dark:text-amber-400" data-testid="text-total-volume">
                  {formatSats(summary.totalVolume)} sats
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Total Zaps</p>
              <div className="flex items-center gap-1.5">
                <ArrowUpRight className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-foreground" data-testid="text-total-zaps">
                  {summary.totalZaps.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Median Zap</p>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-brand" data-testid="text-median-zap">
                  {formatSats(summary.median)} sats
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Average Zap</p>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-brand" data-testid="text-average-zap">
                  {formatSats(summary.average)} sats
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setDrilldown(drilldown === "zappers" ? null : "zappers")}
              className={`space-y-1 p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                drilldown === "zappers"
                  ? "bg-brand/10 border-brand/30"
                  : "bg-brand/5 border-brand/10 hover:border-brand/25"
              }`}
              data-testid="card-unique-zappers"
            >
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Unique Zappers</p>
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-foreground flex-1" data-testid="text-unique-zappers">
                  {summary.uniqueZappers.toLocaleString()}
                </p>
                {drilldown === "zappers" ? (
                  <ChevronUp className="w-3.5 h-3.5 text-brand" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                )}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDrilldown(drilldown === "recipients" ? null : "recipients")}
              className={`space-y-1 p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                drilldown === "recipients"
                  ? "bg-brand/10 border-brand/30"
                  : "bg-brand/5 border-brand/10 hover:border-brand/25"
              }`}
              data-testid="card-unique-recipients"
            >
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Unique Recipients</p>
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-foreground flex-1" data-testid="text-unique-recipients">
                  {summary.uniqueRecipients.toLocaleString()}
                </p>
                {drilldown === "recipients" ? (
                  <ChevronUp className="w-3.5 h-3.5 text-brand" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                )}
              </div>
            </button>
          </div>
        )}

        {drilldown && (
          <div className="p-3 rounded-lg bg-brand/5 border border-brand/10" data-testid={`drilldown-${drilldown}`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                {drilldown === "zappers" ? "All Zappers" : "All Recipients"} — sorted by total sats
              </p>
              <button
                type="button"
                onClick={() => setDrilldown(null)}
                className="text-muted-foreground/40 hover:text-foreground transition-colors"
                data-testid="button-close-drilldown"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
              {(drilldown === "zappers" ? allZappers : allRecipients).map((entry, i) => (
                <div key={entry.pubkey} className="flex items-center gap-2 text-xs py-1" data-testid={`drilldown-row-${i}`}>
                  <span className="text-muted-foreground/40 w-5 text-right font-mono text-[10px]">{i + 1}</span>
                  <RecipientAvatar pubkey={entry.pubkey} />
                  <ProfileLink
                    pubkey={entry.pubkey}
                    className="text-foreground flex-1 truncate text-xs"
                    fallbackClassName="text-brand font-mono flex-1 truncate text-xs"
                    showAvatar={false}
                  />
                  <span className="font-mono text-amber-800 dark:text-amber-400 whitespace-nowrap" data-testid={`drilldown-sats-${i}`}>
                    {formatSats(entry.sats)}
                  </span>
                  <span className="text-muted-foreground/40 text-[10px]">sats</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5" data-testid={`drilldown-count-${i}`}>
                    {entry.count} {entry.count === 1 ? "zap" : "zaps"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {velocity && (
          <div className="p-3 rounded-lg bg-brand/5 border border-brand/10" data-testid="zap-velocity">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">Zap Velocity</p>
            <div className="flex items-center gap-2">
              <TrendIcon className={`w-4 h-4 ${trendColor}`} />
              <span className={`text-sm font-mono ${trendColor}`} data-testid="text-velocity-trend">{trendLabel}</span>
              <span className="text-xs text-muted-foreground/50">
                ({velocity.pctChange > 0 ? "+" : ""}{velocity.pctChange}% volume change)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="space-y-0.5">
                <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">First Half</p>
                <p className="text-xs font-mono text-foreground" data-testid="text-velocity-first-half">
                  {formatSats(velocity.firstHalfTotal)} sats ({velocity.firstHalfCount} zaps)
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">Second Half</p>
                <p className="text-xs font-mono text-foreground" data-testid="text-velocity-second-half">
                  {formatSats(velocity.secondHalfTotal)} sats ({velocity.secondHalfCount} zaps)
                </p>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-indicator">
            <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            <span className="text-sm text-muted-foreground">Querying relays for zap events...</span>
          </div>
        )}

        {!loading && hasRun && zapAmounts.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground" data-testid="empty-state">
            No zap events found in this time range.
          </div>
        )}

        {!loading && distributionData.length > 0 && (
          <div data-testid="zap-distribution-chart">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
              Zap Distribution
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={distributionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.08)" />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip content={<CustomTooltipContent />} />
                <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }} />
                <Bar
                  dataKey="count"
                  name="Zaps"
                  fill={CHART_COLORS[0]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {!loading && dailyVolumeData.length > 1 && (
          <div data-testid="zap-flow-chart">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
              Daily Zap Volume (sats)
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={dailyVolumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.08)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip content={<CustomTooltipContent />} />
                <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }} />
                <Line
                  type="monotone"
                  dataKey="sats"
                  name="Volume (sats)"
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {!loading && topRecipients.length > 0 && (
          <div data-testid="top-recipients">
            <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
              Top Recipients
            </p>
            <div className="space-y-1.5">
              {topRecipients.map((r, i) => (
                <div key={r.pubkey} className="flex items-center gap-2 text-xs" data-testid={`recipient-row-${i}`}>
                  <span className="text-muted-foreground/40 w-4 text-right font-mono">{i + 1}</span>
                  <RecipientAvatar pubkey={r.pubkey} />
                  <ProfileLink pubkey={r.pubkey} className="text-foreground flex-1 truncate text-xs" fallbackClassName="text-brand font-mono flex-1 truncate text-xs" showAvatar={false} />
                  <span className="font-mono text-amber-800 dark:text-amber-400" data-testid={`recipient-sats-${i}`}>
                    {formatSats(r.sats)}
                  </span>
                  <span className="text-muted-foreground/40">sats</span>
                  <Badge variant="secondary" data-testid={`recipient-count-${i}`}>
                    {r.count}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasRun && !loading && (
          <div className="text-center py-12 space-y-2" data-testid="initial-state">
            <Zap className="w-8 h-8 text-brand/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Select a time range and click <span className="text-brand">Run</span> to analyze the zap economy.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
