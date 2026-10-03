import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from "nostr-tools";
import { encodings, pointers, signatureVerdict, referenceCounts, seenOnLine, parsePastedEvent } from "./inspector-model";

const sk = generateSecretKey();
const pk = getPublicKey(sk);
// Plain JSON copies: nostr-tools caches "verified" on the object it signed.
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const note = plain(finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: "hello" }, sk));
const OTHER = "b".repeat(64), POST = "c".repeat(64);

describe("the codes to share an event by", () => {
  it("note and nevent (with the relay it's on), and the author's npub", () => {
    const e = encodings(note, "wss://harbour.example");
    expect(nip19.decode(e.note).data).toBe(note.id);
    const nevent = nip19.decode(e.nevent).data as { id: string; relays?: string[]; kind?: number };
    expect(nevent.id).toBe(note.id);
    expect(nevent.relays).toEqual(["wss://harbour.example"]);
    expect(nevent.kind).toBe(1);
    expect(nip19.decode(e.npub).data).toBe(pk);
    expect(e.naddr).toBeUndefined();
  });

  it("an naddr for something addressable", () => {
    const article = plain(finalizeEvent({ kind: 30023, created_at: 1, tags: [["d", "harbour-rules"]], content: "" }, sk));
    const a = nip19.decode(encodings(article).naddr!).data as { identifier: string; kind: number; pubkey: string };
    expect(a).toMatchObject({ identifier: "harbour-rules", kind: 30023, pubkey: pk });
  });
});

describe("is it really from who it says?", () => {
  it("a properly signed event checks out", () => {
    expect(signatureVerdict(note)).toEqual({ verdict: "valid" });
  });

  it("changed after signing: the id no longer matches", () => {
    expect(signatureVerdict({ ...note, content: "hello!" })).toEqual({ verdict: "invalid", reason: "The content was changed after it was signed" });
  });

  it("a signature from someone else", () => {
    const forged = { ...note, sig: plain(finalizeEvent({ kind: 1, created_at: 1, tags: [], content: "x" }, generateSecretKey())).sig };
    expect(signatureVerdict(forged)).toEqual({ verdict: "invalid", reason: "The signature isn't the author's" });
  });

  it("no signature at all", () => {
    const { sig: _s, ...unsigned } = note;
    expect(signatureVerdict(unsigned)).toEqual({ verdict: "unsigned" });
  });
});

describe("what it points to", () => {
  it("events, people and addresses, from its tags and its text, once each", () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: OTHER, identifier: "x" });
    const ev = {
      ...note,
      tags: [["e", POST, "", "reply"], ["p", OTHER], ["a", `30023:${OTHER}:x`], ["q", POST]],
      content: `see nostr:${nip19.noteEncode(POST)} by nostr:${nip19.npubEncode(OTHER)} and nostr:${naddr}`,
    };
    expect(pointers(ev)).toEqual([
      { type: "event", value: POST, marker: "reply" },
      { type: "person", value: OTHER },
      { type: "address", value: `30023:${OTHER}:x` },
    ]);
  });
});

describe("what points back to it", () => {
  it("counts replies, reactions, reposts and thanks", () => {
    const refs = [1, 1111, 7, 7, 7, 6, 16, 9735, 1984].map((kind) => ({ kind }));
    expect(referenceCounts(refs)).toEqual({ replies: 2, reactions: 3, reposts: 2, thanks: 1, other: 1 });
  });
});

describe("where it's been seen", () => {
  it("says how many relays have it, and which couldn't be asked", () => {
    expect(seenOnLine([
      { relay: "wss://a", status: "has" }, { relay: "wss://b", status: "has" },
      { relay: "wss://c", status: "missing" }, { relay: "wss://d", status: "unreached" },
    ])).toBe("On 2 of 3 relays that answered · 1 couldn't be reached");
    expect(seenOnLine([{ relay: "wss://a", status: "has" }])).toBe("On 1 of 1 relay that answered");
    expect(seenOnLine([{ relay: "wss://a", status: "unreached" }])).toBe("No relay could be reached to check");
  });
});

describe("pasting an event to inspect it", () => {
  it("takes event JSON, even wrapped in a relay message", () => {
    expect(parsePastedEvent(JSON.stringify(note))).toEqual(note);
    expect(parsePastedEvent(`  ["EVENT","sub1",${JSON.stringify(note)}] `)).toEqual(note);
    expect(parsePastedEvent(`["EVENT",${JSON.stringify(note)}]`)).toEqual(note);
  });

  it("anything else is a search, not an event", () => {
    expect(parsePastedEvent("hello")).toBeNull();
    expect(parsePastedEvent('{"kind":1}')).toBeNull();
    expect(parsePastedEvent("{not json")).toBeNull();
    expect(parsePastedEvent(JSON.stringify({ ...note, tags: "x" }))).toBeNull();
  });
});
