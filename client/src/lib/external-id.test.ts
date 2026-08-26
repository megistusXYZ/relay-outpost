import { describe, it, expect } from "vitest";
import {
  normalizeExternalUrl,
  buildExternalRootTags,
  buildExternalReplyTags,
  extractExternalAnchor,
  parseDiscussParam,
} from "./external-id";
import type { Event } from "nostr-tools";

const evt = (over: Partial<Event> = {}): Event =>
  ({
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    created_at: 1_700_000_000,
    kind: 1111,
    tags: [],
    content: "",
    sig: "c".repeat(128),
    ...over,
  }) as Event;

describe("normalizeExternalUrl", () => {
  it("lowercases the host but not the path", () => {
    expect(normalizeExternalUrl("https://Example.COM/Path/To")).toBe(
      "https://example.com/Path/To",
    );
  });

  it("strips a leading www.", () => {
    expect(normalizeExternalUrl("https://www.example.com/a")).toBe(
      "https://example.com/a",
    );
  });

  it("does not strip a non-leading 'www' inside the host", () => {
    expect(normalizeExternalUrl("https://wwwexample.com/a")).toBe(
      "https://wwwexample.com/a",
    );
  });

  it("drops the URL fragment", () => {
    expect(normalizeExternalUrl("https://example.com/a#section-2")).toBe(
      "https://example.com/a",
    );
  });

  it("strips tracking params (utm_*, fbclid, gclid, mc_eid, ref, ref_src)", () => {
    expect(
      normalizeExternalUrl(
        "https://example.com/a?utm_source=x&utm_medium=y&fbclid=1&gclid=2&mc_eid=3&ref=z&ref_src=q",
      ),
    ).toBe("https://example.com/a");
  });

  it("preserves a meaningful query while stripping tracking params", () => {
    expect(
      normalizeExternalUrl("https://example.com/search?q=nostr&utm_source=x"),
    ).toBe("https://example.com/search?q=nostr");
  });

  it("normalizes a trailing slash on a non-root path", () => {
    expect(normalizeExternalUrl("https://example.com/a/b/")).toBe(
      "https://example.com/a/b",
    );
  });

  it("keeps the root path stable", () => {
    expect(normalizeExternalUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(normalizeExternalUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("preserves the HN item?id= query (identity lives in the query)", () => {
    expect(
      normalizeExternalUrl("https://news.ycombinator.com/item?id=123"),
    ).toBe("https://news.ycombinator.com/item?id=123");
  });

  it("preserves the HN item?id= even with tracking noise and a www host", () => {
    expect(
      normalizeExternalUrl(
        "https://www.news.ycombinator.com/item?id=123&utm_source=share",
      ),
    ).toBe("https://news.ycombinator.com/item?id=123");
  });

  it("does not mangle a Lemmy post URL (identity in the path)", () => {
    expect(normalizeExternalUrl("https://lemmy.ml/post/123456")).toBe(
      "https://lemmy.ml/post/123456",
    );
  });

  it("does not mangle a Reddit comment URL (identity in the path)", () => {
    expect(
      normalizeExternalUrl(
        "https://www.reddit.com/r/nostr/comments/abc123/some_title/?utm_source=share&ref=readmore",
      ),
    ).toBe("https://reddit.com/r/nostr/comments/abc123/some_title");
  });

  it("does not mangle a Fediverse (Mastodon) post URL", () => {
    expect(
      normalizeExternalUrl("https://mastodon.social/@alice/109876543210987654"),
    ).toBe("https://mastodon.social/@alice/109876543210987654");
  });

  it("is idempotent: normalize(normalize(x)) === normalize(x)", () => {
    const inputs = [
      "https://Example.COM/Path/To/?utm_source=x#frag",
      "https://www.news.ycombinator.com/item?id=123#comments",
      "https://lemmy.ml/post/123456/",
      "https://example.com",
      "https://www.reddit.com/r/nostr/comments/abc/t/?ref=1",
    ];
    for (const raw of inputs) {
      const once = normalizeExternalUrl(raw);
      expect(normalizeExternalUrl(once)).toBe(once);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeExternalUrl("  https://example.com/a  ")).toBe(
      "https://example.com/a",
    );
  });
});

describe("buildExternalRootTags", () => {
  it("emits uppercase root-scope I and K=web", () => {
    expect(buildExternalRootTags("https://example.com/a")).toEqual([
      ["I", "https://example.com/a"],
      ["K", "web"],
    ]);
  });

  it("normalizes the URL it anchors to", () => {
    expect(
      buildExternalRootTags("https://www.example.com/a?utm_source=x#f"),
    ).toEqual([
      ["I", "https://example.com/a"],
      ["K", "web"],
    ]);
  });
});

describe("buildExternalReplyTags", () => {
  it("keeps the external I/K root scope and points e/k at the parent", () => {
    const parent = evt({ id: "d".repeat(64), pubkey: "e".repeat(64), kind: 1111 });
    const tags = buildExternalReplyTags("https://example.com/a", parent);
    expect(tags).toEqual(
      expect.arrayContaining([
        ["I", "https://example.com/a"],
        ["K", "web"],
        ["e", "d".repeat(64), ""],
        ["k", "1111"],
        ["p", "e".repeat(64)],
      ]),
    );
    // root scope stays uppercase (external), never demoted to a lowercase i
    expect(tags.some((t) => t[0] === "i")).toBe(false);
  });
});

describe("extractExternalAnchor", () => {
  it("returns the normalized URL from the uppercase I tag", () => {
    const e = evt({ tags: [["I", "https://www.example.com/a?utm_source=x"], ["K", "web"]] });
    expect(extractExternalAnchor(e)).toBe("https://example.com/a");
  });

  it("returns null when there is no I tag", () => {
    expect(extractExternalAnchor(evt({ tags: [["e", "x"]] }))).toBeNull();
  });

  it("returns null when the I tag value is not a parseable URL", () => {
    expect(extractExternalAnchor(evt({ tags: [["I", "not a url"]] }))).toBeNull();
  });
});

describe("parseDiscussParam (?discuss= deep-link)", () => {
  it("accepts a plain (URLSearchParams-decoded) http(s) URL and normalizes it", () => {
    expect(parseDiscussParam("https://example.com/a")).toBe("https://example.com/a");
    expect(parseDiscussParam("http://example.com/a")).toBe("http://example.com/a");
  });

  it("accepts a still-percent-encoded URL (single decode, no corruption)", () => {
    expect(parseDiscussParam(encodeURIComponent("https://example.com/a"))).toBe(
      "https://example.com/a",
    );
  });

  it("normalizes (strips www / tracking / fragment) just like the anchor", () => {
    expect(parseDiscussParam("https://www.example.com/a?utm_source=x#frag")).toBe(
      "https://example.com/a",
    );
  });

  it("preserves the HN item?id= identity", () => {
    expect(parseDiscussParam("https://news.ycombinator.com/item?id=123")).toBe(
      "https://news.ycombinator.com/item?id=123",
    );
  });

  it("returns null for empty / whitespace / nullish input", () => {
    expect(parseDiscussParam(null)).toBeNull();
    expect(parseDiscussParam(undefined)).toBeNull();
    expect(parseDiscussParam("")).toBeNull();
    expect(parseDiscussParam("   ")).toBeNull();
  });

  it("returns null for junk that is not a URL", () => {
    expect(parseDiscussParam("not a url")).toBeNull();
    expect(parseDiscussParam("example.com/a")).toBeNull(); // no scheme
  });

  it("rejects a javascript: XSS payload (decoded or encoded)", () => {
    expect(parseDiscussParam("javascript:alert(1)")).toBeNull();
    expect(parseDiscussParam(encodeURIComponent("javascript:alert(document.cookie)"))).toBeNull();
  });

  it("rejects data:, file:, and ftp: schemes", () => {
    expect(parseDiscussParam("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(parseDiscussParam("file:///etc/passwd")).toBeNull();
    expect(parseDiscussParam("ftp://example.com/x")).toBeNull();
  });

  it("returns null (never throws) on malformed percent-encoding", () => {
    expect(parseDiscussParam("%E0%A4%A")).toBeNull();
    expect(parseDiscussParam("%")).toBeNull();
  });

  it("is a fixed point of normalizeExternalUrl (parse ∘ normalize is stable)", () => {
    const out = parseDiscussParam("https://www.example.com/a/?utm_source=x#f");
    expect(out).not.toBeNull();
    expect(normalizeExternalUrl(out!)).toBe(out);
  });
});
