import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import {
  isGroupModerator,
  admittableGroups,
  pendingFor,
  orderQueue,
  mergeQueues,
  type PendingAdmission,
} from "./admission-queue";
import type { GroupAdmin, GroupMetadata, JoinRequest } from "@/lib/nip29";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const ALICE = "c".repeat(64);
const BOB = "d".repeat(64);

const group = (id: string, over: Partial<GroupMetadata> = {}): GroupMetadata => ({
  id,
  isPrivate: false,
  isRestricted: false,
  isHidden: false,
  isClosed: true,
  isOpen: false,
  ...over,
});

const req = (pubkey: string, createdAt: number, over: Partial<JoinRequest> = {}): JoinRequest => ({
  pubkey,
  createdAt,
  eventId: `evt-${pubkey}-${createdAt}`,
  ...over,
});

describe("isGroupModerator", () => {
  it("is true when the account is in the admin list", () => {
    expect(isGroupModerator([{ pubkey: ME, roles: ["admin"] }], ME)).toBe(true);
  });

  it("is false for a non-admin, an empty list, and a signed-out reader", () => {
    expect(isGroupModerator([{ pubkey: OTHER, roles: ["admin"] }], ME)).toBe(false);
    expect(isGroupModerator([], ME)).toBe(false);
    expect(isGroupModerator(undefined, ME)).toBe(false);
    expect(isGroupModerator([{ pubkey: ME, roles: ["admin"] }], null)).toBe(false);
  });
});

describe("admittableGroups", () => {
  const admins = (pk: string): GroupAdmin[] => [{ pubkey: pk, roles: ["admin"] }];

  it("keeps only non-open groups this account moderates", () => {
    const groups = [
      group("closed-mine"),
      group("closed-theirs"),
      group("open-mine", { isClosed: false, isOpen: true }),
    ];
    const byId = new Map<string, GroupAdmin[]>([
      ["closed-mine", admins(ME)],
      ["closed-theirs", admins(OTHER)],
      ["open-mine", admins(ME)],
    ]);
    expect(admittableGroups(groups, byId, ME).map((g) => g.id)).toEqual(["closed-mine"]);
  });

  it("drops an open group even when you run it", () => {
    // Nothing to approve: an open group admits people without asking.
    const byId = new Map([["g", admins(ME)]]);
    expect(admittableGroups([group("g", { isClosed: false, isOpen: true })], byId, ME)).toEqual([]);
  });

  it("KEEPS a group whose doors the relay never described — unknown is not open", () => {
    // The defect this rule exists to prevent. A relay may decline to serve
    // metadata for a room, or omit the `closed` tag the room was created with;
    // on 0xchat the closed room is simply absent from the group listing. Under
    // the old `isClosed` gate every one of those cases rendered as "nobody is
    // waiting" to an operator with people at the door. Only a stated `open`
    // earns a skip.
    const unknown = group("no-metadata-served", { isClosed: false, isOpen: false });
    const byId = new Map([["no-metadata-served", admins(ME)]]);
    expect(admittableGroups([unknown], byId, ME).map((g) => g.id)).toEqual(["no-metadata-served"]);
  });

  it("returns nothing when signed out", () => {
    const byId = new Map([["g", admins(ME)]]);
    expect(admittableGroups([group("g")], byId, null)).toEqual([]);
  });
});

describe("pendingFor", () => {
  const ctx = { relayUrl: "wss://r.example", group: { id: "g1", name: "Bitcoin Park" } };

  it("keeps requests from people who are not members yet", () => {
    const out = pendingFor([req(ALICE, 100)], [], ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      relayUrl: "wss://r.example",
      groupId: "g1",
      groupName: "Bitcoin Park",
      pubkey: ALICE,
      createdAt: 100,
    });
  });

  it("drops anyone already inside", () => {
    // The regression this prevents: a 9021 lives on the relay forever, so an
    // approved member keeps reappearing in the queue asking to be let in again.
    const out = pendingFor([req(ALICE, 100), req(BOB, 200)], [ALICE], ctx);
    expect(out.map((p) => p.pubkey)).toEqual([BOB]);
  });

  it("collapses a repeat asker to their most recent request", () => {
    const out = pendingFor([req(ALICE, 100), req(ALICE, 300), req(ALICE, 200)], [], ctx);
    expect(out).toHaveLength(1);
    expect(out[0].createdAt).toBe(300);
  });

  it("carries the invite code through", () => {
    // Presence of a code is the evidence: a member handed them a link.
    const out = pendingFor([req(ALICE, 100, { code: "abc123" })], [], ctx);
    expect(out[0].code).toBe("abc123");
  });

  it("is empty when everyone asking is already a member", () => {
    expect(pendingFor([req(ALICE, 1), req(BOB, 2)], [ALICE, BOB], ctx)).toEqual([]);
  });
});

describe("orderQueue — oldest first", () => {
  const item = (pubkey: string, createdAt: number): PendingAdmission => ({
    relayUrl: "wss://r", groupId: "g", pubkey, createdAt, eventId: `e${createdAt}`,
  });

  it("puts the longest wait at the top", () => {
    // A queue is not a feed. Newest-first would bury the person who has been
    // waiting longest — the one actually being kept out.
    const out = orderQueue([item(ALICE, 300), item(BOB, 100), item(OTHER, 200)]);
    expect(out.map((p) => p.createdAt)).toEqual([100, 200, 300]);
  });

  it("does not mutate its input", () => {
    const input = [item(ALICE, 300), item(BOB, 100)];
    orderQueue(input);
    expect(input.map((p) => p.createdAt)).toEqual([300, 100]);
  });
});

describe("mergeQueues", () => {
  const item = (relayUrl: string, groupId: string, pubkey: string, createdAt: number): PendingAdmission =>
    ({ relayUrl, groupId, pubkey, createdAt, eventId: `${groupId}-${pubkey}` });

  it("combines every space into one oldest-first list", () => {
    const out = mergeQueues([
      [item("wss://a", "g1", ALICE, 300)],
      [item("wss://b", "g2", BOB, 100)],
    ]);
    expect(out.map((p) => p.createdAt)).toEqual([100, 300]);
  });

  it("keeps the SAME person knocking on two different doors as two decisions", () => {
    // Approving Alice into one space says nothing about the other.
    const out = mergeQueues([
      [item("wss://a", "g1", ALICE, 100)],
      [item("wss://a", "g2", ALICE, 200)],
    ]);
    expect(out).toHaveLength(2);
  });

  it("collapses a genuine duplicate of the same door", () => {
    const out = mergeQueues([
      [item("wss://a", "g1", ALICE, 100)],
      [item("wss://a", "g1", ALICE, 100)],
    ]);
    expect(out).toHaveLength(1);
  });

  it("handles no spaces and empty spaces", () => {
    expect(mergeQueues([])).toEqual([]);
    expect(mergeQueues([[], []])).toEqual([]);
  });
});

describe("isGroupModerator — normalize BOTH sides", () => {
  // This predicate decides whether you can moderate a NIP-29 room at all, and
  // the pubkeys reaching it come from two different places: a relay's kind-39001
  // tags, and session state. Either can be an npub, uppercase hex, or padded.
  //
  // It used to compare raw strings. That is the defect that locked a real
  // operator out of the ops dashboard (#461), whose stated rule afterwards was
  // "normalize both sides of any external-pubkey compare" — a rule this function
  // was never brought in line with.
  const HEX = "ab".repeat(32);
  const admin = (pubkey: string): GroupAdmin[] => [{ pubkey, roles: [] }] as GroupAdmin[];

  it("matches when the relay's tag is uppercase", () => {
    expect(isGroupModerator(admin(HEX.toUpperCase()), HEX)).toBe(true);
  });

  it("matches when the session pubkey carries whitespace", () => {
    expect(isGroupModerator(admin(HEX), `  ${HEX}  `)).toBe(true);
  });

  it("matches an npub against hex, in EITHER position", () => {
    const npub = nip19.npubEncode(HEX);
    expect(isGroupModerator(admin(npub), HEX)).toBe(true);
    expect(isGroupModerator(admin(HEX), npub)).toBe(true);
  });

  it("matches the right person among several admins", () => {
    const other = "cd".repeat(32);
    expect(isGroupModerator([...admin(other), ...admin(HEX.toUpperCase())], HEX)).toBe(true);
  });

  it("still refuses a genuinely different key", () => {
    expect(isGroupModerator(admin("cd".repeat(32)), HEX)).toBe(false);
  });

  it("refuses unparseable input rather than matching loosely", () => {
    // Normalizing must not become "compare whatever survives". An unreadable key
    // is not a match.
    expect(isGroupModerator(admin("not-a-key"), HEX)).toBe(false);
    expect(isGroupModerator(admin(HEX), "not-a-key")).toBe(false);
  });

  it("refuses when signed out or when the admin list is unknown", () => {
    expect(isGroupModerator(admin(HEX), null)).toBe(false);
    expect(isGroupModerator(null, HEX)).toBe(false);
    expect(isGroupModerator(undefined, HEX)).toBe(false);
  });
});
