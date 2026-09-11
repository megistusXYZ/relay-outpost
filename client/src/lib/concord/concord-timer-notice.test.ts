/**
 * The line in the room when someone changes the timer (CORD-08 §4): "Alice set
 * disappearing messages to 7 days". It is informational, and believed only
 * from someone who may change the group's settings: anyone can spell a tag.
 */
import { describe, it, expect } from "vitest";
import { buildTimerNotice, timerNoticeText, believableTimerNotice, stampExpiration } from "./concord-disappearing";
import { foldEditions, serializePermissions, VSK, PERM, type ControlEdition } from "./concord-events";

const hx = (b: string) => b.repeat(32);
const owner = hx("0a"), editor = hx("0b"), member = hx("0c"), room = hx("c3");
const ed = (vsk: number, eid: string, content: unknown, rumorId: string): ControlEdition =>
  ({ vsk, eid, ev: 1, rumorId, pubkey: owner, content: JSON.stringify(content) });
const state = foldEditions([
  ed(VSK.ROLE, hx("e1"), { role_id: "editor", name: "Editor", position: 5, permissions: serializePermissions(PERM.MANAGE_METADATA) }, "r1"),
  ed(VSK.GRANT, editor, { member: editor, role_ids: ["editor"] }, "r2"),
], owner);

describe("the timer notice", () => {
  it("is a kind 1740 bound to the room, carrying the new value, and never itself expires", () => {
    const n = buildTimerNotice(editor, room, 2n, 604800, 5, 1000);
    expect(n).toMatchObject({ kind: 1740, pubkey: editor, created_at: 1000, content: "" });
    expect(n.tags).toEqual(expect.arrayContaining([["channel", room], ["epoch", "2"], ["timer", "604800"]]));
    expect(stampExpiration(n, 86400).tags.some((t) => t[0] === "expiration")).toBe(false);
  });

  it("reads plainly", () => {
    expect(timerNoticeText(86400)).toBe("set disappearing messages to 1 day");
    expect(timerNoticeText(604800)).toBe("set disappearing messages to 7 days");
    expect(timerNoticeText(2592000)).toBe("set disappearing messages to 30 days");
    expect(timerNoticeText(0)).toBe("turned off disappearing messages");
  });

  it("is shown only from the owner or someone who may change the group's settings", () => {
    expect(believableTimerNotice(buildTimerNotice(owner, room, 0n, 86400, 0, 1), state, owner)).toBe(true);
    expect(believableTimerNotice(buildTimerNotice(editor, room, 0n, 86400, 0, 1), state, owner)).toBe(true);
    expect(believableTimerNotice(buildTimerNotice(member, room, 0n, 86400, 0, 1), state, owner)).toBe(false);
  });
});

describe("the lines a room shows", () => {
  it("come from believable notices only, with the new value and the notice's own time", async () => {
    const { timerLines } = await import("./concord-disappearing");
    const lines = timerLines([
      { ...buildTimerNotice(editor, room, 0n, 604800, 250, 2000), id: "a" },
      { ...buildTimerNotice(member, room, 0n, 0, 0, 3000), id: "b" },
    ], state, owner);
    expect(lines).toEqual([{ pubkey: editor, action: "timer", t: 2_000_250, timer: 604800 }]);
  });
});
