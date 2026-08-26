/**
 * Small LRU-ish TTL cache used across server routes (OG previews, RSS, share
 * cards, …). Extracted from routes.ts so other server modules (og-cards.ts)
 * can share the implementation without importing the whole route registry.
 */
export class TTLCache<T> {
  private cache = new Map<string, { data: T; timestamp: number; ttl: number }>();
  constructor(private maxSize: number, private ttl: number) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  /** Cache `data`. Pass `ttl` to override the default lifetime for this entry
   *  (e.g. a longer TTL for slow-changing podcast feeds). */
  set(key: string, data: T, ttl: number = this.ttl): void {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, timestamp: Date.now(), ttl });
  }

  get size() { return this.cache.size; }
}
