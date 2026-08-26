import { useSyncExternalStore } from "react";

// Device-local "feed intelligence" switches. Kept out of NIP-78 sync on purpose
// (these are per-device viewing preferences; syncing them invites the same
// cross-device override surprises we hit with theme).
const RANKING_KEY = "relay-outpost-feed-ranking-enabled";
const ENGAGEMENT_KEY = "relay-outpost-show-engagement";
const CHANGE_EVENT = "relay-outpost-feed-prefs-changed";

function readBool(key: string, fallback: boolean): boolean {
  // Absence means the per-key default; an explicit choice always wins.
  // Stored values are only ever "true"/"false" (see writeBool).
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch { return fallback; }
}

function writeBool(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? "true" : "false"); } catch {}
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch {}
}

/** Algorithmic feed ranking. Default ON. When off, feeds show newest-first. */
export function isFeedRankingEnabled(): boolean { return readBool(RANKING_KEY, true); }
export function setFeedRankingEnabled(v: boolean): void { writeBool(RANKING_KEY, v); }

/** The per-post engagement-score badge. Default OFF (calm default — it's a
 *  power-user overlay); users who explicitly enabled it keep it. */
export function isEngagementScoreEnabled(): boolean { return readBool(ENGAGEMENT_KEY, false); }
export function setEngagementScoreEnabled(v: boolean): void { writeBool(ENGAGEMENT_KEY, v); }

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Reactive read of the feed-intelligence switches. */
export function useFeedPrefs() {
  const rankingEnabled = useSyncExternalStore(subscribe, isFeedRankingEnabled, () => true);
  const engagementScoreEnabled = useSyncExternalStore(subscribe, isEngagementScoreEnabled, () => false);
  return { rankingEnabled, engagementScoreEnabled };
}
