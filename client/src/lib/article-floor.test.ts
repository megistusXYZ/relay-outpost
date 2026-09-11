/**
 * Who gets into the Articles Latest and Trending tabs (2026-09-11).
 *
 * Reported with a screenshot: Articles was flooded with adult "leaked" spam.
 * Measured the same evening: 18 of 74 articles on Latest came from accounts
 * with no profile name and no picture. None of them labelled itself (no
 * content-warning tag, no adult hashtag), so only the author can give them
 * away. Articles was also the one discovery feed that skipped the stranger
 * floor the For You feed already applies.
 *
 * The owner's calls: the same earned-trust bar as For You, set by the
 * Open / Balanced / Strict preset; a real profile means a name AND a picture;
 * hidden quietly. People you follow are never filtered.
 */
import { describe, expect, it } from "vitest";
import { articleFloor, floorArticles, recentArticleCounts, type ArticleAuthorFacts, type ArticleFloorLookup } from "./article-floor";

const NOW = 1_789_100_000;

/** A stranger with nothing going for them, whose profile lookup has finished. */
function facts(over: Partial<ArticleAuthorFacts> = {}): ArticleAuthorFacts {
  return {
    isFollowed: false,
    wotScore: undefined,
    flagged: false,
    profile: null,
    profileSettled: true,
    engagementScore: 0,
    firstSeen: null,
    followerCount: undefined,
    powDifficulty: 0,
    signalsAvailable: true,
    articlesInLastDay: 1,
    ...over,
  };
}

describe("articleFloor — who gets into Latest and Trending", () => {
  it("hides an author you don't follow whose profile turned out to have no name and no picture", () => {
    expect(articleFloor(facts(), "balanced", NOW)).toBe("hide");
  });

  it("always shows someone you follow, however bare their profile", () => {
    expect(articleFloor(facts({ isFollowed: true }), "strict", NOW)).toBe("show");
  });

  it("shows an author your web of trust vouches for, even without a picture; a zero score vouches for nothing", () => {
    const namedNoPicture = { name: "A Writer" };
    expect(articleFloor(facts({ wotScore: 0.12, profile: namedNoPicture }), "balanced", NOW)).toBe("show");
    expect(articleFloor(facts({ wotScore: 0, profile: namedNoPicture }), "balanced", NOW)).toBe("hide");
  });

  /**
   * Profiles load after the articles do. "No profile yet" and "no profile at
   * all" look the same for a moment; only a finished lookup can tell them
   * apart, so until then the article waits instead of being thrown away.
   */
  it("holds back an author whose profile is still loading, rather than hiding them", () => {
    expect(articleFloor(facts({ profile: null, profileSettled: false }), "balanced", NOW)).toBe("hold");
  });

  /**
   * A profile alone is cheap to fake. A stranger with a full profile also needs
   * one earned signal, the same bar the For You feed sets (discover-quality.ts):
   * real engagement, an account older than a week or so, enough followers, or
   * proof-of-work. The Open / Balanced / Strict preset moves the bar.
   */
  it("needs a full profile AND one earned signal from a stranger, with the bar set by your preset", () => {
    const real = { name: "A Writer", picture: "https://example.com/me.jpg" };
    const DAY = 86_400;
    expect(articleFloor(facts({ profile: real }), "balanced", NOW)).toBe("hide");
    expect(articleFloor(facts({ profile: real, engagementScore: 3 }), "balanced", NOW)).toBe("show");
    expect(articleFloor(facts({ profile: real, firstSeen: NOW - 10 * DAY }), "balanced", NOW)).toBe("show");
    expect(articleFloor(facts({ profile: real, followerCount: 20 }), "balanced", NOW)).toBe("show");
    expect(articleFloor(facts({ profile: real, powDifficulty: 16 }), "balanced", NOW)).toBe("show");
    // Strict asks for more of the same signals.
    expect(articleFloor(facts({ profile: real, engagementScore: 3 }), "strict", NOW)).toBe("hide");
    expect(articleFloor(facts({ profile: real, firstSeen: NOW - 10 * DAY }), "strict", NOW)).toBe("hide");
  });

  /**
   * Reported the same day with screenshots: "Earth Alliance News" (a full
   * profile, a picture) filled Latest with automated "EA://NEWS" and
   * "EA://INTEL" posts minutes apart. People write 1-3 articles a day at most,
   * usually 1-3 a week; more than 3 in a day reads as a machine. The owner's
   * call: such an author leaves Latest and Trending entirely (their profile
   * still lists everything), and trust doesn't excuse a flood; only following
   * them does.
   */
  it("hides an author you don't follow who publishes more than 3 articles in a day, whatever their trust or profile", () => {
    const real = { name: "Earth Alliance News", picture: "https://example.com/logo.png" };
    expect(articleFloor(facts({ profile: real, wotScore: 0.4, articlesInLastDay: 4 }), "open", NOW)).toBe("hide");
    expect(articleFloor(facts({ profile: real, wotScore: 0.4, articlesInLastDay: 3 }), "balanced", NOW)).toBe("show");
    expect(articleFloor(facts({ isFollowed: true, articlesInLastDay: 10 }), "strict", NOW)).toBe("show");
  });

  it("hides an author your network flagged, even with a full profile and trust, unless you follow them", () => {
    const real = { name: "A Writer", picture: "https://example.com/me.jpg" };
    expect(articleFloor(facts({ profile: real, wotScore: 0.3, engagementScore: 20, flagged: true }), "open", NOW)).toBe("hide");
    expect(articleFloor(facts({ isFollowed: true, flagged: true }), "balanced", NOW)).toBe("show");
  });

  /**
   * Engagement and follower counts come from Primal. When Primal can't be
   * reached they're simply missing, so every stranger would fail the earned-
   * signal bar and Latest would go blank: an empty screen claiming there's
   * nothing to read. Discover met the same trap (discover-data.ts floorTeaser)
   * and steps down to a lighter floor; so does this. The checks that don't
   * lean on Primal still apply.
   */
  it("steps down to the profile, flag and pace checks when engagement and follower counts can't be fetched", () => {
    const real = { name: "A Writer", picture: "https://example.com/me.jpg" };
    const noSignals = { signalsAvailable: false };
    expect(articleFloor(facts({ ...noSignals, profile: real }), "balanced", NOW)).toBe("show");
    expect(articleFloor(facts({ ...noSignals }), "balanced", NOW)).toBe("hide");
    expect(articleFloor(facts({ ...noSignals, profile: real, flagged: true }), "balanced", NOW)).toBe("hide");
    expect(articleFloor(facts({ ...noSignals, profile: real, articlesInLastDay: 4 }), "balanced", NOW)).toBe("hide");
  });
});

/**
 * The pace behind the 3-a-day rule, counted from the articles the feed has
 * loaded (no extra requests). An article is one piece of writing, not one
 * version: editing republishes it under the same "d" tag, and a writer who
 * revises a piece five times has still written one article. What counts is
 * when it was first published.
 */
describe("recentArticleCounts — how many articles each author published in the last day", () => {
  const HOUR = 3600;
  const article = (pubkey: string, d: string, createdAt: number, publishedAt?: number) => ({
    pubkey,
    created_at: createdAt,
    tags: [["d", d], ...(publishedAt ? [["published_at", String(publishedAt)]] : [])],
  });

  it("counts each author's distinct articles first published in the 24 hours before now", () => {
    const counts = recentArticleCounts(
      [
        article("flooder", "a", NOW - 1 * HOUR),
        article("flooder", "b", NOW - 2 * HOUR),
        article("flooder", "c", NOW - 3 * HOUR),
        article("flooder", "d", NOW - 4 * HOUR),
        article("writer", "essay", NOW - 5 * HOUR),
        article("writer", "old", NOW - 30 * HOUR),
      ],
      NOW,
    );
    expect(counts.get("flooder")).toBe(4);
    expect(counts.get("writer")).toBe(1);
  });

  it("counts an article edited several times once, and an old article edited today not at all", () => {
    const counts = recentArticleCounts(
      [
        article("writer", "essay", NOW - 1 * HOUR),
        article("writer", "essay", NOW - 2 * HOUR),
        article("writer", "essay", NOW - 3 * HOUR),
        article("writer", "last-week", NOW - 1 * HOUR, NOW - 7 * 24 * HOUR),
      ],
      NOW,
    );
    expect(counts.get("writer")).toBe(1);
  });
});

/**
 * The same floor wherever articles are shown (2026-09-11): the Discover
 * Articles card still showed the flooders and nameless accounts the Articles
 * page had stopped showing, because it ran only a title-and-length check.
 */
describe("floorArticles — one floor for every surface that shows articles", () => {
  const H = 3600;
  const piece = (pubkey: string, d: string, ago: number) => ({ pubkey, created_at: NOW - ago, tags: [["d", d]] });
  const full = { name: "Writer", picture: "https://example.com/w.png" };

  function lookup(over: Partial<ArticleFloorLookup> = {}): ArticleFloorLookup {
    const profiles: Record<string, ArticleAuthorFacts["profile"]> = {
      flooder: full, trusted: full, followed: null, nameless: {},
    };
    return {
      isFollowed: (pk) => pk === "followed",
      wotScore: (pk) => (pk === "flooder" || pk === "trusted" ? 5 : undefined),
      flagged: () => false,
      profile: (pk) => profiles[pk] ?? null,
      profileSettled: (pk) => pk !== "loading",
      engagementScore: () => 0,
      firstSeen: () => null,
      followerCount: () => undefined,
      powDifficulty: () => 0,
      signalsAvailable: true,
      ...over,
    };
  }

  it("keeps, in order, only what passes: no floods, no nameless strangers; people you follow always", () => {
    const flood = [1, 2, 3, 4].map((n) => piece("flooder", `f${n}`, n * H));
    const followed = piece("followed", "mine", 5 * H);
    const nameless = piece("nameless", "n", 6 * H);
    const trusted = piece("trusted", "t", 7 * H);
    const { shown } = floorArticles([...flood, followed, nameless, trusted], lookup(), "balanced", NOW);
    expect(shown).toEqual([followed, trusted]);
  });

  it("counts the authors still loading, so a surface can wait instead of showing too little", () => {
    const { shown, holding } = floorArticles([piece("loading", "l", H), piece("trusted", "t", 2 * H)], lookup(), "balanced", NOW);
    expect(shown.map((a) => a.pubkey)).toEqual(["trusted"]);
    expect(holding).toBe(1);
  });
});
