import { pool, publishEvent, filterBlockedRelays, DEFAULT_RELAYS, FAST_RELAYS } from "./nostr";
import { signWithTimeout } from "@/lib/signer-timeout";
import { getOutpostRelays, getActiveDefaultRelays } from "./outpost-relays";
import { canReachAny, type Reached } from "./relay-reach";
import type { Event as NostrEvent } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { badgeDefinitionTemplate, badgeDeletionTemplate, withoutDeleted, profileBadgesTemplates, pickProfileBadgesEvent, withAcceptedBadge, KIND_PROFILE_BADGES as KIND_PROFILE_LIST, KIND_PROFILE_BADGES_LEGACY } from "./badge-events";

export const KIND_BADGE_DEFINITION = 30009;
export const KIND_BADGE_AWARD = 8;
/** The profile list (kind 10008) and its deprecated twin (30008 d=profile_badges): lib/badge-events.ts. */
export const KIND_PROFILE_BADGES = KIND_PROFILE_LIST;

export interface BadgeDefinition {
  id: string;
  pubkey: string;
  dTag: string;
  name: string;
  description: string;
  image: string;
  thumb: string;
  /** The designer's settings (JSON) when the badge was made in the designer. */
  design?: string;
  createdAt: number;
  rawEvent: NostrEvent;
}

export interface BadgeAward {
  id: string;
  pubkey: string;
  awardedTo: string[];
  badgeRef: string;
  createdAt: number;
  rawEvent: NostrEvent;
}

export interface AcceptedBadge {
  badgeRef: string;
  awardEventId: string;
  definition?: BadgeDefinition;
  award?: BadgeAward;
}

export interface ProfileBadges {
  pubkey: string;
  badges: AcceptedBadge[];
  rawEvent: NostrEvent;
}

const badgeDefCache = new Map<string, BadgeDefinition>();
const profileBadgesCache = new Map<string, ProfileBadges>();
const badgeAwardsForUserCache = new Map<string, BadgeAward[]>();
const inflightPromises = new Map<string, Promise<unknown>>();

const BADGE_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://purplepag.es",
];

function getBadgeRelays(): string[] {
  const outpost = getOutpostRelays().map(r => r.url);
  const active = getActiveDefaultRelays();
  const combined = [...new Set([...outpost, ...active, ...BADGE_RELAYS])];
  return filterBlockedRelays(combined).slice(0, 6);
}

export function parseBadgeDefinition(event: NostrEvent): BadgeDefinition {
  const dTag = event.tags.find(t => t[0] === "d")?.[1] || "";
  const name = event.tags.find(t => t[0] === "name")?.[1] || "";
  const description = event.tags.find(t => t[0] === "description")?.[1] || "";
  const image = event.tags.find(t => t[0] === "image")?.[1] || "";
  const thumb = event.tags.find(t => t[0] === "thumb")?.[1] || "";
  const design = event.tags.find(t => t[0] === "design")?.[1] || undefined;

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    name: name || dTag,
    description,
    image,
    thumb,
    design,
    createdAt: event.created_at,
    rawEvent: event,
  };
}

export function badgeATagValue(pubkey: string, dTag: string): string {
  return `${KIND_BADGE_DEFINITION}:${pubkey}:${dTag}`;
}

export function parseBadgeAward(event: NostrEvent): BadgeAward {
  const aTag = event.tags.find(t => t[0] === "a");
  const badgeRef = aTag?.[1] || "";
  const awardedTo = event.tags.filter(t => t[0] === "p").map(t => t[1]);

  return {
    id: event.id,
    pubkey: event.pubkey,
    awardedTo,
    badgeRef,
    createdAt: event.created_at,
    rawEvent: event,
  };
}

export function parseProfileBadges(event: NostrEvent, pubkey: string): ProfileBadges {
  const badges: AcceptedBadge[] = [];
  const tags = event.tags;

  let i = 0;
  while (i < tags.length) {
    if (tags[i][0] === "a" && tags[i][1]) {
      const badgeRef = tags[i][1];
      let awardEventId = "";
      let j = i + 1;
      while (j < tags.length && tags[j][0] !== "a") {
        if (tags[j][0] === "e" && tags[j][1]) {
          awardEventId = tags[j][1];
          break;
        }
        j++;
      }
      badges.push({ badgeRef, awardEventId });
      i = j;
    } else {
      i++;
    }
  }

  return { pubkey, badges, rawEvent: event };
}

export function getCachedBadgeDef(aTagValue: string): BadgeDefinition | undefined {
  return badgeDefCache.get(aTagValue);
}

export function getCachedProfileBadges(pubkey: string): ProfileBadges | undefined {
  return profileBadgesCache.get(pubkey);
}

export function getCachedAwardsForUser(pubkey: string): BadgeAward[] {
  return badgeAwardsForUserCache.get(pubkey) || [];
}

export async function fetchBadgeDefinitions(aTagValues: string[]): Promise<Map<string, BadgeDefinition>> {
  const result = new Map<string, BadgeDefinition>();
  const toFetch: { pubkey: string; dTag: string; aTag: string }[] = [];

  for (const aTag of aTagValues) {
    const cached = badgeDefCache.get(aTag);
    if (cached) {
      result.set(aTag, cached);
    } else {
      const parts = aTag.split(":");
      if (parts.length >= 3 && parts[0] === String(KIND_BADGE_DEFINITION)) {
        toFetch.push({ pubkey: parts[1], dTag: parts.slice(2).join(":"), aTag });
      }
    }
  }

  if (toFetch.length === 0) return result;

  const relays = getBadgeRelays();
  const authors = [...new Set(toFetch.map(f => f.pubkey))];
  const dTags = [...new Set(toFetch.map(f => f.dTag))];
  const wantedATags = new Set(toFetch.map(f => f.aTag));

  return new Promise((resolve) => {
    let resolved = false;
    let sub: ReturnType<typeof pool.subscribeMany> | null = null;

    const finish = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { sub?.close(); } catch {}
        resolve(result);
      }
    };

    const timer = setTimeout(finish, 8000);

    sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_BADGE_DEFINITION], authors, "#d": dTags },
      {
        onevent(event: NostrEvent) {
          const def = parseBadgeDefinition(event);
          const aTag = badgeATagValue(event.pubkey, def.dTag);
          if (!wantedATags.has(aTag)) return;
          const existing = badgeDefCache.get(aTag);
          if (!existing || event.created_at > existing.createdAt) {
            badgeDefCache.set(aTag, def);
            result.set(aTag, def);
          }
        },
        oneose() { finish(); },
      },
    );
  });
}

export async function fetchProfileBadgesList(pubkey: string): Promise<ProfileBadges | null> {
  const cached = profileBadgesCache.get(pubkey);
  if (cached) return cached;

  const fetchKey = `profile-badges:${pubkey}`;
  const inflight = inflightPromises.get(fetchKey);
  if (inflight) return inflight as Promise<ProfileBadges | null>;

  const relays = getBadgeRelays();

  const promise = new Promise<ProfileBadges | null>((resolve) => {
    let resolved = false;
    let bestEvent: NostrEvent | null = null;
    let sub: ReturnType<typeof pool.subscribeMany> | null = null;

    const finish = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { sub?.close(); } catch {}
        inflightPromises.delete(fetchKey);
        if (bestEvent) {
          const parsed = parseProfileBadges(bestEvent, pubkey);
          profileBadgesCache.set(pubkey, parsed);
          resolve(parsed);
        } else {
          resolve(null);
        }
      }
    };

    const timer = setTimeout(finish, 8000);

    sub = pool.subscribeMany(
      relays,
      // Both formats; the newer profile list counts (badge-events.ts).
      { kinds: [KIND_PROFILE_LIST, KIND_PROFILE_BADGES_LEGACY], authors: [pubkey] },
      {
        onevent(event: NostrEvent) {
          bestEvent = pickProfileBadgesEvent(bestEvent ? [bestEvent, event] : [event]) ?? bestEvent;
        },
        oneose() { finish(); },
      },
    );
  });

  inflightPromises.set(fetchKey, promise);
  return promise;
}

export async function fetchBadgeAwardsForUser(pubkey: string): Promise<BadgeAward[]> {
  const cached = badgeAwardsForUserCache.get(pubkey);
  if (cached) return cached;

  const fetchKey = `awards:${pubkey}`;
  const inflight = inflightPromises.get(fetchKey);
  if (inflight) return inflight as Promise<BadgeAward[]>;

  const relays = getBadgeRelays();

  const promise = new Promise<BadgeAward[]>((resolve) => {
    let resolved = false;
    const awards: BadgeAward[] = [];
    const seenIds = new Set<string>();
    let sub: ReturnType<typeof pool.subscribeMany> | null = null;

    const finish = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { sub?.close(); } catch {}
        inflightPromises.delete(fetchKey);
        badgeAwardsForUserCache.set(pubkey, awards);
        resolve(awards);
      }
    };

    const timer = setTimeout(finish, 8000);

    sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_BADGE_AWARD], "#p": [pubkey], limit: 50 },
      {
        onevent(event: NostrEvent) {
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            awards.push(parseBadgeAward(event));
          }
        },
        oneose() { finish(); },
      },
    );
  });

  inflightPromises.set(fetchKey, promise);
  return promise;
}

/**
 * The badges this person has defined — and did any relay actually answer?
 *
 * `reached: false` must never render as "No badges created yet": it invites an
 * operator to re-create badges that already exist, on relays we never opened.
 * One live relay out of the set is a thin answer but it IS one, so this uses
 * canReachAny rather than requiring the whole set.
 */
export async function fetchBadgeDefinitionsByAuthorResult(
  pubkey: string,
): Promise<Reached<BadgeDefinition[]>> {
  if (!(await canReachAny(getBadgeRelays()))) return { data: [], reached: false };
  return { data: await fetchBadgeDefinitionsByAuthorUnchecked(pubkey), reached: true };
}

/** Bare-value shim. Prefer the Result form anywhere the emptiness is shown. */
export async function fetchBadgeDefinitionsByAuthor(pubkey: string): Promise<BadgeDefinition[]> {
  return (await fetchBadgeDefinitionsByAuthorResult(pubkey)).data;
}

async function fetchBadgeDefinitionsByAuthorUnchecked(pubkey: string): Promise<BadgeDefinition[]> {
  const relays = getBadgeRelays();

  return new Promise((resolve) => {
    let resolved = false;
    const defs: BadgeDefinition[] = [];
    const deletions: NostrEvent[] = [];
    const seenATags = new Set<string>();
    let pending = 2;
    const subs: Array<ReturnType<typeof pool.subscribeMany>> = [];

    const finish = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        for (const sub of subs) { try { sub.close(); } catch {} }
        // Not every relay honors a deletion: drop what was deleted ourselves.
        resolve(withoutDeleted(defs, deletions));
      }
    };
    const answered = () => { if (--pending === 0) finish(); };

    const timer = setTimeout(finish, 8000);

    subs.push(pool.subscribeMany(
      relays,
      { kinds: [KIND_BADGE_DEFINITION], authors: [pubkey], limit: 50 },
      {
        onevent(event: NostrEvent) {
          const def = parseBadgeDefinition(event);
          const aTag = badgeATagValue(event.pubkey, def.dTag);
          const existing = seenATags.has(aTag) ? badgeDefCache.get(aTag) : undefined;
          if (!existing || event.created_at > existing.createdAt) {
            seenATags.add(aTag);
            badgeDefCache.set(aTag, def);
            const idx = defs.findIndex(d => badgeATagValue(d.pubkey, d.dTag) === aTag);
            if (idx >= 0) defs[idx] = def; else defs.push(def);
          }
        },
        oneose: answered,
      },
    ));
    // Deletions of badges only (they carry k=30009), so a long history of
    // deleted posts can't crowd them out.
    subs.push(pool.subscribeMany(
      relays,
      { kinds: [5], authors: [pubkey], "#k": [String(KIND_BADGE_DEFINITION)], limit: 100 },
      { onevent(event: NostrEvent) { deletions.push(event); }, oneose: answered },
    ));
  });
}

export async function createBadgeDefinition(
  signer: ISigner,
  badge: { id?: string; name: string; description: string; image: string; imageSize?: string; thumb?: string; thumbSize?: string; design?: string },
): Promise<NostrEvent | null> {
  // A new badge gets a permanent identity of its own; pass `id` to edit one.
  const eventTemplate = badgeDefinitionTemplate(badge);

  try {
    const signed = await signWithTimeout(signer, eventTemplate as Parameters<ISigner["signEvent"]>[0]);
    const published = await publishEvent(signed, getBadgeRelays());
    if (published) {
      const def = parseBadgeDefinition(signed);
      const aTag = badgeATagValue(signed.pubkey, def.dTag);
      badgeDefCache.set(aTag, def);
      return signed;
    }
    return null;
  } catch (err) {
    console.error("[NIP-58] Failed to create badge:", err);
    return null;
  }
}

export async function awardBadge(
  signer: ISigner,
  badgeDefPubkey: string,
  badgeDTag: string,
  recipientPubkeys: string[],
): Promise<NostrEvent | null> {
  const aTagValue = badgeATagValue(badgeDefPubkey, badgeDTag);

  const tags: string[][] = [
    ["a", aTagValue],
    ...recipientPubkeys.map(pk => ["p", pk]),
  ];

  const eventTemplate = {
    kind: KIND_BADGE_AWARD,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  try {
    const signed = await signWithTimeout(signer, eventTemplate as Parameters<ISigner["signEvent"]>[0]);
    const published = await publishEvent(signed, getBadgeRelays());
    if (published) {
      for (const pk of recipientPubkeys) {
        const existing = badgeAwardsForUserCache.get(pk) || [];
        existing.push(parseBadgeAward(signed));
        badgeAwardsForUserCache.set(pk, existing);
      }
      return signed;
    }
    return null;
  } catch (err) {
    console.error("[NIP-58] Failed to award badge:", err);
    return null;
  }
}

export async function acceptBadges(
  signer: ISigner,
  acceptedBadges: Array<{ badgeRef: string; awardEventId: string }>,
): Promise<NostrEvent | null> {
  // The same ordered list in both formats, so every Nostr app shows the same
  // badges (badge-events.ts). The current one decides success; the legacy
  // twin is best effort for apps that still read only it.
  const [current, legacy] = profileBadgesTemplates(acceptedBadges);
  try {
    const relays = getBadgeRelays();
    const signed = await signWithTimeout(signer, current as Parameters<ISigner["signEvent"]>[0]);
    const published = await publishEvent(signed, relays);
    if (!published) return null;
    const parsed = parseProfileBadges(signed, signed.pubkey);
    profileBadgesCache.set(signed.pubkey, parsed);
    try {
      const signedLegacy = await signWithTimeout(signer, legacy as Parameters<ISigner["signEvent"]>[0]);
      await publishEvent(signedLegacy, relays);
    } catch (err) {
      console.warn("[NIP-58] Legacy profile badges list not published:", err);
    }
    return signed;
  } catch (err) {
    console.error("[NIP-58] Failed to accept badges:", err);
    return null;
  }
}

/** Remove one of your badges (NIP-09). Badges already given stay with their holders. */
export async function deleteBadgeDefinition(signer: ISigner, def: BadgeDefinition): Promise<boolean> {
  try {
    const signed = await signWithTimeout(signer, badgeDeletionTemplate({ pubkey: def.pubkey, id: def.dTag, eventId: def.id }) as Parameters<ISigner["signEvent"]>[0]);
    const ok = await publishEvent(signed, getBadgeRelays());
    if (ok) badgeDefCache.delete(badgeATagValue(def.pubkey, def.dTag));
    return !!ok;
  } catch (err) {
    console.error("[NIP-58] Failed to delete badge:", err);
    return false;
  }
}

/**
 * Show one more badge on your profile, after the ones already there.
 *
 * The profile list is replaced whole, so it is read fresh first — and if it
 * can't be read because no relay answered, nothing is published: writing the
 * one new badge on top of "nothing" would wipe every badge already shown
 * (replaceable lists: never publish over a view you couldn't load).
 */
export async function showBadgeOnProfile(
  signer: ISigner,
  myPubkey: string,
  badge: { badgeRef: string; awardEventId: string },
): Promise<"shown" | "unreachable" | "failed"> {
  clearBadgeCache(myPubkey);
  const current = await fetchProfileBadgesList(myPubkey);
  if (!current && !(await canReachAny(getBadgeRelays()))) return "unreachable";
  const list = withAcceptedBadge(
    (current?.badges ?? []).map((b) => ({ badgeRef: b.badgeRef, awardEventId: b.awardEventId })),
    badge,
  );
  return (await acceptBadges(signer, list)) ? "shown" : "failed";
}

// "Not now" on a badge waiting for you: kept on this device, per account.
const NOT_NOW_PREFIX = "relay-outpost-badges-not-now:";
export function readBadgesNotNow(pubkey: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(NOT_NOW_PREFIX + pubkey) || "[]") as string[]); } catch { return new Set(); }
}
export function addBadgeNotNow(pubkey: string, awardId: string): void {
  const next = readBadgesNotNow(pubkey);
  next.add(awardId);
  try { localStorage.setItem(NOT_NOW_PREFIX + pubkey, JSON.stringify([...next].slice(-500))); } catch { /* ignore */ }
}

export function clearBadgeCache(pubkey?: string): void {
  if (pubkey) {
    profileBadgesCache.delete(pubkey);
    badgeAwardsForUserCache.delete(pubkey);
    inflightPromises.delete(`profile-badges:${pubkey}`);
    inflightPromises.delete(`awards:${pubkey}`);
  } else {
    badgeDefCache.clear();
    profileBadgesCache.clear();
    badgeAwardsForUserCache.clear();
    inflightPromises.clear();
  }
}
