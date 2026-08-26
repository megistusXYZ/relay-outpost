import { getSignalTier, type SignalTier } from "@/lib/graperank";

export type HealthLabel = "Thriving" | "Healthy" | "Growing" | "Quiet" | "Concerning";

export interface HealthBreakdown {
  trustedPct: number;
  flaggedPct: number;
  lowTrustPct: number;
  memberBonus: number;
  scoredPct: number;
  activityBonus: number;
}

export interface OutpostHealth {
  score: number;
  label: HealthLabel;
  breakdown: HealthBreakdown;
}

const CACHE_TTL = 30 * 60 * 1000;

interface CacheEntry {
  health: OutpostHealth;
  ts: number;
  inputHash: string;
}

const cache = new Map<string, CacheEntry>();

function simpleStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function computeInputHash(
  members: string[],
  scores: Map<string, number>,
  flaggedPubkeys: Set<string> | null,
  lastActivityTs: number | undefined,
): string {
  const sorted = [...members].sort();
  let scoreSum = 0;
  let scoredCount = 0;
  for (const pk of sorted) {
    const s = scores.get(pk);
    if (s !== undefined) {
      scoreSum += s;
      scoredCount++;
    }
  }
  const flaggedCount = flaggedPubkeys
    ? sorted.filter(pk => flaggedPubkeys.has(pk)).length
    : 0;
  const memberFingerprint = simpleStringHash(sorted.join(","));
  return `${sorted.length}:${scoredCount}:${scoreSum.toFixed(4)}:${flaggedCount}:${lastActivityTs ?? 0}:${memberFingerprint}`;
}

function getHealthLabel(score: number): HealthLabel {
  if (score >= 80) return "Thriving";
  if (score >= 60) return "Healthy";
  if (score >= 40) return "Growing";
  if (score >= 20) return "Quiet";
  return "Concerning";
}

export function getHealthColor(label: HealthLabel): string {
  switch (label) {
    case "Thriving": return "text-emerald-600 dark:text-emerald-400";
    case "Healthy": return "text-blue-600 dark:text-blue-400";
    case "Growing": return "text-cyan-600 dark:text-cyan-400";
    case "Quiet": return "text-amber-600 dark:text-amber-400";
    case "Concerning": return "text-red-600 dark:text-red-400";
  }
}

export function getHealthBg(label: HealthLabel): string {
  switch (label) {
    case "Thriving": return "bg-emerald-500/10 border-emerald-500/20";
    case "Healthy": return "bg-blue-500/10 border-blue-500/20";
    case "Growing": return "bg-cyan-500/10 border-cyan-500/20";
    case "Quiet": return "bg-amber-500/10 border-amber-500/20";
    case "Concerning": return "bg-red-500/10 border-red-500/20";
  }
}

export function getHealthDotColor(label: HealthLabel): string {
  switch (label) {
    case "Thriving": return "bg-emerald-500";
    case "Healthy": return "bg-blue-500";
    case "Growing": return "bg-cyan-500";
    case "Quiet": return "bg-amber-500";
    case "Concerning": return "bg-red-500";
  }
}

export function getHealthBarColor(label: HealthLabel): string {
  switch (label) {
    case "Thriving": return "bg-emerald-500";
    case "Healthy": return "bg-blue-500";
    case "Growing": return "bg-cyan-500";
    case "Quiet": return "bg-amber-500";
    case "Concerning": return "bg-red-500";
  }
}

export function computeOutpostHealth(
  relayUrl: string,
  members: string[],
  scores: Map<string, number> | null,
  flaggedPubkeys: Set<string> | null,
  lastActivityTs?: number,
): OutpostHealth | null {
  if (!scores || members.length === 0) return null;

  const inputHash = computeInputHash(members, scores, flaggedPubkeys, lastActivityTs);
  const cached = cache.get(relayUrl);
  if (cached && cached.inputHash === inputHash) {
    if (Date.now() - cached.ts < CACHE_TTL) {
      return cached.health;
    }
    queueMicrotask(() => {
      const fresh = recompute(relayUrl, members, scores, flaggedPubkeys, lastActivityTs);
      if (fresh) cache.set(relayUrl, { health: fresh, ts: Date.now(), inputHash });
    });
    return cached.health;
  }

  const health = recompute(relayUrl, members, scores, flaggedPubkeys, lastActivityTs);
  if (health) {
    cache.set(relayUrl, { health, ts: Date.now(), inputHash });
  }
  return health;
}

function recompute(
  _relayUrl: string,
  members: string[],
  scores: Map<string, number> | null,
  flaggedPubkeys: Set<string> | null,
  lastActivityTs?: number,
): OutpostHealth | null {
  if (!scores || members.length === 0) return null;

  let scoredCount = 0;
  let trustedCount = 0;
  let moderateCount = 0;
  let lowTrustCount = 0;
  let flaggedCount = 0;

  for (const pk of members) {
    const influence = scores.get(pk);
    if (influence !== undefined) {
      scoredCount++;
      const tier: SignalTier = getSignalTier(influence);
      if (tier === "strong") trustedCount++;
      else if (tier === "moderate") moderateCount++;
      else if (tier === "weak" || tier === "none") lowTrustCount++;
    }
    if (flaggedPubkeys?.has(pk)) flaggedCount++;
  }

  if (scoredCount === 0) return null;

  const scoredPct = scoredCount / members.length;
  const trustedPct = (trustedCount + moderateCount * 0.5) / scoredCount;
  const flaggedPct = flaggedCount / members.length;
  const lowTrustPct = lowTrustCount / scoredCount;

  const memberBonus = Math.min(members.length / 50, 1.0);

  let activityBonus = 0;
  if (lastActivityTs) {
    const ageHours = (Date.now() / 1000 - lastActivityTs) / 3600;
    if (ageHours <= 1) activityBonus = 1.0;
    else if (ageHours <= 6) activityBonus = 0.8;
    else if (ageHours <= 24) activityBonus = 0.6;
    else if (ageHours <= 72) activityBonus = 0.3;
    else if (ageHours <= 168) activityBonus = 0.1;
    else activityBonus = 0;
  }

  const trustScore = trustedPct * 45;
  const flagPenalty = flaggedPct * 25;
  const lowTrustPenalty = lowTrustPct * 10;
  const memberScore = memberBonus * 10;
  const coverageBonus = scoredPct * 10;
  const activityScore = activityBonus * 10;

  const raw = trustScore - flagPenalty - lowTrustPenalty + memberScore + coverageBonus + activityScore;
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  const label = getHealthLabel(score);

  return {
    score,
    label,
    breakdown: {
      trustedPct: Math.round(trustedPct * 100),
      flaggedPct: Math.round(flaggedPct * 100),
      lowTrustPct: Math.round(lowTrustPct * 100),
      memberBonus: Math.round(memberBonus * 100),
      scoredPct: Math.round(scoredPct * 100),
      activityBonus: Math.round(activityBonus * 100),
    },
  };
}

export function clearHealthCache(relayUrl?: string): void {
  if (relayUrl) {
    cache.delete(relayUrl);
  } else {
    cache.clear();
  }
}
