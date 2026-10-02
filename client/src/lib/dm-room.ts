/**
 * What a private (NIP-17) conversation IS: the set of people in it.
 *
 * There is no room id on the wire. A message names its recipients in `p` tags,
 * and the sender plus everyone named is the conversation — so a message to two
 * people is a different chat from a message to either one of them.
 *
 * Until 2026-10-02 this app read only the FIRST `p` tag and filed every
 * message under its sender. A message Alice sent to you and Bob landed in your
 * one-to-one chat with Alice, looked like a private word from her, and your
 * reply went to Alice alone. Other apps (Amethyst, Brainstorm) send such
 * messages every day.
 *
 * The key for a chat with ONE other person is that person's public key —
 * exactly what was stored before, so nothing kept on a device needs moving.
 * A chat with several people gets a key no public key can equal.
 *
 * Pure: no relay, no signer, no storage. The rules, and their table of tests.
 */
import { nip19 } from "nostr-tools";

const HEX64 = /^[0-9a-f]{64}$/;
export const GROUP_ROOM_PREFIX = "group:";

/** Everyone in the conversation a message belongs to, sender included, sorted. */
export function participantsOf(sender: string, tags: readonly string[][] | undefined): string[] {
  const set = new Set<string>();
  if (HEX64.test(sender)) set.add(sender);
  for (const t of tags ?? []) {
    if (t[0] === "p" && typeof t[1] === "string" && HEX64.test(t[1])) set.add(t[1]);
  }
  return [...set].sort();
}

/**
 * The chat a message belongs to, for the reader `me`. Null when it belongs to
 * none we show:
 *  - it doesn't involve the reader at all (someone wrapped to us a message
 *    written to other people: it must not appear as if it were said to us);
 *  - it is a note to self (unchanged: this app has no such chat).
 */
export function roomKeyFor(msg: { sender: string; tags: readonly string[][] | undefined }, me: string): string | null {
  const everyone = participantsOf(msg.sender, msg.tags);
  if (!everyone.includes(me)) return null;
  const others = everyone.filter((pk) => pk !== me);
  if (others.length === 0) return null;
  if (others.length === 1) return others[0];
  return GROUP_ROOM_PREFIX + others.join(",");
}

export function isGroupRoom(key: string | null | undefined): boolean {
  return !!key && key.startsWith(GROUP_ROOM_PREFIX);
}

/** The other people in a chat: one for a one-to-one chat, several for a group. */
export function roomMembers(key: string): string[] {
  if (!isGroupRoom(key)) return HEX64.test(key) ? [key] : [];
  return key.slice(GROUP_ROOM_PREFIX.length).split(",").filter((pk) => HEX64.test(pk));
}

/** The key for a chat between the reader and these other people. */
export function roomKeyOfMembers(others: Iterable<string>): string | null {
  const list = [...new Set(others)].filter((pk) => HEX64.test(pk)).sort();
  if (list.length === 0) return null;
  return list.length === 1 ? list[0] : GROUP_ROOM_PREFIX + list.join(",");
}

/** The chat as a URL segment: its people as npubs joined by "+". */
export function roomSlug(key: string): string {
  return roomMembers(key).map((pk) => nip19.npubEncode(pk)).join("+");
}

/** The inverse of roomSlug. Accepts npubs, nprofiles or hex keys; null for anything else. */
export function roomKeyFromSlug(slug: string, me?: string | null): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(slug); } catch { return null; }
  const others: string[] = [];
  for (const raw of decoded.split("+")) {
    const part = raw.trim();
    if (!part) continue;
    if (HEX64.test(part.toLowerCase())) { others.push(part.toLowerCase()); continue; }
    try {
      const id = nip19.decode(part);
      if (id.type === "npub") others.push(id.data);
      else if (id.type === "nprofile") others.push(id.data.pubkey);
      else return null;
    } catch {
      return null;
    }
  }
  return roomKeyOfMembers(others.filter((pk) => pk !== me));
}

/** NIP-17: a chat's name rides on a message's `subject` tag; the newest one is the name. */
export function subjectOf(tags: readonly string[][] | undefined): string | undefined {
  const s = (tags ?? []).find((t) => t[0] === "subject")?.[1]?.trim();
  // A name, not a message: one line, and short enough for a header.
  return s ? s.replace(/\s+/g, " ").slice(0, 80) : undefined;
}

/** NIP-40: when a message stops being shown (unix seconds), if it says. */
export function expirationOf(tags: readonly string[][] | undefined): number | undefined {
  const raw = (tags ?? []).find((t) => t[0] === "expiration")?.[1];
  if (!raw || !/^\d{1,12}$/.test(raw)) return undefined;
  const at = Number(raw);
  return at > 0 ? at : undefined;
}

/** A message whose time is up. One with no expiry never is. */
export function isExpired(expiresAt: number | undefined, nowSec: number): boolean {
  return typeof expiresAt === "number" && expiresAt <= nowSec;
}

/** A group's name when nobody has given it one: its people, by name. */
export function groupTitle(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max).join(", ");
  const more = names.length - max;
  return more > 0 ? `${shown} +${more}` : shown;
}

/** The newer name wins, whichever message arrives first. */
export function newerSubject(
  current: { subject?: string; subjectAt?: number } | undefined,
  incoming: { subject?: string; at: number },
): { subject?: string; subjectAt?: number } {
  if (!incoming.subject) return { subject: current?.subject, subjectAt: current?.subjectAt };
  if (current?.subject && (current.subjectAt ?? 0) > incoming.at) return { subject: current.subject, subjectAt: current.subjectAt };
  return { subject: incoming.subject, subjectAt: incoming.at };
}
