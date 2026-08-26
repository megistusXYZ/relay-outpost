import { describe, it, expect } from "vitest";
import {
  msTag, effectiveTime,
  parsePermissions, serializePermissions, hasPermissionBit, memberPermissions, hasPermission, canActOn,
  buildMessageRumor, buildReplyRumor, buildJoinLeaveRumor, buildControlEdition,
  buildReactionRumor, buildDeleteRumor,
  buildAuditRumor, parseAuditRumor,
  buildSnapshotRumor, parseSnapshotRumor,
  parseControlEdition, editionKey, computeEditionId, foldEditions, computeRoster,
  KIND_REACTION, KIND_DELETE, KIND_MESSAGE, KIND_AUDIT, KIND_SNAPSHOT,
  PERM, VSK, OWNER_POSITION,
  type ControlEdition, type Role, type Member,
} from "./concord-events";

// 32-byte hex constants (real eids/pubkeys are always 32-byte hex).
const hx = (b: string) => b.repeat(32);
const CID = hx("aa");
const CH = hx("bb");
const OWNER = hx("11");
const ALICE = hx("22");
const BOB = hx("33");
const EID_ROLE = hx("c1");
const EID_BAN = hx("c3");

// Helper: make a folded ControlEdition with a correctly-linked chain.
function edition(vsk: number, eid: string, ev: number, content: unknown, rumorId: string, prevContent?: unknown, pubkey = OWNER): ControlEdition {
  const c = JSON.stringify(content);
  const prev = ev > 1 && prevContent !== undefined
    ? computeEditionId(eid, ev - 1, undefined, JSON.stringify(prevContent))
    : undefined;
  return { vsk, eid, ev, ep: prev, content: c, rumorId, pubkey };
}

describe("reaction + delete rumors", () => {
  const tag = (r: { tags: string[][] }, k: string) => r.tags.find((t) => t[0] === k);
  it("builds a reaction bound to channel/epoch + target, with the emoji as content", () => {
    const r = buildReactionRumor(ALICE, CH, 3n, "❤️", { id: hx("dd"), pubkey: BOB }, 12, 1_700_000_000);
    expect(r.kind).toBe(KIND_REACTION);
    expect(r.content).toBe("❤️");
    expect(tag(r, "channel")![1]).toBe(CH);
    expect(tag(r, "epoch")![1]).toBe("3");
    expect(tag(r, "e")![1]).toBe(hx("dd"));
    expect(tag(r, "p")![1]).toBe(BOB);
    expect(tag(r, "k")![1]).toBe(String(KIND_MESSAGE));
    expect(tag(r, "emoji")).toBeUndefined();
  });
  it("carries a NIP-30 emoji tag for a custom reaction", () => {
    const r = buildReactionRumor(ALICE, CH, 1n, ":party:", { id: hx("dd"), pubkey: BOB }, 0, 1, { shortcode: "party", url: "https://x/p.png" });
    expect(tag(r, "emoji")).toEqual(["emoji", "party", "https://x/p.png"]);
  });
  it("builds a delete tombstone referencing the target id", () => {
    const d = buildDeleteRumor(ALICE, CH, 1n, hx("ee"), 0, 1);
    expect(d.kind).toBe(KIND_DELETE);
    expect(tag(d, "e")![1]).toBe(hx("ee"));
    expect(tag(d, "channel")![1]).toBe(CH);
  });
});

describe("audit log rumors (kind 3314)", () => {
  it("round-trips a ban with target + reason (actor is the rumor pubkey)", () => {
    const r = buildAuditRumor(OWNER, "ban", 1_700_000_000, { target: BOB, reason: "spam" });
    expect(r.kind).toBe(KIND_AUDIT);
    const parsed = parseAuditRumor({ ...r, id: hx("ab"), tags: r.tags });
    expect(parsed).toEqual({ id: hx("ab"), actor: OWNER, action: "ban", target: BOB, reason: "spam", detail: undefined, t: 1_700_000_000 });
  });
  it("carries channel detail (not a target) for a rename, with no reason", () => {
    const r = buildAuditRumor(ALICE, "rename_channel", 42, { detail: "off-topic" });
    const parsed = parseAuditRumor({ ...r, id: hx("cd"), tags: r.tags });
    expect(parsed).toMatchObject({ actor: ALICE, action: "rename_channel", detail: "off-topic", reason: undefined, target: undefined });
  });
  it("rejects a rumor with no action tag", () => {
    const r = buildAuditRumor(OWNER, "dissolve", 1);
    const stripped = { ...r, id: hx("ef"), tags: r.tags.filter((t) => t[0] !== "action") };
    expect(parseAuditRumor(stripped)).toBeNull();
  });
});

describe("ms tag + effective time (CORD-02 §5)", () => {
  it("builds a valid ms tag and rejects out-of-range", () => {
    expect(msTag(500)).toEqual(["ms", "500"]);
    expect(() => msTag(1000)).toThrow();
    expect(() => msTag(-1)).toThrow();
  });
  it("computes created_at*1000 + ms, folding malformed to 0", () => {
    expect(effectiveTime({ created_at: 100, tags: [["ms", "250"]] })).toBe(100_250);
    expect(effectiveTime({ created_at: 100, tags: [] })).toBe(100_000);
    expect(effectiveTime({ created_at: 100, tags: [["ms", "abc"]] })).toBe(100_000);
  });
});

describe("permission math (CORD-04)", () => {
  it("parses/serializes decimal permission strings (no float corruption)", () => {
    const bits = PERM.MANAGE_ROLES | PERM.BAN | PERM.MENTION_EVERYONE;
    const dec = serializePermissions(bits);
    expect(parsePermissions(dec)).toBe(bits);
    expect(parsePermissions("not-a-number")).toBe(0n);
  });
  it("unions role bits and checks membership", () => {
    const roles = new Map<string, Role>([
      ["r1", { role_id: "r1", name: "mod", position: 5, permissions: PERM.KICK | PERM.BAN, scope: { kind: "server" } }],
      ["r2", { role_id: "r2", name: "poster", position: 9, permissions: PERM.MENTION_EVERYONE, scope: { kind: "server" } }],
    ]);
    const bits = memberPermissions(["r1", "r2"], roles);
    expect(hasPermissionBit(bits, PERM.KICK)).toBe(true);
    expect(hasPermissionBit(bits, PERM.MENTION_EVERYONE)).toBe(true);
    expect(hasPermissionBit(bits, PERM.MANAGE_ROLES)).toBe(false);
  });
  it("owner has every permission regardless of bits", () => {
    const owner: Member = { pubkey: OWNER, joinedAt: 0, roleIds: [], permissions: 0n, rank: OWNER_POSITION };
    expect(hasPermission(owner, PERM.MANAGE_ROLES)).toBe(true);
  });
  it("canActOn requires strict outranking (equal cannot act on equal)", () => {
    expect(canActOn(0, 5)).toBe(true);
    expect(canActOn(5, 5)).toBe(false);
    expect(canActOn(9, 5)).toBe(false);
  });
});

describe("rumor builders (CORD-03)", () => {
  it("message carries mandatory channel+epoch+ms binding tags", () => {
    const r = buildMessageRumor(ALICE, CH, 3n, "hi", 12, 1_700_000_000);
    expect(r.kind).toBe(9);
    expect(r.tags).toContainEqual(["channel", CH]);
    expect(r.tags).toContainEqual(["epoch", "3"]);
    expect(r.tags).toContainEqual(["ms", "12"]);
  });
  it("reply carries uppercase root + lowercase parent refs", () => {
    const r = buildReplyRumor(ALICE, CH, 1n, "re", 0, 1_700_000_000, {
      rootKind: 9, rootId: "root", rootPubkey: OWNER, parentKind: 9, parentId: "par", parentPubkey: BOB,
    });
    expect(r.tags).toContainEqual(["K", "9"]);
    expect(r.tags).toContainEqual(["E", "root"]);
    expect(r.tags).toContainEqual(["e", "par"]);
    expect(r.tags).toContainEqual(["p", BOB]);
  });
  it("join/leave records the action", () => {
    expect(buildJoinLeaveRumor(ALICE, true, 1).tags).toContainEqual(["action", "join"]);
    expect(buildJoinLeaveRumor(ALICE, false, 1).tags).toContainEqual(["action", "leave"]);
  });
});

describe("control edition parse + id", () => {
  it("builds and parses an edition round-trip", () => {
    const tmpl = buildControlEdition(OWNER, VSK.METADATA, CID, 1, { name: "My Community", relays: ["wss://a"] }, 1_700_000_000);
    const parsed = parseControlEdition({ ...tmpl, id: "rumor1" });
    expect(parsed).not.toBeNull();
    expect(parsed!.vsk).toBe(VSK.METADATA);
    expect(parsed!.eid).toBe(CID);
    expect(parsed!.ev).toBe(1);
    expect(parsed!.ep).toBeUndefined();
  });
  it("computeEditionId is deterministic and version/prev sensitive", () => {
    const a = computeEditionId(CID, 1, undefined, '{"x":1}');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEditionId(CID, 1, undefined, '{"x":1}')).toBe(a);
    expect(computeEditionId(CID, 2, undefined, '{"x":1}')).not.toBe(a);
    expect(computeEditionId(CID, 1, "cc".repeat(32), '{"x":1}')).not.toBe(a);
  });
  it("parses a vac authority citation", () => {
    const tmpl = buildControlEdition(ALICE, VSK.CHANNEL, CH, 1, { channel_id: CH, name: "general" }, 1, { vac: ["grant-eid", "2", "grant-hash"] });
    const parsed = parseControlEdition({ ...tmpl, id: "r" });
    expect(parsed!.vac).toEqual(["grant-eid", "2", "grant-hash"]);
  });
});

describe("foldEditions (CORD-04 structural)", () => {
  it("keeps the highest version of an entity with an intact chain", () => {
    const v1 = { name: "v1", relays: [] };
    const v2 = { name: "v2", relays: ["wss://x"] };
    const state = foldEditions([
      edition(VSK.METADATA, CID, 1, v1, "r1"),
      edition(VSK.METADATA, CID, 2, v2, "r2", v1),
    ], OWNER);
    expect(state.metadata!.name).toBe("v2");
    expect(state.metadata!.relays).toEqual(["wss://x"]);
  });
  it("does not let a v2 with a broken ep win over v1", () => {
    const v1 = { name: "v1", relays: [] };
    const orphan: ControlEdition = { vsk: VSK.METADATA, eid: CID, ev: 2, ep: "dead".repeat(16), content: JSON.stringify({ name: "orphan", relays: [] }), rumorId: "r2", pubkey: OWNER };
    const state = foldEditions([edition(VSK.METADATA, CID, 1, v1, "r1"), orphan], OWNER);
    expect(state.metadata!.name).toBe("v1"); // orphan rejected
  });
  it("ties on version break to the lower rumor id", () => {
    const state = foldEditions([
      { vsk: VSK.METADATA, eid: CID, ev: 1, content: JSON.stringify({ name: "zzz", relays: [] }), rumorId: "rZ", pubkey: OWNER },
      { vsk: VSK.METADATA, eid: CID, ev: 1, content: JSON.stringify({ name: "aaa", relays: [] }), rumorId: "rA", pubkey: OWNER },
    ], OWNER);
    expect(state.metadata!.name).toBe("aaa"); // rA < rZ
  });
  it("caps relays at 5 and folds roles/channels/grants/ban/dissolved", () => {
    const state = foldEditions([
      edition(VSK.METADATA, CID, 1, { name: "c", relays: ["a", "b", "c", "d", "e", "f"] }, "r1"),
      edition(VSK.ROLE, EID_ROLE, 1, { role_id: "role1", name: "mod", position: 5, permissions: serializePermissions(PERM.KICK) }, "r2"),
      edition(VSK.CHANNEL, CH, 1, { channel_id: CH, name: "general" }, "r3"),
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["role1"] }, "r4"),
      edition(VSK.BANLIST, EID_BAN, 1, [BOB], "r5"),
    ], OWNER);
    expect(state.metadata!.relays).toHaveLength(5);
    expect(state.roles.get("role1")!.permissions).toBe(PERM.KICK);
    expect(state.channels.get(CH)!.name).toBe("general");
    expect(state.grants.get(ALICE)).toEqual(["role1"]);
    expect(state.banlist.has(BOB)).toBe(true);
  });
  it("an owner-signed empty grant role_ids array revokes (authority required)", () => {
    const state = foldEditions([
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["role1"] }, "r1"),
      edition(VSK.GRANT, ALICE, 2, { member: ALICE, role_ids: [] }, "r2", { member: ALICE, role_ids: ["role1"] }),
    ], OWNER);
    expect(state.grants.has(ALICE)).toBe(false);
    // A non-owner with no MANAGE_ROLES cannot vacuously revoke: the empty grant
    // is NOT admitted, so the standing v1 grant survives (was the CVE).
    const attacked = foldEditions([
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["role1"] }, "r1"),
      edition(VSK.GRANT, ALICE, 2, { member: ALICE, role_ids: [] }, "rX", { member: ALICE, role_ids: ["role1"] }, BOB),
    ], OWNER);
    expect(attacked.grants.get(ALICE)).toEqual(["role1"]);
  });
  it("a channel edition marked deleted drops the channel", () => {
    const state = foldEditions([
      edition(VSK.CHANNEL, CH, 1, { channel_id: CH, name: "general" }, "r1"),
      edition(VSK.CHANNEL, CH, 2, { channel_id: CH, name: "general", deleted: true }, "r2", { channel_id: CH, name: "general" }),
    ], OWNER);
    expect(state.channels.has(CH)).toBe(false);
  });
});

// ── Armada wire-shape interop (tolerant dual-read) ───────────────────────────
// Shapes captured live from an Armada-authored community's control plane (the
// Soapbox invite replay, 2026-07-19; values synthesized, structure verbatim):
//  - CHANNEL editions carry NO channel_id in content — {"name":…,"private":…}
//    only; the edition eid IS the channel id (CORD-04 entity coordinate).
//  - The METADATA head arrives at ev>1 with an `ep` whose parents were pruned
//    from the relays (Armada doesn't retain superseded editions).
//  - METADATA content: {"name":…,"relays":[…],"icon":{url,key,nonce,hash}} —
//    icon is an encrypted-blob OBJECT, not a string URL.
//  - Non-owner (admin) editions ride on owner-signed role+grant authority.
// Before the dual-read fix, all channels collapsed onto one `undefined` key
// and the metadata head was dropped by full-chain verification → a joined
// Armada community folded to "no name, one broken channel".
describe("foldEditions Armada-shape interop", () => {
  const ADMIN = hx("66");
  const EID_ADMIN_ROLE = hx("a1");
  const CH_GENERAL = hx("e1");
  const CH_BITCOIN = hx("e2");
  const DANGLING = hx("f0"); // parent hash nobody holds (pruned upstream)

  const armadaEditions = (): ControlEdition[] => [
    // metadata head at ev=4, chain pruned upstream, icon = encrypted-blob object
    { vsk: VSK.METADATA, eid: CID, ev: 4, ep: DANGLING, rumorId: "m4", pubkey: ADMIN,
      content: JSON.stringify({ name: "Soapbox Community", relays: ["wss://relay.ditto.pub", "wss://relay.dreamith.to"], icon: { url: "https://blossom.example/x.enc", key: hx("07"), nonce: "eb".repeat(16), hash: hx("08") } }) },
    // owner-signed Admin role + grant → the admin's standing authority
    { vsk: VSK.ROLE, eid: EID_ADMIN_ROLE, ev: 1, rumorId: "role1", pubkey: OWNER,
      content: JSON.stringify({ role_id: EID_ADMIN_ROLE, name: "Admin", position: 1, permissions: "895", scope: { kind: "server" }, color: 0 }) },
    { vsk: VSK.GRANT, eid: hx("a2"), ev: 1, rumorId: "grant1", pubkey: OWNER,
      content: JSON.stringify({ member: ADMIN, role_ids: [EID_ADMIN_ROLE] }) },
    // channel editions WITHOUT channel_id in content (eid = channel id)
    { vsk: VSK.CHANNEL, eid: CH_GENERAL, ev: 1, rumorId: "ch1", pubkey: OWNER,
      content: JSON.stringify({ name: "general", private: false }) },
    { vsk: VSK.CHANNEL, eid: CH_BITCOIN, ev: 1, rumorId: "ch2", pubkey: ADMIN,
      content: JSON.stringify({ name: "bitcoin", private: false }) },
    // banlist (same shape as ours — regression canary)
    { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, rumorId: "ban1", pubkey: OWNER,
      content: JSON.stringify([BOB]) },
    // vsk-8 invite-link registry rows (unknown to our fold — must be ignored)
    { vsk: VSK.REGISTRY, eid: hx("a3"), ev: 1, rumorId: "reg1", pubkey: ADMIN,
      content: JSON.stringify([hx("09")]) },
  ];

  it("folds each channel under its edition eid when content has no channel_id", () => {
    const state = foldEditions(armadaEditions(), OWNER);
    expect(state.channels.size).toBe(2);
    expect(state.channels.get(CH_GENERAL)!.name).toBe("general");
    expect(state.channels.get(CH_BITCOIN)!.name).toBe("bitcoin");
    expect(state.channels.get(CH_BITCOIN)!.channel_id).toBe(CH_BITCOIN);
    expect(state.channels.has("undefined" as never)).toBe(false);
  });

  it("accepts a pruned-chain metadata head (no held parent to contradict it)", () => {
    const state = foldEditions(armadaEditions(), OWNER);
    expect(state.metadata).toBeDefined();
    expect(state.metadata!.name).toBe("Soapbox Community");
    expect(state.metadata!.relays).toEqual(["wss://relay.ditto.pub", "wss://relay.dreamith.to"]);
  });

  it("still rejects a dangling head when a held parent version contradicts it", () => {
    // Same entity: an intact v1 exists whose hash ≠ the head's claimed ep —
    // the head cites a history that contradicts what we hold (the original
    // orphan-v2 security property, unchanged by the tolerance).
    const v1 = { name: "honest", relays: [] };
    const state = foldEditions([
      edition(VSK.METADATA, CID, 1, v1, "r1"),
      { vsk: VSK.METADATA, eid: CID, ev: 2, ep: DANGLING, rumorId: "r2", pubkey: OWNER,
        content: JSON.stringify({ name: "forged", relays: [] }) },
    ], OWNER);
    expect(state.metadata!.name).toBe("honest");
  });

  it("admits the admin's editions via owner-granted authority (fixpoint)", () => {
    const state = foldEditions(armadaEditions(), OWNER);
    // The metadata head + a channel are ADMIN-signed: only foldable because the
    // owner-signed role (perms 895 ⊇ MANAGE_METADATA|MANAGE_CHANNELS) + grant
    // seed the fixpoint. Registry rows (vsk 8) fold to nothing.
    expect(state.metadata!.name).toBe("Soapbox Community");
    expect(state.channels.get(CH_BITCOIN)!.name).toBe("bitcoin");
    expect(state.grants.get(ADMIN)).toEqual([EID_ADMIN_ROLE]);
  });
});

describe("foldEditions authority gating (CORD-04 §authority)", () => {
  const MALLORY = hx("44");
  const CAROL = hx("55");
  const EID_MGR = hx("d1");
  const EID_GUEST = hx("d2");
  const EID_HIGH = hx("d3");
  const EID_CHANMGR = hx("d4");
  const EID_COADMIN = hx("d5");
  const dec = serializePermissions;

  it("admits a non-owner MANAGE_ROLES holder granting a role they outrank", () => {
    const state = foldEditions([
      edition(VSK.ROLE, EID_MGR, 1, { role_id: "manager", name: "mgr", position: 2, permissions: dec(PERM.MANAGE_ROLES) }, "r1"),
      edition(VSK.ROLE, EID_GUEST, 1, { role_id: "guest", name: "guest", position: 5, permissions: "0" }, "r2"),
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["manager"] }, "r3"), // owner → Alice
      edition(VSK.GRANT, BOB, 1, { member: BOB, role_ids: ["guest"] }, "r4", undefined, ALICE), // Alice → Bob
    ], OWNER);
    expect(state.grants.get(BOB)).toEqual(["guest"]);
  });

  it("admits a non-owner grant carrying a VALID vac citation to its authority", () => {
    const aliceGrantHash = computeEditionId(ALICE, 1, undefined, JSON.stringify({ member: ALICE, role_ids: ["manager"] }));
    const bobGrant: ControlEdition = {
      vsk: VSK.GRANT, eid: BOB, ev: 1, content: JSON.stringify({ member: BOB, role_ids: ["guest"] }),
      rumorId: "r5", pubkey: ALICE, vac: [ALICE, "1", aliceGrantHash],
    };
    const state = foldEditions([
      edition(VSK.ROLE, EID_MGR, 1, { role_id: "manager", name: "mgr", position: 2, permissions: dec(PERM.MANAGE_ROLES) }, "r1"),
      edition(VSK.ROLE, EID_GUEST, 1, { role_id: "guest", name: "guest", position: 5, permissions: "0" }, "r2"),
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["manager"] }, "r3"),
      bobGrant,
    ], OWNER);
    expect(state.grants.get(BOB)).toEqual(["guest"]);
  });

  it("REGRESSION (disclosed CVE): a non-authority member's vacuous revoke of a peer is REJECTED", () => {
    // Owner grants Alice an admin-ish role. Mallory (a plain member with no
    // roles) publishes an empty-role_ids grant chained onto Alice's — the exact
    // shape of the disclosed exploit. Pre-patch this vacuously stripped Alice.
    const state = foldEditions([
      edition(VSK.ROLE, EID_COADMIN, 1, { role_id: "coadmin", name: "coadmin", position: 1, permissions: dec(PERM.MANAGE_ROLES) }, "r1"),
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["coadmin"] }, "r2"),
      edition(VSK.GRANT, ALICE, 2, { member: ALICE, role_ids: [] }, "rM", { member: ALICE, role_ids: ["coadmin"] }, MALLORY),
    ], OWNER);
    expect(state.grants.get(ALICE)).toEqual(["coadmin"]); // Alice keeps her role
  });

  it("rejects an equal-rank peer's vacuous revoke (CVE rank dimension)", () => {
    // Bob holds the same rank-1 role as Alice; equal cannot act on equal.
    const state = foldEditions([
      edition(VSK.ROLE, EID_COADMIN, 1, { role_id: "coadmin", name: "coadmin", position: 1, permissions: dec(PERM.MANAGE_ROLES) }, "r1"),
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["coadmin"] }, "r2"),
      edition(VSK.GRANT, BOB, 1, { member: BOB, role_ids: ["coadmin"] }, "r3"),
      edition(VSK.GRANT, ALICE, 2, { member: ALICE, role_ids: [] }, "r4", { member: ALICE, role_ids: ["coadmin"] }, BOB),
    ], OWNER);
    expect(state.grants.get(ALICE)).toEqual(["coadmin"]);
  });

  it("rejects a non-authority member self-granting ADMIN", () => {
    const state = foldEditions([
      edition(VSK.ROLE, EID_MGR, 1, { role_id: "admin", name: "admin", position: 1, permissions: dec(PERM.MANAGE_ROLES | PERM.MANAGE_CHANNELS | PERM.BAN) }, "r1"),
      edition(VSK.GRANT, MALLORY, 1, { member: MALLORY, role_ids: ["admin"] }, "r2", undefined, MALLORY), // self-grant
    ], OWNER);
    expect(state.grants.has(MALLORY)).toBe(false);
  });

  it("rejects a lower-ranked MANAGE_ROLES holder demoting a higher grant (rank bypass)", () => {
    const state = foldEditions([
      edition(VSK.ROLE, EID_MGR, 1, { role_id: "manager", name: "mgr", position: 2, permissions: dec(PERM.MANAGE_ROLES) }, "r1"),
      edition(VSK.ROLE, EID_HIGH, 1, { role_id: "high", name: "high", position: 1, permissions: "0" }, "r2"),
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["manager"] }, "r3"), // Alice rank 2, MANAGE_ROLES
      edition(VSK.GRANT, CAROL, 1, { member: CAROL, role_ids: ["high"] }, "r4"),     // Carol rank 1
      edition(VSK.GRANT, CAROL, 2, { member: CAROL, role_ids: [] }, "r5", { member: CAROL, role_ids: ["high"] }, ALICE), // Alice → revoke Carol
    ], OWNER);
    expect(state.grants.get(CAROL)).toEqual(["high"]); // Alice cannot demote a higher grant
  });

  it("rejects an edition whose vac cites a NON-ADMITTED (forged) predecessor", () => {
    const setup: ControlEdition[] = [
      edition(VSK.ROLE, EID_CHANMGR, 1, { role_id: "chan", name: "chan", position: 3, permissions: dec(PERM.MANAGE_CHANNELS) }, "r1"),
      edition(VSK.GRANT, MALLORY, 1, { member: MALLORY, role_ids: ["chan"] }, "r2"), // owner really grants Mallory MANAGE_CHANNELS
    ];
    const forged: ControlEdition = {
      vsk: VSK.CHANNEL, eid: CH, ev: 1, content: JSON.stringify({ channel_id: CH, name: "x" }),
      rumorId: "rF", pubkey: MALLORY, vac: [hx("ff"), "1", hx("de")], // vac points at nothing admitted
    };
    const rejected = foldEditions([...setup, forged], OWNER);
    expect(rejected.channels.has(CH)).toBe(false);
    // The SAME edition without the bogus vac IS admitted — proving the vac guard
    // (not the capability check) did the rejecting above.
    const clean: ControlEdition = { ...forged, vac: undefined, rumorId: "rG" };
    const ok = foldEditions([...setup, clean], OWNER);
    expect(ok.channels.get(CH)?.name).toBe("x");
  });

  it("rejects ban/channel/metadata/dissolve from a non-authority member; owner may do all", () => {
    const attackerState = foldEditions([
      edition(VSK.METADATA, CID, 1, { name: "owned", relays: [] }, "r0"), // owner metadata
      edition(VSK.BANLIST, EID_BAN, 1, [BOB], "rb", undefined, MALLORY),
      edition(VSK.CHANNEL, CH, 1, { channel_id: CH, name: "hijack" }, "rc", undefined, MALLORY),
      edition(VSK.METADATA, CID, 2, { name: "hacked", relays: [] }, "rm", { name: "owned", relays: [] }, MALLORY),
      edition(VSK.DISSOLVED, CID, 1, { dissolved: true }, "rd", undefined, MALLORY),
    ], OWNER);
    expect(attackerState.banlist.has(BOB)).toBe(false);
    expect(attackerState.channels.has(CH)).toBe(false);
    expect(attackerState.metadata!.name).toBe("owned");
    expect(attackerState.dissolved).toBe(false);

    const ownerState = foldEditions([
      edition(VSK.METADATA, CID, 1, { name: "owned", relays: [] }, "r0"),
      edition(VSK.BANLIST, EID_BAN, 1, [BOB], "rb"),
      edition(VSK.CHANNEL, CH, 1, { channel_id: CH, name: "general" }, "rc"),
      edition(VSK.METADATA, CID, 2, { name: "renamed", relays: [] }, "rm", { name: "owned", relays: [] }),
      edition(VSK.DISSOLVED, CID, 1, { dissolved: true }, "rd"),
    ], OWNER);
    expect(ownerState.banlist.has(BOB)).toBe(true);
    expect(ownerState.channels.get(CH)?.name).toBe("general");
    expect(ownerState.metadata!.name).toBe("renamed");
    expect(ownerState.dissolved).toBe(true);
  });

  it("rejects a non-owner banning a member they do not outrank (incl. the owner)", () => {
    const state = foldEditions([
      edition(VSK.ROLE, EID_MGR, 1, { role_id: "banner", name: "banner", position: 2, permissions: dec(PERM.BAN) }, "r1"),
      edition(VSK.ROLE, EID_HIGH, 1, { role_id: "high", name: "high", position: 1, permissions: "0" }, "r2"),
      edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["banner"] }, "r3"), // Alice rank 2, BAN
      edition(VSK.GRANT, CAROL, 1, { member: CAROL, role_ids: ["high"] }, "r4"),     // Carol rank 1
      edition(VSK.BANLIST, EID_BAN, 1, [CAROL], "r5", undefined, ALICE),             // Alice bans a superior
    ], OWNER);
    expect(state.banlist.has(CAROL)).toBe(false);
  });
});

describe("computeRoster (CORD-04)", () => {
  const base = foldEditions([
    edition(VSK.ROLE, EID_ROLE, 1, { role_id: "mod", name: "mod", position: 5, permissions: serializePermissions(PERM.KICK | PERM.BAN) }, "r1"),
    edition(VSK.GRANT, ALICE, 1, { member: ALICE, role_ids: ["mod"] }, "r2"),
  ], OWNER);

  it("includes the owner at rank 0 with no join rumor", () => {
    const roster = computeRoster([], base, OWNER);
    const owner = roster.find((m) => m.pubkey === OWNER)!;
    expect(owner.rank).toBe(OWNER_POSITION);
    expect(hasPermission(owner, PERM.MANAGE_ROLES)).toBe(true);
  });
  it("adds a joined member with their granted role's rank + perms", () => {
    const roster = computeRoster([{ pubkey: ALICE, created_at: 10, tags: [["action", "join"]] }], base, OWNER);
    const alice = roster.find((m) => m.pubkey === ALICE)!;
    expect(alice.rank).toBe(5);
    expect(hasPermissionBit(alice.permissions, PERM.KICK)).toBe(true);
  });
  it("drops a member whose latest action is leave", () => {
    const roster = computeRoster([
      { pubkey: ALICE, created_at: 10, tags: [["action", "join"]] },
      { pubkey: ALICE, created_at: 20, tags: [["action", "leave"]] },
    ], base, OWNER);
    expect(roster.find((m) => m.pubkey === ALICE)).toBeUndefined();
  });
  it("drops a banned member even if joined", () => {
    const banned = foldEditions([edition(VSK.BANLIST, EID_BAN, 1, [ALICE], "r9")], OWNER);
    const roster = computeRoster([{ pubkey: ALICE, created_at: 10, tags: [["action", "join"]] }], banned, OWNER);
    expect(roster.find((m) => m.pubkey === ALICE)).toBeUndefined();
  });
});

// ── Live-bug 2 regression: removing ONE member leaves the rest intact ────────
describe("removal fold (live bug 2 fixture)", () => {
  it("REGRESSION: 3 members, admin bans 1 → roster contains exactly the other 2", () => {
    // Owner + Alice + Bob all present; the owner bans Bob (banlist edition).
    const state = foldEditions([edition(VSK.BANLIST, EID_BAN, 1, [BOB], "rb1")], OWNER);
    const roster = computeRoster([
      { pubkey: ALICE, created_at: 10, tags: [["action", "join"]] },
      { pubkey: BOB, created_at: 11, tags: [["action", "join"]] },
    ], state, OWNER);
    expect(roster.length).toBe(2); // NOT 1 — the removal must not wipe everyone
    expect(roster.map((m) => m.pubkey).sort()).toEqual([OWNER, ALICE].sort());
  });

  it("a KICK (no ban) leaves the fold untouched — the roster keeps everyone but the kicked leaver", () => {
    // A kick publishes no banlist edition; the removal is enforced by the rekey.
    // The fold therefore still seats whoever has a live join — pinning that a
    // kick can never corrupt OTHER members' seats.
    const state = foldEditions([], OWNER);
    const roster = computeRoster([
      { pubkey: ALICE, created_at: 10, tags: [["action", "join"]] },
      { pubkey: BOB, created_at: 11, tags: [["action", "join"]] },
    ], state, OWNER);
    expect(roster.length).toBe(3);
  });
});

// ── Refounding guestbook snapshot (CORD-06 §3 / CORD-02 §5) ──────────────────
describe("snapshot rumor build/parse (kind 3312)", () => {
  const tag = (r: { tags: string[][] }, k: string) => r.tags.find((t) => t[0] === k);
  const SNAP = hx("5a");

  it("builds a refounder-signed 3312 with a 1-based snap tag + JSON member array", () => {
    const r = buildSnapshotRumor(OWNER, [ALICE, BOB], SNAP, 1, 2, 1_700_000_000);
    expect(r.kind).toBe(KIND_SNAPSHOT);
    expect(r.pubkey).toBe(OWNER);
    expect(JSON.parse(r.content)).toEqual([ALICE, BOB]);
    expect(tag(r, "snap")).toEqual(["snap", SNAP, "1", "2"]);
  });

  it("round-trips through parseSnapshotRumor", () => {
    const r = buildSnapshotRumor(OWNER, [ALICE, BOB], SNAP, 2, 2, 1_700_000_000);
    const p = parseSnapshotRumor({ ...r, id: "x" } as never);
    expect(p).not.toBeNull();
    expect(p!.refounder).toBe(OWNER);
    expect(p!.members).toEqual([ALICE, BOB]);
    expect(p!.snapshotId).toBe(SNAP);
    expect(p!.i).toBe(2); expect(p!.n).toBe(2);
    expect(p!.t).toBe(1_700_000_000 * 1000);
  });

  it("drops malformed member entries INDIVIDUALLY (one bad hex ≠ whole snapshot lost)", () => {
    const p = parseSnapshotRumor({
      kind: KIND_SNAPSHOT, pubkey: OWNER, created_at: 1,
      content: JSON.stringify([ALICE, "not-hex", 42, BOB]),
      tags: [["snap", SNAP, "1", "1"]],
    });
    expect(p!.members).toEqual([ALICE, BOB]);
  });

  it("rejects a malformed snap tag (i>n, non-hex id, missing) whole-event", () => {
    const bad = (tags: string[][]) => parseSnapshotRumor({ kind: KIND_SNAPSHOT, pubkey: OWNER, created_at: 1, content: "[]", tags });
    expect(bad([["snap", SNAP, "2", "1"]])).toBeNull();        // i > n
    expect(bad([["snap", SNAP, "0", "1"]])).toBeNull();        // i < 1
    expect(bad([["snap", "zz".repeat(32), "1", "1"]])).toBeNull(); // non-hex id
    expect(bad([["snap", SNAP, "1"]])).toBeNull();             // too short
    expect(bad([["ms", "0"]])).toBeNull();                     // no snap tag
    expect(parseSnapshotRumor({ kind: KIND_SNAPSHOT, pubkey: OWNER, created_at: 1, content: "not json", tags: [["snap", SNAP, "1", "1"]] })).toBeNull();
  });
});

describe("computeRoster snapshot seeding (CORD-06 §3 / CORD-02 §5)", () => {
  const CAROL = hx("44");
  const snap = (refounder: string, members: string[], t: number) => ({ refounder, members, t });
  // A folded state where `admin` holds a server role carrying BAN (an authorized
  // refounder), built from owner-signed role + grant editions.
  const ADMIN_ROLE = hx("a1");
  const adminState = (admin: string) => foldEditions([
    edition(VSK.ROLE, ADMIN_ROLE, 1, { role_id: ADMIN_ROLE, name: "Admin", position: 1, permissions: serializePermissions(PERM.BAN), scope: { kind: "server" } }, "r1"),
    edition(VSK.GRANT, admin, 1, { member: admin, role_ids: [ADMIN_ROLE] }, "g1"),
  ], OWNER);

  it("an owner snapshot seeds a survivor who has no firsthand Join as Joined", () => {
    const roster = computeRoster([], foldEditions([], OWNER), OWNER, [snap(OWNER, [ALICE, BOB], 5000)]);
    expect(roster.map((m) => m.pubkey).sort()).toEqual([OWNER, ALICE, BOB].sort());
  });

  it("a snapshot from an UNAUTHORIZED npub is ignored", () => {
    const roster = computeRoster([], foldEditions([], OWNER), OWNER, [snap(ALICE, [BOB], 5000)]);
    expect(roster.map((m) => m.pubkey)).toEqual([OWNER]); // ALICE holds no BAN → BOB not seeded
  });

  it("a snapshot from a BAN-holding admin IS honored (non-owner refounder)", () => {
    const roster = computeRoster(
      [{ pubkey: ALICE, created_at: 1, tags: [["action", "join"]] }],
      adminState(ALICE), OWNER, [snap(ALICE, [CAROL], 5000)],
    );
    expect(roster.map((m) => m.pubkey).sort()).toEqual([OWNER, ALICE, CAROL].sort());
  });

  it("a firsthand Leave NEWER than the seed supersedes it (member's own word wins)", () => {
    const roster = computeRoster(
      [{ pubkey: BOB, created_at: 6, tags: [["action", "leave"], ["ms", "0"]] }], // 6000 > 5000
      foldEditions([], OWNER), OWNER, [snap(OWNER, [BOB], 5000)],
    );
    expect(roster.map((m) => m.pubkey)).toEqual([OWNER]); // BOB left after the seed
  });

  it("a snapshot NEWER than an older firsthand Leave re-seeds Joined (later ms wins)", () => {
    const roster = computeRoster(
      [{ pubkey: BOB, created_at: 4, tags: [["action", "leave"], ["ms", "0"]] }], // 4000 < 5000
      foldEditions([], OWNER), OWNER, [snap(OWNER, [BOB], 5000)],
    );
    expect(roster.map((m) => m.pubkey).sort()).toEqual([OWNER, BOB].sort());
  });

  it("firsthand beats a snapshot seed on an EXACT time tie", () => {
    const roster = computeRoster(
      [{ pubkey: BOB, created_at: 5, tags: [["action", "leave"], ["ms", "0"]] }], // 5000 == seed 5000
      foldEditions([], OWNER), OWNER, [snap(OWNER, [BOB], 5000)],
    );
    expect(roster.map((m) => m.pubkey)).toEqual([OWNER]); // tie → firsthand Leave wins
  });

  it("a banned npub is NOT seeded by a snapshot", () => {
    const state = foldEditions([edition(VSK.BANLIST, hx("c3"), 1, [BOB], "rb1")], OWNER);
    const roster = computeRoster([], state, OWNER, [snap(OWNER, [BOB], 5000)]);
    expect(roster.map((m) => m.pubkey)).toEqual([OWNER]); // banlist wins over a seed
  });

  it("absent snapshots ⇒ identical to the pre-fix roster (graceful, idempotent)", () => {
    const jl = [{ pubkey: ALICE, created_at: 10, tags: [["action", "join"]] }];
    const state = foldEditions([], OWNER);
    const without = computeRoster(jl, state, OWNER);
    const withEmpty = computeRoster(jl, state, OWNER, []);
    expect(withEmpty.map((m) => m.pubkey).sort()).toEqual(without.map((m) => m.pubkey).sort());
    // Double-consuming the same seed is idempotent (per-npub coalesce).
    const once = computeRoster(jl, state, OWNER, [snap(OWNER, [BOB], 5000)]);
    const twice = computeRoster(jl, state, OWNER, [snap(OWNER, [BOB], 5000), snap(OWNER, [BOB], 5000)]);
    expect(twice.map((m) => m.pubkey).sort()).toEqual(once.map((m) => m.pubkey).sort());
  });
});

describe("banlist edition chain (CORD-04 vsk-4)", () => {
  const CAROL = hx("44");

  it("REGRESSION: two bans republished at version 1 lose a whole snapshot", () => {
    // Documents the defect the chain exists to prevent. The banlist is the only
    // entity at a FIXED eid, so two payloads collide on one coordinate; the fold
    // keeps one and REPLACES the set wholesale, discarding the loser entirely.
    const state = foldEditions([
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: JSON.stringify([BOB]), rumorId: "rA", pubkey: OWNER },
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: JSON.stringify([BOB, CAROL]), rumorId: "rZ", pubkey: OWNER },
    ], OWNER);
    expect(state.banlist.has(BOB)).toBe(true);
    expect(state.banlist.has(CAROL)).toBe(false); // rA < rZ — the newer ban lost
    expect(state.banlist.size).toBe(1);
  });

  it("a chained version 2 wins over version 1 whichever way the rumor ids fall", () => {
    for (const [id1, id2] of [["rA", "rZ"], ["rZ", "rA"]]) {
      const state = foldEditions([
        edition(VSK.BANLIST, EID_BAN, 1, [BOB], id1),
        edition(VSK.BANLIST, EID_BAN, 2, [BOB, CAROL], id2, [BOB]),
      ], OWNER);
      expect(state.banlist.has(BOB)).toBe(true);
      expect(state.banlist.has(CAROL)).toBe(true);
    }
  });

  it("exposes the winning head so the next publisher can chain onto it", () => {
    // The head hash must be EXACTLY what the next edition puts in `ep`, or every
    // folder drops the successor.
    const state = foldEditions([
      edition(VSK.BANLIST, EID_BAN, 1, [BOB], "rA"),
      edition(VSK.BANLIST, EID_BAN, 2, [BOB, CAROL], "rB", [BOB]),
    ], OWNER);
    const head = state.heads.get(`${VSK.BANLIST}:${EID_BAN}`);
    expect(head).toEqual({
      ev: 2,
      hash: computeEditionId(EID_BAN, 2, computeEditionId(EID_BAN, 1, undefined, JSON.stringify([BOB])), JSON.stringify([BOB, CAROL])),
    });
  });

  it("an edition built from the exposed head folds as the winner", () => {
    // Round-trips the head through the real builder/parser: catches an off-by-one
    // version or a hash taken over the wrong content string.
    const first = edition(VSK.BANLIST, EID_BAN, 1, [BOB], "rA");
    const head = foldEditions([first], OWNER).heads.get(`${VSK.BANLIST}:${EID_BAN}`)!;
    const tmpl = buildControlEdition(OWNER, VSK.BANLIST, EID_BAN, head.ev + 1, [BOB, CAROL], 1, { prevHash: head.hash });
    const parsed = parseControlEdition({ ...tmpl, id: "rB" })!;
    const state = foldEditions([first, parsed], OWNER);
    expect(state.banlist.has(CAROL)).toBe(true);
    expect(state.heads.get(`${VSK.BANLIST}:${EID_BAN}`)!.ev).toBe(2);
  });

  it("REGRESSION: two sequential bans leave both people off the roster", () => {
    const state = foldEditions([
      edition(VSK.BANLIST, EID_BAN, 1, [BOB], "rA"),
      edition(VSK.BANLIST, EID_BAN, 2, [BOB, CAROL], "rB", [BOB]),
    ], OWNER);
    const roster = computeRoster([
      { pubkey: BOB, created_at: 10, tags: [["action", "join"]] },
      { pubkey: CAROL, created_at: 11, tags: [["action", "join"]] },
      { pubkey: ALICE, created_at: 12, tags: [["action", "join"]] },
    ], state, OWNER);
    expect(roster.map((m) => m.pubkey).sort()).toEqual([OWNER, ALICE].sort());
  });
});

describe("editionKey (ingest dedup)", () => {
  const base = { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, pubkey: OWNER };
  it("collapses a redelivered rumor — the churn guard still holds", () => {
    const a = { ...base, content: JSON.stringify([BOB]), rumorId: "r1" } as ControlEdition;
    expect(editionKey(a)).toBe(editionKey({ ...a }));
  });
  it("keeps two DIFFERENT payloads at one coordinate distinct", () => {
    // The banlist's eid is a fixed constant, so these collide on vsk:eid:ev.
    // Keying without the rumor id dropped the second before the fold saw it.
    const a = { ...base, content: JSON.stringify([BOB]), rumorId: "r1" } as ControlEdition;
    const b = { ...base, content: JSON.stringify([BOB, hx("44")]), rumorId: "r2" } as ControlEdition;
    expect(editionKey(a)).not.toBe(editionKey(b));
  });
});

describe("banlist fork healing (banlistSeen)", () => {
  const CAROL = hx("44");

  it("enforces ONLY the winning edition — spec unchanged", () => {
    const state = foldEditions([
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: JSON.stringify([BOB]), rumorId: "rA", pubkey: OWNER },
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: JSON.stringify([CAROL]), rumorId: "rZ", pubkey: OWNER },
    ], OWNER);
    expect(state.banlist.has(BOB)).toBe(true);
    expect(state.banlist.has(CAROL)).toBe(false); // rA won; CORD-04 is untouched
  });

  it("but REMEMBERS the loser's names, so the next edition can restore them", () => {
    // This is the whole fix for an already-forked community. The losing
    // edition's targets are admitted and authorised and enforced by nobody;
    // without this they stay dropped forever, because nothing else ever
    // rewrites that coordinate.
    const state = foldEditions([
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: JSON.stringify([BOB]), rumorId: "rA", pubkey: OWNER },
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: JSON.stringify([CAROL]), rumorId: "rZ", pubkey: OWNER },
    ], OWNER);
    expect([...state.banlistSeen].sort()).toEqual([BOB, CAROL].sort());
  });

  it("ignores names from editions authority REFUSED", () => {
    // banlistSeen unions the ADMITTED set, not everything on the relay — an
    // edition the authority gate dropped must not smuggle a ban back in.
    const state = foldEditions([
      edition(VSK.BANLIST, EID_BAN, 1, [BOB], "rA"),
      // ALICE holds no role, so this is never admitted.
      edition(VSK.BANLIST, EID_BAN, 1, [CAROL], "rB", undefined, ALICE),
    ], OWNER);
    expect(state.banlistSeen.has(BOB)).toBe(true);
    expect(state.banlistSeen.has(CAROL)).toBe(false);
  });

  it("survives a malformed edition without losing the rest", () => {
    const state = foldEditions([
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: "not json", rumorId: "rA", pubkey: OWNER },
      { vsk: VSK.BANLIST, eid: EID_BAN, ev: 1, content: JSON.stringify([BOB]), rumorId: "rB", pubkey: OWNER },
    ], OWNER);
    expect(state.banlistSeen.has(BOB)).toBe(true);
  });
});
