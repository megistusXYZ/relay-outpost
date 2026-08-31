import type { ISigner } from "applesauce-signers";
import type { NostrEvent } from "nostr-tools";
import { pool, publishEvent, filterBlockedRelays } from "@/lib/nostr";
import { signWithTimeout } from "@/lib/signer-timeout";
import { getOutpostRelays, getActiveDefaultRelays, type OutpostRelay } from "@/lib/outpost-relays";
import { armPrivateModeIfSet } from "@/lib/private-mode";

const KIND_APP_DATA = 30078;
const D_TAG = "relay-outpost-settings";
const SETTINGS_VERSION = 1;
const SYNC_DEBOUNCE = 3000;
const FETCH_TIMEOUT = 10000;

const FALLBACK_SETTINGS_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://purplepag.es",
];

export interface PortableSettings {
  version: number;
  lastModified: number;
  wotEnabled?: boolean;
  reachDepth?: string;
  outpostRelays?: OutpostRelay[];
  theme?: string;
  defaultFeedMode?: string;
  defaultFilter?: string;
  defaultCommentSort?: string;
  defaultLandingPage?: string;
  dmDemotedPubkeys?: string[];
  excludedTiers?: string[];
  tierFilterExpanded?: boolean;
  defaultZapAmount?: number;
  autoplayMedia?: boolean;
  imageLoading?: string;
  sensitiveContent?: string;
  fontStyle?: string;
  textSize?: string;
  feedStyle?: string;
  profileLayout?: string;
  publishRelayPreference?: string;
  zapPresets?: Array<{ emoji: string; label: string; amount: number }>;
  engagementWeights?: { replies: number; reposts: number; likes: number; zaps: number; satsBonus: number };
  pinnedCalendarEvents?: (string | { id: string; kind: number; pubkey: string; dTag: string })[];
  customCalendarHolidays?: Array<{ id: string; name: string; month: number; day: number; note?: string; year?: number; emoji?: string }>;
  hiddenCalendarHolidays?: string[];
  wotBadgeDetailed?: boolean;
  contrastLevel?: string;
  batchDecryptionEnabled?: boolean;
  clientTagEnabled?: boolean;
  translationEnabled?: boolean;
  translateAutoLangs?: string[];
  showClientTag?: boolean;
  crashReportsEnabled?: boolean;
  hideMessagePreviews?: boolean;
  privateMode?: boolean;
  petnames?: Record<string, { name?: string; emoji?: string; color?: string }>;
  newsOnlyPresets?: boolean;
  newsOnlyCreators?: boolean;
  newsDigestOnly?: boolean;
  newsShowWorthYourTime?: boolean;
  /** News alert mute lists — capped small (≤50 each) client-side. */
  newsMutedSources?: string[];
  newsMutedKeywords?: string[];
}

type SettingType = "string" | "boolean" | "number" | "json";

interface SettingsMapping {
  lsKey: string;
  settingsKey: keyof PortableSettings;
  type: SettingType;
}

const LOCAL_SETTINGS_KEYS: SettingsMapping[] = [
  { lsKey: "relay-outpost-wot-enabled", settingsKey: "wotEnabled", type: "boolean" },
  { lsKey: "relay-outpost-reach-depth", settingsKey: "reachDepth", type: "string" },
  { lsKey: "relay-outpost-theme", settingsKey: "theme", type: "string" },
  { lsKey: "relay-outpost-default-feed-mode", settingsKey: "defaultFeedMode", type: "string" },
  { lsKey: "relay-outpost-default-filter", settingsKey: "defaultFilter", type: "string" },
  { lsKey: "relay-outpost-default-comment-sort", settingsKey: "defaultCommentSort", type: "string" },
  { lsKey: "relay-outpost-default-landing-page", settingsKey: "defaultLandingPage", type: "string" },
  { lsKey: "relay-outpost-excluded-tiers", settingsKey: "excludedTiers", type: "json" },
  { lsKey: "relay-outpost-tier-filter-expanded", settingsKey: "tierFilterExpanded", type: "boolean" },
  { lsKey: "defaultZapAmount", settingsKey: "defaultZapAmount", type: "number" },
  { lsKey: "autoplayMedia", settingsKey: "autoplayMedia", type: "boolean" },
  { lsKey: "imageLoading", settingsKey: "imageLoading", type: "string" },
  { lsKey: "sensitiveContent", settingsKey: "sensitiveContent", type: "string" },
  { lsKey: "relay-outpost-font", settingsKey: "fontStyle", type: "string" },
  { lsKey: "relay-outpost-font-size", settingsKey: "textSize", type: "string" },
  { lsKey: "relay-outpost-feed-style", settingsKey: "feedStyle", type: "string" },
  { lsKey: "relay-outpost-profile-layout", settingsKey: "profileLayout", type: "string" },
  { lsKey: "relay-outpost-zap-presets", settingsKey: "zapPresets", type: "json" },
  { lsKey: "relay-outpost-engagement-weights", settingsKey: "engagementWeights", type: "json" },
  { lsKey: "relay-outpost-wot-badge-detailed", settingsKey: "wotBadgeDetailed", type: "boolean" },
  { lsKey: "relay-outpost-contrast-level", settingsKey: "contrastLevel", type: "string" },
  { lsKey: "relay-outpost-batch-decryption", settingsKey: "batchDecryptionEnabled", type: "boolean" },
  { lsKey: "relay-outpost-client-tag-enabled", settingsKey: "clientTagEnabled", type: "boolean" },
  { lsKey: "relay-outpost-translation-enabled", settingsKey: "translationEnabled", type: "boolean" },
  { lsKey: "relay-outpost-translate-auto-langs", settingsKey: "translateAutoLangs", type: "json" },
  { lsKey: "relay-outpost-show-client-tag", settingsKey: "showClientTag", type: "boolean" },
  { lsKey: "relay-outpost-crash-reports-enabled", settingsKey: "crashReportsEnabled", type: "boolean" },
  { lsKey: "relay-outpost-hide-message-previews", settingsKey: "hideMessagePreviews", type: "boolean" },
  { lsKey: "relay-outpost-private-mode", settingsKey: "privateMode", type: "boolean" },
  // Petnames ride the ENCRYPTED settings event — that privacy property is the
  // whole feature (the public kind-3 petname field died of being public).
  { lsKey: "relay-outpost-petnames", settingsKey: "petnames", type: "json" },
  { lsKey: "relay-outpost-news-only-presets", settingsKey: "newsOnlyPresets", type: "boolean" },
  { lsKey: "relay-outpost-news-only-creators", settingsKey: "newsOnlyCreators", type: "boolean" },
  { lsKey: "relay-outpost-news-digest-only", settingsKey: "newsDigestOnly", type: "boolean" },
  { lsKey: "relay-outpost-news-show-worth-your-time", settingsKey: "newsShowWorthYourTime", type: "boolean" },
  { lsKey: "relay-outpost-news-muted-sources", settingsKey: "newsMutedSources", type: "json" },
  { lsKey: "relay-outpost-news-muted-keywords", settingsKey: "newsMutedKeywords", type: "json" },
];

const WATCHED_LS_KEYS = new Set(LOCAL_SETTINGS_KEYS.map(m => m.lsKey));
WATCHED_LS_KEYS.add("nostr_outpost_relays");
WATCHED_LS_KEYS.add("nostr_publish_relay_preference");

const PINNED_EVENTS_PREFIX = "relay-outpost-pinned-calendar-events";
const CUSTOM_HOLIDAYS_PREFIX = "relay-outpost-custom-holidays";
const HIDDEN_HOLIDAYS_PREFIX = "relay-outpost-hidden-holidays";

const ACTIVE_PUBKEY_KEY = "relay-outpost-active-pubkey";

// INVARIANT — DO NOT REMOVE AUTH KEYS HERE.
// `clearUserSpecificStorage` wipes per-account settings/drafts/caches when
// the active account changes. It MUST NEVER remove any of:
//   - "relay-outpost-pubkey"          (PUBKEY_CACHE_KEY)
//   - "relay-outpost-login-method"    (LOGIN_METHOD_KEY)
//   - "relay-outpost-local-account"   (encrypted nsec blob)
//   - "relay-outpost-local-secret"    (LOCAL_SECRET_STORAGE_KEY: plaintext nsec for "stay signed in" path)
//   - "relay-outpost-active-pubkey"   (ACTIVE_PUBKEY_KEY)
// Adding any of those to the static-key list below will silently log users
// out the next time they switch accounts. If you need to clear an auth
// key, do it from `logout()` in NostrAuthContext, not here.
export function clearUserSpecificStorage(oldPubkey?: string): void {
  for (const mapping of LOCAL_SETTINGS_KEYS) {
    try { localStorage.removeItem(mapping.lsKey); } catch {}
  }

  const staticKeys = [
    "nostr_outpost_relays",
    "nostr_publish_relay_preference",
    "nostr_custom_relays",
    "nostr_disabled_relays",
    "nostr_pinned_feeds",
    "defaultZapAmount",
    "relay-outpost-zap-presets",
    "relay-outpost-custom-tier-thresholds",
    "relay-outpost-custom-tiers-enabled",
    "relay-outpost-nwc-uri",
    "relay-outpost-hide-comment-trust",
    "relay-outpost-flagged-detection",
    "relay-outpost-dismissed-flagged",
    "relay-outpost-content-filter",
    "relay-outpost-raw-acknowledged",
    "relay-outpost-auto-mute-flagged",
    "relay-outpost-wot-filter",
    "relay-outpost-wot-choice-set",
    "relay_outpost_drafts",
    "relay_outpost_rss_bookmarks",
    "outpost:private-events",
    "zapPrivacy",
    "walletBalanceHidden",
    "engagement-badge-mode",
    "orbit_view_mode",
    "outpost-banner-index",
    "outpost-wallet-visible",
    "btcTrackerEnabled",
    "btcBadgeMode",
    "people_sort_orbit",
    "people_sort_crew",
    "people_sort_default",
  ];
  for (const key of staticKeys) {
    try { localStorage.removeItem(key); } catch {}
  }

  if (oldPubkey) {
    const prefixedKeys = [
      `relay-outpost-dm-demoted-${oldPubkey}`,
      `relay-outpost-badge-names:${oldPubkey}`,
      `relay-outpost-hidden-badges:${oldPubkey}`,
      `${PINNED_EVENTS_PREFIX}:${oldPubkey}`,
      `${CUSTOM_HOLIDAYS_PREFIX}:${oldPubkey}`,
      `${HIDDEN_HOLIDAYS_PREFIX}:${oldPubkey}`,
      `relay-outpost-settings-ts:${oldPubkey}`,
      `flight_log_list_changes_${oldPubkey.slice(0, 16)}`,
      `graperank_scores_cache:${oldPubkey.slice(0, 8)}`,
    ];
    for (const key of prefixedKeys) {
      try { localStorage.removeItem(key); } catch {}
    }
  }

  try { sessionStorage.removeItem("graperank_auth"); } catch {}

  try { window.dispatchEvent(new CustomEvent("outpost-relays-changed")); } catch {}
  try { window.dispatchEvent(new CustomEvent("pinned-feeds-changed")); } catch {}
}

export function handleAccountSwitch(newPubkey: string): boolean {
  try {
    const storedPubkey = localStorage.getItem(ACTIVE_PUBKEY_KEY);
    const debug = (() => {
      try { return localStorage.getItem("debug-auth") === "1"; } catch { return false; }
    })();
    if (storedPubkey && storedPubkey !== newPubkey) {
      if (debug) console.log("[auth] handleAccountSwitch:", { stored: storedPubkey, new: newPubkey, action: "clear" });
      else console.log("[NIP-78] Account switch detected, clearing stale data from previous account");
      // Write the new active pubkey BEFORE clearing — if anything in the
      // clearer throws, we don't leave ACTIVE_PUBKEY_KEY pointing at the
      // old account (which would then re-clear on the next mount).
      localStorage.setItem(ACTIVE_PUBKEY_KEY, newPubkey);
      clearUserSpecificStorage(storedPubkey);
      return true;
    }
    if (!storedPubkey) {
      const legacyPubkey = localStorage.getItem("relay-outpost-pubkey");
      if (legacyPubkey && legacyPubkey !== newPubkey) {
        if (debug) console.log("[auth] handleAccountSwitch: legacy migration", { legacy: legacyPubkey, new: newPubkey, action: "clear" });
        else console.log("[NIP-78] Migration: different account detected, clearing stale data");
        // Same ordering invariant as above: claim ACTIVE_PUBKEY_KEY first.
        localStorage.setItem(ACTIVE_PUBKEY_KEY, newPubkey);
        clearUserSpecificStorage(legacyPubkey);
      } else {
        localStorage.setItem(ACTIVE_PUBKEY_KEY, newPubkey);
      }
    }
    if (debug && storedPubkey === newPubkey) {
      console.log("[auth] handleAccountSwitch:", { stored: storedPubkey, new: newPubkey, action: "noop" });
    }
    return false;
  } catch {
    return false;
  }
}

let isApplyingRemote = false;

interface Nip78Window { __nip78OrigSetItem?: typeof localStorage.setItem; __nip78OrigRemoveItem?: typeof localStorage.removeItem }

const _origSetItem = (window as Nip78Window).__nip78OrigSetItem ?? localStorage.setItem.bind(localStorage);
const _origRemoveItem = (window as Nip78Window).__nip78OrigRemoveItem ?? localStorage.removeItem.bind(localStorage);

if (!(window as Nip78Window).__nip78OrigSetItem) {
  (window as Nip78Window).__nip78OrigSetItem = _origSetItem;
  (window as Nip78Window).__nip78OrigRemoveItem = _origRemoveItem;

  localStorage.setItem = function (key: string, value: string) {
    _origSetItem(key, value);
    if (isApplyingRemote) return;
    if (WATCHED_LS_KEYS.has(key) || key.startsWith("relay-outpost-dm-demoted-") || key.startsWith(PINNED_EVENTS_PREFIX) || key.startsWith(CUSTOM_HOLIDAYS_PREFIX) || key.startsWith(HIDDEN_HOLIDAYS_PREFIX)) {
      try { window.dispatchEvent(new CustomEvent("nip78-trigger-sync")); } catch {}
    }
  };

  localStorage.removeItem = function (key: string) {
    _origRemoveItem(key);
    if (isApplyingRemote) return;
    if (WATCHED_LS_KEYS.has(key) || key.startsWith("relay-outpost-dm-demoted-") || key.startsWith(PINNED_EVENTS_PREFIX) || key.startsWith(CUSTOM_HOLIDAYS_PREFIX) || key.startsWith(HIDDEN_HOLIDAYS_PREFIX)) {
      try { window.dispatchEvent(new CustomEvent("nip78-trigger-sync")); } catch {}
    }
  };
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let currentSigner: ISigner | null = null;
let currentPubkey: string | null = null;
let syncInFlight = false;
let initialLoadDone = false;

function settingsTsKey(pubkey: string): string {
  return `relay-outpost-settings-ts:${pubkey}`;
}

function getLocalTimestamp(pubkey: string): number {
  try {
    const stored = localStorage.getItem(settingsTsKey(pubkey));
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

function setLocalTimestamp(pubkey: string, ts: number): void {
  try {
    _origSetItem(settingsTsKey(pubkey), String(ts));
  } catch {}
}

function getUserWriteRelays(): string[] {
  const active = getActiveDefaultRelays();
  const outpost = getOutpostRelays().map(r => r.url);
  const combined = [...new Set([...active, ...outpost])];
  const filtered = filterBlockedRelays(combined);
  if (filtered.length > 0) return filtered.slice(0, 6);
  return filterBlockedRelays(FALLBACK_SETTINGS_RELAYS);
}

function defaultForType(type: SettingsMapping["type"]): string | boolean | number | string[] {
  switch (type) {
    case "string": return "";
    case "boolean": return false;
    case "number": return 0;
    case "json": return [];
  }
}

function readSetting(mapping: SettingsMapping): string | boolean | number | string[] {
  try {
    const raw = localStorage.getItem(mapping.lsKey);
    if (raw === null) return defaultForType(mapping.type);
    switch (mapping.type) {
      case "string": return raw;
      case "boolean": return raw === "true";
      case "number": return parseInt(raw, 10);
      case "json": return JSON.parse(raw);
    }
  } catch {}
  return defaultForType(mapping.type);
}

function isDefault(value: unknown, type: SettingsMapping["type"]): boolean {
  if (value === undefined || value === null) return true;
  switch (type) {
    case "string": return value === "";
    case "boolean": return value === false;
    case "number": return value === 0;
    case "json": return Array.isArray(value) && value.length === 0;
  }
}

function writeSetting(mapping: SettingsMapping, value: unknown): void {
  if (value === undefined) return;
  if (isDefault(value, mapping.type)) {
    try { localStorage.removeItem(mapping.lsKey); } catch {}
    return;
  }
  try {
    switch (mapping.type) {
      case "string":
        localStorage.setItem(mapping.lsKey, String(value));
        break;
      case "boolean":
        localStorage.setItem(mapping.lsKey, value ? "true" : "false");
        break;
      case "number":
        localStorage.setItem(mapping.lsKey, String(value));
        break;
      case "json":
        localStorage.setItem(mapping.lsKey, JSON.stringify(value));
        break;
    }
  } catch {}
}

function hasAnyPortableKeys(pubkey?: string): boolean {
  for (const mapping of LOCAL_SETTINGS_KEYS) {
    try {
      if (localStorage.getItem(mapping.lsKey) !== null) return true;
    } catch {}
  }
  try {
    if (getOutpostRelays().length > 0) return true;
  } catch {}
  if (pubkey) {
    try {
      const pinnedKey = `${PINNED_EVENTS_PREFIX}:${pubkey}`;
      const pinned = localStorage.getItem(pinnedKey);
      if (pinned) {
        const parsed = JSON.parse(pinned);
        if (Array.isArray(parsed) && parsed.length > 0) return true;
      }
    } catch {}
    try {
      const customKey = `${CUSTOM_HOLIDAYS_PREFIX}:${pubkey}`;
      const custom = localStorage.getItem(customKey);
      if (custom) {
        const parsed = JSON.parse(custom);
        if (Array.isArray(parsed) && parsed.length > 0) return true;
      }
    } catch {}
    try {
      const hiddenKey = `${HIDDEN_HOLIDAYS_PREFIX}:${pubkey}`;
      const hidden = localStorage.getItem(hiddenKey);
      if (hidden) {
        const parsed = JSON.parse(hidden);
        if (Array.isArray(parsed) && parsed.length > 0) return true;
      }
    } catch {}
  }
  return false;
}

function collectLocalSettings(pubkey: string): PortableSettings {
  const settings: PortableSettings = {
    version: SETTINGS_VERSION,
    lastModified: Date.now(),
  };

  for (const mapping of LOCAL_SETTINGS_KEYS) {
    const value = readSetting(mapping);
    Object.assign(settings, { [mapping.settingsKey]: value });
  }

  try {
    settings.outpostRelays = getOutpostRelays();
  } catch {
    settings.outpostRelays = [];
  }

  try {
    const demotedKey = `relay-outpost-dm-demoted-${pubkey}`;
    const demoted = localStorage.getItem(demotedKey);
    settings.dmDemotedPubkeys = demoted ? JSON.parse(demoted) : [];
  } catch {
    settings.dmDemotedPubkeys = [];
  }

  try {
    settings.publishRelayPreference = localStorage.getItem("nostr_publish_relay_preference") || "";
  } catch {
    settings.publishRelayPreference = "";
  }

  try {
    const pinnedKey = `${PINNED_EVENTS_PREFIX}:${pubkey}`;
    const pinned = localStorage.getItem(pinnedKey);
    settings.pinnedCalendarEvents = pinned ? JSON.parse(pinned) : [];
  } catch {
    settings.pinnedCalendarEvents = [];
  }

  try {
    const customKey = `${CUSTOM_HOLIDAYS_PREFIX}:${pubkey}`;
    const custom = localStorage.getItem(customKey);
    settings.customCalendarHolidays = custom ? JSON.parse(custom) : [];
  } catch {
    settings.customCalendarHolidays = [];
  }

  try {
    const hiddenKey = `${HIDDEN_HOLIDAYS_PREFIX}:${pubkey}`;
    const hidden = localStorage.getItem(hiddenKey);
    settings.hiddenCalendarHolidays = hidden ? JSON.parse(hidden) : [];
  } catch {
    settings.hiddenCalendarHolidays = [];
  }

  return settings;
}

function applySettingsToLocal(settings: PortableSettings, pubkey: string): void {
  isApplyingRemote = true;
  try {
    for (const mapping of LOCAL_SETTINGS_KEYS) {
      const value = settings[mapping.settingsKey];
      if (value === undefined) {
        try { localStorage.removeItem(mapping.lsKey); } catch {}
      } else {
        writeSetting(mapping, value);
      }
    }
    // Settings with live in-memory state need a nudge — writeSetting bypasses
    // their setters. Private mode is the one that matters: a remote ON must
    // mask the chat list NOW, not after the next reload.
    armPrivateModeIfSet();

    try {
      if (Array.isArray(settings.outpostRelays) && settings.outpostRelays.length > 0) {
        localStorage.setItem("nostr_outpost_relays", JSON.stringify(settings.outpostRelays));
      } else {
        localStorage.removeItem("nostr_outpost_relays");
      }
      window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
    } catch {}

    try {
      const demotedKey = `relay-outpost-dm-demoted-${pubkey}`;
      if (Array.isArray(settings.dmDemotedPubkeys) && settings.dmDemotedPubkeys.length > 0) {
        localStorage.setItem(demotedKey, JSON.stringify(settings.dmDemotedPubkeys));
      } else {
        localStorage.removeItem(demotedKey);
      }
    } catch {}

    try {
      if (settings.publishRelayPreference) {
        localStorage.setItem("nostr_publish_relay_preference", settings.publishRelayPreference);
      } else {
        localStorage.removeItem("nostr_publish_relay_preference");
      }
    } catch {}

    try {
      const pinnedKey = `${PINNED_EVENTS_PREFIX}:${pubkey}`;
      if (Array.isArray(settings.pinnedCalendarEvents) && settings.pinnedCalendarEvents.length > 0) {
        localStorage.setItem(pinnedKey, JSON.stringify(settings.pinnedCalendarEvents));
      } else {
        localStorage.removeItem(pinnedKey);
      }
    } catch {}

    try {
      const customKey = `${CUSTOM_HOLIDAYS_PREFIX}:${pubkey}`;
      if (Array.isArray(settings.customCalendarHolidays) && settings.customCalendarHolidays.length > 0) {
        localStorage.setItem(customKey, JSON.stringify(settings.customCalendarHolidays));
      } else {
        localStorage.removeItem(customKey);
      }
    } catch {}

    try {
      const hiddenKey = `${HIDDEN_HOLIDAYS_PREFIX}:${pubkey}`;
      if (Array.isArray(settings.hiddenCalendarHolidays) && settings.hiddenCalendarHolidays.length > 0) {
        localStorage.setItem(hiddenKey, JSON.stringify(settings.hiddenCalendarHolidays));
      } else {
        localStorage.removeItem(hiddenKey);
      }
    } catch {}

    if (settings.theme) {
      window.dispatchEvent(new CustomEvent("nip78-theme-applied", { detail: settings.theme }));
    }

    if (settings.contrastLevel) {
      window.dispatchEvent(new CustomEvent("nip78-contrast-applied", { detail: settings.contrastLevel }));
    }

    setLocalTimestamp(pubkey, settings.lastModified);
    window.dispatchEvent(new CustomEvent("nip78-settings-applied"));
  } finally {
    isApplyingRemote = false;
  }
}

async function fetchSettingsFromRelay(pubkey: string, signer: ISigner): Promise<PortableSettings | null> {
  return new Promise((resolve) => {
    let bestEvent: NostrEvent | null = null;
    let eoseCount = 0;
    let resolved = false;
    const relays = getUserWriteRelays();
    const closers: Array<{ close(): void }> = [];

    const timer = setTimeout(() => {
      for (const c of closers) { try { c.close(); } catch {} }
      finalize();
    }, FETCH_TIMEOUT);

    const finalize = async () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (!bestEvent) {
        resolve(null);
        return;
      }

      try {
        if (!signer.nip44) {
          resolve(null);
          return;
        }
        const decrypted = await signer.nip44.decrypt(pubkey, bestEvent.content);
        const parsed: unknown = JSON.parse(decrypted);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "version" in parsed &&
          typeof (parsed as PortableSettings).version === "number" &&
          "lastModified" in parsed &&
          typeof (parsed as PortableSettings).lastModified === "number"
        ) {
          resolve(parsed as PortableSettings);
        } else {
          resolve(null);
        }
      } catch (err) {
        console.error("[NIP-78] Failed to decrypt settings:", err);
        resolve(null);
      }
    };

    const sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [D_TAG], limit: 1 },
      {
        onevent(event: NostrEvent) {
          if (!bestEvent || event.created_at > bestEvent.created_at) {
            bestEvent = event;
          }
        },
        oneose() {
          eoseCount++;
          if (eoseCount >= relays.length) {
            sub.close();
            finalize();
          }
        },
      },
    );
    closers.push(sub);
  });
}

interface UnsignedAppEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

async function publishSettingsToRelay(settings: PortableSettings, pubkey: string, signer: ISigner): Promise<boolean> {
  try {
    if (!signer.nip44) {
      console.warn("[NIP-78] Signer does not support NIP-44 encryption");
      return false;
    }

    const payload = JSON.stringify(settings);
    const encrypted = await signer.nip44.encrypt(pubkey, payload);

    const eventTemplate: UnsignedAppEvent = {
      kind: KIND_APP_DATA,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", D_TAG]],
      content: encrypted,
    };

    const signed = await signWithTimeout(signer, eventTemplate as Parameters<ISigner["signEvent"]>[0]);
    if (!signed) return false;

    const relays = getUserWriteRelays();
    await publishEvent(signed, relays, undefined, true);
    console.log("[NIP-78] Settings published to relays");
    return true;
  } catch (err) {
    console.error("[NIP-78] Failed to publish settings:", err);
    return false;
  }
}

export async function loadSettingsFromRelay(pubkey: string, signer: ISigner): Promise<boolean> {
  try {
    currentSigner = signer;
    currentPubkey = pubkey;

    const remoteSettings = await fetchSettingsFromRelay(pubkey, signer);
    const localTs = getLocalTimestamp(pubkey);

    if (!remoteSettings) {
      console.log("[NIP-78] No remote settings found");
      initialLoadDone = true;
      if (hasAnyPortableKeys(pubkey)) {
        console.log("[NIP-78] Local settings exist, publishing to relay");
        scheduleInitialPublish();
      }
      return false;
    }

    if (remoteSettings.lastModified > localTs) {
      console.log("[NIP-78] Remote settings are newer, applying");
      applySettingsToLocal(remoteSettings, pubkey);
      initialLoadDone = true;
      return true;
    }

    console.log("[NIP-78] Local settings are newer, publishing to relay");
    initialLoadDone = true;
    scheduleInitialPublish();
    return false;
  } catch (err) {
    console.error("[NIP-78] Failed to load settings:", err);
    initialLoadDone = true;
    return false;
  }
}

function scheduleInitialPublish(): void {
  if (!currentSigner || !currentPubkey) return;
  const pubkey = currentPubkey;
  const signer = currentSigner;
  setTimeout(async () => {
    if (syncInFlight || currentPubkey !== pubkey) return;
    syncInFlight = true;
    try {
      const settings = collectLocalSettings(pubkey);
      setLocalTimestamp(pubkey, settings.lastModified);
      await publishSettingsToRelay(settings, pubkey, signer);
    } catch (err) {
      console.error("[NIP-78] Initial publish failed:", err);
    } finally {
      syncInFlight = false;
    }
  }, SYNC_DEBOUNCE);
}

export function scheduleSyncToRelay(): void {
  if (!currentSigner || !currentPubkey || !initialLoadDone) return;

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    if (syncInFlight || !currentSigner || !currentPubkey) return;
    syncInFlight = true;

    try {
      const settings = collectLocalSettings(currentPubkey);
      setLocalTimestamp(currentPubkey, settings.lastModified);
      await publishSettingsToRelay(settings, currentPubkey, currentSigner);
    } catch (err) {
      console.error("[NIP-78] Background sync failed:", err);
    } finally {
      syncInFlight = false;
    }
  }, SYNC_DEBOUNCE);
}

export function initSettingsSync(pubkey: string, signer: ISigner): void {
  currentSigner = signer;
  currentPubkey = pubkey;
}

export function teardownSettingsSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  currentSigner = null;
  currentPubkey = null;
  syncInFlight = false;
  initialLoadDone = false;
}
