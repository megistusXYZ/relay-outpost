import { describe, it, expect } from "vitest";
import {
  replyTag, replyToOf, reactionTags, reactionTargetOf, reactionEmoji,
  tallyReactions, replySnippet, QUICK_REACTIONS,
} from "./dm-thread";

const ME = "aa".repeat(32);
const ALICE = "bb".repeat(32);
const BOB = "cc".repeat(32);
const M1 = "11".repeat(32);
const M2 = "22".repeat(32);

describe("a reply in a private chat", () => {
  it("names the message it answers", () => {
    expect(replyToOf(14, [["p", ALICE], replyTag(M1)])).toBe(M1);
  });

  it("is read from other apps: a bare e tag, or one marked as the reply among several", () => {
    expect(replyToOf(14, [["p", ALICE], ["e", M1]])).toBe(M1);
    expect(replyToOf(14, [["e", M1, "wss://r", "root"], ["e", M2, "wss://r", "reply"]])).toBe(M2);
    expect(replyToOf(14, [["e", M1, "", "root"], ["e", M2]])).toBe(M2);
    expect(replyToOf(15, [["e", M1]])).toBe(M1);
  });

  it("a message that answers nothing has no parent", () => {
    expect(replyToOf(14, [["p", ALICE]])).toBeUndefined();
    expect(replyToOf(14, [["e", "not-an-id"]])).toBeUndefined();
  });

  it("a quoted public post is not a reply to a message", () => {
    expect(replyToOf(14, [["q", M1]])).toBeUndefined();
  });

  it("a reaction is not a reply", () => {
    expect(replyToOf(7, [["e", M1]])).toBeUndefined();
  });
});

describe("a reaction in a private chat", () => {
  it("points at the message it reacts to, and says that message is a chat message", () => {
    const tags = reactionTags(M1);
    expect(reactionTargetOf(tags)).toBe(M1);
    expect(tags).toContainEqual(["k", "14"]);
  });

  it("with several e tags, the last one is the message reacted to (NIP-25)", () => {
    expect(reactionTargetOf([["e", M1], ["e", M2]])).toBe(M2);
    expect(reactionTargetOf([["p", ALICE]])).toBeUndefined();
  });

  it("shows a plus or an empty reaction as a thumbs up, a minus as a thumbs down", () => {
    expect(reactionEmoji("+")).toBe("👍");
    expect(reactionEmoji("")).toBe("👍");
    expect(reactionEmoji("-")).toBe("👎");
    expect(reactionEmoji(" ❤️ ")).toBe("❤️");
  });

  it("does not let a long text pose as a reaction", () => {
    expect(reactionEmoji("this is a whole sentence, not an emoji")).toBeNull();
    expect(reactionEmoji(":party_parrot:")).toBe(":party_parrot:");
  });

  it("offers a short row of reactions to pick from", () => {
    expect(QUICK_REACTIONS.length).toBeGreaterThanOrEqual(5);
    expect(QUICK_REACTIONS.length).toBeLessThanOrEqual(7);
    expect(new Set(QUICK_REACTIONS).size).toBe(QUICK_REACTIONS.length);
  });
});

describe("the reactions shown under a message", () => {
  const r = (id: string, from: string, content: string, timestamp: number, reactsTo = M1) => ({ id, from, content, timestamp, reactsTo });

  it("are counted per emoji, in the order they first appeared", () => {
    const out = tallyReactions([r("a", ALICE, "❤️", 10), r("b", BOB, "👍", 20), r("c", ME, "❤️", 30)], ME);
    expect(out.get(M1)).toEqual([
      { emoji: "❤️", count: 2, mine: true, people: [ALICE, ME] },
      { emoji: "👍", count: 1, mine: false, people: [BOB] },
    ]);
  });

  it("one person has one reaction per message: their newest replaces the earlier one", () => {
    const out = tallyReactions([r("a", ALICE, "👍", 10), r("b", ALICE, "😂", 20)], ME);
    expect(out.get(M1)).toEqual([{ emoji: "😂", count: 1, mine: false, people: [ALICE] }]);
  });

  it("…whatever order they arrived in", () => {
    const out = tallyReactions([r("b", ALICE, "😂", 20), r("a", ALICE, "👍", 10)], ME);
    expect(out.get(M1)?.map((x) => x.emoji)).toEqual(["😂"]);
  });

  it("the same reaction delivered twice counts once", () => {
    const out = tallyReactions([r("a", ALICE, "👍", 10), r("a", ALICE, "👍", 10)], ME);
    expect(out.get(M1)).toEqual([{ emoji: "👍", count: 1, mine: false, people: [ALICE] }]);
  });

  it("are kept apart per message", () => {
    const out = tallyReactions([r("a", ALICE, "👍", 10, M1), r("b", ALICE, "👍", 11, M2)], ME);
    expect(out.get(M1)?.[0].count).toBe(1);
    expect(out.get(M2)?.[0].count).toBe(1);
  });

  it("a plus counts with the thumbs up, and text that is no reaction is left out", () => {
    const out = tallyReactions([r("a", ALICE, "+", 10), r("b", BOB, "👍", 11), r("c", ME, "what a long message this is, really", 12)], ME);
    expect(out.get(M1)).toEqual([{ emoji: "👍", count: 2, mine: false, people: [ALICE, BOB] }]);
  });
});

describe("the line that stands in for the message being answered", () => {
  it("is the message on one line, cut short", () => {
    expect(replySnippet({ content: "see you\nat nine" })).toBe("see you at nine");
    const long = replySnippet({ content: "x".repeat(300) });
    expect(long.length).toBeLessThanOrEqual(81);
    expect(long.endsWith("…")).toBe(true);
  });

  it("says what a file is instead of showing its address", () => {
    expect(replySnippet({ content: "https://files.example/a", fileMetadata: { mimeType: "image/jpeg" } })).toBe("Photo");
    expect(replySnippet({ content: "https://files.example/a", fileMetadata: { mimeType: "video/mp4" } })).toBe("Video");
    expect(replySnippet({ content: "https://files.example/a", fileMetadata: { mimeType: "audio/ogg" } })).toBe("Voice message");
    expect(replySnippet({ content: "https://files.example/a", fileMetadata: {} })).toBe("File");
  });
});
