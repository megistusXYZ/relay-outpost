import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

// Markdown -> HTML using the SAME remark stack the article reader uses, so an
// imported .md renders the way it will display. The HTML is fed to TipTap via
// editor.commands.setContent(); display-time safety is handled by the reader's
// rehype-sanitize, and TipTap only keeps the nodes its schema models.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify, { allowDangerousHtml: true });

export function markdownToHtml(md: string): string {
  return processor.processSync(md).toString();
}

export interface FrontmatterMeta {
  title?: string;
  summary?: string;
  image?: string;
  tags?: string[];
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function toList(value: string): string[] {
  let v = value.trim();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  return v
    .split(",")
    .map((s) => unquote(s).replace(/^#/, "").trim())
    .filter(Boolean);
}

/**
 * Split a leading YAML frontmatter block (--- ... ---) from the markdown body
 * and map common keys to article fields. Intentionally a tiny, forgiving parser
 * (key: value, quoted values, inline [a, b] lists, and "- item" lists) — no YAML
 * dependency. If there's no frontmatter, meta is empty and body is the input.
 */
export function parseFrontmatter(raw: string): { meta: FrontmatterMeta; body: string } {
  const text = raw.replace(/^﻿/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };

  const body = text.slice(match[0].length).replace(/^\r?\n+/, "");
  const lines = match[1].split(/\r?\n/);
  const meta: FrontmatterMeta = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];

    // A bare "key:" may be followed by "- item" list lines.
    const listItems: string[] = [];
    if (!val.trim()) {
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        listItems.push(unquote(lines[i + 1].replace(/^\s*-\s+/, "")).replace(/^#/, "").trim());
        i++;
      }
    }

    switch (key) {
      case "title":
        meta.title = unquote(val);
        break;
      case "summary":
      case "description":
      case "excerpt":
        meta.summary = unquote(val);
        break;
      case "image":
      case "cover":
      case "banner":
      case "thumbnail":
        meta.image = unquote(val);
        break;
      case "tags":
      case "keywords":
      case "categories":
        meta.tags = (listItems.length ? listItems : toList(val)).filter(Boolean);
        break;
    }
  }

  return { meta, body };
}
