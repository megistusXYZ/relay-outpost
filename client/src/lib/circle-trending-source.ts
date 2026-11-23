/**
 * Where "Trending in your circle" gets its material (owner, 2026-11-23).
 *
 * Two questions to the relays: what did the people you follow reply to,
 * repost or like in the time span; then, for the posts at least two of them
 * reacted to, the posts themselves. That finds posts by vouched writers too,
 * because your follows reacted to them. lib/circle-trending.ts then decides
 * what trends and in what order.
 *
 * Only people you FOLLOW can be asked about: a vouched circle runs to
 * thousands of people, more than a relay will take in one question. Zaps are
 * left out for now: a zap receipt is written by the wallet service, not by
 * the person who zapped.
 *
 * Three outcomes, kept apart (RELAY_REACHABILITY.md): posts, an answer with
 * nothing in it, and no relay answered.
 */
import type { Event } from "nostr-tools";
import type { Interaction } from "./circle-trending";
import { MIN_CIRCLE_PEOPLE } from "./circle-trending";

/** Authors per relay question: relays refuse very long author lists. */
const AUTHOR_CHUNK = 250;
/** Reactions asked for per chunk of authors. */
const REACTIONS_PER_CHUNK = 500;
/** The most posts fetched for ranking. */
const MAX_POSTS = 120;

type Query = (relays: string[], filter: Record<string, unknown>) => Promise<{ events: Event[]; answered: boolean }>;

/** What each event says its author reacted to. */
export function interactionsFrom(events: readonly Event[]): Interaction[] {
  const out: Interaction[] = [];
  for (const e of events) {
    const es = e.tags.filter((t) => t[0] === "e" && t[1]);
    if (es.length === 0) continue;
    if (e.kind === 7) {
      if (e.content === "-") continue; // a dislike is not the circle lifting a post
      out.push({ eventId: es[es.length - 1][1], by: e.pubkey, kind: "like" });
    } else if (e.kind === 6) {
      out.push({ eventId: es[es.length - 1][1], by: e.pubkey, kind: "repost" });
    } else if (e.kind === 1) {
      // A reply counts for the conversation it is in. A quote ("mention") is not a reply.
      const threaded = es.filter((t) => t[3] !== "mention");
      if (threaded.length === 0) continue;
      const root = threaded.find((t) => t[3] === "root") ?? threaded[0];
      out.push({ eventId: root[1], by: e.pubkey, kind: "reply" });
    }
  }
  return out;
}

/** Posts at least two different people reacted to: most people first, capped. */
export function postsWorthFetching(interactions: readonly Interaction[], cap: number): string[] {
  const people = new Map<string, Set<string>>();
  for (const i of interactions) {
    let s = people.get(i.eventId);
    if (!s) { s = new Set(); people.set(i.eventId, s); }
    s.add(i.by);
  }
  return Array.from(people.entries())
    .filter(([, s]) => s.size >= MIN_CIRCLE_PEOPLE)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, cap)
    .map(([id]) => id);
}

/** How many times one group of authors is asked for older reactions. */
const MAX_PAGES = 5;

export async function fetchCircleTrending(opts: {
  follows: readonly string[];
  /** Seconds since epoch: reactions from here on. */
  since: number;
  relays: string[];
  query: Query;
  maxPages?: number;
}): Promise<{
  reached: boolean;
  posts: Event[];
  interactions: Interaction[];
  /**
   * How far back the reactions really go. Equal to `since` when the span was
   * covered. Later than `since` when a busy circle filled every question and
   * the asking stopped: the list then covers less than the span it is named
   * for, and the page says so.
   */
  coveredSince: number;
}> {
  const { follows, since, relays, query } = opts;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  if (follows.length === 0) return { reached: true, posts: [], interactions: [], coveredSince: since };

  // A relay returns only its newest few hundred events per question (found on
  // live relays, 2026-11-23: one question for a week came back with 35 hours).
  // So each group of authors is asked again for older reactions until a
  // question comes back less than full, the span is covered, or the limit.
  const reactionsOf = async (authors: string[]) => {
    const events: Event[] = [];
    let answered = false;
    let until: number | undefined;
    let covered = since;
    for (let page = 0; page < maxPages; page++) {
      const a = await query(relays, { kinds: [1, 6, 7], authors, since, limit: REACTIONS_PER_CHUNK, ...(until !== undefined ? { until } : {}) });
      answered = answered || a.answered;
      events.push(...a.events);
      if (a.events.length < REACTIONS_PER_CHUNK) { covered = since; break; }
      const oldest = Math.min(...a.events.map((e) => e.created_at));
      if (oldest <= since) { covered = since; break; }
      covered = oldest;
      until = oldest - 1;
    }
    return { events, answered, covered };
  };

  const chunks: string[][] = [];
  for (let i = 0; i < follows.length; i += AUTHOR_CHUNK) chunks.push(follows.slice(i, i + AUTHOR_CHUNK));
  const answers = await Promise.all(chunks.map(reactionsOf));
  const reached = answers.some((a) => a.answered);
  const coveredSince = Math.max(since, ...answers.map((a) => a.covered));
  const interactions = interactionsFrom(answers.flatMap((a) => a.events));
  if (!reached) return { reached: false, posts: [], interactions, coveredSince };

  const ids = postsWorthFetching(interactions, MAX_POSTS);
  if (ids.length === 0) return { reached: true, posts: [], interactions, coveredSince };
  const got = await query(relays, { ids });
  // The reactions answered; if the posts did not, that is "not reached", not "nothing trending".
  if (!got.answered && got.events.length === 0) return { reached: false, posts: [], interactions, coveredSince };
  return { reached: true, posts: got.events, interactions, coveredSince };
}

/**
 * What to say when the list covers less than the span it is named for: a busy
 * circle filled every question before the span was reached. Null when the
 * span was covered, give or take two hours.
 */
export function coverageNote(since: number, coveredSince: number, now: number): string | null {
  if (coveredSince - since < 2 * 3600) return null;
  const hours = Math.max(1, Math.round((now - coveredSince) / 3600));
  const span = hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
  return `Your circle has been busy: this covers the last ${span}.`;
}
