/**
 * Where the app gets the relay directory.
 *
 * The server reads the monitors once for everyone and hands over a compact
 * list (server/relay-directory.ts). Reading the monitors from the app cost
 * 6.5 MB on a cold Discover load (measured 2026-09-30), so that is now only
 * the fallback for when the server can't answer. "Can't answer" is null here,
 * never an empty list: an empty directory may only be claimed after the
 * monitors themselves were asked.
 */
import { isDirectoryEntry, type DirectoryEntry } from "@shared/relay-directory";

/** The server's first read after a deploy can take a few seconds. */
const SERVER_WAIT_MS = 7_000;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchServerDirectory(fetchImpl: FetchLike = fetch): Promise<DirectoryEntry[] | null> {
  try {
    const res = await fetchImpl("/api/relay-directory", { signal: AbortSignal.timeout(SERVER_WAIT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { relays?: unknown } | null;
    if (!body || !Array.isArray(body.relays)) return null;
    const relays = body.relays.filter(isDirectoryEntry);
    return relays.length > 0 ? relays : null;
  } catch {
    return null;
  }
}

export async function readDirectory(sources: {
  server: () => Promise<DirectoryEntry[] | null>;
  monitors: () => Promise<DirectoryEntry[]>;
}): Promise<DirectoryEntry[]> {
  let fromServer: DirectoryEntry[] | null = null;
  try { fromServer = await sources.server(); } catch { fromServer = null; }
  if (fromServer && fromServer.length > 0) return fromServer;
  return sources.monitors();
}
