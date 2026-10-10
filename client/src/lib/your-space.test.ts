/**
 * "Your space" (owner, 2026-10-10): while a new account's wider network is
 * off, the people in its space are the people it follows. Everyone else
 * can still reach it through the floor relays — a stranger's message, a
 * bot's mention — so what reaches the account's attention is decided
 * here: a stranger's chat goes to Requests, not Primary, even if the
 * stranger followed first (the bot pattern); outside interactions fold
 * away and never raise a badge. With the wider network on (or for any
 * account from before the switch) every rule is exactly what it was.
 */
import { describe, it, expect } from "vitest";
import { inYourSpace, dmLandsInPrimary, badgeCountsNotification, badgeCountsChat, splitOutsideYourSpace } from "./your-space";

const ME = "me".padEnd(64, "0");
const FRIEND = "f".repeat(64);
const STRANGER = "s".repeat(64);
const BOT = "b".repeat(64);
const off = { widerNetworkOn: false, follows: new Set([FRIEND]) };
const on = { widerNetworkOn: true, follows: new Set([FRIEND]) };

describe("inYourSpace", () => {
  it("off: the people you follow, nobody else", () => {
    expect(inYourSpace(off, FRIEND)).toBe(true);
    expect(inYourSpace(off, STRANGER)).toBe(false);
  });
  it("on: everyone", () => {
    expect(inYourSpace(on, STRANGER)).toBe(true);
  });
});

describe("dmLandsInPrimary", () => {
  const base = { demoted: new Set<string>(), promoted: new Set<string>(), initiatedByMe: new Set<string>(), followedBy: new Set<string>(), tierOf: () => "none" as const };
  it("off: a stranger who followed first still lands in Requests (the bot pattern)", () => {
    expect(dmLandsInPrimary({ ...base, space: off, members: [BOT], followedBy: new Set([BOT]) })).toBe(false);
  });
  it("off: a well-scored stranger still lands in Requests", () => {
    expect(dmLandsInPrimary({ ...base, space: off, members: [STRANGER], tierOf: () => "strong" })).toBe(false);
  });
  it("off: someone you follow, someone you wrote to first, or someone you moved to Primary lands in Primary", () => {
    expect(dmLandsInPrimary({ ...base, space: off, members: [FRIEND] })).toBe(true);
    expect(dmLandsInPrimary({ ...base, space: off, members: [STRANGER], initiatedByMe: new Set([STRANGER]) })).toBe(true);
    expect(dmLandsInPrimary({ ...base, space: off, members: [STRANGER], promoted: new Set([STRANGER]) })).toBe(true);
  });
  it("on: today's rule — a follower or a well-scored person lands in Primary", () => {
    expect(dmLandsInPrimary({ ...base, space: on, members: [BOT], followedBy: new Set([BOT]) })).toBe(true);
    expect(dmLandsInPrimary({ ...base, space: on, members: [STRANGER], tierOf: () => "moderate" })).toBe(true);
    expect(dmLandsInPrimary({ ...base, space: on, members: [STRANGER] })).toBe(false);
  });
  it("either way: a chat you moved to Requests stays there", () => {
    expect(dmLandsInPrimary({ ...base, space: on, members: [FRIEND], demoted: new Set([FRIEND]) })).toBe(false);
    expect(dmLandsInPrimary({ ...base, space: off, members: [FRIEND], demoted: new Set([FRIEND]) })).toBe(false);
  });
});

describe("badgeCountsNotification — what may raise the Activity badge", () => {
  it("off: only people in your space; a bot's mention never does", () => {
    expect(badgeCountsNotification(off, FRIEND)).toBe(true);
    expect(badgeCountsNotification(off, BOT)).toBe(false);
  });
  it("off: an item without a sender (a ticket, an accepted join) still counts", () => {
    expect(badgeCountsNotification(off, undefined)).toBe(true);
  });
  it("on: everyone counts, as before", () => {
    expect(badgeCountsNotification(on, BOT)).toBe(true);
  });
});

describe("badgeCountsChat — what may raise the Chats badge", () => {
  it("off: people you follow or moved to Primary; a stranger's request never does", () => {
    expect(badgeCountsChat(off, FRIEND, new Set())).toBe(true);
    expect(badgeCountsChat(off, STRANGER, new Set([STRANGER]))).toBe(true);
    expect(badgeCountsChat(off, STRANGER, new Set())).toBe(false);
  });
  it("on: every chat counts, as before", () => {
    expect(badgeCountsChat(on, STRANGER, new Set())).toBe(true);
  });
});

describe("splitOutsideYourSpace", () => {
  const items = [{ from: FRIEND, id: 1 }, { from: STRANGER, id: 2 }, { from: undefined, id: 3 }];
  it("off: strangers' items fold away; senderless items stay", () => {
    const { inside, outside } = splitOutsideYourSpace(items, off, (i) => i.from);
    expect(inside.map((i) => i.id)).toEqual([1, 3]);
    expect(outside.map((i) => i.id)).toEqual([2]);
  });
  it("on: nothing folds", () => {
    const { inside, outside } = splitOutsideYourSpace(items, on, (i) => i.from);
    expect(inside).toHaveLength(3);
    expect(outside).toHaveLength(0);
  });
});
