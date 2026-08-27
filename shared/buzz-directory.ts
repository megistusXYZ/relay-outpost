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
    bySlug.set(slug, {
      slug,
      name: name.trim(),
      relayUrl: `wss://${slug}.communities.buzz.xyz`,
      access: /invite/i.test(badge) ? "invite" : /^pub/i.test(badge) ? "public" : null,
    });
  }
  return [...bySlug.values()];
}
