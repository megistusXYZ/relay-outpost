import { describe, it, expect, beforeEach } from "vitest";
import type { Event } from "nostr-tools";
import {
  DISCUSSION_PUBLIC_FLOOR,
  discussionWriteSuperset,
  discussionReadUnion,
  discussionWriteTargets,
  enrichCommentMentions,
  applyDiscussionTrust,
  shouldNotifyForComment,
  buildComment,
  mergeDiscussionEvents,
  getCachedDiscussion,
  cacheDiscussion,
  __clearDiscussionCache,
  type DiscussionTrustDeps,
  type CommentNotifyDeps,
} from "./external-comments";
import { buildExternalRootTags } from "./external-id";
import { nip19 } from "nostr-tools";

const NOW = 1_700_000_000;
const DAY = 24 * 60 * 60;

const evt = (over: Partial<Event> = {}): Event =>
  ({
    id: Math.random().toString(36).slice(2).padEnd(64, "0"),
    pubkey: "0".repeat(64),
    created_at: NOW,
    kind: 1111,
    tags: [
      ["I", "https://example.com/a"],
      ["K", "web"],
    ],
    content: "a comment",
    sig: "s".repeat(128),
    ...over,
  }) as Event;

const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
const has = (relays: string[], url: string) =>
  relays.some((r) => norm(r) === norm(url));

describe("discussionWriteSuperset", () => {
  it("is never narrower than the base outbox floor", () => {
    const base = [
      "wss://my-outbox-a.example",
      "wss://my-outbox-b.example",
      "wss://relay.damus.io", // overlaps the public floor
    ];
    const superset = discussionWriteSuperset(base);
    for (const r of base) {
      expect(has(superset, r)).toBe(true);
    }
  });

  it("adds every public-floor relay to the base", () => {
    const superset = discussionWriteSuperset(["wss://my-outbox.example"]);
    for (const r of DISCUSSION_PUBLIC_FLOOR) {
      expect(has(superset, r)).toBe(true);
    }
  });

  it("does not duplicate an already-advertised public relay", () => {
    const base = ["wss://relay.damus.io/", "wss://nos.lol"];
    const superset = discussionWriteSuperset(base);
    const damus = superset.filter((r) => norm(r) === norm("wss://relay.damus.io"));
    expect(damus.length).toBe(1);
  });

  it("holds the superset invariant for an empty base", () => {
    const superset = discussionWriteSuperset([]);
    for (const r of DISCUSSION_PUBLIC_FLOOR) expect(has(superset, r)).toBe(true);
  });
});

describe("discussionReadUnion", () => {
  it("contains the full write superset plus the wide index", () => {
    const read = discussionReadUnion(["wss://my-outbox.example"], []);
    expect(has(read, "wss://my-outbox.example")).toBe(true);
    for (const r of DISCUSSION_PUBLIC_FLOOR) expect(has(read, r)).toBe(true);
    expect(has(read, "wss://relay.nostr.band")).toBe(true);
  });

  it("folds in the discover pool", () => {
    const read = discussionReadUnion([], ["wss://discover-a.example"]);
    expect(has(read, "wss://discover-a.example")).toBe(true);
  });

  it("caps the read union size", () => {
    const bigPool = Array.from({ length: 40 }, (_, i) => `wss://d${i}.example`);
    const read = discussionReadUnion([], bigPool);
    expect(read.length).toBeLessThanOrEqual(14);
  });
});

describe("applyDiscussionTrust", () => {
  const baseDeps = (over: Partial<DiscussionTrustDeps> = {}): DiscussionTrustDeps => ({
    preset: "balanced",
    follows: new Set<string>(),
    nowSeconds: NOW,
    ...over,
  });

  it("always admits an in-network (followed) author, even with zero signal", () => {
    const author = "f".repeat(64);
    const e = evt({ pubkey: author });
    const { comments, filteredCount } = applyDiscussionTrust(
      [e],
      baseDeps({ follows: new Set([author]) }),
    );
    expect(comments.map((c) => c.id)).toContain(e.id);
    expect(filteredCount).toBe(0);
  });

  it("always admits the signed-in user's own comment", () => {
    const me = "e".repeat(64);
    const e = evt({ pubkey: me });
    const { comments } = applyDiscussionTrust([e], baseDeps({ selfPubkey: me }));
    expect(comments.map((c) => c.id)).toContain(e.id);
  });

  it("demotes (does not drop) a cold zero-signal stranger", () => {
    const stranger = "a".repeat(64);
    const e = evt({ pubkey: stranger });
    const { comments, filtered, filteredCount } = applyDiscussionTrust(
      [e],
      baseDeps(),
    );
    expect(comments).toHaveLength(0);
    expect(filtered.map((c) => c.id)).toContain(e.id);
    expect(filteredCount).toBe(1);
  });

  it("admits a stranger with positive WoT", () => {
    const stranger = "b".repeat(64);
    const e = evt({ pubkey: stranger });
    const { comments, filteredCount } = applyDiscussionTrust(
      [e],
      baseDeps({ scoreGetter: () => 0.5 }),
    );
    expect(comments.map((c) => c.id)).toContain(e.id);
    expect(filteredCount).toBe(0);
  });

  it("admits an established stranger (old first-seen)", () => {
    const stranger = "c".repeat(64);
    const e = evt({ pubkey: stranger });
    const { comments } = applyDiscussionTrust(
      [e],
      baseDeps({ firstSeenGetter: () => NOW - 60 * DAY }),
    );
    expect(comments.map((c) => c.id)).toContain(e.id);
  });

  it("dedupes by event id across overlapping relays", () => {
    const author = "f".repeat(64);
    const e = evt({ id: "dup".padEnd(64, "0"), pubkey: author });
    const { comments } = applyDiscussionTrust(
      [e, { ...e }],
      baseDeps({ follows: new Set([author]) }),
    );
    expect(comments).toHaveLength(1);
  });

  it("sorts admitted comments newest-first", () => {
    const author = "f".repeat(64);
    const older = evt({ pubkey: author, created_at: NOW - 100 });
    const newer = evt({ pubkey: author, created_at: NOW });
    const { comments } = applyDiscussionTrust(
      [older, newer],
      baseDeps({ follows: new Set([author]) }),
    );
    expect(comments[0].id).toBe(newer.id);
  });
});

describe("buildComment", () => {
  it("builds a kind-1111 rooted on the normalized URL", () => {
    const c = buildComment("https://www.example.com/a?utm_source=x", "hello");
    expect(c.kind).toBe(1111);
    expect(c.content).toBe("hello");
    expect(c.tags).toEqual(
      expect.arrayContaining(buildExternalRootTags("https://example.com/a")),
    );
    // top-level comment: no parent e-tag
    expect(c.tags.some((t) => t[0] === "e")).toBe(false);
  });

  it("builds a reply pointing e/k at the parent while keeping the external root", () => {
    const parent = evt({ id: "p".repeat(64), pubkey: "q".repeat(64) });
    const c = buildComment("https://example.com/a", "reply", { parent });
    expect(c.tags).toEqual(
      expect.arrayContaining([
        ["I", "https://example.com/a"],
        ["K", "web"],
        ["e", "p".repeat(64), ""],
        ["k", "1111"],
      ]),
    );
  });

  it("carries @-mention p-tags (with relay hints) and #hashtag t-tags", () => {
    const alice = "a".repeat(64);
    const c = buildComment("https://example.com/a", "hi nostr:npub…", {
      mentionTags: [["p", alice, "wss://alice.example"]],
      hashtagTags: [["t", "nostr"]],
    });
    expect(c.tags).toEqual(
      expect.arrayContaining([
        ["I", "https://example.com/a"],
        ["K", "web"],
        ["p", alice, "wss://alice.example"],
        ["t", "nostr"],
      ]),
    );
  });

  it("collapses a duplicate p-tag when the reply's parent author is also @-mentioned (prefers the hinted variant)", () => {
    const author = "q".repeat(64);
    const parent = evt({ id: "p".repeat(64), pubkey: author });
    const c = buildComment("https://example.com/a", "reply + mention", {
      parent,
      mentionTags: [["p", author, "wss://author.example"]],
    });
    const authorPTags = c.tags.filter((t) => t[0] === "p" && t[1] === author);
    expect(authorPTags).toHaveLength(1);
    // the hinted variant wins over the bare parent-author p-tag
    expect(authorPTags[0]).toEqual(["p", author, "wss://author.example"]);
  });
});

describe("discussionWriteTargets (outbox-route to @-mentioned inboxes)", () => {
  const base = ["wss://my-outbox.example"];

  it("is never narrower than the plain write superset", () => {
    const superset = discussionWriteSuperset(base);
    const targets = discussionWriteTargets(base, ["wss://alice-inbox.example"]);
    for (const r of superset) expect(has(targets, r)).toBe(true);
  });

  it("adds each mentioned user's inbox relay on top of the superset", () => {
    const targets = discussionWriteTargets(base, [
      "wss://alice-inbox.example",
      "wss://bob-inbox.example",
    ]);
    expect(has(targets, "wss://alice-inbox.example")).toBe(true);
    expect(has(targets, "wss://bob-inbox.example")).toBe(true);
  });

  it("does not duplicate an inbox relay already in the superset", () => {
    // relay.damus.io is part of the public floor → already in the superset.
    const targets = discussionWriteTargets(base, ["wss://relay.damus.io"]);
    const damus = targets.filter((r) => norm(r) === norm("wss://relay.damus.io"));
    expect(damus.length).toBe(1);
  });

  it("dedupes inbox relays repeated across several mentions", () => {
    const targets = discussionWriteTargets(base, [
      "wss://shared-inbox.example",
      "wss://shared-inbox.example/",
    ]);
    const shared = targets.filter((r) => norm(r) === norm("wss://shared-inbox.example"));
    expect(shared.length).toBe(1);
  });

  it("caps the additive mention-inbox fan-out (bounded), superset still intact", () => {
    const manyInboxes = Array.from({ length: 30 }, (_, i) => `wss://inbox-${i}.example`);
    const targets = discussionWriteTargets(base, manyInboxes, 5);
    const superset = discussionWriteSuperset(base);
    // superset always fully present …
    for (const r of superset) expect(has(targets, r)).toBe(true);
    // … plus at most `extraCap` *additional* inbox relays
    expect(targets.length).toBeLessThanOrEqual(superset.length + 5);
  });

  it("equals the plain superset when there are no mentions", () => {
    expect(discussionWriteTargets(base, [])).toEqual(discussionWriteSuperset(base));
  });
});

describe("enrichCommentMentions (p/t tag extraction + NIP-27 refs)", () => {
  const alice = "a".repeat(64);
  const bob = "b".repeat(64);
  const npubOf = (pk: string) => nip19.npubEncode(pk);

  it("builds a ['p', pubkey, hint] tag per mention when a relay hint is known", () => {
    const { pTags } = enrichCommentMentions(
      `hi nostr:${npubOf(alice)}`,
      [alice],
      () => "wss://alice-inbox.example",
    );
    expect(pTags).toEqual([["p", alice, "wss://alice-inbox.example"]]);
  });

  it("omits the hint (2-element p-tag) when the mentioned user's relays are unknown", () => {
    const { pTags } = enrichCommentMentions(`hi nostr:${npubOf(alice)}`, [alice], () => undefined);
    expect(pTags).toEqual([["p", alice]]);
  });

  it("upgrades the embedded nostr:npub to nostr:nprofile carrying the hint", () => {
    const hint = "wss://alice-inbox.example";
    const { content } = enrichCommentMentions(`hi nostr:${npubOf(alice)}!`, [alice], () => hint);
    const nprofile = nip19.nprofileEncode({ pubkey: alice, relays: [hint] });
    expect(content).toBe(`hi nostr:${nprofile}!`);
    expect(content).not.toContain(npubOf(alice));
  });

  it("leaves the nostr:npub ref untouched when there is no hint to embed", () => {
    const content = `hi nostr:${npubOf(alice)}`;
    const out = enrichCommentMentions(content, [alice], () => undefined);
    expect(out.content).toBe(content);
  });

  it("dedupes a pubkey mentioned twice into a single p-tag", () => {
    const { pTags } = enrichCommentMentions(
      `nostr:${npubOf(alice)} and again nostr:${npubOf(alice)}`,
      [alice, alice],
      () => "wss://alice-inbox.example",
    );
    expect(pTags).toEqual([["p", alice, "wss://alice-inbox.example"]]);
  });

  it("skips junk (non-hex) mention entries", () => {
    const { pTags } = enrichCommentMentions("hello", ["not-a-pubkey", bob], () => undefined);
    expect(pTags).toEqual([["p", bob]]);
  });
});

describe("shouldNotifyForComment (reply-alert anti-spam gate)", () => {
  const MY_ID = "m".repeat(64);
  const ME = "e".repeat(64);
  // A kind-1111 reply carries an e-tag pointing at the parent comment id.
  const reply = (over: Partial<Event> & { parentId?: string } = {}): Event => {
    const { parentId = MY_ID, ...rest } = over;
    return evt({
      pubkey: "a".repeat(64),
      tags: [
        ["I", "https://example.com/a"],
        ["K", "web"],
        ["e", parentId, ""],
        ["k", "1111"],
        ["p", ME],
      ],
      ...rest,
    });
  };
  const deps = (over: Partial<CommentNotifyDeps> = {}): CommentNotifyDeps => ({
    myCommentIds: new Set([MY_ID]),
    preset: "balanced",
    follows: new Set<string>(),
    selfPubkey: ME,
    nowSeconds: NOW,
    ...over,
  });

  it("NOTIFIES: a reply to my comment from an in-network (followed) author", () => {
    const author = "f".repeat(64);
    expect(
      shouldNotifyForComment(reply({ pubkey: author }), deps({ follows: new Set([author]) })),
    ).toBe(true);
  });

  it("NOTIFIES: a reply to my comment from an earned-signal stranger (positive WoT)", () => {
    expect(shouldNotifyForComment(reply(), deps({ scoreGetter: () => 0.5 }))).toBe(true);
  });

  it("does NOT notify: a stranger p-tags me but does NOT reply to my comment", () => {
    // p-tags ME, but the only e-tag points at someone else's comment.
    const bareMention = evt({
      pubkey: "a".repeat(64),
      tags: [
        ["I", "https://example.com/a"],
        ["K", "web"],
        ["e", "z".repeat(64), ""],
        ["p", ME],
      ],
    });
    expect(shouldNotifyForComment(bareMention, deps({ follows: new Set(["a".repeat(64)]) }))).toBe(
      false,
    );
  });

  it("does NOT notify: a cold zero-signal stranger replies to my comment", () => {
    expect(shouldNotifyForComment(reply(), deps())).toBe(false);
  });

  it("does NOT notify: a reply to a comment that is NOT mine", () => {
    const author = "f".repeat(64);
    expect(
      shouldNotifyForComment(
        reply({ pubkey: author, parentId: "n".repeat(64) }),
        deps({ follows: new Set([author]) }),
      ),
    ).toBe(false);
  });

  it("does NOT notify: my own reply to my own comment (no self-notify)", () => {
    expect(shouldNotifyForComment(reply({ pubkey: ME }), deps())).toBe(false);
  });

  it("does NOT notify: a flagged author's reply (safety floor drops it)", () => {
    const flagged = "a".repeat(64);
    expect(
      shouldNotifyForComment(
        reply({ pubkey: flagged }),
        deps({ flaggedPubkeys: new Set([flagged]), scoreGetter: () => 0.9 }),
      ),
    ).toBe(false);
  });

  it("does NOT notify: a non-1111 event (kind guard), even from a follow p-tagging me", () => {
    const author = "f".repeat(64);
    const note = evt({
      kind: 1,
      pubkey: author,
      tags: [
        ["e", MY_ID, ""],
        ["p", ME],
      ],
    });
    expect(shouldNotifyForComment(note, deps({ follows: new Set([author]) }))).toBe(false);
  });

  // ── Pure @-mention branch: p-tags me, NO reply e-tag (a top-level comment
  //    that mentions me) — notifies iff the author clears the trust bar. ──
  const mention = (over: Partial<Event> = {}): Event =>
    evt({
      pubkey: "a".repeat(64),
      tags: [
        ["I", "https://example.com/a"],
        ["K", "web"],
        ["p", ME],
      ],
      ...over,
    });

  it("NOTIFIES: a pure @-mention (p-tags me, no reply e-tag) from a followed author", () => {
    const author = "f".repeat(64);
    expect(
      shouldNotifyForComment(mention({ pubkey: author }), deps({ follows: new Set([author]) })),
    ).toBe(true);
  });

  it("NOTIFIES: a pure @-mention from an earned-signal stranger (positive WoT)", () => {
    expect(shouldNotifyForComment(mention(), deps({ scoreGetter: () => 0.5 }))).toBe(true);
  });

  it("does NOT notify: a pure @-mention from a cold zero-signal stranger", () => {
    expect(shouldNotifyForComment(mention(), deps())).toBe(false);
  });

  it("does NOT notify: a pure @-mention from a flagged author (safety floor)", () => {
    const flagged = "a".repeat(64);
    expect(
      shouldNotifyForComment(
        mention({ pubkey: flagged }),
        deps({ flaggedPubkeys: new Set([flagged]), scoreGetter: () => 0.9 }),
      ),
    ).toBe(false);
  });

  it("does NOT notify: a top-level comment that does NOT p-tag me (no relevance)", () => {
    const author = "f".repeat(64);
    const topLevel = evt({
      pubkey: author,
      tags: [
        ["I", "https://example.com/a"],
        ["K", "web"],
      ],
    });
    expect(shouldNotifyForComment(topLevel, deps({ follows: new Set([author]) }))).toBe(false);
  });
});

describe("mergeDiscussionEvents", () => {
  it("dedupes by event id across streamed batches (overlapping relays)", () => {
    const a = evt({ id: "a".padEnd(64, "0"), created_at: NOW });
    const merged = mergeDiscussionEvents([a], [{ ...a }, { ...a }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(a.id);
  });

  it("folds a genuinely new event into the accumulating set", () => {
    const a = evt({ id: "a".padEnd(64, "0") });
    const b = evt({ id: "b".padEnd(64, "0") });
    const merged = mergeDiscussionEvents([a], [b]);
    expect(merged.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("sorts the merged set newest-first", () => {
    const older = evt({ id: "o".padEnd(64, "0"), created_at: NOW - 100 });
    const newer = evt({ id: "n".padEnd(64, "0"), created_at: NOW });
    expect(mergeDiscussionEvents([older], [newer])[0].id).toBe(newer.id);
    // order of arrival doesn't matter — still newest-first
    expect(mergeDiscussionEvents([newer], [older])[0].id).toBe(newer.id);
  });

  it("keeps the already-present event on an id collision (immutable by id)", () => {
    const first = evt({ id: "x".padEnd(64, "0"), content: "original" });
    const dupeDifferentContent = evt({ id: "x".padEnd(64, "0"), content: "tampered" });
    const merged = mergeDiscussionEvents([first], [dupeDifferentContent]);
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe("original");
  });

  it("does not mutate its inputs", () => {
    const a = evt({ id: "a".padEnd(64, "0") });
    const existing = [a];
    const incoming = [evt({ id: "b".padEnd(64, "0") })];
    mergeDiscussionEvents(existing, incoming);
    expect(existing).toHaveLength(1);
    expect(incoming).toHaveLength(1);
  });
});

describe("discussion thread cache (stale-while-revalidate)", () => {
  beforeEach(() => __clearDiscussionCache());

  it("round-trips events under the same URL", () => {
    const e = evt();
    cacheDiscussion("https://example.com/a", [e]);
    expect(getCachedDiscussion("https://example.com/a")?.map((x) => x.id)).toEqual([e.id]);
  });

  it("keys by the NORMALIZED anchor (www + tracking variant hits the same entry)", () => {
    const e = evt();
    cacheDiscussion("https://example.com/a", [e]);
    // A decorated variant of the same page normalizes to the same key.
    const hit = getCachedDiscussion("https://www.example.com/a?utm_source=x#frag");
    expect(hit?.map((x) => x.id)).toEqual([e.id]);
  });

  it("returns undefined for a never-cached URL", () => {
    expect(getCachedDiscussion("https://example.com/never")).toBeUndefined();
  });

  it("returns undefined (never throws) for a junk URL", () => {
    expect(getCachedDiscussion("not a url")).toBeUndefined();
    // caching junk is a silent no-op, not a throw
    expect(() => cacheDiscussion("not a url", [evt()])).not.toThrow();
  });

  it("returns a copy — mutating the result can't corrupt the cache", () => {
    cacheDiscussion("https://example.com/a", [evt()]);
    const snap = getCachedDiscussion("https://example.com/a")!;
    snap.push(evt());
    expect(getCachedDiscussion("https://example.com/a")).toHaveLength(1);
  });
});
