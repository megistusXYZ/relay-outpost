/**
 * The profile's "N articles": once our own list has answered (one entry per
 * article address, newest version), it is the count. The index's number
 * counts every version of an edited article, so it only stands in before
 * our list answers (owner, 2026-10-12: "2 articles" over a list of one).
 */
export function articleCountToShow(o: { loaded: boolean; ours: number; index: number | undefined }): number | undefined {
  return o.loaded ? o.ours : o.index;
}
