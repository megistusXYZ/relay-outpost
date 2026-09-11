/**
 * The proof a pin carries (CORD-04 §7): the message's original signed seal and
 * the 76 bytes of NIP-44 message keys that open it. A verifier holding nothing
 * but the pin checks the seal's signature and MAC, opens it, and requires the
 * room binding; the message's id is recomputed, never trusted.
 */
import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash } from "nostr-tools";
import { makePinEntry, verifyPinEntry } from "./concord-pins";
import { buildMessageRumor, buildReactionRumor, type RumorTemplate } from "./concord-events";
import { buildEncryptedSeal, planeConvKey, groupKey, LABEL_CHANNEL } from "./concord-crypto";

const authorSk = generateSecretKey();
const author = getPublicKey(authorSk);
const stranger = getPublicKey(generateSecretKey());
const room = "c3".repeat(32), otherRoom = "d4".repeat(32);
const conv = planeConvKey(groupKey(LABEL_CHANNEL, generateSecretKey(), room, 0n));

/** The seal exactly as the author's app publishes it (concord-stream publishToPlane). */
const sealOf = (rumor: RumorTemplate) => {
  const s = buildEncryptedSeal(rumor.pubkey, JSON.stringify({ ...rumor, id: getEventHash(rumor as never) }), conv, rumor.created_at);
  return finalizeEvent({ kind: s.kind, created_at: s.created_at, tags: s.tags, content: s.content }, authorSk);
};

describe("a pin's proof", () => {
  const message = buildMessageRumor(author, room, 0n, "Meet at 6", 250, 1_789_000_000);

  it("proves the message: its author, words, room and time, and its id", () => {
    const entry = makePinEntry(sealOf(message), conv);
    expect(entry.keys).toMatch(/^[0-9a-f]{152}$/); // 76 bytes
    const v = verifyPinEntry(entry, room);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.rumor).toMatchObject({ pubkey: author, content: "Meet at 6", created_at: 1_789_000_000 });
    expect(v.id).toBe(getEventHash(message as never));
  });

  it("its keys open that message and no other", () => {
    const keys = makePinEntry(sealOf(message), conv).keys;
    const other = sealOf(buildMessageRumor(author, room, 0n, "Something else", 1, 1_789_000_001));
    expect(verifyPinEntry({ seal: other, keys }, room).ok).toBe(false);
  });

  it("is refused in another room's list", () => {
    expect(verifyPinEntry(makePinEntry(sealOf(message), conv), otherRoom).ok).toBe(false);
  });

  it("only a message or a thread reply can be pinned", () => {
    const reaction = buildReactionRumor(author, room, 0n, "🔥", { id: "m", pubkey: author }, 1, 1_789_000_002);
    expect(verifyPinEntry(makePinEntry(sealOf(reaction), conv), room).ok).toBe(false);
  });

  it("a seal someone altered fails", () => {
    const entry = makePinEntry(sealOf(message), conv);
    const altered = { ...entry, seal: { ...entry.seal, created_at: entry.seal.created_at + 1 } };
    expect(verifyPinEntry(altered, room).ok).toBe(false);
  });

  it("a message claiming another author than its seal's signer is refused", () => {
    const impostor = buildMessageRumor(stranger, room, 0n, "I never said this", 1, 1_789_000_003);
    expect(verifyPinEntry(makePinEntry(sealOf(impostor), conv), room).ok).toBe(false);
  });
});
