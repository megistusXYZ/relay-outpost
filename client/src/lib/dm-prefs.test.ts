import { describe, it, expect } from "vitest";
import {
  EMPTY_PREFS, MAX_PINNED, TIMER_OPTIONS, expirationFor, isMutedChat, isPinned, parsePrefs, pinnedFirst,
  setMutedChat, setPinned, setTimer, timerLabel, timerOf, marksAfter, mergeMarks, prefsFromMarks, backfilledMarks, type DmPrefMarks, type DmPrefs } from "./dm-prefs";

const ALICE = "b".repeat(64);
const GROUP = "group:" + "b".repeat(64) + "," + "c".repeat(64);

describe("pinned chats", () => {
  it("a pinned chat leads the list; the rest keep their order", () => {
    const chats = [{ pubkey: "newest" }, { pubkey: "middle" }, { pubkey: ALICE }];
    expect(pinnedFirst(chats, setPinned(EMPTY_PREFS, ALICE, true)).map((c) => c.pubkey)).toEqual([ALICE, "newest", "middle"]);
  });

  it("the most recently pinned comes first", () => {
    let p = setPinned(EMPTY_PREFS, "a", true);
    p = setPinned(p, "b", true);
    expect(pinnedFirst([{ pubkey: "a" }, { pubkey: "b" }, { pubkey: "c" }], p).map((c) => c.pubkey)).toEqual(["b", "a", "c"]);
  });

  it("unpinning puts it back where its messages place it", () => {
    const p = setPinned(setPinned(EMPTY_PREFS, ALICE, true), ALICE, false);
    expect(isPinned(p, ALICE)).toBe(false);
    expect(pinnedFirst([{ pubkey: "x" }, { pubkey: ALICE }], p).map((c) => c.pubkey)).toEqual(["x", ALICE]);
  });

  it("pinning twice is one pin", () => {
    expect(setPinned(setPinned(EMPTY_PREFS, ALICE, true), ALICE, true).pinned).toEqual([ALICE]);
  });

  it("past the limit the oldest pin gives way — a pinned list longer than a screen pins nothing", () => {
    let p = EMPTY_PREFS;
    for (let i = 0; i <= MAX_PINNED; i++) p = setPinned(p, `chat${i}`, true);
    expect(p.pinned).toHaveLength(MAX_PINNED);
    expect(p.pinned[0]).toBe(`chat${MAX_PINNED}`);
    expect(p.pinned).not.toContain("chat0");
  });

  it("a pin for a chat that isn't in the list shows nothing (and breaks nothing)", () => {
    expect(pinnedFirst([{ pubkey: "x" }], setPinned(EMPTY_PREFS, "gone", true)).map((c) => c.pubkey)).toEqual(["x"]);
  });

  it("a several-person chat is pinned like any other", () => {
    expect(pinnedFirst([{ pubkey: ALICE }, { pubkey: GROUP }], setPinned(EMPTY_PREFS, GROUP, true))[0].pubkey).toBe(GROUP);
  });
});

describe("muted chats", () => {
  it("mute and unmute", () => {
    const muted = setMutedChat(EMPTY_PREFS, ALICE, true);
    expect(isMutedChat(muted, ALICE)).toBe(true);
    expect(isMutedChat(setMutedChat(muted, ALICE, false), ALICE)).toBe(false);
    expect(setMutedChat(muted, ALICE, true).muted).toEqual([ALICE]);
  });
});

describe("disappearing messages — a timer per chat, for MY messages", () => {
  it("off by default: a message has no expiry", () => {
    expect(timerOf(EMPTY_PREFS, ALICE)).toBe(0);
    expect(expirationFor(EMPTY_PREFS, ALICE, 1_790_000_000)).toBeUndefined();
  });

  it("with a timer, a message goes that long after it was written", () => {
    const p = setTimer(EMPTY_PREFS, ALICE, 3600);
    expect(expirationFor(p, ALICE, 1_790_000_000)).toBe(1_790_003_600);
  });

  it("the timer is this chat's only", () => {
    expect(expirationFor(setTimer(EMPTY_PREFS, ALICE, 3600), GROUP, 1_790_000_000)).toBeUndefined();
  });

  it("setting it to off removes it", () => {
    const p = setTimer(setTimer(EMPTY_PREFS, ALICE, 3600), ALICE, 0);
    expect(p.timers).toEqual({});
    expect(expirationFor(p, ALICE, 1)).toBeUndefined();
  });

  it("the choices are Off, 1 hour, 1 day and 1 week, and each reads back by name", () => {
    expect(TIMER_OPTIONS.map((o) => o.label)).toEqual(["Off", "1 hour", "1 day", "1 week"]);
    expect(timerLabel(86400)).toBe("1 day");
    expect(timerLabel(0)).toBe("");
  });
});

describe("what was stored, read back", () => {
  it("round-trips", () => {
    const p = setTimer(setMutedChat(setPinned(EMPTY_PREFS, ALICE, true), GROUP, true), ALICE, 86400);
    expect(parsePrefs(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("nothing stored, or rubbish, is no choices at all", () => {
    for (const raw of [null, undefined, "x", 3, []]) expect(parsePrefs(raw)).toEqual({ pinned: [], muted: [], timers: {} });
  });

  it("a damaged entry costs that entry, not the rest", () => {
    const p = parsePrefs({ pinned: [ALICE, 7, "", ALICE], muted: "nope", timers: { [ALICE]: 3600, bad: "soon", zero: 0, neg: -5 } });
    expect(p).toEqual({ pinned: [ALICE], muted: [], timers: { [ALICE]: 3600 } });
  });
});

describe("chat choices that follow you to your other devices", () => {
  const A = "aa".repeat(32), B = "bb".repeat(32), G = "group:x,y";
  const none: DmPrefs = { pinned: [], muted: [], timers: {} };

  it("a choice is remembered with when it was made", () => {
    const marks = marksAfter(none, setPinned(none, A, true), {}, 1000);
    expect(marks).toEqual({ [`pin:${A}`]: { v: 1, at: 1000 } });
  });

  it("only what changed is re-stamped", () => {
    const one = setPinned(none, A, true);
    const m1 = marksAfter(none, one, {}, 1000);
    const two = setMutedChat(one, B, true);
    const m2 = marksAfter(one, two, m1, 2000);
    expect(m2[`pin:${A}`]).toEqual({ v: 1, at: 1000 });
    expect(m2[`mute:${B}`]).toEqual({ v: 1, at: 2000 });
  });

  it("undoing a choice is remembered too, so another device can't bring it back", () => {
    const pinned = setPinned(none, A, true);
    const m1 = marksAfter(none, pinned, {}, 1000);
    const m2 = marksAfter(pinned, setPinned(pinned, A, false), m1, 2000);
    expect(m2[`pin:${A}`]).toEqual({ v: 0, at: 2000 });
    expect(prefsFromMarks(m2).pinned).toEqual([]);
  });

  it("a timer carries its length, and Off is a choice like any other", () => {
    const timed = setTimer(none, G, 3600);
    const m1 = marksAfter(none, timed, {}, 1000);
    expect(m1[`timer:${G}`]).toEqual({ v: 3600, at: 1000 });
    const m2 = marksAfter(timed, setTimer(timed, G, 0), m1, 2000);
    expect(prefsFromMarks(m2).timers).toEqual({});
  });

  it("two devices: for each choice, the later one wins — whichever side it is on", () => {
    const phone: DmPrefMarks = { [`pin:${A}`]: { v: 1, at: 100 }, [`mute:${B}`]: { v: 1, at: 500 } };
    const laptop: DmPrefMarks = { [`pin:${A}`]: { v: 0, at: 300 }, [`mute:${B}`]: { v: 0, at: 200 }, [`timer:${G}`]: { v: 86400, at: 50 } };
    const merged = mergeMarks(phone, laptop);
    expect(merged).toEqual(mergeMarks(laptop, phone));
    expect(prefsFromMarks(merged)).toEqual({ pinned: [], muted: [B], timers: { [G]: 86400 } });
  });

  it("merging the same thing twice changes nothing", () => {
    const m: DmPrefMarks = { [`pin:${A}`]: { v: 1, at: 100 } };
    expect(mergeMarks(mergeMarks(m, m), m)).toEqual(m);
  });

  it("pins come back in the order they were made, newest first, and never more than the limit", () => {
    const marks: DmPrefMarks = {};
    for (let i = 0; i < 7; i++) marks[`pin:chat${i}`] = { v: 1, at: 100 + i };
    expect(prefsFromMarks(marks).pinned).toEqual(["chat6", "chat5", "chat4", "chat3", "chat2"]);
  });

  it("choices made before this existed are kept, but give way to any dated choice", () => {
    const old = setTimer(setMutedChat(setPinned(none, A, true), B, true), G, 3600);
    const marks = backfilledMarks(old, {});
    expect(prefsFromMarks(marks)).toEqual(old);
    const remote: DmPrefMarks = { [`pin:${A}`]: { v: 0, at: 5000 } };
    expect(prefsFromMarks(mergeMarks(marks, remote)).pinned).toEqual([]);
  });

  it("damaged entries from another device are ignored", () => {
    const merged = mergeMarks({}, { "pin:x": { v: 1, at: "soon" }, "weird:y": { v: 1, at: 5 }, [`mute:${B}`]: null } as never);
    expect(merged).toEqual({});
  });
});
