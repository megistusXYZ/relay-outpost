/**
 * Honouring deletions in the server's samples (owner, 2026-10-11): a post its
 * author deleted never reaches the first screen or Discover. Only the author's
 * own deletion counts; one naming someone else's post is ignored.
 */
import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { dropDeleted, deletionAsk } from "./deletions";

const hex = (c: string, n = 64) => c.repeat(n);
const aliceSk = generateSecretKey(), mallorySk = generateSecretKey();
const ALICE = getPublicKey(aliceSk), MALLORY = getPublicKey(mallorySk);
const keyOf = (pk: string) => (pk === ALICE ? aliceSk : mallorySk);
const note = (id: string, pubkey: string) => ({ id: hex(id), pubkey, kind: 1, created_at: 10, tags: [], content: "x", sig: hex("f", 128) });
const article = (id: string, pubkey: string, d: string) => ({ id: hex(id), pubkey, kind: 30023, created_at: 10, tags: [["d", d]], content: "x", sig: hex("f", 128) });
const del = (pubkey: string, tags: string[][]) => finalizeEvent({ kind: 5, created_at: 20, tags, content: "" }, keyOf(pubkey));

describe("dropDeleted", () => {
  it("drops a post its author deleted, by id", () => {
    const kept = dropDeleted([note("1", ALICE), note("2", ALICE)], [del(ALICE, [["e", hex("1")]])]);
    expect(kept.map((e) => e.id)).toEqual([hex("2")]);
  });
  it("drops an addressable event its author deleted, by address", () => {
    const kept = dropDeleted([article("3", ALICE, "hello"), article("4", ALICE, "other")], [del(ALICE, [["a", `30023:${ALICE}:hello`]])]);
    expect(kept.map((e) => e.id)).toEqual([hex("4")]);
  });
  it("ignores a deletion that names someone else's post", () => {
    const kept = dropDeleted([note("1", ALICE)], [del(MALLORY, [["e", hex("1")]])]);
    expect(kept.map((e) => e.id)).toEqual([hex("1")]);
  });
  it("ignores anything that is not a well-formed, properly signed kind 5", () => {
    // Built field by field: a spread would carry nostr-tools' "already verified" mark along.
    const real = del(ALICE, [["e", hex("1")]]);
    const forged = { id: real.id, pubkey: real.pubkey, kind: 5, created_at: real.created_at, tags: real.tags, content: "", sig: hex("f", 128) };
    const kept = dropDeleted([note("1", ALICE)], [{ ...del(ALICE, [["e", hex("1")]]), kind: 1 }, { kind: 5, pubkey: ALICE, tags: [["e", hex("1")]] }, forged]);
    expect(kept.map((e) => e.id)).toEqual([hex("1")]);
  });
});

describe("deletionAsk", () => {
  it("asks for the deletions of the authors of what was read, once each", () => {
    expect(deletionAsk([note("1", ALICE), note("2", ALICE), note("3", MALLORY)])).toEqual({ kinds: [5], authors: [ALICE, MALLORY], limit: 500 });
  });
  it("asks nothing when nothing was read", () => {
    expect(deletionAsk([])).toBeNull();
  });
});
