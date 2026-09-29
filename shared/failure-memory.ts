/**
 * Remembers that an outside service just failed, so we answer "unavailable"
 * at once instead of paying its full timeout again on every request.
 *
 * Only failures are remembered; successes are the callers' own caches' job.
 * A caller that receives something the service shouldn't send (an HTML page
 * where JSON was due) throws inside `run`, and that counts as a failure too:
 * a wrong answer is not an answer.
 */
export class UpstreamUnavailable extends Error {
  constructor(public readonly key: string) {
    super(`${key} is unavailable (failed recently)`);
    this.name = "UpstreamUnavailable";
  }
}

export class FailureMemory {
  private downUntil = new Map<string, number>();

  constructor(
    private readonly waitMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 500,
  ) {}

  get size(): number {
    return this.downUntil.size;
  }

  isDown(key: string): boolean {
    const until = this.downUntil.get(key);
    if (until === undefined) return false;
    if (this.now() >= until) {
      this.downUntil.delete(key);
      return false;
    }
    return true;
  }

  failed(key: string): void {
    this.downUntil.delete(key); // re-insert so insertion order tracks recency
    this.downUntil.set(key, this.now() + this.waitMs);
    while (this.downUntil.size > this.maxKeys) {
      const oldest = this.downUntil.keys().next().value as string;
      this.downUntil.delete(oldest);
    }
  }

  succeeded(key: string): void {
    this.downUntil.delete(key);
  }

  async run<T>(key: string, call: () => Promise<T>): Promise<T> {
    if (this.isDown(key)) throw new UpstreamUnavailable(key);
    try {
      const value = await call();
      this.succeeded(key);
      return value;
    } catch (err) {
      this.failed(key);
      throw err;
    }
  }
}
