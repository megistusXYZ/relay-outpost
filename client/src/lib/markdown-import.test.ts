import { describe, it, expect } from "vitest";
import { parseFrontmatter, markdownToHtml } from "./markdown-import";

describe("parseFrontmatter", () => {
  it("returns empty meta and full body when there is no frontmatter", () => {
    const raw = "# Hello\n\nNo frontmatter here.";
    const { meta, body } = parseFrontmatter(raw);
    expect(meta).toEqual({});
    expect(body).toBe(raw);
  });

  it("maps common keys and strips the frontmatter block from the body", () => {
    const raw = [
      "---",
      "title: Owning Your Audience",
      'summary: "Why portable identity matters."',
      "image: https://example.com/cover.jpg",
      "tags: [nostr, creators, sovereignty]",
      "---",
      "",
      "# Body starts here",
    ].join("\n");
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.title).toBe("Owning Your Audience");
    expect(meta.summary).toBe("Why portable identity matters.");
    expect(meta.image).toBe("https://example.com/cover.jpg");
    expect(meta.tags).toEqual(["nostr", "creators", "sovereignty"]);
    expect(body.startsWith("# Body starts here")).toBe(true);
    expect(body).not.toContain("title:");
  });

  it("supports YAML list syntax and key aliases (description, cover, keywords)", () => {
    const raw = [
      "---",
      "title: Aliased",
      "description: alt summary",
      "cover: /img.png",
      "keywords:",
      "  - one",
      "  - two",
      "---",
      "content",
    ].join("\n");
    const { meta } = parseFrontmatter(raw);
    expect(meta.summary).toBe("alt summary");
    expect(meta.image).toBe("/img.png");
    expect(meta.tags).toEqual(["one", "two"]);
  });

  it("strips leading # from tag values", () => {
    const { meta } = parseFrontmatter("---\ntags: [#bitcoin, #nostr]\n---\nx");
    expect(meta.tags).toEqual(["bitcoin", "nostr"]);
  });
});

describe("markdownToHtml", () => {
  it("converts headings, emphasis, lists, links and code", () => {
    const html = markdownToHtml(
      "# Title\n\nSome **bold** and a [link](https://example.com).\n\n- a\n- b\n\n`code`",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<code>code</code>");
  });

  it("supports GFM tables", () => {
    const html = markdownToHtml("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("preserves fenced code blocks", () => {
    const html = markdownToHtml("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });
});
