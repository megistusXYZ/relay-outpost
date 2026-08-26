import type { Event } from "nostr-tools";
import { pool, FAST_RELAYS, fetchProfilesCached } from "./nostr";
import { getPollExpiration, isPollOpen } from "./poll-sort";

export const KIND_POLL = 1068;
export const KIND_POLL_RESPONSE = 1018;

// Pure sort/filter helpers live in poll-sort.ts (no pool import → node-testable).
export {
  getPollExpiration, isPollOpen, filterPollsByShow, sortPolls, pollHotScore,
  type PollSortMode, type PollShowMode,
} from "./poll-sort";

export function isPollEvent(event: Event): boolean {
  return event.kind === KIND_POLL;
}

function fetchFromRelays(relays: string[], filter: Record<string, any>, timeoutMs: number): Promise<Event[]> {
  return new Promise<Event[]>((resolve) => {
    const events: Event[] = [];
    const seen = new Set<string>();
    let resolved = false;
    let subRef: { close: () => void } | null = null;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      try { subRef?.close(); } catch {}
      resolve(events);
    };

    const timeout = setTimeout(finish, timeoutMs);

    subRef = pool.subscribeMany(relays, filter as any, {
      onevent(event: Event) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          events.push(event);
        }
      },
      oneose() {
        clearTimeout(timeout);
        finish();
      },
    });
  });
}

export type PollsFeedResult = {
  polls: Event[];
  responseCounts: Map<string, number>;
};

/**
 * Fetch the network polls feed. Default behavior (no opts) is unchanged:
 * closed polls are dropped and the result is the open-poll priority order.
 * `includeClosed: true` (the Saved Polls surface) keeps already-ended polls —
 * appended after the open set, newest-first — so a downstream Open/All filter
 * and sort (filterPollsByShow/sortPolls) have the full set to work with. No
 * extra relay queries: closed polls ride the same poll + response batches.
 */
export async function fetchPollsFeed(opts?: { includeClosed?: boolean }): Promise<PollsFeedResult> {
  const includeClosed = opts?.includeClosed ?? false;
  const relays = FAST_RELAYS.slice(0, 5);
  const since = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;

  const allPolls = await fetchFromRelays(relays, { kinds: [KIND_POLL], since, limit: 150 }, 10000);

  const now = Math.floor(Date.now() / 1000);
  const validPolls = allPolls.filter(p => {
    const hasOptions = p.tags.some(t => t[0] === "option" && t[1] !== undefined && t[2] !== undefined);
    if (!hasOptions) return false;
    if (!includeClosed && !isPollOpen(p, now)) return false;
    return true;
  });

  if (validPolls.length === 0) return { polls: [], responseCounts: new Map() };

  const pollIds = validPolls.map(p => p.id);
  const responseCounts = new Map<string, number>();

  const batchSize = 30;
  const responsePromises: Promise<Event[]>[] = [];
  for (let i = 0; i < pollIds.length; i += batchSize) {
    const batch = pollIds.slice(i, i + batchSize);
    responsePromises.push(
      fetchFromRelays(relays, { kinds: [KIND_POLL_RESPONSE], "#e": batch, limit: 500 }, 8000)
    );
  }

  const responseResults = await Promise.all(responsePromises);
  for (const responses of responseResults) {
    for (const resp of responses) {
      const pollRef = resp.tags.find(t => t[0] === "e");
      if (pollRef && pollRef[1]) {
        responseCounts.set(pollRef[1], (responseCounts.get(pollRef[1]) || 0) + 1);
      }
    }
  }

  // Open-poll priority order (unchanged); closed polls, when requested, are
  // appended after it rather than competing for the open feed's slots.
  const openPolls = includeClosed ? validPolls.filter(p => isPollOpen(p, now)) : validPolls;
  const closedPolls = includeClosed ? validPolls.filter(p => !isPollOpen(p, now)) : [];

  const withActivity = openPolls.filter(p => (responseCounts.get(p.id) || 0) > 0);
  const withoutActivity = openPolls.filter(p => (responseCounts.get(p.id) || 0) === 0);

  withActivity.sort((a, b) => {
    const expA = getPollExpiration(a);
    const expB = getPollExpiration(b);
    const hasExpA = expA !== null;
    const hasExpB = expB !== null;
    if (hasExpA && !hasExpB) return -1;
    if (!hasExpA && hasExpB) return 1;
    if (hasExpA && hasExpB) return expA - expB;
    const countsA = responseCounts.get(a.id) || 0;
    const countsB = responseCounts.get(b.id) || 0;
    if (countsA !== countsB) return countsB - countsA;
    return b.created_at - a.created_at;
  });

  withoutActivity.sort((a, b) => {
    const expA = getPollExpiration(a);
    const expB = getPollExpiration(b);
    const hasExpA = expA !== null;
    const hasExpB = expB !== null;
    if (hasExpA && !hasExpB) return -1;
    if (!hasExpA && hasExpB) return 1;
    if (hasExpA && hasExpB) return expA - expB;
    return b.created_at - a.created_at;
  });

  const maxInactive = Math.max(0, 10 - withActivity.length);
  const openSorted = [...withActivity, ...withoutActivity.slice(0, maxInactive)].slice(0, 40);

  // Closed polls: newest first, same cap as the open set.
  closedPolls.sort((a, b) => b.created_at - a.created_at);
  const sorted = [...openSorted, ...closedPolls.slice(0, 40)];

  const pubkeys = [...new Set(sorted.map(p => p.pubkey))];
  if (pubkeys.length > 0) fetchProfilesCached(pubkeys);

  return { polls: sorted, responseCounts };
}
