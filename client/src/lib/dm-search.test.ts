import { describe, it, expect } from "vitest";
import { searchMessages, MIN_QUERY } from "./dm-search";

const ME = "aa".repeat(32);
const ALICE = "bb".repeat(32);
const BOB = "cc".repeat(32);
const m = (id: string, peerPubkey: string, content: string, timestamp: number, extra: object = {}) =>
  ({ id, peerPubkey, content, from: peerPubkey.startsWith("group:") ? BOB : peerPubkey, timestamp, ...extra });

const corpus = [
  m("1", ALICE, "The door code is 4471", 100),
  m("2", ALICE, "see you at the DOOR at nine", 300),
  m("3", BOB, "nothing to see here", 200),
  m("4", `group:${ALICE},${BOB}`, "who has the door key?", 400),
];

describe("searching the messages this device has opened", () => {
  it("finds a word whatever its case, newest message first", () => {
    const out = searchMessages(corpus, "door");
    expect(out.hits.map((h) => h.id)).toEqual(["4", "2", "1"]);
  });

  it("says how many messages were looked through", () => {
    expect(searchMessages(corpus, "door").searched).toBe(4);
    expect(searchMessages(corpus, "zebra")).toEqual({ hits: [], searched: 4, more: 0 });
  });

  it("shows the words around the match, with the match set apart", () => {
    const hit = searchMessages(corpus, "code").hits[0];
    expect(hit.before + hit.match + hit.after).toBe("The door code is 4471");
    expect(hit.match).toBe("code");
    expect(hit.room).toBe(ALICE);
  });

  it("keeps the match as it was written", () => {
    expect(searchMessages(corpus, "door").hits.find((h) => h.id === "2")?.match).toBe("DOOR");
  });

  it("cuts a long message down to the part around the match", () => {
    const long = `${"a ".repeat(200)}needle ${"b ".repeat(200)}`;
    const hit = searchMessages([m("9", ALICE, long, 1)], "needle").hits[0];
    expect(hit.match).toBe("needle");
    expect(hit.before.length).toBeLessThanOrEqual(31);
    expect(hit.before.startsWith("…")).toBe(true);
    expect(hit.after.length).toBeLessThanOrEqual(81);
    expect(hit.after.endsWith("…")).toBe(true);
  });

  it("puts a match on one line", () => {
    const hit = searchMessages([m("9", ALICE, "first line\nthe needle\nlast line", 1)], "needle").hits[0];
    expect(hit.before + hit.match + hit.after).toBe("first line the needle last line");
  });

  it("needs at least two characters", () => {
    expect(MIN_QUERY).toBe(2);
    expect(searchMessages(corpus, "d").hits).toEqual([]);
    expect(searchMessages(corpus, "  ").hits).toEqual([]);
  });

  it("looks only in the chats it is given", () => {
    const out = searchMessages(corpus, "see", { rooms: new Set([ALICE]) });
    expect(out.hits.map((h) => h.id)).toEqual(["2"]);
    expect(out.searched).toBe(2);
  });

  it("does not match the address of a file, or a reaction", () => {
    const withFiles = [
      m("f", ALICE, "https://files.example/door.jpg", 500, { fileMetadata: { url: "https://files.example/door.jpg" } }),
      m("r", ALICE, "door", 600, { reactsTo: "1" }),
      ...corpus,
    ];
    const out = searchMessages(withFiles, "door");
    expect(out.hits.map((h) => h.id)).toEqual(["4", "2", "1"]);
    expect(out.searched).toBe(4);
  });

  it("stops at a limit and says how many more there are", () => {
    const many = Array.from({ length: 30 }, (_, i) => m(`x${i}`, ALICE, `door ${i}`, i));
    const out = searchMessages(many, "door", { limit: 20 });
    expect(out.hits).toHaveLength(20);
    expect(out.hits[0].id).toBe("x29");
    expect(out.more).toBe(10);
  });

  it("who wrote it is carried along", () => {
    expect(searchMessages([{ id: "1", peerPubkey: ALICE, content: "my own door", from: ME, timestamp: 1 }], "door").hits[0].from).toBe(ME);
  });
});
