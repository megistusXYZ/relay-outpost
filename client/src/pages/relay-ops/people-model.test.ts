import { describe, it, expect } from "vitest";
import { buildDirectory, filterPeople, sortPeople, knowsNewcomers, activityLine, peopleCsv } from "./people-model";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64), D = "d".repeat(64);
const NOW = 1_700_000_000;
const DAY = 86400;
const ev = (pubkey: string, created_at: number, kind = 1) => ({ id: `${pubkey}${created_at}`.slice(0, 64), pubkey, created_at, kind, content: "", tags: [] });

describe("who is on the relay", () => {
  const events = [ev(A, NOW - 60), ev(A, NOW - 3 * DAY), ev(B, NOW - 2 * DAY, 7), ev(A, NOW - 9 * DAY)];
  const dir = buildDirectory(events, { allowed: [C], banned: [B] });

  it("everyone who posted, plus everyone on the allow and ban lists", () => {
    expect(dir.map((p) => p.pubkey).sort()).toEqual([A, B, C]);
  });

  it("counts what each posted and when they were last and first seen", () => {
    const a = dir.find((p) => p.pubkey === A)!;
    expect(a.posts).toBe(3);
    expect(a.lastSeen).toBe(NOW - 60);
    expect(a.firstSeen).toBe(NOW - 9 * DAY);
  });

  it("knows who's banned and who's allowed", () => {
    expect(dir.find((p) => p.pubkey === B)!.status).toBe("banned");
    expect(dir.find((p) => p.pubkey === C)!.status).toBe("allowed");
    expect(dir.find((p) => p.pubkey === A)!.status).toBe("none");
  });

  it("someone only on a list has posted nothing we've seen", () => {
    const c = dir.find((p) => p.pubkey === C)!;
    expect(c.posts).toBe(0);
    expect(c.lastSeen).toBeUndefined();
  });

  it("keeps someone you just acted on, even with no posts or rule left", () => {
    const dir = buildDirectory([], { allowed: [], banned: [], also: [D] });
    expect(dir).toEqual([{ pubkey: D, posts: 0, status: "none" }]);
  });

  it("a ban wins over an allow", () => {
    expect(buildDirectory([], { allowed: [D], banned: [D] })[0].status).toBe("banned");
  });
});

describe("saying who's new — only when we can know", () => {
  it("needs what we loaded to reach back further than a week", () => {
    expect(knowsNewcomers(NOW - 8 * DAY, NOW, false)).toBe(true);
    expect(knowsNewcomers(NOW - 2 * DAY, NOW, false)).toBe(false);
    expect(knowsNewcomers(NOW - 2 * DAY, NOW, true)).toBe(true);
  });
});

describe("filtering and sorting", () => {
  const dir = buildDirectory(
    [ev(A, NOW - 60), ev(A, NOW - 9 * DAY), ev(B, NOW - 2 * DAY), ev(D, NOW - 3 * DAY), ev(D, NOW - 3 * DAY + 1)],
    { allowed: [C], banned: [B] },
  );
  const names: Record<string, string> = { [A]: "zed", [B]: "Amy", [C]: "bo", [D]: "Cy" };
  const ctx = { nowSec: NOW, newcomersKnown: true, nameOf: (pk: string) => names[pk], tierOf: (pk: string) => (pk === D ? "flagged" as const : "strong" as const) };

  it("Banned, Allowed, New this week, Your network has concerns", () => {
    expect(filterPeople(dir, "banned", "", ctx).map((p) => p.pubkey)).toEqual([B]);
    expect(filterPeople(dir, "allowed", "", ctx).map((p) => p.pubkey)).toEqual([C]);
    expect(filterPeople(dir, "new", "", ctx).map((p) => p.pubkey).sort()).toEqual([B, D].sort());
    expect(filterPeople(dir, "concerns", "", ctx).map((p) => p.pubkey)).toEqual([D]);
  });

  it("New this week finds nobody when we can't know", () => {
    expect(filterPeople(dir, "new", "", { ...ctx, newcomersKnown: false })).toEqual([]);
  });

  it("a search matches a name or the start of an npub or key", () => {
    expect(filterPeople(dir, "all", "amy", ctx).map((p) => p.pubkey)).toEqual([B]);
    expect(filterPeople(dir, "all", "dddd", ctx).map((p) => p.pubkey)).toEqual([D]);
  });

  it("sorts by last active, most posts, or name", () => {
    expect(sortPeople(dir, "active", ctx.nameOf)[0].pubkey).toBe(A);
    expect(sortPeople(dir, "posts", ctx.nameOf)[0].posts).toBe(2);
    expect(sortPeople(dir, "name", ctx.nameOf).map((p) => ctx.nameOf(p.pubkey))).toEqual(["Amy", "bo", "Cy", "zed"]);
  });
});

describe("the line under a name", () => {
  it("says how much and how recently, in words", () => {
    expect(activityLine({ pubkey: A, posts: 3, lastSeen: NOW - 2 * 3600, status: "none" }, NOW)).toBe("3 posts · active 2h ago");
    expect(activityLine({ pubkey: A, posts: 1, lastSeen: NOW - 30, status: "none" }, NOW)).toBe("1 post · active just now");
  });

  it("someone with no posts we've seen", () => {
    expect(activityLine({ pubkey: C, posts: 0, status: "allowed" }, NOW)).toBe("No posts in what we've loaded");
  });
});

describe("exporting people", () => {
  it("writes a CSV a spreadsheet opens", () => {
    const csv = peopleCsv([{ pubkey: A, posts: 2, lastSeen: 0, status: "banned" }], () => 'Zed "the" Sailor');
    const [head, row] = csv.split("\n");
    expect(head).toBe('"name","key","status","posts","last active"');
    expect(row).toBe(`"Zed ""the"" Sailor","${A}","banned","2","1970-01-01T00:00:00.000Z"`);
  });
});
