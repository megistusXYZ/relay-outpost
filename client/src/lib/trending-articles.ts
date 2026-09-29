import type { ArticleData } from "./nip23";

export interface EngagementStats {
  zapAmount: number;
  replies: number;
  likes: number;
  reposts: number;
}

/** One author at most once in any run of this many. */
const AUTHOR_SPACING = 5;

function engagement(s: EngagementStats): number {
  return (s.zapAmount ? Math.log10(s.zapAmount + 1) * 3 : 0)
    + s.replies * 2
    + s.likes
    + s.reposts * 1.5;
}

/** Engagement per √hour of age, nudged up for a cover image and a summary. */
function hotScore(article: ArticleData, s: EngagementStats, nowSec: number): number {
  const e = engagement(s);
  if (e <= 0) return 0;
  const ageHours = Math.max(1, (nowSec - article.publishedAt) / 3600);
  return (e / Math.sqrt(ageHours)) * (article.image ? 1.15 : 1) * (article.summary ? 1.05 : 1);
}

/**
 * Articles › Trending. Ranked where the engagement numbers are known (an
 * article that came back with none isn't trending). Articles whose numbers
 * haven't arrived (or never will, when Primal is down) are never dropped:
 * they follow, newest first. `ranked` is false when no article has numbers
 * yet, so the page can say it's showing the newest.
 */
export function trendingArticles(
  articles: readonly ArticleData[],
  statsFor: (eventId: string) => EngagementStats | undefined,
  nowSec: number,
): { articles: ArticleData[]; ranked: boolean } {
  const scored: { article: ArticleData; score: number }[] = [];
  const unknown: ArticleData[] = [];
  for (const a of articles) {
    const s = statsFor(a.event.id);
    if (!s) { unknown.push(a); continue; }
    const score = hotScore(a, s, nowSec);
    if (score > 0) scored.push({ article: a, score });
  }
  scored.sort((x, y) => y.score - x.score);

  const ranked: ArticleData[] = [];
  const lastAt = new Map<string, number>();
  for (const { article } of scored) {
    const pk = article.event.pubkey;
    const last = lastAt.get(pk);
    if (last !== undefined && ranked.length - last < AUTHOR_SPACING) continue;
    lastAt.set(pk, ranked.length);
    ranked.push(article);
  }

  unknown.sort((x, y) => y.publishedAt - x.publishedAt);
  return { articles: [...ranked, ...unknown], ranked: scored.length > 0 };
}
