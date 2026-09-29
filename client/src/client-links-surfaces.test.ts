/**
 * A link to another Nostr client shows natively everywhere text is rendered
 * (owner, 2026-09-29). Measured before: in article comments, relay group
 * chat and thread replies it vanished completely. Their renderers drop http
 * links from the text (media and previews show them instead), and the preview
 * side skips client links (it only knows them in their nostr: form), so the
 * link was shown nowhere. Rendering from the normalized text turns it into a
 * nostr: reference: an embedded card, or an @mention.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = (p: string) => readFileSync(path.resolve(import.meta.dirname, p), "utf8");

describe("renderers show client links natively instead of dropping them", () => {
  it("article comments", () => {
    const s = src("components/CommentContent.tsx");
    expect(s).toMatch(/normalizeNostrClientLinks\(event\.content\)/);
    expect(s).toMatch(/useRenderedContent\(normalized,/);
  });

  it("relay group chat", () => {
    const s = src("components/CommsTab.tsx");
    const fn = s.slice(s.indexOf("function ChatContentRenderer("));
    expect(fn.slice(0, 1500)).toMatch(/content: normalizeNostrClientLinks\(content\)/);
  });

  it("thread replies", () => {
    const s = src("components/nostr-post/thread.tsx");
    expect(s).toMatch(/extractMediaFromContent\(normalizeNostrClientLinks\(event\.content\)\)/);
  });
});
