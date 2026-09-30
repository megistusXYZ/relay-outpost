/**
 * One read, shared by every visitor.
 *
 * For lists the server reads from relays on everyone's behalf (the relay
 * directory, the Feed tile's sample). A list is served as-is for `freshMs`.
 * After that it is still served while ONE new read replaces it, so nobody
 * waits on a refresh. A read that fails, or comes back with nothing, never
 * replaces a list in hand; that list is kept for `keepMs` at most, and a
 * failed refresh isn't tried again sooner than `retryMs`. With no list in
 * hand the caller gets the read's own answer, `reached: false` included, and
 * later callers get that same answer until `retryMs` has passed.
 */
export interface SharedAnswer<T> {
  reached: boolean;
  items: T[];
}

export function createSharedRead<T>(opts: {
  read: () => Promise<SharedAnswer<T>>;
  freshMs: number;
  keepMs: number;
  retryMs: number;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  let held: { at: number; items: T[] } | null = null;
  let reading: Promise<SharedAnswer<T>> | null = null;
  let lastTryAt = -Infinity;
  /** The last read's answer when it left nothing in hand (failed, or empty). */
  let lastMiss: SharedAnswer<T> | null = null;

  function refresh(): Promise<SharedAnswer<T>> {
    if (reading) return reading;
    lastTryAt = now();
    reading = Promise.resolve()
      .then(opts.read)
      .catch(() => ({ reached: false, items: [] as T[] }))
      .then((answer) => {
        if (answer.reached && answer.items.length > 0) { held = { at: now(), items: answer.items }; lastMiss = null; }
        else lastMiss = answer;
        return answer;
      })
      .finally(() => { reading = null; });
    return reading;
  }

  async function read(): Promise<SharedAnswer<T>> {
    const age = held ? now() - held.at : Infinity;
    if (held && age < opts.keepMs) {
      if (age >= opts.freshMs && now() - lastTryAt >= opts.retryMs) void refresh();
      return { reached: true, items: held.items };
    }
    held = null;
    // Visitors can't make the server read in a loop: a miss is repeated to
    // whoever asks until it's time to try again.
    if (lastMiss && !reading && now() - lastTryAt < opts.retryMs) return lastMiss;
    return refresh();
  }

  return { read };
}
