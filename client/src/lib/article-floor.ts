/**
 * Who gets into the Articles Latest and Trending tabs.
 *
 * Articles was flooded with unlabelled adult spam from accounts with no name
 * and no picture, and it was the one discovery feed that skipped the stranger
 * floor For You applies. This is that floor for articles: people you follow
 * always show; anyone else needs a real profile (a name AND a picture) and,
 * by the Open / Balanced / Strict preset, one earned signal. Held-back
 * articles are simply not shown. See article-floor.test.ts.
 */
import type { StrictnessPreset } from "./trust-preset";
import { admitStranger, getDiscoverPresetConfig } from "./discover-quality";

/**
 * - "show": in the feed.
 * - "hold": not yet: the author's profile is still loading. Re-decided when it
 *   arrives, so a slow-loading genuine writer is never dropped by mistake.
 * - "hide": not in the feed.
 */
export type ArticleFloorDecision = "show" | "hold" | "hide";

/** What we know about an article's author when deciding. */
export interface ArticleAuthorFacts {
  /** You follow them (or it's you): never filtered. */
  isFollowed: boolean;
  /** GrapeRank influence; undefined = unscored, or trust isn't ready yet. */
  wotScore: number | undefined;
  /** Flagged by your network. */
  flagged: boolean;
  /** Their profile (kind-0 content), or null when none is in hand. */
  profile: { name?: string; display_name?: string; picture?: string } | null;
  /** The profile lookup has finished, whether or not it found one. */
  profileSettled: boolean;
  /** Engagement on this article (lib/engagement.ts). 0 without stats. */
  engagementScore: number;
  /** Earliest evidence of the account (unix seconds); null = unknown. */
  firstSeen: number | null;
  /** Follower count; undefined = unknown. */
  followerCount: number | undefined;
  /** NIP-13 proof-of-work bits on this article. */
  powDifficulty: number;
  /** Engagement and follower counts could be fetched (Primal answered). */
  signalsAvailable: boolean;
  /** How many of their articles in the feed were published in the 24 hours before now. */
  articlesInLastDay: number;
}

/**
 * People write 1-3 articles a day at most, usually 1-3 a week (the owner,
 * 2026-09-11). More than this in a day is a machine's pace, not a writer's.
 */
const MAX_ARTICLES_PER_DAY = 3;

/** An article as the feed holds it: enough to tell who wrote which piece, and when. */
export interface ArticleStamp {
  pubkey: string;
  created_at: number;
  tags: string[][];
}

const DAY_SECONDS = 86_400;

/**
 * How many distinct articles each author first published in the 24 hours
 * before now, counted from the articles the feed has loaded (no requests).
 * One article is one "d" tag: editing republishes it, and an edit isn't a new
 * article. First publication is the published_at tag when present, otherwise
 * the event time; a date in the future counts as today, so it can't hide a
 * flood. Feeds the 3-a-day pace rule in articleFloor.
 */
export function recentArticleCounts(articles: ArticleStamp[], nowSeconds: number): Map<string, number> {
  const firstPublished = new Map<string, { pubkey: string; at: number }>();
  for (const a of articles) {
    const d = a.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const tagged = Number(a.tags.find((t) => t[0] === "published_at")?.[1]);
    const at = Number.isFinite(tagged) && tagged > 0 ? tagged : a.created_at;
    const key = `${a.pubkey}:${d}`;
    const seen = firstPublished.get(key);
    if (!seen || at < seen.at) firstPublished.set(key, { pubkey: a.pubkey, at });
  }
  const counts = new Map<string, number>();
  for (const { pubkey, at } of firstPublished.values()) {
    if (nowSeconds - at > DAY_SECONDS) continue;
    counts.set(pubkey, (counts.get(pubkey) ?? 0) + 1);
  }
  return counts;
}

function hasRealProfile(profile: ArticleAuthorFacts["profile"]): boolean {
  const name = (profile?.name || profile?.display_name || "").trim();
  const picture = (profile?.picture || "").trim();
  return name.length > 0 && picture.length > 0;
}

export function articleFloor(
  facts: ArticleAuthorFacts,
  preset: StrictnessPreset,
  nowSeconds: number,
): ArticleFloorDecision {
  // People you follow are your choice, whatever their profile says.
  if (facts.isFollowed) return "show";
  // A flood is a flood, whoever sends it: trust doesn't excuse a machine's
  // pace, only following the author does (above).
  if (facts.articlesInLastDay > MAX_ARTICLES_PER_DAY) return "hide";
  // Your network flagged them: that outweighs a trust score here, as it does in
  // the shared spam filter for anyone you don't follow.
  if (facts.flagged) return "hide";
  // Positive web of trust is your network vouching for them, profile or not.
  if (facts.wotScore !== undefined && facts.wotScore > 0) return "show";
  // No profile YET is not no profile at all: wait for the lookup to finish.
  if (facts.profile === null && !facts.profileSettled) return "hold";
  if (!hasRealProfile(facts.profile)) return "hide";
  // Engagement and follower counts come from Primal. Without them every
  // stranger would fail the bar below and Latest would go blank, so step down
  // to the checks above (as Discover does, discover-data.ts floorTeaser).
  if (!facts.signalsAvailable) return "show";
  // A profile alone is cheap to fake: a stranger also needs one earned signal,
  // the For You feed's bar at your preset (discover-quality.ts admitStranger).
  const admitted = admitStranger({
    isInNetwork: false,
    wotScore: facts.wotScore,
    engagementScore: facts.engagementScore,
    powDifficulty: facts.powDifficulty,
    firstSeen: facts.firstSeen,
    followerCount: facts.followerCount,
    nowSeconds,
    config: getDiscoverPresetConfig(preset),
  });
  return admitted ? "show" : "hide";
}

/** Where a surface looks up the facts about each article and its author. */
export interface ArticleFloorLookup<T extends ArticleStamp = ArticleStamp> {
  isFollowed(pubkey: string): boolean;
  wotScore(pubkey: string): number | undefined;
  flagged(pubkey: string): boolean;
  profile(pubkey: string): ArticleAuthorFacts["profile"];
  profileSettled(pubkey: string): boolean;
  engagementScore(article: T): number;
  firstSeen(pubkey: string): number | null;
  followerCount(pubkey: string): number | undefined;
  powDifficulty(article: T): number;
  signalsAvailable: boolean;
}

/**
 * The floor over a whole list, for every surface that shows articles (the
 * Articles page and the Discover Articles card), so none of them shows what
 * another hides. Order is kept. `holding` counts articles whose author's
 * profile is still loading, so a surface can wait rather than show too little.
 * The pace rule counts from the list it is given.
 */
export function floorArticles<T extends ArticleStamp>(
  articles: T[],
  look: ArticleFloorLookup<T>,
  preset: StrictnessPreset,
  nowSeconds: number,
): { shown: T[]; holding: number } {
  const pace = recentArticleCounts(articles, nowSeconds);
  const shown: T[] = [];
  let holding = 0;
  for (const a of articles) {
    const decision = articleFloor(
      {
        isFollowed: look.isFollowed(a.pubkey),
        wotScore: look.wotScore(a.pubkey),
        flagged: look.flagged(a.pubkey),
        profile: look.profile(a.pubkey),
        profileSettled: look.profileSettled(a.pubkey),
        engagementScore: look.engagementScore(a),
        firstSeen: look.firstSeen(a.pubkey),
        followerCount: look.followerCount(a.pubkey),
        powDifficulty: look.powDifficulty(a),
        signalsAvailable: look.signalsAvailable,
        articlesInLastDay: pace.get(a.pubkey) ?? 0,
      },
      preset,
      nowSeconds,
    );
    if (decision === "show") shown.push(a);
    else if (decision === "hold") holding++;
  }
  return { shown, holding };
}
