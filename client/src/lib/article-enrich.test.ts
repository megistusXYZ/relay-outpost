// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { enrichArticleHtml, embedSrcFor, parseVideoUrl } from "./article-enrich";

// The reader wires this proxy in production (mirrors proxyRssImage in RSSFeed).
const proxy = (u: string) => `/api/rss/image-proxy?url=${encodeURIComponent(u)}`;

function parse(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body;
}

describe("enrichArticleHtml — linkify", () => {
  it("linkifies a bare mid-sentence URL into a safe anchor", () => {
    const out = enrichArticleHtml("<p>read https://example.com/post today</p>");
    const a = parse(out).querySelector("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("https://example.com/post");
    expect(a!.getAttribute("target")).toBe("_blank");
    expect(a!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a!.textContent).toBe("https://example.com/post");
    expect(parse(out).textContent).toContain("read ");
    expect(parse(out).textContent).toContain(" today");
  });

  it("trims trailing sentence punctuation from the link", () => {
    const out = enrichArticleHtml("<p>see https://example.com/a.</p>");
    const a = parse(out).querySelector("a");
    expect(a!.getAttribute("href")).toBe("https://example.com/a");
    expect(parse(out).textContent).toContain("a.");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const input = [
      "<p>read https://example.com/post today</p>",
      "<p>https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>",
      "<p>https://example.com/pic.jpg</p>",
    ].join("");
    const once = enrichArticleHtml(input, { imageProxy: proxy });
    const twice = enrichArticleHtml(once, { imageProxy: proxy });
    expect(twice).toBe(once);
  });

  it("leaves existing anchors, code and pre untouched", () => {
    const input =
      '<p><a href="https://example.com">https://example.com</a></p>' +
      "<code>https://example.com/in-code</code>" +
      "<pre>https://example.com/in-pre</pre>";
    const out = enrichArticleHtml(input);
    const body = parse(out);
    expect(body.querySelectorAll("a").length).toBe(1);
    expect(body.querySelector("code")!.innerHTML).toBe("https://example.com/in-code");
    expect(body.querySelector("pre")!.innerHTML).toBe("https://example.com/in-pre");
  });

  it("does not linkify non-http(s) schemes", () => {
    const out = enrichArticleHtml("<p>run javascript:alert(1) or ftp://x.com/f</p>");
    expect(parse(out).querySelector("a")).toBeNull();
  });
});

describe("enrichArticleHtml — YouTube/Vimeo facades", () => {
  it("turns a standalone youtube.com/watch URL into a click-to-play facade (no iframe)", () => {
    const out = enrichArticleHtml("<p>https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>", {
      imageProxy: proxy,
    });
    const body = parse(out);
    const facade = body.querySelector("[data-embed]")!;
    expect(facade).toBeTruthy();
    expect(facade.getAttribute("data-embed")).toBe("youtube");
    expect(facade.getAttribute("data-embed-id")).toBe("dQw4w9WgXcQ");
    expect(facade.getAttribute("role")).toBe("button");
    // Privacy: never an iframe until the user clicks.
    expect(body.querySelector("iframe")).toBeNull();
    // Thumbnail goes through the image proxy — no direct Google request either.
    const thumb = facade.querySelector("img")!;
    expect(thumb.getAttribute("src")).toBe(
      proxy("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"),
    );
  });

  it("supports youtu.be short links", () => {
    const out = enrichArticleHtml("<p>https://youtu.be/dQw4w9WgXcQ</p>");
    const facade = parse(out).querySelector("[data-embed]")!;
    expect(facade.getAttribute("data-embed")).toBe("youtube");
    expect(facade.getAttribute("data-embed-id")).toBe("dQw4w9WgXcQ");
  });

  it("supports vimeo numeric links with a generic dark facade (no thumbnail)", () => {
    const out = enrichArticleHtml("<p>https://vimeo.com/76979871</p>");
    const facade = parse(out).querySelector("[data-embed]")!;
    expect(facade.getAttribute("data-embed")).toBe("vimeo");
    expect(facade.getAttribute("data-embed-id")).toBe("76979871");
    expect(facade.querySelector("img")).toBeNull();
    expect(facade.querySelector("svg")).toBeTruthy();
  });

  it("upgrades a solo anchor in its own paragraph to a facade", () => {
    const out = enrichArticleHtml(
      '<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Watch this</a></p>',
    );
    const body = parse(out);
    expect(body.querySelector("[data-embed]")).toBeTruthy();
    expect(body.querySelector("a")).toBeNull();
  });

  it("keeps a mid-sentence video URL as a plain link (no block embed inside prose)", () => {
    const out = enrichArticleHtml(
      "<p>see https://www.youtube.com/watch?v=dQw4w9WgXcQ for details</p>",
    );
    const body = parse(out);
    expect(body.querySelector("[data-embed]")).toBeNull();
    expect(body.querySelector("a")!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("keeps an anchor that shares its paragraph with prose as an anchor", () => {
    const out = enrichArticleHtml(
      '<p>Watch <a href="https://vimeo.com/76979871">this film</a> tonight</p>',
    );
    const body = parse(out);
    expect(body.querySelector("[data-embed]")).toBeNull();
    expect(body.querySelector("a")).toBeTruthy();
  });

  it("embeds a URL on its own <br>-separated line", () => {
    const out = enrichArticleHtml(
      "<p>New episode:<br>https://youtu.be/dQw4w9WgXcQ<br>enjoy</p>",
    );
    expect(parse(out).querySelector("[data-embed]")).toBeTruthy();
  });

  it("rejects malformed video ids (no facade, safe fallback link)", () => {
    const out = enrichArticleHtml('<p>https://www.youtube.com/watch?v=a"b<em>x</em></p>');
    const body = parse(out);
    expect(body.querySelector("[data-embed]")).toBeNull();
  });
});

describe("enrichArticleHtml — XSS safety", () => {
  it("never emits executable markup from a hostile URL-ish string", () => {
    const out = enrichArticleHtml(
      '<p>https://example.com/x" onmouseover="alert(1)</p>',
    );
    const body = parse(out);
    const a = body.querySelector("a")!;
    // The quote terminates the URL match; the rest stays inert TEXT — no
    // element anywhere gains an event-handler attribute.
    expect(a.getAttribute("href")).toBe("https://example.com/x");
    expect(body.querySelectorAll("[onmouseover]").length).toBe(0);
  });

  it("does not embed or linkify javascript: URLs", () => {
    const out = enrichArticleHtml("<p>javascript:alert(document.cookie)</p>");
    const body = parse(out);
    expect(body.querySelector("a")).toBeNull();
    expect(body.querySelector("[data-embed]")).toBeNull();
  });

  it("escapes attribute interpolations when serializing", () => {
    // A URL whose only hostile char survives trimming — serialization must
    // entity-escape it inside the attribute.
    const out = enrichArticleHtml("<p>https://example.com/?q=<script>alert(1)</script></p>");
    expect(out).not.toContain("<script");
  });

  it("returns input unchanged on nonsense input rather than throwing", () => {
    expect(enrichArticleHtml("")).toBe("");
    // @ts-expect-error deliberate wrong type
    expect(enrichArticleHtml(null)).toBe(null);
  });
});

describe("enrichArticleHtml — bare media URLs", () => {
  it("turns a standalone image URL into a proxied <img>", () => {
    const out = enrichArticleHtml("<p>https://example.com/pic.jpg</p>", { imageProxy: proxy });
    const img = parse(out).querySelector("img")!;
    expect(img.getAttribute("src")).toBe(proxy("https://example.com/pic.jpg"));
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("keeps a mid-sentence image URL as a link", () => {
    const out = enrichArticleHtml("<p>see https://example.com/pic.png here</p>", {
      imageProxy: proxy,
    });
    const body = parse(out);
    expect(body.querySelector("img")).toBeNull();
    expect(body.querySelector("a")).toBeTruthy();
  });

  it("turns a standalone .mp4 URL into <video controls>", () => {
    const out = enrichArticleHtml("<p>https://example.com/clip.mp4</p>");
    const video = parse(out).querySelector("video")!;
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("src")).toBe("https://example.com/clip.mp4");
  });

  it("turns a standalone .mp3 URL into <audio controls>", () => {
    const out = enrichArticleHtml("<p>https://example.com/ep.mp3</p>");
    const audio = parse(out).querySelector("audio")!;
    expect(audio.hasAttribute("controls")).toBe(true);
    expect(audio.getAttribute("src")).toBe("https://example.com/ep.mp3");
  });
});

describe("enrichArticleHtml — mixed content stability", () => {
  it("handles prose + video line + image line + inline link in one document", () => {
    const input = [
      "<h2>Show notes</h2>",
      "<p>Intro text with https://example.com/ref inline.</p>",
      "<p>https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>",
      "<p>https://example.com/cover.webp</p>",
      '<p><a href="https://example.com/existing">already linked</a></p>',
    ].join("");
    const out = enrichArticleHtml(input, { imageProxy: proxy });
    const body = parse(out);
    expect(body.querySelector("h2")!.textContent).toBe("Show notes");
    expect(body.querySelectorAll("[data-embed]").length).toBe(1);
    expect(body.querySelectorAll("img").length).toBe(2); // yt thumb + cover
    // inline ref + pre-existing anchor
    expect(body.querySelectorAll("a").length).toBe(2);
    expect(enrichArticleHtml(out, { imageProxy: proxy })).toBe(out);
  });
});

describe("embedSrcFor — click-time validation", () => {
  it("builds the nocookie YouTube embed URL for a valid id", () => {
    expect(embedSrcFor("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
  });

  it("builds the Vimeo player URL for a numeric id", () => {
    expect(embedSrcFor("vimeo", "76979871")).toBe(
      "https://player.vimeo.com/video/76979871?autoplay=1",
    );
  });

  it("rejects attacker-shaped ids and providers (data-* attrs are not trusted)", () => {
    expect(embedSrcFor("youtube", "../evil")).toBeNull();
    expect(embedSrcFor("youtube", 'x" onload="alert(1)')).toBeNull();
    expect(embedSrcFor("vimeo", "76979871/evil")).toBeNull();
    expect(embedSrcFor("evil", "dQw4w9WgXcQ")).toBeNull();
    expect(embedSrcFor(null, null)).toBeNull();
  });
});

describe("parseVideoUrl", () => {
  it("parses watch/short/vimeo forms and rejects lookalikes", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      id: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      id: "dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://vimeo.com/76979871")).toEqual({
      provider: "vimeo",
      id: "76979871",
    });
    expect(parseVideoUrl("https://evil-youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://vimeo.com/not-numeric")).toBeNull();
    expect(parseVideoUrl("not a url")).toBeNull();
  });
});
