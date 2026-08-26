import { describe, it, expect } from "vitest";
import {
  computeFlagVerdict,
  rankFlagVerdicts,
  severityFromReportTypes,
  reportTypesFromEvent,
  type FlagVerdictInput,
  type VerdictReporter,
} from "./follow-flag-verdict";

const pk = (n: number) => n.toString(16).padStart(64, "0");

// Influence values chosen against DEFAULT_THRESHOLDS
// (strong ≥ .50, moderate ≥ .20, low ≥ .07, weak ≥ .02):
const STRONG_INF = 0.8;
const MODERATE_INF = 0.3;
const WEAK_INF = 0.03;

function reporter(n: number, influence: number | null): VerdictReporter {
  return { pubkey: pk(n), influence };
}

function input(overrides: Partial<FlagVerdictInput> = {}): FlagVerdictInput {
  return {
    pubkey: pk(1),
    targetInfluence: null,
    reporters: [],
    reporterCount: 0,
    severity: "neutral",
    ...overrides,
  };
}

describe("severityFromReportTypes", () => {
  it("returns severe when any severe type is present (most severe wins)", () => {
    expect(severityFromReportTypes(["spam", "impersonation"])).toBe("severe");
    expect(severityFromReportTypes(["illegal"])).toBe("severe");
    expect(severityFromReportTypes(["malware"])).toBe("severe");
  });

  it("returns mild for mild-only types", () => {
    expect(severityFromReportTypes(["spam"])).toBe("mild");
    expect(severityFromReportTypes(["profanity", "nudity"])).toBe("mild");
  });

  it("returns neutral for unknown / empty / 'other'", () => {
    expect(severityFromReportTypes([])).toBe("neutral");
    expect(severityFromReportTypes(["other"])).toBe("neutral");
    expect(severityFromReportTypes(["something-weird"])).toBe("neutral");
  });

  it("is case-insensitive", () => {
    expect(severityFromReportTypes(["Impersonation"])).toBe("severe");
    expect(severityFromReportTypes(["SPAM"])).toBe("mild");
  });
});

describe("reportTypesFromEvent", () => {
  it("reads the type from a matching p tag", () => {
    const ev = { tags: [["p", pk(1), "impersonation"], ["p", pk(2), "spam"]] };
    expect(reportTypesFromEvent(ev, pk(1))).toEqual(["impersonation"]);
  });

  it("reads a dedicated report tag", () => {
    const ev = { tags: [["p", pk(1)], ["report", "illegal"]] };
    expect(reportTypesFromEvent(ev, pk(1))).toEqual(["illegal"]);
  });
});

// Helper: N reporters of the same influence — for the "many flaggers" specs.
function reporters(n: number, influence: number | null): VerdictReporter[] {
  return Array.from({ length: n }, (_, i) => reporter(1000 + i, influence));
}

// ── Evidence E = avgWeight × √count — UNCHANGED by the reach-relative rework.
//    The reporter-tier weighting and the √-damping exact values must survive. ──
describe("computeFlagVerdict — reporter-tier weighting (evidence unchanged)", () => {
  it("weighs a high-trust reporter more than a fringe one", () => {
    const strong = computeFlagVerdict(input({
      reporters: [reporter(10, STRONG_INF)], reporterCount: 1,
    }));
    const fringe = computeFlagVerdict(input({
      reporters: [reporter(10, WEAK_INF)], reporterCount: 1,
    }));
    expect(strong.evidence).toBeGreaterThan(fringe.evidence);
  });

  it("evidence grows with DIMINISHING RETURNS in the count (not linearly)", () => {
    const one = computeFlagVerdict(input({
      reporters: reporters(1, MODERATE_INF), reporterCount: 1,
    }));
    const four = computeFlagVerdict(input({
      reporters: reporters(4, MODERATE_INF), reporterCount: 4,
    }));
    const nine = computeFlagVerdict(input({
      reporters: reporters(9, MODERATE_INF), reporterCount: 9,
    }));
    // More flaggers → more evidence, but strictly sub-linear: 4 flaggers is
    // worth far less than 4×, and 9 far less than 9×.
    expect(four.evidence).toBeGreaterThan(one.evidence);
    expect(nine.evidence).toBeGreaterThan(four.evidence);
    expect(four.evidence).toBeLessThan(one.evidence * 4);
    expect(nine.evidence).toBeLessThan(one.evidence * 9);
    // √count curve on the average moderate weight (3): 4→6, 9→9.
    expect(four.evidence).toBeCloseTo(6, 5);
    expect(nine.evidence).toBeCloseTo(9, 5);
  });

  it("falls back to the trusted count (moderate weight) when identities are absent", () => {
    const v = computeFlagVerdict(input({ reporters: [], reporterCount: 4 }));
    // moderate weight (3) × √4 = 6 — same diminishing curve as resolved reporters.
    expect(v.evidence).toBeCloseTo(6, 5);
  });
});

// ── Standing is now a reach-relative SHIELD, not a fixed-fraction discount.
//    mitigationApplied = Seff/(E+Seff), effectiveEvidence = E × E/(E+Seff). ──
describe("computeFlagVerdict — reach-relative standing shield", () => {
  it("strong standing lowers a mild allegation's effective evidence", () => {
    const noStanding = computeFlagVerdict(input({
      reporters: [reporter(10, MODERATE_INF), reporter(11, MODERATE_INF)],
      reporterCount: 2, severity: "mild", targetInfluence: null,
    }));
    const strongStanding = computeFlagVerdict(input({
      reporters: [reporter(10, MODERATE_INF), reporter(11, MODERATE_INF)],
      reporterCount: 2, severity: "mild", targetInfluence: STRONG_INF,
    }));
    expect(strongStanding.effectiveEvidence).toBeLessThan(noStanding.effectiveEvidence);
    expect(strongStanding.mitigationApplied).toBeGreaterThan(0);
  });

  it("a mild allegation against strong standing is shielded by a large fraction (ratio, not fixed .85)", () => {
    const v = computeFlagVerdict(input({
      reporters: [reporter(10, MODERATE_INF)], reporterCount: 1,
      severity: "mild", targetInfluence: STRONG_INF,
    }));
    // E = 3×√1 = 3; Seff = SHIELD.strong(32) × RESIST.mild(1.2) = 38.4.
    // mitigation = 38.4 / (3 + 38.4) = 0.9275 — a large shield, but never 1.
    expect(v.mitigationApplied).toBeCloseTo(0.9275, 3);
    expect(v.mitigationApplied).toBeLessThan(1);
  });

  it("no standing means no mitigation (none tier ⇒ Seff 0 ⇒ R 1 ⇒ mitigation 0)", () => {
    const v = computeFlagVerdict(input({
      reporters: [reporter(10, MODERATE_INF)], reporterCount: 1,
      severity: "mild", targetInfluence: null,
    }));
    expect(v.mitigationApplied).toBe(0);
    expect(v.effectiveEvidence).toBe(v.evidence);
  });
});

describe("computeFlagVerdict — severity pierces the shield", () => {
  it("a severe reason pierces more shield than a mild one at the same standing", () => {
    const severe = computeFlagVerdict(input({
      reporters: [reporter(10, MODERATE_INF)], reporterCount: 1,
      severity: "severe", targetInfluence: STRONG_INF,
    }));
    const mild = computeFlagVerdict(input({
      reporters: [reporter(10, MODERATE_INF)], reporterCount: 1,
      severity: "mild", targetInfluence: STRONG_INF,
    }));
    // Severe cuts the shield (RESIST.severe 0.45), so LESS of the argument is
    // shielded than for a mild reason (RESIST.mild 1.2).
    expect(severe.mitigationApplied).toBeLessThan(mild.mitigationApplied);
    // E=3; severe Seff = 32×0.45 = 14.4 → mitigation 14.4/17.4 = 0.8276.
    expect(severe.mitigationApplied).toBeCloseTo(0.8276, 3);
  });
});

// ── Level now derives from the ratio R = E/(E+Seff), not a fixed threshold. ──
describe("computeFlagVerdict — 3-level thresholds (from the ratio R)", () => {
  it("weak when the shield dwarfs the evidence (mild reason on strong standing)", () => {
    // E=3, Seff=32×1.2=38.4 → R=0.072 → weak (mild, so no severe floor).
    const v = computeFlagVerdict(input({
      reporters: [reporter(10, MODERATE_INF)], reporterCount: 1,
      severity: "mild", targetInfluence: STRONG_INF,
    }));
    expect(v.level).toBe("weak");
  });

  it("worth-a-look at the middle band (moderate shield, moderate evidence)", () => {
    // E=3×√5=6.708, Seff=SHIELD.moderate(12)×RESIST.neutral(0.8)=9.6 → R=0.41.
    const v = computeFlagVerdict(input({
      reporters: reporters(5, MODERATE_INF), reporterCount: 5, severity: "neutral",
      targetInfluence: MODERATE_INF,
    }));
    expect(v.level).toBe("worth-a-look");
  });

  it("strong when trusted reporters pile up with no standing to shield it", () => {
    // No standing ⇒ Seff 0 ⇒ R 1 ⇒ strong (the flags fully win).
    const v = computeFlagVerdict(input({
      reporters: reporters(3, STRONG_INF),
      reporterCount: 3, severity: "neutral",
    }));
    expect(v.level).toBe("strong");
  });
});

describe("computeFlagVerdict — never immunize serious allegations", () => {
  it("effective evidence stays positive under maximum standing", () => {
    const v = computeFlagVerdict(input({
      reporters: [reporter(10, STRONG_INF)], reporterCount: 1,
      severity: "mild", targetInfluence: STRONG_INF,
    }));
    // R is small but never 0, so effective evidence is never immunized to zero.
    expect(v.effectiveEvidence).toBeGreaterThan(0);
    expect(v.mitigationApplied).toBeLessThan(1);
  });

  it("a SEVERE allegation with evidence is never ranked weak, even at top standing", () => {
    const v = computeFlagVerdict(input({
      reporters: [reporter(10, WEAK_INF)], reporterCount: 1,
      severity: "severe", targetInfluence: STRONG_INF,
    }));
    expect(v.level).not.toBe("weak");
  });

  it("even a lone fringe severe report surfaces for review", () => {
    const v = computeFlagVerdict(input({
      reporters: [], reporterCount: 1,
      severity: "severe", targetInfluence: STRONG_INF,
    }));
    expect(v.level).not.toBe("weak");
    expect(v.effectiveEvidence).toBeGreaterThan(0);
  });
});

// ── The reach-relative truth table (acceptance criteria) ──────────────────────
// Real accounts in the user's network that read as false alarms under the old
// flat model. "unresolved" reporters = `reporters: []` + `reporterCount: N`
// (moderate fallback weight). Each spec asserts the observable verdict: LEVEL,
// SUPPRESSED (collapses out of the prominent list), REASSURING (leads with
// trust), and where relevant the summary phrasing. Constants live in the module.
describe("computeFlagVerdict — reach-relative truth table", () => {
  it("1. 7fqx: severe (illegal) + strong standing + 5 unresolved → suppressed, reassuring, not strong", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", reasonLabel: "illegal",
      targetInfluence: STRONG_INF, reporters: [], reporterCount: 5,
    }));
    expect(v.suppressed).toBe(true);
    expect(v.reassuring).toBe(true);
    expect(v.level).not.toBe("strong");
    expect(v.summary.startsWith("Trusted in your network")).toBe(true);
  });

  it("2. jb55: severe (impersonation) + strong standing + 9 unresolved → suppressed, reassuring", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", reasonLabel: "impersonation",
      targetInfluence: STRONG_INF, reporters: [], reporterCount: 9,
    }));
    expect(v.suppressed).toBe(true);
    expect(v.reassuring).toBe(true);
    expect(v.level).not.toBe("strong");
    expect(v.summary.startsWith("Trusted in your network")).toBe(true);
    expect(v.summary).toContain("impersonation");
    expect(v.summary).toContain("9 people");
  });

  it("3. brigade: severe + strong standing + 80 unresolved → escalates to strong, NOT suppressed", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", reasonLabel: "impersonation",
      targetInfluence: STRONG_INF, reporters: [], reporterCount: 80,
    }));
    expect(v.level).toBe("strong");
    expect(v.suppressed).toBe(false);
    expect(v.reassuring).toBe(false);
  });

  it("4. real threat: severe + NONE standing + 9 unresolved → strong, NOT suppressed", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", reasonLabel: "malware",
      targetInfluence: null, reporters: [], reporterCount: 9,
    }));
    expect(v.level).toBe("strong");
    expect(v.suppressed).toBe(false);
    expect(v.reassuring).toBe(false);
    expect(v.summary.startsWith("Strong signal")).toBe(true);
  });

  it("5. BTC-BA: mild (spam) + moderate standing + 19 unresolved → suppressed, reassuring, not strong", () => {
    const v = computeFlagVerdict(input({
      severity: "mild", reasonLabel: "spam",
      targetInfluence: MODERATE_INF, reporters: [], reporterCount: 19,
    }));
    expect(v.suppressed).toBe(true);
    expect(v.reassuring).toBe(true);
    expect(v.level).not.toBe("strong");
  });

  it("6. malware threat: severe (malware) + weak standing + 69 → strong, NOT suppressed", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", reasonLabel: "malware",
      targetInfluence: WEAK_INF, reporters: [], reporterCount: 69,
    }));
    expect(v.level).toBe("strong");
    expect(v.suppressed).toBe(false);
  });

  it("7. moderate stays visible: severe + moderate standing + 5 → worth-a-look, reassuring, NOT suppressed", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", reasonLabel: "impersonation",
      targetInfluence: MODERATE_INF, reporters: [], reporterCount: 5,
    }));
    expect(v.level).toBe("worth-a-look");
    expect(v.reassuring).toBe(true);
    // moderate + severe is a real signal we keep in the prominent list.
    expect(v.suppressed).toBe(false);
  });

  it("8. monotonicity: for a strong-standing severe target, more flaggers is non-decreasing in level/effect", () => {
    const mk = (n: number) => computeFlagVerdict(input({
      severity: "severe", reasonLabel: "impersonation",
      targetInfluence: STRONG_INF, reporters: [], reporterCount: n,
    }));
    const five = mk(5), nine = mk(9), eighty = mk(80);
    // Levels non-decreasing: worth-a-look ≤ worth-a-look ≤ strong.
    expect(five.level).toBe("worth-a-look");
    expect(nine.level).toBe("worth-a-look");
    expect(eighty.level).toBe("strong");
    // Effective evidence strictly increases with the count (R and E both rise).
    expect(nine.effectiveEvidence).toBeGreaterThan(five.effectiveEvidence);
    expect(eighty.effectiveEvidence).toBeGreaterThan(nine.effectiveEvidence);
  });
});

// ── `suppressed` collapses the top-standing-not-escalated and mild-on-trusted
//    rows out of the prominent list, without ever immunizing them. ──
describe("computeFlagVerdict — suppressed field", () => {
  it("suppresses a strong-standing account that did not escalate to strong", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", targetInfluence: STRONG_INF, reporters: [], reporterCount: 9,
    }));
    expect(v.standingTier).toBe("strong");
    expect(v.level).not.toBe("strong");
    expect(v.suppressed).toBe(true);
  });

  it("does NOT suppress a strong-standing account once evidence escalates it to strong", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", targetInfluence: STRONG_INF, reporters: [], reporterCount: 80,
    }));
    expect(v.level).toBe("strong");
    expect(v.suppressed).toBe(false);
  });

  it("suppresses a mild reason on a well-trusted (moderate) account", () => {
    const v = computeFlagVerdict(input({
      severity: "mild", targetInfluence: MODERATE_INF, reporters: [], reporterCount: 19,
    }));
    expect(v.suppressed).toBe(true);
  });

  it("does NOT suppress a SEVERE reason on a merely-moderate account (stays visible)", () => {
    const v = computeFlagVerdict(input({
      severity: "severe", targetInfluence: MODERATE_INF, reporters: [], reporterCount: 5,
    }));
    expect(v.reassuring).toBe(true);
    expect(v.suppressed).toBe(false);
  });

  it("does NOT suppress a no-standing account", () => {
    const v = computeFlagVerdict(input({
      severity: "mild", targetInfluence: null, reporters: [], reporterCount: 19,
    }));
    expect(v.suppressed).toBe(false);
  });
});

describe("rankFlagVerdicts — sort order", () => {
  it("orders strong first, then worth-a-look, then weak", () => {
    const ranked = rankFlagVerdicts([
      // weak: mild reason fully shielded by strong standing.
      input({ pubkey: pk(1), reporters: [reporter(50, MODERATE_INF)], reporterCount: 1,
        severity: "mild", targetInfluence: STRONG_INF }),
      // strong: severe, no standing, several flaggers.
      input({ pubkey: pk(2), reporters: reporters(3, STRONG_INF), reporterCount: 3,
        severity: "severe", targetInfluence: null }),
      // worth-a-look: moderate shield, moderate evidence.
      input({ pubkey: pk(3), reporters: reporters(5, MODERATE_INF), reporterCount: 5,
        severity: "neutral", targetInfluence: MODERATE_INF }),
    ]);
    expect(ranked.map((v) => v.level)).toEqual(["strong", "worth-a-look", "weak"]);
    expect(ranked[0].pubkey).toBe(pk(2));
  });

  it("sorts suppressed (trusted-but-flagged) rows after non-suppressed peers", () => {
    const ranked = rankFlagVerdicts([
      // suppressed: strong standing, severe, 9 → worth-a-look + suppressed.
      input({ pubkey: pk(1), severity: "severe", reasonLabel: "impersonation",
        targetInfluence: STRONG_INF, reporters: [], reporterCount: 9 }),
      // non-suppressed worth-a-look: moderate standing, severe, 5.
      input({ pubkey: pk(2), severity: "severe", reasonLabel: "illegal",
        targetInfluence: MODERATE_INF, reporters: [], reporterCount: 5 }),
    ]);
    expect(ranked.map((v) => v.level)).toEqual(["worth-a-look", "worth-a-look"]);
    expect(ranked[0].pubkey).toBe(pk(2));
    expect(ranked[0].suppressed).toBe(false);
    expect(ranked[1].pubkey).toBe(pk(1));
    expect(ranked[1].suppressed).toBe(true);
  });

  it("softens a trusted-but-flagged row BELOW a genuine no-standing strong signal", () => {
    const ranked = rankFlagVerdicts([
      // jb55: severe, strong standing, 9 flaggers → softened (worth-a-look).
      input({ pubkey: pk(1), severity: "severe", reasonLabel: "impersonation",
        targetInfluence: STRONG_INF, reporters: [], reporterCount: 9 }),
      // A genuinely dangerous account: severe, no standing, many flaggers.
      input({ pubkey: pk(2), severity: "severe", reasonLabel: "malware",
        targetInfluence: null, reporters: [], reporterCount: 30 }),
    ]);
    expect(ranked[0].pubkey).toBe(pk(2)); // genuine strong signal first
    expect(ranked[0].level).toBe("strong");
    expect(ranked[1].pubkey).toBe(pk(1)); // softened, sorts below
    expect(ranked[1].level).toBe("worth-a-look");
  });

  it("summary names both the allegation and the standing", () => {
    const v = computeFlagVerdict(input({
      reporters: [reporter(10, STRONG_INF), reporter(11, STRONG_INF)],
      reporterCount: 3, severity: "severe", targetInfluence: WEAK_INF,
      reasonLabel: "impersonation",
    }));
    expect(v.summary).toContain("impersonation");
    expect(v.summary).toContain("3 people");
    expect(v.summary.toLowerCase()).toContain("signal");
  });
});

describe("reportTypesFromEvent — read the type wherever the writer put it", () => {
  const TGT = "t".repeat(64);

  it("reads the NIP-56 shape, type at index 2", () => {
    expect(reportTypesFromEvent({ tags: [["p", TGT, "nudity"]] }, TGT)).toEqual(["nudity"]);
  });

  it("reads the reply-borrowed shape, empty index 2 and type at 3", () => {
    // What this app's own ReportDialog wrote until it was fixed, and 27 of the
    // 30 reports on our test relay. Under the old reader tag[2] was "" — falsy —
    // so NOTHING was pushed and every report collapsed to neutral severity.
    expect(reportTypesFromEvent({ tags: [["p", TGT, "", "nudity"]] }, TGT)).toEqual(["nudity"]);
  });

  it("keeps a relay hint harmless when the type is at 3", () => {
    // A hint at index 2 is pushed too, but matches no known type, so severity is
    // still decided by the real one.
    expect(severityFromReportTypes(
      reportTypesFromEvent({ tags: [["p", TGT, "wss://relay.example", "illegal"]] }, TGT),
    )).toBe("severe");
  });

  it("still ignores tags naming somebody else", () => {
    // The whole reason this takes a target: a report can name several people.
    expect(reportTypesFromEvent({ tags: [["p", "o".repeat(64), "", "illegal"]] }, TGT)).toEqual([]);
  });

  it("still reads a dedicated report tag", () => {
    expect(reportTypesFromEvent({ tags: [["report", "spam"]] }, TGT)).toEqual(["spam"]);
  });

  it("end to end: severity is identical whichever shape the writer used", () => {
    // The bug this covers is not "wrong severity", it is NO severity: with the
    // type at index 3 the old reader pushed nothing and every report — illegal
    // or spam alike — folded to `neutral`. Both shapes must now agree.
    for (const [type, expected] of [["illegal", "severe"], ["nudity", "mild"], ["spam", "mild"]] as const) {
      expect(severityFromReportTypes(reportTypesFromEvent({ tags: [["p", TGT, type]] }, TGT))).toBe(expected);
      expect(severityFromReportTypes(reportTypesFromEvent({ tags: [["p", TGT, "", type]] }, TGT))).toBe(expected);
    }
  });

  it("the old reader saw NOTHING in the shape this app wrote", () => {
    // Pins the actual defect: index 2 empty meant the type was never read, so a
    // report of anything at all came back neutral. 27 of the 30 reports on our
    // test relay are that shape.
    const oldReader = (tags: string[][]) =>
      tags.filter((t) => t[0] === "p" && t[1] === TGT && t[2]).map((t) => t[2]);
    expect(oldReader([["p", TGT, "", "illegal"]])).toEqual([]);
    expect(reportTypesFromEvent({ tags: [["p", TGT, "", "illegal"]] }, TGT)).toEqual(["illegal"]);
  });
});
