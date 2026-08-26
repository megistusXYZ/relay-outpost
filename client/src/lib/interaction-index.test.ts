import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import {
  buildInteractionIndex,
  addToIndex,
  createInteractionIndex,
  deriveInteraction,
  eTagTargets,
} from "./interaction-index";

const ev = (over: Partial<Event>): Event => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  kind: over.kind ?? 1,
  pubkey: over.pubkey ?? "author",
  created_at: over.created_at ?? 1000,
  content: over.content ?? "",
  tags: over.tags ?? [],
  sig: "sig",
});

const reaction = (target: string, by: string, content = "+", at = 1000, extraTags: string[][] = []) =>
  ev({ kind: 7, pubkey: by, content, created_at: at, tags: [["e", target], ...extraTags] });
const repost = (target: string, by: string) => ev({ kind: 6, pubkey: by, tags: [["e", target]] });
const reply = (target: string, by: string) => ev({ kind: 1, pubkey: by, tags: [["e", target]] });

describe("eTagTargets", () => {
  it("returns deduped e-tag ids", () => {
    expect(eTagTargets(ev({ tags: [["e", "a"], ["p", "x"], ["e", "b"], ["e", "a"]] }))).toEqual(["a", "b"]);
  });
  it("ignores empty / non-e tags", () => {
    expect(eTagTargets(ev({ tags: [["e", ""], ["t", "hash"]] }))).toEqual([]);
  });
});

describe("reactions", () => {
  it("counts distinct reactors, not raw reaction events", () => {
    const idx = buildInteractionIndex(
      [reaction("post1", "alice"), reaction("post1", "bob"), reaction("post1", "alice", "🔥", 1001)],
      null,
    );
    expect(deriveInteraction(idx, "post1", null).reactionCount).toBe(2);
  });

  it("surfaces the viewer's own reaction content + custom emoji url, latest wins", () => {
    const idx = buildInteractionIndex(
      [
        reaction("p", "me", "+", 1000),
        reaction("p", "me", ":party:", 1005, [["emoji", "party", "https://cdn/party.png"]]),
      ],
      "me",
    );
    const d = deriveInteraction(idx, "p", "me");
    expect(d.hasLiked).toBe(true);
    expect(d.myReactionContent).toBe(":party:");
    expect(d.myReactionEmojiUrl).toBe("https://cdn/party.png");
  });

  it("hasLiked is false and no content when the viewer hasn't reacted", () => {
    const idx = buildInteractionIndex([reaction("p", "someone")], "me");
    const d = deriveInteraction(idx, "p", "me");
    expect(d.hasLiked).toBe(false);
    expect(d.myReactionContent).toBeNull();
    expect(d.myReactionEmojiUrl).toBeUndefined();
  });
});

describe("reposts", () => {
  it("hasReposted reflects viewer membership only", () => {
    const idx = buildInteractionIndex([repost("p", "other"), repost("p", "me")], "me");
    expect(deriveInteraction(idx, "p", "me").hasReposted).toBe(true);
    expect(deriveInteraction(idx, "p", "stranger").hasReposted).toBe(false);
  });
});

describe("replies (viewer-only)", () => {
  it("marks hasReplied only for the viewer's own replies", () => {
    const idx = buildInteractionIndex([reply("p", "me"), reply("q", "other")], "me");
    expect(deriveInteraction(idx, "p", "me").hasReplied).toBe(true);
    expect(deriveInteraction(idx, "q", "me").hasReplied).toBe(false);
  });
});

describe("addToIndex return value (affected targets)", () => {
  it("returns the target ids for a relevant event and [] for irrelevant ones", () => {
    const idx = createInteractionIndex();
    expect(addToIndex(idx, reaction("a", "x"), "me")).toEqual(["a"]);
    expect(addToIndex(idx, repost("b", "x"), "me")).toEqual(["b"]);
    expect(addToIndex(idx, reply("c", "me"), "me")).toEqual(["c"]);
    // Someone else's reply is not indexed as a viewer reply.
    expect(addToIndex(idx, reply("d", "other"), "me")).toEqual([]);
    // A plain note by the viewer with no e-tags touches nothing.
    expect(addToIndex(idx, ev({ kind: 1, pubkey: "me" }), "me")).toEqual([]);
  });
});

describe("empty state", () => {
  it("derives zeros for an unknown target", () => {
    const d = deriveInteraction(createInteractionIndex(), "nope", "me");
    expect(d).toEqual({
      reactionCount: 0,
      hasLiked: false,
      myReactionContent: null,
      myReactionEmojiUrl: undefined,
      hasReposted: false,
      hasReplied: false,
    });
  });
});
