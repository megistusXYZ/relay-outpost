/**
 * The live half of lib/deletion-watch.ts: every author whose post is on
 * screen gets their deletions asked once, in one batched request, from the
 * relays the feeds already read. A deletion that checks out goes into the
 * event store (which drops that author's named events) and into the
 * deleted-ids set (which feeds, threads and tombstones read). Forged ones
 * — wrong signature, or naming another author's post — are ignored.
 */
import { verifyEvent, type Event } from "nostr-tools";
import { eventStore, getRelaysForPurpose, throttledPoolSubscribe } from "./nostr";
import { markDeleted } from "./deleted-events";
import { authorsToAsk, deletedIdsFrom } from "./deletion-watch";

const asked = new Set<string>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY_MS = 50;
const CHUNK = 100;

export function watchDeletionsFor(authors: string[]): void {
  for (const a of authorsToAsk(asked, authors)) pending.add(a);
  if (pending.size === 0 || timer) return;
  timer = setTimeout(flush, BATCH_DELAY_MS);
}

function flush(): void {
  timer = null;
  const batch = Array.from(pending);
  pending.clear();
  const relays = getRelaysForPurpose("notes").slice(0, 4);
  if (batch.length === 0 || relays.length === 0) return;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const authors = batch.slice(i, i + CHUNK);
    for (const relay of relays) {
      const sub = throttledPoolSubscribe([relay], { kinds: [5], authors, limit: 500 }, {
        onevent(ev: Event) { acceptDeletion(ev); },
        oneose() { try { sub.close(); } catch {} },
      });
    }
  }
}

/** A deletion that checks out: properly signed, and only its author's own events count. */
export function acceptDeletion(ev: Event): boolean {
  if (ev.kind !== 5) return false;
  try { if (!verifyEvent(ev)) return false; } catch { return false; }
  const ids = deletedIdsFrom(ev);
  if (ids.length === 0) return false;
  eventStore.add(ev);
  markDeleted(ids, ev.pubkey);
  return true;
}

/** Tests only. */
export function _resetDeletionWatch(): void { asked.clear(); pending.clear(); if (timer) { clearTimeout(timer); timer = null; } }
