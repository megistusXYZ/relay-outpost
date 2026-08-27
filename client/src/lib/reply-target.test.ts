/**
 * Reply-target resolution (lib/reply-target.ts) — which post a reply answers,
 * across BOTH reply generations:
 *
 *  - kind 1, NIP-10: lowercase e-tags with "reply"/"root" markers (and the
 *    marker-less legacy orderings).
 *  - kind 1111, NIP-22: lowercase e = PARENT, uppercase E = thread ROOT, no
 *    markers (the 4th element is a pubkey, not a marker).
 *
 * Why now (2026-08-27): Amethyst announced it replies to all kind 1s with
 * NIP-22 comments. Our thread pipeline fetched kinds:[1] and dropped 1111 on
 * arrival, so Amethyst users' replies were invisible in threads.
 */
import { describe, expect, it } from "vitest";
import { replyTargetOf, threadRootOf, THREAD_REPLY_KINDS } from "./reply-target";

const ROOT = "a".repeat(64);
const PARENT = "b".repeat(64);
const PK = "c".repeat(64);

const nip22Reply = (tags: string[][]) => ({ kind: 1111, tags }) as never;
const nip10Reply = (tags: string[][]) => ({ kind: 1, tags }) as never;

describe("NIP-22 comments (kind 1111)", () => {
  it("parent is the lowercase e, root is the uppercase E", () => {
    const ev = nip22Reply([
      ["E", ROOT, "wss://r.example", PK],
      ["K", "1"],
      ["P", PK],
      ["e", PARENT, "wss://r.example", PK],
      ["k", "1"],
      ["p", PK],
    ]);
    expect(replyTargetOf(ev)).toBe(PARENT);
    expect(threadRootOf(ev)).toBe(ROOT);
  });

  it("a top-level comment (e == E) targets the root", () => {
    const ev = nip22Reply([
      ["E", ROOT, "", PK],
      ["e", ROOT, "", PK],
    ]);
    expect(replyTargetOf(ev)).toBe(ROOT);
    expect(threadRootOf(ev)).toBe(ROOT);
  });

  it("never mistakes the NIP-22 pubkey slot for a NIP-10 marker", () => {
    // 4th element is a pubkey here; NIP-10 logic reading it as a marker
    // would find no "reply" tag and could walk the wrong branch.
    const ev = nip22Reply([
      ["E", ROOT, "", "reply"], // pathological: pubkey slot spells "reply"
      ["e", PARENT, "", "reply"],
    ]);
    expect(replyTargetOf(ev)).toBe(PARENT);
    expect(threadRootOf(ev)).toBe(ROOT);
  });
});

describe("NIP-10 replies (kind 1) — behavior preserved", () => {
  it("marked reply wins", () => {
    const ev = nip10Reply([
      ["e", ROOT, "", "root"],
      ["e", PARENT, "", "reply"],
    ]);
    expect(replyTargetOf(ev)).toBe(PARENT);
    expect(threadRootOf(ev)).toBe(ROOT);
  });

  it("root-only reply targets the root", () => {
    const ev = nip10Reply([["e", ROOT, "", "root"]]);
    expect(replyTargetOf(ev)).toBe(ROOT);
  });

  it("legacy unmarked ordering: last e is the parent, first is the root", () => {
    const ev = nip10Reply([["e", ROOT], ["e", PARENT]]);
    expect(replyTargetOf(ev)).toBe(PARENT);
    expect(threadRootOf(ev)).toBe(ROOT);
  });

  it("a plain post is not a reply", () => {
    expect(replyTargetOf(nip10Reply([]))).toBeNull();
    expect(threadRootOf(nip10Reply([]))).toBeNull();
  });
});

describe("THREAD_REPLY_KINDS", () => {
  it("names both reply generations for thread fetches", () => {
    expect(THREAD_REPLY_KINDS).toContain(1);
    expect(THREAD_REPLY_KINDS).toContain(1111);
  });
});
