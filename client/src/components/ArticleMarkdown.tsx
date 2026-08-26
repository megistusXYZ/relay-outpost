// The article markdown pipeline, extracted VERBATIM from ArticleDetail so the
// logged-in article page and the logged-out GuestArticlePreview render long-form
// content identically: remark-gfm + nostr-embed detection, rehype-raw +
// article sanitize schema (incl. <nostr-embed>) + style-attr sanitization, and
// the video / iframe / nostr-embed component overrides. Everything here is
// signer-free — NostrReference renders EmbeddedNote / MentionProfileLink, both
// of which read only the event + author profile from eventStore (verified for
// the guest previews), so this module is safe on the unauthenticated path.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Root as HastRoot } from "hast";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { BookOpen } from "lucide-react";
import { EmbeddedNote, MentionProfileLink } from "@/components/NostrPost";
import { VideoEmbed, LinkPreviewCard } from "@/components/MediaRenderer";
import { classifyUrl, isEmbedType, type EmbedType } from "@/lib/media-utils";

const SAFE_CSS_PROPERTIES = new Set([
  "text-align",
  "font-style",
  "font-weight",
  "text-decoration",
  "color",
  "margin",
  "margin-top",
  "margin-bottom",
  "padding",
  "padding-top",
  "padding-bottom",
]);

function sanitizeCssValue(value: string): string {
  return value
    .replace(/expression\s*\(/gi, "")
    .replace(/url\s*\(/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/@import/gi, "")
    .replace(/position\s*:\s*fixed/gi, "")
    .replace(/position\s*:\s*absolute/gi, "");
}

function sanitizeStyleAttr(raw: string): string {
  return raw
    .split(";")
    .map((decl) => decl.trim())
    .filter(Boolean)
    .filter((decl) => {
      const colonIdx = decl.indexOf(":");
      if (colonIdx < 0) return false;
      const prop = decl.slice(0, colonIdx).trim().toLowerCase();
      return SAFE_CSS_PROPERTIES.has(prop);
    })
    .map((decl) => sanitizeCssValue(decl))
    .join("; ");
}

function rehypeSanitizeStyles() {
  return (tree: HastRoot) => {
    const visit = (node: any) => {
      if (node.type === "element" && node.properties?.style) {
        const cleaned = sanitizeStyleAttr(String(node.properties.style));
        if (cleaned) {
          node.properties.style = cleaned;
        } else {
          delete node.properties.style;
        }
      }
      if (node.children) {
        for (const child of node.children) visit(child);
      }
    };
    visit(tree);
  };
}

const STYLE_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "div", "span"];

const articleSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "video", "source", "iframe", "mark", "sub", "sup", "u", "center",
  ],
  attributes: {
    ...defaultSchema.attributes,
    video: ["src", "controls", "preload", "poster", "width", "height", "style"],
    source: ["src", "type"],
    iframe: ["src", "width", "height", "style", "allowFullScreen", "loading", "title"],
    ...Object.fromEntries(
      STYLE_TAGS.map((tag) => [
        tag,
        [...(defaultSchema.attributes?.[tag] || []), "style"],
      ])
    ) },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https"] } };

const NOSTR_REF_REGEX = /nostr:(nevent1[a-z0-9]+|note1[a-z0-9]+|naddr1[a-z0-9]+|npub1[a-z0-9]+|nprofile1[a-z0-9]+|nrelay1[a-z0-9]+|nsec1[a-z0-9]+)/g;

function NostrReference({ encoded }: { encoded: string }) {
  try {
    const decoded = nip19.decode(encoded);
    if (decoded.type === "nevent") {
      return <EmbeddedNote eventId={decoded.data.id} encoded={encoded} relays={decoded.data.relays} />;
    }
    if (decoded.type === "note") {
      return <EmbeddedNote eventId={decoded.data as string} encoded={encoded} />;
    }
    if (decoded.type === "npub") {
      return <MentionProfileLink pubkey={decoded.data as string} />;
    }
    if (decoded.type === "nprofile") {
      return <MentionProfileLink pubkey={decoded.data.pubkey} />;
    }
    if (decoded.type === "naddr") {
      const href = `/articles/${encoded}`;
      return (
        <Link href={href} className="inline-flex items-center gap-1 text-brand hover:underline text-sm">
          <BookOpen className="w-3.5 h-3.5 shrink-0" />
          <span>Referenced article</span>
        </Link>
      );
    }
    if (decoded.type === "nrelay") {
      const relay = decoded.data as string;
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/80 font-mono bg-muted/30 rounded px-1.5 py-0.5">
          {relay}
        </span>
      );
    }
  } catch {}
  if (encoded.startsWith("nsec1")) {
    return <span className="text-xs text-red-500/70 font-mono">[private key redacted]</span>;
  }
  return <span className="text-xs text-muted-foreground/60 font-mono">{encoded.slice(0, 16)}…</span>;
}

function remarkNostrEmbeds() {
  return (tree: any) => {
    const { visit } = visitModule;
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (!parent || index === undefined) return;

      const regex = new RegExp(NOSTR_REF_REGEX.source, "g");
      const value: string = node.value;
      if (!regex.test(value)) return;

      regex.lastIndex = 0;
      const children: any[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIndex) {
          children.push({ type: "text", value: value.slice(lastIndex, match.index) });
        }
        children.push({
          type: "html",
          value: `<nostr-embed data-ref="${match[1]}"></nostr-embed>` });
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < value.length) {
        children.push({ type: "text", value: value.slice(lastIndex) });
      }

      if (children.length > 0) {
        parent.children.splice(index, 1, ...children);
        return index + children.length;
      }
    });
  };
}

const SKIP_NODE_TYPES = new Set(["code", "inlineCode"]);

const visitModule = (() => {
  function visit(tree: any, type: string, visitor: (node: any, index: number | undefined, parent: any) => any) {
    function walk(node: any, parent: any, index: number | undefined) {
      if (SKIP_NODE_TYPES.has(node.type)) return;
      if (node.type === type) {
        const result = visitor(node, index, parent);
        if (typeof result === "number") return result;
      }
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          const result = walk(node.children[i], node, i);
          if (typeof result === "number") {
            i = result - 1;
          }
        }
      }
    }
    walk(tree, null, undefined);
  }
  return { visit };
})();

const articleSanitizeSchemaWithNostr = {
  ...articleSanitizeSchema,
  tagNames: [
    ...(articleSanitizeSchema.tagNames || []),
    "nostr-embed",
  ],
  attributes: {
    ...articleSanitizeSchema.attributes,
    "nostr-embed": ["data-ref", "dataRef"] } };

/** Shared long-form renderer: the exact plugin set + component overrides the
 *  logged-in article page uses. Wrap in an `.article-prose` container. */
export function ArticleMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkNostrEmbeds]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, articleSanitizeSchemaWithNostr], rehypeSanitizeStyles]}
      components={{
        video: ({ node, ...props }: any) => (
          <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: 12, marginBottom: 16 }}>
            <video
              {...props}
              controls
              preload="metadata"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
              disablePictureInPicture
            />
          </div>
        ),
        iframe: ({ node, ...props }: any) => (
          <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: 12, marginBottom: 16 }}>
            <iframe
              {...props}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
              allowFullScreen
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </div>
        ),
        "nostr-embed": ({ node, ...props }: any) => {
          const ref = props["data-ref"] || node?.properties?.dataRef;
          if (!ref) return null;
          return <NostrReference encoded={ref} />;
        },
        // Bare URLs (remark-gfm autolinks, where the link text IS the href)
        // render as first-class media: video hosts become inline players and
        // everything else becomes an OG link card — same treatment the feed
        // gives them. Authored links (`[label](url)`) keep their anchor form.
        a: ({ node, href, children, ...props }: any) => {
          const url = typeof href === "string" ? href : "";
          const childText =
            Array.isArray(children) && children.length === 1 && typeof children[0] === "string"
              ? children[0]
              : typeof children === "string"
                ? children
                : null;
          const isBareAutolink = !!url && childText !== null && childText.trim() === url.trim();
          if (isBareAutolink && /^https?:\/\//i.test(url)) {
            const type = classifyUrl(url);
            if (isEmbedType(type)) {
              return (
                <span className="block my-4 not-prose">
                  <VideoEmbed type={type as EmbedType} url={url} />
                </span>
              );
            }
            if (type === "link") {
              return (
                <span className="block my-4 not-prose">
                  <LinkPreviewCard url={url} />
                </span>
              );
            }
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          );
        } } as any}
    >
      {content}
    </ReactMarkdown>
  );
}
