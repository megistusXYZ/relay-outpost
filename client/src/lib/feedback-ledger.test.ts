import { describe, it, expect, vi } from "vitest";
import { emptyLedger, isSeenWrap, recordWrap, parseLedger, feedbackReader, SEEN_CAP, RUMOR_CAP, type FeedbackLedger } from "./feedback-ledger";
import type { UnwrappedRumor } from "./dm";

const rumor = (id: string, created_at = 1): UnwrappedRumor => ({ id, pubkey: "p".repeat(64), kind: 1621, tags: [["t", "feedback"]], content: "the app crashed", created_at });

describe("the feedback inbox remembers which gift wraps it has opened", () => {
  it("a wrap opened once is seen, whether or not it held feedback", () => {
    let l = recordWrap(emptyLedger(), "w1", rumor("r1"));
    l = recordWrap(l, "w2", null);
    expect(isSeenWrap(l, "w1")).toBe(true);
    expect(isSeenWrap(l, "w2")).toBe(true);
    expect(isSeenWrap(l, "w3")).toBe(false);
  });

  it("keeps the feedback it found, so tickets show again without opening anything", () => {
    const l = recordWrap(recordWrap(emptyLedger(), "w1", rumor("r1")), "w2", null);
    expect(l.rumors.map((r) => r.id)).toEqual(["r1"]);
  });

  it("recording the same wrap twice changes nothing", () => {
    const l = recordWrap(emptyLedger(), "w1", rumor("r1"));
    expect(recordWrap(l, "w1", rumor("r1"))).toEqual(l);
  });

  it("is bounded: the oldest seen ids and the oldest feedback give way", () => {
    let l = emptyLedger();
    for (let i = 0; i < SEEN_CAP + 50; i++) l = recordWrap(l, `w${i}`, null);
    expect(l.seen.length).toBe(SEEN_CAP);
    expect(isSeenWrap(l, "w0")).toBe(false);
    expect(isSeenWrap(l, `w${SEEN_CAP + 49}`)).toBe(true);
    let r = emptyLedger();
    for (let i = 0; i < RUMOR_CAP + 10; i++) r = recordWrap(r, `w${i}`, rumor(`r${i}`, i));
    expect(r.rumors.length).toBe(RUMOR_CAP);
    expect(r.rumors[0].id).toBe("r10"); // the oldest went
  });

  it("survives a round trip through storage, and rubbish reads as empty", () => {
    const l = recordWrap(recordWrap(emptyLedger(), "w1", rumor("r1")), "w2", null);
    expect(parseLedger(JSON.stringify(l))).toEqual(l);
    expect(parseLedger(null)).toEqual(emptyLedger());
    expect(parseLedger("{not json")).toEqual(emptyLedger());
    expect(parseLedger(JSON.stringify({ seen: "x", rumors: [{ id: 1 }] }))).toEqual(emptyLedger());
  });
});

describe("the feedback reader, which several screens open at once", () => {
  const wrap = (id: string) => ({ id, kind: 1059, pubkey: "w".repeat(64), tags: [], content: "", created_at: 1, sig: "" });
  const feedback = rumor("r-feedback", 5);
  const chat: UnwrappedRumor = { ...rumor("r-chat", 6), kind: 14, tags: [] };
  const store = () => { let saved = emptyLedger(); return { read: () => saved, write: (l: FeedbackLedger) => { saved = l; }, get saved() { return saved; } }; };

  it("hands back what it found last time at once, before touching a relay", () => {
    const s = store();
    s.write(recordWrap(emptyLedger(), "w-old", feedback));
    const got: UnwrappedRumor[][] = [];
    const reader = feedbackReader({ read: s.read, write: s.write, unwrap: async () => null, isFeedback: () => true, onUpdate: (r) => got.push(r) });
    reader.prime();
    expect(got).toEqual([[feedback]]);
  });

  it("never opens a wrap it has opened before", async () => {
    const s = store();
    s.write(recordWrap(emptyLedger(), "w1", null));
    const unwrap = vi.fn(async () => feedback);
    const reader = feedbackReader({ read: s.read, write: s.write, unwrap, isFeedback: () => true, onUpdate: () => {} });
    await reader.onWrap(wrap("w1") as never);
    expect(unwrap).not.toHaveBeenCalled();
  });

  it("opens a new wrap once, keeps the feedback it holds, and remembers the wrap", async () => {
    const s = store();
    const unwrap = vi.fn(async () => feedback);
    const got: UnwrappedRumor[][] = [];
    const reader = feedbackReader({ read: s.read, write: s.write, unwrap, isFeedback: (r) => r.kind === 1621, onUpdate: (r) => got.push(r) });
    await reader.onWrap(wrap("w1") as never);
    expect(unwrap).toHaveBeenCalledTimes(1);
    expect(got.at(-1)).toEqual([feedback]);
    expect(isSeenWrap(s.saved, "w1")).toBe(true);
    expect(s.saved.rumors).toEqual([feedback]);
  });

  it("a wrap that is not feedback is remembered as seen and kept out of the list", async () => {
    const s = store();
    const got: UnwrappedRumor[][] = [];
    const reader = feedbackReader({ read: s.read, write: s.write, unwrap: async () => chat, isFeedback: (r) => r.kind === 1621, onUpdate: (r) => got.push(r) });
    await reader.onWrap(wrap("w1") as never);
    expect(isSeenWrap(s.saved, "w1")).toBe(true);
    expect(s.saved.rumors).toEqual([]);
    expect(got).toEqual([]);
  });

  it("four screens reading the same wrap at the same time open it once between them", async () => {
    const s = store();
    let resolve!: (r: UnwrappedRumor | null) => void;
    const unwrap = vi.fn(() => new Promise<UnwrappedRumor | null>((res) => { resolve = res; }));
    const readers = Array.from({ length: 4 }, () => feedbackReader({ read: s.read, write: s.write, unwrap, isFeedback: () => true, onUpdate: () => {} }));
    const pending = readers.map((r) => r.onWrap(wrap("w-shared") as never));
    resolve(feedback);
    await Promise.all(pending);
    expect(unwrap).toHaveBeenCalledTimes(1);
    expect(s.saved.rumors).toEqual([feedback]);
  });

  it("a wrap that could not be opened (signer away) is not remembered, so it is tried again", async () => {
    const s = store();
    const reader = feedbackReader({ read: s.read, write: s.write, unwrap: async () => { throw new Error("signer timeout"); }, isFeedback: () => true, onUpdate: () => {} });
    await reader.onWrap(wrap("w1") as never);
    expect(isSeenWrap(s.saved, "w1")).toBe(false);
  });
});
