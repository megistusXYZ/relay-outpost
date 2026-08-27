/**
 * Podcast Index `categories` arrives in two shapes: the current id→name map
 * ({"55":"News"}) and the legacy string array. Every renderer wants names.
 * The map shape reaching array-expecting code was a LIVE CRASH CLASS
 * ("n.categories.forEach is not a function", /search, 2026-08) — normalize at
 * the fetch boundary, never in components.
 */
export function podcastCategoryNames(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (raw && typeof raw === "object") {
    return Object.values(raw).filter((v): v is string => typeof v === "string");
  }
  return [];
}
