// Armada interop transport regression: community relays (relay.ditto.pub,
// relay.dreamith.to) NIP-42-gate kind-1059 REQs — `CLOSED "auth-required: all
// authors or all #p tags must be authenticated"` — and the authors of a
// Concord wrap REQ are DERIVED plane pubkeys, so the challenge must be
// answered with one kind-22242 per plane signed by the plane sks (which every
// invite-holder derives). Before this module, our app never authenticated
// those reads and a joined Armada community stayed blank ("0 channels").
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSecretKey, getPublicKey, verifyEvent, type VerifiedEvent } from "nostr-tools";
import { setPoolRef } from "../nip42-auth";
import { registerPlaneAuth, armPlaneAuth, planeAuthForSubscription, __clearPlaneAuth } from "./concord-plane-auth";
import type { GroupKey } from "./concord-crypto";

const RELAY = "wss://relay.ditto.pub";
// nostr-tools stores relays under the normalized (trailing-slash) URL and puts
// that form in the AUTH template's relay tag — the registry must still match.
const RELAY_NORMALIZED = "wss://relay.ditto.pub/";

function makePlane(): GroupKey {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

function makeFakeRelay(challenge?: string) {
  return {
    url: RELAY_NORMALIZED,
    challenge,
    send: vi.fn(async (_msg: string) => {}),
  };
}

function installPool(relay: ReturnType<typeof makeFakeRelay>) {
  setPoolRef({ relays: new Map([[RELAY_NORMALIZED, relay]]) } as never);
  return relay;
}

const authTemplate = (challenge: string) => ({
  kind: 22242,
  created_at: Math.floor(Date.now() / 1000),
  tags: [["relay", RELAY_NORMALIZED], ["challenge", challenge]],
  content: "",
});

const sentAuthEvents = (relay: ReturnType<typeof makeFakeRelay>): VerifiedEvent[] =>
  relay.send.mock.calls.map(([msg]) => {
    const frame = JSON.parse(msg);
    expect(frame[0]).toBe("AUTH");
    return frame[1] as VerifiedEvent;
  });

beforeEach(() => {
  __clearPlaneAuth();
  setPoolRef(undefined as never);
});

describe("planeAuthForSubscription", () => {
  it("returns null for filters whose authors are not (all) registered planes", () => {
    const plane = makePlane();
    const stranger = makePlane();
    registerPlaneAuth([RELAY], [plane]);
    expect(planeAuthForSubscription(RELAY_NORMALIZED, undefined, authTemplate("c1"))).toBeNull();
    expect(planeAuthForSubscription(RELAY_NORMALIZED, [stranger.pk], authTemplate("c1"))).toBeNull();
    // Mixed plane + non-plane authors: NOT a pure plane REQ — fall through to
    // the user-key signer rather than half-authenticating.
    expect(planeAuthForSubscription(RELAY_NORMALIZED, [plane.pk, stranger.pk], authTemplate("c1"))).toBeNull();
  });

  it("signs the primary with the plane key and direct-sends one AUTH per extra plane", () => {
    const control = makePlane();
    const guestbook = makePlane();
    // Register while no pool is set (registration's retroactive arming no-ops)
    // so the subscription hook is observed in isolation.
    registerPlaneAuth([RELAY], [control, guestbook]);
    const relay = installPool(makeFakeRelay("chal-1"));
    const evt = planeAuthForSubscription(RELAY_NORMALIZED, [control.pk, guestbook.pk], authTemplate("chal-1"));
    expect(evt).not.toBeNull();
    expect(evt!.kind).toBe(22242);
    expect(evt!.pubkey).toBe(control.pk);
    expect(verifyEvent(evt!)).toBe(true);
    expect(evt!.tags).toContainEqual(["challenge", "chal-1"]);
    expect(evt!.tags).toContainEqual(["relay", RELAY_NORMALIZED]);
    // The extra plane went out as a direct in-order AUTH frame.
    const extras = sentAuthEvents(relay);
    expect(extras).toHaveLength(1);
    expect(extras[0].pubkey).toBe(guestbook.pk);
    expect(verifyEvent(extras[0])).toBe(true);
    expect(extras[0].tags).toContainEqual(["challenge", "chal-1"]);
  });

  it("dedupes extra AUTH frames per challenge, resends on a fresh challenge", () => {
    const a = makePlane();
    const b = makePlane();
    registerPlaneAuth([RELAY], [a, b]);
    const relay = installPool(makeFakeRelay("chal-1"));
    planeAuthForSubscription(RELAY_NORMALIZED, [a.pk, b.pk], authTemplate("chal-1"));
    planeAuthForSubscription(RELAY_NORMALIZED, [a.pk, b.pk], authTemplate("chal-1"));
    expect(relay.send).toHaveBeenCalledTimes(1); // b sent once for chal-1
    // Reconnect ⇒ new challenge ⇒ every plane re-authenticates.
    relay.challenge = "chal-2";
    planeAuthForSubscription(RELAY_NORMALIZED, [a.pk, b.pk], authTemplate("chal-2"));
    const events = sentAuthEvents(relay);
    expect(events).toHaveLength(2);
    expect(events[1].tags).toContainEqual(["challenge", "chal-2"]);
  });
});

describe("armPlaneAuth / registerPlaneAuth retroactive arming", () => {
  it("registering planes for an already-challenged connection direct-sends their AUTHs", () => {
    const a = makePlane();
    const b = makePlane();
    const relay = installPool(makeFakeRelay("chal-9"));
    registerPlaneAuth([RELAY], [a, b]);
    const events = sentAuthEvents(relay);
    expect(events.map((e) => e.pubkey).sort()).toEqual([a.pk, b.pk].sort());
    for (const e of events) {
      expect(verifyEvent(e)).toBe(true);
      expect(e.tags).toContainEqual(["challenge", "chal-9"]);
    }
    // A later pre-REQ arm for the same planes + challenge is a no-op.
    armPlaneAuth(RELAY, [a.pk, b.pk]);
    expect(relay.send).toHaveBeenCalledTimes(2);
  });

  it("is a no-op without a pending challenge or for unregistered relays", () => {
    const a = makePlane();
    const relay = installPool(makeFakeRelay(undefined));
    registerPlaneAuth([RELAY], [a]);
    armPlaneAuth(RELAY, [a.pk]);
    expect(relay.send).not.toHaveBeenCalled();
    relay.challenge = "late";
    armPlaneAuth("wss://other.example", [a.pk]);
    expect(relay.send).not.toHaveBeenCalled();
    // The challenge arriving later + a pre-REQ arm (openPersistentSub) sends it.
    armPlaneAuth(RELAY, [a.pk]);
    expect(relay.send).toHaveBeenCalledTimes(1);
  });
});
