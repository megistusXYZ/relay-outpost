import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell } from "recharts";
import { Users, Play, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = ["#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd"];

interface FunnelStage {
  name: string;
  count: number;
  percent: number;
}

interface AnalysisState {
  status: "idle" | "fetching_profiles" | "checking_milestones" | "done";
  profilesFetched: number;
  milestonesChecked: number;
  totalToCheck: number;
  stages: FunnelStage[];
}

const TIME_RANGES = [
  { label: "7 days", value: "7d", seconds: 7 * 86400 },
  { label: "30 days", value: "30d", seconds: 30 * 86400 },
  { label: "90 days", value: "90d", seconds: 90 * 86400 },
];

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-foreground">
          {entry.name || "Conversion"}:{" "}
          <span className="text-brand font-mono">
            {Number(entry.value).toFixed(1)}%
          </span>
        </p>
      ))}
    </div>
  );
}

export function BatchFunnelAnalysis({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [timeRange, setTimeRange] = useState("30d");
  const [sampleSize, setSampleSize] = useState(50);
  const [analysis, setAnalysis] = useState<AnalysisState>({
    status: "idle",
    profilesFetched: 0,
    milestonesChecked: 0,
    totalToCheck: 0,
    stages: [] });

  const isRunning = analysis.status !== "idle" && analysis.status !== "done";

  const runAnalysis = useCallback(() => {
    const range = TIME_RANGES.find((r) => r.value === timeRange);
    if (!range) return;

    const sinceTimestamp = Math.floor(Date.now() / 1000) - range.seconds;

    setAnalysis({
      status: "fetching_profiles",
      profilesFetched: 0,
      milestonesChecked: 0,
      totalToCheck: 0,
      stages: [] });

    const profileEvents: Event[] = [];

    const sub = throttledPoolSubscribe(
      relaysToUse.slice(0, 3),
      {
        kinds: [0],
        since: sinceTimestamp,
        limit: 200 } as any,
      {
        onevent(event: Event) {
          profileEvents.push(event);
          setAnalysis((prev) => ({
            ...prev,
            profilesFetched: profileEvents.length }));
        },
        oneose() {
          sub.close();

          const uniqueAuthors = new Map<string, Event>();
          for (const e of profileEvents) {
            if (
              !uniqueAuthors.has(e.pubkey) ||
              e.created_at > uniqueAuthors.get(e.pubkey)!.created_at
            ) {
              uniqueAuthors.set(e.pubkey, e);
            }
          }

          const pubkeys = Array.from(uniqueAuthors.keys()).slice(
            0,
            sampleSize
          );
          const total = pubkeys.length;

          if (total === 0) {
            setAnalysis((prev) => ({
              ...prev,
              status: "done",
              stages: [] }));
            return;
          }

          setAnalysis((prev) => ({
            ...prev,
            status: "checking_milestones",
            totalToCheck: total,
            milestonesChecked: 0 }));

          const milestones = {
            hasPost: new Set<string>(),
            hasReply: new Set<string>(),
            hasReaction: new Set<string>(),
            hasRepost: new Set<string>(),
            hasZap: new Set<string>() };

          let completedQueries = 0;
          const totalQueries = 4;

          function checkComplete() {
            completedQueries++;
            setAnalysis((prev) => ({
              ...prev,
              milestonesChecked: Math.min(
                total,
                Math.floor((completedQueries / totalQueries) * total)
              ) }));

            if (completedQueries >= totalQueries) {
              const stages: FunnelStage[] = [
                {
                  name: "Profile Created",
                  count: total,
                  percent: 100 },
                {
                  name: "First Post",
                  count: milestones.hasPost.size,
                  percent:
                    total > 0
                      ? (milestones.hasPost.size / total) * 100
                      : 0 },
                {
                  name: "First Reply",
                  count: milestones.hasReply.size,
                  percent:
                    total > 0
                      ? (milestones.hasReply.size / total) * 100
                      : 0 },
                {
                  name: "First Reaction",
                  count: milestones.hasReaction.size,
                  percent:
                    total > 0
                      ? (milestones.hasReaction.size / total) * 100
                      : 0 },
                {
                  name: "First Repost",
                  count: milestones.hasRepost.size,
                  percent:
                    total > 0
                      ? (milestones.hasRepost.size / total) * 100
                      : 0 },
                {
                  name: "First Zap",
                  count: milestones.hasZap.size,
                  percent:
                    total > 0
                      ? (milestones.hasZap.size / total) * 100
                      : 0 },
              ];

              setAnalysis((prev) => ({
                ...prev,
                status: "done",
                milestonesChecked: total,
                stages }));
            }
          }

          const relays = relaysToUse.slice(0, 3);

          const postSub = throttledPoolSubscribe(
            relays,
            { kinds: [1], authors: pubkeys, limit: pubkeys.length } as any,
            {
              onevent(event: Event) {
                milestones.hasPost.add(event.pubkey);
                const hasETag = event.tags.some((t) => t[0] === "e");
                if (hasETag) {
                  milestones.hasReply.add(event.pubkey);
                }
              },
              oneose() {
                postSub.close();
                checkComplete();
              } }
          );

          const reactionSub = throttledPoolSubscribe(
            relays,
            { kinds: [7], authors: pubkeys, limit: pubkeys.length } as any,
            {
              onevent(event: Event) {
                milestones.hasReaction.add(event.pubkey);
              },
              oneose() {
                reactionSub.close();
                checkComplete();
              } }
          );

          const repostSub = throttledPoolSubscribe(
            relays,
            { kinds: [6], authors: pubkeys, limit: pubkeys.length } as any,
            {
              onevent(event: Event) {
                milestones.hasRepost.add(event.pubkey);
              },
              oneose() {
                repostSub.close();
                checkComplete();
              } }
          );

          const zapSub = throttledPoolSubscribe(
            relays,
            { kinds: [9735], authors: pubkeys, limit: pubkeys.length } as any,
            {
              onevent(event: Event) {
                milestones.hasZap.add(event.pubkey);
              },
              oneose() {
                zapSub.close();
                checkComplete();
              } }
          );
        } }
    );
  }, [timeRange, sampleSize, relaysToUse]);

  const progressPercent = useMemo(() => {
    if (analysis.status === "idle") return 0;
    if (analysis.status === "done") return 100;
    if (analysis.status === "fetching_profiles") {
      return Math.min(40, (analysis.profilesFetched / 200) * 40);
    }
    if (analysis.status === "checking_milestones" && analysis.totalToCheck > 0) {
      return 40 + (analysis.milestonesChecked / analysis.totalToCheck) * 60;
    }
    return 0;
  }, [analysis]);

  const dropOffRate = useMemo(() => {
    if (analysis.stages.length < 2) return null;
    const first = analysis.stages[0].percent;
    const last = analysis.stages[analysis.stages.length - 1].percent;
    return first > 0 ? ((first - last) / first) * 100 : 0;
  }, [analysis.stages]);

  return (
    <div className="overflow-visible" data-testid="batch-funnel-analysis">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Users className="w-4 h-4 text-brand" />
          <h2
            className="text-sm font-display text-brand"
            data-testid="text-funnel-title"
          >
            Batch Funnel Analysis
          </h2>
          {analysis.status === "done" && analysis.stages.length > 0 && (
            <Badge variant="secondary" data-testid="badge-sample-count">
              {analysis.stages[0].count} accounts sampled
            </Badge>
          )}
          {dropOffRate !== null && (
            <Badge variant="secondary" data-testid="badge-dropoff-rate">
              <TrendingDown className="w-3 h-3 mr-1" />
              {dropOffRate.toFixed(1)}% drop-off
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label
              className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50"
              data-testid="label-time-range"
            >
              Time Range
            </Label>
            <Select
              value={timeRange}
              onValueChange={setTimeRange}
              disabled={isRunning}
            >
              <SelectTrigger data-testid="select-time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value} data-testid={`select-item-${r.value}`}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label
              className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50"
              data-testid="label-sample-size"
            >
              Sample Size: {sampleSize}
            </Label>
            <Slider
              min={10}
              max={100}
              step={5}
              value={[sampleSize]}
              onValueChange={([v]) => setSampleSize(v)}
              disabled={isRunning}
              data-testid="slider-sample-size"
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={runAnalysis}
              disabled={isRunning}
              className="w-full bg-brand/10 border border-brand/10 text-brand hover-elevate"
              data-testid="button-run-analysis"
            >
              {isRunning ? (
                <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {isRunning ? "Analyzing..." : "Run Analysis"}
            </Button>
          </div>
        </div>

        {isRunning && (
          <div className="space-y-2" data-testid="loading-progress">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span data-testid="text-progress-status">
                {analysis.status === "fetching_profiles"
                  ? `Fetching profiles... (${analysis.profilesFetched} found)`
                  : `Checking milestones... (${analysis.milestonesChecked}/${analysis.totalToCheck})`}
              </span>
              <span className="font-mono text-brand" data-testid="text-progress-percent">
                {Math.round(progressPercent)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-brand/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
                data-testid="progress-bar"
              />
            </div>
          </div>
        )}

        {analysis.status === "done" && analysis.stages.length > 0 && (
          <div className="space-y-4">
            <div data-testid="funnel-chart">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={analysis.stages}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(139,92,246,0.1)"
                  />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.6)" }}
                    axisLine={false}
                    tickLine={false}
                    width={75}
                  />
                  <Tooltip content={<CustomTooltipContent />} />
                  <Bar dataKey="percent" name="Conversion" radius={[0, 4, 4, 0]}>
                    {analysis.stages.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="funnel-stats">
              {analysis.stages.map((stage, i) => (
                <div
                  key={stage.name}
                  className="p-2.5 rounded-lg bg-brand/5 border border-brand/10 space-y-0.5"
                  data-testid={`stat-stage-${i}`}
                >
                  <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">
                    {stage.name}
                  </p>
                  <p className="text-sm font-mono text-foreground">
                    {stage.count}{" "}
                    <span className="text-brand text-xs">
                      ({stage.percent.toFixed(1)}%)
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis.status === "done" && analysis.stages.length === 0 && (
          <div
            className="text-center py-8 text-sm text-muted-foreground/50"
            data-testid="text-no-data"
          >
            No new accounts found in the selected time range. Try a longer range
            or run again.
          </div>
        )}

        {analysis.status === "idle" && (
          <div
            className="text-center py-8 text-sm text-muted-foreground/50"
            data-testid="text-idle-message"
          >
            Configure the time range and sample size, then click Run Analysis to
            discover how new Nostr accounts progress through key milestones.
          </div>
        )}
      </div>
    </div>
  );
}
