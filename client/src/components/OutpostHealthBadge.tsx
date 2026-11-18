import { useMemo } from "react";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import {
  computeOutpostHealth,
  getHealthColor,
  getHealthDotColor,
  getHealthBarColor,
  type OutpostHealth,
} from "@/lib/outpost-reputation";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Activity } from "lucide-react";

interface OutpostHealthBadgeProps {
  relayUrl: string;
  members: string[];
  lastActivityTs?: number;
  compact?: boolean;
}

function HealthBadgeSkeleton({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border/20 bg-muted/20 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
        <span className="w-4 h-2.5 rounded bg-muted-foreground/15" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/20 bg-muted/20 animate-pulse">
      <span className="w-3 h-3 rounded bg-muted-foreground/15" />
      <span className="w-10 h-3 rounded bg-muted-foreground/15" />
      <span className="w-5 h-2.5 rounded bg-muted-foreground/10" />
    </span>
  );
}

function HealthBar({ score, label }: { score: number; label: string }) {
  const barColor = getHealthBarColor(label as OutpostHealth["label"]);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-foreground/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[12px] tabular-nums text-muted-foreground w-7 text-right">{score}</span>
    </div>
  );
}

function BreakdownRow({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}{suffix}</span>
    </div>
  );
}

export function OutpostHealthBadge({ relayUrl, members, lastActivityTs, compact }: OutpostHealthBadgeProps) {
  const { scores, flaggedPubkeys, wotEnabled, loading } = useGrapeRankScores();

  const health = useMemo(
    () => computeOutpostHealth(relayUrl, members, scores, flaggedPubkeys, lastActivityTs),
    [relayUrl, members, scores, flaggedPubkeys, lastActivityTs],
  );

  if (!wotEnabled) return null;

  if (loading && !health) {
    return <HealthBadgeSkeleton compact={compact} />;
  }

  if (!health && !loading && members.length > 0 && scores && scores.size > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Activity className="w-3.5 h-3.5" />
        Awaiting data
      </span>
    );
  }

  if (!health) return null;

  // The community's health as a status word with its dot (status words, not
  // pills); the score and how it's made are in the pop-up.
  const colorClass = getHealthColor(health.label);
  const dotColor = getHealthDotColor(health.label);

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={`hit-area inline-flex items-center gap-1.5 text-[12px] font-semibold underline-offset-4 hover:underline ${colorClass}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
            {health.label}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-52 p-3 glass-dialog-card space-y-2"
        >
          <HealthPopoverContent health={health} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`hit-area inline-flex items-center gap-1.5 min-h-9 text-[13px] font-semibold underline-offset-4 hover:underline ${colorClass}`}
        >
          <span className={`w-2 h-2 rounded-full ${dotColor}`} aria-hidden="true" />
          <span>{health.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-56 p-3 glass-dialog-card space-y-2.5"
      >
        <HealthPopoverContent health={health} />
      </PopoverContent>
    </Popover>
  );
}

function HealthPopoverContent({ health }: { health: OutpostHealth }) {
  const colorClass = getHealthColor(health.label);
  return (
    <>
      <div className="flex items-center gap-2">
        <Activity className={`w-3.5 h-3.5 ${colorClass}`} />
        <span className={`text-[13px] font-semibold ${colorClass}`}>{health.label}</span>
      </div>
      <HealthBar score={health.score} label={health.label} />
      <div className="h-px bg-border/60" />
      <div className="space-y-1">
        <BreakdownRow label="Trusted members" value={health.breakdown.trustedPct} />
        <BreakdownRow label="Members with few ties" value={health.breakdown.lowTrustPct} />
        <BreakdownRow label="Members your network has concerns about" value={health.breakdown.flaggedPct} />
        <BreakdownRow label="Members your network knows" value={health.breakdown.scoredPct} />
        <BreakdownRow label="Community size" value={health.breakdown.memberBonus} />
        <BreakdownRow label="Recent activity" value={health.breakdown.activityBonus} />
      </div>
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Worked out from how your network sees the people who post here.
      </p>
    </>
  );
}
