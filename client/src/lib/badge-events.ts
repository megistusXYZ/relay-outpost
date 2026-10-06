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
}): EventTemplate {
  const tags: string[][] = [
    ["d", b.id || newBadgeId()],
    ["name", b.name],
    ["description", b.description],
  ];
  if (b.image) tags.push(b.imageSize ? ["image", b.image, b.imageSize] : ["image", b.image]);
  if (b.thumb) tags.push(b.thumbSize ? ["thumb", b.thumb, b.thumbSize] : ["thumb", b.thumb]);
  if (b.design) tags.push(["design", b.design]);
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
