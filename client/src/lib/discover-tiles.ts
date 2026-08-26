/**
 * Tile states for the Discover bento — the reachability contract, centralised.
 *
 * Every tile on /discover is a live claim about a remote source (RSS over
 * HTTP, three different relay pools). A claim has THREE outcomes — content,
 * genuinely nothing, and we-never-got-to-ask — and the page renders four such
 * claims side by side, so hand-rolling the distinction per tile would be four
 * chances to collapse the third outcome into the second and say "Nothing new"
 * about a source we never reached (see RELAY_REACHABILITY.md; that defect has
 * shipped repeatedly).
 *
 * One resolver, exhaustively switchable, fed by `Reached<T>` from
 * lib/relay-reach.ts. HTTP sources construct the same shape by hand
 * ({ data, reached: response-actually-arrived }) rather than inventing a
 * parallel vocabulary.
 */
import type { Reached } from "./relay-reach";

export interface TileState<T> {
  status: "loading" | "ready" | "empty" | "unreachable";
  /** Present only when status is "ready". */
  data?: T;
  /** The source's own words when it refused us — shown, not summarised. */
  detail?: string;
}

/** Is there anything to show? Arrays count their items; anything else is truthy-or-not. */
function hasContent(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0;
  return data !== null && data !== undefined;
}

export function resolveTile<T>(r: Reached<T> | null | undefined): TileState<T> {
  if (!r) return { status: "loading" };
  // Never reached → nothing may be concluded about what the source holds.
  if (!r.reached) return { status: "unreachable" };
  // Socket opened but the relay declined to serve us (NIP-42). `data` is NOT
  // an answer — not even a partial one that arrived before the refusal.
  if (r.refusedReason) return { status: "unreachable", detail: r.refusedReason };
  if (!hasContent(r.data)) return { status: "empty" };
  return { status: "ready", data: r.data };
}

// ── Trending topics (pure) ───────────────────────────────────────────────────

export interface RankedTopic {
  tag: string;
  /** DISTINCT authors who used the tag — the spam-resistant count. */
  authors: number;
}

/**
 * "What your network is talking about", computed the only way that resists a
 * single loud account: a topic's weight is how many DISTINCT authors tagged
 * it, never how many times. One voice is not a trend (minAuthors 2), and
 * unusable tags (empty, purely numeric, over-long) are dropped before
 * counting. Case-folded; ties break alphabetically so the strip is stable
 * across refreshes.
 */
export function rankTopics(
  notes: ReadonlyArray<{ pubkey: string; tags: string[][] }>,
  { minAuthors = 2, top = 5 }: { minAuthors?: number; top?: number } = {},
): RankedTopic[] {
  const byTag = new Map<string, Set<string>>();
  for (const n of notes) {
    for (const t of n.tags) {
      if (t[0] !== "t" || typeof t[1] !== "string") continue;
      const tag = t[1].trim().toLowerCase();
      if (!tag || tag.length > 30 || /^\d+$/.test(tag)) continue;
      let set = byTag.get(tag);
      if (!set) byTag.set(tag, (set = new Set()));
      set.add(n.pubkey);
    }
  }
  return Array.from(byTag, ([tag, set]) => ({ tag, authors: set.size }))
    .filter((r) => r.authors >= minAuthors)
    .sort((a, b) => b.authors - a.authors || a.tag.localeCompare(b.tag))
    .slice(0, top);
}

// ── Next calendar event (pure) ───────────────────────────────────────────────

/**
 * The soonest event that has not passed. 31923 carries unix startTime; 31922
 * all-day events carry a YYYY-MM-DD startDate (parsed as local midnight). An
 * event that began within the last hour still counts — "happening now" is the
 * most useful thing a calendar door can say.
 */
export function pickNextUpcoming<T extends { startTime?: number; startDate?: string }>(
  events: readonly T[],
  nowSecs: number,
): T | null {
  const GRACE = 3600;
  let best: T | null = null;
  let bestStart = Infinity;
  for (const e of events) {
    let start = e.startTime;
    if (start === undefined && e.startDate) {
      const ms = Date.parse(`${e.startDate}T00:00:00`);
      if (!Number.isNaN(ms)) start = Math.floor(ms / 1000);
    }
    if (start === undefined) continue;
    if (start < nowSecs - GRACE) continue;
    if (start < bestStart) { best = e; bestStart = start; }
  }
  return best;
}

export interface RisingTopic extends RankedTopic {
  rising: boolean;
}

/**
 * ↑ marks for the topics strip: a topic is rising when its DISTINCT-author
 * count grew since the previous snapshot. No snapshot (or a topic absent from
 * it) claims nothing — rising is a comparison, not a first impression.
 */
export function markRising(
  current: readonly RankedTopic[],
  previous: readonly RankedTopic[] | undefined,
): RisingTopic[] {
  const prev = new Map((previous ?? []).map((t) => [t.tag, t.authors]));
  return current.map((t) => {
    const before = prev.get(t.tag);
    return { ...t, rising: before !== undefined && t.authors > before };
  });
}

// ── Images shelf ─────────────────────────────────────────────────────────────

export interface ShelfImage {
  /** Root event id — the freshness ledger's identity for this image. */
  id: string;
  url: string;
  authorPk: string;
  timeMs?: number;
}

/**
 * Pick the Discover shelf's images: newest-first with one image PER AUTHOR
 * until the cap, then (only if variety runs out) fill remaining slots with
 * repeats. A shelf of eight frames from one prolific poster is that person's
 * profile, not a discovery surface — variety is the product here.
 */
export function pickImageShelf(candidates: readonly ShelfImage[], max = 8): ShelfImage[] {
  const sorted = [...candidates].sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0));
  const seenAuthors = new Set<string>();
  const out: ShelfImage[] = [];
  for (const c of sorted) {
    if (seenAuthors.has(c.authorPk)) continue;
    seenAuthors.add(c.authorPk);
    out.push(c);
    if (out.length >= max) return out;
  }
  for (const c of sorted) {
    if (out.length >= max) break;
    if (out.some((o) => o.id === c.id && o.url === c.url)) continue;
    out.push(c);
  }
  return out;
}

// ── Sensitive-media gate for Discover teasers ────────────────────────────────

const SENSITIVE_TAGS = new Set([
  "nsfw", "porn", "nude", "nudes", "nudity", "adult", "xxx", "hentai", "onlyfans", "explicit",
]);

/**
 * Should this event's media stay OFF the Discover teasers? Honors the
 * author's own labels — a NIP-36 content-warning tag (any reason), a
 * sensitive hashtag, or "nsfw" in the caption. Deliberately label-based:
 * Discover is the front door and a new user's first screen (owner call,
 * 2026-08-18, after unlabelled-adjacent thumbnails landed on the shelf);
 * respecting labels catches the bulk, and the network-first sourcing plus
 * the WoT flagged-author floor carry the unlabelled remainder. Distinct from
 * lib/sensitive-content.ts on purpose: that one powers blur-with-reveal for
 * feeds (tag-only); this EXCLUDES from front-door teasers (tag + hashtags +
 * caption keyword) — merging them would couple two different policies.
 */
export function isSensitiveMedia(event: { tags: string[][]; content: string }): boolean {
  for (const t of event.tags) {
    if (t[0] === "content-warning") return true;
    if (t[0] === "t" && t[1] && SENSITIVE_TAGS.has(t[1].toLowerCase())) return true;
  }
  return /\bnsfw\b/i.test(event.content);
}
