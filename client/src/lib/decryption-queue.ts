// Central decryption queue.
//
// Every gift-wrap unwrap routes through this singleton so that, for users on a
// paranoid (NIP-46) signer that prompts per request, we:
//   1. COALESCE — concurrent requests for the same wrap id share one in-flight
//      promise (the same wrap arriving from multiple relays = one decrypt).
//   2. SERIALIZE — calls hit the signer one at a time instead of in a burst,
//      which remote signers (and their human approvers) handle far better.
//   3. REPORT — listeners get {queued, inFlight, completed} so the UI can show
//      a single progress bar while a batch drains.
//
// Pure logic (no DOM); the actual crypto is injected as a task thunk.

export interface QueueState {
  /** Tasks accepted but not yet started. */
  queued: number;
  /** Tasks currently awaiting the signer. */
  inFlight: number;
  /** Tasks settled since the last resetCompleted(). */
  completed: number;
}

type Listener = (state: QueueState) => void;

interface PendingEntry {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class DecryptionQueue {
  private concurrency: number;
  private queue: Array<{ id: string; entry: PendingEntry }> = [];
  private inFlightById = new Map<string, Promise<unknown>>();
  private active = 0;
  private completed = 0;
  private listeners = new Set<Listener>();

  constructor(concurrency = 1) {
    this.concurrency = Math.max(1, concurrency);
  }

  /** Enqueue a decrypt task keyed by `id`. Calls with an id already in flight
   *  (or queued) return the existing promise — the task runs exactly once. */
  enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlightById.get(id);
    if (existing) return existing as Promise<T>;

    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res as (v: unknown) => void;
      reject = rej;
    });

    // Track by id immediately so duplicates enqueued before this one starts
    // also coalesce onto the same promise.
    this.inFlightById.set(id, promise);
    this.queue.push({ id, entry: { run: task, resolve, reject } });
    this.emit();
    this.pump();
    return promise;
  }

  /** Current queue snapshot. */
  getState(): QueueState {
    return { queued: this.queue.length, inFlight: this.active, completed: this.completed };
  }

  /** Total outstanding work (queued + in flight). */
  outstanding(): number {
    return this.queue.length + this.active;
  }

  /** Zero the completed counter (call when starting a fresh batch for %). */
  resetCompleted(): void {
    this.completed = 0;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.getState();
    this.listeners.forEach((l) => {
      try { l(state); } catch { /* listener errors must not break the queue */ }
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const { id, entry } = this.queue.shift()!;
      this.active++;
      this.emit();
      Promise.resolve()
        .then(entry.run)
        .then(
          (val) => entry.resolve(val),
          (err) => entry.reject(err),
        )
        .finally(() => {
          this.active--;
          this.completed++;
          this.inFlightById.delete(id);
          this.emit();
          this.pump();
        });
    }
  }
}

// App-wide singleton. Concurrency 1 = strictly serial to the signer.
export const decryptionQueue = new DecryptionQueue(1);
