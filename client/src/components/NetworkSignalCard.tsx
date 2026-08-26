import { useState, useEffect } from "react";
import { useGrapeRank, useSelfGrapeRank } from "@/hooks/use-graperank";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import {
  getSignalTier,
  getSignalTierLabel,
  getSignalTierColor,
  getSignalTierBg,
  formatInfluence,
  triggerGrapeRankCalculation } from "@/lib/graperank";
import { Signal, ExternalLink, Users, Shield, ArrowUpRight} from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

function formatTimeAgo(isoDate: string | null): string {
  if (!isoDate) return "Unknown";
  try {
    let raw = isoDate.trim();
    if (!/[Zz]$/.test(raw) && !/[+-]\d{2}:\d{2}$/.test(raw)) raw += "Z";
    const date = new Date(raw);
    if (isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "Unknown";
  }
}

function RelationshipBadge({ relationship }: { relationship: string }) {
  const config: Record<string, { label: string; className: string }> = {
    mutual: { label: "Mutual", className: "text-green-800 dark:text-green-400 bg-green-500/10 border-green-500/20" },
    "follows-you": { label: "Follows you", className: "text-brand bg-brand/10 border-brand/20" },
    "you-follow": { label: "You follow", className: "text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/20" },
    muted: { label: "Muted", className: "text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/20" } };
  const c = config[relationship];
  if (!c) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${c.className}`}>
      {c.label}
    </span>
  );
}

function SignalGauge({ influence }: { influence: number | null }) {
  const pct = influence !== null ? Math.round(influence * 100) : 0;
  const tier = getSignalTier(influence);
  const tierColor = getSignalTierColor(tier);

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-12 h-12 sm:w-14 sm:h-14">
        <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
          <circle
            cx="24" cy="24" r="20"
            fill="none"
            strokeWidth="3"
            className="stroke-border/30"
          />
          {influence !== null && (
            <circle
              cx="24" cy="24" r="20"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${pct * 1.257} ${125.7 - pct * 1.257}`}
              className={
                tier === "strong" ? "stroke-emerald-400" :
                tier === "moderate" ? "stroke-blue-400" :
                tier === "low" ? "stroke-cyan-400" :
                "stroke-amber-400"
              }
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xs sm:text-sm font-bold tabular-nums ${tierColor}`}>
            {influence !== null ? `${pct}` : "—"}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className={`text-xs font-semibold ${tierColor}`}>
          {getSignalTierLabel(tier)}
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          Network influence score
        </span>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-3 rounded-lg border border-border/30 bg-card/40 p-3 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3.5 h-3.5 rounded bg-muted/40" />
        <div className="w-24 h-3 rounded bg-muted/40" />
      </div>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-muted/30" />
        <div className="flex flex-col gap-1.5">
          <div className="w-20 h-3 rounded bg-muted/40" />
          <div className="w-32 h-2.5 rounded bg-muted/30" />
        </div>
      </div>
    </div>
  );
}

interface NetworkSignalCardProps {
  targetPubkey: string;
  observerPubkey: string | null;
  isOwnProfile: boolean;
  prefetchedScore?: import("@/lib/graperank").GrapeRankScore | null;
}

export function NetworkSignalCard({ targetPubkey, observerPubkey, isOwnProfile, prefetchedScore }: NetworkSignalCardProps) {
  const { wotEnabled, recalculating, notifyRecalculating } = useGrapeRankScores();
  const { follows } = useNostrAuth();
  const { toast } = useToast();
  const [triggering, setTriggering] = useState(false);
  const [showRecalcConfirm, setShowRecalcConfirm] = useState(false);

  // Guard, then ask the user to confirm before kicking off a (slow, key-signing)
  // recalculation — clicking it shouldn't fire immediately.
  const requestRecalc = () => {
    if (!observerPubkey || triggering) return;
    if ((follows?.length ?? 0) === 0) {
      toast({ title: "Follow a few people first", description: "Your trust score reads your social graph. Follow at least one account, then calculate.", variant: "destructive" });
      return;
    }
    setShowRecalcConfirm(true);
  };

  // Start a GrapeRank calculation IN-APP (no more bouncing to brainstorm.nosfabrica.com).
  // The user signs the auth challenge with their key, we trigger the calc, then the
  // existing recalc poller (notifyRecalculating) picks up the result when it lands.
  const handleCalculate = async () => {
    if (!observerPubkey || triggering) return;
    // A trust score reads your social graph — with zero follows the calc comes
    // back empty. Nudge the user to follow someone first instead.
    if ((follows?.length ?? 0) === 0) {
      toast({ title: "Follow a few people first", description: "Your trust score reads your social graph. Follow at least one account, then calculate.", variant: "destructive" });
      return;
    }
    setTriggering(true);
    try {
      const r = await triggerGrapeRankCalculation(observerPubkey);
      if (r.ok) {
        notifyRecalculating();
        toast({ title: "Calculating your web of trust…", description: "This takes a few minutes — scores update automatically when it's ready." });
      } else if (r.error === "rate_limited") {
        notifyRecalculating();
        toast({ title: "Calculation already in progress", description: "You requested one recently — results are on the way." });
      } else if (r.error === "auth") {
        toast({ title: "Couldn't start", description: "Approve the signing request with your key to calculate.", variant: "destructive" });
      } else {
        toast({ title: "Couldn't start calculation", description: "Brainstorm is unreachable right now. Please try again shortly.", variant: "destructive" });
      }
    } finally {
      setTriggering(false);
    }
  };

  const fetched = useGrapeRank(prefetchedScore !== undefined || !wotEnabled ? null : targetPubkey, observerPubkey);
  const score = prefetchedScore !== undefined ? prefetchedScore : fetched.score;
  const rawLoading = prefetchedScore !== undefined ? false : fetched.loading;
  const error = prefetchedScore !== undefined ? false : fetched.error;
  const selfData = useSelfGrapeRank(isOwnProfile && wotEnabled ? observerPubkey : null);

  const [showSkeleton, setShowSkeleton] = useState(false);
  const isLoading = rawLoading || selfData.loading;
  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false);
      return;
    }
    const timer = setTimeout(() => setShowSkeleton(true), 200);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (!wotEnabled) {
    return (
      <div className="mt-3 rounded-lg border border-border/20 bg-card/30 p-3">
        <div className="flex items-center gap-1.5">
          <Signal className="w-3.5 h-3.5 text-muted-foreground/30" />
          <span className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider">Network Signal</span>
        </div>
        <p className="text-[11px] text-muted-foreground/50 mt-2 leading-relaxed">
          Web of Trust is disabled. Enable it in Settings to see trust scores.
        </p>
      </div>
    );
  }

  if (isLoading && showSkeleton) return <LoadingSkeleton />;
  if (isLoading) return null;
  if (error && !score) return null;
  if (!score && !isOwnProfile) return null;

  if (!score && isOwnProfile) {
    return (
      <div className="mt-3 rounded-lg border border-brand/20 bg-brand/5 p-3">
        <div className="flex items-start gap-2.5">
          <Signal className="w-4 h-4 text-brand/60 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground/80">Network Signal</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
              Calculate your personalized network signal score to see trust data across profiles.
            </p>
            <button
              onClick={handleCalculate}
              disabled={triggering || !observerPubkey}
              className="inline-flex items-center gap-1 text-[11px] text-brand hover:text-brand dark:hover:text-brand-strong transition-colors mt-2 disabled:opacity-50"
              data-testid="button-calculate-wot"
            >
              {triggering ? (
                <><RelayOutpostInlineLoader className="w-3 h-3" /> Starting…</>
              ) : (
                <>Calculate my web of trust <ArrowUpRight className="w-3 h-3" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!score) return null;

  const tier = getSignalTier(score.influence);
  const showSelfInfo = isOwnProfile && selfData.lastCalculated;

  return (
    <div className="mt-3 rounded-lg border border-border/30 bg-card/40 p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Signal className="w-3.5 h-3.5 text-brand/60" />
          <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">Network Signal</span>
        </div>
        {score.relationship !== "none" && (
          <RelationshipBadge relationship={score.relationship} />
        )}
      </div>

      <SignalGauge influence={score.influence} />

      {(score.followedByCount > 0 || score.followingCount > 0 || score.trustedReporters !== null) && (
        <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-border/20">
          {score.followedByCount > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <Users className="w-3 h-3" />
              <span className="tabular-nums">{score.followedByCount.toLocaleString()}</span>
              <span>followers</span>
            </div>
          )}
          {score.followingCount > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <Users className="w-3 h-3" />
              <span className="tabular-nums">{score.followingCount.toLocaleString()}</span>
              <span>following</span>
            </div>
          )}
          {score.trustedReporters !== null && score.trustedReporters > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <Shield className="w-3 h-3" />
              <span className="tabular-nums">{score.trustedReporters}</span>
              <span>vouchers</span>
            </div>
          )}
        </div>
      )}

      {showSelfInfo && (
        <div className="mt-2.5 pt-2.5 border-t border-border/20">
          <div className="flex items-center justify-between">
            {recalculating ? (
              <div className="flex flex-col">
                <span className="text-[10px] text-brand/70 inline-flex items-center gap-1">
                  <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
                  Recalculating...
                </span>
                <span className="text-[9px] text-brand/50 ml-3.5">~15-20 min</span>
              </div>
            ) : (
              <span className="text-[10px] text-muted-foreground/50">
                Last calculated: {formatTimeAgo(selfData.lastCalculated)}
              </span>
            )}
            {recalculating ? (
              <a
                href="https://brainstorm.nosfabrica.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-muted-foreground/40 hover:text-brand transition-colors inline-flex items-center gap-0.5"
              >
                View on Brainstorm
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ) : (
              <>
                <button
                  onClick={requestRecalc}
                  disabled={triggering || !observerPubkey}
                  className="text-[10px] text-brand/60 hover:text-brand-strong transition-colors inline-flex items-center gap-0.5 disabled:opacity-50"
                  data-testid="button-recalculate-wot"
                >
                  {triggering ? "Starting…" : "Recalculate"}
                </button>
                <AlertDialog open={showRecalcConfirm} onOpenChange={setShowRecalcConfirm}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Recalculate your web of trust?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This runs a fresh calculation on Brainstorm and takes a few minutes. Your
                        scores update automatically when it's ready — you don't need to wait here.
                        You'll be asked to sign the request with your key.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-recalc-cancel">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => { setShowRecalcConfirm(false); void handleCalculate(); }}
                        data-testid="button-recalc-confirm"
                      >
                        Recalculate
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-border/15">
        <a
          href="https://brainstorm.nosfabrica.com/what-is-wot"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors inline-flex items-center gap-1"
        >
          Powered by GrapeRank
          <ExternalLink className="w-2 h-2" />
        </a>
      </div>
    </div>
  );
}
