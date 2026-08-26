/**
 * "Communities they're in" on a profile (lib/profile-communities.ts).
 *
 * The adoption surface: a subject's PUBLIC kind-10009 groups list, reduced to
 * outpost-level rows with the viewer's shared communities ranked first — the
 * Discord-mutual-servers moment, built only from data the subject already
 * published. Deliberately NOT the NIP-65 relay list: that's infrastructure
 * (damus/nos.lol-class), and "add nos.lol as a community" is noise.
 *
 * Wire subtlety pinned here: a whole-outpost join publishes bare `r` tags
 * (no rooms), while room joins publish `group` tags — reading only `group`
 * (as parseSimpleGroupsList does) would erase outpost-only memberships.
 */
import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { subjectCommunityRows } from "./profile-communities";

const list = (tags: string[][]): Event => ({
  id: "l", pubkey: "subject", kind: 10009, tags, content: "", created_at: 1, sig: "",
});

describe("subjectCommunityRows", () => {
  it("reads BOTH group tags and bare r tags, deduped to one row per outpost", () => {
    const rows = subjectCommunityRows(list([
      ["group", "room-a", "wss://one.example"],
      ["group", "room-b", "wss://one.example/"],
      ["r", "wss://one.example"],
      ["r", "wss://two.example"],
    ]), new Set());
    expect(rows.map((r) => r.url)).toEqual(["wss://one.example", "wss://two.example"]);
  });

  it("ranks the viewer's shared communities first and flags them", () => {
    const rows = subjectCommunityRows(list([
      ["r", "wss://only-theirs.example"],
      ["r", "wss://shared.example"],
    ]), new Set(["wss://shared.example"]));
    expect(rows[0]).toMatchObject({ url: "wss://shared.example", shared: true });
    expect(rows[1]).toMatchObject({ url: "wss://only-theirs.example", shared: false });
  });

  it("caps at six rows and drops non-ws garbage", () => {
    const tags: string[][] = [["r", "https://not-a-relay.example"], ["r", "not a url"]];
    for (let i = 0; i < 9; i++) tags.push(["r", `wss://r${i}.example`]);
    const rows = subjectCommunityRows(list(tags), new Set());
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.url.startsWith("wss://"))).toBe(true);
  });

  it("null/wrong-kind events claim nothing", () => {
    expect(subjectCommunityRows(null, new Set())).toEqual([]);
    expect(subjectCommunityRows({ ...list([["r", "wss://x.example"]]), kind: 3 }, new Set())).toEqual([]);
  });
});
