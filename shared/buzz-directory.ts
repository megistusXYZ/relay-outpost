/**
 * Buzz directory parsing. buzz.directory is a Next.js SPA with no public API,
 * but its server-rendered RSC payload carries every community's page href,
 * display name, and access badge. The community's RELAY lives on its detail
 * page's buzz:// deep link — the listing slug is NOT the ws host (the earlier
 * slug-is-the-relay assumption survived NIP-11 checks only because Buzz
 * answers NIP-11 for any subdomain; the ws router is stricter).
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
  /** Public invite code from the community's buzz://join deep link, when it publishes one. */
  inviteCode?: string;
}

const HREF_RE = /\/communities\/([a-z0-9-]+)/g;

/**
 * The community's REAL relay url (and public invite code, when it publishes
 * one), from its detail page's own `buzz://add-community?relay=…` or
 * `buzz://join?relay=…&code=…` deep link.
 *
 * The ws host is NOT derivable from the directory slug: "Virtual Oranges"
 * lists as virtual-oranges-<uuid> but its relay is virtualoranges.…
 * (hyphens dropped), and PlotPickle's relay is plotpickleplayhouse.… — a
 * different name entirely. Meanwhile Buzz's HTTPS side answers NIP-11 for
 * ANY subdomain — a wrong guess gets a live-looking NIP-11 and a dead
 * socket, which is exactly how join requests silently died. Never guess a
 * host; read the page's own claim, or return null.
 */
export function parseBuzzCommunityRelay(html: string): { relayUrl: string; inviteCode?: string } | null {
  const m = html.match(/buzz:\/\/(?:add-community|join)\?relay=(wss?%3A%2F%2F[A-Za-z0-9._%-]+)/);
  if (!m) return null;
  let relayUrl: string;
  try {
    relayUrl = decodeURIComponent(m[1]).replace(/\/+$/, "");
  } catch {
    return null;
  }
  // The code param rides the same deep link (RSC escapes & as &; the
  // href attribute as &amp;).
  const tail = html.slice(m.index! + m[0].length, m.index! + m[0].length + 300);
  const code = tail.match(/(?:&amp;|\\u0026|&)code=([A-Za-z0-9._%+-]+)/);
  return { relayUrl, ...(code ? { inviteCode: decodeURIComponent(code[1]) } : {}) };
}

/**
 * The full directory with every relay url VERIFIED against the community's
 * own detail page. `fetchPage` returns a detail page's html (or null when
 * unreachable); a community whose relay can't be confirmed is dropped —
 * a card pointing at a guessed host is a dead join button wearing a live
 * NIP-11 mask, which is worse than no card for one refresh cycle.
 */
export async function resolveBuzzDirectory(
  directoryHtml: string,
  fetchPage: (slug: string) => Promise<string | null>,
): Promise<BuzzCommunity[]> {
  const listed = parseBuzzDirectory(directoryHtml);
  const resolved = await Promise.all(listed.map(async (c) => {
    const page = await fetchPage(c.slug).catch(() => null);
    const claim = page ? parseBuzzCommunityRelay(page) : null;
    if (!claim) return null;
    return { ...c, relayUrl: claim.relayUrl, ...(claim.inviteCode ? { inviteCode: claim.inviteCode } : {}) };
  }));
  return resolved.filter((c): c is BuzzCommunity => c !== null);
}

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

    // The card's own images stream immediately BEFORE its href (banner, then
    // avatar). Look back to the previous community's href, take the LAST
    // banner/avatar srcs — and never count the directory's /defaults/
    // placeholders as media. (Storage paths are NOT keyed by the slug's uuid —
    // that earlier assumption only held for one community by luck; position is
    // the reliable association, measured across the live page.)
    const back = html.slice(Math.max(0, m.index! - 3000), m.index!);
    const prevHref = back.lastIndexOf("/communities/");
    const backSeg = prevHref !== -1 ? back.slice(prevHref) : back;
    const srcs = [...backSeg.matchAll(/"src\\{0,2}":\\{0,2}"([^"\\]{10,300})/g)].map((t) => t[1].replace(/\\\//g, "/"));
    const notDefault = (u: string) => !/\/defaults\//.test(u);
    const avatar = srcs.filter((u) => /avatar\.[a-z]+(\?|$)/i.test(u) && notDefault(u)).pop();
    const banner = srcs.filter((u) => /banner\.[a-z]+(\?|$)/i.test(u) && notDefault(u)).pop();

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
