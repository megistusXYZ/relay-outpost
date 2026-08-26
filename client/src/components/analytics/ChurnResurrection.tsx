import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import {
  BarChart,
  Bar,
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
  UserMinus,
  UserPlus,
  Users,
  Play,
  AlertTriangle,
  RefreshCw,
  TrendingDown,
  TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ProfileLink } from "@/components/analytics/ProfileLink";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = ["#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd"];
const CHURN_COLOR = "#ef4444";
const RESURRECTION_COLOR = "#22c55e";

const KIND_LABELS: Record<number, string> = {
  0: "Profile",
  1: "Text Note",
  6: "Repost",
  7: "Reaction",
  20: "Picture",
  21: "Video",
  1111: "Comment",
  9735: "Zap",
  10003: "Bookmark",
  30023: "Long-form" };

function getKindLabel(kind: number): string {
  return KIND_LABELS[kind] || `Kind ${kind}`;
}

function shortenNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return npub.slice(0, 12) + "..." + npub.slice(-6);
  } catch {
    return pubkey.slice(0, 8) + "..." + pubkey.slice(-6);
  }
}

interface UserClassification {
  pubkey: string;
  status: "churned" | "resurrected" | "active";
  lastSeen: number;
  firstRecentEvent?: Event;
}

interface WeeklyData {
  week: string;
  churned: number;
  resurrected: number;
}

interface TriggerData {
  name: string;
  value: number;
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

function PieTooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{payload[0]?.name}</p>
      <p className="text-foreground">
        Count: <span className="text-brand font-mono">{Number(payload[0]?.value).toLocaleString()}</span>
      </p>
    </div>
  );
}

export function ChurnResurrection({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [analysisWindow, setAnalysisWindow] = useState("60");
  const [inactivityThreshold, setInactivityThreshold] = useState("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classifications, setClassifications] = useState<UserClassification[]>([]);
  const [weeklyData, setWeeklyData] = useState<WeeklyData[]>([]);
  const [triggerData, setTriggerData] = useState<TriggerData[]>([]);
  const [hasRun, setHasRun] = useState(false);

  const stats = useMemo(() => {
    const churned = classifications.filter((c) => c.status === "churned");
    const resurrected = classifications.filter((c) => c.status === "resurrected");
    const active = classifications.filter((c) => c.status === "active");
    const total = classifications.length;
    const churnRate = total > 0 ? ((churned.length / total) * 100).toFixed(1) : "0.0";
    return {
      churnedCount: churned.length,
      resurrectedCount: resurrected.length,
      activeCount: active.length,
      churnRate,
      churned,
      resurrected };
  }, [classifications]);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    setClassifications([]);
    setWeeklyData([]);
    setTriggerData([]);

    try {
      const now = Math.floor(Date.now() / 1000);
      const windowDays = parseInt(analysisWindow, 10);
      const thresholdDays = parseInt(inactivityThreshold, 10);
      const windowSeconds = windowDays * 86400;
      const thresholdSeconds = thresholdDays * 86400;

      const periodStart = now - windowSeconds;

      const profiles = await new Promise<Event[]>((resolve) => {
        const collected: Event[] = [];
        const sub = throttledPoolSubscribe(
          relaysToUse.slice(0, 4),
          { kinds: [0], since: periodStart, limit: 200 },
          {
            onevent(event: Event) {
              collected.push(event);
            },
            oneose() {
              sub.close();
              resolve(collected);
            } }
        );
        setTimeout(() => {
          try { sub.close(); } catch {}
          resolve(collected);
        }, 15000);
      });

      const uniquePubkeys = Array.from(new Set(profiles.map((p) => p.pubkey)));
      const sampledPubkeys = uniquePubkeys.slice(0, 100);

      if (sampledPubkeys.length === 0) {
        setError("No users found in the analysis window. Try a larger window.");
        setLoading(false);
        setHasRun(true);
        return;
      }

      const recentStart = now - thresholdSeconds;
      const olderStart = periodStart;
      const olderEnd = recentStart;

      const fetchEventsForPeriod = (pubkeys: string[], since: number, until: number): Promise<Event[]> => {
        return new Promise((resolve) => {
          const events: Event[] = [];
          const chunks: string[][] = [];
          for (let i = 0; i < pubkeys.length; i += 50) {
            chunks.push(pubkeys.slice(i, i + 50));
          }
          let completed = 0;
          if (chunks.length === 0) { resolve([]); return; }
          for (const chunk of chunks) {
            const sub = throttledPoolSubscribe(
              relaysToUse.slice(0, 4),
              { authors: chunk, since, until, limit: 500 },
              {
                onevent(event: Event) {
                  events.push(event);
                },
                oneose() {
                  sub.close();
                  completed++;
                  if (completed >= chunks.length) resolve(events);
                } }
            );
            setTimeout(() => {
              try { sub.close(); } catch {}
              completed++;
              if (completed >= chunks.length) resolve(events);
            }, 12000);
          }
        });
      };

      const [olderEvents, recentEvents] = await Promise.all([
        fetchEventsForPeriod(sampledPubkeys, olderStart, olderEnd),
        fetchEventsForPeriod(sampledPubkeys, recentStart, now),
      ]);

      const olderAuthors = new Set(olderEvents.map((e) => e.pubkey));
      const recentAuthors = new Set(recentEvents.map((e) => e.pubkey));

      const recentByAuthor = new Map<string, Event[]>();
      for (const e of recentEvents) {
        const list = recentByAuthor.get(e.pubkey) || [];
        list.push(e);
        recentByAuthor.set(e.pubkey, list);
      }

      const olderByAuthor = new Map<string, number>();
      for (const e of olderEvents) {
        const current = olderByAuthor.get(e.pubkey) || 0;
        olderByAuthor.set(e.pubkey, Math.max(current, e.created_at));
      }

      const results: UserClassification[] = [];

      for (const pubkey of sampledPubkeys) {
        const hadOlderActivity = olderAuthors.has(pubkey);
        const hasRecentActivity = recentAuthors.has(pubkey);

        if (hadOlderActivity && !hasRecentActivity) {
          const lastSeen = olderByAuthor.get(pubkey) || olderEnd;
          results.push({ pubkey, status: "churned", lastSeen });
        } else if (hadOlderActivity && hasRecentActivity) {
          const authorRecentEvents = recentByAuthor.get(pubkey) || [];
          const lastOlderTs = olderByAuthor.get(pubkey) || olderEnd;
          const firstRecent = authorRecentEvents.sort((a, b) => a.created_at - b.created_at)[0];
          const gap = firstRecent ? firstRecent.created_at - lastOlderTs : 0;

          if (gap > thresholdSeconds * 0.5) {
            results.push({
              pubkey,
              status: "resurrected",
              lastSeen: firstRecent?.created_at || now,
              firstRecentEvent: firstRecent });
          } else {
            results.push({
              pubkey,
              status: "active",
              lastSeen: authorRecentEvents[authorRecentEvents.length - 1]?.created_at || now });
          }
        } else if (!hadOlderActivity && hasRecentActivity) {
          results.push({
            pubkey,
            status: "active",
            lastSeen: (recentByAuthor.get(pubkey) || [])[0]?.created_at || now });
        }
      }

      setClassifications(results);

      const weekMap = new Map<string, { churned: number; resurrected: number }>();
      const weekMs = 7 * 86400 * 1000;
      const startMs = periodStart * 1000;
      const nowMs = now * 1000;

      for (let t = startMs; t < nowMs; t += weekMs) {
        const d = new Date(t);
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        weekMap.set(label, { churned: 0, resurrected: 0 });
      }

      const getWeekLabel = (ts: number) => {
        const ms = ts * 1000;
        const weekIndex = Math.floor((ms - startMs) / weekMs);
        const weekStart = new Date(startMs + weekIndex * weekMs);
        return `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
      };

      for (const r of results) {
        const label = getWeekLabel(r.lastSeen);
        const entry = weekMap.get(label);
        if (entry) {
          if (r.status === "churned") entry.churned++;
          else if (r.status === "resurrected") entry.resurrected++;
        }
      }

      setWeeklyData(
        Array.from(weekMap.entries()).map(([week, data]) => ({
          week,
          churned: data.churned,
          resurrected: data.resurrected }))
      );

      const triggerMap = new Map<string, number>();
      for (const r of results) {
        if (r.status === "resurrected" && r.firstRecentEvent) {
          const kindLabel = getKindLabel(r.firstRecentEvent.kind);
          triggerMap.set(kindLabel, (triggerMap.get(kindLabel) || 0) + 1);
        }
      }
      setTriggerData(
        Array.from(triggerMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
      );

      setHasRun(true);
    } catch (err: any) {
      setError(err?.message || "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [analysisWindow, inactivityThreshold, relaysToUse]);

  return (
    <div className="space-y-4" data-testid="churn-resurrection">
      <div className="overflow-visible" data-testid="churn-controls">
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Users className="w-4 h-4 text-brand" />
            <h2 className="text-sm font-display text-brand">Churn & Resurrection Detector</h2>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                Analysis Window
              </Label>
              <Select value={analysisWindow} onValueChange={setAnalysisWindow} data-testid="select-analysis-window">
                <SelectTrigger className="w-[120px]" data-testid="trigger-analysis-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30" data-testid="option-window-30d">30 days</SelectItem>
                  <SelectItem value="60" data-testid="option-window-60d">60 days</SelectItem>
                  <SelectItem value="90" data-testid="option-window-90d">90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                Inactivity Threshold
              </Label>
              <Select value={inactivityThreshold} onValueChange={setInactivityThreshold} data-testid="select-inactivity-threshold">
                <SelectTrigger className="w-[120px]" data-testid="trigger-inactivity-threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="14" data-testid="option-threshold-14d">14 days</SelectItem>
                  <SelectItem value="30" data-testid="option-threshold-30d">30 days</SelectItem>
                  <SelectItem value="60" data-testid="option-threshold-60d">60 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={runAnalysis}
              disabled={loading}
              data-testid="button-run-analysis"
            >
              {loading ? (
                <RelayOutpostInlineLoader className="w-4 h-4" />
              ) : hasRun ? (
                <RefreshCw className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span className="ml-1.5">{loading ? "Analyzing..." : hasRun ? "Re-run" : "Run Analysis"}</span>
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400" data-testid="text-error">
              <AlertTriangle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}
        </div>
      </div>

      {hasRun && !loading && classifications.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="summary-cards">
            <Card className="glass-card overflow-visible" data-testid="card-churned">
              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5">
                  <UserMinus className="w-3.5 h-3.5 text-red-700 dark:text-red-400" />
                  <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Churned</p>
                </div>
                <p className="text-xl font-mono text-red-700 dark:text-red-400" data-testid="text-churned-count">
                  {stats.churnedCount}
                </p>
              </div>
            </Card>

            <Card className="glass-card overflow-visible" data-testid="card-resurrected">
              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-green-800 dark:text-green-400" />
                  <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Resurrected</p>
                </div>
                <p className="text-xl font-mono text-green-800 dark:text-green-400" data-testid="text-resurrected-count">
                  {stats.resurrectedCount}
                </p>
              </div>
            </Card>

            <Card className="glass-card overflow-visible" data-testid="card-churn-rate">
              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5 text-brand" />
                  <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Churn Rate</p>
                </div>
                <p className="text-xl font-mono text-brand" data-testid="text-churn-rate">
                  {stats.churnRate}%
                </p>
              </div>
            </Card>

            <Card className="glass-card overflow-visible" data-testid="card-active">
              <div className="p-4 space-y-1">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-brand" />
                  <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Active</p>
                </div>
                <p className="text-xl font-mono text-foreground" data-testid="text-active-count">
                  {stats.activeCount}
                </p>
              </div>
            </Card>
          </div>

          {weeklyData.length > 0 && (
            <Card className="glass-card overflow-visible" data-testid="chart-weekly">
              <div className="p-4 sm:p-6 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-display text-brand">Churn vs Resurrection by Week</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.1)" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltipContent />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    <Bar dataKey="churned" name="Churned" fill={CHURN_COLOR} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="resurrected" name="Resurrected" fill={RESURRECTION_COLOR} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {triggerData.length > 0 && (
            <Card className="glass-card overflow-visible" data-testid="chart-triggers">
              <div className="p-4 sm:p-6 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-display text-brand">Resurrection Triggers</h3>
                  <Badge variant="secondary" data-testid="badge-trigger-count">
                    {triggerData.length} types
                  </Badge>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={triggerData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        {triggerData.map((_entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltipContent />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 min-w-[140px]">
                    {triggerData.map((t, i) => (
                      <div key={t.name} className="flex items-center gap-2 text-xs" data-testid={`trigger-item-${i}`}>
                        <span
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <span className="text-foreground truncate flex-1">{t.name}</span>
                        <span className="font-mono text-brand">{t.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="glass-card overflow-visible" data-testid="list-churned">
              <div className="p-4 sm:p-6 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <UserMinus className="w-3.5 h-3.5 text-red-700 dark:text-red-400" />
                  <h3 className="text-sm font-display text-brand">Recently Churned</h3>
                  <Badge variant="secondary" data-testid="badge-churned-count">
                    {stats.churnedCount}
                  </Badge>
                </div>
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                  {stats.churned.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50" data-testid="text-no-churned">No churned users detected</p>
                  ) : (
                    stats.churned.slice(0, 20).map((user, i) => (
                      <div
                        key={user.pubkey}
                        className="flex items-center gap-2 p-2 rounded-lg bg-brand/5 border border-brand/10 text-xs"
                        data-testid={`churned-user-${i}`}
                      >
                        <span className="text-muted-foreground/40 w-4 text-right font-mono">{i + 1}</span>
                        <ProfileLink pubkey={user.pubkey} className="text-foreground truncate flex-1" />
                        <span className="text-muted-foreground/50">
                          {new Date(user.lastSeen * 1000).toLocaleDateString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>

            <Card className="glass-card overflow-visible" data-testid="list-resurrected">
              <div className="p-4 sm:p-6 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <UserPlus className="w-3.5 h-3.5 text-green-800 dark:text-green-400" />
                  <h3 className="text-sm font-display text-brand">Recently Resurrected</h3>
                  <Badge variant="secondary" data-testid="badge-resurrected-count">
                    {stats.resurrectedCount}
                  </Badge>
                </div>
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                  {stats.resurrected.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50" data-testid="text-no-resurrected">No resurrected users detected</p>
                  ) : (
                    stats.resurrected.slice(0, 20).map((user, i) => (
                      <div
                        key={user.pubkey}
                        className="flex items-center gap-2 p-2 rounded-lg bg-brand/5 border border-brand/10 text-xs"
                        data-testid={`resurrected-user-${i}`}
                      >
                        <span className="text-muted-foreground/40 w-4 text-right font-mono">{i + 1}</span>
                        <ProfileLink pubkey={user.pubkey} className="text-foreground truncate flex-1" />
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {user.firstRecentEvent && (
                            <Badge variant="secondary" data-testid={`trigger-badge-${i}`}>
                              {getKindLabel(user.firstRecentEvent.kind)}
                            </Badge>
                          )}
                          <span className="text-muted-foreground/50">
                            {new Date(user.lastSeen * 1000).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>
        </>
      )}

      {hasRun && !loading && classifications.length === 0 && !error && (
        <Card className="glass-card overflow-visible" data-testid="empty-state">
          <div className="p-6 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 text-brand dark:text-brand/50 mx-auto" />
            <p className="text-sm text-muted-foreground">No data found. Try adjusting the analysis window or inactivity threshold.</p>
          </div>
        </Card>
      )}

      {!hasRun && !loading && (
        <Card className="glass-card overflow-visible" data-testid="initial-state">
          <div className="p-6 text-center space-y-2">
            <Users className="w-8 h-8 text-brand dark:text-brand/50 mx-auto" />
            <p className="text-sm text-muted-foreground">Configure your analysis parameters and click Run Analysis to detect churn and resurrection patterns.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
