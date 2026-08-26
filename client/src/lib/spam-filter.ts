import type { Event } from "nostr-tools";
import { gateStrangerProfile, type ProfileResolution } from "./discover-quality";

const SPAM_API_URL = "https://spam.nostr.band/spam_api";
const CACHE_DURATION = 5 * 60 * 1000;
const DUPLICATE_WINDOW = 60 * 60;
const DUPLICATE_THRESHOLD = 3;

let spamPubkeys = new Set<string>();
let spamEventIds = new Set<string>();
let lastFetched = 0;
let fetching = false;

const spamListListeners: Array<() => void> = [];

export function onSpamListChange(cb: () => void) {
  spamListListeners.push(cb);
  return () => {
    const idx = spamListListeners.indexOf(cb);
    if (idx >= 0) spamListListeners.splice(idx, 1);
  };
}

function notifySpamListListeners() {
  spamListListeners.forEach((cb) => cb());
}

export async function fetchSpamList(): Promise<void> {
  if (fetching) return;
  if (Date.now() - lastFetched < CACHE_DURATION) return;

  fetching = true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${SPAM_API_URL}?method=get_current_spam`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      fetching = false;
      return;
    }

    const data = await res.json();

    if (data && typeof data === "object") {
      const newPubkeys = new Set<string>();
      const newEventIds = new Set<string>();

      if (Array.isArray(data.blocked_pubkeys)) {
        data.blocked_pubkeys.forEach((pk: string) => newPubkeys.add(pk));
      }

      if (Array.isArray(data.pubkeys)) {
        data.pubkeys.forEach((pk: string) => newPubkeys.add(pk));
      }

      if (Array.isArray(data.blocked_events)) {
        data.blocked_events.forEach((ev: any) => {
          if (typeof ev === "string") newEventIds.add(ev);
          else if (ev?.event_id) newEventIds.add(ev.event_id);
          else if (ev?.id) newEventIds.add(ev.id);
        });
      }

      if (Array.isArray(data.events)) {
        data.events.forEach((ev: any) => {
          if (typeof ev === "string") newEventIds.add(ev);
          else if (ev?.id) newEventIds.add(ev.id);
        });
      }

      if (Array.isArray(data.spam_patterns)) {
        data.spam_patterns.forEach((p: any) => {
          if (p?.pubkey) newPubkeys.add(p.pubkey);
          if (p?.event_id) newEventIds.add(p.event_id);
        });
      }

      let changed = false;
      if (newPubkeys.size > 0) { spamPubkeys = newPubkeys; changed = true; }
      if (newEventIds.size > 0) { spamEventIds = newEventIds; changed = true; }
      if (changed) notifySpamListListeners();
    }

    lastFetched = Date.now();
  } catch {
  } finally {
    fetching = false;
  }
}

export function isSpamPubkey(pubkey: string): boolean {
  return spamPubkeys.has(pubkey);
}

export function isSpamEvent(eventId: string): boolean {
  return spamEventIds.has(eventId);
}

const MUTE_STORAGE_KEY = "relay-outpost-muted-pubkeys";
const MUTE_KEYWORDS_KEY = "relay-outpost-muted-keywords";

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveSet(key: string, set: Set<string>) {
  // Guarded: iOS Safari private mode / quota states make setItem THROW —
  // an unguarded throw here would crash mutePubkey itself and silently
  // break muting. The in-memory set still applies for the session.
  try { localStorage.setItem(key, JSON.stringify(Array.from(set))); } catch {}
}

let mutedPubkeys = loadSet(MUTE_STORAGE_KEY);
let mutedKeywords = loadSet(MUTE_KEYWORDS_KEY);

const muteListeners: Array<() => void> = [];

export function onMuteChange(cb: () => void) {
  muteListeners.push(cb);
  return () => {
    const idx = muteListeners.indexOf(cb);
    if (idx >= 0) muteListeners.splice(idx, 1);
  };
}

function notifyMuteListeners() {
  muteListeners.forEach((cb) => cb());
}

export function mutePubkey(pubkey: string) {
  mutedPubkeys.add(pubkey);
  saveSet(MUTE_STORAGE_KEY, mutedPubkeys);
  notifyMuteListeners();
}

export function unmutePubkey(pubkey: string) {
  mutedPubkeys.delete(pubkey);
  saveSet(MUTE_STORAGE_KEY, mutedPubkeys);
  notifyMuteListeners();
}

export function isMutedPubkey(pubkey: string): boolean {
  return mutedPubkeys.has(pubkey);
}

export function getMutedPubkeys(): string[] {
  return Array.from(mutedPubkeys);
}

export function addMutedKeyword(keyword: string) {
  mutedKeywords.add(keyword.toLowerCase().trim());
  saveSet(MUTE_KEYWORDS_KEY, mutedKeywords);
  notifyMuteListeners();
}

export function removeMutedKeyword(keyword: string) {
  mutedKeywords.delete(keyword.toLowerCase().trim());
  saveSet(MUTE_KEYWORDS_KEY, mutedKeywords);
  notifyMuteListeners();
}

export function getMutedKeywords(): string[] {
  return Array.from(mutedKeywords);
}

function matchesMutedKeyword(content: string): boolean {
  if (mutedKeywords.size === 0) return false;
  const lower = content.toLowerCase();
  const keywords = Array.from(mutedKeywords);
  for (let i = 0; i < keywords.length; i++) {
    if (lower.includes(keywords[i])) return true;
  }
  return false;
}

export type WotLevel = "follow" | "follow-of-follow" | "unknown";

export function getWotLevel(
  pubkey: string,
  follows: Set<string>,
  followsOfFollows: Set<string>
): WotLevel {
  if (follows.has(pubkey)) return "follow";
  if (followsOfFollows.has(pubkey)) return "follow-of-follow";
  return "unknown";
}

// ---- Cross-author duplicate suppression (spam-wave signature) ----
// A coordinated wave posts near-identical scam text from MANY freshly created
// pubkeys, so the existing same-author dup rule (isDuplicateContent below)
// never fires. The wave's tell is the opposite axis: the SAME normalized body
// from several DISTINCT unfollowed authors. When >= CROSS_DUP_MIN_AUTHORS
// unfollowed authors share a body in the candidate buffer, every copy drops.
const CROSS_DUP_MIN_AUTHORS = 3;
// Bodies shorter than this are common phrases ("gm", "hello nostr", "good
// morning everyone!") that many humans legitimately post — never wave-match them.
const CROSS_DUP_MIN_LENGTH = 24;
// Repost kinds carry the reposted event (often its full JSON) as content, so
// many people reposting one note look exactly like a wave — exempt them.
const REPOST_KINDS = new Set([6, 16]);

/**
 * Normalize a note body for cross-author matching: lowercase, strip URLs and
 * nostr: mentions (waves rotate link shorteners/mention targets per copy),
 * strip emoji, collapse whitespace. Exported for tests.
 */
export function normalizeForCrossDup(content: string): string {
  if (!content) return "";
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/nostr:[a-z0-9]+/gi, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One pass over the candidate buffer → the set of normalized bodies that are
 * wave signatures (same body from >= CROSS_DUP_MIN_AUTHORS distinct unfollowed
 * authors). Followed authors neither count toward the threshold nor get
 * dropped by it. Exported for tests.
 */
export function buildCrossAuthorWaveSet(
  events: Event[],
  follows?: Set<string>
): Set<string> {
  const authorsByBody = new Map<string, Set<string>>();
  for (const e of events) {
    if (REPOST_KINDS.has(e.kind)) continue;
    if (follows && follows.has(e.pubkey)) continue;
    const body = normalizeForCrossDup(e.content);
    if (body.length < CROSS_DUP_MIN_LENGTH) continue;
    let authors = authorsByBody.get(body);
    if (!authors) {
      authors = new Set();
      authorsByBody.set(body, authors);
    }
    authors.add(e.pubkey);
  }
  const waves = new Set<string>();
  authorsByBody.forEach((authors, body) => {
    if (authors.size >= CROSS_DUP_MIN_AUTHORS) waves.add(body);
  });
  return waves;
}

export function isDuplicateContent(event: Event, allEvents: Event[]): boolean {
  const now = event.created_at;
  let count = 0;
  for (const other of allEvents) {
    if (other.id === event.id) continue;
    if (other.pubkey !== event.pubkey) continue;
    if (Math.abs(other.created_at - now) > DUPLICATE_WINDOW) continue;
    if (other.content === event.content && other.content.length > 10) {
      count++;
      if (count >= DUPLICATE_THRESHOLD) return true;
    }
  }
  return false;
}

export function isNonLatinContent(content: string): boolean {
  if (!content || content.length < 10) return false;

  const stripped = content
    .replace(/https?:\/\/\S+/g, "")
    .replace(/nostr:[a-z0-9]+/gi, "")
    .replace(/#\w+/g, "")
    .replace(/@\w+/g, "")
    .replace(/[\s\d.,;:!?'"()\[\]{}<>@#$%^&*+=\-_/\\|~`]/g, "")
    .trim();

  if (stripped.length < 5) return false;

  const latinChars = (stripped.match(/[\u0000-\u024F\u1E00-\u1EFF]/g) || []).length;
  const ratio = latinChars / stripped.length;

  return ratio < 0.5;
}

export function isMachineReadableContent(content: string): boolean {
  if (!content || content.length < 20) return false;

  if (/^\s*[\[{]/.test(content)) {
    try {
      JSON.parse(content);
      return true;
    } catch {}
  }

  if (/\[broadcast:\[?#?\d+\]\]/.test(content)) return true;
  if (/\{"route"\s*:/.test(content)) return true;
  if (/\{"type"\s*:\s*"(ar_collaboration|profile_card|broadcast)"/i.test(content)) return true;

  const alphaNumRun = content.match(/[A-Za-z0-9+/=]{100,}/);
  if (alphaNumRun) {
    const ratio = alphaNumRun[0].length / content.length;
    if (ratio > 0.5) return true;
  }

  const nonPrintable = (content.match(/[^\x20-\x7E\n\r\t\u00A0-\uFFFF]/g) || []).length;
  if (nonPrintable / content.length > 0.1 && content.length > 50) return true;

  return false;
}

export function hasProfileMetadata(pubkey: string, profileGetter?: (pk: string) => any): boolean | null {
  if (!profileGetter) return true;
  const profile = profileGetter(pubkey);
  if (!profile) return null;
  const name = profile.name || profile.display_name || profile.displayName || "";
  return name.trim().length > 0;
}

/**
 * Classify where kind-0 resolution stands for an author (the input to the
 * three-state stranger gate — see gateStrangerProfile in discover-quality.ts):
 *  - a kind-0 with a real name        → "named"
 *  - a kind-0 with an empty name      → "unnamed" (resolved: profile-less)
 *  - no kind-0, fetch settled         → "unnamed" (resolved: no profile, period)
 *  - no kind-0, fetch still in flight → "unknown" (grace — never drop a loader)
 * Callers that pass no profileGetter fail open ("named"), preserving the
 * legacy no-op behavior for surfaces that don't use the profile floor.
 */
export function classifyProfileResolution(
  pubkey: string,
  profileGetter?: (pk: string) => any,
  profileSettledGetter?: (pk: string) => boolean,
): ProfileResolution {
  const has = hasProfileMetadata(pubkey, profileGetter);
  if (has === true) return "named";
  if (has === false) return "unnamed";
  return profileSettledGetter && profileSettledGetter(pubkey) ? "unnamed" : "unknown";
}

const MIN_FOLLOWERS_GLOBAL = 20;

const BOT_KEYWORDS = [
  /\bbot\b/i,
  /\bautomated\b/i,
  /\bmirror\s*bot\b/i,
  /\bbridge\s*bot\b/i,
  /\bfeed\s*bot\b/i,
  /\brelay\s*bot\b/i,
  /\bnostr\s*bot\b/i,
  /\bremover\s*bot\b/i,
  /\bautopost/i,
];

export function isBotProfile(profile: any): boolean {
  if (!profile) return false;
  const name = (profile.display_name || profile.displayName || profile.name || "").toLowerCase();
  const about = (profile.about || "").toLowerCase();
  const combined = `${name} ${about}`;
  return BOT_KEYWORDS.some((re) => re.test(combined));
}

export type ReachDepth = "1hop" | "2hops" | "3hops" | "global" | "off";

// GrapeRank influence cutoffs for the trust reach slider on the raw signal feed.
// These thresholds only filter NON-follow, NON-FoF authors — your follows and
// follows-of-follows always pass regardless of the chosen tier (see filterSpamEvents
// below). Spread the cutoffs wide so each tier visibly removes a slice of distant
// accounts, otherwise all four tiers collapse to the same set:
//   1hop   (Inner Circle): 0.50 — only highly-trusted strangers (matches "strong" SignalTier)
//   2hops  (Nearby):       0.10 — moderately trusted (between "low" 0.07 and "moderate" 0.20)
//   3hops  (Extended):     0.02 — minimal trust ("weak" SignalTier)
//   global (Everyone):     0    — anyone with positive influence
//   off:                   null — no GrapeRank gate at all
// Originally the four non-off tiers were 0.20 / 0.07 / 0.02 / 0, which matched the
// "moderate / low / weak / any" SignalTier dot thresholds. In practice that put
// 1hop/2hops/3hops/global all within the same dense band of GrapeRank scores, so
// the slider triggered the "All tiers contain the same accounts" hint by default.
// Restored to the original feature spec (0.5 / 0.1 / 0.02 / >0) to give each step
// real separation while preserving the safety net that follows + FoF always show.
export const REACH_DEPTH_THRESHOLDS: Record<ReachDepth, number | null> = {
  "1hop": 0.50,
  "2hops": 0.10,
  "3hops": 0.02,
  global: 0,
  off: null,
};

export interface SpamFilterOptions {
  follows?: Set<string>;
  followsOfFollows?: Set<string>;
  reachDepth?: ReachDepth;
  grapeRankScores?: Map<string, number> | null;
  allEvents?: Event[];
  hideMachineReadable?: boolean;
  hideNoProfile?: boolean;
  hideBots?: boolean;
  profileGetter?: (pubkey: string) => any;
  /**
   * Has the kind-0 fetch for this pubkey COMPLETED (EOSE / timeout)? Feeds the
   * three-state profile gate: settled + still no profile = "unnamed" (drop),
   * not settled = "unknown" (grace — hold, never exclude a slow loader).
   * Without this getter, no-kind-0 authors stay in the grace state.
   */
  profileSettledGetter?: (pubkey: string) => boolean;
  minFollowers?: number;
  followerCountGetter?: (pubkey: string) => number | undefined;
  /** Discover "safe floor" — only keep events whose kind renders cleanly. */
  readableKinds?: Set<number>;
  /** Injected language gate (keeps this module free of the lang-ID dep). When
   *  provided it supersedes the crude non-Latin heuristic for unfollowed authors. */
  languageAllowed?: (event: Event) => boolean;
  /** Flagged-account pubkeys to hide (safety floor) for unfollowed authors. */
  flaggedPubkeys?: Set<string>;
  /**
   * Cross-author duplicate suppression (global/For You feed only): drop every
   * copy when the same normalized body appears from >= 3 distinct unfollowed
   * authors in `allEvents` — the signature of a coordinated spam wave.
   */
  crossAuthorDedupe?: boolean;
  /**
   * New-account combo gate (global/For You feed only): drop an unfollowed
   * author's events when ALL of (unscored, first-seen < 48h, followers < 20)
   * hold. See the gate in filterSpamEvents for the full rationale.
   */
  newAccountComboGate?: boolean;
  /** Trust score lookup (GrapeRank influence). undefined = unscored. */
  scoreGetter?: (pubkey: string) => number | undefined;
  /** Earliest-evidence lookup (unix seconds), null = unknown → fail open. */
  firstSeenGetter?: (pubkey: string) => number | null;
  /**
   * Per-event engagement score (computeEngagementScore). When provided, the
   * combo gate treats real engagement as an earned signal AND tightens the
   * unknown-age seam: a stranger with no score, no engagement and no
   * established age/followers is gated even when age is UNKNOWN (the broadened
   * global pool surfaces many undatable strangers). Without this getter the
   * gate keeps its conservative known-new-only behavior.
   */
  engagementScoreGetter?: (event: Event) => number;
  /** Injected clock (unix seconds) for the combo gate — testability. */
  nowSeconds?: number;
}

// New-account combo gate thresholds. An account younger than the window with
// no trust score and (almost) no followers is indistinguishable from a wave
// bot; any ONE earned signal breaks the gate.
const NEW_ACCOUNT_WINDOW_SECONDS = 48 * 60 * 60;
const COMBO_MIN_FOLLOWERS = 20;

export function filterSpamEvents(
  events: Event[],
  options: SpamFilterOptions = {}
): Event[] {
  const {
    follows,
    followsOfFollows,
    reachDepth = "off",
    grapeRankScores,
    allEvents,
    hideMachineReadable = false,
    hideNoProfile = false,
    hideBots = true,
    profileGetter,
    profileSettledGetter,
    minFollowers = 0,
    followerCountGetter,
    readableKinds,
    languageAllowed,
    flaggedPubkeys,
    crossAuthorDedupe = false,
    newAccountComboGate = false,
    scoreGetter,
    firstSeenGetter,
    engagementScoreGetter,
    nowSeconds,
  } = options;

  // One pass over the buffer up front, not per event — the wave signature is a
  // property of the whole candidate window.
  const waveBodies =
    crossAuthorDedupe && allEvents && allEvents.length > 0
      ? buildCrossAuthorWaveSet(allEvents, follows)
      : null;
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);

  return events.filter((event) => {
    // Discover safe floor: unreadable kinds are noise regardless of author.
    if (readableKinds && !readableKinds.has(event.kind)) return false;

    if (isSpamPubkey(event.pubkey)) return false;
    if (isSpamEvent(event.id)) return false;

    if (isMutedPubkey(event.pubkey)) return false;

    if (isReportedEvent(event.id) || isReportedPubkey(event.pubkey)) return false;

    if (matchesMutedKeyword(event.content)) return false;

    const isFollowed = follows && follows.has(event.pubkey);

    if (!isFollowed && flaggedPubkeys && flaggedPubkeys.has(event.pubkey)) return false;

    if (!isFollowed && hideBots && profileGetter) {
      const profile = profileGetter(event.pubkey);
      if (isBotProfile(profile)) return false;
    }

    if (!isFollowed && hideMachineReadable && isMachineReadableContent(event.content)) return false;

    // Language gate: an injected detector (real per-language preference) supersedes
    // the crude non-Latin heuristic. Followed authors are never language-filtered.
    if (!isFollowed) {
      if (languageAllowed) {
        if (!languageAllowed(event)) return false;
      } else if (isNonLatinContent(event.content)) {
        return false;
      }
    }

    if (!isFollowed && hideNoProfile) {
      // Three-state profile gate (gateStrangerProfile):
      //  - "named"   → admit.
      //  - "unknown" → GRACE: hold out of the visible feed rather than flash a
      //    raw-npub author card. Profiles for feed authors are batch-prefetched
      //    and a kind-0 arrival re-runs the filter (see Home's profileVersion),
      //    so slow-loading legit authors surface promptly — they are held, not
      //    excluded.
      //  - "unnamed" → DROP: resolution COMPLETED (kind-0 with an empty name,
      //    or the fetch settled with no kind-0 at all) — the profile-less spam
      //    account. profileSettledGetter is what tells "no profile YET" apart
      //    from "no profile, period".
      // Followed authors always pass (isFollowed guard above); positive-WoT
      // authors are admitted whatever their profile state (in-network by
      // trust); callers that pass no profileGetter are unaffected ("named").
      const decision = gateStrangerProfile({
        isInNetwork: false,
        wotScore: scoreGetter ? scoreGetter(event.pubkey) : undefined,
        resolution: classifyProfileResolution(event.pubkey, profileGetter, profileSettledGetter),
      });
      if (decision !== "admit") return false;
    }

    if (!isFollowed && minFollowers > 0 && followerCountGetter) {
      const count = followerCountGetter(event.pubkey);
      if (count !== undefined && count < minFollowers) return false;
    }

    // Cross-author duplicate suppression: this event's body matches a wave
    // signature (same normalized text from >= 3 distinct unfollowed authors in
    // the buffer) → drop it. Reposts and short common phrases never match
    // (see buildCrossAuthorWaveSet); followed authors are exempt.
    if (!isFollowed && waveBodies && waveBodies.size > 0 && !REPOST_KINDS.has(event.kind)) {
      const body = normalizeForCrossDup(event.content);
      if (body.length >= CROSS_DUP_MIN_LENGTH && waveBodies.has(body)) return false;
    }

    // New-account combo gate: freshly minted impersonation bots arrive with a
    // complete profile (so hideNoProfile passes) and an undefined follower
    // count (so the standalone minFollowers rule fails open). Drop only when
    // ALL THREE hold — no trust score AND first-seen < 48h AND followers < 20
    // (undefined counts as low *within the combo*). One follow (isFollowed
    // exemption above), a score, or 48 hours breaks the gate — a genuine new
    // user earns distribution through any one of those, while a wave bot has
    // none of them. Unknown age (null) fails OPEN: an account we can't date
    // is not treated as new.
    if (!isFollowed && newAccountComboGate) {
      const score = scoreGetter ? scoreGetter(event.pubkey) : undefined;
      const unscored = score === undefined || score <= 0;
      const firstSeen = firstSeenGetter ? firstSeenGetter(event.pubkey) : null;
      const establishedByAge = firstSeen !== null && now - firstSeen >= NEW_ACCOUNT_WINDOW_SECONDS;
      const followers = followerCountGetter ? followerCountGetter(event.pubkey) : undefined;
      const lowFollowers = followers === undefined || followers < COMBO_MIN_FOLLOWERS;
      const engagement = engagementScoreGetter ? engagementScoreGetter(event) : undefined;
      const hasEngagement = engagement !== undefined && engagement > 0;

      // No earned signal on ANY axis: unscored, no engagement, not established
      // by age, and low/unknown followers. Any one of a score, real engagement,
      // an established age, or enough followers breaks the gate (isFollowed is
      // exempted above).
      const noEarnedSignal = unscored && !hasEngagement && !establishedByAge && lowFollowers;
      if (noEarnedSignal) {
        if (engagementScoreGetter) {
          // Broadened-pool seam: with an engagement signal available we can
          // safely gate undatable strangers too — an account we can vouch for
          // on no axis is exactly the wave-bot profile. Fail-open is preserved
          // by the earned-signal checks above.
          return false;
        }
        // Legacy behavior (no engagement getter): only drop when we positively
        // KNOW the account is new, so undatable accounts still fail open.
        const isNew = firstSeen !== null && now - firstSeen < NEW_ACCOUNT_WINDOW_SECONDS;
        if (isNew) return false;
      }
    }

    if (reachDepth !== "off" && follows) {
      const inHop1 = follows.has(event.pubkey);
      if (!inHop1) {
        if (reachDepth === "1hop") return false;
        const fof = followsOfFollows;
        const inHop2 = fof ? fof.has(event.pubkey) : false;
        if (!inHop2) {
          if (reachDepth === "2hops") return false;
          const score = grapeRankScores?.get(event.pubkey);
          if (reachDepth === "3hops") {
            if (score === undefined) return false;
          } else if (reachDepth === "global") {
            if (score === undefined || score <= 0) return false;
          }
        }
      }
    }

    if (allEvents && allEvents.length > 0 && isDuplicateContent(event, allEvents)) {
      return false;
    }

    return true;
  });
}

export { MIN_FOLLOWERS_GLOBAL };

export function getSpamStats() {
  return {
    spamPubkeys: spamPubkeys.size,
    spamEventIds: spamEventIds.size,
    mutedPubkeys: mutedPubkeys.size,
    mutedKeywords: mutedKeywords.size,
    lastFetched,
  };
}

const REPORTED_STORAGE_KEY = "relay-outpost-reported-events";

export interface ReportedItem {
  eventId: string;
  pubkey: string;
  reason: string;
  reportedAt: number;
}

function loadReportedItems(): ReportedItem[] {
  try {
    const raw = localStorage.getItem(REPORTED_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveReportedItems(items: ReportedItem[]) {
  try {
  localStorage.setItem(REPORTED_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

let reportedItems = loadReportedItems();
let reportedEventIds = new Set(reportedItems.map((r) => r.eventId));
let reportedPubkeys = new Set(reportedItems.map((r) => r.pubkey));

function rebuildReportedSets() {
  reportedEventIds = new Set(reportedItems.map((r) => r.eventId));
  reportedPubkeys = new Set(reportedItems.map((r) => r.pubkey));
}

export function addReportedItem(item: ReportedItem) {
  if (reportedEventIds.has(item.eventId)) return;
  reportedItems = [...reportedItems, item];
  saveReportedItems(reportedItems);
  rebuildReportedSets();
  notifyMuteListeners();
}

export function removeReportedItem(eventId: string) {
  reportedItems = reportedItems.filter((r) => r.eventId !== eventId);
  saveReportedItems(reportedItems);
  rebuildReportedSets();
  notifyMuteListeners();
}

export function getReportedItems(): ReportedItem[] {
  return [...reportedItems];
}

export function isReportedEvent(eventId: string): boolean {
  return reportedEventIds.has(eventId);
}

export function isReportedPubkey(pubkey: string): boolean {
  return reportedPubkeys.has(pubkey);
}
