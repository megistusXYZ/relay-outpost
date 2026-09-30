/**
 * Where the Feed tile gets its recent sample.
 *
 * The server takes one sample for everyone and hands over the notes by
 * trusted people (server/feed-sample.ts). Taking it in the app cost 0.6-3 MB
 * per relay plus 3-7 score lookups (measured 2026-09-30), so that is now for
 * when the server can't answer, and for viewers whose own trust map decides
 * who's trusted (the server only knows the default lens).
 *
 * The server's notes are signed by their authors and checked here, so a note
 * is never shown on the server's word alone.
 */
import { verifyEvent, type Event } from "nostr-tools";
import { isNote } from "@shared/feed-sample";

const SERVER_WAIT_MS = 7_000;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** The server's sample; [] when it found no trusted notes; null when it couldn't answer. */
export async function fetchServerFeedSample(fetchImpl: FetchLike = fetch): Promise<Event[] | null> {
  try {
    const res = await fetchImpl("/api/discover/feed-sample", { signal: AbortSignal.timeout(SERVER_WAIT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { notes?: unknown } | null;
    if (!body || !Array.isArray(body.notes)) return null;
    const notes = body.notes.filter((n): n is Event => isNote(n) && verifyEvent(n as Event));
    // Notes were sent and none held up: not an answer to build on.
    if (body.notes.length > 0 && notes.length === 0) return null;
    return notes;
  } catch {
    return null;
  }
}

export async function readRecentSample(sources: {
  /** Whose trust applies (lib/discover-trust.ts). */
  lens: "own" | "default";
  server: () => Promise<Event[] | null>;
  direct: () => Promise<Event[]>;
}): Promise<Event[]> {
  if (sources.lens === "default") {
    let fromServer: Event[] | null = null;
    try { fromServer = await sources.server(); } catch { fromServer = null; }
    if (fromServer) return fromServer;
  }
  return sources.direct();
}
