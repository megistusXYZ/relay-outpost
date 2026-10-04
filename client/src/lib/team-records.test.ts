import { describe, it, expect } from "vitest";
import { recordTags, readRecord, foldTeam, TEAM_RUMOR_KIND, describeLogEntry } from "./team-records";

const RELAY = "wss://harbour.example";
const OWNER = "o".repeat(64).replace(/o/g, "a");
const MATE = "b".repeat(64), OTHER = "c".repeat(64), STRANGER = "d".repeat(64), SUBJECT = "e".repeat(64);
let n = 0;
const rumor = (pubkey: string, type: "roster" | "log" | "note", body: object, at: number, relay = RELAY, extra: string[][] = []) => ({
  id: String(++n).padStart(64, "0"), pubkey, kind: TEAM_RUMOR_KIND, created_at: at,
  tags: [...recordTags(type, relay), ...extra], content: JSON.stringify(body),
});

describe("a team record", () => {
  it("says which relay and what it is, in its tags", () => {
    expect(recordTags("note", RELAY)).toEqual([["d", "relay-outpost/team/note"], ["relay", RELAY]]);
  });

  it("is read back only for the relay it belongs to", () => {
    expect(readRecord(rumor(OWNER, "note", { about: SUBJECT, text: "hi" }, 1), RELAY)?.type).toBe("note");
    expect(readRecord(rumor(OWNER, "note", { about: SUBJECT, text: "hi" }, 1, "wss://elsewhere"), RELAY)).toBeNull();
  });

  it("ignores anything that isn't a team record", () => {
    expect(readRecord({ id: "x", pubkey: OWNER, kind: 14, created_at: 1, tags: [], content: "dm" }, RELAY)).toBeNull();
    expect(readRecord({ ...rumor(OWNER, "note", {}, 1), content: "not json" }, RELAY)).toBeNull();
  });
});

describe("the team, as everyone on it sees it", () => {
  it("is just you until a roster says otherwise", () => {
    expect(foldTeam([], { owner: OWNER, me: OWNER }).members).toEqual([OWNER]);
  });

  it("follows the owner's latest roster", () => {
    const t = foldTeam([
      rumor(OWNER, "roster", { members: [OWNER, MATE, OTHER] }, 10),
      rumor(OWNER, "roster", { members: [OWNER, MATE] }, 20),
    ], { owner: OWNER, me: OWNER });
    expect(t.members).toEqual([OWNER, MATE]);
  });

  it("never lets a teammate rewrite the roster", () => {
    const t = foldTeam([
      rumor(OWNER, "roster", { members: [OWNER, MATE] }, 10),
      rumor(MATE, "roster", { members: [MATE, STRANGER] }, 20),
    ], { owner: OWNER, me: MATE });
    expect(t.members).toEqual([OWNER, MATE]);
  });

  it("always keeps the owner on it", () => {
    expect(foldTeam([rumor(OWNER, "roster", { members: [MATE] }, 10)], { owner: OWNER, me: OWNER }).members).toEqual([OWNER, MATE]);
  });
});

describe("notes and the log", () => {
  const records = [
    rumor(OWNER, "roster", { members: [OWNER, MATE] }, 1),
    rumor(MATE, "note", { about: SUBJECT, text: "warned twice for spam" }, 5),
    rumor(OWNER, "note", { about: SUBJECT, text: "  " }, 6),
    rumor(STRANGER, "note", { about: SUBJECT, text: "planted" }, 7),
    rumor(MATE, "log", { action: "delete_event", targetPubkey: SUBJECT, note: "Spam" }, 8),
    rumor(OWNER, "log", { action: "block_author", targetPubkey: SUBJECT }, 9),
  ];
  const t = foldTeam(records, { owner: OWNER, me: OWNER });

  it("notes about a person, newest first, from people on the team only", () => {
    expect(t.notesAbout(SUBJECT).map((x) => [x.author, x.text])).toEqual([[MATE, "warned twice for spam"]]);
  });

  it("the shared log, newest first, from people on the team only", () => {
    expect(t.log.map((x) => [x.author, x.action])).toEqual([[OWNER, "block_author"], [MATE, "delete_event"]]);
  });

  it("each log entry reads as a sentence", () => {
    expect(describeLogEntry({ action: "delete_event", count: undefined, note: "Spam" })).toBe("Removed a post · Spam");
    expect(describeLogEntry({ action: "bulk_delete", count: 32 })).toBe("Removed 32 posts");
    expect(describeLogEntry({ action: "block_author" })).toBe("Banned someone");
    expect(describeLogEntry({ action: "remove_blocklist" })).toBe("Lifted a ban");
  });
});

// ---- the log's "on this device only" part shows only what the team log doesn't have ----
import { deviceOnlyEntries } from "./team-records";

describe("deviceOnlyEntries", () => {
  const T = 1_800_000_000; // seconds
  const team = [{ id: "t1", author: "me", at: T, action: "block_author", targetPubkey: "carol" }];
  it("leaves out what was also written to the team log (no ban shown twice)", () => {
    const local = [{ id: "l1", ts: T * 1000 + 400, action: "block_author" as const, targetPubkey: "carol" }];
    expect(deviceOnlyEntries(local, team)).toEqual([]);
  });
  it("keeps an entry the team log never got (its write failed)", () => {
    const local = [{ id: "l1", ts: T * 1000, action: "delete_event" as const, targetEventId: "x" }];
    expect(deviceOnlyEntries(local, team).map((e) => e.id)).toEqual(["l1"]);
  });
  it("keeps what only this device knows: before the team log existed, or a different action", () => {
    const older = { id: "l0", ts: (T - 86_400) * 1000, action: "block_author" as const, targetPubkey: "carol" };
    const other = { id: "l2", ts: T * 1000, action: "delete_event" as const, targetEventId: "post" };
    expect(deviceOnlyEntries([older, other], team).map((e) => e.id)).toEqual(["l0", "l2"]);
  });
  it("never lists the relay's own health checks (offline/online) as moderation", () => {
    expect(deviceOnlyEntries([{ id: "h", ts: 1, action: "relay_offline" as const }], [])).toEqual([]);
  });
});
