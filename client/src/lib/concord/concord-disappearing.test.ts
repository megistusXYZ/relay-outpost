/**
 * Disappearing messages (CORD-08). One timer, in the group's own settings;
 * while it's set, every lasting chat message carries its expiry inside what
 * its author signs, readers refuse and hide it once that passes, and relays
 * delete it. A change is never retroactive: a message keeps the expiry it was
 * sent under.
 */
import { describe, it, expect } from "vitest";
import { disappearingTimer, stampExpiration, isExpired } from "./concord-disappearing";
import { buildMessageRumor, buildReplyRumor, buildReactionRumor, buildEditRumor, buildDeleteRumor } from "./concord-events";

const alice = "a1".repeat(32), room = "c3".repeat(32);
const settings = (raw: Record<string, unknown>) => ({ name: "Book Club", relays: [], raw });

describe("the timer", () => {
  it("is read from the group's settings, in seconds; absent, zero or malformed is off", () => {
    expect(disappearingTimer(settings({ message_expiration: 604800 }))).toBe(604800);
    expect(disappearingTimer(settings({}))).toBe(0);
    expect(disappearingTimer(settings({ message_expiration: 0 }))).toBe(0);
    // "A reader MUST NOT guess a default from garbage."
    expect(disappearingTimer(settings({ message_expiration: "604800" }))).toBe(0);
    expect(disappearingTimer(settings({ message_expiration: -5 }))).toBe(0);
    expect(disappearingTimer(settings({ message_expiration: 1.5 }))).toBe(0);
    expect(disappearingTimer(undefined)).toBe(0);
  });
});

describe("sending while it's set", () => {
  it("every lasting chat message carries its expiry, from its own created_at", () => {
    const day = 86400;
    for (const r of [
      buildMessageRumor(alice, room, 0n, "hi", 1, 1000),
      buildReplyRumor(alice, room, 0n, "re", 1, 1000, { rootKind: 9, rootId: "r", rootPubkey: alice, parentKind: 9, parentId: "r", parentPubkey: alice }),
      buildReactionRumor(alice, room, 0n, "🔥", { id: "m", pubkey: alice }, 1, 1000),
      buildEditRumor(alice, room, 0n, "m", "fixed", 1, 1000),
    ]) {
      expect(stampExpiration(r, day).tags).toContainEqual(["expiration", String(1000 + day)]);
    }
  });

  it("a delete never expires, or the message it erased would come back", () => {
    const del = buildDeleteRumor(alice, room, 0n, "m", 1, 1000);
    expect(stampExpiration(del, 86400).tags.some((t) => t[0] === "expiration")).toBe(false);
  });

  it("with the timer off, nothing is added", () => {
    const msg = buildMessageRumor(alice, room, 0n, "hi", 1, 1000);
    expect(stampExpiration(msg, 0)).toEqual(msg);
  });
});

describe("reading", () => {
  it("a message past its expiry is refused; one still running, or with none, is kept", () => {
    const msg = stampExpiration(buildMessageRumor(alice, room, 0n, "hi", 1, 1000), 86400);
    expect(isExpired(msg, 1000 + 86400)).toBe(true);
    expect(isExpired(msg, 1000 + 86399)).toBe(false);
    expect(isExpired(buildMessageRumor(alice, room, 0n, "hi", 1, 1000), 9_999_999_999)).toBe(false);
  });
});
