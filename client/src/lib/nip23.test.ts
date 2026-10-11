/**
 * Editing an article (owner, 2026-10-11): an article is an addressable
 * event, so an edit is the same article republished at the same address
 * with a newer timestamp. The link never changes and the first publish
 * date stays, so a typo fix doesn't jump the piece to the top of feeds.
 */
import { describe, it, expect } from "vitest";
import { buildArticleEvent } from "./nip23";

const tag = (ev: { tags: string[][] }, name: string) => ev.tags.find((t) => t[0] === name)?.[1];

describe("buildArticleEvent", () => {
  const draft = { title: "Owning your audience", summary: "", content: "Body", image: "", hashtags: [] };

  it("a new article gets its own address and today's publish date", () => {
    const ev = buildArticleEvent(draft);
    expect(tag(ev, "d")).toMatch(/^owning-your-audience-[a-z0-9]{6}$/);
    expect(Number(tag(ev, "published_at"))).toBe(ev.created_at);
  });

  it("an edit keeps the address and the first publish date, with a fresh timestamp", () => {
    const first = 1_700_000_000;
    const ev = buildArticleEvent({ ...draft, title: "Owning your audience (updated)", dTag: "owning-your-audience-k3x9pq", publishedAt: first });
    expect(tag(ev, "d")).toBe("owning-your-audience-k3x9pq");
    expect(tag(ev, "published_at")).toBe(String(first));
    expect(ev.created_at).toBeGreaterThan(first);
    expect(tag(ev, "title")).toBe("Owning your audience (updated)");
  });
});

describe("editing helpers", () => {
  const published = {
    id: "a".repeat(64), pubkey: "b".repeat(64), kind: 30023, sig: "", created_at: 1_700_000_500,
    content: "# Hello\n\nFirst **draft**.",
    tags: [["d", "hello-k3x9pq"], ["title", "Hello"], ["published_at", "1700000000"], ["summary", "A start"],
      ["image", "https://img.example/c.jpg"], ["t", "nostr"], ["t", "writing"], ["L", "codex-section"], ["l", "Guides", "codex-section"], ["comments", "off"]],
  };

  it("articleToDraft hands the editor back everything it needs to republish at the same address", async () => {
    const { articleToDraft } = await import("./nip23");
    expect(articleToDraft(published)).toEqual({
      title: "Hello", summary: "A start", image: "https://img.example/c.jpg", hashtags: ["nostr", "writing"],
      section: "Guides", commentsDisabled: true, dTag: "hello-k3x9pq", publishedAt: 1_700_000_000,
      markdown: "# Hello\n\nFirst **draft**.",
    });
  });

  it("newestByAddress keeps one version per article: the latest", async () => {
    const { newestByAddress } = await import("./nip23");
    const older = { ...published, id: "c".repeat(64), created_at: 1_700_000_100 };
    const other = { ...published, id: "d".repeat(64), tags: [["d", "other"], ["title", "Other"]] };
    expect(newestByAddress([older, other, published]).map((e) => e.id)).toEqual([published.id, other.id]);
  });

  it("buildArticleDeletion names the event, the address and the kind so relays and other apps honour it", async () => {
    const { buildArticleDeletion } = await import("./nip23");
    const del = buildArticleDeletion(published);
    expect(del.kind).toBe(5);
    expect(del.tags).toEqual([["e", "a".repeat(64)], ["a", `30023:${"b".repeat(64)}:hello-k3x9pq`], ["k", "30023"]]);
  });
});
