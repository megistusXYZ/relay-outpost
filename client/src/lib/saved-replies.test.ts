import { describe, it, expect } from "vitest";
import { parseSavedReplies, savedRepliesText, STARTER_REPLIES, SAVED_REPLIES_D } from "./saved-replies";

describe("saved replies (one-tap answers for operators, encrypted to you)", () => {
  it("nothing saved yet: four starters", () => {
    expect(parseSavedReplies(null)).toEqual(STARTER_REPLIES);
    expect(STARTER_REPLIES.map((r) => r.text)).toEqual([
      "Thanks — we're looking into it.",
      "Fixed in the latest update. Let us know if you still see it.",
      "Could you tell us which device and browser you're using?",
      "Thanks for the idea — we've added it to our list.",
    ]);
  });

  it("what you saved comes back as you saved it — including none at all", () => {
    const mine = [{ id: "a", text: "We're down for maintenance until 3pm." }];
    expect(parseSavedReplies(savedRepliesText(mine))).toEqual(mine);
    expect(parseSavedReplies(savedRepliesText([]))).toEqual([]);
  });

  it("blank ones are dropped; anything unreadable falls back to the starters", () => {
    expect(savedRepliesText([{ id: "a", text: "  " }, { id: "b", text: " ok " }])).toBe(JSON.stringify({ v: 1, replies: [{ id: "b", text: "ok" }] }));
    expect(parseSavedReplies("not json")).toEqual(STARTER_REPLIES);
    expect(parseSavedReplies(JSON.stringify({ v: 1, replies: [{ id: 5 }] }))).toEqual([]);
  });

  it("lives at one address per person", () => {
    expect(SAVED_REPLIES_D).toBe("relay-outpost:saved-replies");
  });
});
