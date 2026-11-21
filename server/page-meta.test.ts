/**
 * What a public page tells a search engine or a link preview about itself
 * (page-meta.ts): its own title, description and address, and a share image
 * given as a full address. Run against the app's real shell.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { PUBLIC_PAGES, SHARE_IMAGE, SITE_NAME, SITE_ORIGIN, applyPageMeta, publicPagePath, sitemapXml } from "./page-meta";

const SHELL = readFileSync(path.resolve(import.meta.dirname, "../client/index.html"), "utf8");
const tag = (html: string, re: RegExp) => { const m = html.match(re); return m ? m[1] : null; };
const titleOf = (html: string) => tag(html, /<title>([^<]*)<\/title>/);
const metaOf = (html: string, key: string) => tag(html, new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`));
const canonicalOf = (html: string) => tag(html, /<link rel="canonical" href="([^"]*)"/);
const unescape = (s: string | null) => (s ?? "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("each public page introduces itself", () => {
  for (const [route, meta] of Object.entries(PUBLIC_PAGES)) {
    it(`${route}: its own title, description and address`, () => {
      const html = applyPageMeta(SHELL, route)!;
      expect(html).not.toBeNull();
      expect(unescape(titleOf(html))).toBe(meta.title);
      expect(unescape(metaOf(html, "description"))).toBe(meta.description);
      expect(unescape(metaOf(html, "og:title"))).toBe(meta.title);
      expect(unescape(metaOf(html, "og:description"))).toBe(meta.description);
      expect(unescape(metaOf(html, "twitter:title"))).toBe(meta.title);
      expect(unescape(metaOf(html, "twitter:description"))).toBe(meta.description);
      const address = `${SITE_ORIGIN}${route}`;
      expect(canonicalOf(html)).toBe(address);
      expect(metaOf(html, "og:url")).toBe(address);
    });
  }

  it("no two pages share a title or a description", () => {
    const titles = Object.values(PUBLIC_PAGES).map((m) => m.title), descriptions = Object.values(PUBLIC_PAGES).map((m) => m.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("every title names the site and fits a search result; every description fits under it", () => {
    for (const [route, meta] of Object.entries(PUBLIC_PAGES)) {
      expect(meta.title, route).toContain(SITE_NAME);
      expect(meta.title.length, `${route} title`).toBeLessThanOrEqual(60);
      expect(meta.description.length, `${route} description`).toBeGreaterThanOrEqual(30);
      expect(meta.description.length, `${route} description`).toBeLessThanOrEqual(160);
    }
  });

  it("in the house's plain words: no dashes standing in for punctuation", () => {
    for (const [route, meta] of Object.entries(PUBLIC_PAGES)) expect(`${meta.title} ${meta.description}`, route).not.toMatch(/[—–]/);
  });
});

describe("the share image is a full address", () => {
  it("og:image and twitter:image point at the site, not at a path", () => {
    const html = applyPageMeta(SHELL, "/help")!;
    expect(metaOf(html, "og:image")).toBe(`${SITE_ORIGIN}${SHARE_IMAGE.path}`);
    expect(metaOf(html, "twitter:image")).toBe(`${SITE_ORIGIN}${SHARE_IMAGE.path}`);
  });

  it("the size it is described with is the size of the file", async () => {
    const sharp = (await import("sharp")).default;
    const { width, height } = await sharp(path.resolve(import.meta.dirname, "../client/public", `.${SHARE_IMAGE.path}`)).metadata();
    expect([width, height]).toEqual([SHARE_IMAGE.width, SHARE_IMAGE.height]);
    expect(metaOf(SHELL, "og:image:width")).toBe(String(SHARE_IMAGE.width));
    expect(metaOf(SHELL, "og:image:height")).toBe(String(SHARE_IMAGE.height));
  });
});

describe("only public pages, and only a shell it recognises", () => {
  it("a page a visitor cannot read is left alone", () => {
    for (const route of ["/settings", "/messages", "/live", "/images", "/profile/npub1abc", "/nope"]) {
      expect(publicPagePath(route), route).toBeNull();
      expect(applyPageMeta(SHELL, route), route).toBeNull();
    }
  });

  it("a trailing slash is the same page, with the address written one way", () => {
    expect(publicPagePath("/help/")).toBe("/help");
    expect(canonicalOf(applyPageMeta(SHELL, "/help/")!)).toBe(`${SITE_ORIGIN}/help`);
  });

  it("a name from the prototype is not a page", () => {
    for (const route of ["/constructor", "/__proto__", "/toString"]) expect(applyPageMeta(SHELL, route), route).toBeNull();
  });

  it("a shell that has lost one of its tags is served as it is, never half-described", () => {
    expect(applyPageMeta(SHELL.replace(/<meta name="twitter:title"[^>]*>/, ""), "/help")).toBeNull();
    expect(applyPageMeta("<html><head><title>x</title></head></html>", "/help")).toBeNull();
  });

  it("leaves everything outside those tags exactly as it was", () => {
    const html = applyPageMeta(SHELL, "/privacy")!;
    const strip = (h: string) => h
      .replace(/<title>[^<]*<\/title>/, "").replace(/<meta (?:name|property)="(?:description|og:title|og:description|og:image|og:type|og:url|twitter:title|twitter:description|twitter:image)" content="[^"]*"\s*\/?>/g, "")
      .replace(/<link rel="canonical"[^>]*>/, "").replace(/\s+/g, " ");
    expect(strip(html)).toBe(strip(SHELL));
  });
});

describe("the sitemap", () => {
  const xml = sitemapXml("2026-11-21");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it("lists every public page once, at the site's one address", () => {
    expect(locs).toEqual(Object.keys(PUBLIC_PAGES).map((p) => `${SITE_ORIGIN}${p}`));
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("lists no page that shows a visitor the landing in its place", () => {
    for (const gone of ["/live", "/images", "/videos", "/audio", "/search"]) expect(locs, gone).not.toContain(`${SITE_ORIGIN}${gone}`);
  });

  it("every address it lists is one the shell is rewritten for", () => {
    for (const loc of locs) expect(applyPageMeta(SHELL, loc.slice(SITE_ORIGIN.length) || "/"), loc).not.toBeNull();
  });
});

describe("the shell's own words agree with the table", () => {
  it("the home page's title and description are the ones in the shell", () => {
    expect(titleOf(SHELL)).toBe(PUBLIC_PAGES["/"].title);
    expect(metaOf(SHELL, "description")).toBe(PUBLIC_PAGES["/"].description);
    expect(metaOf(SHELL, "og:site_name")).toBe(SITE_NAME);
  });
});

describe("the app shows the title the crawler was served", () => {
  // Each public page sets its browser tab from the same table (shared/public-pages.ts). They used to
  // carry their own, in three different styles ("Help & guides — Relay Outpost", "Communities · Relay
  // Outpost"), so a search engine that runs the page saw one title served and another rendered.
  const PAGE_FILES: Record<string, string> = {
    "/help": "WtfIsThis", "/help/first-10-minutes": "FirstTenMinutes", "/help/setting-up-outpost": "SettingUpOutpost", "/help/connecting-wallet": "ConnectingWallet",
    "/help/content-calendar": "UsingContentCalendar", "/help/encrypted-messages": "EncryptedMessages", "/help/publishing-privacy": "PublishingPrivacy", "/help/managing-crew": "ManagingCrew",
    "/help/why-decentralization": "WhyDecentralization", "/help/wot-vs-algorithms": "WotVsAlgorithms", "/help/relay-communities": "RelayCommunities", "/help/data-sovereignty": "DataSovereignty",
    "/help/where-nostr-is-heading": "WhereNostrIsHeading", "/help/nostr-vs-alternatives": "NostrVsAlternatives", "/privacy": "Privacy", "/terms": "Covenant", "/child-safety": "ChildSafety",
    "/whats-new": "WhatsNew", "/outposts": "Outposts",
  };
  const source = (name: string) => readFileSync(path.resolve(import.meta.dirname, `../client/src/pages/${name}.tsx`), "utf8");

  for (const [route, file] of Object.entries(PAGE_FILES)) {
    it(`${route} (${file}) takes its tab title from the table`, () => {
      expect(Object.keys(PUBLIC_PAGES)).toContain(route);
      expect(source(file)).toContain(`useDocumentTitle(publicPageTitle("${route}"));`);
    });
  }

  it("the two that pass a bare name get the same title from the app's own rule", () => {
    // documentTitleFor adds " | Relay Outpost" to a bare name.
    expect(source("Discover")).toContain('useDocumentTitle("Discover");');
    expect(PUBLIC_PAGES["/discover"].title).toBe("Discover | Relay Outpost");
    expect(source("ArticlesFeed")).toContain('useDocumentTitle("Articles");');
    expect(PUBLIC_PAGES["/articles"].title).toBe("Articles | Relay Outpost");
  });

  it("every public page but the home page is accounted for", () => {
    expect([...Object.keys(PAGE_FILES), "/discover", "/articles", "/"].sort()).toEqual(Object.keys(PUBLIC_PAGES).sort());
  });
});
