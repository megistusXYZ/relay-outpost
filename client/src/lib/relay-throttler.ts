import type { SubCloser } from "nostr-tools/abstract-pool";

const MAX_CONCURRENT_PER_RELAY = 8;
const QUEUE_CHECK_INTERVAL = 100;

interface QueuedSubscription {
  relay: string;
  execute: () => SubCloser;
  resolve: (sub: SubCloser) => void;
}

const activeCountByRelay = new Map<string, number>();
const queueByRelay = new Map<string, QueuedSubscription[]>();

function getActiveCount(relay: string): number {
  return activeCountByRelay.get(relay) ?? 0;
}

function incrementActive(relay: string) {
  activeCountByRelay.set(relay, getActiveCount(relay) + 1);
}

function decrementActive(relay: string) {
  const count = getActiveCount(relay);
  if (count <= 1) {
    activeCountByRelay.delete(relay);
  } else {
    activeCountByRelay.set(relay, count - 1);
  }
  drainQueue(relay);
}

function drainQueue(relay: string) {
  const queue = queueByRelay.get(relay);
  if (!queue || queue.length === 0) return;

  while (queue.length > 0 && getActiveCount(relay) < MAX_CONCURRENT_PER_RELAY) {
    const item = queue.shift()!;
    incrementActive(relay);
    const sub = item.execute();
    item.resolve(wrapSubCloser(sub, relay));
  }

  if (queue.length === 0) {
    queueByRelay.delete(relay);
  }
}

function wrapSubCloser(sub: SubCloser, relay: string): SubCloser {
  let closed = false;
  return {
    ...sub,
    close() {
      if (closed) return;
      closed = true;
      sub.close();
      decrementActive(relay);
    },
  };
}

export function throttledSubscribe(
  relay: string,
  execute: () => SubCloser,
): SubCloser {
  if (getActiveCount(relay) < MAX_CONCURRENT_PER_RELAY) {
    incrementActive(relay);
    const sub = execute();
    return wrapSubCloser(sub, relay);
  }

  let resolvePromise: (sub: SubCloser) => void;
  let wrappedSub: SubCloser | null = null;
  let cancelled = false;

  const promise = new Promise<SubCloser>((resolve) => {
    resolvePromise = resolve;
  });

  promise.then((sub) => {
    if (cancelled) {
      sub.close();
    } else {
      wrappedSub = sub;
    }
  });

  const item: QueuedSubscription = {
    relay,
    execute,
    resolve: resolvePromise!,
  };

  if (!queueByRelay.has(relay)) {
    queueByRelay.set(relay, []);
  }
  queueByRelay.get(relay)!.push(item);

  return {
    close() {
      cancelled = true;
      if (wrappedSub) {
        wrappedSub.close();
      } else {
        const queue = queueByRelay.get(relay);
        if (queue) {
          const idx = queue.indexOf(item);
          if (idx >= 0) queue.splice(idx, 1);
        }
      }
    },
  };
}

const inflightProfiles = new Map<string, Promise<void>>();
const inflightInteractions = new Map<string, Promise<void>>();

export function deduplicateProfileFetch(pubkey: string, fetcher: () => Promise<void>): Promise<void> {
  const existing = inflightProfiles.get(pubkey);
  if (existing) return existing;
  const promise = fetcher().finally(() => {
    inflightProfiles.delete(pubkey);
  });
  inflightProfiles.set(pubkey, promise);
  return promise;
}

export function deduplicateInteractionFetch(eventId: string, fetcher: () => Promise<void>): Promise<void> {
  const existing = inflightInteractions.get(eventId);
  if (existing) return existing;
  const promise = fetcher().finally(() => {
    inflightInteractions.delete(eventId);
  });
  inflightInteractions.set(eventId, promise);
  return promise;
}

export function getThrottlerStats(): { activeByRelay: Record<string, number>; queuedByRelay: Record<string, number> } {
  const active: Record<string, number> = {};
  const queued: Record<string, number> = {};
  activeCountByRelay.forEach((count, relay) => {
    active[relay] = count;
  });
  queueByRelay.forEach((queue, relay) => {
    queued[relay] = queue.length;
  });
  return { activeByRelay: active, queuedByRelay: queued };
}
