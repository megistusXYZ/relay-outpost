import { useState, useCallback, useRef } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import { fetchUserZaps } from "@/lib/primal-cache";
import { formatDistanceToNow, format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  User,
  MessageSquare,
  Reply,
  Heart,
  Repeat,
  Zap,
  Target,
  CheckCircle2,
  Circle,
  Search,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  Radio,
  MessageCircle,
  Users,
  Sparkles } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

interface MilestoneData {
  key: string;
  label: string;
  icon: typeof User;
  timestamp: number | null;
  event: Event | null;
}

interface UserAdoptionFunnelProps {
  pubkey?: string;
  relays?: string[];
}

function decodePubkey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {}
  return null;
}

function parseZapAmount(event: Event): number {
  const bolt11Tag = event.tags.find((t) => t[0] === "bolt11");
  if (bolt11Tag && bolt11Tag[1]) {
    const match = bolt11Tag[1].match(/lnbc(\d+)([munp]?)/i);
    if (match) {
      const amount = parseInt(match[1]);
      const unit = match[2];
      if (unit === "m") return Math.round(amount * 100000);
      if (unit === "u") return Math.round(amount * 100);
      if (unit === "n") return Math.round(amount * 0.1);
      if (unit === "p") return Math.round(amount * 0.0001);
      return amount * 100000000;
    }
  }
  return 0;
}

function getEventSummary(milestone: MilestoneData): { label: string; detail: string; noteId?: string } | null {
  const event = milestone.event;
  if (!event) return null;

  const noteId = event.id;

  switch (milestone.key) {
    case "account": {
      try {
        const profile = JSON.parse(event.content);
        const name = profile.display_name || profile.name || "Unknown";
        const about = profile.about ? profile.about.slice(0, 120) : "";
        return { label: "Profile", detail: `${name}${about ? " — " + about : ""}` };
      } catch {
        return { label: "Profile", detail: "Profile event created" };
      }
    }
    case "first_post":
      return { label: "Post", detail: event.content.slice(0, 200) || "(empty)", noteId };
    case "first_reply": {
      const replyTo = event.tags.find((t) => t[0] === "e")?.[1];
      return { label: "Reply", detail: event.content.slice(0, 200) || "(empty)", noteId: replyTo || noteId };
    }
    case "first_reaction": {
      const reactedTo = event.tags.find((t) => t[0] === "e")?.[1];
      const emoji = event.content || "+";
      return { label: "Reaction", detail: `Reacted "${emoji}" to a note`, noteId: reactedTo };
    }
    case "first_repost": {
      const reposted = event.tags.find((t) => t[0] === "e")?.[1];
      return { label: "Repost", detail: "Reposted a note", noteId: reposted };
    }
    case "first_zap_sent": {
      const sats = parseZapAmount(event);
      const recipient = event.tags.find((t) => t[0] === "p")?.[1];
      const recipientShort = recipient ? recipient.slice(0, 8) + "..." : "someone";
      return { label: "Zap Sent", detail: sats > 0 ? `Zapped ${sats.toLocaleString()} sats to ${recipientShort}` : `Zapped ${recipientShort}` };
    }
    case "first_zap_received": {
      const sats = parseZapAmount(event);
      const descTag = event.tags.find((t) => t[0] === "description");
      let senderShort = "someone";
      if (descTag && descTag[1]) {
        try {
          const desc = JSON.parse(descTag[1]);
          if (desc.pubkey) senderShort = desc.pubkey.slice(0, 8) + "...";
        } catch {}
      }
      return { label: "Zap Received", detail: sats > 0 ? `Received ${sats.toLocaleString()} sats from ${senderShort}` : `Received zap from ${senderShort}` };
    }
    default:
      return null;
  }
}

function formatTimeBetween(fromTs: number, toTs: number): string {
  const diffMs = Math.abs(toTs - fromTs) * 1000;
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h later`;
  if (hours > 0) return `${hours}h ${minutes % 60}m later`;
  return `${minutes}m later`;
}

interface AdoptionStage {
  name: string;
  icon: typeof Eye;
  color: string;
  bgColor: string;
  borderColor: string;
}

const ADOPTION_STAGES: Record<string, AdoptionStage> = {
  observer: {
    name: "Observer",
    icon: Eye,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/20" },
  broadcaster: {
    name: "Broadcaster",
    icon: Radio,
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20" },
  conversationalist: {
    name: "Conversationalist",
    icon: MessageCircle,
    color: "text-cyan-800 dark:text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/20" },
  community_member: {
    name: "Community Member",
    icon: Users,
    color: "text-brand",
    bgColor: "bg-brand/10",
    borderColor: "border-brand/20" },
  fully_integrated: {
    name: "Fully Integrated",
    icon: Sparkles,
    color: "text-amber-800 dark:text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20" } };

function classifyAdoptionStage(milestones: MilestoneData[]): string {
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

function analyzePace(milestones: MilestoneData[]): { label: string; description: string } {
  const completed = milestones.filter((m) => m.timestamp !== null);
  if (completed.length <= 1) return { label: "Just Started", description: "Not enough activity to assess pace yet." };

  const sorted = [...completed].sort((a, b) => a.timestamp! - b.timestamp!);
  const firstTs = sorted[0].timestamp!;
  const lastTs = sorted[sorted.length - 1].timestamp!;
  const totalDays = Math.round((lastTs - firstTs) / 86400);

  const accountTs = milestones.find((m) => m.key === "account")?.timestamp;
  const postTs = milestones.find((m) => m.key === "first_post")?.timestamp;
  const postDelayDays = accountTs && postTs ? Math.round((postTs - accountTs) / 86400) : null;

  if (totalDays <= 7 && completed.length >= 5) return { label: "Rapid Adopter", description: "Hit most milestones within a week — a power user from the start." };
  if (totalDays <= 30 && completed.length >= 4) return { label: "Quick Starter", description: "Reached key milestones within a month, showing strong early engagement." };
  if (totalDays <= 90) {
    if (postDelayDays !== null && postDelayDays > 14) {
      return { label: "Cautious Explorer", description: "Took some time to get started, but steadily engaged over the first few months." };
    }
    return { label: "Steady Builder", description: "Adopted features gradually over a few months at a natural, healthy pace." };
  }
  if (postDelayDays !== null && postDelayDays > 30) {
    return { label: "Late Bloomer", description: "Waited a while before becoming active, but eventually found their groove." };
  }
  return { label: "Gradual Explorer", description: "Explored the ecosystem at their own pace over an extended period." };
}

function generateNarrative(milestones: MilestoneData[], stage: string, pace: { label: string }): string {
  const completed = milestones.filter((m) => m.timestamp !== null);
  const total = milestones.length;
  const stageInfo = ADOPTION_STAGES[stage];

  const accountTs = milestones.find((m) => m.key === "account")?.timestamp;
  const postTs = milestones.find((m) => m.key === "first_post")?.timestamp;
  const replyTs = milestones.find((m) => m.key === "first_reply")?.timestamp;
  const zapSentTs = milestones.find((m) => m.key === "first_zap_sent")?.timestamp;
  const zapReceivedTs = milestones.find((m) => m.key === "first_zap_received")?.timestamp;

  const parts: string[] = [];

  parts.push(`This user is a **${stageInfo.name}** (${pace.label}).`);

  if (accountTs && postTs) {
    const postDelay = Math.round((postTs - accountTs) / 86400);
    if (postDelay === 0) parts.push("They started posting immediately after creating their account.");
    else if (postDelay <= 1) parts.push("They posted within a day of creating their account.");
    else if (postDelay <= 7) parts.push(`They began posting within ${postDelay} days of signing up.`);
    else parts.push(`It took about ${postDelay} days before they published their first post.`);
  }

  if (replyTs && postTs) {
    const replyDelay = Math.round((replyTs - postTs) / 86400);
    if (replyDelay <= 1) parts.push("They quickly began engaging in conversations with others.");
    else if (replyDelay <= 14) parts.push(`After about ${replyDelay} days, they started replying to others.`);
    else parts.push("It took a while before they started interacting through replies.");
  }

  if (zapSentTs || zapReceivedTs) {
    if (zapSentTs && zapReceivedTs) {
      parts.push("Zap activity shows investment in the value-for-value economy — both sending and receiving.");
    } else if (zapSentTs) {
      parts.push("They've sent zaps, showing willingness to support others in the ecosystem.");
    } else {
      parts.push("They've received zaps from the community, suggesting their content resonates.");
    }
  }

  if (completed.length < total) {
    const missing = milestones.filter((m) => m.timestamp === null).map((m) => m.label);
    if (missing.length <= 3) {
      parts.push(`Still to explore: ${missing.join(", ")}.`);
    }
  }

  return parts.join(" ");
}

export function UserAdoptionFunnel({ pubkey: propPubkey, relays: propRelays }: UserAdoptionFunnelProps) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [inputValue, setInputValue] = useState(propPubkey || "");
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queried, setQueried] = useState(false);
  const subsRef = useRef<Array<{ close: () => void }>>([]);

  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null);

  const buildMilestones = useCallback((): MilestoneData[] => {
    return [
      { key: "account", label: "Account Created", icon: User, timestamp: null, event: null },
      { key: "first_post", label: "First Post", icon: MessageSquare, timestamp: null, event: null },
      { key: "first_reply", label: "First Reply", icon: Reply, timestamp: null, event: null },
      { key: "first_reaction", label: "First Reaction", icon: Heart, timestamp: null, event: null },
      { key: "first_repost", label: "First Repost", icon: Repeat, timestamp: null, event: null },
      { key: "first_zap_sent", label: "First Zap Sent", icon: Zap, timestamp: null, event: null },
      { key: "first_zap_received", label: "First Zap Received", icon: Target, timestamp: null, event: null },
    ];
  }, []);

  const runQuery = useCallback((hex: string) => {
    subsRef.current.forEach((s) => s.close());
    subsRef.current = [];

    setLoading(true);
    setError(null);
    setQueried(true);

    const result = buildMilestones();
    let completedQueries = 0;
    const totalQueries = 5;
    let earliestProfileTs: number | null = null;

    function checkDone() {
      completedQueries++;
      if (completedQueries >= totalQueries) {
        const allTimestamps = result
          .filter((m) => m.timestamp !== null)
          .map((m) => m.timestamp!);
        if (earliestProfileTs !== null) allTimestamps.push(earliestProfileTs);
        if (allTimestamps.length > 0) {
          result[0].timestamp = Math.min(...allTimestamps);
        }
        setMilestones([...result]);
        setLoading(false);
      }
    }

    const profileEvents: Event[] = [];
    const sub0 = throttledPoolSubscribe(relaysToUse, {
      kinds: [0],
      authors: [hex] } as any, {
      onevent(event: Event) {
        profileEvents.push(event);
      },
      oneose() {
        sub0.close();
        if (profileEvents.length > 0) {
          const earliest = profileEvents.reduce((a, b) => a.created_at < b.created_at ? a : b);
          earliestProfileTs = earliest.created_at;
          result[0].event = earliest;
        }
        checkDone();
      } });
    subsRef.current.push(sub0);

    const kind1Events: Event[] = [];
    const sub1 = throttledPoolSubscribe(relaysToUse, {
      kinds: [1],
      authors: [hex],
      limit: 500 } as any, {
      onevent(event: Event) {
        kind1Events.push(event);
      },
      oneose() {
        sub1.close();
        let earliestPost: Event | null = null;
        let earliestReply: Event | null = null;
        for (const ev of kind1Events) {
          const hasETag = ev.tags.some((t) => t[0] === "e");
          if (hasETag) {
            if (!earliestReply || ev.created_at < earliestReply.created_at) {
              earliestReply = ev;
            }
          } else {
            if (!earliestPost || ev.created_at < earliestPost.created_at) {
              earliestPost = ev;
            }
          }
        }
        result[1].timestamp = earliestPost?.created_at ?? null;
        result[1].event = earliestPost;
        result[2].timestamp = earliestReply?.created_at ?? null;
        result[2].event = earliestReply;
        checkDone();
      } });
    subsRef.current.push(sub1);

    const reactionEvents: Event[] = [];
    const sub7 = throttledPoolSubscribe(relaysToUse, {
      kinds: [7],
      authors: [hex],
      limit: 1 } as any, {
      onevent(event: Event) {
        reactionEvents.push(event);
      },
      oneose() {
        sub7.close();
        if (reactionEvents.length > 0) {
          const earliest = reactionEvents.reduce((a, b) => a.created_at < b.created_at ? a : b);
          result[3].timestamp = earliest.created_at;
          result[3].event = earliest;
        }
        checkDone();
      } });
    subsRef.current.push(sub7);

    const repostEvents: Event[] = [];
    const sub6 = throttledPoolSubscribe(relaysToUse, {
      kinds: [6],
      authors: [hex],
      limit: 1 } as any, {
      onevent(event: Event) {
        repostEvents.push(event);
      },
      oneose() {
        sub6.close();
        if (repostEvents.length > 0) {
          const earliest = repostEvents.reduce((a, b) => a.created_at < b.created_at ? a : b);
          result[4].timestamp = earliest.created_at;
          result[4].event = earliest;
        }
        checkDone();
      } });
    subsRef.current.push(sub6);

    const relayReceivedPromise = new Promise<Event[]>((resolve) => {
      const events: Event[] = [];
      const timeout = setTimeout(() => resolve(events), 15000);
      const sub = throttledPoolSubscribe(relaysToUse, { kinds: [9735], "#p": [hex], limit: 20 } as any, {
        onevent(event: Event) {
          events.push(event);
        },
        oneose() {
          clearTimeout(timeout);
          sub.close();
          resolve(events);
        } });
      subsRef.current.push(sub);
    });

    Promise.all([
      fetchUserZaps(hex, 10).catch(() => ({ sent: [] as Event[], received: [] as Event[] })),
      relayReceivedPromise,
    ]).then(([primalZaps, relayReceived]) => {
      if (primalZaps.sent.length > 0) {
        const earliest = primalZaps.sent.reduce((a, b) => a.created_at < b.created_at ? a : b);
        result[5].timestamp = earliest.created_at;
        result[5].event = earliest;
      }

      const allReceived = new Map<string, Event>();
      for (const ev of [...primalZaps.received, ...relayReceived]) {
        if (ev.kind === 9735 && !allReceived.has(ev.id)) {
          allReceived.set(ev.id, ev);
        }
      }
      const receivedArr = Array.from(allReceived.values());
      if (receivedArr.length > 0) {
        const earliest = receivedArr.reduce((a, b) => a.created_at < b.created_at ? a : b);
        result[6].timestamp = earliest.created_at;
        result[6].event = earliest;
      }

      checkDone();
    }).catch(() => {
      checkDone();
    });
  }, [buildMilestones, relaysToUse]);

  const handleSubmit = useCallback(() => {
    const resolvedPubkey = propPubkey || decodePubkey(inputValue);
    if (!resolvedPubkey) {
      setError("Invalid pubkey or npub. Please enter a valid hex pubkey or npub address.");
      return;
    }
    runQuery(resolvedPubkey);
  }, [inputValue, propPubkey, runQuery]);

  const completedMilestones = milestones.filter((m) => m.timestamp !== null);
  const completedCount = completedMilestones.length;
  const totalCount = milestones.length;

  const sortedCompleted = [...completedMilestones].sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
  );

  const firstTs = sortedCompleted.length > 0 ? sortedCompleted[0].timestamp! : null;
  const lastTs = sortedCompleted.length > 0 ? sortedCompleted[sortedCompleted.length - 1].timestamp! : null;

  let timeSpanLabel = "";
  if (firstTs && lastTs && firstTs !== lastTs) {
    const diffDays = Math.round((lastTs - firstTs) / 86400);
    timeSpanLabel = `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  }

  return (
    <div className="overflow-hidden" data-testid="user-adoption-funnel">
      <div className="p-4 sm:p-6 space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <Target className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-display text-brand">User Adoption Funnel</h2>
        </div>

        {!propPubkey && (
          <div className="flex gap-2" data-testid="pubkey-input-section">
            <Input
              data-testid="input-pubkey"
              placeholder="Enter npub or hex pubkey..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              className="flex-1 font-mono text-sm"
              style={{ fontSize: "16px" }}
            />
            <Button
              data-testid="button-lookup"
              onClick={handleSubmit}
              disabled={loading || !inputValue.trim()}
            >
              {loading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>
        )}

        {propPubkey && !queried && (
          <Button
            data-testid="button-run-funnel"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
                Scanning relays...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Analyze Adoption Funnel
              </>
            )}
          </Button>
        )}

        {error && (
          <p className="text-xs text-destructive" data-testid="text-error">{error}</p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="loading-indicator">
            <RelayOutpostInlineLoader className="w-4 h-4 text-brand" />
            <span>Querying relays for milestone events...</span>
          </div>
        )}

        {queried && !loading && milestones.length > 0 && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="secondary" data-testid="badge-completed-count">
                {completedCount} of {totalCount} milestones
              </Badge>
              {timeSpanLabel && (
                <span className="text-xs text-muted-foreground" data-testid="text-time-span">
                  Signup to latest: {timeSpanLabel}
                </span>
              )}
            </div>

            <div className="space-y-0" data-testid="milestone-timeline">
              {milestones.map((milestone, idx) => {
                const completed = milestone.timestamp !== null;
                const Icon = milestone.icon;

                let timeSincePrev = "";
                if (completed && idx > 0) {
                  const prevCompleted = milestones
                    .slice(0, idx)
                    .filter((m) => m.timestamp !== null)
                    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                  if (prevCompleted.length > 0) {
                    const prevTs = prevCompleted[prevCompleted.length - 1].timestamp!;
                    if (milestone.timestamp! > prevTs) {
                      timeSincePrev = formatTimeBetween(prevTs, milestone.timestamp!);
                    }
                  }
                }

                const isExpanded = expandedMilestone === milestone.key;
                const eventSummary = completed ? getEventSummary(milestone) : null;
                const canExpand = completed && eventSummary;

                return (
                  <div
                    key={milestone.key}
                    className="flex items-start gap-3 relative"
                    data-testid={`milestone-${milestone.key}`}
                  >
                    <div className="flex flex-col items-center self-stretch">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          completed
                            ? "bg-brand/20 border border-brand/40"
                            : "bg-muted/10 border border-muted-foreground/20"
                        }`}
                      >
                        {completed ? (
                          <CheckCircle2 className="w-4 h-4 text-brand" />
                        ) : (
                          <Circle className="w-4 h-4 text-muted-foreground/40" />
                        )}
                      </div>
                      {idx < milestones.length - 1 && (
                        <div
                          className={`w-px flex-1 ${
                            completed ? "bg-brand/30" : "bg-muted-foreground/10"
                          }`}
                        />
                      )}
                    </div>

                    <div className="pb-6 pt-1 min-w-0 flex-1">
                      <div
                        className={`flex items-center gap-2 flex-wrap ${canExpand ? "cursor-pointer" : ""}`}
                        onClick={() => canExpand && setExpandedMilestone(isExpanded ? null : milestone.key)}
                        data-testid={`button-expand-${milestone.key}`}
                      >
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            completed ? "text-brand" : "text-muted-foreground/40"
                          }`}
                        />
                        <span
                          className={`text-xs font-medium ${
                            completed ? "text-foreground" : "text-muted-foreground/50"
                          }`}
                          data-testid={`text-milestone-label-${milestone.key}`}
                        >
                          {milestone.label}
                        </span>
                        {timeSincePrev && (
                          <span
                            className="text-[10px] text-muted-foreground/40 font-mono"
                            data-testid={`text-time-since-${milestone.key}`}
                          >
                            {timeSincePrev}
                          </span>
                        )}
                        {canExpand && (
                          isExpanded
                            ? <ChevronDown className="w-3 h-3 text-muted-foreground/40 ml-auto" />
                            : <ChevronRight className="w-3 h-3 text-muted-foreground/40 ml-auto" />
                        )}
                      </div>
                      {completed && milestone.timestamp && (
                        <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                          <span
                            className="text-[10px] font-mono text-brand"
                            data-testid={`text-milestone-date-${milestone.key}`}
                          >
                            {format(new Date(milestone.timestamp * 1000), "MMM d, yyyy HH:mm")}
                          </span>
                          <span className="text-[10px] text-muted-foreground/40">
                            ({formatDistanceToNow(new Date(milestone.timestamp * 1000), { addSuffix: true })})
                          </span>
                        </div>
                      )}
                      {!completed && (
                        <p
                          className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mt-0.5"
                          data-testid={`text-not-achieved-${milestone.key}`}
                        >
                          Not yet achieved
                        </p>
                      )}
                      {isExpanded && eventSummary && (
                        <div
                          className="mt-2 p-2.5 rounded-md bg-brand/5 border border-brand/10 space-y-1"
                          data-testid={`detail-${milestone.key}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-brand uppercase tracking-widest text-brand">
                              {eventSummary.label}
                            </span>
                            {milestone.event && (
                              <span className="text-[9px] font-mono text-muted-foreground/30">
                                Kind {milestone.event.kind}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-foreground/80 break-words leading-relaxed">
                            {eventSummary.detail}
                          </p>
                          {eventSummary.noteId && (
                            <a
                              href={`/thread/${eventSummary.noteId}`}
                              className="inline-flex items-center gap-1 text-[10px] text-brand hover:underline mt-1"
                              data-testid={`link-event-${milestone.key}`}
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              View event
                            </a>
                          )}
                          {milestone.event && (
                            <p className="text-[9px] font-mono text-muted-foreground/20 truncate mt-0.5">
                              ID: {milestone.event.id.slice(0, 16)}...
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {(() => {
              const stageKey = classifyAdoptionStage(milestones);
              const stage = ADOPTION_STAGES[stageKey];
              const pace = analyzePace(milestones);
              const narrative = generateNarrative(milestones, stageKey, pace);
              const StageIcon = stage.icon;

              return (
                <div className="space-y-3" data-testid="adoption-analysis">
                  <div className={`p-4 rounded-lg ${stage.bgColor} border ${stage.borderColor} space-y-3`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${stage.bgColor} border ${stage.borderColor}`}>
                        <StageIcon className={`w-4 h-4 ${stage.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-display ${stage.color}`} data-testid="text-stage-name">
                            {stage.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid="badge-pace">
                            {pace.label}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {completedCount} of {totalCount} milestones{timeSpanLabel ? ` · ${timeSpanLabel} span` : ""}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground/70 italic" data-testid="text-pace-description">
                      {pace.description}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-brand/5 border border-brand/10 space-y-2">
                    <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                      Adoption Analysis
                    </p>
                    <p className="text-xs text-foreground/80 leading-relaxed" data-testid="text-narrative">
                      {narrative.split("**").map((part, i) =>
                        i % 2 === 1 ? (
                          <strong key={i} className="text-foreground font-medium">{part}</strong>
                        ) : (
                          <span key={i}>{part}</span>
                        )
                      )}
                    </p>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {queried && !loading && milestones.length === 0 && !error && (
          <p className="text-xs text-muted-foreground" data-testid="text-no-results">
            No milestone data found for this pubkey.
          </p>
        )}
      </div>
    </div>
  );
}
