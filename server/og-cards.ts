/**
 * Dynamic OG share cards — 1200×630 PNGs rendered server-side so links pasted
 * into iMessage / X / Telegram / Discord unfurl as branded, per-content images.
 *
 *   GET /api/og-card/thread/:id      → card for a note (avatar + name + excerpt)
 *   GET /api/og-card/invite/:naddr   → generic "You're invited" card
 *   GET /api/og-card/profile/:npub   → card for a profile (big avatar + name +
 *                                      nip05 + about excerpt + following hint)
 *
 * Pipeline: satori (JSX-less element tree → SVG with text pre-converted to
 * <path> outlines via the embedded WOFF fonts in og-card-fonts.ts) → sharp
 * (SVG → PNG). No fontconfig, no native resvg, no font files on disk — the
 * deploy VM only needs the `satori` and `sharp` npm packages, both regular
 * dependencies resolved from node_modules (neither is in the esbuild bundle
 * allowlist, so no allowlist changes are required).
 *
 * PRIVACY HARD RULE (invite cards): Concord invite key material lives in the
 * URL *fragment*, which browsers and link scrapers never send to the server.
 * The naddr path segment identifies an encrypted invite bundle (kind 33301)
 * whose content we cannot decrypt without that fragment — so the invite card
 * renders PUBLIC branding only. We never parse, decode, store, or log the
 * naddr (or anything else key-like), and no card endpoints exist for DMs or
 * other private content.
 *
 * Every failure path degrades to the static brand card (og-image.png) — a
 * scraper must never see a broken image.
 */
import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { nip19 } from "nostr-tools";
import type SharpNS from "sharp";
import satoriImport from "satori";

// sharp is a NATIVE module — it cannot be bundled into dist/index.cjs, so it
// must never be a top-level import: if the deploy VM's node_modules is missing
// or stale, a top-level require would crash the whole server at boot. Load it
// lazily instead; when unavailable, card rendering throws and every route
// degrades to the static brand card (og-image.png).
let sharpCached: typeof SharpNS | null | undefined;
async function getSharp(): Promise<typeof SharpNS> {
  if (sharpCached === undefined) {
    try {
      const mod = await import("sharp");
      sharpCached = ((mod as { default?: typeof SharpNS }).default ?? mod) as typeof SharpNS;
    } catch (err) {
      sharpCached = null;
      console.error(
        "[og-cards] sharp unavailable — OG cards degrade to static brand image:",
        (err as Error)?.message,
      );
    }
  }
  if (!sharpCached) throw new Error("sharp unavailable");
  return sharpCached;
}
// satori is ESM-first with a CJS build; under the esbuild-bundled CJS server
// the default import arrives double-wrapped ({ default: fn }), while tsx dev
// resolves the real ESM default. Normalize once.
const satori: typeof satoriImport = ((satoriImport as unknown as { default?: typeof satoriImport }).default ?? satoriImport);
import { TTLCache } from "./ttl-cache";
import { validateHostSafety } from "./net-safety";
import {
  INTER_400_WOFF_B64,
  INTER_700_WOFF_B64,
  SPACE_GROTESK_600_WOFF_B64,
} from "./og-card-fonts";

// ── Pure helpers (unit-tested in og-cards.test.ts) ───────────────────────────

/**
 * Squeeze note content into card-sized prose: drop URLs and nostr: references
 * (they render as noise on an image), collapse whitespace, and truncate on a
 * word boundary with an ellipsis.
 */
export function excerptForCard(content: string, maxLen = 200): string {
  const text = (content || "")
    .replace(/nostr:[a-z0-9]+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export interface ProfileCardMeta {
  name: string;
  picture: string;
  /** NIP-05 identifier for display only (never verified here); "" when absent. */
  nip05: string;
  /** Raw about/bio text; excerpted by the caller via excerptForCard. */
  about: string;
}

/**
 * Pull a display name + avatar URL (+ nip05 + about, for profile cards) out of
 * a kind-0 profile event's content. Falls back to a shortened pubkey so the
 * card never shows an empty byline.
 */
export function profileCardMeta(profileContentJson: string | undefined | null, fallbackPubkey = ""): ProfileCardMeta {
  let name = "";
  let picture = "";
  let nip05 = "";
  let about = "";
  if (profileContentJson) {
    try {
      const meta = JSON.parse(profileContentJson);
      if (typeof meta?.display_name === "string" && meta.display_name.trim()) name = meta.display_name.trim();
      else if (typeof meta?.name === "string" && meta.name.trim()) name = meta.name.trim();
      if (typeof meta?.picture === "string" && /^https?:\/\//i.test(meta.picture)) picture = meta.picture;
      if (typeof meta?.nip05 === "string") {
        // "_@domain" is NIP-05 shorthand for the bare domain.
        nip05 = meta.nip05.trim().replace(/^_@/, "");
        if (nip05.length > 40) nip05 = nip05.slice(0, 39).trimEnd() + "…";
      }
      if (typeof meta?.about === "string") about = meta.about;
    } catch {}
  }
  if (!name) name = fallbackPubkey ? `${fallbackPubkey.slice(0, 8)}…${fallbackPubkey.slice(-4)}` : "A Relay Outpost user";
  if (name.length > 40) name = name.slice(0, 39).trimEnd() + "…";
  return { name, picture, nip05, about };
}

/**
 * Count the unique accounts a kind-3 contact-list event follows (valid `p`
 * tags only). This is the one "social size" number a profile card can get
 * cheaply — a single replaceable-event fetch — unlike true follower counts,
 * which need relay-wide aggregation. Returns 0 for anything malformed.
 */
export function followingCountFromTags(tags: unknown): number {
  if (!Array.isArray(tags)) return 0;
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "p") continue;
    const pk = typeof tag[1] === "string" ? tag[1].toLowerCase() : "";
    if (/^[a-f0-9]{64}$/.test(pk)) seen.add(pk);
  }
  return seen.size;
}

// ── Palette (Synthesis system, one violet hue 262 — see client/src/index.css) ─

const CARD = {
  bg: "#0e0c16",                 // dark nebula ground (hsl 260 8% 7%, violet-leaning)
  text: "#f2f0f8",               // near-white foreground
  muted: "#a89fc4",              // captions / bylines
  violet: "#7c4dff",             // accent (hue 262, bright)
  violetSoft: "rgba(124, 77, 255, 0.32)",
  violetFaint: "rgba(94, 53, 197, 0.22)",
  wordmark: "#cfc5ec",
} as const;

const NEBULA_BG =
  `radial-gradient(at 12% -8%, ${CARD.violetSoft} 0%, rgba(14,12,22,0) 55%), ` +
  `radial-gradient(at 96% 112%, ${CARD.violetFaint} 0%, rgba(14,12,22,0) 50%)`;

// ── Satori plumbing ──────────────────────────────────────────────────────────

type Node = { type: string; props: Record<string, unknown> };

/** Terse element helper — satori consumes React-shaped {type, props} objects. */
function el(type: string, style: Record<string, unknown>, children?: Node[] | string): Node {
  return { type, props: { style, children } };
}

let fontsCache: { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }[] | null = null;
function cardFonts() {
  if (!fontsCache) {
    fontsCache = [
      { name: "Inter", data: Buffer.from(INTER_400_WOFF_B64, "base64"), weight: 400, style: "normal" },
      { name: "Inter", data: Buffer.from(INTER_700_WOFF_B64, "base64"), weight: 700, style: "normal" },
      { name: "Space Grotesk", data: Buffer.from(SPACE_GROTESK_600_WOFF_B64, "base64"), weight: 600, style: "normal" },
    ];
  }
  return fontsCache;
}

async function renderCardPng(root: Node): Promise<Buffer> {
  const svg = await satori(root as never, {
    width: 1200,
    height: 630,
    fonts: cardFonts() as never,
  });
  const sharp = await getSharp();
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Local + remote assets ────────────────────────────────────────────────────

/** client/public in dev, dist/public in production (vite copies public/ there). */
function findPublicFile(name: string): string | null {
  for (const candidate of [
    path.resolve(process.cwd(), "dist", "public", name),
    path.resolve(process.cwd(), "client", "public", name),
  ]) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

let logoDataUri: string | null | undefined;
/** The white relay glyph (logo.svg), rasterized once to a PNG data URI. */
async function getLogoDataUri(): Promise<string | null> {
  if (logoDataUri !== undefined) return logoDataUri;
  try {
    const logoPath = findPublicFile("logo.svg");
    if (!logoPath) return (logoDataUri = null);
    const sharp = await getSharp();
    const png = await sharp(fs.readFileSync(logoPath), { density: 300 })
      .resize(96, 96)
      .png()
      .toBuffer();
    logoDataUri = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    logoDataUri = null;
  }
  return logoDataUri;
}

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fetch a profile avatar and normalize it to a small square PNG data URI.
 * SSRF-guarded (public hosts only), time-capped, size-capped; null on any
 * failure — the card falls back to an initial disc. `size` is the square
 * output edge (profile cards render the avatar large, so they ask for 256).
 */
async function fetchAvatarDataUri(url: string, size = 128): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!(await validateHostSafety(parsed.hostname))) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    let resp: globalThis.Response;
    try {
      resp = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return null;
    const declared = Number(resp.headers.get("content-length") || 0);
    if (declared > AVATAR_MAX_BYTES) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > AVATAR_MAX_BYTES) return null;

    const sharp = await getSharp();
    const png = await sharp(buf).resize(size, size, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

const POST_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const IMG_EXT = /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:\?\S*)?(?:#\S*)?$/i;

/**
 * The first displayable image in a post — from a NIP-92 `imeta` tag (URL with an
 * image extension or an `m image/*` mime) or the first image URL in the content.
 * Returns null for text-only posts (they keep the classic text card).
 */
export function firstPostImageUrl(event: { content?: string; tags?: string[][] }): string | null {
  const inContent = (event.content || "").match(/https?:\/\/\S+\.(?:jpe?g|png|gif|webp|avif|bmp)(?:\?\S*)?/i);
  if (inContent) return inContent[0];
  for (const tag of event.tags || []) {
    if (tag[0] !== "imeta") continue;
    let url = "";
    let isImage = false;
    for (const part of tag.slice(1)) {
      if (typeof part !== "string") continue;
      if (part.startsWith("url ")) url = part.slice(4).trim();
      else if (part.startsWith("m ") && part.slice(2).trim().toLowerCase().startsWith("image/")) isImage = true;
    }
    if (url && (isImage || IMG_EXT.test(url))) return url;
  }
  return null;
}

/** Fetch a post image and cover-crop it to the card's image panel. Larger byte
 *  budget than avatars (real photos). Any failure → null (card degrades to the
 *  text-only layout — never a broken card). */
async function fetchCoverImageDataUri(url: string, width: number, height: number): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!(await validateHostSafety(parsed.hostname))) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let resp: globalThis.Response;
    try {
      resp = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return null;
    const declared = Number(resp.headers.get("content-length") || 0);
    if (declared > POST_IMAGE_MAX_BYTES) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > POST_IMAGE_MAX_BYTES) return null;
    const sharp = await getSharp();
    if (!sharp) return null;
    const png = await sharp(buf).resize(width, height, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

type FetchNostrEventForMentions = (filter: Record<string, any>) => Promise<any | null>;

/**
 * Replace `nostr:npub…` / `nostr:nprofile…` mentions with `@DisplayName` so the
 * tagged person survives into the card excerpt (excerptForCard otherwise strips
 * every `nostr:` token as noise). Capped so one @-heavy post can't fan out into
 * many relay lookups; unresolved mentions fall through and get stripped as before.
 */
export async function resolveMentions(content: string, fetchProfile: FetchNostrEventForMentions, cap = 4): Promise<string> {
  if (!content || !/nostr:(npub1|nprofile1)/i.test(content)) return content;
  const tokens = [...content.matchAll(/nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+)/gi)].slice(0, cap);
  let out = content;
  const done = new Set<string>();
  for (const t of tokens) {
    const token = t[0];
    if (done.has(token)) continue;
    done.add(token);
    try {
      const decoded = nip19.decode(t[1].toLowerCase());
      const pk = decoded.type === "npub" ? (decoded.data as string)
        : decoded.type === "nprofile" ? (decoded.data as { pubkey: string }).pubkey
        : null;
      if (!pk) continue;
      const profile = await fetchProfile({ kinds: [0], authors: [pk] });
      const { name } = profileCardMeta(profile?.content, pk);
      out = out.split(token).join(`@${name}`);
    } catch {}
  }
  return out;
}

// ── Card layouts ─────────────────────────────────────────────────────────────

function wordmarkRow(logo: string | null): Node {
  const children: Node[] = [];
  if (logo) {
    children.push({
      type: "img",
      props: { src: logo, width: 44, height: 44, style: { width: 44, height: 44 } },
    });
  } else {
    children.push(el("div", {
      width: 18, height: 18, borderRadius: 9, backgroundColor: CARD.violet, marginTop: 4,
    }));
  }
  children.push(el("div", {
    fontFamily: "Space Grotesk", fontWeight: 600, fontSize: 34, color: CARD.wordmark, marginLeft: 18,
  }, "Relay Outpost"));
  return el("div", { display: "flex", flexDirection: "row", alignItems: "center" }, children);
}

function accentBar(): Node {
  return el("div", {
    position: "absolute", top: 0, left: 0, width: 1200, height: 8, display: "flex",
    backgroundImage: `linear-gradient(90deg, ${CARD.violet} 0%, rgba(124,77,255,0.05) 70%)`,
  });
}

function avatarNode(avatarDataUri: string | null, name: string, size = 104): Node {
  if (avatarDataUri) {
    return {
      type: "img",
      props: {
        src: avatarDataUri,
        width: size,
        height: size,
        style: { width: size, height: size, borderRadius: size / 2, border: `3px solid ${CARD.violetSoft}` },
      },
    };
  }
  return el("div", {
    width: size, height: size, borderRadius: size / 2, display: "flex",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(124, 77, 255, 0.18)", border: `3px solid ${CARD.violetSoft}`,
    fontFamily: "Space Grotesk", fontWeight: 600, fontSize: Math.round(size * 0.46), color: CARD.text,
  }, (name.trim()[0] || "N").toUpperCase());
}

/** The identity + excerpt + wordmark column, shared by both thread layouts. */
function threadTextColumn(opts: { name: string; avatarDataUri: string | null; excerpt: string; logo: string | null; imageSize: number }): Node {
  const excerpt = opts.excerpt || "Shared a post on Relay Outpost.";
  const narrow = opts.imageSize > 0;
  return el("div", {
    display: "flex", flexDirection: "column", justifyContent: "space-between",
    // When an image panel sits on the right, this column is narrower and only
    // pads its own three sides; the image bleeds to the card's right edge.
    padding: narrow ? "64px 44px 56px 72px" : "64px 72px 56px",
    flexGrow: 1, height: 630,
  }, [
    el("div", { display: "flex", flexDirection: "row", alignItems: "center" }, [
      avatarNode(opts.avatarDataUri, opts.name),
      el("div", { display: "flex", flexDirection: "column", marginLeft: 28 }, [
        el("div", { fontSize: narrow ? 36 : 42, fontWeight: 700, color: CARD.text, lineClamp: 1 }, opts.name),
        el("div", { fontSize: 26, color: CARD.muted, marginTop: 6 }, "on Relay Outpost"),
      ]),
    ]),
    el("div", {
      display: "block", fontSize: narrow ? 40 : 46, lineHeight: 1.4, color: CARD.text,
      lineClamp: narrow ? 5 : 4, marginTop: 36, marginBottom: 36,
    }, excerpt),
    wordmarkRow(opts.logo),
  ]);
}

function threadCardTree(opts: { name: string; avatarDataUri: string | null; excerpt: string; logo: string | null; imageDataUri?: string | null }): Node {
  const imageSize = opts.imageDataUri ? 468 : 0;
  const column = threadTextColumn({ ...opts, imageSize });
  const base = {
    width: 1200, height: 630, display: "flex",
    backgroundColor: CARD.bg, backgroundImage: NEBULA_BG,
    position: "relative", fontFamily: "Inter",
  } as const;

  // No post image → the classic full-width text card.
  if (!opts.imageDataUri) {
    return el("div", { ...base, flexDirection: "column" }, [accentBar(), column]);
  }

  // Post has an image → two-pane "link preview" card: text left, photo right.
  return el("div", { ...base, flexDirection: "row" }, [
    accentBar(),
    column,
    {
      type: "img",
      props: {
        src: opts.imageDataUri,
        width: imageSize, height: 630,
        style: { width: imageSize, height: 630, objectFit: "cover" },
      },
    },
  ]);
}

function profileCardTree(opts: {
  name: string;
  nip05: string;
  aboutExcerpt: string;
  followingCount: number;
  avatarDataUri: string | null;
  logo: string | null;
}): Node {
  const identityLines: Node[] = [
    el("div", { fontSize: 56, fontWeight: 700, color: CARD.text }, opts.name),
  ];
  if (opts.nip05) {
    identityLines.push(el("div", { fontSize: 30, color: CARD.violet, marginTop: 10 }, opts.nip05));
  }
  identityLines.push(el("div", { fontSize: 26, color: CARD.muted, marginTop: opts.nip05 ? 8 : 12 },
    opts.followingCount > 0
      ? `follows ${opts.followingCount.toLocaleString("en-US")} people`
      : "on Relay Outpost"));

  const about = opts.aboutExcerpt || "See posts, replies, and trust reviews on Relay Outpost.";
  return el("div", {
    width: 1200, height: 630, display: "flex", flexDirection: "column",
    backgroundColor: CARD.bg, backgroundImage: NEBULA_BG,
    padding: "64px 72px 56px", justifyContent: "space-between", position: "relative",
    fontFamily: "Inter",
  }, [
    accentBar(),
    el("div", { display: "flex", flexDirection: "row", alignItems: "center" }, [
      avatarNode(opts.avatarDataUri, opts.name, 168),
      el("div", { display: "flex", flexDirection: "column", marginLeft: 36 }, identityLines),
    ]),
    el("div", {
      display: "block", fontSize: 38, lineHeight: 1.45, color: CARD.text,
      lineClamp: 3, marginTop: 32, marginBottom: 32,
    }, about),
    wordmarkRow(opts.logo),
  ]);
}

function inviteCardTree(logo: string | null): Node {
  return el("div", {
    width: 1200, height: 630, display: "flex", flexDirection: "column",
    backgroundColor: CARD.bg,
    backgroundImage:
      `radial-gradient(at 50% 8%, ${CARD.violetSoft} 0%, rgba(14,12,22,0) 60%), ` +
      `radial-gradient(at 8% 110%, ${CARD.violetFaint} 0%, rgba(14,12,22,0) 50%)`,
    alignItems: "center", justifyContent: "center", position: "relative",
    fontFamily: "Inter", padding: 72,
  }, [
    accentBar(),
    ...(logo
      ? [{ type: "img", props: { src: logo, width: 88, height: 88, style: { width: 88, height: 88, marginBottom: 40 } } } as Node]
      : []),
    el("div", { fontFamily: "Space Grotesk", fontWeight: 600, fontSize: 88, color: CARD.text }, "You're invited"),
    el("div", {
      fontSize: 36, color: CARD.muted, marginTop: 28, textAlign: "center",
      display: "block", maxWidth: 860, lineHeight: 1.45,
    }, "Join a private, end-to-end encrypted community on Relay Outpost."),
    el("div", { position: "absolute", bottom: 52, display: "flex" }, [
      el("div", {
        fontFamily: "Space Grotesk", fontWeight: 600, fontSize: 30, color: CARD.wordmark,
      }, "Relay Outpost"),
    ]),
  ]);
}

// ── Routes ───────────────────────────────────────────────────────────────────

type FetchNostrEventFn = (filter: Record<string, any>, timeoutMs?: number, relays?: string[]) => Promise<any | null>;

function sendPng(res: Response, png: Buffer, maxAgeSeconds: number) {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Cards are meant to be embedded everywhere; override helmet's same-origin CORP.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.end(png);
}

/** Never a broken image: degrade to the static brand card. */
let fallbackCardCache: Buffer | null | undefined;
function serveFallbackCard(res: Response) {
  if (fallbackCardCache === undefined) {
    // Buffer-served (not res.sendFile) so send's dotfile policy can't 404 a
    // path that happens to contain a dot-directory segment.
    const staticCard = findPublicFile("og-image.png");
    try {
      fallbackCardCache = staticCard ? fs.readFileSync(staticCard) : null;
    } catch {
      fallbackCardCache = null;
    }
  }
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (fallbackCardCache) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(fallbackCardCache);
  }
  return res.redirect(302, "/og-image.png");
}

export function registerOgCardRoutes(app: Express, fetchNostrEvent: FetchNostrEventFn) {
  const pngCache = new TTLCache<Buffer>(150, 60 * 60 * 1000);
  // Unfetchable events get a short negative TTL so scraper retries don't
  // re-hammer the relays every few seconds.
  const missCache = new TTLCache<true>(300, 2 * 60 * 1000);

  app.get("/api/og-card/thread/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(id)) return serveFallbackCard(res);

    const key = `thread:${id}`;
    const cached = pngCache.get(key);
    if (cached) return sendPng(res, cached, 3600);
    if (missCache.get(key)) return serveFallbackCard(res);

    try {
      const event = await fetchNostrEvent({ ids: [id] });
      if (!event) {
        missCache.set(key, true);
        return serveFallbackCard(res);
      }
      const profile = await fetchNostrEvent({ kinds: [0], authors: [event.pubkey] });
      const { name, picture } = profileCardMeta(profile?.content, event.pubkey);
      const avatarDataUri = picture ? await fetchAvatarDataUri(picture) : null;
      const logo = await getLogoDataUri();
      // Show the post's own image (two-pane card) when it has one, and keep any
      // @-mentions readable in the excerpt instead of stripping them to nothing.
      const imageUrl = firstPostImageUrl(event);
      const imageDataUri = imageUrl ? await fetchCoverImageDataUri(imageUrl, 468, 630) : null;
      const resolvedContent = await resolveMentions(event.content || "", (f) => fetchNostrEvent(f));
      const png = await renderCardPng(threadCardTree({
        name,
        avatarDataUri,
        excerpt: excerptForCard(resolvedContent, imageDataUri ? 150 : 200),
        logo,
        imageDataUri,
      }));
      pngCache.set(key, png);
      return sendPng(res, png, 3600);
    } catch (err) {
      console.error("[og-card] thread render failed:", (err as Error)?.message);
      return serveFallbackCard(res);
    }
  });

  app.get("/api/og-card/profile/:npub", async (req: Request, res: Response) => {
    // Public kind-0/kind-3 metadata only — same privacy posture as the thread
    // card. The npub is shape-validated and bech32-decoded; nothing else about
    // the request is parsed, stored, or logged.
    const npub = String(req.params.npub || "");
    if (!/^npub1[a-z0-9]{20,}$/i.test(npub)) return serveFallbackCard(res);
    let pubkey = "";
    try {
      const decoded = nip19.decode(npub.toLowerCase());
      if (decoded.type !== "npub") return serveFallbackCard(res);
      pubkey = decoded.data as string;
    } catch {
      return serveFallbackCard(res);
    }

    const key = `profile:${pubkey}`;
    const cached = pngCache.get(key);
    if (cached) return sendPng(res, cached, 3600);
    if (missCache.get(key)) return serveFallbackCard(res);

    try {
      const profile = await fetchNostrEvent({ kinds: [0], authors: [pubkey] });
      if (!profile) {
        missCache.set(key, true);
        return serveFallbackCard(res);
      }
      const { name, picture, nip05, about } = profileCardMeta(profile.content, pubkey);
      // The following hint is best-effort garnish: a missing/slow kind 3 just
      // renders the card without it.
      const contacts = await fetchNostrEvent({ kinds: [3], authors: [pubkey] });
      const followingCount = followingCountFromTags(contacts?.tags);
      const avatarDataUri = picture ? await fetchAvatarDataUri(picture, 256) : null;
      const logo = await getLogoDataUri();
      const png = await renderCardPng(profileCardTree({
        name,
        nip05,
        aboutExcerpt: excerptForCard(about, 140),
        followingCount,
        avatarDataUri,
        logo,
      }));
      pngCache.set(key, png);
      return sendPng(res, png, 3600);
    } catch (err) {
      console.error("[og-card] profile render failed:", (err as Error)?.message);
      return serveFallbackCard(res);
    }
  });

  app.get("/api/og-card/invite/:naddr", async (req: Request, res: Response) => {
    // PRIVACY: see module header. The naddr is validated by shape only and is
    // never decoded, fetched, stored, or logged — the invite card is the same
    // public branding for every group.
    if (!/^naddr1[a-z0-9]+$/i.test(String(req.params.naddr || ""))) return serveFallbackCard(res);

    const key = "invite";
    const cached = pngCache.get(key);
    if (cached) return sendPng(res, cached, 24 * 3600);

    try {
      const logo = await getLogoDataUri();
      const png = await renderCardPng(inviteCardTree(logo));
      pngCache.set(key, png);
      return sendPng(res, png, 24 * 3600);
    } catch (err) {
      console.error("[og-card] invite render failed:", (err as Error)?.message);
      return serveFallbackCard(res);
    }
  });
}
