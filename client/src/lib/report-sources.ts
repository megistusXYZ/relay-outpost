/**
 * Where NIP-56 reports actually live.
 *
 * The reports queue used to ask ONE relay for kind-1984: the group's own. That
 * is the one place a report can never be, and it was measured rather than
 * argued (2026-08-05, see POSITIONING_AND_IA.md):
 *
 *   bunk-test (newlay 0.3.6)      OK:true, then silently dropped — never served
 *                                 back by #p, #h, authors or ids, authenticated
 *   relay.groups.nip29.com        refused: "blocked: missing group (`h`) tag"
 *   groups.fiatjaf.com            refused: same
 *
 * Adding an `h` tag does not rescue it; newlay accepted an h-tagged report and
 * dropped that too. relay29 refuses a plain kind-1 for the same reason. **A
 * NIP-29 relay stores group-tagged events and nothing else**, so the queue was
 * asking a reachable relay a question that structurally could not contain its
 * answer — the third time this codebase has made that exact mistake.
 *
 * A report is a public, unaddressed statement about a person. It goes to the
 * reporter's ordinary write relays, which is where every other client publishes
 * one and where `ReportDialog` has always sent ours. So that is where a
 * moderator has to look.
 *
 * WHAT THIS DOES NOT CHANGE: which room a report is ABOUT is still proven, not
 * assumed. The reported event is resolved by id against the GROUP's relay and
 * its `h` tag read (`applyGroupScope`). Reports come from public relays;
 * scoping still comes from the room. Those are two different questions and they
 * are asked in two different places on purpose.
 */
import type { Event as NostrEvent } from "nostr-tools";
import { pool, DEFAULT_RELAYS } from "./nostr";
import { REPORT_HORIZON_SECONDS } from "./reports-queue";

/**
 * Read reports from the broad public set rather than a curated one.
 *
 * A report is written by whoever is complaining, to THEIR relays, and we have
 * no NIP-65 list for a stranger at the moment we need it. Narrowing this set
 * trades a real chance of missing a report against a little traffic, and for a
 * moderation queue that trade is the wrong way round.
 */
export const REPORT_READ_RELAYS = DEFAULT_RELAYS;

/** Matches `fetchGroupReports` — a filter with thousands of `#p` entries is refused outright by some relays. */
const MAX_TARGETS = 200;

/**
 * Every kind-1984 naming any of these pubkeys, from the public relays.
 *
 * `maxWait` is set deliberately high for the reason #583 documents: nostr-tools
 * fabricates an EOSE on a slow relay, and a fetch that ends on the fabricated
 * one reports "nothing here" about a relay that simply had not spoken yet.
 *
 * HONEST LIMITATION, stated because the rest of this file is about not hiding
 * these: a total public-relay blackout is indistinguishable from "nobody has
 * been reported". The queue's `sweep` counts the group relays — the ones that
 * decide whether you moderate anything at all — and does not count these.
 */
export async function fetchReportsAbout(
  pubkeys: string[],
  relays: string[] = REPORT_READ_RELAYS,
): Promise<NostrEvent[]> {
  const targets = (pubkeys ?? []).filter(Boolean).slice(0, MAX_TARGETS);
  if (targets.length === 0 || relays.length === 0) return [];
  try {
    return await pool.querySync(
      relays,
      // since: the queue's 90-day horizon (reports-queue.ts) drops older
      // reports anyway — fetching them just spends the 300-slot limit on rows
      // the fold will discard (a 3-year-old report was crowding out the queue).
      { kinds: [1984], "#p": targets, limit: 300, since: Math.floor(Date.now() / 1000) - REPORT_HORIZON_SECONDS },
      { maxWait: 8000 } as never,
    );
  } catch {
    // One failed read must not blank a moderator's queue — the group-relay
    // fetch this is merged with may still have found something.
    return [];
  }
}
