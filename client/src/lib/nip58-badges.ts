import { pool, publishEvent, filterBlockedRelays, DEFAULT_RELAYS, FAST_RELAYS } from "./nostr";
import { signWithTimeout } from "@/lib/signer-timeout";
import { getOutpostRelays, getActiveDefaultRelays } from "./outpost-relays";
import { canReachAny, type Reached } from "./relay-reach";
import type { Event as NostrEvent } from "nostr-tools";
import type { ISigner } from "applesauce-signers";

export const KIND_BADGE_DEFINITION = 30009;
export const KIND_BADGE_AWARD = 8;
export const KIND_PROFILE_BADGES = 30008;

export interface BadgeDefinition {
  id: string;
  pubkey: string;
  dTag: string;
  name: string;
  description: string;
  image: string;
  thumb: string;
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
  "wss://relay.nostr.band",
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

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    name: name || dTag,
    description,
    image,
    thumb,
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
      { kinds: [KIND_PROFILE_BADGES], authors: [pubkey], "#d": ["profile_badges"] },
      {
        onevent(event: NostrEvent) {
          if (!bestEvent || event.created_at > bestEvent.created_at) {
            bestEvent = event;
          }
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
    const seenATags = new Set<string>();
    let sub: ReturnType<typeof pool.subscribeMany> | null = null;

    const finish = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { sub?.close(); } catch {}
        resolve(defs);
      }
    };

    const timer = setTimeout(finish, 8000);

    sub = pool.subscribeMany(
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
        oneose() { finish(); },
      },
    );
  });
}

export async function createBadgeDefinition(
  signer: ISigner,
  name: string,
  description: string,
  imageUrl: string,
  thumbUrl: string,
  dTag?: string,
): Promise<NostrEvent | null> {
  const identifier = dTag || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const tags: string[][] = [
    ["d", identifier],
    ["name", name],
    ["description", description],
  ];
  if (imageUrl) tags.push(["image", imageUrl]);
  if (thumbUrl) tags.push(["thumb", thumbUrl]);

  const eventTemplate = {
    kind: KIND_BADGE_DEFINITION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

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
  const tags: string[][] = [["d", "profile_badges"]];

  for (const badge of acceptedBadges) {
    tags.push(["a", badge.badgeRef]);
    tags.push(["e", badge.awardEventId]);
  }

  const eventTemplate = {
    kind: KIND_PROFILE_BADGES,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  try {
    const signed = await signWithTimeout(signer, eventTemplate as Parameters<ISigner["signEvent"]>[0]);
    const published = await publishEvent(signed, getBadgeRelays());
    if (published) {
      const parsed = parseProfileBadges(signed, signed.pubkey);
      profileBadgesCache.set(signed.pubkey, parsed);
      return signed;
    }
    return null;
  } catch (err) {
    console.error("[NIP-58] Failed to accept badges:", err);
    return null;
  }
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
