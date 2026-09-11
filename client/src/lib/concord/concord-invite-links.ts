/**
 * What an invite link knows about itself (CORD-05 §1): who made it, what they
 * named it, when it runs out, and how many people joined through it. Pure.
 *
 * A joiner echoes the bundle's creator and label in their Join, so the creator
 * counts joins per label. Two links with the same label share one count, and a
 * link with no label counts under "".
 */
import { nip19 } from "nostr-tools";
import { joinLeaveVerb, readInviteAttribution } from "./concord-events";

const HEX32 = /^[0-9a-f]{64}$/;

/** The attribution a Join through this bundle carries, or null when the bundle names no creator. */
export function inviteAttribution(bundle: { creator_npub?: string; label?: string }): { creator: string; label: string } | null {
  const raw = bundle.creator_npub?.trim() ?? "";
  let creator: string | null = HEX32.test(raw) ? raw : null;
  if (!creator && raw.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === "npub") creator = decoded.data;
    } catch { /* not a key */ }
  }
  if (!creator) return null;
  return { creator, label: typeof bundle.label === "string" ? bundle.label.trim() : "" };
}

/** How many different people joined through each of `creator`'s links, by label. */
export function joinCountsByLabel(joinLeave: { pubkey: string; tags: string[][]; content?: string }[], creator: string): Map<string, number> {
  const people = new Map<string, Set<string>>();
  for (const ev of joinLeave) {
    if (joinLeaveVerb(ev) !== "join") continue;
    const via = readInviteAttribution(ev);
    if (!via || via.creator !== creator) continue;
    if (!people.has(via.label)) people.set(via.label, new Set());
    people.get(via.label)!.add(ev.pubkey);
  }
  return new Map([...people].map(([label, who]) => [label, who.size]));
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const EXPIRY_CHOICES = [
  { id: "never", label: "Never", ms: 0 },
  { id: "1d", label: "1 day", ms: DAY },
  { id: "7d", label: "7 days", ms: 7 * DAY },
  { id: "30d", label: "30 days", ms: 30 * DAY },
] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]["id"];

/** The bundle's `expires_at` (unix ms) for a choice made now, or undefined for never. */
export function expiryAfter(choice: ExpiryChoice, now = Date.now()): number | undefined {
  const ms = EXPIRY_CHOICES.find((c) => c.id === choice)?.ms ?? 0;
  return ms > 0 ? now + ms : undefined;
}

/** A link's expiry in words: null when it never expires. */
export function linkExpiry(expiresAt: number | undefined, now = Date.now()): { expired: boolean; text: string } | null {
  if (!expiresAt) return null;
  const left = expiresAt - now;
  if (left <= 0) return { expired: true, text: "Expired" };
  if (left >= DAY) {
    const days = Math.floor(left / DAY);
    return { expired: false, text: `Expires in ${days} day${days === 1 ? "" : "s"}` };
  }
  const hours = Math.max(1, Math.floor(left / HOUR));
  return { expired: false, text: `Expires in ${hours} hour${hours === 1 ? "" : "s"}` };
}
