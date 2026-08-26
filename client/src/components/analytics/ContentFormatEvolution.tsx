import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend } from "recharts";
import {
  Play,
  Layers,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3 } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const FORMAT_COLORS: Record<string, string> = {
  "Text Note": "#8b5cf6",
  "Reply": "#a78bfa",
  "Repost": "#7c3aed",
  "Reaction": "#6d28d9",
  "Picture": "#c4b5fd",
  "Video": "#ddd6fe",
  "Article": "#5b21b6",
  "Comment": "#4c1d95" };

const FORMAT_KEYS = Object.keys(FORMAT_COLORS);

const TIME_RANGES = [
  { label: "7d", seconds: 7 * 86400 },
  { label: "30d", seconds: 30 * 86400 },
  { label: "90d", seconds: 90 * 86400 },
];

const CONTENT_KINDS = [1, 6, 7, 20, 21, 30023, 1111];

function classifyEvent(event: Event): string {
  switch (event.kind) {
    case 1: {
      const hasETag = event.tags.some((t) => t[0] === "e");
      return hasETag ? "Reply" : "Text Note";
    }
    case 6:
      return "Repost";
    case 7:
      return "Reaction";
    case 20:
      return "Picture";
    case 21:
      return "Video";
    case 30023:
      return "Article";
    case 1111:
      return "Comment";
    default:
      return "Text Note";
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

interface DayFormatData {
  date: string;
  [key: string]: number | string;
}

export function ContentFormatEvolution({ relays: propRelays }: { relays?: string[] }) {
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
      relaysToUse,
      { kinds: CONTENT_KINDS, since: sinceTimestamp, until: nowTimestamp, limit: 5000 },
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

  const dailyData: DayFormatData[] = useMemo(() => {
    if (events.length === 0) return [];

    const buckets = new Map<string, Map<string, number>>();
    for (const e of events) {
      const day = format(new Date(e.created_at * 1000), "yyyy-MM-dd");
      if (!buckets.has(day)) buckets.set(day, new Map());
      const dayMap = buckets.get(day)!;
      const fmt = classifyEvent(e);
      dayMap.set(fmt, (dayMap.get(fmt) || 0) + 1);
    }

    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([date, formatMap]) => {
      const row: DayFormatData = { date: format(new Date(date), "MMM dd") };
      for (const key of FORMAT_KEYS) {
        row[key] = formatMap.get(key) || 0;
      }
      return row;
    });
  }, [events]);

  const overallDistribution = useMemo(() => {
    if (events.length === 0) return [];
    const counts = new Map<string, number>();
    for (const e of events) {
      const fmt = classifyEvent(e);
      counts.set(fmt, (counts.get(fmt) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [events]);

  const summary = useMemo(() => {
    if (events.length === 0 || dailyData.length === 0) return null;

    const totalEvents = events.length;

    const dominant = overallDistribution[0];

    const half = Math.floor(dailyData.length / 2);
    const firstHalf = dailyData.slice(0, Math.max(half, 1));
    const secondHalf = dailyData.slice(Math.max(half, 1));

    let fastestGrowing = "";
    let maxGrowthRate = -Infinity;

    for (const key of FORMAT_KEYS) {
      const firstSum = firstHalf.reduce((s, d) => s + (Number(d[key]) || 0), 0);
      const secondSum = secondHalf.reduce((s, d) => s + (Number(d[key]) || 0), 0);
      const firstAvg = firstSum / firstHalf.length;
      const secondAvg = secondSum / secondHalf.length;
      const growth = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : secondAvg > 0 ? 100 : 0;
      if (growth > maxGrowthRate) {
        maxGrowthRate = growth;
        fastestGrowing = key;
      }
    }

    return {
      totalEvents,
      dominantFormat: dominant?.name || "N/A",
      dominantPct: dominant ? ((dominant.value / totalEvents) * 100).toFixed(1) : "0",
      fastestGrowing,
      growthRate: maxGrowthRate };
  }, [events, dailyData, overallDistribution]);

  const formatStats = useMemo(() => {
    if (events.length === 0 || dailyData.length === 0) return [];

    const half = Math.floor(dailyData.length / 2);
    const firstHalf = dailyData.slice(0, Math.max(half, 1));
    const secondHalf = dailyData.slice(Math.max(half, 1));

    const totalEvents = events.length;

    return FORMAT_KEYS.map((key) => {
      const total = overallDistribution.find((d) => d.name === key)?.value || 0;
      const pct = totalEvents > 0 ? ((total / totalEvents) * 100).toFixed(1) : "0";

      const firstTotal = firstHalf.reduce((s, d) => s + (Number(d[key]) || 0), 0);
      const secondTotal = secondHalf.reduce((s, d) => s + (Number(d[key]) || 0), 0);

      const firstAllTotal = firstHalf.reduce((s, d) => {
        let sum = 0;
        for (const k of FORMAT_KEYS) sum += Number(d[k]) || 0;
        return s + sum;
      }, 0);
      const secondAllTotal = secondHalf.reduce((s, d) => {
        let sum = 0;
        for (const k of FORMAT_KEYS) sum += Number(d[k]) || 0;
        return s + sum;
      }, 0);

      const firstPct = firstAllTotal > 0 ? ((firstTotal / firstAllTotal) * 100).toFixed(1) : "0";
      const secondPct = secondAllTotal > 0 ? ((secondTotal / secondAllTotal) * 100).toFixed(1) : "0";

      const direction = Number(secondPct) > Number(firstPct) ? "up" : Number(secondPct) < Number(firstPct) ? "down" : "flat";

      return { name: key, total, pct, firstPct, secondPct, direction };
    }).filter((s) => s.total > 0);
  }, [events, dailyData, overallDistribution]);

  const TrendIcon = summary?.growthRate && summary.growthRate > 5
    ? TrendingUp
    : summary?.growthRate && summary.growthRate < -5
      ? TrendingDown
      : Minus;

  return (
    <div className="overflow-visible" data-testid="content-format-evolution">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-display text-brand">Content Format Evolution</h2>
          <Badge variant="secondary" data-testid="badge-event-count">
            {events.length.toLocaleString()} events
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
            data-testid="button-run-format-evolution"
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
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Total Events</p>
              <div className="flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-brand" data-testid="text-total-events">
                  {summary.totalEvents.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Dominant Format</p>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: FORMAT_COLORS[summary.dominantFormat] || "#8b5cf6" }}
                />
                <p className="text-lg font-mono text-foreground" data-testid="text-dominant-format">
                  {summary.dominantFormat}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground/50" data-testid="text-dominant-pct">
                {summary.dominantPct}% of total
              </p>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Fastest Growing</p>
              <div className="flex items-center gap-1.5">
                <TrendIcon className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400" />
                <p className="text-lg font-mono text-emerald-800 dark:text-emerald-400" data-testid="text-fastest-growing">
                  {summary.fastestGrowing}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground/50" data-testid="text-growth-rate">
                {summary.growthRate > 0 ? "+" : ""}{summary.growthRate.toFixed(1)}% growth
              </p>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Format Types</p>
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-foreground" data-testid="text-format-count">
                  {overallDistribution.length}
                </p>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-indicator">
            <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            <span className="text-sm text-muted-foreground">Querying relays for content events...</span>
          </div>
        )}

        {!loading && hasRun && events.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground" data-testid="empty-state">
            No content events found in this time range.
          </div>
        )}

        {!loading && dailyData.length > 0 && (
          <div className="space-y-6">
            <div data-testid="stacked-area-chart">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                Content Format Mix Over Time
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyData}>
                  <defs>
                    {FORMAT_KEYS.map((key) => (
                      <linearGradient key={key} id={`grad-${key.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={FORMAT_COLORS[key]} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={FORMAT_COLORS[key]} stopOpacity={0.05} />
                      </linearGradient>
                    ))}
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
                  <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }} />
                  {FORMAT_KEYS.map((key) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stackId="1"
                      stroke={FORMAT_COLORS[key]}
                      fill={`url(#grad-${key.replace(/\s/g, "")})`}
                      strokeWidth={1}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div data-testid="pie-chart">
                <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                  Overall Format Distribution
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={overallDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                    >
                      {overallDistribution.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={FORMAT_COLORS[entry.name] || "#8b5cf6"}
                          stroke="rgba(4,4,10,0.8)"
                          strokeWidth={1}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div data-testid="format-stats">
                <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                  Format-Specific Trends
                </p>
                <div className="space-y-2">
                  {formatStats.map((stat) => {
                    const DirectionIcon = stat.direction === "up" ? TrendingUp : stat.direction === "down" ? TrendingDown : Minus;
                    const dirColor = stat.direction === "up" ? "text-emerald-800 dark:text-emerald-400" : stat.direction === "down" ? "text-red-700 dark:text-red-400" : "text-muted-foreground";
                    return (
                      <div
                        key={stat.name}
                        className="flex items-center gap-2 p-2 rounded-lg bg-brand/5 border border-brand/10"
                        data-testid={`format-stat-${stat.name.toLowerCase().replace(/\s/g, "-")}`}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: FORMAT_COLORS[stat.name] }}
                        />
                        <span className="text-xs text-foreground flex-1 min-w-0 truncate">{stat.name}</span>
                        <span className="text-xs font-mono text-brand">{stat.pct}%</span>
                        <DirectionIcon className={`w-3 h-3 shrink-0 ${dirColor}`} />
                        <span className={`text-[10px] font-mono ${dirColor} shrink-0`}>
                          {stat.direction === "up" ? "up" : stat.direction === "down" ? "down" : "flat"} from {stat.firstPct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {!hasRun && !loading && (
          <div className="text-center py-12 space-y-2" data-testid="initial-state">
            <Layers className="w-8 h-8 text-brand/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Select a time range and click <span className="text-brand">Run</span> to analyze content format evolution.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
