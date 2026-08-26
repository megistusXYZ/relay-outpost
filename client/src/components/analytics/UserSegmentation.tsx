import { useState, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend } from "recharts";
import {
  Users,
  Crown,
  Star,
  Coffee,
  Eye,
  Play,
  ChevronDown,
  ChevronUp } from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ProfileLink } from "@/components/analytics/ProfileLink";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger } from "@/components/ui/collapsible";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = ["#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd"];

type TierName = "Lurker" | "Casual" | "Active" | "Power User" | "Influencer";

const TIER_CONFIG: Record<TierName, { color: string; icon: typeof Users }> = {
  Lurker: { color: "#64748b", icon: Eye },
  Casual: { color: "#a78bfa", icon: Coffee },
  Active: { color: "#7c3aed", icon: Star },
  "Power User": { color: "#8b5cf6", icon: Users },
  Influencer: { color: "#f59e0b", icon: Crown } };

const TIER_ORDER: TierName[] = ["Lurker", "Casual", "Active", "Power User", "Influencer"];

interface UserProfile {
  pubkey: string;
  displayName: string;
  picture: string;
  nip05: string;
  about: string;
}

interface ClassifiedUser {
  pubkey: string;
  tier: TierName;
  eventCount: number;
  kindCounts: Record<number, number>;
  profile: UserProfile;
}

function shortenNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return npub.slice(0, 12) + "..." + npub.slice(-6);
  } catch {
    return pubkey.slice(0, 8) + "..." + pubkey.slice(-6);
  }
}

function classifyUser(eventCount: number, kindCounts: Record<number, number>): TierName {
  const hasZaps = (kindCounts[9735] || 0) > 0;
  const kindTypes = Object.keys(kindCounts).filter((k) => (kindCounts[Number(k)] || 0) > 0).length;
  const hasHighEngagement = kindTypes >= 3 && eventCount > 100;

  if (hasHighEngagement) return "Influencer";
  if (eventCount > 100 || hasZaps) return "Power User";
  if (eventCount >= 21) return "Active";
  if (eventCount >= 3) return "Casual";
  return "Lurker";
}

function safeStr(val: unknown): string {
  return typeof val === "string" ? val : "";
}

function parseProfile(event: Event): Omit<UserProfile, "pubkey"> {
  try {
    const content = JSON.parse(event.content);
    return {
      displayName: safeStr(content.display_name) || safeStr(content.name),
      picture: safeStr(content.picture),
      nip05: safeStr(content.nip05),
      about: safeStr(content.about) };
  } catch {
    return { displayName: "", picture: "", nip05: "", about: "" };
  }
}

function CustomTooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{payload[0]?.name}</p>
      <p className="text-foreground">
        Count: <span className="text-brand font-mono">{Number(payload[0]?.value).toLocaleString()}</span>
      </p>
      {payload[0]?.payload?.percent != null && (
        <p className="text-muted-foreground">
          Share: <span className="text-brand font-mono">{payload[0].payload.percent}%</span>
        </p>
      )}
    </div>
  );
}

export function UserSegmentation({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [timeRange, setTimeRange] = useState("30");
  const [sampleSize, setSampleSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [classifiedUsers, setClassifiedUsers] = useState<ClassifiedUser[]>([]);
  const [activeTier, setActiveTier] = useState<TierName | null>(null);
  const [selectedUser, setSelectedUser] = useState<ClassifiedUser | null>(null);
  const [expandedTiers, setExpandedTiers] = useState<Set<TierName>>(new Set());
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});

  const timeRangeDays = useMemo(() => parseInt(timeRange, 10), [timeRange]);

  const runSegmentation = useCallback(async () => {
    setLoading(true);
    setProgress("Fetching profiles...");
    setClassifiedUsers([]);
    setSelectedUser(null);

    const since = Math.floor(Date.now() / 1000) - timeRangeDays * 86400;

    try {
      const profileEvents: Event[] = [];
      await new Promise<void>((resolve) => {
        const sub = throttledPoolSubscribe(
          relaysToUse.slice(0, 4),
          { kinds: [0], since, limit: 500 },
          {
            onevent(event: Event) {
              profileEvents.push(event);
            },
            oneose() {
              sub.close();
              resolve();
            } }
        );
        setTimeout(() => {
          try { sub.close(); } catch {}
          resolve();
        }, 15000);
      });

      const uniqueProfiles = new Map<string, Event>();
      for (const ev of profileEvents) {
        const existing = uniqueProfiles.get(ev.pubkey);
        if (!existing || ev.created_at > existing.created_at) {
          uniqueProfiles.set(ev.pubkey, ev);
        }
      }

      const allPubkeys = Array.from(uniqueProfiles.keys());
      const shuffled = allPubkeys.sort(() => Math.random() - 0.5);
      const sampledPubkeys = shuffled.slice(0, Math.min(sampleSize, shuffled.length));

      setProgress(`Analyzing ${sampledPubkeys.length} users...`);

      const profileMap = new Map<string, UserProfile>();
      for (const pk of sampledPubkeys) {
        const ev = uniqueProfiles.get(pk);
        if (ev) {
          const parsed = parseProfile(ev);
          profileMap.set(pk, {
            pubkey: pk,
            displayName: parsed.displayName || shortenNpub(pk),
            picture: parsed.picture,
            nip05: parsed.nip05,
            about: parsed.about });
        } else {
          profileMap.set(pk, {
            pubkey: pk,
            displayName: shortenNpub(pk),
            picture: "",
            nip05: "",
            about: "" });
        }
      }

      const eventCounts = new Map<string, Record<number, number>>();
      for (const pk of sampledPubkeys) {
        eventCounts.set(pk, {});
      }

      const BATCH_SIZE = 20;
      for (let i = 0; i < sampledPubkeys.length; i += BATCH_SIZE) {
        const batch = sampledPubkeys.slice(i, i + BATCH_SIZE);
        setProgress(`Querying events... ${Math.min(i + BATCH_SIZE, sampledPubkeys.length)}/${sampledPubkeys.length}`);

        await new Promise<void>((resolve) => {
          const sub = throttledPoolSubscribe(
            relaysToUse.slice(0, 4),
            { kinds: [1, 6, 7, 9735], authors: batch, since, limit: 200 },
            {
              onevent(event: Event) {
                const counts = eventCounts.get(event.pubkey);
                if (counts) {
                  counts[event.kind] = (counts[event.kind] || 0) + 1;
                }
              },
              oneose() {
                sub.close();
                resolve();
              } }
          );
          setTimeout(() => {
            try { sub.close(); } catch {}
            resolve();
          }, 12000);
        });
      }

      const results: ClassifiedUser[] = [];
      for (const pk of sampledPubkeys) {
        const kindCounts = eventCounts.get(pk) || {};
        const totalEvents = Object.values(kindCounts).reduce((a, b) => a + b, 0);
        const tier = classifyUser(totalEvents, kindCounts);
        const profile = profileMap.get(pk) || {
          pubkey: pk,
          displayName: shortenNpub(pk),
          picture: "",
          nip05: "",
          about: "" };
        results.push({ pubkey: pk, tier, eventCount: totalEvents, kindCounts, profile });
      }

      results.sort((a, b) => b.eventCount - a.eventCount);
      setClassifiedUsers(results);
      setProgress("");
    } catch (err) {
      console.error("Segmentation error:", err);
      setProgress("Error during analysis");
    } finally {
      setLoading(false);
    }
  }, [timeRangeDays, sampleSize, relaysToUse]);

  const tierDistribution = useMemo(() => {
    if (classifiedUsers.length === 0) return [];
    const counts = new Map<TierName, number>();
    for (const u of classifiedUsers) {
      counts.set(u.tier, (counts.get(u.tier) || 0) + 1);
    }
    const total = classifiedUsers.length;
    return TIER_ORDER.map((tier) => {
      const count = counts.get(tier) || 0;
      return {
        name: tier,
        value: count,
        percent: total > 0 ? ((count / total) * 100).toFixed(1) : "0",
        fill: TIER_CONFIG[tier].color };
    }).filter((d) => d.value > 0);
  }, [classifiedUsers]);

  const usersByTier = useMemo(() => {
    const grouped = new Map<TierName, ClassifiedUser[]>();
    for (const tier of TIER_ORDER) {
      grouped.set(tier, []);
    }
    for (const u of classifiedUsers) {
      grouped.get(u.tier)?.push(u);
    }
    return grouped;
  }, [classifiedUsers]);

  const USERS_PER_PAGE = 20;

  const toggleTier = useCallback((tier: TierName) => {
    setExpandedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) {
        next.delete(tier);
      } else {
        next.add(tier);
        setVisibleCounts((vc) => ({ ...vc, [tier]: USERS_PER_PAGE }));
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-4" data-testid="user-segmentation">
      <div className="overflow-visible" data-testid="segmentation-controls">
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Users className="w-4 h-4 text-brand" />
            <h2 className="text-sm font-display text-brand">User Segmentation</h2>
            <Badge variant="secondary" data-testid="badge-sample-size">
              Sample: {sampleSize}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground" data-testid="label-time-range">
                Time Range
              </Label>
              <Select value={timeRange} onValueChange={setTimeRange} data-testid="select-time-range">
                <SelectTrigger data-testid="select-trigger-time-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30" data-testid="select-item-30d">30 days</SelectItem>
                  <SelectItem value="90" data-testid="select-item-90d">90 days</SelectItem>
                  <SelectItem value="180" data-testid="select-item-180d">180 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground" data-testid="label-sample-size">
                Sample Size: {sampleSize}
              </Label>
              <Slider
                min={20}
                max={200}
                step={10}
                value={[sampleSize]}
                onValueChange={(v) => setSampleSize(v[0])}
                data-testid="slider-sample-size"
              />
            </div>

            <Button
              onClick={runSegmentation}
              disabled={loading}
              data-testid="button-run-segmentation"
            >
              {loading ? (
                <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {loading ? "Analyzing..." : "Run Analysis"}
            </Button>
          </div>

          {progress && (
            <p className="text-xs text-muted-foreground font-mono" data-testid="text-progress">
              {progress}
            </p>
          )}
        </div>
      </div>

      {tierDistribution.length > 0 && (
        <div className="overflow-visible" data-testid="segmentation-chart">
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Star className="w-4 h-4 text-brand" />
              <h3 className="text-sm font-display text-brand">Tier Distribution</h3>
              <Badge variant="secondary" data-testid="badge-total-users">
                {classifiedUsers.length} users
              </Badge>
            </div>

            <div data-testid="pie-chart-container">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={tierDistribution}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={50}
                    dataKey="value"
                    nameKey="name"
                    paddingAngle={2}
                    data-testid="pie-chart"
                  >
                    {tierDistribution.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={entry.fill}
                        stroke="rgba(0,0,0,0.3)"
                        strokeWidth={1}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltipContent />} />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs text-foreground">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {TIER_ORDER.map((tier) => {
                const data = tierDistribution.find((d) => d.name === tier);
                const TierIcon = TIER_CONFIG[tier].icon;
                return (
                  <div
                    key={tier}
                    className="p-2.5 rounded-lg bg-brand/5 border border-brand/10 space-y-1 text-center"
                    data-testid={`stat-tier-${tier.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <TierIcon
                      className="w-3.5 h-3.5 mx-auto"
                      style={{ color: TIER_CONFIG[tier].color }}
                    />
                    <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">
                      {tier}
                    </p>
                    <p className="text-sm font-mono text-foreground">
                      {data?.value || 0}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {data?.percent || "0"}%
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {classifiedUsers.length > 0 && (
        <div className="space-y-2" data-testid="tier-user-lists">
          {TIER_ORDER.map((tier) => {
            const users = usersByTier.get(tier) || [];
            if (users.length === 0) return null;
            const TierIcon = TIER_CONFIG[tier].icon;
            const isExpanded = expandedTiers.has(tier);

            return (
              <Card key={tier} className="glass-card overflow-visible" data-testid={`tier-card-${tier.toLowerCase().replace(/\s/g, "-")}`}>
                <Collapsible open={isExpanded} onOpenChange={() => toggleTier(tier)}>
                  <CollapsibleTrigger asChild>
                    <button
                      className="w-full flex items-center gap-2 p-3 sm:p-4 text-left hover-elevate rounded-md"
                      data-testid={`trigger-tier-${tier.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      <TierIcon
                        className="w-4 h-4 flex-shrink-0"
                        style={{ color: TIER_CONFIG[tier].color }}
                      />
                      <span className="text-sm font-display text-foreground flex-1">{tier}</span>
                      <Badge variant="secondary" data-testid={`badge-tier-count-${tier.toLowerCase().replace(/\s/g, "-")}`}>
                        {users.length}
                      </Badge>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 pb-3 sm:px-4 sm:pb-4 space-y-1">
                      {(() => {
                        const limit = visibleCounts[tier] || USERS_PER_PAGE;
                        const visible = users.slice(0, limit);
                        const remaining = users.length - limit;
                        return (
                          <>
                            {visible.map((user) => (
                              <button
                                key={user.pubkey}
                                onClick={() => setSelectedUser(selectedUser?.pubkey === user.pubkey ? null : user)}
                                className="w-full flex items-center gap-3 p-2 rounded-lg hover-elevate text-left"
                                data-testid={`user-row-${user.pubkey.slice(0, 8)}`}
                              >
                                <Avatar className="w-8 h-8 border border-brand/20 flex-shrink-0">
                                  {user.profile.picture && (
                                    <AvatarImage src={user.profile.picture} alt={user.profile.displayName} />
                                  )}
                                  <AvatarFallback className="bg-brand/10 text-brand text-[10px]">
                                    {user.profile.displayName.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <ProfileLink pubkey={user.pubkey} displayName={user.profile.displayName !== shortenNpub(user.pubkey) ? user.profile.displayName : undefined} className="text-xs text-foreground" showAvatar={false} />
                                  {user.profile.nip05 && (
                                    <p className="text-[10px] text-muted-foreground truncate">
                                      {user.profile.nip05}
                                    </p>
                                  )}
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-xs font-mono text-brand">
                                    {user.eventCount}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">events</p>
                                </div>
                              </button>
                            ))}
                            {remaining > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full mt-1"
                                onClick={() => setVisibleCounts((vc) => ({ ...vc, [tier]: limit + USERS_PER_PAGE }))}
                                data-testid={`button-show-more-${tier.toLowerCase().replace(/\s/g, "-")}`}
                              >
                                Show {Math.min(remaining, USERS_PER_PAGE)} more ({remaining} remaining)
                              </Button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {selectedUser && (
        <div className="overflow-visible" data-testid="user-detail-panel">
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Avatar className="w-12 h-12 border-2 border-brand/30 flex-shrink-0">
                {selectedUser.profile.picture && (
                  <AvatarImage src={selectedUser.profile.picture} alt={selectedUser.profile.displayName} />
                )}
                <AvatarFallback className="bg-brand/10 text-brand text-sm">
                  {selectedUser.profile.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 space-y-0.5">
                <ProfileLink pubkey={selectedUser.pubkey} displayName={selectedUser.profile.displayName !== shortenNpub(selectedUser.pubkey) ? selectedUser.profile.displayName : undefined} className="text-sm font-medium text-foreground" showAvatar={false} />
                {selectedUser.profile.nip05 && (
                  <p className="text-xs text-brand/70 font-mono truncate" data-testid="detail-nip05">
                    {selectedUser.profile.nip05}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/50 font-mono truncate" data-testid="detail-npub">
                  {shortenNpub(selectedUser.pubkey)}
                </p>
              </div>
              <Badge
                style={{ backgroundColor: TIER_CONFIG[selectedUser.tier].color, color: "#fff" }}
                data-testid="detail-tier-badge"
              >
                {selectedUser.tier}
              </Badge>
            </div>

            {selectedUser.profile.about && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3" data-testid="detail-about">
                {selectedUser.profile.about}
              </p>
            )}

            <div className="space-y-2">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                Event Breakdown
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { kind: 1, label: "Notes" },
                  { kind: 6, label: "Reposts" },
                  { kind: 7, label: "Reactions" },
                  { kind: 9735, label: "Zaps" },
                ].map(({ kind, label }) => (
                  <div
                    key={kind}
                    className="p-2 rounded-lg bg-brand/5 border border-brand/10 space-y-0.5 text-center"
                    data-testid={`detail-kind-${kind}`}
                  >
                    <p className="text-[9px] font-brand uppercase tracking-widest text-muted-foreground/50">
                      {label}
                    </p>
                    <p className="text-sm font-mono text-foreground">
                      {selectedUser.kindCounts[kind] || 0}
                    </p>
                  </div>
                ))}
              </div>
              <div className="p-2.5 rounded-lg bg-brand/5 border border-brand/10 flex items-center justify-between gap-2">
                <span className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                  Total Events
                </span>
                <span className="text-sm font-mono text-brand" data-testid="detail-total-events">
                  {selectedUser.eventCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
