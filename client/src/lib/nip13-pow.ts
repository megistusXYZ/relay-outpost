/**
 * NIP-13 Proof-of-Work — a pure, dependency-free reader for the difficulty a
 * Nostr event carries.
 *
 * Why this exists: the global "For You" stranger floor (discover-quality.ts)
 * admits an out-of-network post only when it shows some *earned* signal — WoT,
 * engagement, established age/followers. A rotating spammer defeats every
 * history-based signal by minting a fresh key per burst, so none of those axes
 * ever accrue. PoW is the one signal that costs the same on a brand-new key as
 * on an old one: the author must burn compute to grind an event id with leading
 * zero bits. That per-post cost is exactly what a throwaway-account spammer
 * can't cheaply pay, which makes real PoW a legitimate "not free" admit signal.
 *
 * This module ONLY reads difficulty. It never grinds, never mutates events, and
 * never touches the network — the event id is already a hash we have in hand.
 */
import type { Event } from "nostr-tools";

/**
 * Leading zero BITS of a 32-byte event id (64-char lowercase hex).
 *
 * Per NIP-13, difficulty is counted in leading zero bits of the raw id, not hex
 * chars: each hex nibble is 4 bits, so a leading '0' contributes 4, and we stop
 * at the first nibble with a set bit — adding that nibble's own leading zeros.
 * Examples: '0' → 4, '00' → 8, '1…' → 3 (0b0001), '2…'/'3…' → 2, '4…'…'7…' → 1,
 * '8…'…'f…' → 0. A malformed/short id just yields fewer counted bits.
 */
export function powDifficulty(eventId: string): number {
  let count = 0;
  for (let i = 0; i < eventId.length; i++) {
    const nibble = parseInt(eventId[i], 16);
    if (Number.isNaN(nibble)) break; // non-hex char → stop counting
    if (nibble === 0) {
      count += 4;
      continue;
    }
    // clz32 of a 4-bit value (1..15) lands in 28..31; subtract 28 to get the
    // 0..3 leading zeros WITHIN this nibble, then stop — first set bit reached.
    count += Math.clz32(nibble) - 28;
    break;
  }
  return count;
}

/**
 * The difficulty the author COMMITTED to via the NIP-13 nonce tag
 * `["nonce", "<nonce>", "<target>"]` — the 3rd element is the target the miner
 * claims to have ground for. Returns 0 when there is no nonce tag (or the target
 * is absent / unparseable). This is a *claim*, not proof — see effectivePow.
 */
export function committedPowDifficulty(event: Pick<Event, "tags">): number {
  for (const tag of event.tags) {
    if (tag[0] === "nonce") {
      const target = parseInt(tag[2], 10);
      return Number.isNaN(target) ? 0 : target;
    }
  }
  return 0;
}

/**
 * The PoW difficulty we credit an event with — our chosen anti-spam signal.
 *
 * The real proof is the actual leading-zero bits of the id (a spammer can't fake
 * a hash). But NIP-13 lets an author commit to a target via the nonce tag, and
 * honoring it guards against crediting an id whose leading zeros happened by
 * accident rather than by grinding: when a nonce tag is present we take
 * `min(actual, committed target)`, so an author only ever gets the difficulty
 * they both claimed AND actually achieved. When there is NO nonce tag we fall
 * back to the actual bits — some clients stamp real PoW without a nonce tag, and
 * that ground work is still real. (`min` also means a bloated committed target
 * never inflates the credit past the real hash.)
 */
export function effectivePow(event: Pick<Event, "id" | "tags">): number {
  const actual = powDifficulty(event.id);
  const hasNonce = event.tags.some((t) => t[0] === "nonce");
  if (!hasNonce) return actual;
  return Math.min(actual, committedPowDifficulty(event));
}
