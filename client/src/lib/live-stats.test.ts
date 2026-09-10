/**
 * lib/live-stats.ts — which store arrivals may bump a post's shown counts.
 *
 * Reported 2026-09-10: "whenever users press like it goes up by 2, not 1".
 * Two +1s for one reaction: the like handler bumps the stats cache at once
 * (optimistic), and usePrimalStats ALSO added +1 for every kind-7 that landed
 * in the local event store — including the viewer's own, published a moment
 * later. The same path counted fetched HISTORY: fetchInteractions pulls every
 * reply/repost/reaction for a post into the store, and each one was added on
 * top of Primal's server count, which already includes it.
 *
 * The rule: only a genuinely NEW interaction from SOMEONE ELSE counts live —
 * created after the post came on screen, not authored by the viewer (whose
 * actions are counted where they happen).
 */
import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { liveStatsField } from "./live-stats";

const POST = "a".repeat(64);
const OTHER_POST = "b".repeat(64);
const VIEWER = "c".repeat(64);
const SOMEONE = "d".repeat(64);
const SHOWN_AT = 1_789_000_000;

function ev(kind: number, pubkey: string, createdAt: number, tags: string[][], content = ""): Event {
  return { id: `${kind}-${pubkey.slice(0, 4)}-${createdAt}`, kind, pubkey, created_at: createdAt, tags, content, sig: "" };
}

const like = (pubkey: string, at: number, target = POST) => ev(7, pubkey, at, [["e", target], ["p", SOMEONE]], "+");

describe("liveStatsField — what may bump the shown counts while a post is on screen", () => {
  it("someone else's new like counts", () => {
    expect(liveStatsField(like(SOMEONE, SHOWN_AT + 5), POST, VIEWER, SHOWN_AT)).toBe("likes");
  });

  it("the viewer's own like does not — the like button already counted it (the +2 bug)", () => {
    expect(liveStatsField(like(VIEWER, SHOWN_AT + 5), POST, VIEWER, SHOWN_AT)).toBeNull();
  });

  it("history fetched after the post appeared does not — the server count already has it", () => {
    expect(liveStatsField(like(SOMEONE, SHOWN_AT - 3600), POST, VIEWER, SHOWN_AT)).toBeNull();
  });

  it("a like on a different post does not", () => {
    expect(liveStatsField(like(SOMEONE, SHOWN_AT + 5, OTHER_POST), POST, VIEWER, SHOWN_AT)).toBeNull();
  });

  it("new reposts and direct replies from someone else count in their own field", () => {
    expect(liveStatsField(ev(6, SOMEONE, SHOWN_AT + 1, [["e", POST]]), POST, VIEWER, SHOWN_AT)).toBe("reposts");
    expect(liveStatsField(ev(1, SOMEONE, SHOWN_AT + 1, [["e", POST, "", "root"], ["e", POST, "", "reply"]]), POST, VIEWER, SHOWN_AT)).toBe("replies");
  });

  it("a reply further down a thread is not a direct reply to this post", () => {
    const deeper = ev(1, SOMEONE, SHOWN_AT + 1, [["e", POST, "", "root"], ["e", OTHER_POST, "", "reply"]]);
    expect(liveStatsField(deeper, POST, VIEWER, SHOWN_AT)).toBeNull();
  });

  it("the viewer's own repost and reply do not count live either", () => {
    expect(liveStatsField(ev(6, VIEWER, SHOWN_AT + 1, [["e", POST]]), POST, VIEWER, SHOWN_AT)).toBeNull();
    expect(liveStatsField(ev(1, VIEWER, SHOWN_AT + 1, [["e", POST, "", "reply"]]), POST, VIEWER, SHOWN_AT)).toBeNull();
  });

  it("signed out, someone else's new like still counts", () => {
    expect(liveStatsField(like(SOMEONE, SHOWN_AT + 5), POST, null, SHOWN_AT)).toBe("likes");
  });
});
