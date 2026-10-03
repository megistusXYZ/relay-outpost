import { describe, it, expect } from "vitest";
import { decideOwnership, describeManagement } from "./relay-ownership";
import { readSupportedMethods, UNKNOWN_CAPABILITIES } from "./relay-capabilities";

const ME = "aa".repeat(32);
const SOMEONE = "bb".repeat(32);
const NOSTR1_OWNER = readSupportedMethods({ result: [
  "supportedmethods", "deletedmsuntil", "deletedmsid",
  "banpubkey", "listbannedpubkeys", "deletebannedpubkey", "allowpubkey", "deleteallowedpubkey",
  "listallowedpubkeys", "banevent", "changerelaydescription", "changerelayicon", "changerelayname",
  "allowkind", "disallowkind", "listallowedkinds",
] });
const NOSTR1_STRANGER = readSupportedMethods({ result: ["supportedmethods", "deletedmsuntil", "deletedmsid"] });
const PYRAMID = readSupportedMethods({ result: ["supportedmethods", "banpubkey", "allowpubkey", "listallowedpubkeys", "listbannedpubkeys", "banevent", "changerelayname", "changerelaydescription", "changerelayicon"] });

describe("deciding whether you run a relay", () => {
  it("the relay names you as its owner", () => {
    expect(decideOwnership({ pubkey: ME, nip11: { pubkey: ME }, caps: UNKNOWN_CAPABILITIES, managementReached: true }).kind).toBe("runs-it");
  });

  it("the relay names you as a moderator, whatever case it writes your key in", () => {
    expect(decideOwnership({ pubkey: ME, nip11: { pubkey: SOMEONE, moderators: [ME.toUpperCase()] }, caps: UNKNOWN_CAPABILITIES, managementReached: true }).kind).toBe("runs-it");
  });

  it("names nobody, but accepts your signed management request", () => {
    expect(decideOwnership({ pubkey: ME, nip11: {}, caps: NOSTR1_OWNER, managementReached: true })).toEqual({ kind: "runs-it", via: "relay-confirmed" });
  });

  it("names you and accepts you: says it names you, the plainer reason", () => {
    expect(decideOwnership({ pubkey: ME, nip11: { pubkey: ME }, caps: NOSTR1_OWNER, managementReached: true })).toEqual({ kind: "runs-it", via: "named" });
  });

  it("names someone else and only offers you the self-service methods", () => {
    expect(decideOwnership({ pubkey: ME, nip11: { pubkey: SOMEONE }, caps: NOSTR1_STRANGER, managementReached: true }).kind).toBe("not-yours");
  });

  it("names someone else and doesn't answer management at all", () => {
    expect(decideOwnership({ pubkey: ME, nip11: { pubkey: SOMEONE }, caps: UNKNOWN_CAPABILITIES, managementReached: true }).kind).toBe("not-yours");
  });

  it("names nobody and doesn't answer management: we can't tell, and say so", () => {
    expect(decideOwnership({ pubkey: ME, nip11: {}, caps: UNKNOWN_CAPABILITIES, managementReached: true }).kind).toBe("cannot-tell");
  });

  it("couldn't be reached at all: never a verdict about who runs it", () => {
    expect(decideOwnership({ pubkey: ME, nip11: null, caps: UNKNOWN_CAPABILITIES, managementReached: false }).kind).toBe("unreachable");
  });

  it("answered management but its info page didn't load: the relay's own yes still counts", () => {
    expect(decideOwnership({ pubkey: ME, nip11: null, caps: NOSTR1_OWNER, managementReached: true }).kind).toBe("runs-it");
  });
});

describe("saying what you can manage", () => {
  it("a nostr1.com relay: the basics here, banner and moderators at relay.tools", () => {
    const d = describeManagement(NOSTR1_OWNER, { speaks86: true });
    expect(d.can).toEqual([
      "Ban people and choose who may post",
      "Lift bans",
      "Remove posts",
      "Change its name, description and picture",
      "Choose which kinds of posts it accepts",
    ]);
    expect(d.elsewhere).toEqual(["Its banner", "Its moderators"]);
  });

  it("pyramid: says lifting bans happens elsewhere", () => {
    const d = describeManagement(PYRAMID, { speaks86: true });
    expect(d.can).toContain("Ban people and choose who may post");
    expect(d.can).not.toContain("Lift bans");
    expect(d.elsewhere).toContain("Lifting bans");
  });

  it("a relay that manages but didn't list what: says the usual controls are tried", () => {
    const d = describeManagement(UNKNOWN_CAPABILITIES, { speaks86: true });
    expect(d.can).toEqual([]);
    expect(d.note).toMatch(/didn't say/i);
  });

  it("a relay with no management at all: what still works, and where settings live", () => {
    const d = describeManagement(UNKNOWN_CAPABILITIES, { speaks86: false });
    expect(d.can).toEqual([]);
    expect(d.note).toMatch(/can't be managed from apps/i);
    expect(d.note).toMatch(/reports/i);
  });
});
