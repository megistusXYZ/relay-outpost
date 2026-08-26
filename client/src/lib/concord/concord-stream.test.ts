import { describe, it, expect } from "vitest";
import { getPublicKey, generateSecretKey, getEventHash, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  groupKey, wrapStream, buildEncryptedSeal, buildPlainSeal, planeConvKey, LABEL_CHANNEL, KIND_SEAL_ENC,
} from "./concord-crypto";
import { decodeStreamEvent, routeRumor, type DecodedRumor } from "./concord-stream";
import { buildMessageRumor, KIND_MESSAGE, KIND_CONTROL_EDITION } from "./concord-events";

const secret = new Uint8Array(32).fill(5);
const CH = bytesToHex(new Uint8Array(32).fill(9));

// Author signs a rumor's seal; plane wraps it — mirrors publishToPlane without a signer mock.
function authorEncryptedWrap(authorSk: Uint8Array, plane: ReturnType<typeof groupKey>, rumor: DecodedRumor, createdAt: number): Event {
  const rumorWithId = { ...rumor, id: getEventHash(rumor as never) };
  const seal = buildEncryptedSeal(getPublicKey(authorSk), JSON.stringify(rumorWithId), planeConvKey(plane), createdAt);
  const signedSeal = finalizeEvent({ kind: seal.kind, created_at: seal.created_at, tags: seal.tags, content: seal.content }, authorSk);
  return wrapStream(plane, signedSeal as never, createdAt);
}

describe("decodeStreamEvent (CORD-01/03)", () => {
  const plane = groupKey(LABEL_CHANNEL, secret, CH, 0n);
  const authorSk = generateSecretKey();
  const author = getPublicKey(authorSk);

  it("roundtrips an author-signed encrypted message through wrap → decode", () => {
    const rumor = buildMessageRumor(author, CH, 0n, "hey chat", 417, 1_700_000_000) as unknown as DecodedRumor;
    const wrap = authorEncryptedWrap(authorSk, plane, rumor, 1_700_000_000);
    const out = decodeStreamEvent(plane, wrap);
    expect(out).not.toBeNull();
    expect(out!.content).toBe("hey chat");
    expect(out!.pubkey).toBe(author);
    expect(out!.kind).toBe(KIND_MESSAGE);
  });

  it("returns null for the wrong plane key", () => {
    const rumor = buildMessageRumor(author, CH, 0n, "secret", 0, 1_700_000_000) as unknown as DecodedRumor;
    const wrap = authorEncryptedWrap(authorSk, plane, rumor, 1_700_000_000);
    const wrongPlane = groupKey(LABEL_CHANNEL, secret, CH, 1n);
    expect(decodeStreamEvent(wrongPlane, wrap)).toBeNull();
  });

  it("rejects a forged sender (rumor pubkey ≠ seal signer)", () => {
    // Author signs the seal, but the rumor inside claims someone else wrote it.
    const forged = buildMessageRumor("de".repeat(32), CH, 0n, "not me", 0, 1_700_000_000) as unknown as DecodedRumor;
    const wrap = authorEncryptedWrap(authorSk, plane, forged, 1_700_000_000);
    expect(decodeStreamEvent(plane, wrap)).toBeNull();
  });
});

describe("routeRumor (CORD-03 binding)", () => {
  const base: DecodedRumor = { kind: KIND_MESSAGE, pubkey: "aa".repeat(32), created_at: 1, id: "x", content: "hi", tags: [["channel", CH], ["epoch", "0"], ["ms", "1"]] };

  it("routes a message whose channel+epoch match", () => {
    expect(routeRumor(base, CH, 0).type).toBe("message");
  });
  it("drops a message bound to a different channel", () => {
    expect(routeRumor(base, "bb".repeat(32), 0).type).toBe("ignored");
  });
  it("drops a message bound to a different epoch", () => {
    expect(routeRumor(base, CH, 1).type).toBe("ignored");
  });
  it("classifies control + join_leave without channel binding", () => {
    expect(routeRumor({ ...base, kind: KIND_CONTROL_EDITION, tags: [] }).type).toBe("control");
    expect(routeRumor({ ...base, kind: 3306, tags: [] }).type).toBe("join_leave");
  });
});

// ── Held-epoch history (live bugs 2+3): governance survives a base rekey ─────
import { subscribeGovernance, subscribeChannel, governancePlanes, heldBaseKeys, channelReadPlanes, rekeyReadPlanes, publishToPlane, publishGuestbook, publishGuestbookSnapshot, guestbookPlaneKey } from "./concord-stream";
import { LABEL_CONTROL, LABEL_GUESTBOOK, KIND_SEAL_PLAIN, unwrapStream, baseRekeyAddress, channelRekeyAddress } from "./concord-crypto";
import { buildJoinLeaveRumor, buildAuditRumor, parseSnapshotRumor, computeRoster, foldEditions, KIND_JOIN_LEAVE, KIND_AUDIT, KIND_SNAPSHOT } from "./concord-events";
import { adoptBaseRekey, type StoredCommunity } from "./concord-keys";
import type { ISigner } from "applesauce-signers";

describe("held-epoch governance planes (CORD-03 §3 across a rekey)", () => {
  const owner = getPublicKey(generateSecretKey());
  const cid = bytesToHex(new Uint8Array(32).fill(2));
  const rootV0 = bytesToHex(new Uint8Array(32).fill(3));
  const rootV1 = bytesToHex(new Uint8Array(32).fill(4));
  const base: StoredCommunity = {
    community_id: cid, owner, owner_salt: "11".repeat(32),
    community_root: rootV0, root_epoch: 0,
    channels: [{ id: "aa".repeat(32), epoch: 0, name: "general", isPrivate: false }],
    relays: ["wss://r"], name: "G", addedAt: 0,
  };
  const rekeyed = adoptBaseRekey(base, rootV1, 1);

  // A signer that only signs (finalizeEvent) — what publishToPlane needs here.
  function signerFor(sk: Uint8Array): ISigner {
    return { signEvent: async (t: any) => finalizeEvent({ ...t }, sk) } as unknown as ISigner;
  }

  it("adoptBaseRekey retains the prior root and bumps the epoch", () => {
    expect(rekeyed.root_epoch).toBe(1);
    expect(rekeyed.community_root).toBe(rootV1);
    expect(rekeyed.priorRoots).toEqual([{ root: rootV0, epoch: 0 }]);
    expect(heldBaseKeys(rekeyed)).toEqual([{ root: rootV0, epoch: 0 }, { root: rootV1, epoch: 1 }]);
    // Idempotent: re-adopting the same epoch is a no-op.
    expect(adoptBaseRekey(rekeyed, "ff".repeat(32), 1)).toBe(rekeyed);
  });

  it("governancePlanes spans BOTH epochs' control + guestbook keys after a rekey", () => {
    expect(governancePlanes(base).length).toBe(2);   // 1 epoch × 2 planes
    expect(governancePlanes(rekeyed).length).toBe(4); // 2 epochs × 2 planes
    const oldControl = groupKey(LABEL_CONTROL, new Uint8Array(32).fill(3), cid, 0n).pk;
    const oldGuestbook = groupKey(LABEL_GUESTBOOK, new Uint8Array(32).fill(3), cid, 0n).pk;
    const pks = governancePlanes(rekeyed).map((p) => p.pk);
    expect(pks).toContain(oldControl);
    expect(pks).toContain(oldGuestbook);
  });

  it("REGRESSION (live bugs 2+3): pre-rekey JOIN + AUDIT rumors still decode after the epoch bump", async () => {
    const memberSk = generateSecretKey();
    const member = getPublicKey(memberSk);
    // Published BEFORE the rekey: a guestbook join + an audit entry about that member.
    const oldGuestbook = groupKey(LABEL_GUESTBOOK, new Uint8Array(32).fill(3), cid, 0n);
    const wraps: Event[] = [];
    const capture = async (e: Event) => { wraps.push(e); };
    await publishToPlane(signerFor(memberSk), member, oldGuestbook, buildJoinLeaveRumor(member, true, 1_700_000_000), KIND_SEAL_PLAIN, capture);
    const ownerSk = generateSecretKey();
    const community = { ...rekeyed, owner: getPublicKey(ownerSk) };
    await publishToPlane(signerFor(ownerSk), community.owner, oldGuestbook, buildAuditRumor(community.owner, "kick", 1_700_000_100, { target: member, reason: "spam" }), KIND_SEAL_PLAIN, capture);
    expect(wraps.length).toBe(2);

    // Subscribe AFTER adopting epoch 1 — the old-epoch wraps must still decode.
    const decoded: number[] = [];
    subscribeGovernance("viewer", community, (rumor) => decoded.push(rumor.kind), (relays, filter, onevent) => {
      // The filter must ask for the OLD planes too, or relays never return them.
      for (const w of wraps) if (filter.authors.includes(w.pubkey)) onevent(w);
      return { close: () => {} };
    });
    expect(decoded).toContain(KIND_JOIN_LEAVE);
    expect(decoded).toContain(KIND_AUDIT);
  });

  it("rekeyReadPlanes (CORD-06 §2 dual-read): next base address + per-private-channel next-epoch addresses under every held root", () => {
    const rootV0Bytes = new Uint8Array(32).fill(3);
    const rootV1Bytes = new Uint8Array(32).fill(4);
    // Pre-rekey, no private channels: just the next base-rotation address.
    expect(rekeyReadPlanes(base).map((p) => p.pk)).toEqual([
      baseRekeyAddress(rootV0Bytes, cid, 1n).pk,
    ]);
    // Post-rekey with one private channel at epoch 3: next base address under
    // the CURRENT root, plus the channel's epoch-4 rekey address under BOTH
    // held roots (standalone rekeys ride the current root; removal-companion
    // rekeys ride the prior root, CORD-06 §3).
    const privCh = { id: "bb".repeat(32), key: "cc".repeat(32), epoch: 3, name: "sec", isPrivate: true };
    const withPriv: StoredCommunity = { ...rekeyed, channels: [...rekeyed.channels, privCh] };
    const pks = rekeyReadPlanes(withPriv).map((p) => p.pk);
    expect(pks).toContain(baseRekeyAddress(rootV1Bytes, cid, 2n).pk);
    expect(pks).toContain(channelRekeyAddress(rootV0Bytes, privCh.id, 4n).pk);
    expect(pks).toContain(channelRekeyAddress(rootV1Bytes, privCh.id, 4n).pk);
    expect(pks.length).toBe(3);
    // Public channels never get a rekey address (they rotate with the base).
    expect(pks.some((pk) => pk === channelRekeyAddress(rootV1Bytes, rekeyed.channels[0].id, 2n).pk)).toBe(false);
  });

  it("subscribeGovernance's authors filter includes the rekey-pseudonym addresses (dual-read wired)", () => {
    let authors: string[] = [];
    subscribeGovernance("viewer", rekeyed, () => {}, (_relays, filter) => {
      authors = filter.authors;
      return { close: () => {} };
    });
    expect(authors).toContain(baseRekeyAddress(new Uint8Array(32).fill(4), cid, 2n).pk);
    for (const p of governancePlanes(rekeyed)) expect(authors).toContain(p.pk);
  });

  it("a viewer holding ONLY the new root (fresh joiner) cannot read old-epoch planes", () => {
    const freshJoiner: StoredCommunity = { ...rekeyed, priorRoots: [] };
    expect(governancePlanes(freshJoiner).length).toBe(2);
    const oldGuestbook = groupKey(LABEL_GUESTBOOK, new Uint8Array(32).fill(3), cid, 0n).pk;
    expect(governancePlanes(freshJoiner).map((p) => p.pk)).not.toContain(oldGuestbook);
  });

  it("channelReadPlanes: a public channel spans held epochs; a private one is its own key", () => {
    const pub = channelReadPlanes(rekeyed, rekeyed.channels[0]);
    expect(pub.length).toBe(2);
    expect(pub.map((p) => p.epoch)).toEqual([0, 1]);
    const priv = channelReadPlanes(rekeyed, { id: "bb".repeat(32), key: "cc".repeat(32), epoch: 3, name: "sec", isPrivate: true });
    expect(priv.length).toBe(1);
    expect(priv[0].epoch).toBe(3);
  });

  it("REGRESSION: a pre-rekey public-channel message still decodes via subscribeChannel", async () => {
    const authorSk = generateSecretKey();
    const author = getPublicKey(authorSk);
    const ch = rekeyed.channels[0];
    const oldPlane = groupKey(LABEL_CHANNEL, new Uint8Array(32).fill(3), ch.id, 0n);
    const rumor = buildMessageRumor(author, ch.id, 0n, "before the rekey", 5, 1_700_000_000) as unknown as DecodedRumor;
    const wrap = authorEncryptedWrap(authorSk, oldPlane, rumor, 1_700_000_000);
    const got: string[] = [];
    subscribeChannel("viewer-" + Math.random(), rekeyed, ch, (r) => got.push(r.content), (relays, filter, onevent) => {
      if (filter.authors.includes(wrap.pubkey)) onevent(wrap);
      return { close: () => {} };
    });
    // decode path is async (stream ledger check) — flush microtasks.
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual(["before the rekey"]);
  });

  // ── Refounding guestbook snapshot end-to-end (CORD-06 §3 / CORD-02 §5) ──────
  it("emit-on-refounding → decode → fold: a fresh joiner recovers the survivors", async () => {
    const ownerSk = generateSecretKey();
    const community: StoredCommunity = { ...rekeyed, owner: getPublicKey(ownerSk) }; // NEW root/epoch (epoch 1)
    const survivors = [community.owner, getPublicKey(generateSecretKey()), getPublicKey(generateSecretKey())];

    // EMIT at the new-epoch guestbook plane, encrypted seal, chunked+1-based.
    const wraps: Event[] = [];
    await publishGuestbookSnapshot(signerFor(ownerSk), community.owner, community, survivors, async (e) => { wraps.push(e); }, 1_700_000_500);
    expect(wraps.length).toBe(1); // 3 survivors ≪ 400/chunk → one chunk

    // A FRESH JOINER holds only the new root (no prior epochs, no rekey blobs).
    const freshJoiner: StoredCommunity = { ...community, priorRoots: [] };
    const gbPlane = guestbookPlaneKey(freshJoiner);
    expect(wraps[0].pubkey).toBe(gbPlane.pk); // published AT the guestbook address

    // DECODE via the joiner's guestbook plane and CONFIRM conformance.
    const decoded = decodeStreamEvent(gbPlane, wraps[0]);
    expect(decoded).not.toBeNull();
    expect(decoded!.kind).toBe(KIND_SNAPSHOT);
    const snap = parseSnapshotRumor(decoded!);
    expect(snap!.refounder).toBe(community.owner);
    expect(snap!.members.sort()).toEqual([...survivors].sort());
    expect(snap!.i).toBe(1); expect(snap!.n).toBe(1); // 1-based

    // FOLD: the joiner's roster (no firsthand Joins visible) recovers everyone.
    const roster = computeRoster([], foldEditions([], community.owner), community.owner, [snap!]);
    expect(roster.map((m) => m.pubkey).sort()).toEqual([...survivors].sort());

    // GRACEFUL: no snapshot ⇒ the joiner sees only the owner (current behavior).
    const bare = computeRoster([], foldEditions([], community.owner), community.owner);
    expect(bare.map((m) => m.pubkey)).toEqual([community.owner]);
  });
});

// ── Guestbook seal encryption (CORD-02 §5) ───────────────────────────────────
// "the Chat, Guestbook, and rekey planes' seals MUST be encrypted (kind 20013)"
// — CORD-02 §5. Grounded in Vector `community/v2/guestbook.rs` (seals with
// SealForm::Encrypted at guestbook_pk; parse_guestbook_event rejects plaintext)
// and stream.rs (encrypt under group.conv_key()). We emit encrypted going
// forward, but DUAL-READ any legacy plaintext (20014) history our old clients
// wrote so it isn't lost.
describe("guestbook seals are encrypted (CORD-02 §5)", () => {
  const owner = getPublicKey(generateSecretKey());
  const community: StoredCommunity = {
    community_id: bytesToHex(new Uint8Array(32).fill(2)), owner, owner_salt: "11".repeat(32),
    community_root: bytesToHex(new Uint8Array(32).fill(7)), root_epoch: 0,
    channels: [], relays: ["wss://r"], name: "G", addedAt: 0,
  };
  function signerFor(sk: Uint8Array): ISigner {
    return { signEvent: async (t: any) => finalizeEvent({ ...t }, sk) } as unknown as ISigner;
  }

  it("publishGuestbook emits an ENCRYPTED 20013 seal that round-trips", async () => {
    const memberSk = generateSecretKey();
    const member = getPublicKey(memberSk);
    const wraps: Event[] = [];
    await publishGuestbook(signerFor(memberSk), member, community, buildJoinLeaveRumor(member, true, 1_700_000_000), async (e) => { wraps.push(e); });
    expect(wraps.length).toBe(1);

    const plane = guestbookPlaneKey(community);
    expect(wraps[0].pubkey).toBe(plane.pk); // published AT the guestbook address

    // The inner seal MUST be the encrypted form (20013), NOT plaintext (20014).
    const seal = unwrapStream(plane, wraps[0]);
    expect(seal!.kind).toBe(KIND_SEAL_ENC);
    // And a fresh member holding only the guestbook plane key decodes the join.
    const decoded = decodeStreamEvent(plane, wraps[0]);
    expect(decoded).not.toBeNull();
    expect(decoded!.kind).toBe(KIND_JOIN_LEAVE);
    expect(decoded!.pubkey).toBe(member);
    expect(decoded!.tags).toContainEqual(["action", "join"]);
  });

  it("DUAL-READ: a legacy plaintext 20014 guestbook seal still decodes (back-compat)", async () => {
    const memberSk = generateSecretKey();
    const member = getPublicKey(memberSk);
    const plane = guestbookPlaneKey(community);
    // Reproduce the OLD wire form: publish the same rumor with a plaintext seal.
    const wraps: Event[] = [];
    await publishToPlane(signerFor(memberSk), member, plane, buildJoinLeaveRumor(member, false, 1_700_000_000), KIND_SEAL_PLAIN, async (e) => { wraps.push(e); });
    expect(unwrapStream(plane, wraps[0])!.kind).toBe(KIND_SEAL_PLAIN);
    // The current reader still opens it, so historical join/leave isn't lost.
    const decoded = decodeStreamEvent(plane, wraps[0]);
    expect(decoded).not.toBeNull();
    expect(decoded!.kind).toBe(KIND_JOIN_LEAVE);
    expect(decoded!.tags).toContainEqual(["action", "leave"]);
  });

  // The publisher's verdict must reach the caller. `publishEvent` returns FALSE
  // on total relay failure rather than throwing, and this used to `await
  // publish(wrap)` and return the wrap regardless — so every caller that
  // "checked whether the publish worked" was only catching signer errors, and a
  // write made offline reported success. That is the difference between a
  // delete that failed and a delete that destroyed a private channel's only key.
  it("returns null when the publisher reports it landed nowhere", async () => {
    const sk = generateSecretKey();
    const plane = guestbookPlaneKey(community);
    const out = await publishToPlane(signerFor(sk), getPublicKey(sk), plane,
      buildJoinLeaveRumor(getPublicKey(sk), true, 1_700_000_000), KIND_SEAL_PLAIN,
      async () => false);
    expect(out).toBeNull();
  });

  it("still returns the wrap for a publisher that reports success or says nothing", async () => {
    const sk = generateSecretKey();
    const plane = guestbookPlaneKey(community);
    const rumor = buildJoinLeaveRumor(getPublicKey(sk), true, 1_700_000_000);
    for (const verdict of [true, undefined]) {
      const out = await publishToPlane(signerFor(sk), getPublicKey(sk), plane, rumor, KIND_SEAL_PLAIN,
        async () => verdict);
      expect(out).not.toBeNull();
    }
  });
});
