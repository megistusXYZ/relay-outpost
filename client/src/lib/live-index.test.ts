import { describe, it, expect } from "vitest";
import { indexLiveByPubkey, dedupeByAddress, claimantsOf, streamKey } from "./live-index";
import type { LiveEventData } from "./live-events";

const PLATFORM = "aa".repeat(32);   // zap.stream-style publishing account
const ALICE = "bb".repeat(32);      // the human actually streaming
const BOB = "cc".repeat(32);
const SOLO = "dd".repeat(32);       // streams from their own key

function stream(
  opts: { author: string; d: string; at: number; hosts?: string[]; title?: string },
): LiveEventData {
  return {
    id: `${opts.author}-${opts.d}`,
    pubkey: opts.author,
    dTag: opts.d,
    title: opts.title ?? opts.d,
    summary: "",
    status: "live",
    hashtags: [],
    participants: (opts.hosts ?? []).map((pubkey) => ({ pubkey, role: "host" })),
    relays: [],
    chatEnabled: true,
    isZapStream: false,
    event: { created_at: opts.at } as LiveEventData["event"],
  } as LiveEventData;
}

describe("who counts as live", () => {
  it("lights up the HOST, not just the platform that published the event", () => {
    // The bug this whole module exists for: Alice streams through zap.stream, so
    // the kind-30311 is authored by the platform and Alice is a `p` host. Keyed
    // on the author alone, Alice looks offline on her own profile while she is
    // visibly broadcasting.
    const idx = indexLiveByPubkey([stream({ author: PLATFORM, d: "alice", at: 100, hosts: [ALICE] })]);
    expect(idx.has(ALICE)).toBe(true);
    expect(idx.get(ALICE)!.dTag).toBe("alice");
  });

  it("still lights up the platform account itself", () => {
    // It genuinely is broadcasting. Fixing the host case must not steal that.
    const idx = indexLiveByPubkey([stream({ author: PLATFORM, d: "alice", at: 100, hosts: [ALICE] })]);
    expect(idx.has(PLATFORM)).toBe(true);
  });

  it("keeps every concurrent stream a platform is hosting", () => {
    // The second bug, and the one that hid the first: kind 30311 is ADDRESSABLE
    // (author + d). Deduping by author alone left one stream standing and threw
    // away the rest — including the ones whose hosts we now need.
    const idx = indexLiveByPubkey([
      stream({ author: PLATFORM, d: "alice", at: 100, hosts: [ALICE] }),
      stream({ author: PLATFORM, d: "bob", at: 101, hosts: [BOB] }),
    ]);
    expect(idx.has(ALICE)).toBe(true);
    expect(idx.has(BOB)).toBe(true);
  });

  it("works when someone streams from their own key with no host tag", () => {
    const idx = indexLiveByPubkey([stream({ author: SOLO, d: "solo", at: 100 })]);
    expect(idx.has(SOLO)).toBe(true);
  });

  it("treats a later event for the same address as an update, not a second stream", () => {
    const out = dedupeByAddress([
      stream({ author: PLATFORM, d: "alice", at: 100, title: "old" }),
      stream({ author: PLATFORM, d: "alice", at: 200, title: "new" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("new");
  });

  it("gives a host fronting two streams the most recent one", () => {
    const idx = indexLiveByPubkey([
      stream({ author: PLATFORM, d: "early", at: 100, hosts: [ALICE] }),
      stream({ author: PLATFORM, d: "later", at: 500, hosts: [ALICE] }),
    ]);
    expect(idx.get(ALICE)!.dTag).toBe("later");
  });

  it("names both the author and the hosts as claimants, without duplicates", () => {
    expect(claimantsOf(stream({ author: PLATFORM, d: "x", at: 1, hosts: [ALICE, BOB] })))
      .toEqual([PLATFORM, ALICE, BOB]);
    // Self-hosted: author and host are the same person, listed once.
    expect(claimantsOf(stream({ author: SOLO, d: "x", at: 1, hosts: [SOLO] }))).toEqual([SOLO]);
  });

  it("keys a stream by author AND d — the addressable identity", () => {
    // If this ever collapses to the author, concurrent streams start eating each
    // other again and the host index goes quiet for everyone but the last one.
    expect(streamKey(stream({ author: PLATFORM, d: "one", at: 1 })))
      .not.toBe(streamKey(stream({ author: PLATFORM, d: "two", at: 1 })));
  });
});
