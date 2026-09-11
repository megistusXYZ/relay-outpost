/**
 * Reporting a message to a group's moderators (Relay Outpost's own; not in the
 * spec). A report is NIP-56-shaped (kind 1984) and goes privately, gift-wrapped,
 * to each moderator: the owner and anyone who can remove people. Never to the
 * person reported, never back to the reporter.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
});
vi.stubGlobal("window", { dispatchEvent: () => true });

import { PERM, type Member } from "./concord-events";
import { reportRecipients, reportTags, parseReport, stashReport, listReports, dismissReport, type GroupReport } from "./concord-reports";

const hex = (c: string) => c.repeat(64);
const OWNER = hex("0"), MOD = hex("1"), CLEANER = hex("2"), MEMBER = hex("3"), AUTHOR = hex("4"), ME = hex("5");
const CID = hex("c"), ROOM = hex("d"), MSG = hex("e");
const m = (pubkey: string, permissions = 0n, rank = 3): Member => ({ pubkey, joinedAt: 0, roleIds: [], permissions, rank });

describe("who a report goes to", () => {
  const roster = [m(OWNER, 0n, 0), m(MOD, PERM.KICK | PERM.BAN, 1), m(CLEANER, PERM.MANAGE_MESSAGES, 2), m(MEMBER), m(AUTHOR, PERM.BAN, 1), m(ME)];

  // Reports land in Manage's Reports section, which is for people who can
  // remove members; they go only to people who will see them there.
  it("the owner and everyone who can remove people", () => {
    expect(reportRecipients(roster, OWNER, MEMBER, hex("9")).sort()).toEqual([OWNER, MOD, AUTHOR].sort());
  });

  it("never the person reported, and never back to the reporter", () => {
    expect(reportRecipients(roster, OWNER, MOD, AUTHOR)).toEqual([OWNER]);
  });

  it("still reaches the owner when the roster hasn't loaded", () => {
    expect(reportRecipients([], OWNER, ME, AUTHOR)).toEqual([OWNER]);
  });
});

describe("what a report says", () => {
  const sent = { communityId: CID, channelId: ROOM, msgId: MSG, author: AUTHOR, reason: "spam" as const, snippet: "buy cheap coins at example.com" };

  it("names the message, its author and the reason the NIP-56 way, and where it was", () => {
    expect(reportTags(sent)).toEqual([
      ["e", MSG, "spam"], ["p", AUTHOR, "spam"], ["concord", CID, ROOM], ["snippet", "buy cheap coins at example.com"],
    ]);
  });

  it("reads back what was sent, with the reporter and their note", () => {
    const r = parseReport({ senderPubkey: ME, content: "  keeps posting this  ", timestamp: 1000, rumorId: hex("a"), tags: reportTags(sent) });
    expect(r).toEqual({
      id: hex("a"), reporter: ME, at: 1000, communityId: CID, channelId: ROOM, msgId: MSG, author: AUTHOR,
      reason: "spam", note: "keeps posting this", snippet: "buy cheap coins at example.com",
    });
  });

  it("keeps quotes and notes short, and an unknown reason reads as 'other'", () => {
    const r = parseReport({
      senderPubkey: ME, content: "n".repeat(900), timestamp: 1, rumorId: hex("b"),
      tags: [["e", MSG, "weird"], ["p", AUTHOR, "weird"], ["concord", CID, ROOM], ["snippet", "s".repeat(900)]],
    })!;
    expect(r.reason).toBe("other");
    expect(r.note.length).toBeLessThanOrEqual(500);
    expect(r.snippet.length).toBeLessThanOrEqual(280);
    expect(reportTags({ ...sent, snippet: "s".repeat(900) })[3][1].length).toBeLessThanOrEqual(280);
  });

  it("refuses anything that doesn't name a real group, room, message and author", () => {
    expect(parseReport({ senderPubkey: ME, content: "", timestamp: 1, rumorId: hex("a"), tags: [["e", "nope"], ["p", AUTHOR], ["concord", CID, ROOM]] })).toBeNull();
    expect(parseReport({ senderPubkey: ME, content: "", timestamp: 1, rumorId: hex("a"), tags: [["e", MSG], ["p", AUTHOR]] })).toBeNull();
  });
});

describe("the reports a moderator has", () => {
  beforeEach(() => __store.clear());
  const report = (id: string, at: number, communityId = CID): GroupReport =>
    ({ id, reporter: ME, at, communityId, channelId: ROOM, msgId: MSG, author: AUTHOR, reason: "spam", note: "", snippet: "x" });

  it("keeps each report once, newest first, per group", () => {
    expect(stashReport(OWNER, report(hex("1"), 100))).toBe(true);
    expect(stashReport(OWNER, report(hex("1"), 100))).toBe(false);
    stashReport(OWNER, report(hex("2"), 200));
    stashReport(OWNER, report(hex("3"), 300, hex("f")));
    expect(listReports(OWNER, CID).map((r) => r.id)).toEqual([hex("2"), hex("1")]);
  });

  it("a dismissed report stays dismissed, even if it arrives again", () => {
    stashReport(OWNER, report(hex("1"), 100));
    dismissReport(OWNER, hex("1"));
    expect(listReports(OWNER, CID)).toEqual([]);
    expect(stashReport(OWNER, report(hex("1"), 100))).toBe(false);
  });

  it("keeps each account's reports apart", () => {
    stashReport(OWNER, report(hex("1"), 100));
    expect(listReports(MOD, CID)).toEqual([]);
  });
});
