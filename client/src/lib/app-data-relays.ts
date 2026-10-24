/**
 * Where your app data lives (settings, news bookmarks, read marks: kind
 * 30078). Written to your own relays only, never to a community: a community
 * relay is someone else's space, and publishing there also signs you in to
 * it, which would override "Ask first". Read from your relays, then your
 * communities, so a copy that landed there earlier is still found.
 * (Pre-deploy sweep 2026-10-24: with one default fewer, the syncs' "first six
 * of defaults, then communities" started writing to a community.)
 */

const MAX_WRITE = 6;

export function appDataRelays(
  mode: "read" | "write",
  deps: {
    /** Your relays: the active defaults and any you added. */
    active: readonly string[];
    /** Your communities' relays. */
    communities: readonly string[];
    filter: (urls: string[]) => string[];
    fallback: readonly string[];
  },
): string[] {
  const own = deps.filter([...new Set(deps.active)]);
  if (mode === "write") return own.length > 0 ? own.slice(0, MAX_WRITE) : deps.filter([...deps.fallback]);
  const all = deps.filter([...new Set([...deps.active, ...deps.communities])]);
  return all.length > 0 ? all : deps.filter([...deps.fallback]);
}
