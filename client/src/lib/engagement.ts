import { getEngagementWeights } from "./engagement-weights";

export interface EngagementStats {
  replies: number;
  reposts: number;
  likes: number;
  zaps: number;
  zapAmount: number;
}

export function computeEngagementScore(stats: { replies: number; reposts: number; likes: number; zaps: number; zapAmount: number } | null): number {
  if (!stats) return 0;
  const w = getEngagementWeights();
  return (
    stats.replies * w.replies +
    stats.reposts * w.reposts +
    stats.likes * w.likes +
    stats.zaps * w.zaps +
    (stats.zapAmount > 0 ? Math.round(Math.log10(stats.zapAmount) * w.satsBonus) : 0)
  );
}

export function formatEngagementScore(score: number): string {
  if (score >= 1000) return `${(score / 1000).toFixed(1)}k`;
  return score.toString();
}

export type EngagementTier = "high" | "mid" | "low" | "none";

export function getEngagementTier(score: number): EngagementTier {
  if (score >= 50) return "high";
  if (score >= 10) return "mid";
  if (score >= 1) return "low";
  return "none";
}

export function getEngagementTierLabel(tier: EngagementTier): string {
  switch (tier) {
    case "high": return "High";
    case "mid": return "Medium";
    case "low": return "Low";
    case "none": return "None";
  }
}
