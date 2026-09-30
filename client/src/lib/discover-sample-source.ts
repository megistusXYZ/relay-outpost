/**
 * Where Discover's tiles get their broad samples.
 *
 * The server takes each sample once for everyone and hands over the part by
 * trusted people: the Feed tile's recent notes (server/feed-sample.ts), and
 * the newest articles, events and videos (server/trusted-sample.ts). Taking
 * them in the app cost megabytes of relay reads plus score lookups for every
 * author (measured 2026-09-30: notes 0.6-3 MB per relay, articles 981 KB,
 * events 118 KB, videos 132 KB), so that is now for when the server can't
 * answer, and for viewers whose own trust map decides who's trusted (the
 * server only knows the default lens).
 *
 * What the server sends is signed by its authors and checked here, so
 * nothing is shown on the server's word alone.
 */
import { verifyEvent, type Event } from "nostr-tools";
import { isNote } from "@shared/feed-sample";
import { DISCOVER_SAMPLES, isSignedEvent, type DiscoverSampleName } from "@shared/discover-samples";

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

/**
 * The server's articles, events or videos sample; [] when it found none by
 * trusted people; null when it couldn't answer.
 */
export async function fetchServerSample(name: DiscoverSampleName, fetchImpl: FetchLike = fetch): Promise<Event[] | null> {
  try {
    const res = await fetchImpl(`/api/discover/sample/${name}`, { signal: AbortSignal.timeout(SERVER_WAIT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { events?: unknown } | null;
    if (!body || !Array.isArray(body.events)) return null;
    const kinds = DISCOVER_SAMPLES[name].kinds;
    const events = body.events.filter((e): e is Event => isSignedEvent(e, kinds) && verifyEvent(e as Event));
    // Events were sent and none held up: not an answer to build on.
    if (body.events.length > 0 && events.length === 0) return null;
    return events;
  } catch {
    return null;
  }
}

export interface TrustedSample {
  events: Event[];
  /** From our server, which already kept only trusted people's events. */
  vetted: boolean;
}

export async function readTrustedSample(sources: {
  /** Whose trust applies (lib/discover-trust.ts). */
  lens: "own" | "default";
  server: () => Promise<Event[] | null>;
  direct: () => Promise<Event[]>;
}): Promise<TrustedSample> {
  if (sources.lens === "default") {
    let fromServer: Event[] | null = null;
    try { fromServer = await sources.server(); } catch { fromServer = null; }
    if (fromServer) return { events: fromServer, vetted: true };
  }
  return { events: await sources.direct(), vetted: false };
}
