import type { Express } from "express";
import type { Server } from "http";
import { z } from "zod";
import dns from "dns/promises";
import crypto from "crypto";
import RSSParser from "rss-parser";
import { Agent, fetch as undiciFetch } from "undici";
import { db } from "./db";
import { SERVER_APP_VERSION } from "./version";
import { registerSignupTelemetryRoutes } from "./analytics/signup-telemetry";
import { scheduledPosts, podcastTrendSnapshots } from "@shared/schema";
import { eq, and, sql, gte, lt } from "drizzle-orm";
import {
  computeTrendSuggestions,
  historyCutoffMs,
  normalizeTrendCategoryKey,
  shouldCaptureSnapshot,
  toSnapshotEntries,
  SNAPSHOT_TOP_N,
  type TrendSnapshotEntry,
} from "./podcast-trends";
let JSDOM: any = null;
let Readability: any = null;
let domModulesLoaded = false;

async function loadDomModules() {
  if (domModulesLoaded) return;
  try {
    const jsdomModule = await import("jsdom");
    JSDOM = jsdomModule.JSDOM;
    const readabilityModule = await import("@mozilla/readability");
    Readability = readabilityModule.Readability;
    domModulesLoaded = true;
  } catch (e) {
    console.warn("jsdom/readability not available, article extraction disabled");
  }
}
import WebSocket from "ws";
import { nip19, verifyEvent } from "nostr-tools";

import { TTLCache } from "./ttl-cache";
import { clusterNews, type NewsInput, type NewsCluster } from "./news-corroboration";
import { NEWS_SOURCES, NEWS_TOPICS } from "@shared/news-sources";
import { isPrivateIp, validateHostSafety } from "./net-safety";
import { registerOgCardRoutes } from "./og-cards";
import { registerTranslateRoute } from "./translate";
import { parseDiscussParam, buildDiscussMeta, buildOgHtml } from "./discuss-og";

type OgData = { title: string; description: string; image: string; siteName: string; url: string; video?: boolean; audioUrl?: string };
const ogCache = new TTLCache<OgData>(500, 60 * 60 * 1000);
// Short-lived negative cache: when a fetch fails/times out (e.g. X rate-limits us)
// we remember it briefly so the feed doesn't re-hit the slow upstream every render.
// Short TTL: a transient timeout / rate-limit shouldn't blank a link preview
// for long. The data is usually fetchable on the next try.
const ogNegativeCache = new TTLCache<true>(500, 90 * 1000);

// Some sites (notably Yahoo, with its pile of consent Set-Cookie headers) send
// response headers larger than undici's default 16 KB buffer, which makes
// `fetch` throw UND_ERR_HEADERS_OVERFLOW before we ever see the body. A roomier
// header buffer lets those previews succeed.
const ogDispatcher = new Agent({ maxHeaderSize: 96 * 1024 });

import type { Response } from "express";

function parseOgHtml(html: string, targetUrl: string, resolvedUrl?: string): OgData {
  const baseUrl = resolvedUrl || targetUrl;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    parsedUrl = new URL('https://unknown');
  }

  const title = extractMetaContent(html, 'og:title')
    || extractMetaName(html, 'twitter:title')
    || extractMetaContent(html, 'twitter:title')
    || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '');

  let description = extractMetaContent(html, 'og:description')
    || extractMetaName(html, 'twitter:description')
    || extractMetaContent(html, 'twitter:description')
    || extractMetaName(html, 'description')
    || '';
  if (description.length > 200) {
    description = description.substring(0, 200);
  }

  const image = extractMetaContent(html, 'og:image')
    || extractMetaName(html, 'twitter:image')
    || extractMetaContent(html, 'twitter:image')
    || extractMetaName(html, 'twitter:image:src')
    || '';

  const siteName = extractMetaContent(html, 'og:site_name')
    || parsedUrl.hostname.replace(/^www\./, '');

  // Is this a video link? (og:type=video*, twitter player card, or an og:video /
  // twitter:player tag present). Lets the client show a play affordance for
  // non-embeddable platforms like X/Twitter without us trying to iframe them.
  const ogType = extractMetaContent(html, 'og:type') || '';
  const twitterCard = (extractMetaName(html, 'twitter:card') || extractMetaContent(html, 'twitter:card') || '').toLowerCase();
  const hasVideoTag = /property=["']og:video(?::|["'])/i.test(html) || /name=["']twitter:player["']/i.test(html);
  const video = /^video/i.test(ogType) || twitterCard === 'player' || hasVideoTag;

  // Directly-playable audio: many podcast share pages expose the episode
  // enclosure via og:audio (or twitter:player:stream). Extract + normalize it so
  // the client can render an inline player instead of a bare link card. Only
  // trust it when it's clearly an audio file (declared audio/* type OR an audio
  // extension) — never embed an HTML page. NB: pure client-rendered SPAs (e.g.
  // fountain.fm) expose nothing here, so they gracefully stay link cards.
  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
  let audioRaw = extractMetaContent(html, 'og:audio:secure_url')
    || extractMetaContent(html, 'og:audio:url')
    || extractMetaContent(html, 'og:audio')
    || extractMetaName(html, 'twitter:player:stream')
    || '';
  audioRaw = stripHtmlTags(audioRaw);
  if (audioRaw && !/^https?:\/\//i.test(audioRaw)) {
    try { audioRaw = new URL(audioRaw, baseUrl).toString(); } catch { audioRaw = ''; }
  }
  const audioType = (extractMetaContent(html, 'og:audio:type') || '').toLowerCase();
  const audioUrl = (audioRaw && (/^audio\//.test(audioType) || AUDIO_EXT.test(audioRaw))) ? audioRaw : undefined;

  let resolvedImage = stripHtmlTags(image);
  if (resolvedImage && !resolvedImage.startsWith('http')) {
    try {
      resolvedImage = new URL(resolvedImage, baseUrl).toString();
    } catch {
      resolvedImage = '';
    }
  }

  return {
    title: stripHtmlTags(title),
    description: stripHtmlTags(description),
    image: resolvedImage,
    siteName: stripHtmlTags(siteName),
    url: targetUrl,
    video,
    audioUrl,
  };
}

/**
 * SSRF gate shared by /api/og and the crawler-facing ?discuss= unfurl:
 * http(s) only, no loopback/private/link-local/raw-numeric hosts, and the
 * DNS-level checks in validateHostSafety.
 */
async function isSafeExternalOgUrl(targetUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' ||
        host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.') ||
        host.endsWith('.local') || host.endsWith('.internal') ||
        host.startsWith('169.254.') || host.startsWith('fc00:') || host.startsWith('fd') ||
        host.startsWith('fe80:') || host === '[::1]' || /^\d+$/.test(host) ||
        /^0x/i.test(host)) {
      return false;
    }
    return await validateHostSafety(host);
  } catch {
    return false;
  }
}

type ExternalOgResult =
  | { ok: true; data: OgData }
  | { ok: false; status: number; error: string };

/**
 * The one external OG fetcher: cache + negative cache + manual redirects with
 * per-hop SSRF re-validation + head-only streaming read, then meta parsing.
 * Used by /api/og (client link previews) and the crawler-facing ?discuss=
 * unfurl. Callers must run isSafeExternalOgUrl first.
 */
async function fetchExternalOgData(targetUrl: string, timeoutMs = 9000): Promise<ExternalOgResult> {
  const cached = ogCache.get(targetUrl);
  if (cached) return { ok: true, data: cached };

  // Recently failed (slow/rate-limited upstream) — fail fast so callers fall
  // back to their generic presentation instead of waiting on the upstream again.
  if (ogNegativeCache.get(targetUrl)) {
    return { ok: false, status: 502, error: "Temporarily unavailable" };
  }

  try {
    const OG_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const controller = new AbortController();
    // One budget for the WHOLE operation (headers + body read). News pages can
    // be slow and multi-MB; a header-only timeout let the body read hang.
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let currentUrl = targetUrl;
      // undici's OWN fetch, not the global: passing the npm-undici Agent as
      // `dispatcher` to Node's built-in fetch silently breaks the response
      // Headers on newer Node (content-type reads as null → every page was
      // rejected as "Not an HTML page"). Same-package fetch+Agent is the
      // supported pairing and types `dispatcher` natively.
      let finalResponse: Awaited<ReturnType<typeof undiciFetch>> | null = null;
      const MAX_REDIRECTS = 5;

      for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const resp = await undiciFetch(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers: OG_HEADERS,
          dispatcher: ogDispatcher,
        });

        if (resp.status >= 300 && resp.status < 400 && i < MAX_REDIRECTS) {
          const location = resp.headers.get('location');
          if (location) {
            try {
              const redirectUrl = new URL(location, currentUrl);
              if (!['http:', 'https:'].includes(redirectUrl.protocol)) break;
              const redirectSafe = await validateHostSafety(redirectUrl.hostname);
              if (!redirectSafe) break;
              currentUrl = redirectUrl.toString();
              continue;
            } catch { break; }
          }
          break;
        }

        finalResponse = resp;
        break;
      }

      if (!finalResponse) {
        ogNegativeCache.set(targetUrl, true);
        return { ok: false, status: 502, error: "Failed to follow redirects" };
      }

      // Bot walls / rate limits (401/403/429) and upstream 5xx serve a block
      // page with no usable OpenGraph. Don't parse it — fail fast with the
      // short negative cache so a transient block recovers quickly.
      if (!finalResponse.ok) {
        try { await finalResponse.body?.cancel(); } catch {}
        ogNegativeCache.set(targetUrl, true);
        return { ok: false, status: 502, error: `Upstream ${finalResponse.status}` };
      }

      const contentType = finalResponse.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/xml') && !contentType.includes('application/xhtml')) {
        try { await finalResponse.body?.cancel(); } catch {}
        return { ok: false, status: 400, error: "Not an HTML page" };
      }

      // Stream only the start of the document. OpenGraph tags live in <head>,
      // so we stop as soon as we pass </head> (or hit the cap) — never pulling
      // the full multi-MB page. This is the main reliability fix: it keeps the
      // read fast and well inside the timeout budget.
      const MAX_BODY = 256 * 1024;
      let html = "";
      const reader = finalResponse.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let received = 0;
        while (received < MAX_BODY) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          html += decoder.decode(value, { stream: true });
          if (/<\/head>/i.test(html)) break;
        }
        try { await reader.cancel(); } catch {}
      }

      const data = parseOgHtml(html, targetUrl, currentUrl);
      ogCache.set(targetUrl, data);
      return { ok: true, data };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    // Timed out / network error / aborted — remember briefly so we fail fast
    // next time instead of re-hitting a slow or rate-limiting upstream.
    ogNegativeCache.set(targetUrl, true);
    return { ok: false, status: 502, error: err?.message || "Failed to fetch URL" };
  }
}

function stripHtmlTags(str: string): string {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .trim();
}

function extractMetaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*/?>`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["'][^>]*/?>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return stripHtmlTags(m[1]);
  }
  return null;
}

function extractMetaName(html: string, name: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*/?>`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["'][^>]*/?>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return stripHtmlTags(m[1]);
  }
  return null;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerSignupTelemetryRoutes(app);

  // Deployed app version — the same build-stamped string baked into the client
  // bundle (see script/build.ts). The client's update check polls this and
  // compares it to its own APP_VERSION; a mismatch means a newer deploy is
  // being served. no-store keeps browser HTTP caches out of the comparison
  // (the service worker's own cache is defused client-side by keying the poll
  // URL on the running version — see client/src/lib/app-update.ts).
  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ version: SERVER_APP_VERSION });
  });

  const nipKindsCache: { data: { kind: number; label: string; nip: string }[] | null; timestamp: number } = { data: null, timestamp: 0 };
  const NIP_KINDS_TTL = 7 * 24 * 60 * 60 * 1000;

  app.get("/api/nip-kinds", async (_req, res) => {
    try {
      if (nipKindsCache.data && Date.now() - nipKindsCache.timestamp < NIP_KINDS_TTL) {
        return res.json(nipKindsCache.data);
      }

      const response = await fetch("https://raw.githubusercontent.com/nostr-protocol/nips/master/README.md", {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub fetch failed: ${response.status}`);
      const text = await response.text();

      const kinds: { kind: number; label: string; nip: string }[] = [];
      const lines = text.split("\n");
      let inTable = false;

      for (const line of lines) {
        if (line.includes("| kind") && line.includes("| description")) {
          inTable = true;
          continue;
        }
        if (inTable && line.match(/^\|\s*-+/)) continue;
        if (inTable && line.startsWith("|")) {
          const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
          if (cols.length >= 3) {
            const kindStr = cols[0].replace(/`/g, "").trim();
            const label = cols[1].trim();
            const nipCol = cols[2].trim();

            const nipMatch = nipCol.match(/\[(\d+|[A-Z0-9]+)\]/);
            const nip = nipMatch ? `NIP-${nipMatch[1]}` : nipCol.replace(/\[.*?\]\(.*?\)/g, "").trim();

            if (kindStr.includes("-")) {
              const [startStr, endStr] = kindStr.split("-").map((s) => parseInt(s, 10));
              if (!isNaN(startStr) && !isNaN(endStr)) {
                kinds.push({ kind: startStr, label: `${label} (range ${kindStr})`, nip });
              }
            } else {
              const kindNum = parseInt(kindStr, 10);
              if (!isNaN(kindNum)) {
                kinds.push({ kind: kindNum, label, nip });
              }
            }
          }
        } else if (inTable && !line.startsWith("|")) {
          inTable = false;
        }
      }

      if (kinds.length > 0) {
        nipKindsCache.data = kinds;
        nipKindsCache.timestamp = Date.now();
        return res.json(kinds);
      }

      throw new Error("No kinds parsed from README");
    } catch (err) {
      console.error("NIP kinds fetch error:", err);
      if (nipKindsCache.data) {
        return res.json(nipKindsCache.data);
      }
      return res.status(503).json({ error: "Could not fetch NIP kinds" });
    }
  });

  const nip05Cache = new Map<string, { verified: boolean; ts: number }>();
  const NIP05_CACHE_TTL = 4 * 60 * 60 * 1000;
  const NIP05_CACHE_MAX = 5000;

  app.get("/api/nip05/verify", async (req, res) => {
    try {
      const nip05 = req.query.nip05 as string;
      const pubkey = req.query.pubkey as string;
      if (!nip05 || !pubkey) {
        return res.status(400).json({ error: "Missing nip05 or pubkey parameter" });
      }
      if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
        return res.status(400).json({ error: "Invalid pubkey format" });
      }

      const cacheKey = `${nip05}:${pubkey}`;
      const cached = nip05Cache.get(cacheKey);
      if (cached && Date.now() - cached.ts < NIP05_CACHE_TTL) {
        res.set("Cache-Control", "public, max-age=3600");
        return res.json({ verified: cached.verified });
      }

      let local: string;
      let domain: string;
      if (nip05.startsWith("_@")) {
        local = "_";
        domain = nip05.slice(2);
      } else if (nip05.includes("@")) {
        [local, domain] = nip05.split("@");
      } else {
        local = "_";
        domain = nip05;
      }

      if (!domain || !local) {
        return res.status(400).json({ error: "Invalid NIP-05 identifier" });
      }

      const isSafe = await validateHostSafety(domain);
      if (!isSafe) {
        nip05Cache.set(cacheKey, { verified: false, ts: Date.now() });
        return res.json({ verified: false });
      }

      const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        nip05Cache.set(cacheKey, { verified: false, ts: Date.now() });
        return res.json({ verified: false });
      }

      const data = await response.json();
      const names = data?.names;
      const verified = typeof names === "object" && names !== null && (names[local] || "").toLowerCase() === pubkey.toLowerCase();

      nip05Cache.set(cacheKey, { verified, ts: Date.now() });
      if (nip05Cache.size > NIP05_CACHE_MAX) {
        const oldest = nip05Cache.keys().next().value;
        if (oldest) nip05Cache.delete(oldest);
      }
      res.set("Cache-Control", "public, max-age=3600");
      return res.json({ verified });
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || "UNKNOWN";
      const nip05Id = req.query.nip05 as string || "";
      const host = err?.cause?.host || (nip05Id.includes("@") ? nip05Id.split("@")[1] : nip05Id) || "unknown";
      console.warn(`[nip05] Verification failed for ${host}: ${code}`);
      return res.json({ verified: false });
    }
  });

  app.get("/api/nip05/resolve", async (req, res) => {
    const identifier = req.query.identifier as string;
    try {
      if (!identifier) {
        return res.status(400).json({ error: "Missing identifier parameter", reason: "invalid_identifier" });
      }

      let local: string;
      let domain: string;
      if (identifier.startsWith("_@")) {
        local = "_";
        domain = identifier.slice(2);
      } else if (identifier.includes("@")) {
        [local, domain] = identifier.split("@");
      } else {
        local = "_";
        domain = identifier;
      }

      if (!domain || !local) {
        return res.status(400).json({ error: "Invalid NIP-05 identifier", reason: "invalid_identifier" });
      }

      const addresses4 = await dns.resolve4(domain).catch(() => [] as string[]);
      const addresses6 = await dns.resolve6(domain).catch(() => [] as string[]);
      const allAddrs = [...addresses4, ...addresses6];
      if (allAddrs.length === 0) {
        return res.status(404).json({ error: "Domain did not resolve", reason: "dns_failure", domain });
      }
      if (allAddrs.some(isPrivateIp)) {
        return res.status(403).json({ error: "Domain failed safety check", reason: "safety_rejection", domain });
      }

      const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: { "Accept": "application/json" },
        });
      } catch (fetchErr: any) {
        const code = fetchErr?.cause?.code || fetchErr?.name || "";
        const reason = code === "AbortError" || code === "TimeoutError" ? "timeout" : "unreachable";
        return res.status(502).json({ error: "Could not reach domain", reason, domain });
      }

      if (upstream.status === 404) {
        return res.status(404).json({ error: "No .well-known/nostr.json found", reason: "no_wellknown", domain });
      }
      if (!upstream.ok) {
        return res.status(502).json({ error: `Upstream returned ${upstream.status}`, reason: "unreachable", domain });
      }

      let data: any;
      try {
        data = await upstream.json();
      } catch {
        return res.status(502).json({ error: "Invalid JSON at .well-known/nostr.json", reason: "invalid_json", domain });
      }
      const names = data?.names;
      const pubkey = typeof names === "object" && names !== null ? names[local] : null;

      if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
        const reason = local === "_" ? "no_default_entry" : "no_entry";
        return res.status(404).json({ error: "Pubkey not found for identifier", reason, domain });
      }

      res.set("Cache-Control", "public, max-age=3600");
      return res.json({ pubkey: pubkey.toLowerCase() });
    } catch (err) {
      console.error("[nip05] Resolution error:", err);
      return res.status(500).json({ error: "Resolution failed", reason: "server_error" });
    }
  });

  app.get("/api/lnurl/pay", async (req, res) => {
    try {
      const address = req.query.address as string;
      if (!address) return res.status(400).json({ error: "Missing address parameter" });

      let url: string;
      if (address.includes("@")) {
        const [name, domain] = address.split("@");
        const isSafe = await validateHostSafety(domain);
        if (!isSafe) {
          return res.status(403).json({ error: "Address domain failed safety check" });
        }
        url = `https://${domain}/.well-known/lnurlp/${name}`;
      } else {
        return res.status(400).json({ error: "Invalid lightning address format" });
      }

      const attempt = async (retryCount: number): Promise<void> => {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.error(`[lnurl/pay] Upstream ${response.status} from ${url}: ${body.slice(0, 500)}`);
          if (response.status >= 500 && retryCount < 1) {
            await new Promise(r => setTimeout(r, 1000));
            return attempt(retryCount + 1);
          }
          return res.status(502).json({ error: `The recipient's lightning provider returned an error (${response.status}). They may be temporarily unavailable.` });
        }
        const data = await response.json();
        res.json(data);
      };
      await attempt(0);
    } catch (err: any) {
      console.error(`[lnurl/pay] Error:`, err.message);
      res.status(502).json({ error: err.message || "Failed to resolve lightning address" });
    }
  });

  app.get("/api/lnurl/invoice", async (req, res) => {
    try {
      const callback = req.query.callback as string;
      const amount = req.query.amount as string;
      const nostr = req.query.nostr as string;
      if (!callback || !amount) return res.status(400).json({ error: "Missing callback or amount" });

      const comment = req.query.comment as string;
      const url = new URL(callback);
      const isSafe = await validateHostSafety(url.hostname);
      if (!isSafe) {
        return res.status(403).json({ error: "Callback domain failed safety check" });
      }
      url.searchParams.set("amount", amount);
      if (nostr) url.searchParams.set("nostr", nostr);
      if (comment) url.searchParams.set("comment", comment);

      const attempt = async (retryCount: number): Promise<void> => {
        const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.error(`[lnurl/invoice] Upstream ${response.status} from ${url.toString().slice(0, 200)}: ${body.slice(0, 500)}`);
          if (response.status >= 500 && retryCount < 1) {
            await new Promise(r => setTimeout(r, 1000));
            return attempt(retryCount + 1);
          }
          return res.status(502).json({ error: `The recipient's lightning provider returned an error (${response.status}). The zap could not be completed.` });
        }
        const data = await response.json();
        res.json(data);
      };
      await attempt(0);
    } catch (err: any) {
      console.error(`[lnurl/invoice] Error:`, err.message);
      res.status(502).json({ error: err.message || "Failed to fetch invoice" });
    }
  });

  function extractYouTubeVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (host === 'youtu.be') {
        return parsed.pathname.slice(1).split('/')[0] || null;
      }
      if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
        const v = parsed.searchParams.get('v');
        if (v) return v;
        const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/);
        if (shortsMatch) return shortsMatch[1];
        const embedMatch = parsed.pathname.match(/\/embed\/([^/?]+)/);
        if (embedMatch) return embedMatch[1];
        const liveMatch = parsed.pathname.match(/\/live\/([^/?]+)/);
        if (liveMatch) return liveMatch[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  const icalProxyRateLimit = new Map<string, { count: number; resetAt: number }>();
  const ICAL_RATE_LIMIT = 30;
  const ICAL_RATE_WINDOW = 60 * 1000;
  const icalFeedCache = new TTLCache<string>(100, 60 * 60 * 1000);

  app.get("/api/ical-proxy", async (req, res) => {
    const feedUrl = req.query.url as string;
    if (!feedUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
      const parsed = new URL(feedUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Invalid protocol" });
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" ||
        host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("172.") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
        host.startsWith("169.254.") || host.startsWith("fc00:") || host.startsWith("fd") ||
        host.startsWith("fe80:") || host === "[::1]"
      ) {
        return res.status(400).json({ error: "Invalid URL" });
      }

      const isSafe = await validateHostSafety(host);
      if (!isSafe) {
        return res.status(400).json({ error: "Invalid URL" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const clientIp = (req.ip || req.socket.remoteAddress || "unknown");
    const now = Date.now();
    const rateEntry = icalProxyRateLimit.get(clientIp);
    if (rateEntry && now < rateEntry.resetAt) {
      if (rateEntry.count >= ICAL_RATE_LIMIT) {
        return res.status(429).json({ error: "Too many requests, please try again later" });
      }
      rateEntry.count++;
    } else {
      icalProxyRateLimit.set(clientIp, { count: 1, resetAt: now + ICAL_RATE_WINDOW });
    }

    const cached = icalFeedCache.get(feedUrl);
    if (cached) {
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(cached);
    }

    try {
      const response = await fetch(feedUrl, {
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
        headers: {
          "Accept": "text/calendar, application/ics, text/plain, */*",
          "User-Agent": "RelayOutpost/1.0 Calendar Feed Reader",
        },
      });
      if (!response.ok) {
        return res.status(502).json({ error: `Feed returned status ${response.status}` });
      }

      // Cap the response size. A hostile or misconfigured feed could stream
      // gigabytes; response.text() would buffer all of it. Reject early on a
      // declared Content-Length, and otherwise read the body with a hard byte
      // cap, aborting as soon as it's exceeded.
      const MAX_ICAL_BYTES = 5 * 1024 * 1024; // 5MB
      const declaredLen = parseInt(response.headers.get("content-length") || "", 10);
      if (Number.isFinite(declaredLen) && declaredLen > MAX_ICAL_BYTES) {
        return res.status(413).json({ error: "Calendar feed is too large" });
      }
      let text: string;
      const reader = response.body?.getReader();
      if (reader) {
        const chunks: Buffer[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.length;
            if (received > MAX_ICAL_BYTES) {
              try { await reader.cancel(); } catch {}
              return res.status(413).json({ error: "Calendar feed is too large" });
            }
            chunks.push(Buffer.from(value));
          }
        }
        text = Buffer.concat(chunks).toString("utf-8");
      } else {
        text = await response.text();
        if (text.length > MAX_ICAL_BYTES) {
          return res.status(413).json({ error: "Calendar feed is too large" });
        }
      }

      if (!text.includes("BEGIN:VCALENDAR") && !text.includes("BEGIN:VEVENT")) {
        return res.status(422).json({ error: "URL does not appear to be a valid iCal feed" });
      }
      icalFeedCache.set(feedUrl, text);
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(text);
    } catch (err: any) {
      console.error("[ical-proxy] Error:", err.message);
      return res.status(502).json({ error: "Failed to fetch calendar feed" });
    }
  });

  app.get("/api/og", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    if (!(await isSafeExternalOgUrl(targetUrl))) {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const cached = ogCache.get(targetUrl);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=3600');
      return res.json(cached);
    }

    // Recently failed (slow/rate-limited upstream) — fail fast so the feed falls
    // back to the plain link preview instead of waiting on the upstream again.
    if (ogNegativeCache.get(targetUrl)) {
      res.set('Cache-Control', 'public, max-age=120');
      return res.status(502).json({ error: "Temporarily unavailable" });
    }

    try {
      const parsedUrl = new URL(targetUrl);
      const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
      const selfArticleMatch = normalizedPath.match(/^\/articles\/(naddr1[a-z0-9]+)$/);
      if (selfArticleMatch) {
        const naddrStr = selfArticleMatch[1];
        try {
          const decoded = nip19.decode(naddrStr);
          if (decoded.type === "naddr") {
            const { pubkey, identifier, kind } = decoded.data;
            const event = await fetchNostrEvent({ kinds: [kind], authors: [pubkey], "#d": [identifier] });
            if (event) {
              const titleTag = event.tags?.find((t: string[]) => t[0] === "title");
              const summaryTag = event.tags?.find((t: string[]) => t[0] === "summary");
              const imageTag = event.tags?.find((t: string[]) => t[0] === "image");
              const title = titleTag?.[1] || "Article";
              const rawSummary = summaryTag?.[1] || (event.content || "").replace(/[#*`>]/g, "").slice(0, 200);
              const data = {
                title: title,
                description: rawSummary.length > 200 ? rawSummary.slice(0, 200) + "..." : rawSummary,
                image: imageTag?.[1] || "",
                siteName: "Relay Outpost",
                url: targetUrl,
              };
              ogCache.set(targetUrl, data);
              res.set('Cache-Control', 'public, max-age=3600');
              return res.json(data);
            }
            const fallbackTitle = identifier ? identifier.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Article";
            const fallbackData = {
              title: fallbackTitle,
              description: "Read this article on Relay Outpost",
              image: "",
              siteName: "Relay Outpost",
              url: targetUrl,
            };
            ogCache.set(targetUrl, fallbackData);
            res.set('Cache-Control', 'public, max-age=300');
            return res.json(fallbackData);
          }
        } catch {}
      }

      const selfThreadMatch = normalizedPath.match(/^\/thread\/([a-f0-9]{64})$/);
      const selfProfileMatch = normalizedPath.match(/^\/profile\/(npub1[a-z0-9]+)$/);
      if (selfThreadMatch) {
        const eventId = selfThreadMatch[1];
        const event = await fetchNostrEvent({ ids: [eventId] });
        if (event) {
          const imageMatch = event.content?.match(/https?:\/\/\S+\.(jpeg|jpg|gif|png|webp)(\?[^\s]*)?/i);
          const textContent = (event.content || "").replace(/https?:\/\/\S+/g, "").replace(/nostr:\S+/g, "").trim();
          const desc = textContent.length > 150 ? textContent.slice(0, 150) + "..." : textContent;
          let authorName = "";
          const profile = await fetchNostrEvent({ kinds: [0], authors: [event.pubkey] });
          if (profile) {
            try { const meta = JSON.parse(profile.content); authorName = meta.display_name || meta.name || ""; } catch {}
          }
          const data = {
            title: authorName ? `Post by ${authorName}` : "Post on Relay Outpost",
            description: desc || "View this post on Relay Outpost",
            image: imageMatch ? imageMatch[0] : "",
            siteName: "Relay Outpost",
            url: targetUrl,
          };
          ogCache.set(targetUrl, data);
          res.set('Cache-Control', 'public, max-age=3600');
          return res.json(data);
        }
      } else if (selfProfileMatch) {
        const npub = selfProfileMatch[1];
        try {
          const decoded = nip19.decode(npub);
          const pk = decoded.data as string;
          const profile = await fetchNostrEvent({ kinds: [0], authors: [pk] });
          if (profile) {
            const profileMeta = JSON.parse(profile.content);
            const name = profileMeta.display_name || profileMeta.name || npub.slice(0, 16) + "...";
            const bio = (profileMeta.about || "").slice(0, 150);
            const avatar = profileMeta.picture || "";
            const data = {
              title: name,
              description: bio || `View ${name}'s profile on Relay Outpost`,
              image: avatar,
              siteName: "Relay Outpost",
              url: targetUrl,
            };
            ogCache.set(targetUrl, data);
            res.set('Cache-Control', 'public, max-age=3600');
            return res.json(data);
          }
        } catch {}
      }
    } catch {}

    const ytId = extractYouTubeVideoId(targetUrl);
    if (ytId) {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const oembedRes = await fetch(oembedUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (oembedRes.ok) {
          const oembed = await oembedRes.json() as Record<string, any>;
          const data = {
            title: (oembed.title as string) || '',
            description: oembed.author_name ? `By ${oembed.author_name}` : '',
            image: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
            siteName: 'YouTube',
            url: targetUrl,
            video: true,
          };
          ogCache.set(targetUrl, data);
          res.set('Cache-Control', 'public, max-age=3600');
          return res.json(data);
        }
      } catch {}

      const data = {
        title: '',
        description: '',
        image: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
        siteName: 'YouTube',
        url: targetUrl,
        video: true,
      };
      ogCache.set(targetUrl, data);
      res.set('Cache-Control', 'public, max-age=3600');
      return res.json(data);
    }

    const result = await fetchExternalOgData(targetUrl);
    if (result.ok) {
      res.set('Cache-Control', 'public, max-age=3600');
      return res.json(result.data);
    }
    return res.status(result.status).json({ error: result.error });
  });

  const rssParser = new RSSParser({
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    customFields: {
      item: [
        ["itunes:duration", "itunesDuration"],
        ["itunes:image", "itunesImage"],
        ["itunes:episode", "itunesEpisode"],
        ["itunes:season", "itunesSeason"],
        ["itunes:summary", "itunesSummary"],
        ["podcast:transcript", "podcastTranscripts", { keepArray: true }],
        ["podcast:chapters", "podcastChapters"],
      ],
      feed: [
        ["itunes:image", "itunesImage"],
        ["itunes:author", "itunesAuthor"],
        ["podcast:value", "podcastValue"],
      ],
    },
  });

  // Capacity must comfortably exceed the News "All feeds" set (~90 feeds) plus
  // drill-ins, or LRU eviction makes most feeds re-parse cold on every load. TTL
  // defaults to 5 min (news); podcasts (which change a few times a week) get a
  // much longer TTL per-entry at set() time.
  const rssCache = new TTLCache<any>(256, 5 * 60 * 1000);
  const RSS_NEWS_TTL = 5 * 60 * 1000;
  const RSS_PODCAST_TTL = 30 * 60 * 1000;

  const podverseCache = new TTLCache<any>(100, 30 * 60 * 1000);

  app.get("/api/podverse/search", async (req, res) => {
    const query = (req.query.q as string || "").trim();
    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Query too short" });
    }
    const cacheKey = `search:${query.toLowerCase()}`;
    const cached = podverseCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const url = `https://api.podverse.fm/api/v1/podcast?page=1&sort=top-all-time&searchTitle=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "RelayOutpost/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return res.status(502).json({ error: "Podverse API error" });
      const data = await response.json();
      const podcasts = (Array.isArray(data) && Array.isArray(data[0]) ? data[0] : []).map((p: any) => ({
        id: p.id,
        title: p.title,
        description: p.description?.replace(/<[^>]*>/g, "").slice(0, 300) || "",
        imageUrl: p.shrunkImageUrl || p.imageUrl || "",
        feedUrls: (p.feedUrls || []).map((f: any) => f.url).filter(Boolean),
        linkUrl: p.linkUrl || "",
        lastEpisodeTitle: p.lastEpisodeTitle || "",
        lastEpisodePubDate: p.lastEpisodePubDate || "",
        podcastIndexId: p.podcastIndexId || "",
      }));
      const result = { podcasts };
      podverseCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("Podverse search error:", err.message);
      return res.status(502).json({ error: "Podverse search failed" });
    }
  });

  app.get("/api/podverse/podcast/:id", async (req, res) => {
    const podcastId = req.params.id;
    if (!podcastId) return res.status(400).json({ error: "Missing podcast ID" });

    const cacheKey = `podcast:${podcastId}`;
    const cached = podverseCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const response = await fetch(`https://api.podverse.fm/api/v1/podcast/${podcastId}`, {
        headers: { "User-Agent": "RelayOutpost/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return res.status(502).json({ error: "Podverse API error" });
      const p = await response.json();
      const result = {
        id: p.id,
        title: p.title,
        description: p.description?.replace(/<[^>]*>/g, "").slice(0, 300) || "",
        imageUrl: p.shrunkImageUrl || p.imageUrl || "",
        feedUrls: (p.feedUrls || []).map((f: any) => f.url).filter(Boolean),
        linkUrl: p.linkUrl || "",
        lastEpisodeTitle: p.lastEpisodeTitle || "",
        lastEpisodePubDate: p.lastEpisodePubDate || "",
        podcastIndexId: p.podcastIndexId || "",
        value: p.value || [],
        funding: p.funding || [],
      };
      podverseCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("Podverse podcast error:", err.message);
      return res.status(502).json({ error: "Podverse podcast fetch failed" });
    }
  });

  const podcastIndexCache = new TTLCache<any>(200, 5 * 60 * 1000);

  function getPodcastIndexHeaders() {
    const apiKey = process.env.PODCAST_INDEX_API_KEY || "";
    const apiSecret = process.env.PODCAST_INDEX_API_SECRET || "";
    const ts = Math.floor(Date.now() / 1000);
    const hash = crypto.createHash("sha1").update(apiKey + apiSecret + String(ts)).digest("hex");
    return {
      "User-Agent": "RelayOutpost/1.0",
      "X-Auth-Date": String(ts),
      "X-Auth-Key": apiKey,
      "Authorization": hash,
    };
  }

  // Shared feed shaper for search/trending/byfeedurl. Preserves freshness
  // (lastUpdateTime / newestItemPubdate) and the category id→name MAP (upstream
  // sends {"55":"News"}), so the client can render category chips with ids and
  // sort by recency. Keeps the V4V `value` block, artwork, author, ep count.
  function mapPodcastIndexFeed(f: any) {
    return {
      id: f.id,
      title: f.title || "",
      author: f.author || f.ownerName || "",
      description: (f.description || "").replace(/<[^>]*>/g, "").slice(0, 300),
      image: f.artwork || f.image || "",
      url: f.url || "",
      episodeCount: f.episodeCount || 0,
      language: f.language || "",
      // Keep the id→name map when present; tolerate the legacy array shape.
      categories: f.categories && typeof f.categories === "object" ? f.categories : {},
      value: f.value ?? null,
      lastUpdateTime: f.lastUpdateTime ?? 0,
      newestItemPubdate: f.newestItemPublishTime ?? f.newestItemPubdate ?? 0,
      trendScore: f.trendScore ?? 0,
    };
  }

  // Upstream byterm search, shaped through mapPodcastIndexFeed. Shared by
  // /search and /resolve (throws on HTTP/network errors; callers map to 502).
  async function fetchSearchUpstream(query: string, max: number): Promise<{ feeds: any[]; count: number }> {
    const response = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(query)}&max=${max}`,
      { headers: getPodcastIndexHeaders(), signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Podcast Index search HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    const feeds = (data.feeds || []).map(mapPodcastIndexFeed);
    return { feeds, count: data.count || feeds.length };
  }

  app.get("/api/podcastindex/search", async (req, res) => {
    const query = (req.query.q as string || "").trim();
    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Query too short" });
    }
    if (!process.env.PODCAST_INDEX_API_KEY || !process.env.PODCAST_INDEX_API_SECRET) {
      return res.status(503).json({ error: "Podcast Index not configured" });
    }
    // Client-overridable result count for "Load more" (default 20, hard cap 40).
    const rawMax = parseInt(String(req.query.max ?? ""), 10);
    const max = Number.isFinite(rawMax) ? Math.min(40, Math.max(1, rawMax)) : 20;
    const cacheKey = `pi_search:${query.toLowerCase()}:${max}`;
    const cached = podcastIndexCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const result = await fetchSearchUpstream(query, max);
      podcastIndexCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("Podcast Index search error:", err.message);
      return res.status(502).json({ error: "Podcast Index search failed" });
    }
  });

  // Preset-show resolution: the SAME upstream search, but held in a much
  // longer-lived cache — curated preset lists are stable, so this keeps the
  // Add-feed dialog's preset sections from hammering upstream. The client runs
  // the exact/normalized-title matcher over these results at render time (feed
  // ids and metadata are never hardcoded — they drift upstream).
  const podcastResolveCache = new TTLCache<any>(300, 12 * 60 * 60 * 1000);
  app.get("/api/podcastindex/resolve", async (req, res) => {
    const query = (req.query.q as string || "").trim();
    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Query too short" });
    }
    if (!process.env.PODCAST_INDEX_API_KEY || !process.env.PODCAST_INDEX_API_SECRET) {
      return res.status(503).json({ error: "Podcast Index not configured" });
    }
    const cacheKey = `pi_resolve:${query.toLowerCase()}`;
    const cached = podcastResolveCache.get(cacheKey);
    if (cached) return res.json(cached);
    try {
      const result = await fetchSearchUpstream(query, 10);
      podcastResolveCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("Podcast Index resolve error:", err.message);
      return res.status(502).json({ error: "Podcast Index resolve failed" });
    }
  });

  app.get("/api/podcastindex/trending", async (req, res) => {
    if (!process.env.PODCAST_INDEX_API_KEY || !process.env.PODCAST_INDEX_API_SECRET) {
      return res.status(503).json({ error: "Podcast Index not configured" });
    }
    // Optional Podcast Index category filter. Accepts an id ("55"), a name
    // ("News"), or a compound name ("Society & Culture"). Allow-list permits
    // letters, digits, spaces, commas, `&` and `-` within a strict length bound
    // so it forwards safely (upstream matches on either id or name).
    const rawCat = typeof req.query.cat === "string" ? req.query.cat.trim() : "";
    const cat = /^[a-zA-Z0-9 ,&-]{0,60}$/.test(rawCat) ? rawCat : "";
    // Client-overridable result count for "Load more" (default 10, hard cap 50).
    const rawMax = parseInt(String(req.query.max ?? ""), 10);
    const max = Number.isFinite(rawMax) ? Math.min(50, Math.max(1, rawMax)) : 10;
    // Language filter (default en); allow-listed to a BCP-47-ish shape.
    const rawLang = typeof req.query.lang === "string" ? req.query.lang.trim() : "";
    const lang = /^[a-zA-Z,-]{2,35}$/.test(rawLang) ? rawLang : "en";

    const cacheKey = `pi_trending:${cat.toLowerCase()}:${max}:${lang.toLowerCase()}`;
    const cached = podcastIndexCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const result = await fetchTrendingUpstream(cat, max, lang);
      podcastIndexCache.set(cacheKey, result);
      // Request-driven trend history (no setInterval — the deployment can
      // sleep): any uncached trending hit may roll the category's snapshot.
      void maybeCaptureTrendSnapshot(normalizeTrendCategoryKey(cat), result.feeds);
      return res.json(result);
    } catch (err: any) {
      console.error("Podcast Index trending error:", err.message);
      return res.status(502).json({ error: "Podcast Index trending failed" });
    }
  });

  // Upstream trending fetch, shaped through mapPodcastIndexFeed. Shared by
  // /trending and /trend-suggestions (throws on errors; callers map to 502).
  async function fetchTrendingUpstream(cat: string, max: number, lang: string): Promise<{ feeds: any[]; count: number }> {
    const response = await fetch(
      `https://api.podcastindex.org/api/1.0/podcasts/trending?max=${max}&lang=${encodeURIComponent(lang)}${cat ? `&cat=${encodeURIComponent(cat)}` : ""}`,
      { headers: getPodcastIndexHeaders(), signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Podcast Index trending HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    const feeds = (data.feeds || []).map(mapPodcastIndexFeed);
    return { feeds, count: data.count || feeds.length };
  }

  // ── Trend snapshots + "Rising now" suggestions ─────────────────────────────
  // Rolling ~14-day history of the top ~15 trending feeds per category, stored
  // in Postgres (podcast_trend_snapshots — the repo's drizzle pattern, so it
  // survives deploy restarts/sleeps). Capture is REQUEST-DRIVEN: at most one
  // snapshot per category per ~20h, rolled on trending / trend-suggestions
  // traffic. All failures degrade silently — trending never breaks because
  // history couldn't be written (e.g. before `npm run db:push` creates the
  // table on a fresh environment).

  // Last capture time per category key, seeded once from the DB so restarts
  // don't double-capture within the interval.
  const trendSnapshotLastCapture = new Map<string, number>();
  let trendClockSeed: Promise<void> | null = null;
  function seedTrendClock(): Promise<void> {
    if (!trendClockSeed) {
      trendClockSeed = (async () => {
        const rows = await db
          .select({
            category: podcastTrendSnapshots.category,
            last: sql<string | Date | null>`max(${podcastTrendSnapshots.capturedAt})`,
          })
          .from(podcastTrendSnapshots)
          .groupBy(podcastTrendSnapshots.category);
        for (const r of rows) {
          const t = r.last ? new Date(r.last as any).getTime() : NaN;
          if (Number.isFinite(t)) trendSnapshotLastCapture.set(r.category, t);
        }
      })().catch((err: any) => {
        console.warn("Trend snapshot clock seed failed:", err?.message);
        trendClockSeed = null; // allow a later retry
      });
    }
    return trendClockSeed ?? Promise.resolve();
  }

  async function maybeCaptureTrendSnapshot(categoryKey: string, feeds: any[]): Promise<void> {
    try {
      if (!Array.isArray(feeds) || feeds.length === 0) return;
      await seedTrendClock();
      const now = Date.now();
      if (!shouldCaptureSnapshot(trendSnapshotLastCapture.get(categoryKey) ?? null, now)) return;
      // Claim the slot before awaiting the insert so concurrent requests in
      // the same burst don't write duplicate snapshots.
      trendSnapshotLastCapture.set(categoryKey, now);
      const entries = toSnapshotEntries(feeds, categoryKey, now);
      if (entries.length === 0) return;
      const metaById = new Map<number, any>(feeds.map((f: any) => [f.id, f]));
      await db.insert(podcastTrendSnapshots).values(
        entries.map((e) => ({
          category: e.category,
          day: e.day,
          feedId: e.feedId,
          title: e.title,
          rank: e.rank,
          trendScore: Math.round(e.trendScore ?? 0),
          // Full mapped feed JSON so suggestions can render complete cards.
          meta: JSON.stringify(metaById.get(e.feedId) ?? null),
        })),
      );
      // Rolling-window prune (all categories; cheap on a small table).
      await db
        .delete(podcastTrendSnapshots)
        .where(lt(podcastTrendSnapshots.capturedAt, new Date(historyCutoffMs(now))));
    } catch (err: any) {
      console.warn("Trend snapshot capture skipped:", err?.message);
    }
  }

  const trendSuggestionsCache = new TTLCache<any>(50, 10 * 60 * 1000);
  app.get("/api/podcastindex/trend-suggestions", async (req, res) => {
    if (!process.env.PODCAST_INDEX_API_KEY || !process.env.PODCAST_INDEX_API_SECRET) {
      return res.status(503).json({ error: "Podcast Index not configured" });
    }
    // Same allow-list as /trending's `cat`; accepts an id ("86"), a preset
    // name ("Sports"), or nothing for global suggestions.
    const rawCategory = typeof req.query.category === "string" ? req.query.category.trim() : "";
    if (!/^[a-zA-Z0-9 ,&-]{0,60}$/.test(rawCategory)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    const categoryKey = normalizeTrendCategoryKey(rawCategory);
    const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(10, Math.max(1, rawLimit)) : 5;

    const cacheKey = `pi_trendsuggest:${categoryKey}:${limit}`;
    const cached = trendSuggestionsCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      // Roll this category's snapshot first when stale, so a category the
      // trending route hasn't seen recently still accumulates history.
      await seedTrendClock();
      if (shouldCaptureSnapshot(trendSnapshotLastCapture.get(categoryKey) ?? null, Date.now())) {
        try {
          const { feeds } = await fetchTrendingUpstream(categoryKey, SNAPSHOT_TOP_N, "en");
          await maybeCaptureTrendSnapshot(categoryKey, feeds);
        } catch (err: any) {
          console.warn("Trend suggestion snapshot refresh failed:", err?.message);
        }
      }

      const rows = await db
        .select()
        .from(podcastTrendSnapshots)
        .where(and(
          eq(podcastTrendSnapshots.category, categoryKey),
          gte(podcastTrendSnapshots.capturedAt, new Date(historyCutoffMs(Date.now()))),
        ));

      const metaByFeed = new Map<number, any>();
      const history: TrendSnapshotEntry[] = rows.map((r) => {
        let meta: any = null;
        try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* tolerate bad rows */ }
        if (meta) metaByFeed.set(r.feedId, meta); // rows arrive oldest-first per insert order; later wins
        return {
          feedId: r.feedId,
          title: r.title,
          category: r.category,
          rank: r.rank,
          day: r.day,
          trendScore: r.trendScore ?? 0,
          hasCompleteMeta: !!(meta?.image && meta?.author && meta?.description),
        };
      });

      const suggestions = computeTrendSuggestions(history, { limit }).map((s) => ({
        ...s,
        feed: metaByFeed.get(s.feedId) ?? null,
      }));
      const result = { suggestions };
      trendSuggestionsCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      // History is a nice-to-have — the client skips the row silently.
      console.warn("Trend suggestions unavailable:", err?.message);
      return res.json({ suggestions: [] });
    }
  });

  // Full Podcast Index category catalog (id + name). Cached passthrough so the
  // client can refresh its static pill list / "More categories" sheet.
  app.get("/api/podcastindex/categories", async (_req, res) => {
    if (!process.env.PODCAST_INDEX_API_KEY || !process.env.PODCAST_INDEX_API_SECRET) {
      return res.status(503).json({ error: "Podcast Index not configured" });
    }
    const cacheKey = "pi_categories";
    const cached = podcastIndexCache.get(cacheKey);
    if (cached) return res.json(cached);
    try {
      const response = await fetch(
        "https://api.podcastindex.org/api/1.0/categories/list",
        { headers: getPodcastIndexHeaders(), signal: AbortSignal.timeout(8000) }
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`Podcast Index categories HTTP ${response.status}: ${body.slice(0, 200)}`);
        return res.status(502).json({ error: "Podcast Index API error" });
      }
      const data = await response.json();
      const categories = (data.feeds || [])
        .map((c: any) => ({ id: c.id, name: c.name || "" }))
        .filter((c: any) => c.id != null && c.name);
      const result = { categories, count: categories.length };
      podcastIndexCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("Podcast Index categories error:", err.message);
      return res.status(502).json({ error: "Podcast Index categories failed" });
    }
  });

  // Look up / enrich a single PODCAST feed by its URL. Used ONLY to validate +
  // enrich podcast URLs in manual-add — general RSS never goes through here (not
  // every feed is in Podcast Index), it validates via /api/rss/discover instead.
  app.get("/api/podcastindex/byfeedurl", async (req, res) => {
    if (!process.env.PODCAST_INDEX_API_KEY || !process.env.PODCAST_INDEX_API_SECRET) {
      return res.status(503).json({ error: "Podcast Index not configured" });
    }
    const feedUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) {
      return res.status(400).json({ error: "Missing or invalid url" });
    }
    const cacheKey = `pi_byfeedurl:${feedUrl.toLowerCase()}`;
    const cached = podcastIndexCache.get(cacheKey);
    if (cached) return res.json(cached);
    try {
      const response = await fetch(
        `https://api.podcastindex.org/api/1.0/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
        { headers: getPodcastIndexHeaders(), signal: AbortSignal.timeout(8000) }
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`Podcast Index byfeedurl HTTP ${response.status}: ${body.slice(0, 200)}`);
        return res.status(502).json({ error: "Podcast Index API error" });
      }
      const data = await response.json();
      // Upstream returns { status, feed: {...} } (or feed:false when unknown).
      const feed = data && data.feed && typeof data.feed === "object"
        ? mapPodcastIndexFeed(data.feed)
        : null;
      const result = { feed };
      podcastIndexCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("Podcast Index byfeedurl error:", err.message);
      return res.status(502).json({ error: "Podcast Index byfeedurl failed" });
    }
  });

  // Lets the client show a clear "connect Podcast Index" state instead of a
  // silent-empty Discover tab when the API keys aren't configured.
  app.get("/api/podcastindex/status", (_req, res) => {
    res.json({ configured: !!process.env.PODCAST_INDEX_API_KEY && !!process.env.PODCAST_INDEX_API_SECRET });
  });

  // Whether a URL is a safe public http(s) target (SSRF guard) — mirrors the
  // inline checks in /api/rss and /api/rss/article.
  async function isPublicHttpUrl(urlStr: string): Promise<boolean> {
    try {
      const parsed = new URL(urlStr);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" ||
          host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.") ||
          host.endsWith(".local") || host.endsWith(".internal")) return false;
      return await validateHostSafety(host);
    } catch { return false; }
  }

  const rssDiscoverCache = new TTLCache<any>(100, 10 * 60 * 1000);
  const hostnameOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  // Decode HTML entities in feed titles; loops to handle double-encoding
  // (e.g. "&amp;raquo;" → "&raquo;" → "»").
  const decodeEntities = (s: string) => {
    let out = s || "";
    for (let i = 0; i < 3; i++) {
      const next = out
        .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&raquo;/g, "»").replace(/&laquo;/g, "«")
        .replace(/&hellip;/g, "…").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
        .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      if (next === out) break;
      out = next;
    }
    return out.trim();
  };

  // Fetch a candidate URL and confirm it's a real RSS/Atom feed (bounded timeout
  // + size cap), returning its title. Used to validate auto-detected links.
  async function validateFeedUrl(u: string): Promise<{ title: string } | null> {
    if (!(await isPublicHttpUrl(u))) return null;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 7000);
      const r = await fetch(u, {
        headers: { "User-Agent": "RelayOutpost/1.0", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(t);
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const text = new TextDecoder().decode(buf.slice(0, 1.5 * 1024 * 1024));
      if (!/<(rss|feed)[\s>]/i.test(text)) return null;
      const feed = await rssParser.parseString(text);
      if (!feed || !Array.isArray(feed.items)) return null;
      return { title: decodeEntities(feed.title || "") };
    } catch { return null; }
  }

  // Auto-detect a usable RSS/Atom feed from any pasted site or feed URL, so users
  // don't have to hunt for the raw XML link. No API key needed.
  app.get("/api/rss/discover", async (req, res) => {
    const input = (req.query.url as string || "").trim();
    if (!input) return res.status(400).json({ error: "Missing url parameter" });
    const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    if (!(await isPublicHttpUrl(normalized))) return res.status(400).json({ error: "Invalid URL" });

    const cached = rssDiscoverCache.get(input);
    if (cached) return res.json(cached);

    // Fetch the pasted URL once (it may be the feed itself or an HTML page).
    let body = "";
    try {
      const origin = new URL(normalized).origin;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(normalized, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "Referer": origin + "/",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(t);
      const buf = await r.arrayBuffer();
      body = new TextDecoder().decode(buf.slice(0, 1.5 * 1024 * 1024));
    } catch {
      return res.json({ feeds: [] });
    }

    const found = new Map<string, { title: string; url: string }>();

    // 1) The pasted URL is itself a feed.
    if (/<(rss|feed)[\s>]/i.test(body)) {
      try {
        const feed = await rssParser.parseString(body);
        if (feed && Array.isArray(feed.items)) {
          found.set(normalized, { title: decodeEntities(feed.title || "") || hostnameOf(normalized), url: normalized });
        }
      } catch {}
    }

    // 2) Otherwise scan the HTML for <link rel="alternate" type="...rss/atom..."> tags.
    if (found.size === 0) {
      const candidates: { href: string; title: string }[] = [];
      const linkRe = /<link\b[^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(body)) !== null) {
        const tag = m[0];
        if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
        if (!/type\s*=\s*["'](?:application\/(?:rss\+xml|atom\+xml)|text\/xml)["']/i.test(tag)) continue;
        const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
        if (!href) continue;
        const title = (tag.match(/title\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
        try { candidates.push({ href: new URL(href, normalized).toString(), title }); } catch {}
      }
      for (const c of candidates.slice(0, 5)) {
        if (found.has(c.href)) continue;
        const v = await validateFeedUrl(c.href);
        if (v) found.set(c.href, { title: decodeEntities(c.title) || v.title || hostnameOf(c.href), url: c.href });
      }
    }

    // 3) Common fallback paths if nothing found yet.
    if (found.size === 0) {
      try {
        const origin = new URL(normalized).origin;
        for (const path of ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"]) {
          const u = origin + path;
          const v = await validateFeedUrl(u);
          if (v) { found.set(u, { title: v.title || hostnameOf(u), url: u }); break; }
        }
      } catch {}
    }

    const result = { feeds: Array.from(found.values()) };
    if (result.feeds.length > 0) rssDiscoverCache.set(input, result);
    return res.json(result);
  });

  app.get("/api/rss", async (req, res) => {
    const feedUrl = req.query.url as string;
    if (!feedUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
      const parsed = new URL(feedUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Invalid protocol" });
      }
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' ||
          host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.') ||
          host.endsWith('.local') || host.endsWith('.internal')) {
        return res.status(400).json({ error: "Invalid feed URL" });
      }
      const isSafe = await validateHostSafety(host);
      if (!isSafe) {
        return res.status(400).json({ error: "Invalid feed URL" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const cached = rssCache.get(feedUrl);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(cached);
    }

    try {
      const feed = await rssParser.parseURL(feedUrl);

      function parseItunesDuration(raw: string | undefined): number {
        if (!raw) return 0;
        const parts = raw.split(":").map(Number);
        if (parts.some(isNaN)) return parseInt(raw) || 0;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
      }

      const isAudioEnclosure = (enc: any) =>
        enc?.url && (enc.type?.startsWith("audio/") || /\.(mp3|m4a|ogg|wav|aac|opus)(\?|$)/i.test(enc.url));

      const extractItunesImage = (img: any): string => {
        if (!img) return "";
        if (typeof img === "string") return img;
        if (img.href) return img.href;
        if (img.$?.href) return img.$.href;
        return "";
      };
      const feedImage = extractItunesImage((feed as any).itunesImage) || (feed as any).image?.url || "";
      const feedAuthor = (feed as any).itunesAuthor || "";

      // `<podcast:transcript>` may appear multiple times (one per format).
      // Pick the one our client-side parser handles best: JSON > VTT > SRT.
      const transcriptAttrs = (entry: any): { url?: string; type?: string } => {
        if (!entry) return {};
        if (entry.$ && typeof entry.$ === "object") return entry.$;
        if (typeof entry === "object") return entry;
        return {};
      };
      const transcriptScore = (type: string): number => {
        const t = type.toLowerCase();
        if (t.includes("json")) return 3;
        if (t.includes("vtt")) return 2;
        if (t.includes("srt") || t.includes("subrip")) return 1;
        return 0; // html/unknown — unusable for in-app rendering
      };
      const pickTranscript = (raw: any): { url: string; type: string } | null => {
        const entries = (Array.isArray(raw) ? raw : raw ? [raw] : [])
          .map(transcriptAttrs)
          .filter((a) => typeof a.url === "string" && /^https?:\/\//i.test(a.url));
        if (entries.length === 0) return null;
        let best: { url: string; type: string } | null = null;
        let bestScore = -1;
        for (const e of entries) {
          const type = typeof e.type === "string" ? e.type : "";
          const score = transcriptScore(type);
          if (score > bestScore) {
            best = { url: e.url as string, type };
            bestScore = score;
          }
        }
        return bestScore > 0 ? best : null;
      };

      const items = (feed.items || []).slice(0, 50).map((item: any) => {
        const hasAudio = isAudioEnclosure(item.enclosure);
        const itemImage = extractItunesImage(item.itunesImage);
        const transcript = hasAudio ? pickTranscript(item.podcastTranscripts) : null;
        const chaptersAttrs = hasAudio ? transcriptAttrs(item.podcastChapters) : {};
        const chaptersUrl = typeof chaptersAttrs.url === "string" && /^https?:\/\//i.test(chaptersAttrs.url)
          ? chaptersAttrs.url
          : "";
        return {
          title: item.title || "",
          link: item.link || "",
          description: (item.itunesSummary || item.contentSnippet || item.content || "").slice(0, 500),
          fullContent: (item["content:encoded"] || item.content || "").slice(0, 50000),
          pubDate: item.pubDate || item.isoDate || "",
          author: item.creator || item.author || item["dc:creator"] || feedAuthor || "",
          categories: item.categories || [],
          thumbnail: itemImage || (hasAudio ? feedImage : "") || extractImageFromContent(item.content || item["content:encoded"] || "") || "",
          comments: item.comments || "",
          audioUrl: hasAudio ? item.enclosure.url : "",
          duration: parseItunesDuration(item.itunesDuration),
          episode: item.itunesEpisode || "",
          season: item.itunesSeason || "",
          transcriptUrl: transcript?.url || "",
          transcriptType: transcript?.type || "",
          chaptersUrl,
        };
      });

      const hasPodcast = items.some((i: any) => i.audioUrl);

      const result = {
        title: feed.title || "",
        description: feed.description || "",
        link: feed.link || "",
        image: feedImage,
        isPodcast: hasPodcast,
        items,
      };

      const cacheTtl = result.isPodcast ? RSS_PODCAST_TTL : RSS_NEWS_TTL;
      rssCache.set(feedUrl, result, cacheTtl);
      res.set('Cache-Control', `public, max-age=${Math.floor(cacheTtl / 1000)}`);
      res.json(result);
    } catch (err: any) {
      console.error("RSS fetch error:", err.message);
      res.status(502).json({ error: "Failed to fetch or parse RSS feed" });
    }
  });

  // ── Trending news front page (NEWS_TRENDING_PLAN.md) ────────────────────────
  // ONE cached job computes the universal trending front page: fan out the
  // shared news pool, cluster near-duplicate coverage across outlets, rank by
  // consensus × recency (server/news-corroboration.ts). Every client fetches
  // this one payload instead of fanning out ~30 feeds itself — the structural
  // speed win. Request-driven rebuild (same posture as podcast trends: the
  // deployment can sleep, so a background timer is unreliable), guarded by a
  // single in-flight promise so a burst of hits triggers one rebuild, not N.
  const NEWS_TRENDING_TTL_MS = 5 * 60 * 1000;
  const NEWS_TRENDING_TOP_N = 40;
  const newsTrendingCache = new TTLCache<any>(NEWS_TOPICS.length + 1, NEWS_TRENDING_TTL_MS);
  let newsTrendingBuiltAt = 0;
  let newsTrendingBuilding: Promise<void> | null = null;

  function parsePubMs(item: any): number {
    const raw = item?.pubDate || item?.isoDate || "";
    const ms = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(ms) ? ms : NaN;
  }

  // Fetch ONE pool feed's items for clustering. Reads the shared rssCache first
  // (a feed the client already fetched is reused, warming this job for free),
  // else parses fresh — but never WRITES rssCache, so /api/rss's richer podcast
  // shape can't be clobbered by this news-only projection.
  async function fetchPoolFeed(src: { url: string; source: string; topic: string }): Promise<NewsInput[]> {
    try {
      let items: any[] | undefined = rssCache.get(src.url)?.items;
      if (!items) {
        const feed = await Promise.race([
          rssParser.parseURL(src.url),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
        ]);
        items = (feed.items || []).slice(0, 30).map((i: any) => ({
          title: i.title || "",
          link: i.link || "",
          pubDate: i.pubDate || i.isoDate || "",
          description: (i.contentSnippet || i.content || "").slice(0, 500),
          thumbnail: extractImageFromContent(i.content || i["content:encoded"] || "") || "",
          categories: i.categories || [],
        }));
      }
      return (items || [])
        .map((i: any): NewsInput => ({
          source: src.source,
          title: i.title || "",
          link: i.link || "",
          pubDateMs: parsePubMs(i),
          description: typeof i.description === "string" ? i.description : "",
          thumbnail: typeof i.thumbnail === "string" ? i.thumbnail : "",
          categories: Array.isArray(i.categories) ? i.categories : [],
        }))
        .filter((i) => i.title.trim().length > 0);
    } catch {
      return []; // a dead feed just contributes no corroboration
    }
  }

  function shapeCluster(c: NewsCluster) {
    return {
      title: c.lead.title,
      link: c.lead.link,
      source: c.lead.source,
      sources: c.sources,
      outletCount: c.outletCount,
      thumbnail: c.lead.thumbnail || "",
      description: c.lead.description || "",
      pubDate: new Date(c.lead.pubDateMs).toISOString(),
      // Every member link, so the client's Nostr-network re-rank can match a
      // shared URL to the story even when a friend linked a different outlet's
      // copy (decision 8).
      memberLinks: c.items.map((i) => i.link).filter(Boolean),
    };
  }

  async function buildNewsTrending(): Promise<void> {
    // Bounded fan-out: batches so we never open 30 sockets at once.
    const BATCH = 6;
    const bySource: NewsInput[] = [];
    for (let i = 0; i < NEWS_SOURCES.length; i += BATCH) {
      const slice = NEWS_SOURCES.slice(i, i + BATCH);
      const results = await Promise.all(slice.map((s) => fetchPoolFeed(s)));
      for (const r of results) bySource.push(...r);
    }
    // "Top" clusters the whole pool (a story can span News + Business outlets).
    newsTrendingCache.set("Top", clusterNews(bySource).slice(0, NEWS_TRENDING_TOP_N).map(shapeCluster));
    // Each topic clusters only that topic's outlets.
    const urlTopic = new Map(NEWS_SOURCES.map((s) => [s.source, s.topic]));
    for (const topic of NEWS_TOPICS) {
      const subset = bySource.filter((i) => urlTopic.get(i.source) === topic);
      newsTrendingCache.set(topic, clusterNews(subset).slice(0, NEWS_TRENDING_TOP_N).map(shapeCluster));
    }
    newsTrendingBuiltAt = Date.now();
  }

  function ensureNewsTrending(): Promise<void> {
    const fresh = Date.now() - newsTrendingBuiltAt < NEWS_TRENDING_TTL_MS;
    if (fresh && newsTrendingCache.get("Top")) return Promise.resolve();
    if (!newsTrendingBuilding) {
      newsTrendingBuilding = buildNewsTrending()
        .catch((e) => { console.error("news-trending build error:", e?.message); })
        .finally(() => { newsTrendingBuilding = null; });
    }
    return newsTrendingBuilding;
  }

  app.get("/api/news/trending", async (req, res) => {
    const topicParam = String(req.query.topic || "Top");
    const topic = (NEWS_TOPICS as readonly string[]).includes(topicParam) ? topicParam : "Top";
    try {
      // Serve stale-but-present immediately and rebuild in the background;
      // block only on the very first (cold) build.
      const cachedNow = newsTrendingCache.get(topic);
      const build = ensureNewsTrending();
      if (!cachedNow) await build;
      const stories = newsTrendingCache.get(topic) || [];
      res.set("Cache-Control", "public, max-age=120");
      res.json({ topic, builtAt: newsTrendingBuiltAt, stories });
    } catch (err: any) {
      console.error("news-trending error:", err?.message);
      res.status(502).json({ error: "Failed to build trending news" });
    }
  });

  // Proxy for podcast transcript + chapter files (`podcast:transcript` /
  // `podcast:chapters` URLs are cross-origin, so the client can't fetch them
  // directly). Same SSRF posture as /api/og: protocol + private-host checks,
  // DNS validation on every redirect hop, tight size cap, text/JSON only.
  const podcastFileCache = new TTLCache<{ content: string; contentType: string }>(60, 30 * 60 * 1000);
  const MAX_PODCAST_FILE_BYTES = 2 * 1024 * 1024;

  app.get("/api/podcast/transcript", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    const validateUrl = async (raw: string): Promise<URL | null> => {
      try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' ||
            host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.') ||
            host.endsWith('.local') || host.endsWith('.internal') ||
            host.startsWith('169.254.') || host.startsWith('fc00:') || host.startsWith('fd') ||
            host.startsWith('fe80:') || host === '[::1]' || /^\d+$/.test(host) ||
            /^0x/i.test(host)) {
          return null;
        }
        const isSafe = await validateHostSafety(host);
        return isSafe ? parsed : null;
      } catch {
        return null;
      }
    };

    const initial = await validateUrl(targetUrl);
    if (!initial) {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const cached = podcastFileCache.get(targetUrl);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=1800');
      return res.json(cached);
    }

    try {
      let currentUrl = initial;
      let response: globalThis.Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        const resp = await fetch(currentUrl.toString(), {
          headers: {
            'User-Agent': 'RelayOutpost/1.0',
            'Accept': 'text/vtt, application/json, application/srt, text/plain, */*',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        });
        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) return res.status(502).json({ error: "Bad redirect" });
          const next = await validateUrl(new URL(location, currentUrl).toString());
          if (!next) return res.status(400).json({ error: "Invalid redirect" });
          currentUrl = next;
          continue;
        }
        response = resp;
        break;
      }
      if (!response) return res.status(502).json({ error: "Too many redirects" });
      if (!response.ok) return res.status(502).json({ error: "Upstream error" });

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      // Transcript/chapter files are text or JSON — refuse media/binary types.
      if (/^(image|video|audio)\//.test(contentType)) {
        return res.status(415).json({ error: "Unsupported content type" });
      }
      const declaredLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (declaredLength > MAX_PODCAST_FILE_BYTES) {
        return res.status(413).json({ error: "File too large" });
      }

      let content = "";
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let received = 0;
        while (received < MAX_PODCAST_FILE_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          if (received > MAX_PODCAST_FILE_BYTES) {
            try { await reader.cancel(); } catch {}
            return res.status(413).json({ error: "File too large" });
          }
          content += decoder.decode(value, { stream: true });
        }
        content += decoder.decode();
        try { await reader.cancel(); } catch {}
      } else {
        content = await response.text();
        if (content.length > MAX_PODCAST_FILE_BYTES) {
          return res.status(413).json({ error: "File too large" });
        }
      }

      const result = { content, contentType };
      podcastFileCache.set(targetUrl, result);
      res.set('Cache-Control', 'public, max-age=1800');
      return res.json(result);
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || "Failed to fetch transcript" });
    }
  });

  const articleCache = new TTLCache<any>(100, 10 * 60 * 1000);

  app.get("/api/rss/article", async (req, res) => {
    const articleUrl = req.query.url as string;
    if (!articleUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
      const parsed = new URL(articleUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Invalid protocol" });
      }
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' ||
          host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.') ||
          host.endsWith('.local') || host.endsWith('.internal')) {
        return res.status(400).json({ error: "Invalid URL" });
      }
      const isSafe = await validateHostSafety(host);
      if (!isSafe) {
        return res.status(400).json({ error: "Invalid URL" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const cached = articleCache.get(articleUrl);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=600');
      return res.json(cached);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const articleOrigin = new URL(articleUrl).origin;
      const response = await fetch(articleUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html, application/xhtml+xml, */*',
          'Referer': articleOrigin + '/',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return res.status(502).json({ error: "Failed to fetch article" });
      }

      const MAX_BODY = 2 * 1024 * 1024;
      const rawBody = await response.arrayBuffer();
      const html = new TextDecoder().decode(rawBody.slice(0, MAX_BODY));

      await loadDomModules();
      if (!JSDOM || !Readability) {
        return res.status(503).json({ error: "Article extraction not available" });
      }
      const dom = new JSDOM(html, { url: articleUrl });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article) {
        return res.json({ title: "", content: "", textContent: "", excerpt: "", siteName: "", byline: "" });
      }

      let articleContent = article.content || "";
      articleContent = articleContent.replace(
        /(<img[^>]+src=)(["'])([^"']+)\2/gi,
        (_match, prefix, quote, url) => {
          if (url.startsWith('data:') || url.startsWith('/api/')) return _match;
          return `${prefix}${quote}/api/rss/image-proxy?url=${encodeURIComponent(url)}${quote}`;
        }
      );

      const result = {
        title: article.title || "",
        content: articleContent,
        textContent: (article.textContent || "").slice(0, 50000),
        excerpt: article.excerpt || "",
        siteName: article.siteName || "",
        byline: article.byline || "",
      };

      articleCache.set(articleUrl, result);
      res.set('Cache-Control', 'public, max-age=600');
      res.json(result);
    } catch (err: any) {
      console.error("Article fetch error:", err.message);
      res.status(502).json({ error: "Failed to fetch or parse article" });
    }
  });

  app.get("/api/rss/image-proxy", async (req, res) => {
    const imageUrl = req.query.url as string;
    if (!imageUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
      const parsed = new URL(imageUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Invalid protocol" });
      }
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' ||
          host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.') ||
          host.endsWith('.local') || host.endsWith('.internal')) {
        return res.status(400).json({ error: "Invalid URL" });
      }
      const isSafe = await validateHostSafety(host);
      if (!isSafe) {
        return res.status(400).json({ error: "Invalid URL" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      let currentUrl = imageUrl;
      let response: Response | null = null;
      for (let i = 0; i < 5; i++) {
        const curOrigin = new URL(currentUrl).origin;
        response = await fetch(currentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': curOrigin + '/',
          },
          signal: controller.signal,
          redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;
          const nextUrl = new URL(location, currentUrl).href;
          const nextHost = new URL(nextUrl).hostname.toLowerCase();
          const nextSafe = await validateHostSafety(nextHost);
          if (!nextSafe) {
            clearTimeout(timeout);
            return res.status(400).json({ error: "Redirect to unsafe host" });
          }
          currentUrl = nextUrl;
          continue;
        }
        break;
      }
      clearTimeout(timeout);

      if (!response || !response.ok || !response.body) {
        return res.status(502).json({ error: "Failed to fetch image" });
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/') && !contentType.includes('svg')) {
        return res.status(400).json({ error: "Not an image" });
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        return res.status(413).json({ error: "Image too large" });
      }

      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('Access-Control-Allow-Origin', '*');

      const { Readable } = await import("stream");
      const nodeStream = Readable.fromWeb(response.body as any);
      let bytesRead = 0;
      const MAX_BYTES = 5 * 1024 * 1024;
      nodeStream.on('data', (chunk: Buffer) => {
        bytesRead += chunk.length;
        if (bytesRead > MAX_BYTES) {
          nodeStream.destroy();
          if (!res.headersSent) res.status(413).json({ error: "Image too large" });
        }
      });
      nodeStream.pipe(res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(502).json({ error: "Failed to fetch image" });
      }
    }
  });

  const hnCommentCache = new TTLCache<any>(100, 5 * 60 * 1000);

  app.get("/api/rss/hn-comments", async (req, res) => {
    const storyUrl = req.query.url as string;
    if (!storyUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    const hnItemIdMatch = storyUrl.match(/news\.ycombinator\.com\/item\?id=(\d+)/);
    let hnItemId: string | null = hnItemIdMatch ? hnItemIdMatch[1] : null;

    if (!hnItemId) {
      try {
        const searchRes = await fetch(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(storyUrl)}&tags=story&hitsPerPage=1`
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.hits && searchData.hits.length > 0) {
            hnItemId = searchData.hits[0].objectID;
          }
        }
      } catch {}
    }

    if (!hnItemId) {
      return res.json({ comments: [], storyId: null, hnUrl: null });
    }

    const cached = hnCommentCache.get(hnItemId);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(cached);
    }

    try {
      const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${hnItemId}.json`);
      if (!storyRes.ok) {
        return res.json({ comments: [], storyId: hnItemId, hnUrl: `https://news.ycombinator.com/item?id=${hnItemId}` });
      }
      const story = await storyRes.json();
      const kidIds = (story.kids || []).slice(0, 30);

      const comments = await Promise.all(
        kidIds.map(async (id: number) => {
          try {
            const cRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            if (!cRes.ok) return null;
            const c = await cRes.json();
            if (!c || c.deleted || c.dead) return null;

            const childIds = (c.kids || []).slice(0, 5);
            const replies = await Promise.all(
              childIds.map(async (rid: number) => {
                try {
                  const rRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${rid}.json`);
                  if (!rRes.ok) return null;
                  const r = await rRes.json();
                  if (!r || r.deleted || r.dead) return null;
                  return {
                    id: r.id,
                    by: r.by || "anon",
                    text: r.text || "",
                    time: r.time || 0,
                    replyCount: (r.kids || []).length,
                  };
                } catch { return null; }
              })
            );

            return {
              id: c.id,
              by: c.by || "anon",
              text: c.text || "",
              time: c.time || 0,
              replyCount: (c.kids || []).length,
              replies: replies.filter(Boolean),
            };
          } catch { return null; }
        })
      );

      const result = {
        comments: comments.filter(Boolean),
        storyId: hnItemId,
        hnUrl: `https://news.ycombinator.com/item?id=${hnItemId}`,
        title: story.title || "",
        points: story.score || 0,
        commentCount: story.descendants || 0,
      };

      hnCommentCache.set(hnItemId, result);
      res.set('Cache-Control', 'public, max-age=300');
      res.json(result);
    } catch (err: any) {
      console.error("HN comments error:", err.message);
      res.status(502).json({ error: "Failed to fetch HN comments" });
    }
  });

  const ttsAudioCache = new TTLCache<Buffer>(200, 30 * 60 * 1000);

  app.get("/api/tts/voices", async (_req, res) => {
    try {
      const { listVoices } = await import("edge-tts-universal");
      const voices = await listVoices();
      const filtered = voices
        .filter((v: any) => v.Locale?.startsWith("en"))
        .map((v: any) => ({
          shortName: v.ShortName,
          name: v.FriendlyName || v.ShortName,
          gender: v.Gender,
          locale: v.Locale,
        }));
      res.json(filtered);
    } catch (err: any) {
      console.error("TTS voices error:", err.message);
      res.status(500).json({ error: "Failed to fetch voices" });
    }
  });

  const ttsDailyByIp = new Map<string, { count: number; resetAt: number }>();
  const TTS_DAILY_CAP = 200;
  const TTS_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of Array.from(ttsDailyByIp.entries())) {
      if (entry.resetAt <= now) ttsDailyByIp.delete(ip);
    }
  }, 60 * 60 * 1000).unref?.();

  app.post("/api/tts", async (req, res) => {
    const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
    let reserved = false;
    const refund = () => {
      if (!reserved) return;
      const counter = ttsDailyByIp.get(ip);
      if (counter && counter.resetAt > Date.now() && counter.count > 0) {
        counter.count -= 1;
      }
      reserved = false;
    };
    try {
      const { text, voice } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing text" });
      }
      const trimmedText = text.slice(0, 5000);
      const selectedVoice = voice || "en-US-AndrewNeural";

      // Cache hit short-circuits BEFORE reserving so cached replays are free.
      const cacheKey = `${selectedVoice}:${trimmedText}`;
      const cached = ttsAudioCache.get(cacheKey);
      if (cached) {
        res.set("Content-Type", "audio/mpeg");
        res.set("Content-Length", String(cached.length));
        res.set("Cache-Control", "public, max-age=1800");
        return res.send(cached);
      }

      const now = Date.now();
      let entry = ttsDailyByIp.get(ip);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + TTS_DAY_MS };
        ttsDailyByIp.set(ip, entry);
      }
      if (entry.count >= TTS_DAILY_CAP) {
        const minutes = Math.ceil((entry.resetAt - now) / 60000);
        return res.status(429).json({
          error: `Daily TTS quota reached. Resets in ~${minutes} minute(s).`,
        });
      }
      // Reserve a slot before any expensive work so concurrent requests at the
      // cap boundary cannot all pass the pre-check and overshoot.
      entry.count += 1;
      reserved = true;

      const { EdgeTTS } = await import("node-edge-tts");
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");

      let audioBuffer: Buffer | null = null;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
        try {
          const tts = new EdgeTTS({ voice: selectedVoice, lang: "en-US" });
          await tts.ttsPromise(trimmedText, tmpFile);
          audioBuffer = await fs.promises.readFile(tmpFile);
          try { await fs.promises.unlink(tmpFile); } catch (_e) {}
          break;
        } catch (e: any) {
          lastErr = e;
          try { await fs.promises.unlink(tmpFile); } catch (_e) {}
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }

      if (!audioBuffer) {
        console.error("TTS synthesis failed after 3 attempts:", lastErr?.message || lastErr);
        refund();
        return res.status(500).json({ error: "Text-to-speech synthesis failed" });
      }

      ttsAudioCache.set(cacheKey, audioBuffer);

      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Length", String(audioBuffer.length));
      res.set("Cache-Control", "public, max-age=1800");
      res.send(audioBuffer);
    } catch (err: any) {
      console.error("TTS synthesis error:", err?.message || err);
      refund();
      res.status(500).json({ error: "Text-to-speech synthesis failed" });
    }
  });

  const betaAttempts = new Map<string, { count: number; lastAttempt: number }>();
  setInterval(() => {
    const now = Date.now();
    const keys = Array.from(betaAttempts.keys());
    for (const ip of keys) {
      const data = betaAttempts.get(ip);
      if (data && now - data.lastAttempt > 15 * 60 * 1000) betaAttempts.delete(ip);
    }
  }, 5 * 60 * 1000);

  app.post("/api/beta/verify", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempts = betaAttempts.get(ip);

    if (attempts && attempts.count >= 5 && now - attempts.lastAttempt < 15 * 60 * 1000) {
      return res.status(429).json({ valid: false, error: "Too many attempts. Try again later." });
    }

    const { code } = req.body || {};
    const betaCode = process.env.BETA_ACCESS_CODE;
    if (!betaCode) {
      return res.json({ valid: true });
    }
    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ valid: false, error: "Access code required" });
    }
    if (code.trim().toLowerCase() === betaCode.trim().toLowerCase()) {
      betaAttempts.delete(ip);
      return res.json({ valid: true });
    }
    const current = betaAttempts.get(ip) || { count: 0, lastAttempt: now };
    current.count += 1;
    current.lastAttempt = now;
    betaAttempts.set(ip, current);
    const remaining = 5 - current.count;
    return res.status(403).json({
      valid: false,
      error: remaining > 0
        ? `Invalid access code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
        : "Too many attempts. Try again later.",
    });
  });

  const STREAM_PROXY_BLOCKED_DOMAINS = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "metadata.google.internal",
    "169.254.169.254",
  ];

  function isAllowedStreamDomain(hostname: string): boolean {
    if (STREAM_PROXY_BLOCKED_DOMAINS.some(d => hostname === d || hostname.includes(d))) return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return false;
    return true;
  }

  function rewriteHlsUri(rawUri: string, baseUrl: string): string {
    let absolute: string;
    if (rawUri.startsWith("http://") || rawUri.startsWith("https://")) {
      absolute = rawUri;
    } else {
      try { absolute = new URL(rawUri, baseUrl).href; } catch { return rawUri; }
    }
    return `/api/stream/proxy?url=${encodeURIComponent(absolute)}`;
  }

  function rewriteM3u8(text: string, baseUrl: string): string {
    return text.split("\n").map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
          return `URI="${rewriteHlsUri(uri, baseUrl)}"`;
        });
      }

      return rewriteHlsUri(trimmed, baseUrl);
    }).join("\n");
  }

  app.get("/api/stream/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
      if (parsed.protocol !== "https:") {
        return res.status(400).json({ error: "Only HTTPS URLs are allowed" });
      }
      if (!isAllowedStreamDomain(parsed.hostname)) {
        return res.status(403).json({ error: "Domain not allowed for stream proxy" });
      }
      const isSafe = await validateHostSafety(parsed.hostname);
      if (!isSafe) {
        return res.status(403).json({ error: "Domain failed safety check" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    try {
      const upstream = await fetch(targetUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; NostrClient/1.0)",
        },
      });

      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location = upstream.headers.get("location");
        if (!location) {
          return res.status(502).json({ error: "Redirect with no location" });
        }
        try {
          const redirected = new URL(location, targetUrl);
          if (redirected.protocol !== "https:") {
            return res.status(403).json({ error: "Redirect to non-HTTPS not allowed" });
          }
          if (!isAllowedStreamDomain(redirected.hostname)) {
            return res.status(403).json({ error: "Redirect domain not allowed" });
          }
          const redirectSafe = await validateHostSafety(redirected.hostname);
          if (!redirectSafe) {
            return res.status(403).json({ error: "Redirect domain failed safety check" });
          }
          return res.redirect(302, `/api/stream/proxy?url=${encodeURIComponent(redirected.href)}`);
        } catch {
          return res.status(502).json({ error: "Invalid redirect URL" });
        }
      }

      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
      }

      const isM3u8 = targetUrl.includes(".m3u8") || (upstream.headers.get("content-type") || "").includes("mpegurl");

      if (isM3u8) {
        // M3U8 playlists are small text files. Cap the read so a hostile host
        // can't stream gigabytes through upstream.text() (which buffers fully).
        const MAX_M3U8_BYTES = 2 * 1024 * 1024; // 2MB
        const declaredLen = parseInt(upstream.headers.get("content-length") || "", 10);
        if (Number.isFinite(declaredLen) && declaredLen > MAX_M3U8_BYTES) {
          return res.status(413).json({ error: "Playlist too large" });
        }
        let text: string;
        const reader = upstream.body?.getReader();
        if (reader) {
          const chunks: Buffer[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              received += value.length;
              if (received > MAX_M3U8_BYTES) {
                try { await reader.cancel(); } catch {}
                return res.status(413).json({ error: "Playlist too large" });
              }
              chunks.push(Buffer.from(value));
            }
          }
          text = Buffer.concat(chunks).toString("utf-8");
        } else {
          text = await upstream.text();
        }
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
        const rewritten = rewriteM3u8(text, baseUrl);

        res.set("Content-Type", "application/vnd.apple.mpegurl");
        res.set("Cache-Control", "no-cache");
        res.set("Access-Control-Allow-Origin", "*");
        return res.send(rewritten);
      }

      // Cap bytes per request so this proxy can't be abused as an open media CDN
      // (egress bill). HLS .ts segments are far under this; whole-file piping is blocked.
      const MAX_PROXY_BYTES = 50 * 1024 * 1024; // 50MB
      const declaredBytes = parseInt(upstream.headers.get("content-length") || "", 10);
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PROXY_BYTES) {
        return res.status(413).json({ error: "Upstream response too large" });
      }

      const ct = upstream.headers.get("content-type");
      if (ct) res.set("Content-Type", ct);
      res.set("Cache-Control", "public, max-age=5");
      res.set("Access-Control-Allow-Origin", "*");

      if (!upstream.body) {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        if (buffer.length > MAX_PROXY_BYTES) {
          return res.status(413).json({ error: "Upstream response too large" });
        }
        return res.send(buffer);
      }

      const { Readable } = await import("stream");
      const nodeStream = Readable.fromWeb(upstream.body as any);
      let streamedBytes = 0;
      nodeStream.on("data", (chunk: Buffer) => {
        streamedBytes += chunk.length;
        if (streamedBytes > MAX_PROXY_BYTES) {
          nodeStream.destroy();
          res.end();
        }
      });
      nodeStream.pipe(res);
      nodeStream.on("error", () => { if (!res.headersSent) res.status(502).end(); });
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        return res.status(504).json({ error: "Upstream timeout" });
      }
      console.error("Stream proxy error:", err.message);
      return res.status(502).json({ error: "Failed to proxy stream" });
    }
  });

  const streamHealthCache = new TTLCache<{ alive: boolean | null; checkedAt: number }>(100, 5 * 60 * 1000);

  app.get("/api/stream/health-check", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Invalid protocol" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    if (!isAllowedStreamDomain(parsed.hostname)) {
      return res.json({ alive: null, checkedAt: Date.now() });
    }

    const isSafe = await validateHostSafety(parsed.hostname);
    if (!isSafe) {
      return res.json({ alive: null, checkedAt: Date.now() });
    }

    const cached = streamHealthCache.get(targetUrl);
    if (cached) {
      return res.json(cached);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const upstream = await fetch(targetUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; NostrClient/1.0)",
        },
      });

      const alive = upstream.ok || (upstream.status >= 300 && upstream.status < 400);
      const result = { alive, checkedAt: Date.now() };
      streamHealthCache.set(targetUrl, result);
      return res.json(result);
    } catch {
      const result = { alive: false, checkedAt: Date.now() };
      streamHealthCache.set(targetUrl, result);
      return res.json(result);
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post("/api/stream/health-check-batch", async (req, res) => {
    const urls: string[] = req.body?.urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Missing urls array" });
    }

    const limitedUrls = urls.slice(0, 20);
    const results: Record<string, { alive: boolean | null; checkedAt: number }> = {};

    await Promise.all(limitedUrls.map(async (url) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          results[url] = { alive: null, checkedAt: Date.now() };
          return;
        }
      } catch {
        results[url] = { alive: null, checkedAt: Date.now() };
        return;
      }

      if (!isAllowedStreamDomain(parsed.hostname)) {
        results[url] = { alive: null, checkedAt: Date.now() };
        return;
      }

      const isSafe = await validateHostSafety(parsed.hostname);
      if (!isSafe) {
        results[url] = { alive: null, checkedAt: Date.now() };
        return;
      }

      const cached = streamHealthCache.get(url);
      if (cached) {
        results[url] = cached;
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const upstream = await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
          redirect: "manual",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; NostrClient/1.0)" },
        });
        const alive = upstream.ok || (upstream.status >= 300 && upstream.status < 400);
        const result = { alive, checkedAt: Date.now() };
        streamHealthCache.set(url, result);
        results[url] = result;
      } catch {
        const result = { alive: false as const, checkedAt: Date.now() };
        streamHealthCache.set(url, result);
        results[url] = result;
      } finally {
        clearTimeout(timeout);
      }
    }));

    return res.json({ results });
  });

  const NIP86_ALLOWED_METHODS = new Set([
    "allowpubkey", "banpubkey", "unallowpubkey", "unbanpubkey",
    "listallowedpubkeys", "listbannedpubkeys",
    "allowevent", "banevent", "listbannedevents",
    "changerelayname", "changerelaydescription", "changerelayicon",
    "allowkind", "disallowkind", "listallowedkinds", "listdisallowedkinds",
    "blockip", "unblockip", "listblockedips",
  ]);

  app.post("/api/nip86", async (req, res) => {
    try {
      const { relayUrl, method, params, authEvent } = req.body;
      if (!relayUrl || typeof relayUrl !== "string") {
        return res.status(400).json({ error: "Missing relayUrl" });
      }
      if (!method || typeof method !== "string" || !NIP86_ALLOWED_METHODS.has(method)) {
        return res.status(400).json({ error: "Invalid or unsupported NIP-86 method" });
      }

      const httpUrl = relayUrl
        .replace(/^wss:\/\//, "https://")
        .replace(/^ws:\/\//, "http://");
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(httpUrl);
      } catch {
        return res.status(400).json({ error: "Invalid relay URL" });
      }

      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return res.status(400).json({ error: "Relay URL must use http(s) or ws(s) protocol" });
      }

      // Dev only: a local test relay (ws://localhost:PORT) is a legitimate
      // management target. Production keeps the full SSRF guard.
      const devLocalRelay = process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(parsedUrl.hostname.toLowerCase());
      const isSafe = devLocalRelay || await validateHostSafety(parsedUrl.hostname);
      if (!isSafe) {
        return res.status(403).json({ error: "Relay hostname failed safety check" });
      }

      const normalizedUrl = parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, "");
      const body = JSON.stringify({ method, params: params || [] });

      const headers: Record<string, string> = {
        "Content-Type": "application/nostr+json+rpc",
        "Accept": "application/nostr+json+rpc, application/json",
      };

      if (authEvent) {
        headers["Authorization"] = "Nostr " + Buffer.from(JSON.stringify(authEvent)).toString("base64");
      }

      const urlsToTry = [normalizedUrl];
      const base = parsedUrl.origin;
      if (normalizedUrl === base || normalizedUrl === base + "/") {
        urlsToTry.push(base + "/api", base + "/rpc");
      }

      let lastResponseText = "";
      let lastStatus = 0;
      let lastContentType = "";

      for (const tryUrl of urlsToTry) {
        const tryHeaders = { ...headers };
        if (authEvent) {
          tryHeaders["Authorization"] = "Nostr " + Buffer.from(JSON.stringify(authEvent)).toString("base64");
        }

        console.log(`[NIP-86 proxy] → POST ${tryUrl} | method=${method} | hasAuth=${!!authEvent}`);
        try {
          const response = await fetch(tryUrl, {
            method: "POST",
            headers: tryHeaders,
            body,
            signal: AbortSignal.timeout(10000),
          });

          const responseText = await response.text();
          // Don't log the response body — relay-admin responses can carry
          // sensitive management data. Status + content-type are enough to debug.
          console.log(`[NIP-86 proxy] ← status=${response.status} | content-type=${response.headers.get("content-type")} | len=${responseText.length}`);
          lastResponseText = responseText;
          lastStatus = response.status;
          lastContentType = response.headers.get("content-type") || "";

          if (response.status === 401 || response.status === 403) {
            try {
              const data = JSON.parse(responseText);
              return res.status(response.status).json(data);
            } catch {}
            return res.status(response.status).json({ error: `HTTP ${response.status}` });
          }

          if (!response.ok) {
            try {
              const errData = JSON.parse(responseText);
              if (errData.error) return res.status(response.status).json(errData);
            } catch {}
            continue;
          }

          try {
            const data = JSON.parse(responseText);
            if (data && typeof data === "object" && ("result" in data || "error" in data)) {
              return res.status(response.status).json(data);
            }
          } catch {}

          const trimmed = responseText.trim().toLowerCase();
          const isHtml = trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<head") || trimmed.startsWith("<body");
          if (isHtml) {
            console.log(`[NIP-86 proxy] ${tryUrl} returned HTML, trying next URL...`);
            continue;
          }
        } catch (fetchErr) {
          console.log(`[NIP-86 proxy] ${tryUrl} failed: ${fetchErr instanceof Error ? fetchErr.message : "unknown"}`);
          continue;
        }
      }

      const trimmed = lastResponseText.trim().toLowerCase();
      const isHtml = trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<head") || trimmed.startsWith("<body");

      // Report WHY we ended up here, not just that we did.
      //
      // Every branch above funnels into this one response, so a relay that
      // 502'd behind its reverse proxy (HTML error page) was indistinguishable
      // from a relay happily serving its landing page — and the client read
      // both as "this relay doesn't support NIP-86". `upstreamStatus` is 0 when
      // no request ever completed (DNS, refused, timeout) and 5xx when the
      // relay's own server failed; neither is an answer about NIP-86 support.
      return res.status(200).json({
        error: isHtml
          ? "Relay returned an HTML page instead of JSON-RPC — NIP-86 HTTP handler may not be configured"
          : "Relay returned non-JSON response",
        isHtml,
        upstreamStatus: lastStatus,
        raw: lastResponseText.slice(0, 500),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown proxy error";
      return res.status(502).json({ error: `NIP-86 proxy error: ${message}` });
    }
  });

  const BRAINSTORM_SEARCH_API = "https://brainstorm.world";

  const profilePrefetchCache = new Map<string, { data: string; ts: number }>();
  const PROFILE_PREFETCH_TTL = 5 * 60 * 1000;

  app.get("/api/brainstorm/profile/:pubkey", async (req, res) => {
    try {
      const pk = req.params.pubkey;
      if (!pk || !/^[0-9a-f]{64}$/i.test(pk)) {
        return res.status(400).json({ hit: null, error: "Invalid pubkey" });
      }

      const cached = profilePrefetchCache.get(pk);
      if (cached && Date.now() - cached.ts < PROFILE_PREFETCH_TTL) {
        return res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=120" }).end(cached.data);
      }

      const upstream = await fetch(
        `${BRAINSTORM_SEARCH_API}/api/search/profiles/meili/document/${pk}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const raw = await upstream.json() as { success?: boolean; document?: Record<string, unknown> };
      const hit = (raw.success && raw.document?.pubkey === pk) ? raw.document : null;
      const data = JSON.stringify({ hit });

      if (hit) {
        profilePrefetchCache.set(pk, { data, ts: Date.now() });
        if (profilePrefetchCache.size > 200) {
          let oldestKey: string | null = null;
          let oldestTs = Infinity;
          for (const [k, v] of profilePrefetchCache) {
            if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
          }
          if (oldestKey) profilePrefetchCache.delete(oldestKey);
        }
      }

      res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=120" }).end(data);
    } catch (err: any) {
      console.error("[brainstorm-profile-prefetch] error:", err?.message || err);
      res.status(502).json({ hit: null, error: "Profile prefetch unavailable" });
    }
  });

  app.get("/api/brainstorm/search", async (req, res) => {
    try {
      const q = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 20;
      if (!q || !q.trim()) return res.json({ hits: [], estimatedTotalHits: 0 });
      const upstream = await fetch(
        `${BRAINSTORM_SEARCH_API}/api/search/profiles/meili?q=${encodeURIComponent(q.trim())}&limit=${limit}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.text();
      res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }).end(data);
    } catch (err: any) {
      console.error("[brainstorm-search] error:", err?.message || err);
      res.status(502).json({ hits: [], error: "Brainstorm search unavailable" });
    }
  });

  const discoverCache = new Map<string, { data: string; ts: number }>();
  const DISCOVER_TTL = 5 * 60 * 1000;

  app.get("/api/brainstorm/discover", async (req, res) => {
    try {
      const topic = (req.query.topic as string || "").trim().toLowerCase();
      if (!topic) return res.json({ hits: [], estimatedTotalHits: 0 });
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);

      const cacheKey = `${topic}:${limit}`;
      const cached = discoverCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < DISCOVER_TTL) {
        return res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }).end(cached.data);
      }

      const upstream = await fetch(
        `${BRAINSTORM_SEARCH_API}/api/search/profiles/meili?q=${encodeURIComponent(topic)}&limit=${limit}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const rawData = await upstream.json() as any;
      if (rawData.hits && Array.isArray(rawData.hits)) {
        rawData.hits.sort((a: any, b: any) => (b.wot_rank ?? 0) - (a.wot_rank ?? 0));
      }
      const data = JSON.stringify(rawData);

      discoverCache.set(cacheKey, { data, ts: Date.now() });
      if (discoverCache.size > 100) {
        let oldestKey: string | null = null;
        let oldestTs = Infinity;
        for (const [k, v] of discoverCache) {
          if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
        }
        if (oldestKey) discoverCache.delete(oldestKey);
      }

      res.set({ "Content-Type": "application/json", "Cache-Control": "public, max-age=60" }).end(data);
    } catch (err: any) {
      console.error("[brainstorm-discover] error:", err?.message || err);
      res.status(502).json({ hits: [], error: "Brainstorm discover unavailable" });
    }
  });

  const wotBatchRateLimit = new Map<string, number[]>();
  const WOT_BATCH_RATE_WINDOW = 60_000;
  const WOT_BATCH_RATE_MAX = 30; // our own proxy; the client now sends a few chunked calls/thread

  // score >= 0 is a real wot_rank/100; score < 0 is a cached "miss" (Meili has no
  // data) — cached briefly so we don't re-hammer unknown accounts. The client
  // treats a miss as non-terminal: it renders nothing (neutral) and resolves the
  // pubkey through the per-observer GrapeRank path instead.
  const wotScoreCache = new Map<string, { score: number; ts: number }>();
  const WOT_SCORE_TTL = 30 * 60 * 1000; // wot_rank changes slowly — keep popular accounts warm
  const WOT_MISS_TTL = 5 * 60 * 1000;   // re-check unknown accounts sooner (may get indexed)

  app.post("/api/brainstorm/wot-batch", async (req, res) => {
    try {
      const clientIp = req.ip || "unknown";
      const now = Date.now();
      const timestamps = (wotBatchRateLimit.get(clientIp) || []).filter(t => t > now - WOT_BATCH_RATE_WINDOW);
      if (timestamps.length >= WOT_BATCH_RATE_MAX) {
        return res.status(429).json({ scores: {}, error: "Rate limit exceeded" });
      }
      timestamps.push(now);
      wotBatchRateLimit.set(clientIp, timestamps);

      const { pubkeys } = req.body;
      if (!Array.isArray(pubkeys) || pubkeys.length === 0) {
        return res.json({ scores: {} });
      }
      const batch = pubkeys.slice(0, 80).filter((pk: string) => typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk));
      if (batch.length === 0) return res.json({ scores: {} });
      const scores: Record<string, number> = {};

      const toFetch: string[] = [];
      for (const pk of batch) {
        const cached = wotScoreCache.get(pk);
        const ttl = cached && cached.score < 0 ? WOT_MISS_TTL : WOT_SCORE_TTL;
        if (cached && now - cached.ts < ttl) {
          scores[pk] = cached.score;
        } else {
          toFetch.push(pk);
        }
      }

      if (toFetch.length > 0) {
        const CONCURRENT = 30;
        for (let i = 0; i < toFetch.length; i += CONCURRENT) {
          const chunk = toFetch.slice(i, i + CONCURRENT);
          await Promise.allSettled(
            chunk.map(async (pk: string) => {
              try {
                const upstream = await fetch(
                  `${BRAINSTORM_SEARCH_API}/api/search/profiles/meili/document/${pk}`,
                  { signal: AbortSignal.timeout(3000) }
                );
                if (upstream.ok) {
                  const data = await upstream.json() as { success?: boolean; document?: { pubkey?: string; wot_rank?: number } };
                  if (data.success && data.document?.pubkey === pk && data.document.wot_rank !== undefined) {
                    const score = data.document.wot_rank / 100;
                    scores[pk] = score;
                    wotScoreCache.set(pk, { score, ts: Date.now() });
                    return;
                  }
                }
              } catch { /* fall through to miss */ }
              // No data for this pubkey — cache + return a miss so the client marks
              // it "No data" now rather than re-querying it on the slow lazy path.
              scores[pk] = -1;
              wotScoreCache.set(pk, { score: -1, ts: Date.now() });
            })
          );
        }
      }

      if (wotScoreCache.size > 1500) {
        let oldestKey: string | null = null;
        let oldestTs = Infinity;
        for (const [k, v] of wotScoreCache) {
          if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
        }
        if (oldestKey) wotScoreCache.delete(oldestKey);
      }

      res.set("Cache-Control", "public, max-age=120").json({ scores });
    } catch (err: any) {
      console.error("[brainstorm-wot-batch] error:", err?.message || err);
      res.status(502).json({ scores: {}, error: "Batch WoT lookup failed" });
    }
  });

  app.post("/api/brainstorm/profiles-bulk", async (req, res) => {
    try {
      const { pubkeys } = req.body;
      if (!Array.isArray(pubkeys) || pubkeys.length === 0) {
        return res.json({ profiles: [] });
      }
      const batch = pubkeys.slice(0, 50).filter((pk: string) => typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk));
      if (batch.length === 0) return res.json({ profiles: [] });

      const profiles: Record<string, unknown>[] = [];
      const CONCURRENT = 15;
      for (let i = 0; i < batch.length; i += CONCURRENT) {
        const chunk = batch.slice(i, i + CONCURRENT);
        const results = await Promise.allSettled(
          chunk.map(async (pk: string) => {
            const cached = profilePrefetchCache.get(pk);
            if (cached && Date.now() - cached.ts < PROFILE_PREFETCH_TTL) {
              const parsed = JSON.parse(cached.data);
              return parsed.hit || null;
            }
            const upstream = await fetch(
              `${BRAINSTORM_SEARCH_API}/api/search/profiles/meili/document/${pk}`,
              { signal: AbortSignal.timeout(3000) }
            );
            if (!upstream.ok) return null;
            const data = await upstream.json() as { success?: boolean; document?: Record<string, unknown> };
            if (data.success && data.document?.pubkey === pk) {
              const hitData = JSON.stringify({ hit: data.document });
              profilePrefetchCache.set(pk, { data: hitData, ts: Date.now() });
              if (data.document.wot_rank !== undefined) {
                wotScoreCache.set(pk, { score: (data.document.wot_rank as number) / 100, ts: Date.now() });
              }
              return data.document;
            }
            return null;
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) profiles.push(r.value);
        }
      }

      res.set("Cache-Control", "public, max-age=120").json({ profiles });
    } catch (err: any) {
      console.error("[brainstorm-profiles-bulk] error:", err?.message || err);
      res.status(502).json({ profiles: [], error: "Bulk profile lookup failed" });
    }
  });

  const NOSTR_ARCHIVES_API = "https://api.nostrarchives.com";
  const archivesCache = new TTLCache<any>(200, 5 * 60 * 1000);

  const archivesRateLimit = new Map<string, number[]>();
  function checkArchivesRate(ip: string, maxPerMinute = 30): boolean {
    const now = Date.now();
    const window = 60_000;
    let hits = archivesRateLimit.get(ip) || [];
    hits = hits.filter(t => now - t < window);
    if (hits.length >= maxPerMinute) return false;
    hits.push(now);
    archivesRateLimit.set(ip, hits);
    if (archivesRateLimit.size > 5000) {
      const keys = archivesRateLimit.keys();
      for (let i = 0; i < 1000; i++) archivesRateLimit.delete(keys.next().value!);
    }
    return true;
  }

  app.get("/api/archives/stats", async (_req, res) => {
    try {
      const cached = archivesCache.get("stats");
      if (cached) return res.set("Cache-Control", "public, max-age=300").json(cached);
      const upstream = await fetch(`${NOSTR_ARCHIVES_API}/v1/stats`, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      archivesCache.set("stats", data);
      res.set("Cache-Control", "public, max-age=300").json(data);
    } catch (err: any) {
      console.error("[archives] stats error:", err?.message);
      res.status(502).json({ error: "Archives stats unavailable" });
    }
  });

  app.get("/api/archives/stats/daily", async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      const cacheKey = `stats_daily_${days}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.set("Cache-Control", "public, max-age=300").json(cached);
      const upstream = await fetch(`${NOSTR_ARCHIVES_API}/v1/stats/daily?days=${days}`, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      archivesCache.set(cacheKey, data);
      res.set("Cache-Control", "public, max-age=300").json(data);
    } catch (err: any) {
      console.error("[archives] daily stats error:", err?.message);
      res.status(502).json({ error: "Archives daily stats unavailable" });
    }
  });

  app.get("/api/archives/search/suggest", async (req, res) => {
    try {
      if (!checkArchivesRate(req.ip || "unknown", 60)) return res.status(429).json({ error: "Rate limit exceeded" });
      const q = (req.query.q as string || "").slice(0, 200).trim();
      if (!q) return res.json({ suggestions: [] });
      const cacheKey = `suggest_${q.toLowerCase()}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.json(cached);
      const upstream = await fetch(
        `${NOSTR_ARCHIVES_API}/v1/search/suggest?q=${encodeURIComponent(q.trim())}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      archivesCache.set(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      console.error("[archives] suggest error:", err?.message);
      res.json({ suggestions: [] });
    }
  });

  app.get("/api/archives/events", async (req, res) => {
    try {
      if (!checkArchivesRate(req.ip || "unknown")) return res.status(429).json({ error: "Rate limit exceeded" });
      const params = new URLSearchParams();
      const q = (req.query.q as string || "").slice(0, 500);
      if (q) params.set("q", q);
      const kind = (req.query.kind as string || "").slice(0, 10);
      if (kind && /^\d+$/.test(kind)) params.set("kind", kind);
      const author = (req.query.author as string || "").slice(0, 128);
      if (author && /^[0-9a-f]+$/i.test(author)) params.set("author", author);
      const allowedSorts = ["created_at", "reactions", "zaps", "replies", "relevance", "recent", "most_reacted", "most_zapped", "most_replied"];
      const sort = req.query.sort as string;
      if (sort && allowedSorts.includes(sort)) params.set("sort", sort);
      const since = parseInt(req.query.since as string);
      if (!isNaN(since) && since > 0 && since < 2000000000) params.set("since", String(since));
      const until = parseInt(req.query.until as string);
      if (!isNaN(until) && until > 0 && until < 2000000000) params.set("until", String(until));
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 30, 1), 100);
      params.set("limit", String(limit));
      const offset = Math.min(Math.max(parseInt(req.query.offset as string) || 0, 0), 10000);
      if (offset > 0) params.set("offset", String(offset));
      const cacheKey = `events_${params.toString()}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.set("Cache-Control", "public, max-age=60").json(cached);
      const upstream = await fetch(
        `${NOSTR_ARCHIVES_API}/v1/events?${params.toString()}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      const nowSec = Math.floor(Date.now() / 1000);
      if (data.events && Array.isArray(data.events)) {
        data.events = data.events.filter((e: any) => !e.created_at || e.created_at <= nowSec);
        if (data.count !== undefined) data.count = data.events.length;
      }
      archivesCache.set(cacheKey, data);
      res.set("Cache-Control", "public, max-age=60").json(data);
    } catch (err: any) {
      console.error("[archives] events error:", err?.message);
      res.status(502).json({ events: [], error: "Archives event search unavailable" });
    }
  });

  app.get("/api/archives/notes/top", async (req, res) => {
    try {
      if (!checkArchivesRate(req.ip || "unknown")) return res.status(429).json({ error: "Rate limit exceeded" });
      const params = new URLSearchParams();
      const allowedMetrics = ["reactions", "zaps", "replies", "reposts"];
      const metric = req.query.metric as string;
      if (metric && allowedMetrics.includes(metric)) params.set("metric", metric);
      else params.set("metric", "reactions");
      const allowedRanges = ["today", "7d", "30d", "1y", "all"];
      const range = req.query.range as string;
      if (range && allowedRanges.includes(range)) params.set("range", range);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      params.set("limit", String(limit));
      const cacheKey = `notes_top_${params.toString()}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.set("Cache-Control", "public, max-age=120").json(cached);
      const upstream = await fetch(
        `${NOSTR_ARCHIVES_API}/v1/notes/top?${params.toString()}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      const nowSec = Math.floor(Date.now() / 1000);
      if (data.notes && Array.isArray(data.notes)) {
        data.notes = data.notes.filter((n: any) => !n.event?.created_at || n.event.created_at <= nowSec);
      }
      archivesCache.set(cacheKey, data);
      res.set("Cache-Control", "public, max-age=120").json(data);
    } catch (err: any) {
      console.error("[archives] notes/top error:", err?.message);
      res.status(502).json({ notes: [], error: "Archives trending notes unavailable" });
    }
  });

  app.get("/api/archives/events/:eventId", async (req, res) => {
    try {
      const eventId = req.params.eventId;
      if (!eventId || !/^[0-9a-f]{64}$/i.test(eventId)) {
        return res.status(400).json({ error: "Invalid event ID" });
      }
      const cacheKey = `event_${eventId}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.set("Cache-Control", "public, max-age=300").json(cached);
      const upstream = await fetch(`${NOSTR_ARCHIVES_API}/v1/events/${eventId}`, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      archivesCache.set(cacheKey, data);
      res.set("Cache-Control", "public, max-age=300").json(data);
    } catch (err: any) {
      console.error("[archives] event lookup error:", err?.message);
      res.status(502).json({ error: "Archives event lookup unavailable" });
    }
  });

  app.get("/api/archives/events/:eventId/thread", async (req, res) => {
    try {
      const eventId = req.params.eventId;
      if (!eventId || !/^[0-9a-f]{64}$/i.test(eventId)) {
        return res.status(400).json({ error: "Invalid event ID" });
      }
      const cacheKey = `thread_${eventId}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.set("Cache-Control", "public, max-age=120").json(cached);
      const upstream = await fetch(`${NOSTR_ARCHIVES_API}/v1/events/${eventId}/thread`, { signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      archivesCache.set(cacheKey, data);
      res.set("Cache-Control", "public, max-age=120").json(data);
    } catch (err: any) {
      console.error("[archives] thread error:", err?.message);
      res.status(502).json({ error: "Thread reconstruction unavailable" });
    }
  });

  app.get("/api/archives/social/:pubkey", async (req, res) => {
    try {
      const pk = req.params.pubkey;
      if (!pk || !/^[0-9a-f]{64}$/i.test(pk)) {
        return res.status(400).json({ error: "Invalid pubkey" });
      }
      const cacheKey = `social_${pk}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.set("Cache-Control", "public, max-age=300").json(cached);
      const upstream = await fetch(`${NOSTR_ARCHIVES_API}/v1/social/${pk}`, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      archivesCache.set(cacheKey, data);
      res.set("Cache-Control", "public, max-age=300").json(data);
    } catch (err: any) {
      console.error("[archives] social error:", err?.message);
      res.status(502).json({ error: "Social graph unavailable" });
    }
  });

  app.get("/api/archives/profiles/:pubkey/zap-stats", async (req, res) => {
    try {
      const pk = req.params.pubkey;
      if (!pk || !/^[0-9a-f]{64}$/i.test(pk)) {
        return res.status(400).json({ error: "Invalid pubkey" });
      }
      const cacheKey = `zap_stats_${pk}`;
      const cached = archivesCache.get(cacheKey);
      if (cached) return res.set("Cache-Control", "public, max-age=300").json(cached);
      const upstream = await fetch(`${NOSTR_ARCHIVES_API}/v1/profiles/${pk}/zap-stats`, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const data = await upstream.json();
      archivesCache.set(cacheKey, data);
      res.set("Cache-Control", "public, max-age=300").json(data);
    } catch (err: any) {
      console.error("[archives] zap-stats error:", err?.message);
      res.status(502).json({ error: "Zap stats unavailable" });
    }
  });

  const BRAINSTORM_API = "https://brainstormserver.nosfabrica.com";

  app.get("/api/graperank/authChallenge/:pubkey", async (req, res) => {
    try {
      const upstream = await fetch(`${BRAINSTORM_API}/authChallenge/${req.params.pubkey}`, { signal: AbortSignal.timeout(5000) });
      const data = await upstream.text();
      res.status(upstream.status).set({ "Content-Type": "application/json" }).end(data);
    } catch (err) {
      console.error("[graperank proxy] authChallenge error:", err);
      res.status(502).json({ error: "Upstream unavailable" });
    }
  });

  app.post("/api/graperank/authChallenge/:pubkey/verify", async (req, res) => {
    try {
      const upstream = await fetch(`${BRAINSTORM_API}/authChallenge/${req.params.pubkey}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(5000),
      });
      const data = await upstream.text();
      res.status(upstream.status).set({ "Content-Type": "application/json" }).end(data);
    } catch (err) {
      console.error("[graperank proxy] verify error:", err);
      res.status(502).json({ error: "Upstream unavailable" });
    }
  });

  app.get("/api/graperank/user/self", async (req, res) => {
    try {
      const headers: Record<string, string> = {};
      if (req.headers["access_token"]) headers["access_token"] = req.headers["access_token"] as string;
      const upstream = await fetch(`${BRAINSTORM_API}/user/self`, { headers, signal: AbortSignal.timeout(5000) });
      const data = await upstream.text();
      res.status(upstream.status).set({ "Content-Type": "application/json" }).end(data);
    } catch (err) {
      console.error("[graperank proxy] user/self error:", err);
      res.status(502).json({ error: "Upstream unavailable" });
    }
  });

  app.get("/api/graperank/user/:pubkey", async (req, res) => {
    try {
      const headers: Record<string, string> = {};
      if (req.headers["access_token"]) headers["access_token"] = req.headers["access_token"] as string;
      const upstream = await fetch(`${BRAINSTORM_API}/user/${req.params.pubkey}`, { headers, signal: AbortSignal.timeout(5000) });
      const data = await upstream.text();
      res.status(upstream.status).set({ "Content-Type": "application/json" }).end(data);
    } catch (err) {
      console.error("[graperank proxy] user error:", err);
      res.status(502).json({ error: "Upstream unavailable" });
    }
  });

  app.get("/api/graperank/setup/:pubkey", async (req, res) => {
    try {
      const upstream = await fetch(`${BRAINSTORM_API}/setup/${req.params.pubkey}`, { signal: AbortSignal.timeout(5000) });
      const data = await upstream.text();
      res.status(upstream.status).set({ "Content-Type": "application/json" }).end(data);
    } catch (err) {
      console.error("[graperank proxy] setup error:", err);
      res.status(502).json({ error: "Upstream unavailable" });
    }
  });

  // Trigger a GrapeRank calculation for the authenticated user (their own
  // pubkey, via the forwarded access_token). Lets users (re)calculate their web
  // of trust IN-APP instead of being bounced to brainstorm.nosfabrica.com. The
  // upstream rate-limits this per user (~30-min cooldown); the status is passed
  // through so the client can message it.
  app.post("/api/graperank/trigger", async (req, res) => {
    try {
      const headers: Record<string, string> = {};
      if (req.headers["access_token"]) headers["access_token"] = req.headers["access_token"] as string;
      const upstream = await fetch(`${BRAINSTORM_API}/user/graperank`, { method: "POST", headers, signal: AbortSignal.timeout(8000) });
      const data = await upstream.text();
      res.status(upstream.status).set({ "Content-Type": "application/json" }).end(data);
    } catch (err) {
      console.error("[graperank proxy] trigger error:", err);
      res.status(502).json({ error: "Upstream unavailable" });
    }
  });

  const gifCache = new TTLCache<any>(20, 5 * 60 * 1000);

  app.get("/api/gifs/search", async (req, res) => {
    const klipyKey = process.env.KLIPY_API_KEY;
    if (!klipyKey) {
      return res.status(503).json({ error: "GIF search not configured" });
    }
    const q = (req.query.q as string || "").trim();
    if (!q) {
      return res.status(400).json({ error: "Missing q parameter" });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const pos = req.query.pos as string || "";
    const cacheKey = `search:${q}:${limit}:${pos}`;
    const cached = gifCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const params = new URLSearchParams({
        key: klipyKey,
        q,
        limit: String(limit),
        media_filter: "tinygif,gif",
        contentfilter: "medium",
        client_key: "relay_outpost",
      });
      if (pos) params.set("pos", pos);

      const resp = await fetch(`https://api.klipy.com/v2/search?${params}`, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        return res.status(resp.status).json({ error: "GIF API error" });
      }
      const data = await resp.json();
      const result = {
        results: (data.results || []).map((r: any) => ({
          id: r.id,
          url: r.media_formats?.gif?.url || "",
          preview_url: r.media_formats?.tinygif?.url || "",
          dims: r.media_formats?.tinygif?.dims || [220, 220],
          description: r.content_description || "",
        })),
        next: data.next || "",
      };
      gifCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("GIF search error:", err.message);
      return res.status(502).json({ error: "Failed to search GIFs" });
    }
  });

  app.get("/api/gifs/trending", async (req, res) => {
    const klipyKey = process.env.KLIPY_API_KEY;
    if (!klipyKey) {
      return res.status(503).json({ error: "GIF search not configured" });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const pos = req.query.pos as string || "";
    const cacheKey = `trending:${limit}:${pos}`;
    const cached = gifCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const params = new URLSearchParams({
        key: klipyKey,
        limit: String(limit),
        media_filter: "tinygif,gif",
        contentfilter: "medium",
        client_key: "relay_outpost",
      });
      if (pos) params.set("pos", pos);

      const resp = await fetch(`https://api.klipy.com/v2/featured?${params}`, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        return res.status(resp.status).json({ error: "GIF API error" });
      }
      const data = await resp.json();
      const result = {
        results: (data.results || []).map((r: any) => ({
          id: r.id,
          url: r.media_formats?.gif?.url || "",
          preview_url: r.media_formats?.tinygif?.url || "",
          dims: r.media_formats?.tinygif?.dims || [220, 220],
          description: r.content_description || "",
        })),
        next: data.next || "",
      };
      gifCache.set(cacheKey, result);
      return res.json(result);
    } catch (err: any) {
      console.error("GIF trending error:", err.message);
      return res.status(502).json({ error: "Failed to fetch trending GIFs" });
    }
  });

  // --- Scheduled Posts API ---
  const scheduleRateLimits = new Map<string, { count: number; windowStart: number }>();
  const SCHEDULE_DAILY_LIMIT = 10;
  const SCHEDULE_MAX_PENDING = 50;
  const SCHEDULE_MAX_SIZE = 64 * 1024;
  const SCHEDULE_WINDOW_MS = 24 * 60 * 60 * 1000;

  function checkScheduleRateLimit(pubkey: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const entry = scheduleRateLimits.get(pubkey);
    if (entry && now - entry.windowStart < SCHEDULE_WINDOW_MS) {
      if (entry.count >= SCHEDULE_DAILY_LIMIT) {
        return { allowed: false, reason: `Daily limit of ${SCHEDULE_DAILY_LIMIT} scheduled posts reached. Try again tomorrow.` };
      }
    }
    return { allowed: true };
  }

  function incrementScheduleRate(pubkey: string) {
    const now = Date.now();
    const entry = scheduleRateLimits.get(pubkey);
    if (entry && now - entry.windowStart < SCHEDULE_WINDOW_MS) {
      entry.count++;
    } else {
      scheduleRateLimits.set(pubkey, { count: 1, windowStart: now });
    }
  }

  // NIP-98 (kind 27235) HTTP Auth. Every schedule endpoint authorizes on the
  // pubkey proven by a signed token in the Authorization header — never on a
  // client-supplied param — closing the IDOR over users' scheduled posts.
  // The verified pubkey is attached as req.authPubkey for handlers to use.
  const SCHEDULE_AUTH_MAX_AGE = 60; // seconds of created_at skew tolerated

  function verifyScheduleAuth(req: any): { pubkey: string } | { status: number; error: string } {
    const header: string | undefined = req.headers["authorization"];
    if (!header || !header.startsWith("Nostr ")) {
      return { status: 401, error: "Missing NIP-98 Authorization header" };
    }

    let event: any;
    try {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
      event = JSON.parse(decoded);
    } catch {
      return { status: 401, error: "Malformed Authorization token" };
    }

    if (!event || event.kind !== 27235 || typeof event.pubkey !== "string") {
      return { status: 401, error: "Invalid auth event" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof event.created_at !== "number" || Math.abs(now - event.created_at) > SCHEDULE_AUTH_MAX_AGE) {
      return { status: 401, error: "Auth token expired" };
    }

    const tags: string[][] = Array.isArray(event.tags) ? event.tags : [];
    const uTag = tags.find((t) => t[0] === "u")?.[1];
    const methodTag = tags.find((t) => t[0] === "method")?.[1];
    if (!uTag || !methodTag) {
      return { status: 401, error: "Auth token missing u/method tag" };
    }
    if (methodTag.toUpperCase() !== String(req.method).toUpperCase()) {
      return { status: 401, error: "Auth method mismatch" };
    }

    // Bind the token to this endpoint by path; compare pathname only so the
    // proxy host and query string don't cause spurious mismatches.
    let tokenPath: string;
    try {
      tokenPath = new URL(uTag).pathname;
    } catch {
      return { status: 401, error: "Invalid u tag" };
    }
    if (tokenPath !== req.path) {
      return { status: 401, error: "Auth URL mismatch" };
    }

    let valid = false;
    try {
      valid = verifyEvent(event);
    } catch {
      valid = false;
    }
    if (!valid) {
      return { status: 401, error: "Invalid auth signature" };
    }

    return { pubkey: event.pubkey };
  }

  function requireScheduleAuth(req: any, res: any, next: any) {
    const result = verifyScheduleAuth(req);
    if ("error" in result) {
      return res.status(result.status).json({ error: result.error });
    }
    req.authPubkey = result.pubkey;
    next();
  }

  app.post("/api/schedule", requireScheduleAuth, async (req, res) => {
    try {
      const { encryptedEvent, relayUrls, scheduledAt, kind, contentPreview } = req.body;
      const pubkey = (req as any).authPubkey as string;

      if (!pubkey || !encryptedEvent || !relayUrls || !scheduledAt || kind === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (typeof encryptedEvent !== "string" || encryptedEvent.length > SCHEDULE_MAX_SIZE) {
        return res.status(400).json({ error: "Event payload too large (max 64KB)" });
      }
      if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
        return res.status(400).json({ error: "At least one relay URL is required" });
      }

      const validRelayUrlPattern = /^wss?:\/\/[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/;
      const blockedHostPatterns = /^wss?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.0\.0\.0|\[::1\])/i;
      for (const url of relayUrls) {
        if (typeof url !== "string" || !validRelayUrlPattern.test(url) || blockedHostPatterns.test(url)) {
          return res.status(400).json({ error: `Invalid relay URL: ${url}` });
        }
      }
      if (relayUrls.length > 20) {
        return res.status(400).json({ error: "Too many relay URLs (max 20)" });
      }

      try {
        const parsed = JSON.parse(encryptedEvent);
        if (!parsed) {
          return res.status(400).json({ error: "Invalid event payload" });
        }
        const isGiftWrap = parsed.kind === 1059;
        if (!isGiftWrap && parsed.pubkey !== pubkey) {
          return res.status(403).json({ error: "Event pubkey does not match requester" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid event payload" });
      }

      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Scheduled time must be in the future" });
      }

      const rateCheck = checkScheduleRateLimit(pubkey);
      if (!rateCheck.allowed) {
        return res.status(429).json({ error: rateCheck.reason });
      }

      const { count } = await db
        .select({ count: sql`count(*)::int` })
        .from(scheduledPosts)
        .where(and(eq(scheduledPosts.pubkey, pubkey), eq(scheduledPosts.status, "pending")))
        .then((rows) => rows[0] || { count: 0 });

      if ((count as number) >= SCHEDULE_MAX_PENDING) {
        return res.status(429).json({ error: `Maximum of ${SCHEDULE_MAX_PENDING} pending scheduled posts reached.` });
      }

      const [post] = await db
        .insert(scheduledPosts)
        .values({
          pubkey,
          encryptedEvent,
          relayUrls,
          scheduledAt: scheduledDate,
          status: "pending",
          kind: typeof kind === "number" ? kind : parseInt(kind, 10),
          contentPreview: (contentPreview || "").slice(0, 80),
        })
        .returning();

      incrementScheduleRate(pubkey);
      return res.status(201).json(post);
    } catch (err: any) {
      console.error("[Schedule] Create error:", err.message);
      return res.status(500).json({ error: "Failed to create scheduled post" });
    }
  });

  app.get("/api/schedule", requireScheduleAuth, async (req, res) => {
    try {
      const pubkey = (req as any).authPubkey as string;

      const posts = await db
        .select()
        .from(scheduledPosts)
        .where(eq(scheduledPosts.pubkey, pubkey))
        .orderBy(scheduledPosts.scheduledAt);

      return res.json(posts);
    } catch (err: any) {
      console.error("[Schedule] List error:", err.message);
      return res.status(500).json({ error: "Failed to fetch scheduled posts" });
    }
  });

  app.delete("/api/schedule/:id", requireScheduleAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const pubkey = (req as any).authPubkey as string;
      if (isNaN(id)) {
        return res.status(400).json({ error: "Valid id is required" });
      }

      const [post] = await db
        .select()
        .from(scheduledPosts)
        .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.pubkey, pubkey)));

      if (!post) {
        return res.status(404).json({ error: "Scheduled post not found" });
      }

      if (post.status === "publishing") {
        return res.status(409).json({ error: "Cannot cancel a post that is currently being published" });
      }

      await db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[Schedule] Delete error:", err.message);
      return res.status(500).json({ error: "Failed to cancel scheduled post" });
    }
  });

  app.post("/api/schedule/:id/retry", requireScheduleAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const pubkey = (req as any).authPubkey as string;
      if (isNaN(id)) {
        return res.status(400).json({ error: "Valid id is required" });
      }

      const [post] = await db
        .select()
        .from(scheduledPosts)
        .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.pubkey, pubkey)));

      if (!post) {
        return res.status(404).json({ error: "Scheduled post not found" });
      }

      if (post.status !== "failed") {
        return res.status(409).json({ error: "Can only retry failed posts" });
      }

      const [updated] = await db
        .update(scheduledPosts)
        .set({ status: "pending", failureReason: null, scheduledAt: new Date() })
        .where(eq(scheduledPosts.id, id))
        .returning();

      return res.json(updated);
    } catch (err: any) {
      console.error("[Schedule] Retry error:", err.message);
      return res.status(500).json({ error: "Failed to retry post" });
    }
  });

  app.put("/api/schedule/:id", requireScheduleAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { scheduledAt, encryptedEvent, contentPreview, relayUrls, kind } = req.body;
      const pubkey = (req as any).authPubkey as string;
      if (isNaN(id) || !scheduledAt) {
        return res.status(400).json({ error: "Valid id and scheduledAt are required" });
      }

      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Scheduled time must be in the future" });
      }

      const [post] = await db
        .select()
        .from(scheduledPosts)
        .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.pubkey, pubkey)));

      if (!post) {
        return res.status(404).json({ error: "Scheduled post not found" });
      }

      if (post.status !== "pending" && post.status !== "failed") {
        return res.status(409).json({ error: "Can only edit pending or failed posts" });
      }

      const updates: Record<string, any> = { scheduledAt: scheduledDate, status: "pending", failureReason: null };

      if (encryptedEvent) {
        if (typeof encryptedEvent !== "string" || encryptedEvent.length > SCHEDULE_MAX_SIZE) {
          return res.status(400).json({ error: "Event payload too large (max 64KB)" });
        }
        try {
          const parsed = JSON.parse(encryptedEvent);
          // Gift wraps (kind 1059) are signed by an ephemeral pubkey, not the
          // user's — exempt them from the pubkey match, exactly as POST does.
          const isGiftWrap = parsed?.kind === 1059;
          if (!parsed || (!isGiftWrap && parsed.pubkey !== pubkey)) {
            return res.status(403).json({ error: "Event pubkey does not match requester" });
          }
        } catch {
          return res.status(400).json({ error: "Invalid event payload" });
        }
        updates.encryptedEvent = encryptedEvent;
      }

      if (contentPreview !== undefined) updates.contentPreview = (contentPreview || "").slice(0, 80);

      if (relayUrls) {
        if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
          return res.status(400).json({ error: "At least one relay URL is required" });
        }
        if (relayUrls.length > 20) {
          return res.status(400).json({ error: "Too many relay URLs (max 20)" });
        }
        const validRelayUrlPattern = /^wss?:\/\/[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/;
        const blockedHostPatterns = /^wss?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.0\.0\.0|\[::1\])/i;
        for (const url of relayUrls) {
          if (typeof url !== "string" || !validRelayUrlPattern.test(url) || blockedHostPatterns.test(url)) {
            return res.status(400).json({ error: `Invalid relay URL: ${url}` });
          }
        }
        updates.relayUrls = relayUrls;
      }

      if (kind !== undefined) updates.kind = typeof kind === "number" ? kind : parseInt(kind, 10);

      const [updated] = await db
        .update(scheduledPosts)
        .set(updates)
        .where(eq(scheduledPosts.id, id))
        .returning();

      return res.json(updated);
    } catch (err: any) {
      console.error("[Schedule] Update error:", err.message);
      return res.status(500).json({ error: "Failed to update post" });
    }
  });

  app.get("/sitemap.xml", (_req, res) => {
    const baseUrl = "https://relayop.xyz";
    const routes = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/search", priority: "0.8", changefreq: "daily" },
      { loc: "/outposts", priority: "0.8", changefreq: "weekly" },
      { loc: "/articles", priority: "0.7", changefreq: "daily" },
      { loc: "/live", priority: "0.7", changefreq: "daily" },
      { loc: "/images", priority: "0.6", changefreq: "daily" },
      { loc: "/videos", priority: "0.6", changefreq: "daily" },
      { loc: "/audio", priority: "0.6", changefreq: "daily" },
    ];
    const today = new Date().toISOString().split("T")[0];
    const urls = routes.map(r => `  <url>\n    <loc>${baseUrl}${r.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(xml);
  });

  const CRAWLER_UA = /bot|crawler|spider|preview|embed|whatsapp|telegram|slack|discord|facebook|facebookexternalhit|twitterbot|linkedinbot|pinterest|google|bing|yandex|baidu|duckduckbot|applebot|ia_archiver|semrush|ahref|mj12bot|dotbot|petalbot|bytespider|imessagebot|iMessage/i;
  const OG_RELAYS = ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol", "wss://purplepag.es"];
  // `cardPath` = server-rendered OG card endpoint (og-cards.ts); it's stored as
  // a path and resolved against the request host at render time so cards work
  // on every domain the app is served from.
  const ogMetaCache = new TTLCache<{ title: string; description: string; image: string; type: string; imageAlt?: string; cardPath?: string }>(200, 10 * 60 * 1000);

  function fetchNostrEvent(filter: Record<string, any>, timeoutMs = 4000, relays: string[] = OG_RELAYS): Promise<any | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result: any) => { if (!resolved) { resolved = true; resolve(result); } };
      const timeout = setTimeout(() => done(null), timeoutMs);
      let completed = 0;

      for (const relay of relays) {
        try {
          const ws = new WebSocket(relay);
          const subId = `og_${Date.now().toString(36)}`;
          let closed = false;
          const cleanup = () => { if (!closed) { closed = true; try { ws.close(); } catch {} } };

          ws.on("open", () => {
            ws.send(JSON.stringify(["REQ", subId, { ...filter, limit: 1 }]));
          });
          ws.on("message", (data: any) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg[0] === "EVENT" && msg[2]) {
                clearTimeout(timeout);
                done(msg[2]);
                cleanup();
              } else if (msg[0] === "EOSE") {
                completed++;
                cleanup();
                if (completed >= relays.length) done(null);
              }
            } catch {}
          });
          ws.on("error", () => { completed++; cleanup(); if (completed >= relays.length) done(null); });
          setTimeout(() => cleanup(), timeoutMs);
        } catch {
          completed++;
          if (completed >= relays.length) done(null);
        }
      }
    });
  }

  // escapeHtml / buildOgHtml / discuss-card composition live in discuss-og.ts
  // (imported at the top) so the injection-sensitive parts are unit-testable.

  registerOgCardRoutes(app, fetchNostrEvent);
  registerTranslateRoute(app);

  app.use((req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    if (!CRAWLER_UA.test(ua)) return next();

    const url = req.path;
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

    const threadMatch = url.match(/^\/thread\/([a-f0-9]{64})$/);
    const profileMatch = url.match(/^\/profile\/(npub1[a-z0-9]+)$/);
    const articleMatch = url.match(/^\/articles\/(naddr1[a-z0-9]+)$/);
    const channelMatch = url.match(/^\/outposts\/([^/?]+)$/);
    // NOTE: invite links carry their key material in the URL *fragment*, which
    // never reaches the server — req.originalUrl only ever contains the naddr.
    const inviteMatch = url.match(/^\/invite\/(naddr1[a-z0-9]+)$/i);
    const channelId = typeof req.query.channel === "string" ? req.query.channel : "";

    // ?discuss=<article-url> share links ("Discuss on Relay Outpost") — emitted
    // as /news?discuss=…, but the SPA redirects /news → /search?…&discuss=…,
    // so a copied address-bar link carries the param on /search too. A junk
    // param parses to null and falls through to the generic SPA card.
    const discussRaw = typeof req.query.discuss === "string" ? req.query.discuss : "";
    const discussTarget = (url === "/news" || url === "/search") && discussRaw ? parseDiscussParam(discussRaw) : null;

    if (!threadMatch && !profileMatch && !articleMatch && !inviteMatch && !(channelMatch && channelId) && !discussTarget) return next();

    // Branded og:image fallback, resolved against the request host so cards
    // work on every domain the app is served from.
    const brandedImageUrl = `${req.protocol}://${req.get("host")}/og-image.png`;

    // Dynamic OG cards are cached by path and resolved against the request
    // host at render time (the app serves from more than one domain).
    const resolveCardImage = <M extends { image: string; cardPath?: string }>(meta: M) =>
      meta.cardPath
        ? { ...meta, image: `${req.protocol}://${req.get("host")}${meta.cardPath}`, imageWidth: 1200, imageHeight: 630 }
        : meta;

    // Channel cards key on relay+channel; the query param isn't in `url` (path
    // only). Discuss cards key on the normalized article URL (host-agnostic —
    // /news and /search share one entry).
    const cacheKey = channelMatch && channelId
      ? `${url}?channel=${channelId}`
      : discussTarget
        ? `/news?discuss=${discussTarget}`
        : url;
    const cached = ogMetaCache.get(cacheKey);
    if (cached) {
      return res.status(200).set({ "Content-Type": "text/html" }).end(
        buildOgHtml({ ...resolveCardImage(cached), url: fullUrl }, brandedImageUrl)
      );
    }

    (async () => {
      try {
        if (inviteMatch) {
          // Nothing about a Concord invite is publicly decryptable (the bundle
          // key rides in the never-sent-to-us URL fragment), so the meta is the
          // same branded framing for every invite — no relay fetch, no logging.
          const meta = {
            title: "You're invited to a private community | Relay Outpost",
            description: "Open this invite to join a private, end-to-end encrypted community on Relay Outpost. Your invite key stays in the link and never touches our servers.",
            image: "",
            type: "website",
            imageAlt: "You're invited to a private community on Relay Outpost",
            cardPath: `/api/og-card/invite/${inviteMatch[1]}`,
          };
          ogMetaCache.set(cacheKey, meta);
          return res.status(200).set({ "Content-Type": "text/html" }).end(buildOgHtml({ ...resolveCardImage(meta), url: fullUrl }, brandedImageUrl));
        } else if (discussTarget) {
          // Serve the TARGET ARTICLE's card so a shared discuss link unfurls
          // as the article (title/description/image), not the generic homepage
          // card. Same SSRF guards + cache as /api/og; a short budget so the
          // crawler never waits long. Any failure → branded fallback card
          // (hostname title + discussion CTA + /og-image.png) — never a 500.
          if (!(await isSafeExternalOgUrl(discussTarget))) return next();
          const result = await fetchExternalOgData(discussTarget, 3000);
          const meta = buildDiscussMeta(result.ok ? result.data : null, discussTarget);
          // Only cache success — a transient fetch failure shouldn't pin the
          // fallback card for 10 minutes (the negative cache already keeps
          // retries cheap).
          if (result.ok) ogMetaCache.set(cacheKey, meta);
          return res.status(200).set({ "Content-Type": "text/html" }).end(buildOgHtml({ ...meta, url: fullUrl }, brandedImageUrl));
        } else if (threadMatch) {
          const eventId = threadMatch[1];
          const event = await fetchNostrEvent({ ids: [eventId] });
          if (event) {
            const textContent = (event.content || "").replace(/https?:\/\/\S+/g, "").replace(/nostr:\S+/g, "").trim();
            const desc = textContent.length > 150 ? textContent.slice(0, 150) + "..." : textContent;

            let authorName = "";
            const profile = await fetchNostrEvent({ kinds: [0], authors: [event.pubkey] });
            if (profile) {
              try {
                const meta = JSON.parse(profile.content);
                authorName = meta.display_name || meta.name || "";
              } catch {}
            }

            const meta = {
              title: authorName ? `Post by ${authorName} | Relay Outpost` : "Post | Relay Outpost",
              description: desc || "View this post on Relay Outpost.",
              // The branded share card (avatar + excerpt) beats a bare content
              // image in every unfurl surface — see og-cards.ts.
              image: "",
              type: "article",
              imageAlt: authorName ? `Post by ${authorName} on Relay Outpost` : "A post shared on Relay Outpost",
              cardPath: `/api/og-card/thread/${eventId}`,
            };
            ogMetaCache.set(cacheKey, meta);
            return res.status(200).set({ "Content-Type": "text/html" }).end(buildOgHtml({ ...resolveCardImage(meta), url: fullUrl }, brandedImageUrl));
          }
        } else if (profileMatch) {
          const npub = profileMatch[1];
          let pubkey: string;
          try {
            const decoded = nip19.decode(npub);
            pubkey = decoded.data as string;
          } catch {
            return next();
          }

          const profile = await fetchNostrEvent({ kinds: [0], authors: [pubkey] });
          if (profile) {
            try {
              const profileMeta = JSON.parse(profile.content);
              const name = profileMeta.display_name || profileMeta.name || npub.slice(0, 16) + "...";
              const bio = (profileMeta.about || "").slice(0, 150);

              const meta = {
                title: `${name} | Relay Outpost`,
                description: bio || `View ${name}'s profile on Relay Outpost.`,
                // Branded share card (big avatar + name + nip05 + bio) beats a
                // bare avatar image in every unfurl surface — see og-cards.ts.
                image: "",
                type: "profile",
                imageAlt: `${name} — profile card on Relay Outpost`,
                cardPath: `/api/og-card/profile/${npub}`,
              };
              ogMetaCache.set(cacheKey, meta);
              return res.status(200).set({ "Content-Type": "text/html" }).end(buildOgHtml({ ...resolveCardImage(meta), url: fullUrl }, brandedImageUrl));
            } catch {}
          }
        } else if (articleMatch) {
          const naddr = articleMatch[1];
          let decoded: any;
          try {
            decoded = nip19.decode(naddr);
          } catch {
            return next();
          }
          if (decoded.type !== "naddr") return next();
          const { pubkey, identifier, kind } = decoded.data;

          const event = await fetchNostrEvent({ kinds: [kind], authors: [pubkey], "#d": [identifier] });
          if (event) {
            const titleTag = event.tags?.find((t: string[]) => t[0] === "title");
            const summaryTag = event.tags?.find((t: string[]) => t[0] === "summary");
            const imageTag = event.tags?.find((t: string[]) => t[0] === "image");
            const title = titleTag?.[1] || "Article";
            const summary = summaryTag?.[1] || (event.content || "").replace(/[#*`>]/g, "").slice(0, 150);

            const meta = {
              title: `${title} | Relay Outpost`,
              description: (summary.length > 150 ? summary.slice(0, 150) + "..." : summary) || "Read this article on Relay Outpost.",
              image: imageTag?.[1] || "",
              type: "article",
              imageAlt: `${title} — article on Relay Outpost`,
            };
            ogMetaCache.set(cacheKey, meta);
            return res.status(200).set({ "Content-Type": "text/html" }).end(buildOgHtml({ ...meta, url: fullUrl }, brandedImageUrl));
          }
        } else if (channelMatch && channelId) {
          let relayUrl: string;
          try { relayUrl = decodeURIComponent(channelMatch[1]); } catch { return next(); }
          if (!/^wss?:\/\//i.test(relayUrl)) return next();
          // NIP-29 group metadata (kind 39000) lives on the outpost's OWN relay,
          // not the shared OG_RELAYS — so target that relay specifically.
          const event = await fetchNostrEvent({ kinds: [39000], "#d": [channelId] }, 4000, [relayUrl]);
          if (event) {
            const name = event.tags?.find((t: string[]) => t[0] === "name")?.[1] || "Chat channel";
            const about = (event.tags?.find((t: string[]) => t[0] === "about")?.[1] || "").slice(0, 150);
            const picture = event.tags?.find((t: string[]) => t[0] === "picture")?.[1] || "";
            const meta = {
              title: `${name} | Relay Outpost`,
              description: about || `Join the ${name} chat on Relay Outpost.`,
              image: picture,
              type: "article",
              imageAlt: `${name} — chat channel on Relay Outpost`,
            };
            ogMetaCache.set(cacheKey, meta);
            return res.status(200).set({ "Content-Type": "text/html" }).end(buildOgHtml({ ...meta, url: fullUrl }, brandedImageUrl));
          }
        }

        next();
      } catch (err) {
        console.error("OG meta injection error:", err);
        next();
      }
    })();
  });

  return httpServer;
}

function extractImageFromContent(html: string): string {
  const imgMatch = html.match(/<img[^>]+src="([^"]+)"/i);
  return imgMatch ? imgMatch[1] : "";
}
