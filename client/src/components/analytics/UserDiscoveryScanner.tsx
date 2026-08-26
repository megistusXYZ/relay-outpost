import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import { fetchUserZaps } from "@/lib/primal-cache";
import { ProfileLink } from "./ProfileLink";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import {
  Eye,
  Radio,
  MessageCircle,
  Users,
  Sparkles,
  Rocket,
  Timer,
  Target,
  Gauge,
  Play,
  Search,
  ExternalLink,
  Filter } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

interface MilestoneData {
  key: string;
  timestamp: number | null;
}

interface ScanResult {
  pubkey: string;
  stage: string;
  stageName: string;
  pace: string;
  paceDescription: string;
  rating: string;
  milestoneCount: number;
  totalMilestones: number;
  timeSpanDays: number | null;
  accountCreated: number | null;
}

const STAGE_INFO: Record<string, { name: string; icon: typeof Eye; color: string; bgColor: string; borderColor: string; description: string }> = {
  observer: {
    name: "Observer",
    icon: Eye,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/20",
    description: "Lurking — hasn't posted yet" },
  broadcaster: {
    name: "Broadcaster",
    icon: Radio,
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    description: "Posts but doesn't interact with others" },
  conversationalist: {
    name: "Conversationalist",
    icon: MessageCircle,
    color: "text-cyan-800 dark:text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/20",
    description: "Posts and replies to people" },
  community_member: {
    name: "Community Member",
    icon: Users,
    color: "text-brand",
    bgColor: "bg-brand/10",
    borderColor: "border-brand/20",
    description: "Actively engaging — posts, replies, reactions/reposts" },
  fully_integrated: {
    name: "Fully Integrated",
    icon: Sparkles,
    color: "text-amber-800 dark:text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    description: "Does everything including zaps" } };

const PACE_INFO: Record<string, string> = {
  "Rapid Adopter": "Power user within the first week",
  "Quick Starter": "Hit key milestones within a month",
  "Cautious Explorer": "Took time to start, but steadily engaged",
  "Steady Builder": "Natural, healthy adoption pace",
  "Late Bloomer": "Slow start but eventually found their groove",
  "Gradual Explorer": "Extended, unhurried exploration",
  "Just Started": "Not enough activity to assess pace yet" };

const RATING_INFO: Record<string, { icon: typeof Rocket; color: string; description: string }> = {
  "Fast Adopter": { icon: Rocket, color: "text-green-800 dark:text-green-400", description: "All milestones hit within 30 days" },
  "Steady Builder": { icon: Timer, color: "text-amber-800 dark:text-amber-400", description: "Longest milestone under 90 days" },
  "Slow Burner": { icon: Target, color: "text-orange-800 dark:text-orange-400", description: "Longest milestone over 90 days" },
  "No Activity": { icon: Gauge, color: "text-muted-foreground", description: "Zero milestones achieved" } };

function classifyStage(milestones: MilestoneData[]): string {
  const has = (key: string) => milestones.find((m) => m.key === key)?.timestamp !== null;
  const hasPost = has("first_post");
  const hasReply = has("first_reply");
  const hasReaction = has("first_reaction");
  const hasRepost = has("first_repost");
  const hasZapSent = has("first_zap_sent");
  const hasZapReceived = has("first_zap_received");

  if ((hasZapSent || hasZapReceived) && hasReply && hasReaction && hasRepost && hasPost) return "fully_integrated";
  if (hasPost && hasReply && (hasReaction || hasRepost)) return "community_member";
  if (hasPost && hasReply) return "conversationalist";
  if (hasPost) return "broadcaster";
  return "observer";
}

function classifyPace(milestones: MilestoneData[]): { label: string; description: string } {
  const completed = milestones.filter((m) => m.timestamp !== null);
  if (completed.length <= 1) return { label: "Just Started", description: PACE_INFO["Just Started"] };

  const sorted = [...completed].sort((a, b) => a.timestamp! - b.timestamp!);
  const firstTs = sorted[0].timestamp!;
  const lastTs = sorted[sorted.length - 1].timestamp!;
  const totalDays = Math.round((lastTs - firstTs) / 86400);

  const accountTs = milestones.find((m) => m.key === "account")?.timestamp;
  const postTs = milestones.find((m) => m.key === "first_post")?.timestamp;
  const postDelayDays = accountTs && postTs ? Math.round((postTs - accountTs) / 86400) : null;

  if (totalDays <= 7 && completed.length >= 5) return { label: "Rapid Adopter", description: PACE_INFO["Rapid Adopter"] };
  if (totalDays <= 30 && completed.length >= 4) return { label: "Quick Starter", description: PACE_INFO["Quick Starter"] };
  if (totalDays <= 90) {
    if (postDelayDays !== null && postDelayDays > 14) return { label: "Cautious Explorer", description: PACE_INFO["Cautious Explorer"] };
    return { label: "Steady Builder", description: PACE_INFO["Steady Builder"] };
  }
  if (postDelayDays !== null && postDelayDays > 30) return { label: "Late Bloomer", description: PACE_INFO["Late Bloomer"] };
  return { label: "Gradual Explorer", description: PACE_INFO["Gradual Explorer"] };
}

function classifyRating(milestones: MilestoneData[], accountCreated: number): string {
  const completed = milestones.filter((m) => m.timestamp !== null && m.key !== "account");
  if (completed.length === 0) return "No Activity";
  const daysSince = (ts: number) => Math.max(0, Math.round((ts - accountCreated) / 86400));
  const maxDays = Math.max(...completed.map((m) => daysSince(m.timestamp!)));
  const allAchieved = completed.length >= 6;
  if (allAchieved && maxDays < 30) return "Fast Adopter";
  if (maxDays < 90) return "Steady Builder";
  return "Slow Burner";
}

function queryEvents(pubkey: string, kinds: number[], limit: number, relays: string[] = DEFAULT_RELAYS): Promise<Event[]> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    const timeout = setTimeout(() => resolve(events), 8000);
    const sub = throttledPoolSubscribe(
      relays.slice(0, 4),
      { kinds, authors: [pubkey], limit } as any,
      {
        onevent(event: Event) { events.push(event); },
        oneose() { clearTimeout(timeout); sub.close(); resolve(events); } }
    );
  });
}

async function scanUser(pubkey: string, relays: string[] = DEFAULT_RELAYS): Promise<ScanResult | null> {
  const [profiles, kind1Events, reactions, reposts, zapData] = await Promise.all([
    queryEvents(pubkey, [0], 5, relays),
    queryEvents(pubkey, [1], 100, relays),
    queryEvents(pubkey, [7], 5, relays),
    queryEvents(pubkey, [6], 5, relays),
    fetchUserZaps(pubkey, 5).catch(() => ({ sent: [] as Event[], received: [] as Event[] })),
  ]);

  if (profiles.length === 0) return null;

  const accountCreated = Math.min(...profiles.map((e) => e.created_at));

  let earliestPost: Event | null = null;
  let earliestReply: Event | null = null;
  for (const ev of kind1Events) {
    const hasETag = ev.tags.some((t) => t[0] === "e");
    if (hasETag) {
      if (!earliestReply || ev.created_at < earliestReply.created_at) earliestReply = ev;
    } else {
      if (!earliestPost || ev.created_at < earliestPost.created_at) earliestPost = ev;
    }
  }

  const earliestReaction = reactions.length > 0 ? reactions.reduce((a, b) => a.created_at < b.created_at ? a : b) : null;
  const earliestRepost = reposts.length > 0 ? reposts.reduce((a, b) => a.created_at < b.created_at ? a : b) : null;
  const earliestZapSent = zapData.sent.length > 0 ? zapData.sent.reduce((a, b) => a.created_at < b.created_at ? a : b) : null;
  const earliestZapReceived = zapData.received.length > 0 ? zapData.received.reduce((a, b) => a.created_at < b.created_at ? a : b) : null;

  const milestones: MilestoneData[] = [
    { key: "account", timestamp: accountCreated },
    { key: "first_post", timestamp: earliestPost?.created_at ?? null },
    { key: "first_reply", timestamp: earliestReply?.created_at ?? null },
    { key: "first_reaction", timestamp: earliestReaction?.created_at ?? null },
    { key: "first_repost", timestamp: earliestRepost?.created_at ?? null },
    { key: "first_zap_sent", timestamp: earliestZapSent?.created_at ?? null },
    { key: "first_zap_received", timestamp: earliestZapReceived?.created_at ?? null },
  ];

  const stage = classifyStage(milestones);
  const pace = classifyPace(milestones);
  const rating = classifyRating(milestones, accountCreated);
  const completedMs = milestones.filter((m) => m.timestamp !== null);
  const sorted = [...completedMs].sort((a, b) => a.timestamp! - b.timestamp!);
  const timeSpanDays = sorted.length >= 2
    ? Math.round((sorted[sorted.length - 1].timestamp! - sorted[0].timestamp!) / 86400)
    : null;

  return {
    pubkey,
    stage,
    stageName: STAGE_INFO[stage]?.name || stage,
    pace: pace.label,
    paceDescription: pace.description,
    rating,
    milestoneCount: completedMs.length,
    totalMilestones: milestones.length,
    timeSpanDays,
    accountCreated };
}

function sampleProfiles(count: number, relays: string[] = DEFAULT_RELAYS): Promise<string[]> {
  return new Promise((resolve) => {
    const seen = new Set<string>();
    const profiles: Event[] = [];
    const timeout = setTimeout(() => resolve(profiles.map((e) => e.pubkey)), 10000);
    const sub = throttledPoolSubscribe(
      relays.slice(0, 3),
      { kinds: [0], limit: count * 4 } as any,
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
          resolve(
            profiles
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, count)
              .map((e) => e.pubkey)
          );
        } }
    );
  });
}

function ResultCard({ result }: { result: ScanResult }) {
  const stageInfo = STAGE_INFO[result.stage];
  const ratingInfo = RATING_INFO[result.rating] || RATING_INFO["No Activity"];
  const StageIcon = stageInfo?.icon || Eye;
  const RatingIcon = ratingInfo.icon;

  return (
    <div
      className={`p-3 sm:p-4 rounded-lg border ${stageInfo?.borderColor || "border-muted/20"} ${stageInfo?.bgColor || "bg-muted/5"} space-y-2.5`}
      data-testid={`scanner-result-${result.pubkey.slice(0, 8)}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <ProfileLink pubkey={result.pubkey} className="text-sm font-medium text-foreground truncate" avatarSize="sm" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={`text-[10px] gap-1 ${stageInfo?.color || ""}`} data-testid="badge-stage">
          <StageIcon className="w-3 h-3" />
          {result.stageName}
        </Badge>
        <Badge variant="outline" className="text-[10px]" data-testid="badge-pace">
          {result.pace}
        </Badge>
        <Badge variant="outline" className={`text-[10px] gap-1 ${ratingInfo.color}`} data-testid="badge-rating">
          <RatingIcon className="w-3 h-3" />
          {result.rating}
        </Badge>
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
        <span>{result.milestoneCount}/{result.totalMilestones} milestones</span>
        {result.timeSpanDays !== null && <span>{result.timeSpanDays}d span</span>}
      </div>

      <a
        href={`/console/dashboard?pubkey=${nip19.npubEncode(result.pubkey)}`}
        className="inline-flex items-center gap-1 text-[10px] text-brand hover:underline"
        data-testid="link-full-report"
      >
        <ExternalLink className="w-2.5 h-2.5" />
        Full Report
      </a>
    </div>
  );
}

export function UserDiscoveryScanner({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [sampleSize, setSampleSize] = useState("20");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<ScanResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [stageFilter, setStageFilter] = useState("all");
  const [paceFilter, setPaceFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");

  const handleScan = useCallback(async () => {
    const size = Math.min(Math.max(parseInt(sampleSize) || 10, 5), 50);
    setError(null);
    setLoading(true);
    setResults([]);
    setProgress({ current: 0, total: size });

    try {
      const pubkeys = await sampleProfiles(size, relaysToUse);
      if (pubkeys.length === 0) {
        setError("No profiles found on relays");
        setLoading(false);
        return;
      }

      setProgress({ current: 0, total: pubkeys.length });
      const scanned: ScanResult[] = [];
      let completed = 0;

      const CONCURRENCY = 3;
      for (let i = 0; i < pubkeys.length; i += CONCURRENCY) {
        const batch = pubkeys.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(batch.map((pk) => scanUser(pk, relaysToUse)));
        for (const res of batchResults) {
          completed++;
          if (res.status === "fulfilled" && res.value) {
            scanned.push(res.value);
          }
        }
        setResults([...scanned]);
        setProgress({ current: completed, total: pubkeys.length });
      }

      if (scanned.length === 0) {
        setError("No analyzable profiles found");
      }
    } catch {
      setError("Scan failed");
    } finally {
      setLoading(false);
    }
  }, [sampleSize, relaysToUse]);

  const filteredResults = useMemo(() => {
    return results.filter((r) => {
      if (stageFilter !== "all" && r.stage !== stageFilter) return false;
      if (paceFilter !== "all" && r.pace !== paceFilter) return false;
      if (ratingFilter !== "all" && r.rating !== ratingFilter) return false;
      return true;
    });
  }, [results, stageFilter, paceFilter, ratingFilter]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.stage] = (counts[r.stage] || 0) + 1;
    return counts;
  }, [results]);

  const paceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.pace] = (counts[r.pace] || 0) + 1;
    return counts;
  }, [results]);

  const ratingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.rating] = (counts[r.rating] || 0) + 1;
    return counts;
  }, [results]);

  return (
    <div className="overflow-hidden" data-testid="user-discovery-scanner">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Search className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-display text-brand">
            User Discovery Scanner
          </h2>
        </div>

        <p className="text-xs text-muted-foreground/60">
          Sample recent Nostr profiles and classify them by adoption stage, pace, and engagement rating. Results appear as each user is scanned.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="scanner-size" className="text-xs text-muted-foreground whitespace-nowrap">
              Sample Size
            </Label>
            <Input
              id="scanner-size"
              type="number"
              min={5}
              max={50}
              value={sampleSize}
              onChange={(e) => setSampleSize(e.target.value)}
              className="w-20 bg-brand/5 border-brand/10 text-sm"
              style={{ fontSize: "16px" }}
              data-testid="input-sample-size"
            />
          </div>
          <Button
            onClick={handleScan}
            disabled={loading}
            data-testid="button-scan"
          >
            {loading ? <RelayOutpostInlineLoader className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
            {loading ? `Scanning ${progress.current}/${progress.total}...` : "Scan Profiles"}
          </Button>
        </div>

        {loading && (
          <div className="space-y-2">
            <div className="w-full h-1.5 rounded-full bg-brand/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground/50">
              Analyzing user {progress.current} of {progress.total}...
            </p>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" data-testid="text-error">{error}</p>
        )}

        {results.length > 0 && (
          <>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-wrap" data-testid="scanner-filters">
              <div className="flex items-center gap-1.5">
                <Filter className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                <span className="text-[10px] text-muted-foreground/50 font-brand uppercase tracking-widest shrink-0">Filters</span>
              </div>

              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs" data-testid="select-stage-filter">
                  <SelectValue placeholder="Stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  {Object.entries(STAGE_INFO).map(([key, info]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex flex-col">
                        <span>{info.name} {stageCounts[key] ? `(${stageCounts[key]})` : ""}</span>
                        <span className="text-[10px] text-muted-foreground">{info.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={paceFilter} onValueChange={setPaceFilter}>
                <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs" data-testid="select-pace-filter">
                  <SelectValue placeholder="Pace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Paces</SelectItem>
                  {Object.entries(PACE_INFO).map(([label, desc]) => (
                    <SelectItem key={label} value={label}>
                      <div className="flex flex-col">
                        <span>{label} {paceCounts[label] ? `(${paceCounts[label]})` : ""}</span>
                        <span className="text-[10px] text-muted-foreground">{desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={ratingFilter} onValueChange={setRatingFilter}>
                <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs" data-testid="select-rating-filter">
                  <SelectValue placeholder="Rating" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Ratings</SelectItem>
                  {Object.entries(RATING_INFO).map(([label, info]) => (
                    <SelectItem key={label} value={label}>
                      <div className="flex flex-col">
                        <span>{label} {ratingCounts[label] ? `(${ratingCounts[label]})` : ""}</span>
                        <span className="text-[10px] text-muted-foreground">{info.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground/60">
              <span data-testid="text-result-count">
                Showing {filteredResults.length} of {results.length} profiles
              </span>
              {(stageFilter !== "all" || paceFilter !== "all" || ratingFilter !== "all") && (
                <button
                  onClick={() => { setStageFilter("all"); setPaceFilter("all"); setRatingFilter("all"); }}
                  className="text-brand hover:underline text-[10px]"
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="hidden md:block overflow-x-auto" data-testid="scanner-table">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-brand/10">
                    <th className="text-left py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">User</th>
                    <th className="text-left py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Stage</th>
                    <th className="text-left py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Pace</th>
                    <th className="text-left py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Rating</th>
                    <th className="text-center py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Milestones</th>
                    <th className="text-center py-2 px-2 text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Span</th>
                    <th className="text-right py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r) => {
                    const stageInfo = STAGE_INFO[r.stage];
                    const ratingInfo = RATING_INFO[r.rating] || RATING_INFO["No Activity"];
                    const StageIcon = stageInfo?.icon || Eye;
                    const RatingIcon = ratingInfo.icon;
                    return (
                      <tr
                        key={r.pubkey}
                        className="border-b border-brand/5 hover:bg-brand/5 transition-colors"
                        data-testid={`table-row-${r.pubkey.slice(0, 8)}`}
                      >
                        <td className="py-2.5 px-2">
                          <ProfileLink pubkey={r.pubkey} className="text-xs font-medium text-foreground" avatarSize="sm" />
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge variant="outline" className={`text-[10px] gap-1 ${stageInfo?.color || ""}`}>
                            <StageIcon className="w-3 h-3" />
                            {r.stageName}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge variant="outline" className="text-[10px]">{r.pace}</Badge>
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge variant="outline" className={`text-[10px] gap-1 ${ratingInfo.color}`}>
                            <RatingIcon className="w-3 h-3" />
                            {r.rating}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-2 text-center text-muted-foreground">
                          {r.milestoneCount}/{r.totalMilestones}
                        </td>
                        <td className="py-2.5 px-2 text-center text-muted-foreground">
                          {r.timeSpanDays !== null ? `${r.timeSpanDays}d` : "—"}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <a
                            href={`/console/dashboard?pubkey=${nip19.npubEncode(r.pubkey)}`}
                            className="inline-flex items-center gap-1 text-[10px] text-brand hover:underline"
                            data-testid={`link-report-${r.pubkey.slice(0, 8)}`}
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                            Report
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden grid grid-cols-1 gap-2" data-testid="scanner-cards">
              {filteredResults.map((r) => (
                <ResultCard key={r.pubkey} result={r} />
              ))}
            </div>

            {filteredResults.length === 0 && results.length > 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground/50" data-testid="no-filter-results">
                No profiles match the selected filters. Try adjusting your criteria.
              </div>
            )}
          </>
        )}

        {!loading && results.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-8 gap-2" data-testid="scanner-empty">
            <Search className="w-8 h-8 text-brand/20" />
            <p className="text-xs text-muted-foreground/50">
              Click "Scan Profiles" to discover and classify recent Nostr users
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
