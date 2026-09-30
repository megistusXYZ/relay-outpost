/**
 * Trust-score lookups made at the same moment go out as one request.
 *
 * Every tile and badge asks for scores on its own. On a cold Discover load
 * that was eight requests, five of them in the same instant (measured
 * 2026-09-30: Videos, Articles, Events and Feed, 144 people, in chunks of
 * 50), against a limit of 30 requests a minute per IP. Callers that ask
 * within `windowMs` of each other now share a request, a person is never
 * asked about twice at once, and no request carries more people than the
 * server takes.
 *
 * A person missing from an answer wasn't answered about (the request failed
 * or the server left them out). That is not "no score": see
 * lib/discover-trust.ts.
 */
type Scores = Map<string, number>;

export function createScoreBatcher(opts: {
  /** One request to the server. Resolves with whoever it answered about. */
  send: (pubkeys: string[]) => Promise<Scores>;
  /** The most people the server takes in one request. */
  maxPerRequest: number;
  /** How long a caller waits for others to join its request. */
  windowMs: number;
  /** Requests in flight at once when one moment's people need several. */
  concurrency?: number;
}) {
  const concurrency = opts.concurrency ?? 4;
  /** Who is queued or being asked about, and the request that will answer. */
  const pending = new Map<string, Promise<Scores>>();
  let queue: string[] = [];
  let gathering: Promise<Scores> | null = null;

  function joinNextRequest(): Promise<Scores> {
    if (gathering) return gathering;
    const mine: Promise<Scores> = new Promise((resolve) => {
      setTimeout(async () => {
        const people = queue;
        queue = [];
        gathering = null;
        const chunks: string[][] = [];
        for (let i = 0; i < people.length; i += opts.maxPerRequest) chunks.push(people.slice(i, i + opts.maxPerRequest));
        const answered: Scores = new Map();
        let next = 0;
        const worker = async () => {
          while (next < chunks.length) {
            const got = await opts.send(chunks[next++]).catch(() => new Map() as Scores);
            got.forEach((v, k) => answered.set(k, v));
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
        for (const pk of people) if (pending.get(pk) === mine) pending.delete(pk);
        resolve(answered);
      }, opts.windowMs);
    });
    gathering = mine;
    return mine;
  }

  /** Scores for these people; anyone missing wasn't answered about. */
  async function ask(pubkeys: readonly string[]): Promise<Scores> {
    const wanted = new Set(pubkeys);
    const requests = new Set<Promise<Scores>>();
    for (const pk of wanted) {
      let request = pending.get(pk);
      if (!request) {
        queue.push(pk);
        request = joinNextRequest();
        pending.set(pk, request);
      }
      requests.add(request);
    }
    const out: Scores = new Map();
    for (const answered of await Promise.all(requests)) {
      answered.forEach((v, k) => { if (wanted.has(k)) out.set(k, v); });
    }
    return out;
  }

  return { ask };
}
