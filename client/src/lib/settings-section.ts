/**
 * Which Settings section to show. Settings shows one section at a time, so
 * the address decides: `?section=<id>` from the section picker, or an anchor
 * from a link written when Settings was one long page (/settings#news-alerts),
 * which opens the section that holds it.
 */

/** Anchors inside a section that other screens link to, and their section. */
const ANCHOR_SECTIONS: Record<string, string> = {
  "news-alerts": "feed",
  "content-prefs": "feed",
};

export function settingsSectionFor(
  location: { search: string; hash: string },
  available: readonly string[],
): string {
  const fallback = available[0] ?? "";
  const named = new URLSearchParams(location.search).get("section");
  if (named && available.includes(named)) return named;
  const anchor = location.hash.replace(/^#/, "");
  const fromAnchor = ANCHOR_SECTIONS[anchor] ?? anchor;
  if (fromAnchor && available.includes(fromAnchor)) return fromAnchor;
  return fallback;
}
