import { describe, it, expect } from "vitest";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { readDraft, riskOf, publishResults } from "@/lib/publisher-model";
import type { WireFrame } from "@/lib/wire-transcript";

const signed = JSON.parse(JSON.stringify(finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [["t", "harbour"]], content: "Ferry is late" }, generateSecretKey())));

describe("reading what was written", () => {
  it("a template to sign: kind, words and tags", () => {
    expect(readDraft('{"kind":1,"content":"hi","tags":[["t","x"]]}')).toEqual({ ok: true, draft: { kind: 1, content: "hi", tags: [["t", "x"]] }, signed: false });
    expect(readDraft('{"kind":7,"content":"+"}')).toEqual({ ok: true, draft: { kind: 7, content: "+", tags: [] }, signed: false });
  });
  it("a signed event, as it is", () => {
    expect(readDraft(JSON.stringify(signed))).toEqual({ ok: true, draft: signed, signed: true });
  });
  it("says what's wrong", () => {
    expect(readDraft("{kind:1}")).toEqual({ ok: false, error: "That isn't valid JSON" });
    expect(readDraft('{"content":"hi"}')).toEqual({ ok: false, error: "Give it a kind — a number, like 1 for a note" });
    expect(readDraft('{"kind":1,"content":5}')).toEqual({ ok: false, error: "content must be text" });
    expect(readDraft('{"kind":1,"tags":["t","x"]}')).toEqual({ ok: false, error: "tags must be a list of lists of text, like [[\"t\",\"nostr\"]]" });
  });
});

describe("what publishing this would do", () => {
  it("replacing a profile, follow list or other list is serious, and says what it replaces", () => {
    expect(riskOf(0)).toEqual({ level: "serious", text: "This replaces your profile everywhere it lands." });
    expect(riskOf(3)).toEqual({ level: "serious", text: "This replaces your follow list everywhere it lands. A short or empty list unfollows everyone left out." });
    expect(riskOf(10002)).toEqual({ level: "serious", text: "This replaces your relay list everywhere it lands." });
    expect(riskOf(10000)).toEqual({ level: "serious", text: "This replaces your mute list everywhere it lands." });
    expect(riskOf(5)).toEqual({ level: "serious", text: "This asks relays to delete the events it names." });
  });
  it("a new version of something addressable is worth a note; a note is just a note", () => {
    expect(riskOf(30023)).toEqual({ level: "note", text: "This replaces any earlier version with the same name (its d tag)." });
    expect(riskOf(4)).toEqual({ level: "serious", text: "Private messages must be encrypted first — this sends the content exactly as written." });
    expect(riskOf(1)).toBeNull();
  });
});

describe("what each relay said", () => {
  const ID = signed.id;
  const A = "wss://a.example", B = "wss://b.example", C = "wss://c.example", D = "wss://d.example", E = "wss://e.example";
  const sent = (relay: string, at = 0): WireFrame => ({ relay, at, dir: "out", msg: ["EVENT", signed] });
  const ok = (relay: string, at: number, accepted: boolean, message = ""): WireFrame => ({ relay, at, dir: "in", msg: ["OK", ID, accepted, message] });

  it("Accepted by N of M, with each relay's own reason", () => {
    const r = publishResults([A, B, C, D, E], ID, [
      sent(A), sent(B), sent(C), sent(D),
      ok(A, 85, true),
      ok(B, 40, true, "duplicate: already have this event"),
      ok(C, 60, false, "blocked: you are not a member"),
      { relay: E, at: 30, dir: "conn", state: "error", detail: "connection failed" },
    ]);
    expect(r.line).toBe("Accepted by 2 of 5 · 1 refused · 1 couldn't be reached · 1 hasn't answered");
    expect(r.rows).toEqual([
      { relay: A, status: "accepted", ms: 85 },
      { relay: B, status: "accepted", reason: "already had it", ms: 40 },
      { relay: C, status: "refused", reason: "you are not a member", ms: 60 },
      { relay: D, status: "waiting" },
      { relay: E, status: "unreached", reason: "connection failed" },
    ]);
  });

  it("a relay that wants sign-in first, then takes it", () => {
    const before = publishResults([A], ID, [sent(A), ok(A, 20, false, "auth-required: sign in to publish")]);
    expect(before.rows[0]).toEqual({ relay: A, status: "needs-sign-in", reason: "sign in to publish", ms: 20 });
    expect(before.line).toBe("Accepted by 0 of 1 · 1 wants you to sign in");
    const after = publishResults([A], ID, [sent(A), ok(A, 20, false, "auth-required: sign in to publish"), sent(A, 500), ok(A, 560, true)]);
    expect(after.rows[0]).toEqual({ relay: A, status: "accepted", ms: 60 });
    expect(after.line).toBe("Accepted by 1 of 1");
  });

  it("before anything's sent, nothing is claimed", () => {
    expect(publishResults([A, B], ID, []).line).toBe("Sending to 2 relays…");
  });
});
