/**
 * Buzz directory parsing. buzz.directory is a Next.js SPA with no public API,
 * but its server-rendered RSC payload carries every community's page href,
 * display name, and access badge — and each community slug IS a relay:
 * wss://<slug>.communities.buzz.xyz (verified via NIP-11, 2026-08-27; our own
 * relayop community lives on the same pattern).
 */

export interface BuzzCommunity {
  slug: string;
  name: string;
  relayUrl: string;
  access: "public" | "invite" | null;
  /** The directory's own copy/media — absent when the card carries none. */
  description?: string;
  avatar?: string;
  banner?: string;
}

const HREF_RE = /\/communities\/([a-z0-9-]+)/g;

export function parseBuzzDirectory(html: string): BuzzCommunity[] {
  const bySlug = new Map<string, BuzzCommunity>();
  for (const m of html.matchAll(HREF_RE)) {
    const slug = m[1];
    if (bySlug.has(slug)) continue;
    // The display name and access badge stream as `"children":"<text>"` right
    // after the href in the RSC payload (escaped quotes in the raw document).
    // The window ends at the NEXT community href — a neighbor's badge must
    // never bleed into this entry.
    const start = m.index! + m[0].length;
    let ctx = html.slice(start, start + 600);
    const nextHref = ctx.indexOf("/communities/");
    if (nextHref !== -1) ctx = ctx.slice(0, nextHref);
    const texts = [...ctx.matchAll(/"children\\?":\\?"([^"\\$}{]{1,60})/g)].map((t) => t[1]);
    const name = texts.find((t) => !/^(Invite|Public|Pub)$/i.test(t));
    if (!name) continue;
    const badge = texts.find((t) => /^(Invite|Public|Pub)$/i.test(t)) || "";

    // The card's description streams as a LONG children string a few THOUSAND
    // chars after the href (measured 3.2k on the live page) — a wider window
    // than the name/badge one, still bounded at the next community's href.
    // Tolerates 1-2 escaping backslashes (the RSC payload double-escapes).
    let wide = html.slice(start, start + 6000);
    const wideNext = wide.indexOf("/communities/");
    if (wideNext !== -1) wide = wide.slice(0, wideNext);
    const longs = [...wide.matchAll(/"children\\{0,2}":\\{0,2}"([^"\\]{40,300})/g)].map((t) => t[1]);
    const description = longs.find((t) => t !== name);

    // Avatar/banner live in supabase storage keyed by the community's uuid —
    // the slug's 32-hex suffix, re-hyphenated. Search the WHOLE document:
    // the images render before the href, outside this entry's context window.
    const hex = slug.match(/([0-9a-f]{32})$/)?.[1];
    let avatar: string | undefined;
    let banner: string | undefined;
    if (hex) {
      const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      avatar = html.match(new RegExp(`https?:[^"\\\\\\s]*${uuid}[^"\\\\\\s]*avatar[^"\\\\\\s]*`))?.[0]?.replace(/\\\//g, "/");
      banner = html.match(new RegExp(`https?:[^"\\\\\\s]*${uuid}[^"\\\\\\s]*banner[^"\\\\\\s]*`))?.[0]?.replace(/\\\//g, "/");
    }

    bySlug.set(slug, {
      slug,
      name: name.trim(),
      relayUrl: `wss://${slug}.communities.buzz.xyz`,
      access: /invite/i.test(badge) ? "invite" : /^pub/i.test(badge) ? "public" : null,
      ...(description ? { description } : {}),
      ...(avatar ? { avatar } : {}),
      ...(banner ? { banner } : {}),
    });
  }
  return [...bySlug.values()];
}
