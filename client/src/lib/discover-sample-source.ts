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

/** A sample from our server, with the trust scores of its authors when the server sent them. */
export interface ServerSample {
  events: Event[];
  /** Author → trust score (0-1) on the default lens. */
  ranks: ReadonlyMap<string, number>;
}

const HEX64 = /^[0-9a-f]{64}$/;

function readRanks(raw: unknown): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!raw || typeof raw !== "object") return ranks;
  for (const [pk, v] of Object.entries(raw as Record<string, unknown>)) {
    if (HEX64.test(pk) && typeof v === "number" && v >= 0 && v <= 1) ranks.set(pk, v);
  }
  return ranks;
}

/**
 * The server's Feed sample, with its authors' trust scores (the Feed tile
 * ranks by trust plus freshness, and these authors aren't looked up);
 * no events when it found no trusted notes; null when it couldn't answer.
 */
export async function fetchServerFeedSample(fetchImpl: FetchLike = fetch): Promise<ServerSample | null> {
  try {
    const res = await fetchImpl("/api/discover/feed-sample", { signal: AbortSignal.timeout(SERVER_WAIT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { notes?: unknown; ranks?: unknown } | null;
    if (!body || !Array.isArray(body.notes)) return null;
    const notes = body.notes.filter((n): n is Event => isNote(n) && verifyEvent(n as Event));
    // Notes were sent and none held up: not an answer to build on.
    if (body.notes.length > 0 && notes.length === 0) return null;
    return { events: notes, ranks: readRanks(body.ranks) };
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
  /** The authors' trust scores, when the server sent them. */
  ranks: ReadonlyMap<string, number>;
}

export interface TrustedSampleSources {
  /** Whose trust applies (lib/discover-trust.ts). */
  lens: "own" | "default";
  server: () => Promise<Event[] | ServerSample | null>;
  direct: () => Promise<Event[]>;
}

/**
 * Start reading a sample. `fromServer` settles as soon as the server has
 * answered or hasn't (milliseconds), well before `sample` does when the app
 * has to take its own. Tiles decide on `fromServer` whether to make their
 * other relay reads, so those start alongside the app's own read instead of
 * after it.
 */
export function startTrustedSample(sources: TrustedSampleSources): { fromServer: Promise<boolean>; sample: Promise<TrustedSample> } {
  const server: Promise<ServerSample | null> = sources.lens === "default"
    ? Promise.resolve().then(sources.server)
        .then((got) => (got === null ? null : Array.isArray(got) ? { events: got, ranks: new Map() } : got))
        .catch(() => null)
    : Promise.resolve(null);
  return {
    fromServer: server.then((got) => got !== null),
    sample: server.then(async (got) => (got !== null
      ? { events: got.events, vetted: true, ranks: got.ranks }
      : { events: await sources.direct(), vetted: false, ranks: new Map() })),
  };
}
