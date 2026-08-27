import { DEFAULT_RELAYS } from "@/lib/relay-constants";
import { pool, publishEvent } from "@/lib/nostr";
import { withSignerTimeout, SIGNER_SIGN_TIMEOUT } from "@/lib/signer-timeout";
// NOT `window.nostr`: that exists only for NIP-07 extension users, so these
// three functions silently no-opped for everyone on a local key, a bunker, or
// the PWA — their community list lived in localStorage and nowhere else.
import { resolveSessionSigner } from "./session-signer";
import { queryAnswered } from "./relay-reach";
import { fetchNip11 } from "@/lib/nip11";

const KIND_RELAY_LIST = 10002;
const KIND_COMMUNITY_SUBS = 10073;
const RELAY_LIST_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol"];

const OUTPOST_RELAYS_KEY = "nostr_outpost_relays";
const PUBLISH_RELAY_PREF_KEY = "nostr_publish_relay_preference";
const CUSTOM_RELAYS_KEY = "nostr_custom_relays";
const DISABLED_RELAYS_KEY = "nostr_disabled_relays";

export interface OutpostRelay {
  url: string;
  label: string;
  access: "public" | "private";
  isAdmin?: boolean;
  // Explicit user override that suppresses NIP-11 auto-promotion of
  // operator status. Set to "off" when the user has manually disabled
  // operator mode for a relay they actually own — otherwise the
  // auto-promote effect would silently re-enable it on next mount.
  operatorOverride?: "off";
}

/**
 * What a joined outpost LOOKS like — the NIP-11 icon and name, cached so a list
 * of communities paints with real avatars on the very first frame instead of a
 * row of identical placeholders while N relay documents are in flight.
 *
 * Deliberately separate from OutpostRelay: that's the user's own record of
 * which places they're in (theirs to reorder, survives the relay being down),
 * while this is a disposable copy of what the relay says about itself. Losing
 * it costs one refetch; corrupting the joined list costs memberships.
 */
export interface OutpostDisplayMeta {
  icon?: string;
  name?: string;
}

const OUTPOST_META_KEY = "ro_outpost_meta";
/** Trailing slash and case are not identity for a relay URL. */
function metaKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Merge one relay's resolved look into the stored map. Pure — exported for
 *  tests; the storage wrappers below are the thin part. */
export function mergeOutpostMeta(
  stored: Record<string, OutpostDisplayMeta>,
  url: string,
  meta: OutpostDisplayMeta,
): Record<string, OutpostDisplayMeta> {
  const key = metaKey(url);
  const next = { ...stored };
  const merged = { ...next[key] };
  // Only overwrite with something real: a relay that drops its icon from a
  // later NIP-11 response shouldn't blank an avatar we already have.
  if (meta.icon?.trim()) merged.icon = meta.icon.trim();
  if (meta.name?.trim()) merged.name = meta.name.trim();
  if (!merged.icon && !merged.name) return stored;
  next[key] = merged;
  return next;
}

export function readOutpostMetaMap(): Record<string, OutpostDisplayMeta> {
  try {
    const raw = localStorage.getItem(OUTPOST_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getOutpostMeta(url: string): OutpostDisplayMeta {
  return readOutpostMetaMap()[metaKey(url)] || {};
}

export function saveOutpostMeta(url: string, meta: OutpostDisplayMeta): void {
  try {
    const next = mergeOutpostMeta(readOutpostMetaMap(), url, meta);
    localStorage.setItem(OUTPOST_META_KEY, JSON.stringify(next));
  } catch {
    // A full quota or a private-mode window costs us a cached avatar, nothing more.
  }
}

export type RelayPreset = "all" | "private" | "public" | "defaults" | "custom";

export interface PublishRelayPreference {
  preset: RelayPreset;
  selectedUrls: string[];
  explicitEmpty?: boolean;
}

const BADGE_NAMES_PREFIX = "relay-outpost-badge-names:";

export function getBadgeCustomNames(pubkey: string): Record<string, string> {
  try {
    const stored = localStorage.getItem(`${BADGE_NAMES_PREFIX}${pubkey}`);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function setBadgeCustomName(pubkey: string, relayUrl: string, name: string): void {
  const names = getBadgeCustomNames(pubkey);
  const key = relayUrl.replace(/\/+$/, "").toLowerCase();
  if (name.trim()) {
    names[key] = name.trim();
  } else {
    delete names[key];
  }
  localStorage.setItem(`${BADGE_NAMES_PREFIX}${pubkey}`, JSON.stringify(names));
}

export function getBadgeDisplayName(pubkey: string, relayUrl: string, fallback: string): string {
  const names = getBadgeCustomNames(pubkey);
  const key = relayUrl.replace(/\/+$/, "").toLowerCase();
  return names[key] || fallback;
}

export function getHiddenBadgeUrls(pubkey: string): Set<string> {
  try {
    const stored = localStorage.getItem(`relay-outpost-hidden-badges:${pubkey}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch { return new Set(); }
}

export function addToHiddenBadges(pubkey: string, urls: string | string[]): void {
  const key = `relay-outpost-hidden-badges:${pubkey}`;
  const hidden = getHiddenBadgeUrls(pubkey);
  const toAdd = Array.isArray(urls) ? urls : [urls];
  for (const url of toAdd) {
    hidden.add(url.replace(/\/+$/, ""));
  }
  localStorage.setItem(key, JSON.stringify(Array.from(hidden)));
}

export function getOutpostRelays(): OutpostRelay[] {
  try {
    const stored = localStorage.getItem(OUTPOST_RELAYS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Persist the full outpost-relay list and notify listeners. Mirrors what the
// in-line writes elsewhere in this file already do, exposed as a helper so
// callers (e.g. NIP-11 auto-promotion of operator status) don't have to
// duplicate the localStorage + event-dispatch dance.
export function saveOutpostRelays(relays: OutpostRelay[]): void {
  localStorage.setItem(OUTPOST_RELAYS_KEY, JSON.stringify(relays));
  window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
}

export function reorderOutpostRelays(urls: string[]): void {
  const relays = getOutpostRelays();
  const byUrl = new Map(relays.map((r) => [r.url.replace(/\/+$/, "").toLowerCase(), r]));
  const reordered: OutpostRelay[] = [];
  for (const url of urls) {
    const key = url.replace(/\/+$/, "").toLowerCase();
    const relay = byUrl.get(key);
    if (relay) {
      reordered.push(relay);
      byUrl.delete(key);
    }
  }
  for (const relay of byUrl.values()) reordered.push(relay);
  localStorage.setItem(OUTPOST_RELAYS_KEY, JSON.stringify(reordered));
  window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
}

export function isJoinedOutpost(relayUrl: string): boolean {
  const relays = getOutpostRelays();
  const normalized = relayUrl.replace(/\/+$/, "").toLowerCase();
  return relays.some((r) => r.url.replace(/\/+$/, "").toLowerCase() === normalized);
}

export function joinOutpost(relayUrl: string, label: string, access: "public" | "private" = "public", pubkey?: string | null): void {
  const relays = getOutpostRelays();
  const normalized = relayUrl.replace(/\/+$/, "");
  if (relays.some((r) => r.url.replace(/\/+$/, "").toLowerCase() === normalized.toLowerCase())) return;
  relays.push({ url: normalized, label, access });
  localStorage.setItem(OUTPOST_RELAYS_KEY, JSON.stringify(relays));
  // New outposts default to HIDDEN from the public profile — users opt in via the
  // eye toggle. Fall back to the cached pubkey so joins from paths that don't pass
  // one (e.g. pinning a feed) are hidden by default too.
  const hideForPubkey = pubkey ?? (() => { try { return localStorage.getItem("relay-outpost-pubkey"); } catch { return null; } })();
  if (hideForPubkey) addToHiddenBadges(hideForPubkey, normalized);
  window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
}

function normalizeJoinUrl(url: string): string {
  let u = url.trim();
  if (!u) return u;
  if (!/^wss?:\/\//i.test(u)) u = "wss://" + u;
  if (/^ws:\/\//i.test(u)) u = "wss://" + u.slice(5);
  return u.replace(/\/+$/, "");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || url.replace(/^wss?:\/\//i, "");
  } catch {
    return url.replace(/^wss?:\/\//i, "").split("/")[0] || url;
  }
}

/**
 * Joins an outpost using the given URL, fetching NIP-11 in the background to
 * enrich label and access model. Returns the (provisional) joined entry.
 *
 * Use this from any UI surface where a user adds a relay — profile relay tab,
 * paste-to-join, pinned-feed auto-promotion, etc. — so every "add a relay"
 * action ends up in the unified Your Outposts list.
 */
export async function joinOutpostWithEnrichment(
  relayUrl: string,
  fallbackLabel?: string,
  pubkey?: string | null,
): Promise<OutpostRelay> {
  const normalized = normalizeJoinUrl(relayUrl);
  const compareKey = normalized.toLowerCase();
  const existing = getOutpostRelays().find(
    (r) => r.url.replace(/\/+$/, "").toLowerCase() === compareKey,
  );
  if (existing) return existing;

  const host = hostnameOf(normalized);
  const provisionalLabel = (fallbackLabel || host).trim() || host;
  joinOutpost(normalized, provisionalLabel, "public", pubkey);

  // Enrich in the background so the card upgrades to the relay's real name
  // and access model once NIP-11 responds. Failure is silent — the
  // provisional join still works.
  void (async () => {
    try {
      const doc = await fetchNip11(normalized);
      if (!doc) return;
      const access: "public" | "private" = doc.limitation?.auth_required
        ? "private"
        : "public";
      const newLabel = (doc.name || provisionalLabel).trim() || provisionalLabel;
      const list = getOutpostRelays();
      const idx = list.findIndex(
        (r) => r.url.replace(/\/+$/, "").toLowerCase() === compareKey,
      );
      if (idx < 0) return;
      const current = list[idx];
      if (current.label === newLabel && current.access === access) return;
      list[idx] = { ...current, label: newLabel, access };
      localStorage.setItem(OUTPOST_RELAYS_KEY, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
    } catch {
      /* enrichment is best-effort */
    }
  })();

  return { url: normalized, label: provisionalLabel, access: "public" };
}

export function leaveOutpost(relayUrl: string): void {
  const relays = getOutpostRelays();
  const normalized = relayUrl.replace(/\/+$/, "").toLowerCase();
  const filtered = relays.filter((r) => r.url.replace(/\/+$/, "").toLowerCase() !== normalized);
  localStorage.setItem(OUTPOST_RELAYS_KEY, JSON.stringify(filtered));
  window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
}

export function getCustomRelays(): string[] {
  try {
    const stored = localStorage.getItem(CUSTOM_RELAYS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function getDisabledRelays(): Set<string> {
  try {
    const stored = localStorage.getItem(DISABLED_RELAYS_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

/** Turn one relay off (or back on) without removing it from the list. */
export function setRelayDisabled(url: string, disabled: boolean): void {
  const set = getDisabledRelays();
  if (disabled) set.add(url);
  else set.delete(url);
  try {
    localStorage.setItem(DISABLED_RELAYS_KEY, JSON.stringify([...set]));
  } catch { /* storage unavailable — nothing to persist */ }
}

/** Remove an outpost from the user's list entirely (also clears its disable flag). */
export function removeOutpostRelay(url: string): void {
  saveOutpostRelays(getOutpostRelays().filter((r) => r.url !== url));
  setRelayDisabled(url, false);
}

export function getActiveDefaultRelays(): string[] {
  const disabled = getDisabledRelays();
  const custom = getCustomRelays();
  const all = [...DEFAULT_RELAYS, ...custom];
  return all.filter((url) => !disabled.has(url));
}

export function getAllAvailableRelays(): { outpost: OutpostRelay[]; defaults: string[] } {
  const outpost = getOutpostRelays();
  const disabled = getDisabledRelays();
  const enabledOutpost = outpost.filter((r) => !disabled.has(r.url));
  const defaults = getActiveDefaultRelays();
  const outpostUrls = new Set(outpost.map((r) => r.url));
  const filteredDefaults = defaults.filter((url) => !outpostUrls.has(url));
  return { outpost: enabledOutpost, defaults: filteredDefaults };
}

export function getPublishRelayPreference(): PublishRelayPreference {
  try {
    const stored = localStorage.getItem(PUBLISH_RELAY_PREF_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.preset) return parsed;
    }
  } catch {}
  return { preset: "all", selectedUrls: [] };
}

export function savePublishRelayPreference(pref: PublishRelayPreference): void {
  localStorage.setItem(PUBLISH_RELAY_PREF_KEY, JSON.stringify(pref));
}

export function resolvePublishRelays(pref: PublishRelayPreference): string[] {
  const { outpost, defaults } = getAllAvailableRelays();

  switch (pref.preset) {
    case "all": {
      const urls = [
        ...outpost.map((r) => r.url),
        ...defaults,
      ];
      return [...new Set(urls)];
    }
    case "private": {
      return outpost.filter((r) => r.access === "private").map((r) => r.url);
    }
    case "public": {
      const publicOutpost = outpost.filter((r) => r.access === "public").map((r) => r.url);
      const urls = [...publicOutpost, ...defaults];
      return [...new Set(urls)];
    }
    case "defaults": {
      return defaults;
    }
    case "custom": {
      if (pref.selectedUrls.length === 0) {
        if (pref.explicitEmpty) return [];
        return defaults;
      }
      const disabled = getDisabledRelays();
      return pref.selectedUrls.filter((url) => !disabled.has(url));
    }
    default:
      return defaults;
  }
}

export function getPublishTarget(): { relays: string[]; userSelected: boolean; privateOnly: boolean } {
  const pref = getPublishRelayPreference();
  return {
    relays: resolvePublishRelays(pref),
    userSelected: pref.preset !== "all",
    privateOnly: pref.preset === "private",
  };
}

export type RelayType = "public" | "private" | "default";

export function classifyRelayUrl(url: string): RelayType {
  const outpost = getOutpostRelays();
  const match = outpost.find((r) => r.url === url);
  if (match) return match.access;
  const defaults = getActiveDefaultRelays();
  if (defaults.includes(url) || DEFAULT_RELAYS.includes(url)) return "default";
  return "default";
}

export function getPrivateOutpostUrls(): Set<string> {
  const relays = getOutpostRelays();
  const urls = new Set<string>();
  for (const r of relays) {
    if (r.access === "private") {
      urls.add(r.url.replace(/\/+$/, "").toLowerCase());
    }
  }
  return urls;
}

export function getRelaysByType(type: "public" | "private"): string[] {
  const outpost = getOutpostRelays();
  const disabled = getDisabledRelays();
  const enabled = outpost.filter((r) => !disabled.has(r.url));
  if (type === "private") {
    return enabled.filter((r) => r.access === "private").map((r) => r.url);
  }
  const publicOutpost = enabled.filter((r) => r.access === "public").map((r) => r.url);
  const defaults = getActiveDefaultRelays();
  return [...new Set([...publicOutpost, ...defaults])];
}

export function getPresetLabel(pref: PublishRelayPreference): string {
  switch (pref.preset) {
    case "all":
      return "All Relays";
    case "private":
      return "Private Only";
    case "public":
      return "Public Only";
    case "defaults":
      return "Defaults Only";
    case "custom": {
      const count = pref.selectedUrls.length;
      return count === 1 ? "1 Relay" : `${count} Relays`;
    }
    default:
      return "All Relays";
  }
}

/**
 * The user's current NIP-65 list, and whether anyone actually told us.
 *
 * `answered: false` must never be treated as "you have no relays". kind-10002
 * is REPLACEABLE, so the caller below builds the next one out of this — and an
 * empty or truncated list published over a real one is a DELETE of how every
 * other client on the network finds this person.
 *
 * Timeout is above the pool's DEFAULT_READ_MAX_WAIT_MS so a real EOSE gets to
 * be the thing that ends this read. The old 6s fired before the relays could
 * finish, and resolved `[]` — indistinguishable from a genuinely empty list.
 */
async function fetchCurrentRelayList(
  pubkey: string,
): Promise<{ tags: string[][]; answered: boolean }> {
  const { events, answered } = await queryAnswered(
    RELAY_LIST_RELAYS,
    { kinds: [KIND_RELAY_LIST], authors: [pubkey], limit: 1 },
  );
  let best: { tags: string[][]; created_at: number } | null = null;
  for (const e of events) {
    if (!best || e.created_at > best.created_at) {
      best = { tags: e.tags.filter((t) => t[0] === "r"), created_at: e.created_at };
    }
  }
  return { tags: best ? best.tags : [], answered };
}

export async function updateNip65RelayList(
  action: "add" | "remove",
  relayUrl: string,
): Promise<boolean> {
  try {
    const signer = resolveSessionSigner();
    if (!signer) return false;
    const pubkey = await signer.getPublicKey();
    if (!pubkey) return false;

    const normalized = relayUrl.replace(/\/+$/, "");
    const { tags: currentTags, answered } = await fetchCurrentRelayList(pubkey);

    // Refuse rather than replace. kind-10002 is REPLACEABLE, so publishing a
    // list built on a read nobody answered erases the real one — and this runs
    // on every Join and Leave of an outpost. The `remove` path was the worse of
    // the two: `[].filter(...)` is `[]`, so a Leave published a kind-10002 with
    // ZERO tags, a total deletion of the user's NIP-65 list. `add` published a
    // single-`r` list, deleting every other relay they had.
    //
    // Fourth time this exact shape has been found here — kind-3, kind-10009,
    // kind-10073, now kind-10002 — and the widest-reaching, because NIP-65 is
    // how every other client on the network learns where to find this person.
    if (!answered) return false;

    let newTags: string[][];
    if (action === "add") {
      const exists = currentTags.some(
        (t) => t[1]?.replace(/\/+$/, "").toLowerCase() === normalized.toLowerCase(),
      );
      if (exists) return true;
      newTags = [...currentTags, ["r", normalized]];
    } else {
      newTags = currentTags.filter(
        (t) => t[1]?.replace(/\/+$/, "").toLowerCase() !== normalized.toLowerCase(),
      );
    }

    const eventTemplate = {
      kind: KIND_RELAY_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: newTags,
      content: "",
    };

    const signed = await withSignerTimeout(signer.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return false;
    await publishEvent(signed, RELAY_LIST_RELAYS);
    return true;
  } catch {
    return false;
  }
}

export async function fetchCommunitySubscriptions(pubkey: string): Promise<string[]> {
  return new Promise((resolve) => {
    let best: { tags: string[][]; created_at: number } | null = null;
    const sub = pool.subscribeMany(
      RELAY_LIST_RELAYS,
      { kinds: [KIND_COMMUNITY_SUBS], authors: [pubkey], limit: 1 },
      {
        onevent(e) {
          if (!best || e.created_at > best.created_at) {
            best = { tags: e.tags.filter((t) => t[0] === "I"), created_at: e.created_at };
          }
        },
        oneose() {
          sub.close();
          clearTimeout(timer);
          resolve(best ? best.tags.map((t) => t[1]).filter(Boolean) : []);
        },
      },
    );
    const timer = setTimeout(() => {
      sub.close();
      resolve(best ? best.tags.map((t) => t[1]).filter(Boolean) : []);
    }, 6000);
  });
}

/**
 * Publish the public community list (kind-10073).
 *
 * `allowEmpty` exists because kind-10073 is REPLACEABLE, so publishing an empty
 * one does not mean "I have no communities" — it DELETES whatever was there.
 *
 * New joins are hidden by default (see joinOutpost), and hidden URLs are
 * filtered out below. So a freshly-joined account computes zero tags while
 * genuinely having outposts, and publishing that would erase a good remote
 * list. Observed 2026-08-03: a join published a kind-10073 with zero `I` tags
 * seconds after we confirmed a DIFFERENT account had a healthy three-relay one.
 * Same footgun as the kind-10009 wipe (see nip29.loadSimpleGroupsBase) — build
 * a replaceable event from a filtered local view, publish it unconditionally.
 *
 * So: empty is only published when the CALLER says the emptiness is the point.
 *   - leaving your last outpost  -> allowEmpty, you left
 *   - hiding your last outpost   -> allowEmpty, that is what the eye toggle IS
 *   - joining                    -> never; "all hidden" is not "none"
 */
export async function publishCommunitySubscriptions(
  opts?: { allowEmpty?: boolean },
): Promise<boolean> {
  try {
    const signer = resolveSessionSigner();
    if (!signer) return false;
    const pubkey = await signer.getPublicKey();
    if (!pubkey) return false;

    // Only publish outposts the user has chosen to expose — exclude any hidden
    // via the eye toggle (and new joins, which default to hidden). Keeps profile
    // exposure opt-in instead of auto-revealing every join.
    const hidden = getHiddenBadgeUrls(pubkey);
    const relays = getOutpostRelays();
    const tags = relays
      .map((r) => r.url.replace(/\/+$/, ""))
      .filter((url) => !hidden.has(url))
      .map((url) => ["I", url]);

    // Refuse to replace a remote list with nothing unless that is the intent.
    if (tags.length === 0 && !opts?.allowEmpty && relays.length > 0) return false;

    const eventTemplate = {
      kind: KIND_COMMUNITY_SUBS,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    };

    const signed = await withSignerTimeout(signer.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return false;
    await publishEvent(signed, RELAY_LIST_RELAYS);
    return true;
  } catch {
    return false;
  }
}

export async function hydrateCommunitySubscriptions(): Promise<boolean> {
  try {
    const signer = resolveSessionSigner();
    if (!signer) return false;
    const pubkey = await signer.getPublicKey();
    if (!pubkey) return false;

    const localRelays = getOutpostRelays();
    if (localRelays.length > 0) return false;

    const remoteIds = await fetchCommunitySubscriptions(pubkey);
    if (remoteIds.length === 0) return false;

    const imported: OutpostRelay[] = remoteIds
      .filter((id) => id.startsWith("wss://") || id.startsWith("ws://"))
      .map((url) => ({
        url: url.replace(/\/+$/, ""),
        label: url.replace(/^wss?:\/\//, "").replace(/\/+$/, ""),
        access: "public" as const,
      }));

    if (imported.length === 0) return false;

    localStorage.setItem(OUTPOST_RELAYS_KEY, JSON.stringify(imported));
    addToHiddenBadges(pubkey, imported.map((r) => r.url));
    window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
    return true;
  } catch {
    return false;
  }
}
