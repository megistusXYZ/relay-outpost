// News alert preferences — the user controls behind smart News alerts.
//
// Storage model: one localStorage key per setting, all registered in
// nip78-settings.ts LOCAL_SETTINGS_KEYS so they ride the PortableSettings
// NIP-78 sync (kind 30078) like every other setting. Mute lists are JSON
// string arrays capped at NEWS_MUTE_CAP entries each to keep the blob small.
//
// A window event ("ro-news-alert-prefs") fires on every write so an open News
// page re-scores immediately when Settings changes something.

import { useCallback, useSyncExternalStore } from "react";
import { sanitizeMuteList } from "@/lib/news-scoring";

export const NEWS_ONLY_PRESETS_KEY = "relay-outpost-news-only-presets";
export const NEWS_ONLY_CREATORS_KEY = "relay-outpost-news-only-creators";
export const NEWS_DIGEST_ONLY_KEY = "relay-outpost-news-digest-only";
export const NEWS_SHOW_WORTH_YOUR_TIME_KEY = "relay-outpost-news-show-worth-your-time";
export const NEWS_MUTED_SOURCES_KEY = "relay-outpost-news-muted-sources";
export const NEWS_MUTED_KEYWORDS_KEY = "relay-outpost-news-muted-keywords";

/** Cap per mute list — keeps the synced settings blob small. */
export const NEWS_MUTE_CAP = 50;

const PREFS_EVENT = "ro-news-alert-prefs";

export interface NewsAlertPrefs {
  /** Only notify about sources in my preset/saved categories. */
  onlyPresets: boolean;
  /** Only notify about followed individual creators. */
  onlyCreators: boolean;
  /** Collapse tier 1–2 alerts into a once-per-session digest. */
  digestOnly: boolean;
  /** Show the "Worth your time" priority strip on the News page. OFF by default
   *  — it's a power-user surface; most users want a clean feed. */
  showWorthYourTime: boolean;
  /** Muted feed URLs. */
  mutedSources: string[];
  /** Muted keywords. */
  mutedKeywords: string[];
}

const DEFAULT_PREFS: NewsAlertPrefs = {
  onlyPresets: false,
  onlyCreators: false,
  digestOnly: false,
  showWorthYourTime: false,
  mutedSources: [],
  mutedKeywords: [],
};

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitizeMuteList(JSON.parse(raw), NEWS_MUTE_CAP) : [];
  } catch {
    return [];
  }
}

export function loadNewsAlertPrefs(): NewsAlertPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  return {
    onlyPresets: readBool(NEWS_ONLY_PRESETS_KEY),
    onlyCreators: readBool(NEWS_ONLY_CREATORS_KEY),
    digestOnly: readBool(NEWS_DIGEST_ONLY_KEY),
    showWorthYourTime: readBool(NEWS_SHOW_WORTH_YOUR_TIME_KEY),
    mutedSources: readList(NEWS_MUTED_SOURCES_KEY),
    mutedKeywords: readList(NEWS_MUTED_KEYWORDS_KEY),
  };
}

function notify() {
  try {
    window.dispatchEvent(new Event(PREFS_EVENT));
  } catch {}
}

export function setNewsAlertBool(
  key: typeof NEWS_ONLY_PRESETS_KEY | typeof NEWS_ONLY_CREATORS_KEY | typeof NEWS_DIGEST_ONLY_KEY | typeof NEWS_SHOW_WORTH_YOUR_TIME_KEY,
  value: boolean,
): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {}
  notify();
}

export function setNewsMuteList(
  key: typeof NEWS_MUTED_SOURCES_KEY | typeof NEWS_MUTED_KEYWORDS_KEY,
  list: string[],
): void {
  try {
    localStorage.setItem(key, JSON.stringify(sanitizeMuteList(list, NEWS_MUTE_CAP)));
  } catch {}
  notify();
}

// ── React hook ───────────────────────────────────────────────────────────────

let snapshotCache: { json: string; prefs: NewsAlertPrefs } | null = null;

function getSnapshot(): NewsAlertPrefs {
  const prefs = loadNewsAlertPrefs();
  const json = JSON.stringify(prefs);
  // Return a referentially-stable object while nothing changed, so
  // useSyncExternalStore doesn't loop.
  if (!snapshotCache || snapshotCache.json !== json) snapshotCache = { json, prefs };
  return snapshotCache.prefs;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(PREFS_EVENT, onChange);
  window.addEventListener("storage", onChange); // cross-tab + NIP-78 applied settings
  return () => {
    window.removeEventListener(PREFS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Live view of the news alert prefs (updates on same-tab writes + sync). */
export function useNewsAlertPrefs(): NewsAlertPrefs & {
  setOnlyPresets: (v: boolean) => void;
  setOnlyCreators: (v: boolean) => void;
  setDigestOnly: (v: boolean) => void;
  setShowWorthYourTime: (v: boolean) => void;
  setMutedSources: (list: string[]) => void;
  setMutedKeywords: (list: string[]) => void;
} {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFS);
  const setOnlyPresets = useCallback((v: boolean) => setNewsAlertBool(NEWS_ONLY_PRESETS_KEY, v), []);
  const setOnlyCreators = useCallback((v: boolean) => setNewsAlertBool(NEWS_ONLY_CREATORS_KEY, v), []);
  const setDigestOnly = useCallback((v: boolean) => setNewsAlertBool(NEWS_DIGEST_ONLY_KEY, v), []);
  const setShowWorthYourTime = useCallback((v: boolean) => setNewsAlertBool(NEWS_SHOW_WORTH_YOUR_TIME_KEY, v), []);
  const setMutedSources = useCallback((l: string[]) => setNewsMuteList(NEWS_MUTED_SOURCES_KEY, l), []);
  const setMutedKeywords = useCallback((l: string[]) => setNewsMuteList(NEWS_MUTED_KEYWORDS_KEY, l), []);
  return { ...prefs, setOnlyPresets, setOnlyCreators, setDigestOnly, setShowWorthYourTime, setMutedSources, setMutedKeywords };
}
