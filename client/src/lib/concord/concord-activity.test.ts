import { describe, it, expect } from "vitest";
import { buildChatTimeline, firstUnreadIndex, computeMembershipEvents, computeAuditLog, seedGroupActivity, chatDayLabel, chatClockTime, chatRowMeta } from "./concord-activity";
import { buildAuditRumor, type AuditAction } from "./concord-events";

const msg = (id: string, t: number) => ({ id, t });
const jl = (id: string, pubkey: string, action: "join" | "leave", created_at: number) =>
  ({ id, pubkey, created_at, tags: [["action", action]] as string[][] });
const audit = (id: string, actor: string, action: AuditAction, created_at: number, opts?: { target?: string; reason?: string; detail?: string }) =>
  ({ ...buildAuditRumor(actor, action, created_at, opts), id });

describe("buildChatTimeline", () => {
  it("interleaves messages and system events in ascending time order", () => {
    const messages = [msg("m1", 100), msg("m2", 300)];
    const sys = [{ pubkey: "p1", action: "join" as const, t: 200 }];
    const tl = buildChatTimeline(messages, sys, true);
    expect(tl.map((i) => i.t)).toEqual([100, 200, 300]);
    expect(tl.map((i) => i.kind)).toEqual(["msg", "sys", "msg"]);
  });

  it("drops system events when includeSystem is false (non-default channel)", () => {
    const messages = [msg("m1", 100)];
    const sys = [{ pubkey: "p1", action: "leave" as const, t: 50 }];
    const tl = buildChatTimeline(messages, sys, false);
    expect(tl.map((i) => i.kind)).toEqual(["msg"]);
  });
});

describe("firstUnreadIndex", () => {
  const items = [{ t: 100 }, { t: 200 }, { t: 300 }];
  it("points at the first item strictly newer than the last-read mark", () => {
    expect(firstUnreadIndex(items, 200)).toBe(2);
  });
  it("returns -1 when the reader has no last-read mark (0)", () => {
    expect(firstUnreadIndex(items, 0)).toBe(-1);
  });
  it("returns -1 when nothing is newer than the last-read mark", () => {
    expect(firstUnreadIndex(items, 300)).toBe(-1);
  });
});

describe("computeMembershipEvents", () => {
  it("maps join/leave rumors newest-first with ms-precise times", () => {
    const events = computeMembershipEvents([jl("a", "p1", "join", 100), jl("b", "p2", "leave", 200)]);
    expect(events).toEqual([
      { pubkey: "p2", action: "leave", t: 200_000 },
      { pubkey: "p1", action: "join", t: 100_000 },
    ]);
  });
  it("treats any non-'leave' action as a join", () => {
    const weird = { id: "c", pubkey: "p3", created_at: 5, tags: [["action", "hello"]] as string[][] };
    expect(computeMembershipEvents([weird])[0].action).toBe("join");
  });
  it("dedups repeated rumors by id (same event from two relays)", () => {
    const events = computeMembershipEvents([jl("a", "p1", "join", 100), jl("a", "p1", "join", 100)]);
    expect(events).toHaveLength(1);
  });
});

describe("computeAuditLog", () => {
  it("parses moderation rumors newest-first, preserving reason", () => {
    const log = computeAuditLog([
      audit("a", "owner", "kick", 100, { target: "t1" }),
      audit("b", "owner", "ban", 200, { target: "t2", reason: "spam" }),
    ]);
    expect(log.map((e) => e.action)).toEqual(["ban", "kick"]);
    expect(log[0].reason).toBe("spam");
  });
  it("dedups repeated audit rumors by id", () => {
    const log = computeAuditLog([audit("a", "owner", "dissolve", 5), audit("a", "owner", "dissolve", 5)]);
    expect(log).toHaveLength(1);
  });
  it("drops malformed rumors that have no action tag", () => {
    const bad = { ...audit("c", "owner", "ban", 5), tags: [] as string[][] };
    expect(computeAuditLog([bad])).toHaveLength(0);
  });
});

describe("seedGroupActivity", () => {
  it("is the max of persisted, read marks, and addedAt", () => {
    expect(seedGroupActivity(1000, [500, 2000], 1500)).toBe(2000);
    expect(seedGroupActivity(3000, [500, 2000], 1500)).toBe(3000);
    expect(seedGroupActivity(1000, [500], 4000)).toBe(4000);
  });
  it("floors a long-quiet group to addedAt instead of epoch 0", () => {
    // No persisted clock, never read — the group must not sort to the bottom.
    expect(seedGroupActivity(0, [], 1720000000000)).toBe(1720000000000);
    expect(seedGroupActivity(0, [0, 0], 1720000000000)).toBe(1720000000000);
  });
  it("returns 0 when nothing is known", () => {
    expect(seedGroupActivity(0, [], 0)).toBe(0);
  });
  it("treats non-finite / negative inputs as unknown", () => {
    expect(seedGroupActivity(NaN, [Infinity, -5, NaN], 100)).toBe(100);
    expect(seedGroupActivity(-1, [], NaN)).toBe(0);
  });
  it("a single read mark can win over both floors", () => {
    expect(seedGroupActivity(10, [99], 50)).toBe(99);
  });
});

// ── Live-bug 3 + moderation system lines ─────────────────────────────────────
import { moderationSystemEvents, buildChatTimeline as buildTimeline2 } from "./concord-activity";
import type { AuditEntry } from "./concord-events";

describe("audit log immutability (live bug 3)", () => {
  it("REGRESSION: entries BY and ABOUT a member survive their removal (no roster gating)", () => {
    const removed = "ab".repeat(32);
    const admin = "cd".repeat(32);
    // The removed member renamed a channel earlier (entry BY them), then the
    // admin kicked them (entry ABOUT them). Neither may vanish after removal —
    // computeAuditLog takes no roster and must never filter on membership.
    const rumors = [
      audit("r1", removed, "rename_channel", 100, { detail: "general" }),
      audit("r2", admin, "kick", 200, { target: removed, reason: "bye" }),
    ];
    const log = computeAuditLog(rumors);
    expect(log.length).toBe(2);
    expect(log.find((e) => e.actor === removed)).toBeTruthy();
    expect(log.find((e) => e.target === removed)).toBeTruthy();
  });
});

describe("moderation system lines (removal/ban policy)", () => {
  const entry = (action: AuditEntry["action"], target?: string, reason?: string): AuditEntry =>
    ({ id: `${action}-${target}`, actor: "ad".repeat(32), action, target, reason, t: 1_700_000_000 });

  it("kick + ban map to neutral system lines attributed to the TARGET, times in ms", () => {
    const out = moderationSystemEvents([entry("kick", "aa".repeat(32)), entry("ban", "bb".repeat(32), "spam")]);
    expect(out).toEqual([
      { pubkey: "aa".repeat(32), action: "kick", t: 1_700_000_000_000 },
      { pubkey: "bb".repeat(32), action: "ban", t: 1_700_000_000_000 },
    ]);
    // The reason is withheld from the channel (admin-audit-log only).
    expect(JSON.stringify(out)).not.toContain("spam");
  });

  it("admin ROLE changes produce NO system line (audit-only), nor do metadata/channel edits", () => {
    const out = moderationSystemEvents([
      entry("make_admin", "aa".repeat(32)), entry("remove_admin", "aa".repeat(32)),
      entry("rename_channel"), entry("edit_metadata"), entry("dissolve"),
    ]);
    expect(out).toEqual([]);
  });

  it("a kick with no target is dropped (nothing sensible to announce)", () => {
    expect(moderationSystemEvents([entry("kick")])).toEqual([]);
  });

  it("moderation lines interleave into the default-channel timeline by time", () => {
    const msgs = [{ t: 1_699_999_999_000 }, { t: 1_700_000_001_000 }];
    const items = buildTimeline2(msgs, moderationSystemEvents([entry("ban", "bb".repeat(32))]), true);
    expect(items.map((i) => i.kind)).toEqual(["msg", "sys", "msg"]);
    const sys = items[1];
    expect(sys.kind === "sys" && sys.action).toBe("ban");
  });
});

describe("chatDayLabel — orientation cues", () => {
  const now = new Date(2026, 6, 20, 14, 30).getTime(); // Mon Jul 20 2026, 2:30 PM local

  it("labels same-day as Today and prior day as Yesterday", () => {
    expect(chatDayLabel(new Date(2026, 6, 20, 9, 0).getTime(), now)).toBe("Today");
    expect(chatDayLabel(new Date(2026, 6, 20, 23, 59).getTime(), now)).toBe("Today");
    expect(chatDayLabel(new Date(2026, 6, 19, 23, 0).getTime(), now)).toBe("Yesterday");
  });

  it("labels within the last week by weekday name", () => {
    // Jul 16 2026 is a Thursday
    expect(chatDayLabel(new Date(2026, 6, 16, 12, 0).getTime(), now)).toBe("Thursday");
  });

  it("labels older same-year dates as 'Mon D' and cross-year with the year", () => {
    expect(chatDayLabel(new Date(2026, 2, 15, 12, 0).getTime(), now)).toBe("Mar 15");
    expect(chatDayLabel(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe("Dec 31, 2025");
  });

  it("treats future clock skew as Today", () => {
    expect(chatDayLabel(new Date(2026, 6, 21, 1, 0).getTime(), now)).toBe("Today");
  });
});

describe("chatClockTime — 12-hour wall clock", () => {
  it("formats hours/minutes with AM/PM and midnight/noon edges", () => {
    expect(chatClockTime(new Date(2026, 6, 20, 14, 34).getTime())).toBe("2:34 PM");
    expect(chatClockTime(new Date(2026, 6, 20, 0, 5).getTime())).toBe("12:05 AM");
    expect(chatClockTime(new Date(2026, 6, 20, 12, 0).getTime())).toBe("12:00 PM");
    expect(chatClockTime(new Date(2026, 6, 20, 9, 7).getTime())).toBe("9:07 AM");
  });
});

describe("chatRowMeta — date dividers + author grouping", () => {
  const now = new Date(2026, 6, 20, 15, 0).getTime();
  const m = (id: string, pubkey: string, t: number) => ({ kind: "msg" as const, t, msg: { id, pubkey, t } });

  it("emits a divider on the first row and at each day boundary", () => {
    const t1 = new Date(2026, 6, 19, 10, 0).getTime();
    const t2 = new Date(2026, 6, 20, 10, 0).getTime();
    const meta = chatRowMeta([m("a", "p1", t1), m("b", "p1", t2)], now);
    expect(meta[0].dayDivider).toBe("Yesterday");
    expect(meta[1].dayDivider).toBe("Today");
  });

  it("groups consecutive same-author messages within the 5-minute window", () => {
    const base = new Date(2026, 6, 20, 10, 0).getTime();
    const meta = chatRowMeta([
      m("a", "p1", base),
      m("b", "p1", base + 60_000),        // +1 min, same author → grouped
      m("c", "p1", base + 10 * 60_000),   // +10 min → breaks the group
      m("d", "p2", base + 11 * 60_000),   // different author → not grouped
    ], now);
    expect(meta.map((x) => x.grouped)).toEqual([false, true, false, false]);
  });

  it("never groups a message under a message from a different day", () => {
    const t1 = new Date(2026, 6, 19, 23, 58).getTime();
    const t2 = new Date(2026, 6, 20, 0, 1).getTime(); // 3 min later but next day
    const meta = chatRowMeta([m("a", "p1", t1), m("b", "p1", t2)], now);
    expect(meta[1].grouped).toBe(false);
    expect(meta[1].dayDivider).toBe("Today");
  });

  it("breaks grouping across a system line", () => {
    const base = new Date(2026, 6, 20, 10, 0).getTime();
    const meta = chatRowMeta([
      m("a", "p1", base),
      { kind: "sys" as const, t: base + 30_000, id: "s1", pubkey: "p9", action: "join" as const },
      m("b", "p1", base + 60_000),
    ], now);
    expect(meta[2].grouped).toBe(false);
  });
});
