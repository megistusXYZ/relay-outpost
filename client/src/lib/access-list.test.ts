import { describe, it, expect } from "vitest";
import { readAccessList, notYetOn } from "./access-list";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);

describe("the relay's allow / ban list → one entry per person", () => {
  it("a person the relay stored three times is one person, with the copies counted", () => {
    // relay.tools adds a new row every time someone is allowed, and lists every row.
    const list = readAccessList([{ pubkey: A, reason: "Web of Trust" }, { pubkey: B }, { pubkey: A }, A.toUpperCase(), { pubkey: C }]);
    expect(list.pubkeys).toEqual([A, B, C]);
    expect(list.copies).toEqual({ [A]: 3 });
    expect(list.extraRows).toBe(2);
  });

  it("drops what isn't a key", () => {
    expect(readAccessList(["npub1nope", { pubkey: 5 }, null, { nope: A }, B]).pubkeys).toEqual([B]);
  });

  it("a clean list has no copies", () => {
    expect(readAccessList([A, B])).toEqual({ pubkeys: [A, B], copies: {}, extraRows: 0, reasons: {} });
  });
});

describe("adding people: only those not on the list yet", () => {
  it("skips who's already there (any case), and repeats in the batch", () => {
    expect(notYetOn([A, B.toUpperCase(), C, C, "junk"], [B, "d".repeat(64)])).toEqual([A, C]);
  });
  it("nothing new, nothing to send", () => {
    expect(notYetOn([A], [A.toUpperCase()])).toEqual([]);
  });
});

describe("tidying up keeps why they were added", () => {
  it("the first reason the relay has for each person", () => {
    expect(readAccessList([{ pubkey: A, reason: "" }, { pubkey: A, reason: "Web of Trust · moderate+" }, { pubkey: A, reason: "later" }, B]).reasons).toEqual({ [A]: "Web of Trust · moderate+" });
  });
});

// ---- Import: what a file adds, before anything is sent ----
import { readImportFile } from "./access-list";
import { nip19 } from "nostr-tools";

describe("readImportFile", () => {
  const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
  it("reads one person per line — npub, hex or nprofile — and says how many are new", () => {
    const text = [nip19.npubEncode(A), B, nip19.nprofileEncode({ pubkey: C })].join("\n");
    expect(readImportFile(text, [])).toEqual({ add: [A, B, C], already: 0, unreadable: 0 });
  });
  it("leaves out people already on the list, and anyone listed twice in the file", () => {
    expect(readImportFile(`${A}\n${B}\n${B}`, [A])).toEqual({ add: [B], already: 1, unreadable: 0 });
  });
  it("counts lines it can't read, but not blank lines or a CSV header", () => {
    const text = `name,npub\nAlice,${nip19.npubEncode(A)}\n\nnot a key\n${B},extra`;
    expect(readImportFile(text, [])).toEqual({ add: [A, B], already: 0, unreadable: 1 });
  });
  it("an empty file adds nobody", () => {
    expect(readImportFile("", ["x"])).toEqual({ add: [], already: 0, unreadable: 0 });
  });
});
