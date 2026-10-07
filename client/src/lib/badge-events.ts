/**
 * The events behind badges (NIP-58), as pure templates — no relays, no
 * signer — so the rules below are tested on their own (badge-events.test.ts)
 * and lib/nip58-badges.ts signs and publishes what these return.
 *
 *  - A badge's identity (its `d` tag) is made once, at random, and never
 *    derived from its name: a slug of the name made a second "Helper"
 *    silently replace the first for everyone who held it.
 *  - The badges someone shows are written twice, in the same order: kind
 *    10008 (NIP-58's profile list) and the deprecated kind 30008
 *    `d=profile_badges`, which other apps still read. Reading takes whichever
 *    is newer; NIP-58 says to treat them as one.
 */
export const KIND_BADGE_DEFINITION = 30009;
export const KIND_PROFILE_BADGES = 10008;
export const KIND_PROFILE_BADGES_LEGACY = 30008;
export const PROFILE_BADGES_D = "profile_badges";

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface ShownBadge {
  badgeRef: string;
  awardEventId: string;
}

function newBadgeId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "b-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const now = () => Math.floor(Date.now() / 1000);

/** A badge to publish. Pass `id` when editing one; leave it out to make a new one. */
export function badgeDefinitionTemplate(b: {
  id?: string;
  name: string;
  description: string;
  image: string;
  imageSize?: string;
  thumb?: string;
  thumbSize?: string;
  /** The designer's settings, so Edit can reopen them. Other apps ignore it. */
  design?: string;
  /** The community (relay address) this badge belongs to; leave out for a personal one. */
  community?: string;
}): EventTemplate {
  const tags: string[][] = [
    ["d", b.id || newBadgeId()],
    ["name", b.name],
    ["description", b.description],
  ];
  if (b.image) tags.push(b.imageSize ? ["image", b.image, b.imageSize] : ["image", b.image]);
  if (b.thumb) tags.push(b.thumbSize ? ["thumb", b.thumb, b.thumbSize] : ["thumb", b.thumb]);
  if (b.design) tags.push(["design", b.design]);
  if (b.community) tags.push(["r", b.community]);
  return { kind: KIND_BADGE_DEFINITION, created_at: now(), tags, content: "" };
}

/** Both profile lists for the badges shown, in this order: [current, legacy]. */
export function profileBadgesTemplates(shown: ShownBadge[]): [EventTemplate, EventTemplate] {
  const pairs = shown.flatMap((b) => [["a", b.badgeRef], ["e", b.awardEventId]]);
  const at = now();
  return [
    { kind: KIND_PROFILE_BADGES, created_at: at, tags: pairs, content: "" },
    { kind: KIND_PROFILE_BADGES_LEGACY, created_at: at, tags: [["d", PROFILE_BADGES_D], ...pairs], content: "" },
  ];
}

/** The list after accepting one more badge: added after the others, never twice. */
export function withAcceptedBadge(shown: ShownBadge[], accepted: ShownBadge): ShownBadge[] {
  if (shown.some((b) => b.badgeRef === accepted.badgeRef && b.awardEventId === accepted.awardEventId)) return shown;
  return [...shown, accepted];
}

/** Of the profile-list events found, the newest one of either format. */
export function pickProfileBadgesEvent<E extends { kind: number; created_at: number; tags: string[][] }>(events: E[]): E | null {
  let best: E | null = null;
  for (const e of events) {
    const isList = e.kind === KIND_PROFILE_BADGES
      || (e.kind === KIND_PROFILE_BADGES_LEGACY && e.tags.some((t) => t[0] === "d" && t[1] === PROFILE_BADGES_D));
    if (isList && (!best || e.created_at > best.created_at)) best = e;
  }
  return best;
}

/**
 * The badges waiting for someone to decide on: given to them, not on their
 * profile yet, not put off with "Not now". Anyone can give anyone a badge, so
 * ones from people they don't follow are folded away — counted, shown only
 * on request — never put in front of them with someone else's picture.
 */
export function badgesWaiting<A extends { id: string; pubkey: string; badgeRef: string; createdAt: number }>(o: {
  awards: A[];
  shown: ShownBadge[];
  notNow: Set<string>;
  follows: Set<string>;
}): { waiting: A[]; fromStrangers: A[] } {
  const shownRefs = new Set(o.shown.map((b) => b.badgeRef));
  const open = o.awards
    .filter((a) => !shownRefs.has(a.badgeRef) && !o.notNow.has(a.id))
    .sort((x, y) => y.createdAt - x.createdAt);
  return {
    waiting: open.filter((a) => o.follows.has(a.pubkey)),
    fromStrangers: open.filter((a) => !o.follows.has(a.pubkey)),
  };
}

/** Ask relays to remove one badge (NIP-09). Badges already given stay with their holders. */
export function badgeDeletionTemplate(b: { pubkey: string; id: string; eventId: string }): EventTemplate {
  return {
    kind: 5,
    created_at: now(),
    tags: [["a", `${KIND_BADGE_DEFINITION}:${b.pubkey}:${b.id}`], ["e", b.eventId], ["k", String(KIND_BADGE_DEFINITION)]],
    content: "",
  };
}

/**
 * Badges minus the ones their maker deleted after their latest version —
 * read from the deletion requests themselves, because not every relay
 * honors them.
 */
export function withoutDeleted<D extends { pubkey: string; dTag: string; createdAt: number }>(
  defs: D[],
  deletions: Array<{ kind: number; created_at: number; tags: string[][] }>,
): D[] {
  const deletedAt = new Map<string, number>();
  for (const e of deletions) {
    if (e.kind !== 5) continue;
    for (const t of e.tags) if (t[0] === "a" && t[1]?.startsWith(`${KIND_BADGE_DEFINITION}:`)) {
      deletedAt.set(t[1], Math.max(deletedAt.get(t[1]) ?? 0, e.created_at));
    }
  }
  return defs.filter((d) => {
    const at = deletedAt.get(`${KIND_BADGE_DEFINITION}:${d.pubkey}:${d.dTag}`);
    return at === undefined || d.createdAt > at;
  });
}

/** Give a badge to people: each once, with an optional note in the award. */
export function badgeAwardTemplate(g: { badgeRef: string; recipients: string[]; note?: string }): EventTemplate {
  const people = [...new Set(g.recipients)];
  return { kind: 8, created_at: now(), tags: [["a", g.badgeRef], ...people.map((p) => ["p", p])], content: g.note?.trim() ?? "" };
}

/** Move the badge at `index` one place up (-1) or down (+1); ends stay put. */
export function moveShownBadge(shown: ShownBadge[], index: number, delta: -1 | 1): ShownBadge[] {
  const to = index + delta;
  if (index < 0 || index >= shown.length || to < 0 || to >= shown.length) return shown;
  const next = [...shown];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Take one badge off your profile; the rest keep their order. */
export function hideShownBadge(shown: ShownBadge[], index: number): ShownBadge[] {
  return shown.filter((_, i) => i !== index);
}

/** What shows beside a name: the first badge, and how many more there are. */
export function besideName<T>(badges: T[]): { first: T | undefined; more: number } {
  return { first: badges[0], more: Math.max(0, badges.length - 1) };
}

/** The community a badge belongs to (its relay address), if it's a community badge. */
export function badgeCommunity(tags: string[][]): string | undefined {
  return tags.find((t) => t[0] === "r" && /^wss?:\/\//.test(t[1] ?? ""))?.[1];
}

/** "from Bitcoin Bali" — the community's name, or its address without the scheme. */
export function fromCommunityLine(relayUrl: string | undefined, name?: string): string {
  if (!relayUrl) return "";
  const label = name?.trim() || relayUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  return `from ${label}`;
}

/**
 * The one badge beside a name in a given place (owner, 2026-10-06: helpful
 * and meaningful, never in the way). Inside a community, only a badge that
 * community gave — or none. Anywhere else, the person's first chosen badge.
 */
export function badgeForContext<B extends { community?: string }>(badges: B[], community?: string): B | undefined {
  if (!community) return badges[0];
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  return badges.find((b) => b.community && norm(b.community) === norm(community));
}

/**
 * Where to send a gift: the community's relay, up to 3 of each recipient's own
 * (read) relays — where they look for things addressed to them — then yours.
 * Each once, capped so a large gift doesn't dial half the network.
 */
export function awardRelays(o: { community?: string; recipients: string[][]; mine: string[] }, cap = 16): string[] {
  const out: string[] = [];
  const add = (u?: string) => { if (u && !out.includes(u) && out.length < cap) out.push(u); };
  add(o.community);
  for (const theirs of o.recipients) for (const u of theirs.slice(0, 3)) add(u);
  // Always room for at least some of your own, so you can see what you gave.
  while (out.length > cap - Math.min(3, o.mine.length)) out.pop();
  for (const u of o.mine) add(u);
  return out;
}
