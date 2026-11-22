/**
 * Small LRU-ish TTL cache used across server routes (OG previews, RSS, share
 * cards, …). Extracted from routes.ts so other server modules (og-cards.ts)
 * can share the implementation without importing the whole route registry.
 *
 * A count limit alone doesn't bound memory when entries can be large, so a
 * cache may also take a byte budget: `sizeOf` measures an entry, the oldest
 * entries make room for new ones under `maxBytes`, and an entry over
 * `maxEntryBytes` is not kept.
 */
export interface TTLCacheBudget<T> {
  maxBytes: number;
  maxEntryBytes?: number;
  sizeOf: (data: T) => number;
}

export class TTLCache<T> {
  private cache = new Map<string, { data: T; timestamp: number; ttl: number; bytes: number }>();
  private totalBytes = 0;
  constructor(private maxSize: number, private ttl: number, private budget?: TTLCacheBudget<T>) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.remove(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  /** Cache `data`. Pass `ttl` to override the default lifetime for this entry
   *  (e.g. a longer TTL for slow-changing podcast feeds). */
  set(key: string, data: T, ttl: number = this.ttl): void {
    this.remove(key);
    const bytes = this.budget ? this.budget.sizeOf(data) : 0;
    if (this.budget && bytes > (this.budget.maxEntryBytes ?? this.budget.maxBytes)) return;
    while (this.cache.size >= this.maxSize || (this.budget && this.cache.size > 0 && this.totalBytes + bytes > this.budget.maxBytes)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      this.remove(firstKey);
    }
    this.cache.set(key, { data, timestamp: Date.now(), ttl, bytes });
    this.totalBytes += bytes;
  }

  private remove(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.totalBytes -= entry.bytes;
    this.cache.delete(key);
  }

  get size() { return this.cache.size; }
  /** Bytes held, as measured by the budget's `sizeOf` (0 without a budget). */
  get bytes() { return this.totalBytes; }
}
