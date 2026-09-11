/**
 * Asking to join a group chat (Relay Outpost's own; not in the spec). A
 * moderator shares an ask link. Someone with it sends a private request, a
 * NIP-29-shaped join request (kind 9021) gift-wrapped to that moderator and the
 * owner, who let them in with a direct invite or decline.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
});
vi.stubGlobal("window", { dispatchEvent: () => true });

import { nip19 } from "nostr-tools";
import {
  askLink, parseAskLink, askRecipients, joinRequestTags, parseJoinRequest,
  stashJoinRequest, listJoinRequests, resolveJoinRequest, type JoinRequest,
} from "./concord-join-requests";

const hex = (c: string) => c.repeat(64);
const CREATOR = hex("1"), OWNER = hex("0"), ASKER = hex("5"), CID = hex("c");
const info = { communityId: CID, owner: OWNER, name: "Book Club" };

describe("the ask link", () => {
  it("names who to ask and which group, and reads back", () => {
    const url = askLink("https://relayop.xyz", CREATOR, info);
    expect(url.startsWith(`https://relayop.xyz/ask/${nip19.npubEncode(CREATOR)}#`)).toBe(true);
    const [path, fragment] = url.split("#");
    expect(parseAskLink(path.split("/ask/")[1], fragment)).toEqual({ creator: CREATOR, ...info });
  });

  it("keeps the group in the part of the link no server sees", () => {
    const beforeFragment = askLink("https://relayop.xyz", CREATOR, info).split("#")[0];
    expect(beforeFragment).not.toContain(CID);
    expect(beforeFragment).not.toContain("Book");
  });

  it("refuses a damaged link", () => {
    expect(parseAskLink("npub1nope", "abc")).toBeNull();
    expect(parseAskLink(nip19.npubEncode(CREATOR), "")).toBeNull();
    expect(parseAskLink(nip19.npubEncode(CREATOR), "!!!")).toBeNull();
  });

  it("asks the link's moderator and the owner, once each", () => {
    expect(askRecipients(CREATOR, OWNER)).toEqual([CREATOR, OWNER]);
    expect(askRecipients(OWNER, OWNER)).toEqual([OWNER]);
  });
});

describe("a request", () => {
  it("names the group, and reads back with who asked and what they said", () => {
    expect(joinRequestTags(CID)).toEqual([["concord", CID]]);
    // As the gift wrap builds it: the recipient's `p` first.
    const r = parseJoinRequest({ senderPubkey: ASKER, content: "  I'm in the Tuesday group  ", timestamp: 100, rumorId: hex("a"), tags: [["p", CREATOR], ...joinRequestTags(CID)] });
    expect(r).toEqual({ id: hex("a"), requester: ASKER, at: 100, communityId: CID, note: "I'm in the Tuesday group" });
  });

  it("refuses one that doesn't name a group, and keeps a note short", () => {
    expect(parseJoinRequest({ senderPubkey: ASKER, content: "", timestamp: 1, rumorId: hex("a"), tags: [] })).toBeNull();
    expect(parseJoinRequest({ senderPubkey: ASKER, content: "n".repeat(900), timestamp: 1, rumorId: hex("a"), tags: joinRequestTags(CID) })!.note.length).toBeLessThanOrEqual(280);
  });
});

describe("the requests a moderator has", () => {
  beforeEach(() => __store.clear());
  const req = (id: string, requester: string, at: number, communityId = CID): JoinRequest => ({ id, requester, at, communityId, note: "" });

  it("keeps one per person per group, the latest, newest first", () => {
    expect(stashJoinRequest(OWNER, req(hex("1"), ASKER, 100))).toBe(true);
    expect(stashJoinRequest(OWNER, req(hex("2"), ASKER, 200))).toBe(true);
    stashJoinRequest(OWNER, req(hex("3"), hex("6"), 150));
    stashJoinRequest(OWNER, req(hex("4"), hex("7"), 300, hex("f")));
    expect(listJoinRequests(OWNER, CID).map((r) => r.id)).toEqual([hex("2"), hex("3")]);
  });

  it("an older request never replaces a newer one", () => {
    stashJoinRequest(OWNER, req(hex("2"), ASKER, 200));
    expect(stashJoinRequest(OWNER, req(hex("1"), ASKER, 100))).toBe(false);
    expect(listJoinRequests(OWNER, CID).map((r) => r.id)).toEqual([hex("2")]);
  });

  it("a handled request leaves and stays gone if it arrives again; asking again later is new", () => {
    stashJoinRequest(OWNER, req(hex("1"), ASKER, 100));
    resolveJoinRequest(OWNER, hex("1"));
    expect(listJoinRequests(OWNER, CID)).toEqual([]);
    expect(stashJoinRequest(OWNER, req(hex("1"), ASKER, 100))).toBe(false);
    expect(stashJoinRequest(OWNER, req(hex("9"), ASKER, 500))).toBe(true);
  });

  it("keeps each account's requests apart", () => {
    stashJoinRequest(OWNER, req(hex("1"), ASKER, 100));
    expect(listJoinRequests(CREATOR, CID)).toEqual([]);
  });
});
