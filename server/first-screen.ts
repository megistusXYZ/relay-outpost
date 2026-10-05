/**
 * A stranger's first screen, from our own server.
 *
 * The guest "For you" feed used to wait on the relays and then hold every
 * stranger's note until that author's profile and follower count had been
 * looked up (the spam floor): on a throttled phone the first posts appeared
 * at 6.2 s although the first relay had delivered thirty notes by 4.5 s
 * (measured 2026-10-03). The server already keeps a fresh sample of notes by
 * people the default lens trusts (feed-sample.ts). This hands over the newest
 * of them with their authors' trust scores and profiles, so the app can show
 * them the moment the page mounts; relays merge in behind.
 *
 * Owner's rule (2026-09-30): our signals lead, Primal only supports. Every
 * note and profile here is signed by its author and checked in the app, so
 * nothing is shown on the server's word alone.
 */
import { isSignedEvent, type SignedEvent } from "@shared/discover-samples";
import type { SampleNote } from "@shared/feed-sample";
import { queryRelay, type RelayQuery } from "./score-cards";

/** Enough for a phone's first two screens, small enough to check quickly. */
export const FIRST_SCREEN_NOTES = 16;
/** Notes whose authors' profiles are asked for, so a few missing ones don't empty the screen. */
const CANDIDATES = 40;
const PER_AUTHOR = 2;

/** Where profiles are asked for: a profile index first, then the big relays. */
export const PROFILE_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"];
const PROFILE_TTL_MS = 60 * 60 * 1000;
const PROFILE_READ_MS = 4_000;
/** A visitor never waits longer than this for profiles; the next one gets them. */
export const PROFILE_WAIT_MS = 1_500;

export function pickFirstScreen(notes: readonly SampleNote[], max = FIRST_SCREEN_NOTES): SampleNote[] {
  const perAuthor = new Map<string, number>();
  const out: SampleNote[] = [];
  for (const n of [...notes].sort((a, b) => b.created_at - a.created_at)) {
    const k = perAuthor.get(n.pubkey) ?? 0;
    if (k >= PER_AUTHOR) continue;
    perAuthor.set(n.pubkey, k + 1);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

export interface ProfileReader {
  get(authors: readonly string[]): Promise<Map<string, SignedEvent>>;
}

/** Kind-0 profiles, held an hour, asked for in one go per relay, never waited on past waitMs. */
export function createProfileReader(opts: { query?: RelayQuery; waitMs?: number; now?: () => number } = {}): ProfileReader {
  const query = opts.query ?? queryRelay;
  const now = opts.now ?? Date.now;
  const waitMs = opts.waitMs ?? PROFILE_WAIT_MS;
  const held = new Map<string, { event: SignedEvent; at: number }>();
  const asking = new Map<string, Promise<void>>();

  const keep = (e: unknown) => {
    if (!isSignedEvent(e, [0])) return;
    const cur = held.get(e.pubkey);
    if (!cur || cur.event.created_at < e.created_at) held.set(e.pubkey, { event: e, at: now() });
    else cur.at = now();
  };

  const ask = (authors: string[]): Promise<void> => {
    const p = Promise.all(PROFILE_RELAYS.map((relay) =>
      Promise.resolve()
        .then(() => query(relay, { kinds: [0], authors }, PROFILE_READ_MS))
        .then((a) => { for (const e of a.events) keep(e); })
        .catch(() => {}),
    )).then(() => { for (const a of authors) asking.delete(a); });
    for (const a of authors) asking.set(a, p);
    return p;
  };

  return {
    async get(authors) {
      const t = now();
      const missing = authors.filter((a) => { const h = held.get(a); return (!h || t - h.at > PROFILE_TTL_MS) && !asking.has(a); });
      if (missing.length) void ask(missing);
      const pending = [...new Set(authors.map((a) => asking.get(a)).filter((p): p is Promise<void> => !!p))];
      if (pending.length) await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, waitMs))]);
      const out = new Map<string, SignedEvent>();
      for (const a of authors) { const h = held.get(a); if (h) out.set(a, h.event); }
      return out;
    },
  };
}

export interface FirstScreen {
  reached: boolean;
  notes: SampleNote[];
  /** Author → trust score (0-1) on the default lens. */
  ranks: Record<string, number>;
  /** Author → their signed kind-0. */
  profiles: Record<string, SignedEvent>;
}

/** How long a built first screen is handed out as is. */
export const FIRST_SCREEN_FRESH_MS = 30_000;

export function createFirstScreenReader(opts: {
  sample: () => Promise<{ reached: boolean; notes: SampleNote[] }>;
  ranks: (notes: readonly SampleNote[]) => Promise<Record<string, number>>;
  profiles: ProfileReader;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  // Kept warm (measured on production 2026-10-04: every visit rebuilt it from
  // the relays, 0.8–1.7 s — the whole wait before a stranger saw a post). A
  // screen under half a minute old is handed out as is; an older one is handed
  // out AT ONCE while a fresh one is built behind it; visitors arriving
  // together share one build. A screen that couldn't be built isn't kept.
  let last: { screen: FirstScreen; at: number } | null = null;
  let building: Promise<FirstScreen> | null = null;
  const rebuild = () => {
    building ??= build().then((screen) => {
      if (screen.reached) last = { screen, at: now() };
      return screen;
    }).finally(() => { building = null; });
    return building;
  };
  return {
    async read(): Promise<FirstScreen> {
      if (last) {
        if (now() - last.at >= FIRST_SCREEN_FRESH_MS) void rebuild().catch(() => {});
        return last.screen;
      }
      return rebuild();
    },
  };

  async function build(): Promise<FirstScreen> {
    const sample = await opts.sample();
    if (!sample.reached) return { reached: false, notes: [], ranks: {}, profiles: {} };
    // Profiles are asked for a wider set than the screen holds, and only
    // notes whose author's profile is in hand go out: a card must never open
    // on a raw npub (the flash the spam floor's profile gate exists to stop).
    const candidates = pickFirstScreen(sample.notes, CANDIDATES);
    const profiles = await opts.profiles.get([...new Set(candidates.map((n) => n.pubkey))]).catch(() => new Map<string, SignedEvent>());
    const notes = pickFirstScreen(candidates.filter((n) => profiles.has(n.pubkey)));
    const authors = new Set(notes.map((n) => n.pubkey));
    const ranks = await opts.ranks(notes).catch(() => ({} as Record<string, number>));
    return {
      reached: true,
      notes,
      ranks,
      profiles: Object.fromEntries([...profiles].filter(([pk]) => authors.has(pk))),
    };
  }
}
