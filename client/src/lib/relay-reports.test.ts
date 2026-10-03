import { describe, it, expect } from "vitest";
import { foldRelayReports, reportKey, splitByTrust, describeReport } from "./relay-reports";

const P1 = "1".repeat(64), P2 = "2".repeat(64), OUTSIDER = "9".repeat(64);
const R1 = "a".repeat(64), R2 = "b".repeat(64), R3 = "c".repeat(64);
const POST = "e".repeat(64), OTHER_POST = "f".repeat(64);
let n = 0;
const report = (by: string, tags: string[][], at: number) => ({ id: String(++n).padStart(64, "0"), pubkey: by, kind: 1984, created_at: at, content: "", tags });

const ctx = {
  relayEventIds: new Set([POST]),
  relayAuthors: new Set([P1, P2]),
  dismissed: new Set<string>(),
};

describe("reports about what's on your relay", () => {
  it("one row per thing reported, with everyone who reported it", () => {
    const rows = foldRelayReports([
      report(R1, [["e", POST, "spam"], ["p", P1]], 10),
      report(R2, [["e", POST, "spam"], ["p", P1]], 20),
    ], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetEventId: POST, targetPubkey: P1, reporters: [R1, R2], types: ["spam"], firstAt: 10, lastAt: 20, severity: "mild" });
  });

  it("a report about a person, not a post, is its own row", () => {
    const rows = foldRelayReports([report(R1, [["p", P2, "impersonation"]], 5)], ctx);
    expect(rows[0]).toMatchObject({ targetEventId: undefined, targetPubkey: P2, severity: "severe" });
  });

  it("ignores reports about posts and people that aren't on this relay", () => {
    expect(foldRelayReports([report(R1, [["e", OTHER_POST, "spam"], ["p", OUTSIDER]], 5), report(R2, [["p", OUTSIDER, "spam"]], 6)], ctx)).toEqual([]);
  });

  it("counts a reporter once, however many times they reported", () => {
    const rows = foldRelayReports([report(R1, [["p", P2, "spam"]], 5), report(R1, [["p", P2, "spam"]], 9)], ctx);
    expect(rows[0].reporters).toEqual([R1]);
  });

  it("leaves out what you've dismissed", () => {
    const dismissed = new Set([reportKey({ targetEventId: POST, targetPubkey: P1 })]);
    expect(foldRelayReports([report(R1, [["e", POST, "spam"], ["p", P1]], 5)], { ...ctx, dismissed })).toEqual([]);
  });

  it("puts the most serious and most reported first", () => {
    const rows = foldRelayReports([
      report(R1, [["p", P1, "spam"]], 50),
      report(R1, [["p", P2, "illegal"]], 10),
    ], ctx);
    expect(rows.map((r) => r.targetPubkey)).toEqual([P2, P1]);
  });
});

describe("reports from people you know first", () => {
  const rows = foldRelayReports([
    report(R1, [["p", P1, "spam"]], 50),
    report(R3, [["p", P2, "spam"]], 10),
  ], ctx);
  const tierOf = (pk: string) => (pk === R3 ? "strong" as const : "none" as const);

  it("a report backed by your network goes above; strangers' fold below", () => {
    const { known, strangers } = splitByTrust(rows, tierOf);
    expect(known.map((r) => r.targetPubkey)).toEqual([P2]);
    expect(strangers.map((r) => r.targetPubkey)).toEqual([P1]);
  });

  it("without your network loaded, nothing is folded away", () => {
    const { known, strangers } = splitByTrust(rows, tierOf, false);
    expect(known).toHaveLength(2);
    expect(strangers).toHaveLength(0);
  });
});

describe("saying what a report is", () => {
  it("in words", () => {
    expect(describeReport({ types: ["spam"], reporters: [R1, R2], targetEventId: POST })).toBe("A post reported for spam by 2 people");
    expect(describeReport({ types: ["impersonation", "spam"], reporters: [R1], targetEventId: undefined })).toBe("This person reported for impersonation and spam by 1 person");
    expect(describeReport({ types: [], reporters: [R1], targetEventId: POST })).toBe("A post reported by 1 person");
  });
});
