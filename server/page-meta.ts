/**
 * What a public page says about itself to a visitor that does not run the
 * app: a search engine's first fetch, or the scraper behind a link preview in
 * a chat. The app is one HTML shell for every address, so without this every
 * page introduced itself as the home page: the same title, the same
 * description, no address of its own, and a share image given as a relative
 * path that several scrapers do not resolve.
 *
 * The pages and their words are one table, shared with the app
 * (shared/public-pages.ts). Here it feeds two things, so they cannot drift:
 *   - the shell's <head>, rewritten per page for crawlers (applyPageMeta)
 *   - the sitemap (sitemapXml)
 *
 * The signed-out Live, Images, Videos and Audio addresses show the landing, so
 * they are not in it: listing them told a search engine that five addresses
 * were the same page.
 */
import { PUBLIC_PAGES, SHARE_IMAGE, SITE_NAME, SITE_ORIGIN, publicPagePath, type PageMeta } from "@shared/public-pages";

export { PUBLIC_PAGES, SHARE_IMAGE, SITE_NAME, SITE_ORIGIN, publicPagePath, type PageMeta };


export function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The app's shell with its <head> saying what THIS page is: its own title and
 * description, its address as the canonical link and og:url, and the share
 * image as a full address. Returns null for an address that is not a public
 * page, or a shell this does not recognise (the caller then serves the shell
 * as it is).
 *
 * Every tag it rewrites is one the shell is known to have exactly once; if one
 * is missing the shell has changed shape and nothing is rewritten, so a page
 * is never served half-described.
 */
export function applyPageMeta(shell: string, path: string): string | null {
  const key = publicPagePath(path);
  if (!key) return null;
  const meta = PUBLIC_PAGES[key];
  const title = escapeAttr(meta.title), description = escapeAttr(meta.description);
  const url = escapeAttr(`${SITE_ORIGIN}${key === "/" ? "/" : key}`);
  const image = escapeAttr(`${SITE_ORIGIN}${SHARE_IMAGE.path}`);

  const swaps: [RegExp, string][] = [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
    [/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${description}" />`],
    [/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${title}" />`],
    [/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${description}" />`],
    [/<meta property="og:image" content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${image}" />`],
    [/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${title}" />`],
    [/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${description}" />`],
    [/<meta name="twitter:image" content="[^"]*"\s*\/?>/, `<meta name="twitter:image" content="${image}" />`],
    // The page's own address goes in beside its type.
    [/<meta property="og:type" content="[^"]*"\s*\/?>/, `<meta property="og:type" content="website" />\n    <meta property="og:url" content="${url}" />\n    <link rel="canonical" href="${url}" />`],
  ];
  let out = shell;
  for (const [find, put] of swaps) {
    const hits = out.match(new RegExp(find.source, "g"));
    if (!hits || hits.length !== 1) return null;
    // A function, so "$" in a title or description is never read as a replacement pattern.
    out = out.replace(find, () => put);
  }
  return out;
}

/** The sitemap: every public page, once, at the site's one address. */
export function sitemapXml(today: string): string {
  const urls = Object.entries(PUBLIC_PAGES).map(([path, meta]) =>
    `  <url>\n    <loc>${SITE_ORIGIN}${path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${meta.changefreq}</changefreq>\n    <priority>${meta.priority}</priority>\n  </url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}
