// Pure insight computation for the Follow-list-health page.
//
// Given the user's own follow list plus three signals — how many trusted
// accounts flagged each follow, when each follow last posted, and which follows
// the user has already "reviewed" (Keep) — derive the two at-risk lists the page
// renders. No IO, no React: kept pure so it's cheap to unit-test and reuse (the
// Tools badge count runs the same function).

export const DEFAULT_FLAG_THRESHOLD = 2;
export const DEFAULT_STAGNANT_DAYS = 90;
const SECONDS_PER_DAY = 86_400;

export interface FollowHealthInput {
  /** The user's own follow list (hex pubkeys). */
  follows: string[];
  /** The user's own pubkey — always excluded from the lists. */
  self?: string | null;
  /** pubkey → count of trusted accounts that flagged them. */
  flagReporterCounts: Map<string, number>;
  /** pubkey → unix seconds of their latest post. Absent = unknown (not stagnant). */
  lastPostAt: Map<string, number>;
  /** pubkeys the user marked "Keep" — dropped from both lists. */
  reviewed: Set<string>;
  /** Current time in unix seconds. */
  now: number;
  /** Min trusted reporters to count as flagged (default 2). */
  flagThreshold?: number;
  /** A follow is stagnant if silent longer than this many days (default 90). */
  stagnantDays?: number;
}

export interface FlaggedFollow {
  pubkey: string;
  reporters: number;
}

export interface StagnantFollow {
  pubkey: string;
  lastPostAt: number;
  /** Whole days since the last post (for "~4 months ago" style copy). */
  daysSince: number;
}

export interface FollowHealthResult {
  flagged: FlaggedFollow[];
  stagnant: StagnantFollow[];
}

/**
 * Split the follow list into the flagged and gone-quiet buckets.
 * - flagged  → reporters ≥ threshold, sorted by reporter count desc.
 * - stagnant → last post KNOWN and older than the cutoff, sorted oldest first.
 *   A follow with no known last-post is treated as unknown, never asserted stale.
 * Self and reviewed pubkeys are excluded from both. Duplicates in `follows` are
 * collapsed.
 */
export function computeFollowHealth(input: FollowHealthInput): FollowHealthResult {
  const {
    follows, self, flagReporterCounts, lastPostAt, reviewed, now,
    flagThreshold = DEFAULT_FLAG_THRESHOLD,
    stagnantDays = DEFAULT_STAGNANT_DAYS,
  } = input;

  const cutoff = now - stagnantDays * SECONDS_PER_DAY;
  const seen = new Set<string>();
  const flagged: FlaggedFollow[] = [];
  const stagnant: StagnantFollow[] = [];

  for (const pk of follows) {
    if (!pk || pk === self) continue;
    if (seen.has(pk)) continue;
    seen.add(pk);
    if (reviewed.has(pk)) continue;

    const reporters = flagReporterCounts.get(pk) ?? 0;
    if (reporters >= flagThreshold) {
      flagged.push({ pubkey: pk, reporters });
      // A flagged account takes priority; it isn't also shown as gone-quiet.
      continue;
    }

    const last = lastPostAt.get(pk);
    if (last !== undefined && last > 0 && last < cutoff) {
      stagnant.push({
        pubkey: pk,
        lastPostAt: last,
        daysSince: Math.floor((now - last) / SECONDS_PER_DAY),
      });
    }
  }

  flagged.sort((a, b) => b.reporters - a.reporters || a.pubkey.localeCompare(b.pubkey));
  stagnant.sort((a, b) => a.lastPostAt - b.lastPostAt || a.pubkey.localeCompare(b.pubkey));

  return { flagged, stagnant };
}

/** Total items needing review — powers the calm Tools-row badge. */
export function countNeedingReview(result: FollowHealthResult): number {
  return result.flagged.length + result.stagnant.length;
}
