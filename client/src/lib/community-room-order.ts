/**
 * The order a community's rooms are listed in, shared by the room list and the
 * rooms side of an open room: pinned first, then rooms you've joined, then the
 * most recently active. Pure.
 */

export function orderRooms<R extends { id: string }>(
  rooms: readonly R[],
  by: { pinned: ReadonlySet<string>; joined: ReadonlySet<string>; activity: Readonly<Record<string, number>> },
): R[] {
  const rank = (r: R) => [by.pinned.has(r.id) ? 1 : 0, by.joined.has(r.id) ? 1 : 0, by.activity[r.id] ?? 0];
  return [...rooms].sort((a, b) => {
    const [ap, aj, at] = rank(a);
    const [bp, bj, bt] = rank(b);
    return bp - ap || bj - aj || bt - at;
  });
}

/**
 * The rooms beside an open room: yours (pinned and joined), in list order, not
 * every room on the server, plus the room you're in when it's neither. The
 * full list stays one tap away ("All rooms").
 */
export function sideRooms<R extends { id: string }>(
  rooms: readonly R[],
  by: { pinned: ReadonlySet<string>; joined: ReadonlySet<string>; activity: Readonly<Record<string, number>> },
  currentId: string,
): R[] {
  const mine = orderRooms(rooms.filter((r) => by.pinned.has(r.id) || by.joined.has(r.id)), by);
  const current = rooms.find((r) => r.id === currentId);
  return current && !mine.some((r) => r.id === currentId) ? [...mine, current] : mine;
}
