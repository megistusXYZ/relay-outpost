import type { Event, Filter } from "nostr-tools";
import { subscriptionKey } from "./subscription-key";

/**
 * De-dupes identical concurrent subscriptions into one underlying socket
 * subscription and fans events out to every consumer, closing the shared
 * subscription only when the last consumer unsubscribes.
 *
 * The actual socket work is injected (`open`) so this is pure, deterministic,
 * and unit-testable with a fake opener — and so it can wrap either
 * `throttledPoolSubscribe` or `persistentPoolSubscribe` unchanged. Behaviour is
 * preserved for consumers that genuinely overlap in time; a consumer that joins
 * after the shared subscription has already EOSE'd gets an immediate `oneose`
 * (it shares the live stream going forward but not replayed history), which
 * matches how these subscriptions are used (EOSE just clears a loading state).
 */
export interface SubscriptionConsumer {
  onevent?: (e: Event) => void;
  oneose?: () => void;
}

export interface SubscriptionHandle {
  close(): void;
}

export type SubscriptionOpener = (
  relays: string[],
  filters: Filter | Filter[],
  handlers: { onevent: (e: Event) => void; oneose: () => void },
) => SubscriptionHandle;

interface SharedEntry {
  handle: SubscriptionHandle;
  consumers: Set<SubscriptionConsumer>;
  eosed: boolean;
}

export class SubscriptionRegistry {
  private shared = new Map<string, SharedEntry>();

  constructor(private readonly open: SubscriptionOpener) {}

  /** Number of distinct underlying subscriptions currently open. */
  get activeCount(): number {
    return this.shared.size;
  }

  subscribe(
    relays: string[],
    filters: Filter | Filter[],
    consumer: SubscriptionConsumer,
  ): SubscriptionHandle {
    const key = subscriptionKey(relays, filters);
    let entry = this.shared.get(key);
    if (!entry) {
      const consumers = new Set<SubscriptionConsumer>();
      const created: SharedEntry = { handle: { close() {} }, consumers, eosed: false };
      created.handle = this.open(relays, filters, {
        onevent: (ev) => {
          for (const c of consumers) c.onevent?.(ev);
        },
        oneose: () => {
          created.eosed = true;
          for (const c of consumers) c.oneose?.();
        },
      });
      this.shared.set(key, created);
      entry = created;
    }
    entry.consumers.add(consumer);
    if (entry.eosed) consumer.oneose?.();

    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        const cur = this.shared.get(key);
        if (!cur) return;
        cur.consumers.delete(consumer);
        if (cur.consumers.size === 0) {
          cur.handle.close();
          this.shared.delete(key);
        }
      },
    };
  }
}
