import { describe, it, expect } from "vitest";
import { parseAuthoredAttestations } from "./use-attestations";

const AUTHOR = "a".repeat(64);
const SUBJECT_1 = "1".repeat(64);
const SUBJECT_2 = "2".repeat(64);

function ev(over: Partial<{ id: string; pubkey: string; content: string; created_at: number; tags: string[][] }>) {
  return {
    id: over.id ?? "id-" + Math.random().toString(36).slice(2),
    pubkey: over.pubkey ?? AUTHOR,
    content: over.content ?? "",
    created_at: over.created_at ?? 1000,
    tags: over.tags ?? [],
  };
}

describe("parseAuthoredAttestations", () => {
  it("parses subject (from d tag), type, note and timestamp", () => {
    const out = parseAuthoredAttestations([
      ev({ id: "e1", created_at: 1710000000, content: "great dev", tags: [["d", SUBJECT_1], ["p", SUBJECT_1], ["t", "vouch"]] }),
    ]);
    expect(out).toEqual([
      { subjectPubkey: SUBJECT_1, type: "vouch", note: "great dev", timestamp: 1710000000, eventId: "e1" },
    ]);
  });

  it("defaults type to vouch when no t tag", () => {
    const out = parseAuthoredAttestations([ev({ tags: [["d", SUBJECT_1]] })]);
    expect(out[0].type).toBe("vouch");
  });

  it("reads identity type from the t tag", () => {
    const out = parseAuthoredAttestations([ev({ tags: [["d", SUBJECT_1], ["t", "identity"]] })]);
    expect(out[0].type).toBe("identity");
  });

  it("keeps only the latest per subject (addressable dedup)", () => {
    const out = parseAuthoredAttestations([
      ev({ id: "old", created_at: 100, content: "first", tags: [["d", SUBJECT_1]] }),
      ev({ id: "new", created_at: 200, content: "updated", tags: [["d", SUBJECT_1]] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("new");
    expect(out[0].note).toBe("updated");
  });

  it("does not let an older event overwrite a newer one regardless of order", () => {
    const out = parseAuthoredAttestations([
      ev({ id: "new", created_at: 200, content: "updated", tags: [["d", SUBJECT_1]] }),
      ev({ id: "old", created_at: 100, content: "first", tags: [["d", SUBJECT_1]] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("new");
  });

  it("skips machine metrics-payload content (JSON object)", () => {
    const out = parseAuthoredAttestations([
      ev({ content: '{"followers_count":0,"notes_count":0}', tags: [["d", SUBJECT_1]] }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("skips self-vouches and events with no subject", () => {
    const out = parseAuthoredAttestations([
      ev({ pubkey: AUTHOR, tags: [["d", AUTHOR]] }), // self
      ev({ tags: [["t", "vouch"]] }), // no d/p tag
    ]);
    expect(out).toHaveLength(0);
  });

  it("sorts multiple subjects newest-first", () => {
    const out = parseAuthoredAttestations([
      ev({ id: "s1", created_at: 100, tags: [["d", SUBJECT_1]] }),
      ev({ id: "s2", created_at: 300, tags: [["d", SUBJECT_2]] }),
    ]);
    expect(out.map((a) => a.subjectPubkey)).toEqual([SUBJECT_2, SUBJECT_1]);
  });

  it("falls back to the p tag when d tag is absent", () => {
    const out = parseAuthoredAttestations([ev({ content: "via p", tags: [["p", SUBJECT_2]] })]);
    expect(out).toHaveLength(1);
    expect(out[0].subjectPubkey).toBe(SUBJECT_2);
  });
});
