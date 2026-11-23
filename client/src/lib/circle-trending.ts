/**
 * Trending in your circle (owner, 2026-11-23). Home's Trending is ranked by
 * us, from the reader's own network, not by an outside chart of everyone.
 *
 * A post is a candidate when its author is in the reader's circle: someone
 * they follow, or, with the wider network on, someone their network vouches
 * for (lib/article-band.ts decides that; the caller passes it as `inCircle`).
 * It rises by how many DIFFERENT people in the circle replied to, reposted,
 * liked or zapped it. One person counts once whatever they did, strangers
 * count for nothing, and neither the author nor the reader counts as the
 * circle talking. Two people is the least that is a trend.
 *
 * Order: people divided by the square root of the post's age (plus two
 * hours, so a minute-old post is not infinitely hot); ties go to the newer.
 */
export type InteractionKind = "reply" | "repost" | "like" | "zap";

export interface Interaction {
  /** The post reacted to. */
  eventId: string;
  /** Who reacted. */
  by: string;
  kind: InteractionKind;
}

export interface CircleSignals {
  me: string | null | undefined;
  isFollowed: (pubkey: string) => boolean;
  /** Followed, or vouched for when the wider network is on. */
  inCircle: (pubkey: string) => boolean;
}

export interface TrendingRow<T> {
  post: T;
  /** Distinct people in the circle who reacted. */
  people: number;
  /** One quiet line saying why it is here. Counts of reactions, never a number on a person. */
  reason: string;
}

/** The least number of distinct people that makes a trend. */
export const MIN_CIRCLE_PEOPLE = 2;

const KIND_ORDER: InteractionKind[] = ["reply", "repost", "zap", "like"];

function reasonFor(byKind: Map<InteractionKind, Set<string>>, everyone: Set<string>, isFollowed: (pk: string) => boolean): string {
  let top: InteractionKind | null = null;
  for (const kind of KIND_ORDER) {
    const n = byKind.get(kind)?.size ?? 0;
    if (n >= MIN_CIRCLE_PEOPLE && (top === null || n > (byKind.get(top)?.size ?? 0))) top = kind;
  }
  const people = top ? byKind.get(top)! : everyone;
  const n = people.size;
  const who = Array.from(people).every(isFollowed) ? `${n} people you follow` : `${n} in your circle`;
  switch (top) {
    case "reply": return `${who} replied`;
    case "repost": return `Reposted by ${who}`;
    case "zap": return `Zapped by ${who}`;
    case "like": return `${who} liked this`;
    default: return `${who} reacted`;
  }
}

export function rankCircleTrending<T extends { id: string; pubkey: string; created_at: number }>(
  posts: readonly T[],
  interactions: readonly Interaction[],
  circle: CircleSignals,
  now: number,
): TrendingRow<T>[] {
  const candidates = new Map<string, T>();
  for (const p of posts) {
    if (p.pubkey === circle.me) continue;
    if (!circle.inCircle(p.pubkey)) continue;
    candidates.set(p.id, p);
  }

  const reacted = new Map<string, { everyone: Set<string>; byKind: Map<InteractionKind, Set<string>> }>();
  for (const i of interactions) {
    const post = candidates.get(i.eventId);
    if (!post) continue;
    if (i.by === post.pubkey || i.by === circle.me) continue;
    if (!circle.inCircle(i.by)) continue;
    let r = reacted.get(i.eventId);
    if (!r) { r = { everyone: new Set(), byKind: new Map() }; reacted.set(i.eventId, r); }
    r.everyone.add(i.by);
    let k = r.byKind.get(i.kind);
    if (!k) { k = new Set(); r.byKind.set(i.kind, k); }
    k.add(i.by);
  }

  const rows: (TrendingRow<T> & { heat: number })[] = [];
  for (const [id, r] of reacted) {
    if (r.everyone.size < MIN_CIRCLE_PEOPLE) continue;
    const post = candidates.get(id)!;
    const hours = Math.max(0, now - post.created_at) / 3600;
    rows.push({ post, people: r.everyone.size, reason: reasonFor(r.byKind, r.everyone, circle.isFollowed), heat: r.everyone.size / Math.sqrt(hours + 2) });
  }
  rows.sort((a, b) => b.heat - a.heat || b.post.created_at - a.post.created_at);
  return rows.map(({ post, people, reason }) => ({ post, people, reason }));
}
