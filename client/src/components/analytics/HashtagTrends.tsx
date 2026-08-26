import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer } from "recharts";
import {
  Hash,
  Play,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  Flame } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = ["#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd"];

const TIME_RANGES = [
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 7 * 86400 },
  { label: "30d", seconds: 30 * 86400 },
];

const CONTENT_KINDS = [1, 30023, 20, 21];

interface HashtagData {
  tag: string;
  currentCount: number;
  previousCount: number;
  trendPercent: number;
  trendScore: number;
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

function extractHashtags(event: Event): string[] {
  return event.tags
    .filter((t) => t[0] === "t" && t[1])
    .map((t) => t[1].toLowerCase().trim())
    .filter((t) => t.length > 0 && t.length <= 50);
}

export function HashtagTrends({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [timeRange, setTimeRange] = useState("7d");
  const [loading, setLoading] = useState(false);
  const [currentEvents, setCurrentEvents] = useState<Event[]>([]);
  const [previousEvents, setPreviousEvents] = useState<Event[]>([]);
  const [hasRun, setHasRun] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setCurrentEvents([]);
    setPreviousEvents([]);
    setHasRun(true);

    const rangeConfig = TIME_RANGES.find((r) => r.label === timeRange) || TIME_RANGES[1];
    const now = Math.floor(Date.now() / 1000);
    const currentSince = now - rangeConfig.seconds;
    const previousSince = currentSince - rangeConfig.seconds;

    const relays = relaysToUse;
    const collectedCurrent: Event[] = [];
    const collectedPrevious: Event[] = [];
    let completed = 0;

    const checkDone = () => {
      completed++;
      if (completed >= 2) {
        setCurrentEvents(collectedCurrent);
        setPreviousEvents(collectedPrevious);
        setLoading(false);
      }
    };

    throttledPoolSubscribe(
      relays,
      { kinds: CONTENT_KINDS, since: currentSince, until: now, limit: 3000 },
      {
        onevent(event: Event) {
          collectedCurrent.push(event);
        },
        oneose() {
          checkDone();
        } }
    );

    throttledPoolSubscribe(
      relays,
      { kinds: CONTENT_KINDS, since: previousSince, until: currentSince, limit: 3000 },
      {
        onevent(event: Event) {
          collectedPrevious.push(event);
        },
        oneose() {
          checkDone();
        } }
    );
  }, [timeRange, relaysToUse]);

  const hashtagData: HashtagData[] = useMemo(() => {
    if (currentEvents.length === 0) return [];

    const currentCounts = new Map<string, number>();
    for (const e of currentEvents) {
      for (const tag of extractHashtags(e)) {
        currentCounts.set(tag, (currentCounts.get(tag) || 0) + 1);
      }
    }

    const previousCounts = new Map<string, number>();
    for (const e of previousEvents) {
      for (const tag of extractHashtags(e)) {
        previousCounts.set(tag, (previousCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(currentCounts.entries())
      .map(([tag, currentCount]) => {
        const previousCount = previousCounts.get(tag) || 0;
        const trendPercent = previousCount > 0
          ? ((currentCount - previousCount) / previousCount) * 100
          : currentCount > 0 ? 100 : 0;
        const trendScore = previousCount > 0
          ? (currentCount / previousCount) * Math.log2(currentCount + 1)
          : currentCount * 0.5;
        return { tag, currentCount, previousCount, trendPercent, trendScore };
      })
      .sort((a, b) => b.currentCount - a.currentCount);
  }, [currentEvents, previousEvents]);

  const topHashtags = useMemo(() => hashtagData.slice(0, 20), [hashtagData]);

  const chartData = useMemo(
    () => topHashtags.slice(0, 10).map((d) => ({
      name: `#${d.tag}`,
      Count: d.currentCount,
      Previous: d.previousCount })),
    [topHashtags]
  );

  const summary = useMemo(() => {
    if (hashtagData.length === 0) return null;

    const totalUnique = hashtagData.length;
    const mostPopular = hashtagData[0];
    const fastestGrowing = [...hashtagData]
      .filter((d) => d.currentCount >= 3)
      .sort((a, b) => b.trendScore - a.trendScore)[0] || null;

    return { totalUnique, mostPopular, fastestGrowing };
  }, [hashtagData]);

  return (
    <div className="overflow-visible" data-testid="hashtag-trends">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Hash className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-display text-brand">Hashtag Trends</h2>
          <Badge variant="secondary" data-testid="badge-hashtag-count">
            {hashtagData.length.toLocaleString()} tags
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
            data-testid="button-run-hashtags"
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="summary-cards">
            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Unique Hashtags</p>
              <div className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-brand" data-testid="text-total-unique">
                  {summary.totalUnique.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Most Popular</p>
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-mono text-amber-800 dark:text-amber-400 truncate" data-testid="text-most-popular">
                    #{summary.mostPopular.tag}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50">
                    {summary.mostPopular.currentCount.toLocaleString()} uses
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Fastest Growing</p>
              <div className="flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-orange-800 dark:text-orange-400" />
                <div>
                  {summary.fastestGrowing ? (
                    <>
                      <p className="text-sm font-mono text-orange-800 dark:text-orange-400 truncate" data-testid="text-fastest-growing">
                        #{summary.fastestGrowing.tag}
                      </p>
                      <p className="text-[10px] text-muted-foreground/50">
                        score {summary.fastestGrowing.trendScore.toFixed(1)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-mono text-muted-foreground/50" data-testid="text-fastest-growing">
                      N/A
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-indicator">
            <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            <span className="text-sm text-muted-foreground">Querying relays for hashtag data...</span>
          </div>
        )}

        {!loading && hasRun && hashtagData.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground" data-testid="empty-state">
            No hashtags found in this time range.
          </div>
        )}

        {!loading && chartData.length > 0 && (
          <div className="space-y-4">
            <div data-testid="hashtag-bar-chart">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                Top Hashtags (Current vs Previous Period)
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.08)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }}
                    axisLine={false}
                    tickLine={false}
                    width={80}
                  />
                  <Tooltip content={<CustomTooltipContent />} />
                  <Bar dataKey="Count" fill={CHART_COLORS[0]} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="Previous" fill={CHART_COLORS[4]} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto" data-testid="hashtag-table">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-brand/10">
                    <th className="text-left py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Rank</th>
                    <th className="text-left py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Hashtag</th>
                    <th className="text-right py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Count</th>
                    <th className="text-right py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Trend</th>
                    <th className="text-right py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {topHashtags.map((d, i) => {
                    const isUp = d.trendPercent > 0;
                    const isDown = d.trendPercent < 0;
                    const trendColor = isUp ? "text-emerald-800 dark:text-emerald-400" : isDown ? "text-red-700 dark:text-red-400" : "text-muted-foreground";
                    const TrendIcon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus;
                    return (
                      <tr key={d.tag} className="border-b border-brand/5" data-testid={`row-hashtag-${i}`}>
                        <td className="py-1.5 px-2 text-muted-foreground/40 font-mono">{i + 1}</td>
                        <td className="py-1.5 px-2 font-mono text-foreground" data-testid={`text-hashtag-${i}`}>#{d.tag}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-brand" data-testid={`text-count-${i}`}>
                          {d.currentCount.toLocaleString()}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono ${trendColor}`} data-testid={`text-trend-${i}`}>
                          <span className="inline-flex items-center gap-0.5">
                            <TrendIcon className="w-3 h-3" />
                            {Math.abs(d.trendPercent) === Infinity
                              ? "new"
                              : `${Math.abs(d.trendPercent).toFixed(0)}%`}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-amber-800/70 dark:text-amber-400/70" data-testid={`text-score-${i}`}>
                          {d.trendScore.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!hasRun && !loading && (
          <div className="text-center py-12 space-y-2" data-testid="initial-state">
            <Hash className="w-8 h-8 text-brand/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Select a time range and click <span className="text-brand">Run</span> to discover trending hashtags.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
