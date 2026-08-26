// Post-sanitize enrichment for the News article reader.
//
// Readability/RSS extractions frequently leave bare URLs as dead plain text —
// e.g. a `https://www.youtube.com/watch?v=…` line that renders as unclickable
// prose. This module upgrades that content AFTER DOMPurify has sanitized it:
//
//   - bare http(s) URLs in text nodes → normal links (never inside <a>/<code>/<pre>)
//   - standalone (own-line) YouTube / Vimeo URLs, and anchors that are alone in
//     their paragraph → a privacy-respecting click-to-play facade. The real
//     iframe is NEVER emitted here — the caller swaps it in on user click via
//     `embedSrcFor`, so no request goes to Google/Vimeo until the user opts in.
//   - standalone bare image URLs → <img> (routed through the caller's image
//     proxy, matching how the reader proxies article images)
//   - standalone bare video/audio file URLs → <video controls>/<audio controls>
//
// Safety model: this runs on ALREADY-SANITIZED html, so everything we inject
// must be safe by construction. All markup is built with DOM APIs
// (createElement/setAttribute/textContent — no HTML string interpolation), URLs
// must match ^https?:// to be touched at all, and video IDs are regex-validated
// before they reach any attribute or URL template. The click handler must call
// `embedSrcFor` (which re-validates the ID shape and builds the embed URL from
// a hardcoded template) rather than trusting any data-* attribute as a URL —
// sanitized article HTML can legally carry attacker-chosen data-* attributes.
//
// The function is pure (string in → string out), idempotent (generated links,
// facades and media contain no bare-URL text nodes, and [data-embed] subtrees
// are skipped), and never throws (any failure returns the input unchanged).

export interface EnrichOptions {
  /**
   * Maps an image URL to the src actually emitted (e.g. the reader's
   * `/api/rss/image-proxy?url=…`). Applied to bare-image URLs AND to YouTube
   * thumbnails, so even the facade preview avoids a direct third-party request.
   * Defaults to identity.
   */
  imageProxy?: (url: string) => string;
}

export interface VideoRef {
  provider: "youtube" | "vimeo";
  id: string;
}

// Real YouTube IDs are 11 chars; accept a conservative 6–20 of the URL-safe
// base64 alphabet. Vimeo IDs are purely numeric.
const YT_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID_RE = /^\d{1,15}$/;

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT_RE = /\.(mp3|m4a|ogg)$/i;

const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE", "LI", "UL", "OL", "TABLE",
  "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "HEADER", "FOOTER",
  "ASIDE", "NAV", "MAIN", "TD", "TH", "BODY",
]);

// Static play glyph for the facade button. Constant markup — nothing user-
// controlled is ever concatenated into it.
const PLAY_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22" aria-hidden="true"><path d="M8 5.14v13.72L19 12 8 5.14z"></path></svg>';

/** Parse a YouTube/Vimeo watch URL into a validated provider + id, else null. */
export function parseVideoUrl(raw: string): VideoRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (host === "youtube.com" && u.pathname === "/watch") {
    const id = u.searchParams.get("v") || "";
    if (YT_ID_RE.test(id)) return { provider: "youtube", id };
    return null;
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (YT_ID_RE.test(id)) return { provider: "youtube", id };
    return null;
  }
  if (host === "vimeo.com") {
    const id = u.pathname.slice(1).split("/")[0];
    if (VIMEO_ID_RE.test(id)) return { provider: "vimeo", id };
    return null;
  }
  return null;
}

/**
 * The ONLY way facade attributes become an iframe src. Re-validates the id
 * shape and builds the URL from a hardcoded template, so attacker-chosen
 * data-* attributes surviving sanitize can never point the iframe anywhere but
 * youtube-nocookie / player.vimeo with a plausibly-shaped id.
 */
export function embedSrcFor(provider: string | null, id: string | null): string | null {
  if (provider === "youtube" && id && YT_ID_RE.test(id)) {
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
  }
  if (provider === "vimeo" && id && VIMEO_ID_RE.test(id)) {
    return `https://player.vimeo.com/video/${id}?autoplay=1`;
  }
  return null;
}

function mediaKind(raw: string): "image" | "video" | "audio" | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (IMG_EXT_RE.test(u.pathname)) return "image";
  if (VIDEO_EXT_RE.test(u.pathname)) return "video";
  if (AUDIO_EXT_RE.test(u.pathname)) return "audio";
  return null;
}

// Sentence punctuation glued to the end of a URL in prose is almost never part
// of it. Closing brackets are only trimmed when unbalanced within the match
// (so Wikipedia-style `/wiki/Foo_(bar)` survives).
function trimTrailingPunctuation(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (!last) break;
    if (".,;:!?…".includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ")" && countChar(out, "(") < countChar(out, ")")) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === "]" && countChar(out, "[") < countChar(out, "]")) {
      out = out.slice(0, -1);
      continue;
    }
    break;
  }
  return out;
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === c) n++;
  return n;
}

function buildAnchor(doc: Document, url: string): HTMLElement {
  const a = doc.createElement("a");
  a.setAttribute("href", url);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer");
  a.textContent = url;
  return a;
}

function buildImage(doc: Document, url: string, proxy: (u: string) => string): HTMLElement {
  const img = doc.createElement("img");
  img.setAttribute("src", proxy(url));
  img.setAttribute("alt", "");
  img.setAttribute("loading", "lazy");
  img.setAttribute("class", "rounded-md max-w-full h-auto my-4 block");
  return img;
}

function buildFileMedia(doc: Document, url: string, kind: "video" | "audio"): HTMLElement {
  const el = doc.createElement(kind);
  el.setAttribute("controls", "");
  el.setAttribute("preload", "metadata");
  el.setAttribute("src", url);
  el.setAttribute(
    "class",
    kind === "video" ? "rounded-md max-w-full w-full my-4 block" : "w-full my-4 block",
  );
  return el;
}

// Click-to-play facade. Built ONLY from phrasing-content tags (span/img/svg) so
// re-parsing via innerHTML/dangerouslySetInnerHTML never restructures a
// surrounding <p>. The provider + validated id ride along as data attributes
// for the caller's delegated click handler (which must go through embedSrcFor).
function buildFacade(doc: Document, ref: VideoRef, proxy: (u: string) => string): HTMLElement {
  const wrap = doc.createElement("span");
  wrap.setAttribute("data-embed", ref.provider);
  wrap.setAttribute("data-embed-id", ref.id);
  wrap.setAttribute("role", "button");
  wrap.setAttribute("tabindex", "0");
  wrap.setAttribute("aria-label", ref.provider === "youtube" ? "Play YouTube video" : "Play Vimeo video");
  wrap.setAttribute(
    "class",
    "rss-embed-facade block relative w-full aspect-video my-4 rounded-md overflow-hidden bg-zinc-900 cursor-pointer select-none",
  );

  if (ref.provider === "youtube") {
    // ref.id already matched YT_ID_RE, and the whole URL goes through
    // setAttribute — safe by construction.
    const thumb = doc.createElement("img");
    thumb.setAttribute("src", proxy(`https://i.ytimg.com/vi/${ref.id}/hqdefault.jpg`));
    thumb.setAttribute("alt", "");
    thumb.setAttribute("loading", "lazy");
    thumb.setAttribute("class", "absolute inset-0 w-full h-full object-cover !my-0 !rounded-none");
    wrap.appendChild(thumb);
  }

  const overlay = doc.createElement("span");
  overlay.setAttribute("class", "absolute inset-0 flex items-center justify-center bg-black/30");
  const btn = doc.createElement("span");
  btn.setAttribute(
    "class",
    "flex items-center justify-center w-16 h-11 rounded-xl bg-black/70 border border-white/20 text-white",
  );
  btn.innerHTML = PLAY_SVG;
  overlay.appendChild(btn);
  wrap.appendChild(overlay);

  const label = doc.createElement("span");
  label.setAttribute(
    "class",
    "absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-mono uppercase tracking-wider",
  );
  label.textContent = ref.provider === "youtube" ? "YouTube" : "Vimeo";
  wrap.appendChild(label);

  return wrap;
}

// Walking outward from a text-node edge: is the neighbouring rendered content a
// line boundary (<br>, a block element, or the edge of the parent block)?
function edgeIsLineBoundary(node: Node, dir: "prev" | "next"): boolean {
  let sib = dir === "prev" ? node.previousSibling : node.nextSibling;
  while (sib && sib.nodeType === 3 && !(sib as Text).data.trim()) {
    sib = dir === "prev" ? sib.previousSibling : sib.nextSibling;
  }
  if (!sib) return true;
  if (sib.nodeType !== 1) return false;
  const tag = (sib as Element).tagName;
  return tag === "BR" || BLOCK_TAGS.has(tag);
}

// A URL is "standalone" when it occupies its own line: nothing but whitespace
// on its line within the text node, and each side that touches the node edge
// borders a <br>/block boundary. Standalone URLs upgrade to embeds/media;
// mid-sentence URLs only ever become normal links (a block-sized embed in the
// middle of a sentence would mangle the prose).
function isStandalone(node: Text, start: number, end: number): boolean {
  const before = node.data.slice(0, start);
  const after = node.data.slice(end);
  const beforeLine = before.slice(before.lastIndexOf("\n") + 1);
  const nlAfter = after.indexOf("\n");
  const afterLine = nlAfter === -1 ? after : after.slice(0, nlAfter);
  if (beforeLine.trim() || afterLine.trim()) return false;
  const leftBounded = before.includes("\n") || edgeIsLineBoundary(node, "prev");
  const rightBounded = nlAfter !== -1 || edgeIsLineBoundary(node, "next");
  return leftBounded && rightBounded;
}

// An <a> that is the only content of its paragraph/block (ignoring whitespace
// and <br>) — the "shared a video as a link on its own line" shape.
function isSoloAnchor(a: Element): boolean {
  const parent = a.parentElement;
  if (!parent || !BLOCK_TAGS.has(parent.tagName)) return false;
  for (const child of Array.from(parent.childNodes)) {
    if (child === a) continue;
    if (child.nodeType === 3 && !(child as Text).data.trim()) continue;
    if (child.nodeType === 1 && (child as Element).tagName === "BR") continue;
    return false;
  }
  return true;
}

function processTextNode(node: Text, doc: Document, proxy: (u: string) => string): void {
  const text = node.data;
  URL_RE.lastIndex = 0;
  const pieces: Array<string | Node> = [];
  let last = 0;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text))) {
    const url = trimTrailingPunctuation(match[0]);
    if (!url) continue;
    const start = match.index;
    const end = start + url.length;
    URL_RE.lastIndex = end;

    const standalone = isStandalone(node, start, end);
    let replacement: Node | null = null;
    if (standalone) {
      const video = parseVideoUrl(url);
      if (video) {
        replacement = buildFacade(doc, video, proxy);
      } else {
        const kind = mediaKind(url);
        if (kind === "image") replacement = buildImage(doc, url, proxy);
        else if (kind === "video" || kind === "audio") replacement = buildFileMedia(doc, url, kind);
      }
    }
    if (!replacement) replacement = buildAnchor(doc, url);

    pieces.push(text.slice(last, start), replacement);
    last = end;
    found = true;
  }
  if (!found) return;
  pieces.push(text.slice(last));

  const frag = doc.createDocumentFragment();
  for (const piece of pieces) {
    if (typeof piece === "string") {
      if (piece) frag.appendChild(doc.createTextNode(piece));
    } else {
      frag.appendChild(piece);
    }
  }
  node.replaceWith(frag);
}

/**
 * Enrich sanitized article HTML: linkify bare URLs, upgrade standalone media /
 * video URLs and solo video anchors. Pure; idempotent; returns the input
 * unchanged on any failure (including environments without DOMParser).
 */
export function enrichArticleHtml(html: string, opts: EnrichOptions = {}): string {
  if (!html || typeof html !== "string") return html;
  try {
    if (typeof DOMParser === "undefined") return html;
    const proxy = opts.imageProxy ?? ((u: string) => u);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    if (!body) return html;

    // Defense-in-depth: the contract is enrich-AFTER-sanitize, so scripts can
    // never be present on the intended path — but if a caller ever misuses the
    // lib on raw HTML, don't round-trip executable markup.
    for (const s of Array.from(body.querySelectorAll("script"))) s.remove();

    // Pass 1 — solo YouTube/Vimeo anchors become facades.
    for (const a of Array.from(body.querySelectorAll("a[href]"))) {
      if (a.closest("[data-embed]")) continue;
      const ref = parseVideoUrl(a.getAttribute("href") || "");
      if (!ref || !isSoloAnchor(a)) continue;
      a.replaceWith(buildFacade(doc, ref, proxy));
    }

    // Pass 2 — bare URLs in text nodes. Snapshot the walk first: we mutate as
    // we go. 0x4 = NodeFilter.SHOW_TEXT (numeric so no global needed).
    const walker = doc.createTreeWalker(body, 0x4);
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) textNodes.push(n as Text);
    for (const node of textNodes) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest("a, code, pre, script, style, textarea, [data-embed]")) continue;
      if (!node.data.includes("http")) continue;
      processTextNode(node, doc, proxy);
    }

    return body.innerHTML;
  } catch {
    return html;
  }
}
