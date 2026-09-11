/**
 * Self-erasure outranks curation (CORD-04 §7): a member's delete of their own
 * message hides its pin at once, matched by the pin's recomputed id. Only the
 * message's proven author can do that.
 */
import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash } from "nostr-tools";
import { makePinEntry, readPinList, visiblePins } from "./concord-pins";
import { buildMessageRumor } from "./concord-events";
import { buildEncryptedSeal, planeConvKey, groupKey, LABEL_CHANNEL } from "./concord-crypto";

const sk = generateSecretKey();
const author = getPublicKey(sk);
const someoneElse = getPublicKey(generateSecretKey());
const room = "c3".repeat(32);
const conv = planeConvKey(groupKey(LABEL_CHANNEL, generateSecretKey(), room, 0n));
const r = buildMessageRumor(author, room, 0n, "Meet at 6", 1, 1_789_000_000);
const s = buildEncryptedSeal(author, JSON.stringify({ ...r, id: getEventHash(r as never) }), conv, r.created_at);
const entry = makePinEntry(finalizeEvent({ kind: s.kind, created_at: s.created_at, tags: s.tags, content: s.content }, sk), conv);
const view = readPinList(JSON.stringify({ entries: [entry] }), room, { foldLoaded: true });
const pins = view.status === "ok" ? view.pins : [];

describe("a pinned message its author deleted", () => {
  it("is hidden at once", () => {
    expect(visiblePins(pins, [{ pubkey: author, targetId: pins[0].id }])).toEqual([]);
  });

  it("stays when someone else's delete names it", () => {
    expect(visiblePins(pins, [{ pubkey: someoneElse, targetId: pins[0].id }])).toHaveLength(1);
  });
});
