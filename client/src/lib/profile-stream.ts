/**
 * The Identity-skin profile stream: the person's own notes merged with the
 * ORIGINALS they reposted, newest-first by the time THEY acted.
 *
 * Why this exists as a pure function: the skin's first version filtered
 * reposts out of Posts via repostMap while receiving `allNotes` — an
 * eventStore timeline filtered on `authors: [pubkey]`, which structurally
 * cannot contain a reposted original (it has another author). The filter
 * passed every glance and reposts were simply absent from every chip. A rule
 * that lives in an inline memo can't be tested; this one can.
 *
 * Ordering rule: a repost is timed by WHEN IT WAS REPOSTED (repostMap
 * timestamp), never by the original's created_at — an old article reposted
 * today is today's activity. Own notes keep created_at. Dedup by id guards
 * the self-repost case — and the reposted-twice case: each repost EVENT hands
 * in its original, so a note reposted twice arrived twice and was drawn twice
 * (two identical cards, measured on a live profile 2026-10-01: two kind-6
 * events for one note, 18 minutes apart). One note, one row, at the time of
 * the latest repost (repostMap keeps the newest).
 */
export interface StreamEventLike {
  id: string;
  created_at: number;
}

/** The first of each id, in order. */
export function uniqueById<T extends { id: string }>(events: readonly T[]): T[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

export function mergeProfileStream<T extends StreamEventLike>(
  ownNotes: T[],
  repostedOriginals: T[],
  repostMap: Pick<Map<string, { timestamp: number }>, "get"> | undefined,
): T[] {
  const ownIds = new Set(ownNotes.map((e) => e.id));
  const uniqueReposts = uniqueById(repostedOriginals).filter((e) => !ownIds.has(e.id));
  if (uniqueReposts.length === 0) return ownNotes;
  const timeOf = (e: T) => repostMap?.get(e.id)?.timestamp ?? e.created_at;
  return [...ownNotes, ...uniqueReposts].sort((a, b) => timeOf(b) - timeOf(a));
}
