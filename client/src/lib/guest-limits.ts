/**
 * What a signed-out visitor gets: THE THING THE LINK POINTS TO, plus a taste.
 *
 * The rule (owner call, 2026-08-13): a shared link must show the post/article/
 * room it names — that is the share's whole value and the invite flow rides on
 * it — but EXPLORING past it is for members. Legacy-social alignment: X and
 * Instagram render the linked content and wall the browse; search is walled
 * outright because it is pure exploration.
 *
 * Deliberately NOT gated: single threads, article pages, the outpost/room
 * guest previews (the pilot's front door), profiles (already reduced to a
 * guest view), and the guides — the pages that explain the product should
 * never sit behind it.
 */

/** List items a guest sees before the wall card ends the scroll. */
export const GUEST_TASTE_COUNT = 8;

export interface GuestCapped<T> {
  shown: T[];
  /** True when items were held back — the caller renders the wall card. */
  walled: boolean;
}

/**
 * Cap a list for guests. Signed-in (or an uncapped surface) passes through
 * untouched — including the empty list, so empty-state logic never changes.
 */
export function capForGuest<T>(items: T[], loggedIn: boolean, cap: number = GUEST_TASTE_COUNT): GuestCapped<T> {
  if (loggedIn || items.length <= cap) return { shown: items, walled: false };
  return { shown: items.slice(0, cap), walled: true };
}

/**
 * Pages a signed-out visitor may look around, to read (owner decision
 * 2026-09-28, loosening the 2026-08-14 hard wall): Discover and News, so people
 * can see what's here before signing up. Chats, communities and search stay
 * membership. Any action inside an open page still asks them to sign up.
 */
const GUEST_BROWSABLE = ["/discover", "/news"];

export function guestCanBrowse(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return GUEST_BROWSABLE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
