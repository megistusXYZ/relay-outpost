/**
 * Parent-post resolution — the decidable half of "show the post this reply
 * answers". The component (NostrPost) owns state and rendering; everything
 * that can be wrong on its own lives here, testable.
 *
 * Live report that created this module (2026-08-26, The Forest outpost feed):
 * "Loading parent post..." forever. The inline fetch asked 4 default relays
 * for a parent that lived on the outpost's relay, never settled non-hex
 * targets, and filed "we never got to ask" as "does not exist" — which drops
 * the reply from the feed. See RELAY_REACHABILITY.md for the defect class.
 */

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * What kind of thing does this reply point at?
 * - "event": a fetchable 64-hex event id.
 * - "invalid": present but not fetchable by id (malformed tag, address-style
 *   value). Must SETTLE — the old code returned early and span forever.
 * - "none": not a reply.
 */
export function classifyParentTarget(target: string | null): "event" | "invalid" | "none" {
  if (target === null) return "none";
  return HEX64.test(target) ? "event" : "invalid";
}

const RELAY_URL = /^wss?:\/\/./i;
const CANDIDATE_CAP = 8;

function normalizeRelay(url: string): string | null {
  const trimmed = url.trim().toLowerCase();
  if (!RELAY_URL.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

/**
 * Map a reach-aware query result onto the three honest outcomes:
 * "found" (we have the event), "missing" (a relay answered and it isn't
 * there), "unreached" (nobody answered — nothing may be concluded, and the
 * UI must not claim absence). Shared by the reply-parent fetch and the
 * quoted/embedded-note fetches — the old code in both collapsed the last two.
 */
export function resolveFetchOutcome(res: {
  events: readonly unknown[];
  answered: boolean;
}): "found" | "missing" | "unreached" {
  if (res.events.length > 0) return "found";
  return res.answered ? "missing" : "unreached";
}

/**
 * Ordered, deduped relay candidates for any hinted fetch. Pass groups of
 * candidate urls most-likely-first (encoded hints, seen-on relays, defaults);
 * the result is one flat list — junk dropped, trailing-slash/case spellings
 * deduped, capped so a widely-shared reference must not fan one lookup out to
 * a dozen sockets. The parent fetch and the quoted-embed fetches both build
 * their candidate lists here so the rules cannot drift.
 */
export function orderedRelayCandidates(
  groups: ReadonlyArray<readonly string[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group) {
      const url = normalizeRelay(raw ?? "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= CANDIDATE_CAP) return out;
    }
  }
  return out;
}

/**
 * Which relays to ask for a reply's parent, most-likely first:
 *
 *  1. the NIP-10 relay hint on the e-tag pointing at the parent — the author
 *     told us where it lives;
 *  2. the relays this reply itself arrived on — in an outpost feed that is
 *     the community relay, which is exactly where the old code never looked;
 *  3. the app defaults, as the long tail.
 */
export function parentRelayCandidates(opts: {
  event: { tags: string[][] };
  targetId: string;
  seenOn: readonly string[];
  defaults: readonly string[];
}): string[] {
  const { event, targetId, seenOn, defaults } = opts;
  const hint = event.tags.find((t) => t[0] === "e" && t[1] === targetId)?.[2] ?? "";
  return orderedRelayCandidates([[hint], seenOn, defaults]);
}
