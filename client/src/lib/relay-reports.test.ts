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
  dismissedAt: (_key: string): number | undefined => undefined,
  ignoredReporters: new Set<string>(),
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

  it("leaves out reports from before you dismissed the row, and brings it back on a newer one", () => {
    const key = reportKey({ targetEventId: POST, targetPubkey: P1 });
    const dismissedAt = (k: string) => (k === key ? 100 : undefined);
    expect(foldRelayReports([report(R1, [["e", POST, "spam"], ["p", P1]], 90)], { ...ctx, dismissedAt })).toEqual([]);
    const back = foldRelayReports([report(R1, [["e", POST, "spam"], ["p", P1]], 90), report(R2, [["e", POST, "spam"], ["p", P1]], 150)], { ...ctx, dismissedAt });
    expect(back).toHaveLength(1);
    expect(back[0].reporters).toEqual([R2]);
  });

  it("leaves out reports from people whose reports you ignore", () => {
    const ignoredReporters = new Set([R1]);
    expect(foldRelayReports([report(R1, [["p", P2, "spam"]], 5)], { ...ctx, ignoredReporters })).toEqual([]);
    const rows = foldRelayReports([report(R1, [["p", P2, "spam"]], 5), report(R2, [["p", P2, "spam"]], 6)], { ...ctx, ignoredReporters });
    expect(rows[0].reporters).toEqual([R2]);
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
    const { known, strangers, probablyFine } = splitByTrust(rows, tierOf);
    expect(known.map((r) => r.targetPubkey)).toEqual([P2]);
    expect(strangers.map((r) => r.targetPubkey)).toEqual([P1]);
    expect(probablyFine).toHaveLength(0);
  });

  it("strangers reporting someone your network trusts fold into 'probably fine'", () => {
    const trustsP1 = (pk: string) => (pk === R3 || pk === P1 ? "strong" as const : "none" as const);
    const { known, strangers, probablyFine } = splitByTrust(rows, trustsP1);
    expect(known.map((r) => r.targetPubkey)).toEqual([P2]);
    expect(strangers).toHaveLength(0);
    expect(probablyFine.map((r) => r.targetPubkey)).toEqual([P1]);
  });

  it("without your network loaded, nothing is folded away", () => {
    const { known, strangers, probablyFine } = splitByTrust(rows, tierOf, false);
    expect(known).toHaveLength(2);
    expect(strangers).toHaveLength(0);
    expect(probablyFine).toHaveLength(0);
  });
});

describe("saying what a report is", () => {
  it("in words", () => {
    expect(describeReport({ types: ["spam"], reporters: [R1, R2], targetEventId: POST })).toBe("A post reported for spam by 2 people");
    expect(describeReport({ types: ["impersonation", "spam"], reporters: [R1], targetEventId: undefined })).toBe("This person reported for impersonation and spam by 1 person");
    expect(describeReport({ types: [], reporters: [R1], targetEventId: POST })).toBe("A post reported by 1 person");
  });
});

// Owner, 2026-10-12: the card never showed the post, the reporter's reason, who
// the reporter was, or why the report sat under "From people you don't know".
describe("what a report card knows and says", () => {
  it("keeps each reporter's reason and the relay hints the report carried", () => {
    const rows = foldRelayReports([
      { ...report(R1, [["e", POST, "wss://relay.damus.io", "spam"], ["p", P1]], 10), content: "Selling parking passes" },
      { ...report(R2, [["e", POST, "spam"], ["p", P1, "wss://nos.lol"]], 20), content: "" },
    ], ctx);
    expect(rows[0].reasons).toEqual([{ by: R1, text: "Selling parking passes" }]);
    expect(rows[0].relayHints).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
    expect(rows[0].types).toEqual(["spam"]);
  });

  it("says why a report sits under 'From people you don't know'", async () => {
    const { strangersExplanation } = await import("./relay-reports");
    expect(strangersExplanation()).toBe("Reports from people your network trusts come first. These reporters aren't known to your network yet.");
  });

  it("'See it' tells the truth about where the post is", async () => {
    const { seeItWords } = await import("./relay-reports");
    expect(seeItWords({ reached: true, here: false, elsewhere: true })).toBe("Not on this relay any more, but still up on other relays.");
    expect(seeItWords({ reached: true, here: false, elsewhere: false })).toBe("Not on this relay, and no relay we asked still has it. It was probably removed.");
    expect(seeItWords({ reached: false, here: false, elsewhere: false })).toBe("Couldn't reach the relays to check. Try again in a moment.");
    expect(seeItWords({ reached: true, here: true, elsewhere: false })).toBe("");
  });
});
