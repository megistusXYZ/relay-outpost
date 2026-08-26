import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe, eventStore } from "@/lib/nostr";
import { fetchUserZaps } from "@/lib/primal-cache";
import { getProfileContent, getAvatarUrl } from "@/lib/nostr-helpers";
import { use$ } from "applesauce-react/hooks";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell } from "recharts";
import {
  Gauge,
  Zap,
  Search,
  Play,
  Rocket,
  Timer,
  Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ProfileLink } from "./ProfileLink";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = ["#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd", "#ddd6fe"];
const GRAY_COLOR = "#6b7280";

interface MilestoneResult {
  name: string;
  days: number | null;
  achieved: boolean;
}

interface VelocityResult {
  pubkey: string;
  createdAt: number;
  milestones: MilestoneResult[];
  rating: string;
}

function resolvePubkey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
  try {
    if (trimmed.startsWith("npub")) {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data as string;
    }
  } catch {}
  return null;
}

function computeRating(milestones: MilestoneResult[]): string {
  const achieved = milestones.filter((m) => m.achieved);
  if (achieved.length === 0) return "No Activity";
  const maxDays = Math.max(...achieved.map((m) => m.days!));
  if (achieved.length === milestones.length && maxDays < 30) return "Fast Adopter";
  if (maxDays < 90) return "Steady Builder";
  return "Slow Burner";
}

function generateVelocityAnalysis(milestones: MilestoneResult[], rating: string): string {
  const achieved = milestones.filter((m) => m.achieved);
  const total = milestones.length;

  if (achieved.length === 0) {
    return "No engagement milestones detected yet. This user may be very new or primarily a passive reader.";
  }

  const parts: string[] = [];

  if (rating === "Fast Adopter") {
    parts.push("This user adopted Nostr features rapidly, hitting all tracked milestones within the first month.");
  } else if (rating === "Steady Builder") {
    parts.push("This user has been building their presence at a consistent, healthy pace.");
  } else if (rating === "Slow Burner") {
    parts.push("This user is taking a longer path to engagement — common for users who explore gradually.");
  }

  const postMilestones = milestones.filter((m) => m.name.includes("Post"));
  const achievedPosts = postMilestones.filter((m) => m.achieved);
  if (achievedPosts.length > 0) {
    const latest = achievedPosts[achievedPosts.length - 1];
    parts.push(`Reached "${latest.name}" in ${latest.days} days.`);
  }

  const zapSent = milestones.find((m) => m.name === "First Zap Sent");
  const zapReceived = milestones.find((m) => m.name === "First Zap Received");
  if (zapSent?.achieved && zapReceived?.achieved) {
    parts.push("Active in the zap economy — both giving and receiving value.");
  } else if (zapSent?.achieved) {
    parts.push("Supports others through zaps, showing community investment.");
  } else if (zapReceived?.achieved) {
    parts.push("Has earned zaps from the community.");
  }

  const article = milestones.find((m) => m.name === "First Article");
  if (article?.achieved) {
    parts.push(`Published their first long-form article at day ${article.days}.`);
  }

  if (achieved.length < total) {
    const missing = milestones.filter((m) => !m.achieved).map((m) => m.name);
    if (missing.length <= 3) {
      parts.push(`Not yet reached: ${missing.join(", ")}.`);
    } else {
      parts.push(`${total - achieved.length} milestones still ahead.`);
    }
  }

  return parts.join(" ");
}

function getRatingIcon(rating: string) {
  if (rating === "Fast Adopter") return <Rocket className="w-4 h-4 text-green-800 dark:text-green-400" />;
  if (rating === "Steady Builder") return <Timer className="w-4 h-4 text-amber-800 dark:text-amber-400" />;
  if (rating === "Slow Burner") return <Target className="w-4 h-4 text-orange-800 dark:text-orange-400" />;
  return <Gauge className="w-4 h-4 text-muted-foreground" />;
}

function getRatingColor(rating: string): string {
  if (rating === "Fast Adopter") return "text-green-800 dark:text-green-400";
  if (rating === "Steady Builder") return "text-amber-800 dark:text-amber-400";
  if (rating === "Slow Burner") return "text-orange-800 dark:text-orange-400";
  return "text-muted-foreground";
}

function AnalyzedProfileHeader({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(0, pubkey), [pubkey]);
  const { avatarUrl, displayName } = useMemo(() => {
    if (!profile) return { avatarUrl: "", displayName: "" };
    const content = getProfileContent(profile);
    return {
      avatarUrl: getAvatarUrl(profile) || "",
      displayName: content?.display_name || content?.name || "" };
  }, [profile]);

  return (
    <div className="flex items-center gap-2" data-testid="velocity-profile-header">
      <Avatar className="w-7 h-7 shrink-0 border border-brand/20">
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className="bg-brand/20 text-[10px]">
          {displayName ? displayName.slice(0, 2).toUpperCase() : "??"}
        </AvatarFallback>
      </Avatar>
      <ProfileLink pubkey={pubkey} className="text-sm font-medium text-foreground" showAvatar={false} />
    </div>
  );
}

function CustomTooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  return (
    <div className="rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{data?.name}</p>
      <p className="text-foreground">
        {data?.achieved ? (
          <>Days: <span className="text-brand font-mono">{data?.days}</span></>
        ) : (
          <span className="text-muted-foreground">Not yet achieved</span>
        )}
      </p>
    </div>
  );
}

async function queryEventsForPubkey(
  pubkey: string,
  kinds: number[],
  limit: number,
  relays: string[] = DEFAULT_RELAYS
): Promise<Event[]> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    const timeout = setTimeout(() => resolve(events), 15000);
    const sub = throttledPoolSubscribe(
      relays.slice(0, 4),
      { kinds, authors: [pubkey], limit },
      {
        onevent(event: Event) {
          events.push(event);
        },
        oneose() {
          clearTimeout(timeout);
          sub.close();
          resolve(events);
        } }
    );
  });
}

async function queryZapsForPubkey(pubkey: string, relays: string[] = DEFAULT_RELAYS): Promise<{ sent: Event[]; received: Event[] }> {
  const primalPromise = fetchUserZaps(pubkey, 10).catch(() => ({ sent: [] as Event[], received: [] as Event[] }));
  const relayReceivedPromise: Promise<Event[]> = new Promise((resolve) => {
    const events: Event[] = [];
    const timeout = setTimeout(() => resolve(events), 15000);
    const sub = throttledPoolSubscribe(
      relays.slice(0, 4),
      { kinds: [9735], "#p": [pubkey], limit: 10 },
      {
        onevent(event: Event) {
          events.push(event);
        },
        oneose() {
          clearTimeout(timeout);
          sub.close();
          resolve(events);
        } }
    );
  });
  const [primalZaps, relayReceived] = await Promise.all([primalPromise, relayReceivedPromise]);

  const sentSeen = new Set<string>();
  const sent: Event[] = [];
  for (const e of primalZaps.sent) {
    if (!sentSeen.has(e.id)) { sentSeen.add(e.id); sent.push(e); }
  }

  const receivedSeen = new Set<string>();
  const received: Event[] = [];
  for (const e of [...primalZaps.received, ...relayReceived]) {
    if (!receivedSeen.has(e.id)) { receivedSeen.add(e.id); received.push(e); }
  }

  return { sent, received };
}

async function analyzeUser(pubkey: string, relays: string[] = DEFAULT_RELAYS): Promise<VelocityResult | null> {
  const profileEvents = await queryEventsForPubkey(pubkey, [0], 1, relays);
  if (profileEvents.length === 0) return null;

  const createdAt = Math.min(...profileEvents.map((e) => e.created_at));

  const [posts, reactions, zapData, articles] = await Promise.all([
    queryEventsForPubkey(pubkey, [1], 100, relays),
    queryEventsForPubkey(pubkey, [7], 200, relays),
    queryZapsForPubkey(pubkey, relays),
    queryEventsForPubkey(pubkey, [30023], 5, relays),
  ]);

  const sortedPosts = posts.sort((a, b) => a.created_at - b.created_at);
  const sortedReactions = reactions.sort((a, b) => a.created_at - b.created_at);
  const sortedZapsSent = zapData.sent.sort((a, b) => a.created_at - b.created_at);
  const sortedZapsReceived = zapData.received.sort((a, b) => a.created_at - b.created_at);
  const sortedArticles = articles.sort((a, b) => a.created_at - b.created_at);

  const daysSince = (ts: number) => Math.max(0, Math.round((ts - createdAt) / 86400));

  const milestones: MilestoneResult[] = [
    {
      name: "10th Post",
      days: sortedPosts.length >= 10 ? daysSince(sortedPosts[9].created_at) : null,
      achieved: sortedPosts.length >= 10 },
    {
      name: "50th Post",
      days: sortedPosts.length >= 50 ? daysSince(sortedPosts[49].created_at) : null,
      achieved: sortedPosts.length >= 50 },
    {
      name: "First Zap Sent",
      days: sortedZapsSent.length > 0 ? daysSince(sortedZapsSent[0].created_at) : null,
      achieved: sortedZapsSent.length > 0 },
    {
      name: "First Zap Received",
      days: sortedZapsReceived.length > 0 ? daysSince(sortedZapsReceived[0].created_at) : null,
      achieved: sortedZapsReceived.length > 0 },
    {
      name: "100th Reaction",
      days: sortedReactions.length >= 100 ? daysSince(sortedReactions[99].created_at) : null,
      achieved: sortedReactions.length >= 100 },
    {
      name: "First Article",
      days: sortedArticles.length > 0 ? daysSince(sortedArticles[0].created_at) : null,
      achieved: sortedArticles.length > 0 },
  ];

  const rating = computeRating(milestones);

  return { pubkey, createdAt, milestones, rating };
}

async function sampleRecentProfiles(count: number, relays: string[] = DEFAULT_RELAYS): Promise<string[]> {
  return new Promise((resolve) => {
    const profiles: Event[] = [];
    const seen = new Set<string>();
    const timeout = setTimeout(() => {
      resolve(profiles.map((e) => e.pubkey));
    }, 12000);
    const sub = throttledPoolSubscribe(
      relays.slice(0, 3),
      { kinds: [0], limit: count * 3 },
      {
        onevent(event: Event) {
          if (!seen.has(event.pubkey)) {
            seen.add(event.pubkey);
            profiles.push(event);
          }
        },
        oneose() {
          clearTimeout(timeout);
          sub.close();
          const sorted = profiles
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, count);
          resolve(sorted.map((e) => e.pubkey));
        } }
    );
  });
}

interface EngagementVelocityProps {
  pubkey?: string;
  relays?: string[];
}

export function EngagementVelocity({ pubkey: propPubkey, relays: propRelays }: EngagementVelocityProps) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [mode, setMode] = useState<"individual" | "batch">("individual");
  const [pubkeyInput, setPubkeyInput] = useState(propPubkey || "");
  const [sampleSize, setSampleSize] = useState("5");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VelocityResult | null>(null);
  const [batchResults, setBatchResults] = useState<VelocityResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleIndividualAnalyze = useCallback(async () => {
    const pubkey = resolvePubkey(pubkeyInput);
    if (!pubkey) {
      setError("Invalid pubkey or npub");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await analyzeUser(pubkey, relaysToUse);
      if (!res) {
        setError("Profile not found on relays");
      } else {
        setResult(res);
      }
    } catch (err) {
      setError("Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [pubkeyInput, relaysToUse]);

  const handleBatchAnalyze = useCallback(async () => {
    const size = Math.min(Math.max(parseInt(sampleSize) || 3, 1), 20);
    setError(null);
    setLoading(true);
    setBatchResults([]);
    try {
      const pubkeys = await sampleRecentProfiles(size, relaysToUse);
      if (pubkeys.length === 0) {
        setError("No profiles found");
        setLoading(false);
        return;
      }
      const results: VelocityResult[] = [];
      for (const pk of pubkeys) {
        try {
          const res = await analyzeUser(pk, relaysToUse);
          if (res) results.push(res);
        } catch {}
      }
      if (results.length === 0) {
        setError("No results from sampled profiles");
      } else {
        setBatchResults(results);
      }
    } catch {
      setError("Batch analysis failed");
    } finally {
      setLoading(false);
    }
  }, [sampleSize, relaysToUse]);

  const batchAverages = useMemo(() => {
    if (batchResults.length === 0) return [];
    const milestoneNames = ["10th Post", "50th Post", "First Zap Sent", "First Zap Received", "100th Reaction", "First Article"];
    return milestoneNames.map((name, idx) => {
      const achieved = batchResults
        .map((r) => r.milestones[idx])
        .filter((m) => m.achieved);
      const avgDays =
        achieved.length > 0
          ? Math.round(achieved.reduce((s, m) => s + m.days!, 0) / achieved.length)
          : null;
      return {
        name,
        days: avgDays ?? 0,
        achieved: achieved.length > 0,
        count: achieved.length,
        total: batchResults.length };
    });
  }, [batchResults]);

  const batchRating = useMemo(() => {
    if (batchAverages.length === 0) return "No Data";
    const achieved = batchAverages.filter((m) => m.achieved);
    if (achieved.length === 0) return "No Activity";
    const maxDays = Math.max(...achieved.map((m) => m.days));
    if (achieved.length === batchAverages.length && maxDays < 30) return "Fast Adopter";
    if (maxDays < 90) return "Steady Builder";
    return "Slow Burner";
  }, [batchAverages]);

  const chartData = useMemo(() => {
    if (mode === "individual" && result) {
      return result.milestones.map((m) => ({
        name: m.name,
        days: m.achieved ? m.days! : 0,
        achieved: m.achieved }));
    }
    if (mode === "batch" && batchAverages.length > 0) {
      return batchAverages.map((m) => ({
        name: m.name,
        days: m.days,
        achieved: m.achieved,
        label: m.achieved ? `${m.count}/${m.total}` : "0" }));
    }
    return [];
  }, [mode, result, batchAverages]);

  const isBatch = mode === "batch";

  return (
    <div className="overflow-visible" data-testid="engagement-velocity">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Gauge className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-display text-brand" data-testid="title-engagement-velocity">
            Engagement Velocity
          </h2>
          <Badge variant="secondary" data-testid="badge-mode">
            {mode === "individual" ? "Individual" : "Batch"}
          </Badge>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="mode-toggle" className="text-xs text-muted-foreground" data-testid="label-mode">
              Individual
            </Label>
            <Switch
              id="mode-toggle"
              checked={isBatch}
              onCheckedChange={(checked) => {
                setMode(checked ? "batch" : "individual");
                setError(null);
                setResult(null);
                setBatchResults([]);
              }}
              data-testid="switch-mode"
            />
            <Label htmlFor="mode-toggle" className="text-xs text-muted-foreground" data-testid="label-mode-batch">
              Batch
            </Label>
          </div>
        </div>

        {mode === "individual" && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <Input
                placeholder="Enter npub or hex pubkey..."
                value={pubkeyInput}
                onChange={(e) => setPubkeyInput(e.target.value)}
                className="pl-8 bg-brand/5 border-brand/10 text-sm"
                style={{ fontSize: "16px" }}
                data-testid="input-pubkey"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleIndividualAnalyze();
                }}
              />
            </div>
            <Button
              onClick={handleIndividualAnalyze}
              disabled={loading || !pubkeyInput.trim()}
              data-testid="button-analyze"
            >
              {loading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              Analyze
            </Button>
          </div>
        )}

        {mode === "batch" && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="sample-size" className="text-xs text-muted-foreground whitespace-nowrap" data-testid="label-sample-size">
                Sample Size
              </Label>
              <Input
                id="sample-size"
                type="number"
                min={1}
                max={20}
                value={sampleSize}
                onChange={(e) => setSampleSize(e.target.value)}
                className="w-20 bg-brand/5 border-brand/10 text-sm"
                style={{ fontSize: "16px" }}
                data-testid="input-sample-size"
              />
            </div>
            <Button
              onClick={handleBatchAnalyze}
              disabled={loading}
              data-testid="button-batch-analyze"
            >
              {loading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              Run Batch
            </Button>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" data-testid="text-error">
            {error}
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8" data-testid="loading-indicator">
            <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            <span className="text-xs text-muted-foreground">
              {mode === "individual" ? "Analyzing user milestones..." : "Sampling and analyzing profiles..."}
            </span>
          </div>
        )}

        {!loading && chartData.length > 0 && (
          <div className="space-y-4">
            {mode === "individual" && result && (
              <AnalyzedProfileHeader pubkey={result.pubkey} />
            )}
            <div className="flex items-center gap-2 flex-wrap" data-testid="speed-rating">
              {getRatingIcon(mode === "individual" ? result!.rating : batchRating)}
              <span className={`text-sm font-display ${getRatingColor(mode === "individual" ? result!.rating : batchRating)}`} data-testid="text-rating">
                {mode === "individual" ? result!.rating : batchRating}
              </span>
              {mode === "batch" && (
                <span className="text-xs text-muted-foreground" data-testid="text-batch-count">
                  ({batchResults.length} profiles analyzed)
                </span>
              )}
            </div>

            {mode === "individual" && result && (
              <div className="p-3 rounded-lg bg-brand/5 border border-brand/10 space-y-2" data-testid="velocity-analysis">
                <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                  Velocity Analysis
                </p>
                <p className="text-xs text-foreground/80 leading-relaxed" data-testid="text-velocity-narrative">
                  {generateVelocityAnalysis(result.milestones, result.rating)}
                </p>
              </div>
            )}

            {mode === "batch" && batchResults.length > 0 && (
              <div className="p-3 rounded-lg bg-brand/5 border border-brand/10 space-y-2" data-testid="batch-analysis">
                <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                  Batch Analysis
                </p>
                <p className="text-xs text-foreground/80 leading-relaxed" data-testid="text-batch-narrative">
                  {(() => {
                    const achievedAll = batchAverages.filter((m) => m.achieved);
                    const avgDays = achievedAll.length > 0
                      ? Math.round(achievedAll.reduce((s, m) => s + m.days, 0) / achievedAll.length)
                      : 0;
                    const completionRate = batchAverages.length > 0
                      ? Math.round((achievedAll.length / batchAverages.length) * 100)
                      : 0;
                    return `Across ${batchResults.length} sampled profiles, ${completionRate}% of milestones were reached on average. The average time to reach achieved milestones was ${avgDays} days. Rating: ${batchRating}.`;
                  })()}
                </p>
              </div>
            )}

            <div data-testid="velocity-chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.1)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: "Days", position: "insideBottom", offset: -2, fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip content={<CustomTooltipContent />} cursor={false} />
                  <Bar dataKey="days" radius={[0, 4, 4, 0]} barSize={18}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.achieved ? CHART_COLORS[index % CHART_COLORS.length] : GRAY_COLOR}
                        fillOpacity={entry.achieved ? 1 : 0.3}
                        strokeDasharray={entry.achieved ? undefined : "4 4"}
                        stroke={entry.achieved ? undefined : GRAY_COLOR}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="milestone-cards">
              {(mode === "individual" ? result!.milestones : batchAverages).map((m, i) => (
                <div
                  key={m.name}
                  className={`p-3 rounded-lg border ${
                    m.achieved
                      ? "bg-brand/10 border-brand/10"
                      : "bg-muted/5 border-muted/10"
                  }`}
                  data-testid={`milestone-card-${i}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {m.achieved ? (
                      <Zap className="w-3 h-3 text-brand" />
                    ) : (
                      <Target className="w-3 h-3 text-muted-foreground/50" />
                    )}
                    <span className="text-xs font-medium text-foreground" data-testid={`milestone-name-${i}`}>
                      {m.name}
                    </span>
                  </div>
                  <p
                    className={`text-lg font-mono ${m.achieved ? "text-brand" : "text-muted-foreground/40"}`}
                    data-testid={`milestone-days-${i}`}
                  >
                    {m.achieved ? (
                      <>
                        {mode === "individual" ? (m as MilestoneResult).days : (m as any).days}
                        <span className="text-xs ml-1 text-muted-foreground">days</span>
                      </>
                    ) : (
                      <span className="text-xs">Not reached</span>
                    )}
                  </p>
                  {mode === "batch" && m.achieved && (
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5" data-testid={`milestone-ratio-${i}`}>
                      {(m as any).count}/{(m as any).total} users achieved
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && chartData.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-8 gap-2" data-testid="empty-state">
            <Gauge className="w-8 h-8 text-brand/20" />
            <p className="text-xs text-muted-foreground/50">
              {mode === "individual"
                ? "Enter a pubkey or npub to analyze engagement velocity"
                : "Click Run Batch to sample and analyze recent profiles"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
