/**
 * The relay directory, read from the monitors once for everyone.
 *
 * Every visitor without communities used to read the monitors themselves:
 * 3,500 reports, 6.5 MB, on the landing page (measured 2026-09-30). The list
 * those reports boil down to is ~950 relays and a few tags each
 * (shared/relay-directory.ts), so the server reads the monitors and hands
 * the list over.
 *
 * One read serves everyone for FRESH_MS. After that the list in hand is
 * still served while a new one is read, so nobody waits on a refresh. A
 * refresh that fails, or comes back with nothing, never replaces a list we
 * have; that list is kept for KEEP_MS at most. With no list, a monitor we
 * couldn't ask is `reached: false`, never an empty directory.
 */
import { queryRelay, type RelayQuery } from "./score-cards";
import { directoryFromReports, KIND_RELAY_REPORT, NIP_66_MONITOR_RELAYS, REPORT_LIMIT, type DirectoryEntry } from "@shared/relay-directory";

export const FRESH_MS = 30 * 60 * 1000;
export const KEEP_MS = 24 * 60 * 60 * 1000;
/** A refresh that failed isn't tried again sooner than this. */
export const RETRY_MS = 60 * 1000;
/** Both monitors answered in ~2 s when measured; this is for a bad day. */
const READ_MS = 12_000;

export interface DirectoryAnswer {
  reached: boolean;
  relays: DirectoryEntry[];
}

export function createRelayDirectoryReader(opts: {
  monitors?: readonly string[];
  query?: RelayQuery;
  now?: () => number;
} = {}) {
  const monitors = opts.monitors ?? NIP_66_MONITOR_RELAYS;
  const query = opts.query ?? queryRelay;
  const now = opts.now ?? Date.now;
  let held: { at: number; relays: DirectoryEntry[] } | null = null;
  let reading: Promise<DirectoryAnswer> | null = null;
  let lastTryAt = -Infinity;

  function readMonitors(): Promise<DirectoryAnswer> {
    if (reading) return reading;
    lastTryAt = now();
    reading = (async () => {
      const answers = await Promise.all(
        monitors.map((m) =>
          Promise.resolve()
            .then(() => query(m, { kinds: [KIND_RELAY_REPORT], limit: REPORT_LIMIT }, READ_MS))
            .catch(() => ({ reached: false, answered: false, events: [] as any[] })),
        ),
      );
      const relays = directoryFromReports(answers.flatMap((a) => a.events));
      // A monitor cut off mid-answer still told us about real relays.
      const reached = relays.length > 0 || answers.some((a) => a.answered);
      if (relays.length > 0) held = { at: now(), relays };
      return { reached, relays };
    })().finally(() => { reading = null; });
    return reading;
  }

  async function read(): Promise<DirectoryAnswer> {
    const age = held ? now() - held.at : Infinity;
    if (held && age < KEEP_MS) {
      if (age >= FRESH_MS && now() - lastTryAt >= RETRY_MS) void readMonitors().catch(() => {});
      return { reached: true, relays: held.relays };
    }
    held = null;
    return readMonitors();
  }

  return { read };
}
