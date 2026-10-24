/**
 * Are the services Relay Outpost depends on still answering? (2026-10-23)
 *
 * The app leans on a fixed set of relays and outside services: the default
 * relays, the search relays, the profile directories, Primal, Brainstorm,
 * translate, podcasts, the bitcoin price. Twice one stopped and nobody knew
 * until a feature had gone quiet: Brainstorm's search API began answering
 * with a web page, and the translate endpoint got blocked. The server checks
 * every one on a timer; /api/service-health and the console card show what
 * isn't up and since when.
 *
 * Three states, never two (RELAY_REACHABILITY.md):
 *  - up:    answered, with what it should hold;
 *  - empty: answered, but with nothing where we know there is something
 *           (a directory with no profile for a well-known account, an API
 *           that answers with a web page);
 *  - down:  no answer.
 */

export type HealthState = "up" | "empty" | "down";

export interface Dependency {
  id: string;
  label: string;
  /** Which kind of thing, as the card groups them ("Default relays", "Outside services"…). */
  group: string;
  kind: "relay" | "directory" | "http" | "socket";
  target: string;
}

export interface CheckResult {
  state: HealthState;
  ms: number;
  detail?: string;
}

export interface DependencyStatus extends Dependency {
  state: HealthState;
  /** When it entered this state. */
  since: number;
  lastChecked: number;
  ms: number;
  detail?: string;
}

const RANK: Record<HealthState, number> = { down: 0, empty: 1, up: 2 };

/** One round of checks folded into what was known: same state keeps its since. */
export function foldHealth(
  previous: readonly DependencyStatus[],
  results: ReadonlyArray<readonly [Dependency, CheckResult]>,
  now: number,
): DependencyStatus[] {
  const before = new Map(previous.map((s) => [s.id, s]));
  const next = results.map(([dep, r]) => {
    const prev = before.get(dep.id);
    return {
      ...dep,
      state: r.state,
      since: prev && prev.state === r.state ? prev.since : now,
      lastChecked: now,
      ms: r.ms,
      ...(r.detail ? { detail: r.detail } : {}),
    } satisfies DependencyStatus;
  });
  // Not up first, the longest-broken first; then the rest in their given order.
  return next
    .map((s, i) => ({ s, i }))
    .sort((a, b) => RANK[a.s.state] - RANK[b.s.state] || (a.s.state === "up" ? a.i - b.i : a.s.since - b.s.since) || a.i - b.i)
    .map(({ s }) => s);
}

/** Every 15 minutes; the first check shortly after start, never in the way of it. */
export const CHECK_EVERY_MS = 15 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 30 * 1000;
const RETRY_AFTER_MS = 5 * 1000;

/**
 * GET /api/service-health: the latest round of checks, what isn't up first.
 * Before the first round it says so ({ checkedAt: null }), never "all fine".
 * `everyMs: 0` turns the timer off (tests call runNow()).
 */
export function registerServiceHealth(
  app: { get: (path: string, handler: (req: any, res: any) => void) => unknown },
  opts: {
    targets: readonly Dependency[];
    probe: (dep: Dependency) => Promise<CheckResult>;
    everyMs?: number;
    /** A "down" is asked once more after this long before it counts (busy relays refuse the odd connection). */
    retryAfterMs?: number;
    now?: () => number;
  },
): { runNow: () => Promise<void> } {
  const now = opts.now ?? Date.now;
  let status: DependencyStatus[] = [];
  let checkedAt: number | null = null;
  let running: Promise<void> | null = null;

  const runNow = () => {
    running ??= (async () => {
      const results = await Promise.all(opts.targets.map(async (dep) => {
        const t0 = now();
        const once = async (): Promise<CheckResult> => {
          try {
            return await opts.probe(dep);
          } catch (e) {
            return { state: "down", ms: now() - t0, detail: String((e as Error)?.message || e).slice(0, 120) };
          }
        };
        let r = await once();
        if (r.state === "down") {
          await new Promise((ok) => setTimeout(ok, opts.retryAfterMs ?? RETRY_AFTER_MS));
          r = await once();
        }
        return [dep, r] as const;
      }));
      checkedAt = now();
      status = foldHealth(status, results, checkedAt);
    })().finally(() => { running = null; });
    return running;
  };

  app.get("/api/service-health", (_req, res) => {
    res.set?.("Cache-Control", "no-store");
    res.json({ checkedAt, items: status });
  });

  const every = opts.everyMs ?? CHECK_EVERY_MS;
  if (every > 0) {
    setTimeout(() => { void runNow(); }, FIRST_CHECK_AFTER_MS).unref?.();
    setInterval(() => { void runNow(); }, every).unref?.();
  }
  return { runNow };
}
