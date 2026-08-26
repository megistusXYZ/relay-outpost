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
 * the self-repost case.
 */
export interface StreamEventLike {
  id: string;
  created_at: number;
}

export function mergeProfileStream<T extends StreamEventLike>(
  ownNotes: T[],
  repostedOriginals: T[],
  repostMap: Pick<Map<string, { timestamp: number }>, "get"> | undefined,
): T[] {
  const ownIds = new Set(ownNotes.map((e) => e.id));
  const uniqueReposts = repostedOriginals.filter((e) => !ownIds.has(e.id));
  if (uniqueReposts.length === 0) return ownNotes;
  const timeOf = (e: T) => repostMap?.get(e.id)?.timestamp ?? e.created_at;
  return [...ownNotes, ...uniqueReposts].sort((a, b) => timeOf(b) - timeOf(a));
}
