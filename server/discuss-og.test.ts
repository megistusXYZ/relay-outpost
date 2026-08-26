import { describe, it, expect } from "vitest";
import {
  parseDiscussParam,
  buildDiscussMeta,
  buildOgHtml,
  escapeHtml,
  MAX_DISCUSS_PARAM_LENGTH,
} from "./discuss-og";

describe("parseDiscussParam (server-side ?discuss= validation)", () => {
  it("accepts plain http(s) URLs", () => {
    expect(parseDiscussParam("https://example.com/a")).toBe("https://example.com/a");
    expect(parseDiscussParam("http://example.com/a")).toBe("http://example.com/a");
  });

  it("accepts a still-percent-encoded value without double-decoding a clean URL", () => {
    expect(parseDiscussParam(encodeURIComponent("https://www.theverge.com/tech/some-article"))).toBe(
      "https://www.theverge.com/tech/some-article",
    );
    // A clean URL containing a literal %-escape must NOT be decoded again.
    expect(parseDiscussParam("https://example.com/a%20b")).toBe("https://example.com/a%20b");
  });

  it("keeps query strings (HN item links)", () => {
    expect(parseDiscussParam("https://news.ycombinator.com/item?id=123")).toBe(
      "https://news.ycombinator.com/item?id=123",
    );
  });

  it("rejects empty / null / whitespace", () => {
    expect(parseDiscussParam(null)).toBeNull();
    expect(parseDiscussParam(undefined)).toBeNull();
    expect(parseDiscussParam("")).toBeNull();
    expect(parseDiscussParam("   ")).toBeNull();
  });

  it("rejects non-URL junk", () => {
    expect(parseDiscussParam("not a url")).toBeNull();
    expect(parseDiscussParam("example.com/a")).toBeNull(); // no scheme
  });

  it("rejects hostile schemes, raw and encoded", () => {
    expect(parseDiscussParam("javascript:alert(1)")).toBeNull();
    expect(parseDiscussParam(encodeURIComponent("javascript:alert(document.cookie)"))).toBeNull();
    expect(parseDiscussParam("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(parseDiscussParam("file:///etc/passwd")).toBeNull();
    expect(parseDiscussParam("ftp://example.com/x")).toBeNull();
  });

  it("rejects malformed percent-encoding", () => {
    expect(parseDiscussParam("%E0%A4%A")).toBeNull();
  });

  it("caps length", () => {
    const long = "https://example.com/" + "a".repeat(MAX_DISCUSS_PARAM_LENGTH);
    expect(parseDiscussParam(long)).toBeNull();
    // A URL just inside the cap still parses.
    const okUrl = "https://example.com/" + "a".repeat(100);
    expect(parseDiscussParam(okUrl)).toBe(okUrl);
  });
});

describe("buildDiscussMeta (card composition + fallbacks)", () => {
  const articleUrl = "https://www.theverge.com/tech/some-article";

  it("uses the article's own title/description/image when present", () => {
    const meta = buildDiscussMeta(
      { title: "Big News", description: "Something happened.", image: "https://cdn.example.com/hero.jpg" },
      articleUrl,
    );
    expect(meta.title).toBe("Big News");
    expect(meta.description).toBe("Something happened.");
    expect(meta.image).toBe("https://cdn.example.com/hero.jpg");
    expect(meta.type).toBe("article");
  });

  it("falls back to the hostname (www-stripped) when the article has no title", () => {
    const meta = buildDiscussMeta({ description: "d" }, articleUrl);
    expect(meta.title).toBe("theverge.com");
  });

  it("falls back to the discussion CTA when the article has no description", () => {
    const meta = buildDiscussMeta({ title: "T" }, articleUrl);
    expect(meta.description).toBe("Join the discussion on Relay Outpost");
  });

  it("leaves image empty when the article has none (buildOgHtml swaps in the branded card)", () => {
    const meta = buildDiscussMeta({ title: "T" }, articleUrl);
    expect(meta.image).toBe("");
  });

  it("composes the full fallback card when the fetch failed entirely (null article)", () => {
    const meta = buildDiscussMeta(null, articleUrl);
    expect(meta.title).toBe("theverge.com");
    expect(meta.description).toBe("Join the discussion on Relay Outpost");
    expect(meta.image).toBe("");
  });

  it("truncates over-long descriptions to ~200 chars", () => {
    const meta = buildDiscussMeta({ description: "x".repeat(500) }, articleUrl);
    expect(meta.description.length).toBe(203);
    expect(meta.description.endsWith("...")).toBe(true);
  });
});

describe("buildOgHtml (escaping + branded image fallback)", () => {
  const branded = "http://localhost:5099/og-image.png";
  const base = {
    title: "A Title",
    description: "A description",
    image: "",
    url: "http://localhost:5099/news?discuss=https%3A%2F%2Fexample.com%2Fa",
  };

  it("escapes a malicious title — no tag breakout", () => {
    const html = buildOgHtml({ ...base, title: `"/><script>alert(1)</script>` }, branded);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;/&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes malicious description and image URL too", () => {
    const html = buildOgHtml(
      { ...base, description: `"><meta x="`, image: `https://x.example/a.jpg"><script>1</script>` },
      branded,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(`"><meta x="`);
  });

  it("uses the article image when present (no branded fallback)", () => {
    const html = buildOgHtml({ ...base, image: "https://cdn.example.com/hero.jpg" }, branded);
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/hero.jpg" />');
    expect(html).toContain('<meta name="twitter:image" content="https://cdn.example.com/hero.jpg" />');
    expect(html).not.toContain(branded);
  });

  it("falls back to the request-host branded card when there is no image", () => {
    const html = buildOgHtml(base, branded);
    expect(html).toContain(`<meta property="og:image" content="${branded}" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${branded}" />`);
    // The fallback is host-derived — never the old hardcoded deployment host.
    expect(html).not.toContain("relay-outpost.replit.app");
  });

  it("emits the core card tags", () => {
    const html = buildOgHtml(base, branded);
    expect(html).toContain('<meta property="og:title" content="A Title" />');
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('<meta property="og:site_name" content="Relay Outpost" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(
      '<meta property="og:url" content="http://localhost:5099/news?discuss=https%3A%2F%2Fexample.com%2Fa" />',
    );
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#039;");
  });
});
