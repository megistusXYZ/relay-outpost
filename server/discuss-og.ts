// Pure helpers behind the crawler-facing OpenGraph unfurls (routes.ts).
//
// The ?discuss= share funnel ("💬 Discuss on Relay Outpost: …/news?discuss=<url>")
// should unfurl in Amethyst/Damus/Telegram/iMessage as the TARGET ARTICLE's
// card, not the generic homepage card. These helpers are the testable core:
// param validation (hostile input → null), card composition from fetched
// article metadata (with branded fallbacks), and the OG HTML itself (all
// interpolations escaped — article titles are untrusted input into HTML).

/** Longest ?discuss= value we'll consider. Anything bigger is junk. */
export const MAX_DISCUSS_PARAM_LENGTH = 2048;

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Server-side mirror of the client's parseDiscussParam hardening
 * (client/src/lib/external-id.ts): accept the value only if it parses as an
 * http(s) URL — javascript:, data:, file:, ftp: … are all rejected — and
 * tolerate a still-percent-encoded value WITHOUT double-decoding a clean URL.
 * Returns the article URL to fetch, or null for junk (caller falls through to
 * the generic card — never a 500).
 */
export function parseDiscussParam(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_DISCUSS_PARAM_LENGTH) return null;

  // The value as-is first (Express already URL-decoded it once in the common
  // case), then a percent-decoded form for double-encoded links — so a clean
  // URL is never double-decoded (which would corrupt a literal `%` in a path).
  const candidates: string[] = [trimmed];
  try {
    const decoded = decodeURIComponent(trimmed).trim();
    if (decoded && decoded !== trimmed) candidates.push(decoded);
  } catch {
    // malformed percent-encoding — skip the decoded candidate
  }

  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue; // not a parseable URL — try the next candidate
    }
    // http(s) only. A parseable non-http scheme is hostile/irrelevant — reject
    // outright rather than falling through to the decoded candidate.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  }
  return null;
}

/** Subset of the /api/og fetcher's result that the discuss card consumes. */
export interface ArticleOgData {
  title?: string;
  description?: string;
  image?: string;
}

export interface DiscussCardMeta {
  title: string;
  description: string;
  image: string;
  type: string;
  imageAlt: string;
}

/**
 * Compose the discuss-share card from the article's fetched OG metadata.
 * Every field degrades gracefully: no title → the article's hostname; no
 * description → the discussion call-to-action; no image → "" (buildOgHtml
 * swaps in the branded card, resolved against the request host). The
 * discussion framing lives in the description/site_name — the article title
 * is never mangled.
 */
export function buildDiscussMeta(article: ArticleOgData | null | undefined, articleUrl: string): DiscussCardMeta {
  let hostname = "";
  try {
    hostname = new URL(articleUrl).hostname.replace(/^www\./, "");
  } catch {
    // articleUrl is produced by parseDiscussParam, so this shouldn't happen —
    // but a bare fallback title beats a crash in the crawler path.
  }

  const title = article?.title?.trim() || hostname || "Shared link";
  const rawDesc = (article?.description || "").trim();
  const description = rawDesc
    ? (rawDesc.length > 200 ? rawDesc.slice(0, 200) + "..." : rawDesc)
    : "Join the discussion on Relay Outpost";
  const image = (article?.image || "").trim();

  return {
    title,
    description,
    image,
    type: "article",
    imageAlt: `${title} — discussion on Relay Outpost`,
  };
}

export interface OgHtmlMeta {
  title: string;
  description: string;
  image: string;
  url: string;
  type?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
}

/**
 * The crawler-served OG document. Every interpolated value passes through
 * escapeHtml — titles/descriptions come from untrusted upstream HTML.
 *
 * `brandedImageUrl` is the og:image fallback when the meta has none. It is
 * derived from the REQUEST host by the caller (`${proto}://${host}/og-image.png`)
 * so cards work on every domain the app is served from — never a hardcoded
 * deployment hostname.
 */
export function buildOgHtml(meta: OgHtmlMeta, brandedImageUrl: string): string {
  const escapedTitle = escapeHtml(meta.title);
  const escapedDesc = escapeHtml(meta.description);
  const escapedUrl = escapeHtml(meta.url);
  const imgAlt = escapeHtml(meta.imageAlt || meta.title);
  const imageDims = meta.image && meta.imageWidth && meta.imageHeight
    ? `\n    <meta property="og:image:width" content="${meta.imageWidth}" />\n    <meta property="og:image:height" content="${meta.imageHeight}" />`
    : "";
  const ogImage = meta.image
    ? `<meta property="og:image" content="${escapeHtml(meta.image)}" />${imageDims}\n    <meta property="og:image:alt" content="${imgAlt}" />`
    : `<meta property="og:image" content="${escapeHtml(brandedImageUrl)}" />\n    <meta property="og:image:width" content="1155" />\n    <meta property="og:image:height" content="630" />\n    <meta property="og:image:alt" content="Relay Outpost — own your account and run your own community" />`;
  const twitterCard = "summary_large_image";
  const twitterImage = meta.image ? escapeHtml(meta.image) : escapeHtml(brandedImageUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDesc}" />
    <meta property="og:type" content="${meta.type || "article"}" />
    <meta property="og:site_name" content="Relay Outpost" />
    <meta property="og:url" content="${escapedUrl}" />
    ${ogImage}
    <meta name="twitter:card" content="${twitterCard}" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDesc}" />
    <meta name="twitter:image" content="${twitterImage}" />
    <meta name="twitter:image:alt" content="${imgAlt}" />
    <meta name="description" content="${escapedDesc}" />
    <title>${escapedTitle}</title>
    <meta http-equiv="refresh" content="0;url=${escapedUrl}" />
</head>
<body></body>
</html>`;
}
