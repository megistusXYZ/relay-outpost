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
