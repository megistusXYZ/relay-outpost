import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend } from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Users,
  Play,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Minus } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = {
  primary: "#8b5cf6",
  cumulative: "#a78bfa" };

const TIME_RANGES = [
  { label: "7d", seconds: 7 * 86400 },
  { label: "30d", seconds: 30 * 86400 },
  { label: "90d", seconds: 90 * 86400 },
];

interface DayData {
  date: string;
  count: number;
  cumulative: number;
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

export function NetworkGrowthTimeline({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [timeRange, setTimeRange] = useState("30d");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [hasRun, setHasRun] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setEvents([]);
    setHasRun(true);

    const rangeConfig = TIME_RANGES.find((r) => r.label === timeRange) || TIME_RANGES[1];
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const sinceTimestamp = nowTimestamp - rangeConfig.seconds;

    const collected: Event[] = [];

    const sub = throttledPoolSubscribe(
      relaysToUse.slice(0, 3),
      {
        kinds: [0],
        since: sinceTimestamp,
        until: nowTimestamp,
        limit: 2000 } as any,
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

  const dailyData: DayData[] = useMemo(() => {
    if (events.length === 0) return [];

    const buckets = new Map<string, number>();
    for (const e of events) {
      const day = format(new Date(e.created_at * 1000), "yyyy-MM-dd");
      buckets.set(day, (buckets.get(day) || 0) + 1);
    }

    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cumulative = 0;
    return sorted.map(([date, count]) => {
      cumulative += count;
      return {
        date: format(new Date(date), "MMM dd"),
        count,
        cumulative };
    });
  }, [events]);

  const summary = useMemo(() => {
    if (dailyData.length === 0) return null;

    const totalAccounts = events.length;
    const avgPerDay = dailyData.length > 0 ? Math.round(totalAccounts / dailyData.length) : 0;

    let peakDay = dailyData[0];
    for (const d of dailyData) {
      if (d.count > peakDay.count) peakDay = d;
    }

    let trend: "up" | "down" | "flat" = "flat";
    if (dailyData.length >= 4) {
      const half = Math.floor(dailyData.length / 2);
      const firstHalfAvg =
        dailyData.slice(0, half).reduce((s, d) => s + d.count, 0) / half;
      const secondHalfAvg =
        dailyData.slice(half).reduce((s, d) => s + d.count, 0) / (dailyData.length - half);
      const diff = secondHalfAvg - firstHalfAvg;
      if (diff > firstHalfAvg * 0.1) trend = "up";
      else if (diff < -firstHalfAvg * 0.1) trend = "down";
    }

    return { totalAccounts, avgPerDay, peakDay, trend };
  }, [dailyData, events]);

  const TrendIcon = summary?.trend === "up" ? TrendingUp : summary?.trend === "down" ? TrendingDown : Minus;
  const trendColor =
    summary?.trend === "up"
      ? "text-emerald-800 dark:text-emerald-400"
      : summary?.trend === "down"
        ? "text-red-700 dark:text-red-400"
        : "text-muted-foreground";
  const trendLabel =
    summary?.trend === "up" ? "Growing" : summary?.trend === "down" ? "Declining" : "Flat";

  return (
    <div className="overflow-visible" data-testid="network-growth-timeline">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Users className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-display text-brand">Network Growth Timeline</h2>
          <Badge variant="secondary" data-testid="badge-event-count">
            {events.length.toLocaleString()} profiles
          </Badge>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
              Time Range
            </Label>
            <Select value={timeRange} onValueChange={setTimeRange} data-testid="select-time-range">
              <SelectTrigger className="w-[100px]" data-testid="select-time-range-trigger">
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
            data-testid="button-run-growth"
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="summary-cards">
            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Total New Accounts</p>
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-brand" data-testid="text-total-accounts">
                  {summary.totalAccounts.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Avg per Day</p>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-foreground" data-testid="text-avg-per-day">
                  {summary.avgPerDay.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Peak Day</p>
              <div className="flex items-center gap-1.5">
                <ArrowUpRight className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                <div>
                  <p className="text-lg font-mono text-amber-800 dark:text-amber-400" data-testid="text-peak-count">
                    {summary.peakDay.count.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50" data-testid="text-peak-date">
                    {summary.peakDay.date}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Growth Trend</p>
              <div className="flex items-center gap-1.5">
                <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />
                <p className={`text-lg font-mono ${trendColor}`} data-testid="text-growth-trend">
                  {trendLabel}
                </p>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-indicator">
            <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            <span className="text-sm text-muted-foreground">Querying relays for profile events...</span>
          </div>
        )}

        {!loading && hasRun && dailyData.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground" data-testid="empty-state">
            No profile events found in this time range.
          </div>
        )}

        {!loading && dailyData.length > 0 && (
          <div className="space-y-4">
            <div data-testid="daily-growth-chart">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                Daily New Profiles
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={dailyData}>
                  <defs>
                    <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                    width={40}
                  />
                  <Tooltip content={<CustomTooltipContent />} />
                  <Legend
                    wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="New Profiles"
                    stroke={CHART_COLORS.primary}
                    fill="url(#growthGrad)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div data-testid="cumulative-growth-chart">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                Cumulative Total
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={dailyData}>
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
                  <Legend
                    wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative"
                    stroke={CHART_COLORS.cumulative}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!hasRun && !loading && (
          <div className="text-center py-12 space-y-2" data-testid="initial-state">
            <Users className="w-8 h-8 text-brand/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Select a time range and click <span className="text-brand">Run</span> to fetch network growth data.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
