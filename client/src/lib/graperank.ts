import type { EventTemplate, NostrEvent } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { withSignerTimeout, signWithTimeout, SIGNER_SIGN_TIMEOUT, SignerTimeoutError } from "@/lib/signer-timeout";
import { getGlobalSigner } from "@/lib/nip42-auth";

const BRAINSTORM_API = "/api/graperank";
const NIP85_RELAY = "wss://nip85.nosfabrica.com";
const NIP85_PROVIDER = "5d06ceb1e92db19b2c250b15743527f6baad171042d79f7b6e2764e093133121";
const KIND_NIP85 = 30382;

const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE = 500;
const LS_SCORES_KEY = "graperank_scores_cache";
const LS_SCORES_TTL = 30 * 60 * 1000;

export interface UserConnection {
  pubkey: string;
  influence: number | null;
  trusted_reporters: number | null;
  /**
   * The accounts that reported THIS connection, each with their own influence.
   * The graph payload carries this per-connection but we historically collapsed
   * it to the `trusted_reporters` count — kept here so the Follow-list-health
   * verdict can weigh reporters by how trusted they are (not just count them).
   */
  reported_by?: UserConnection[];
}

export interface UserGraphData {
  followed_by: UserConnection[];
  following: UserConnection[];
  muted_by: UserConnection[];
  muting: UserConnection[];
  reported_by: UserConnection[];
  reporting: UserConnection[];
  influence: number | null;
}

export interface GrapeRankScore {
  influence: number | null;
  trustedReporters: number | null;
  followedByCount: number;
  followingCount: number;
  mutedByCount: number;
  relationship: "mutual" | "follows-you" | "you-follow" | "muted" | "none";
  lastCalculated: string | null;
}

export type SignalTier = "strong" | "moderate" | "low" | "weak" | "flagged" | "none";

export interface TierThresholds {
  strong: number;
  moderate: number;
  low: number;
  weak: number;
}

export const DEFAULT_THRESHOLDS: TierThresholds = {
  strong: 0.50,
  moderate: 0.20,
  low: 0.07,
  weak: 0.02,
};

const LS_CUSTOM_THRESHOLDS_KEY = "relay-outpost-custom-tier-thresholds";
const LS_CUSTOM_THRESHOLDS_ENABLED_KEY = "relay-outpost-custom-tiers-enabled";

let cachedThresholds: TierThresholds | null = null;
let cachedEnabled: boolean | null = null;

export function isCustomTiersEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    cachedEnabled = localStorage.getItem(LS_CUSTOM_THRESHOLDS_ENABLED_KEY) === "true";
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

export function setCustomTiersEnabled(enabled: boolean) {
  cachedEnabled = enabled;
  try {
    localStorage.setItem(LS_CUSTOM_THRESHOLDS_ENABLED_KEY, enabled ? "true" : "false");
  } catch {}
}

function normalizeThresholds(t: TierThresholds): TierThresholds {
  const clamp = (v: number) => Math.round(Math.max(0.01, Math.min(0.99, v)) * 100) / 100;
  let weak = clamp(t.weak);
  let low = clamp(t.low);
  let moderate = clamp(t.moderate);
  let strong = clamp(t.strong);
  if (low <= weak) low = Math.min(weak + 0.01, 0.99);
  if (moderate <= low) moderate = Math.min(low + 0.01, 0.99);
  if (strong <= moderate) strong = Math.min(moderate + 0.01, 0.99);
  return { strong: clamp(strong), moderate: clamp(moderate), low: clamp(low), weak: clamp(weak) };
}

export function getStoredCustomThresholds(): TierThresholds {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_THRESHOLDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.strong === "number" && typeof parsed.moderate === "number" && typeof parsed.low === "number" && typeof parsed.weak === "number") {
        return normalizeThresholds(parsed as TierThresholds);
      }
    }
  } catch {}
  return { ...DEFAULT_THRESHOLDS };
}

export function getCustomThresholds(): TierThresholds {
  if (!isCustomTiersEnabled()) return DEFAULT_THRESHOLDS;
  if (cachedThresholds) return cachedThresholds;
  const stored = getStoredCustomThresholds();
  cachedThresholds = stored;
  return cachedThresholds;
}

export function saveCustomThresholds(thresholds: TierThresholds) {
  const normalized = normalizeThresholds(thresholds);
  cachedThresholds = normalized;
  try {
    localStorage.setItem(LS_CUSTOM_THRESHOLDS_KEY, JSON.stringify(normalized));
  } catch {}
  return normalized;
}

export function resetCustomThresholds() {
  cachedThresholds = null;
  cachedEnabled = false;
  try {
    localStorage.removeItem(LS_CUSTOM_THRESHOLDS_KEY);
    localStorage.setItem(LS_CUSTOM_THRESHOLDS_ENABLED_KEY, "false");
  } catch {}
}

export function getActiveThresholds(): TierThresholds {
  return isCustomTiersEnabled() ? getCustomThresholds() : DEFAULT_THRESHOLDS;
}

export function getSignalTier(influence: number | null): SignalTier {
  if (influence === null || influence === undefined || influence < 0) return "none";
  const t = getActiveThresholds();
  if (influence >= t.strong) return "strong";
  if (influence >= t.moderate) return "moderate";
  if (influence >= t.low) return "low";
  if (influence >= t.weak) return "weak";
  return "none";
}

// Display tier for reply-thread trust analysis. Splits the catch-all "none" into
// two very different cases so we never punish content for missing data:
//   • "unverified" — Brainstorm HAS a score and it's genuinely low (≤ weak floor)
//   • "unknown"    — no trust data at all (not in Brainstorm yet / still loading),
//                    i.e. influence is null. These get the benefit of the doubt.
// `influence` should be getAuthorInfluence(pk) (null for both unfetched and the
// negative "no data" marker). Used by the thread trust bar + thread filtering.
export type ReplyTier = SignalTier | "unverified" | "unknown";
export function getReplyTier(influence: number | null, flagged: boolean): ReplyTier {
  if (flagged) return "flagged";
  if (influence === null || influence === undefined) return "unknown";
  const t = getSignalTier(influence);
  return t === "none" ? "unverified" : t;
}

export function getSignalTierLabel(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "Highly Trusted";
    case "moderate": return "Trusted";
    case "low": return "Neutral";
    case "weak": return "Low Trust";
    case "flagged": return "Flagged";
    case "none": return "Unverified";
  }
}

// Short labels for tight spaces (e.g. the mobile feed filter bar, where the full
// labels wrap to two lines). The full label stays available as a tooltip.
export function getSignalTierShortLabel(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "High";
    case "moderate": return "Trusted";
    case "low": return "Neutral";
    case "weak": return "Low";
    case "flagged": return "Flagged";
    case "none": return "Unknown";
  }
}

export function getSignalTierRange(tier: SignalTier): string {
  const t = getActiveThresholds();
  const fmt = (v: number) => `${Math.round(v * 100)}%`;
  switch (tier) {
    case "strong": return `${fmt(t.strong)} – 100%`;
    case "moderate": return `${fmt(t.moderate)} – ${fmt(t.strong - 0.01)}`;
    case "low": return `${fmt(t.low)} – ${fmt(t.moderate - 0.01)}`;
    case "weak": return `${fmt(t.weak)} – ${fmt(t.low - 0.01)}`;
    case "flagged": return "Flagged";
    case "none": return `< ${fmt(t.weak)}`;
  }
}

export function getSignalTierColor(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "text-emerald-700 dark:text-emerald-400";
    case "moderate": return "text-blue-700 dark:text-blue-400";
    case "low": return "text-cyan-700 dark:text-cyan-400";
    case "weak": return "text-amber-700 dark:text-amber-400";
    case "flagged": return "text-red-600 dark:text-red-400";
    case "none": return "text-foreground/50 dark:text-foreground/40";
  }
}

export function getSignalTierBg(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "bg-emerald-100 dark:bg-emerald-500/15 border-emerald-300/60 dark:border-emerald-500/30";
    case "moderate": return "bg-blue-100 dark:bg-blue-500/15 border-blue-300/60 dark:border-blue-500/30";
    case "low": return "bg-cyan-100 dark:bg-cyan-500/15 border-cyan-300/60 dark:border-cyan-500/30";
    case "weak": return "bg-amber-100 dark:bg-amber-500/15 border-amber-300/60 dark:border-amber-500/30";
    case "flagged": return "bg-red-100 dark:bg-red-500/15 border-red-300/60 dark:border-red-500/30";
    case "none": return "bg-gray-100 dark:bg-muted/30 border-gray-300/40 dark:border-border/30";
  }
}

export function getSignalTierRingColor(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "ring-emerald-500/60 dark:ring-emerald-400/50";
    case "moderate": return "ring-blue-500/60 dark:ring-blue-400/50";
    case "low": return "ring-cyan-500/50 dark:ring-cyan-400/40";
    case "weak": return "ring-amber-500/50 dark:ring-amber-400/40";
    case "flagged": return "ring-red-500/50 dark:ring-red-400/40";
    case "none": return "ring-border";
  }
}

export function getSignalTierDotColor(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "bg-emerald-500 dark:bg-emerald-400 ring-emerald-500/30";
    case "moderate": return "bg-blue-500 dark:bg-blue-400 ring-blue-500/30";
    case "low": return "bg-cyan-500 dark:bg-cyan-400 ring-cyan-500/30";
    case "weak": return "bg-amber-500 dark:bg-amber-400 ring-amber-500/30";
    case "flagged": return "bg-red-500 dark:bg-red-400 ring-red-500/30";
    case "none": return "bg-gray-400/50 dark:bg-gray-500/50 ring-gray-400/20";
  }
}

export function formatInfluence(influence: number | null): string {
  if (influence === null || influence === undefined) return "—";
  return `${Math.round(influence * 100)}%`;
}

let authToken: string | null = null;
let authPubkey: string | null = null;
let authPromise: { pubkey: string; promise: Promise<boolean> } | null = null;

let _authLastSuccessAt = 0;
let _authLastFailAt = 0;
let _authLastFailReason = "";
let _connLastSuccessAt = 0;
let _connLastFailAt = 0;
let _connLastError = "";

export type BrainstormAuthEvent =
  | { type: "success"; pubkey: string; at: number }
  | { type: "failure"; pubkey: string; at: number; reason: string };

const _authListeners = new Set<(e: BrainstormAuthEvent) => void>();

export function onBrainstormAuthEvent(cb: (e: BrainstormAuthEvent) => void): () => void {
  _authListeners.add(cb);
  return () => { _authListeners.delete(cb); };
}

function emitAuthEvent(e: BrainstormAuthEvent) {
  _authListeners.forEach((cb) => { try { cb(e); } catch {} });
}

export function getBrainstormAuthStatus() {
  return {
    authenticated: !!authToken,
    pubkey: authPubkey,
    lastSuccessAt: _authLastSuccessAt,
    lastFailAt: _authLastFailAt,
    lastFailReason: _authLastFailReason,
  };
}

export function getConnectionFetchStatus() {
  return {
    lastSuccessAt: _connLastSuccessAt,
    lastFailAt: _connLastFailAt,
    lastError: _connLastError,
  };
}

export function clearBrainstormAuth() {
  authToken = null;
  authPubkey = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

const SESSION_KEY = "graperank_auth";

function loadSessionAuth(): boolean {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    if (parsed?.token && parsed?.pubkey) {
      authToken = parsed.token;
      authPubkey = parsed.pubkey;
      return true;
    }
  } catch {}
  return false;
}

function saveSessionAuth() {
  try {
    if (authToken && authPubkey) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: authToken, pubkey: authPubkey }));
    }
  } catch {}
}

function clearAuth() {
  authToken = null;
  authPubkey = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

loadSessionAuth();

interface CacheEntry {
  data: GrapeRankScore;
  timestamp: number;
}

const scoreCache = new Map<string, CacheEntry>();

function evictOldest() {
  if (scoreCache.size <= MAX_CACHE) return;
  let oldest: string | null = null;
  let oldestTime = Infinity;
  scoreCache.forEach((entry, key) => {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldest = key;
    }
  });
  if (oldest) scoreCache.delete(oldest);
}

function cacheKey(targetPubkey: string, observerPubkey: string | null): string {
  return `${observerPubkey || "public"}:${targetPubkey}`;
}

function getCached(targetPubkey: string, observerPubkey: string | null): GrapeRankScore | null {
  const key = cacheKey(targetPubkey, observerPubkey);
  const entry = scoreCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    scoreCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(targetPubkey: string, observerPubkey: string | null, data: GrapeRankScore) {
  const key = cacheKey(targetPubkey, observerPubkey);
  scoreCache.set(key, { data, timestamp: Date.now() });
  evictOldest();
}

function lsKey(observerPubkey: string) {
  return `${LS_SCORES_KEY}:${observerPubkey.slice(0, 8)}`;
}

function loadLsScores(observerPubkey: string): Map<string, number> {
  try {
    const raw = localStorage.getItem(lsKey(observerPubkey));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== "number" || Date.now() - parsed.ts > LS_SCORES_TTL) {
      localStorage.removeItem(lsKey(observerPubkey));
      return new Map();
    }
    if (parsed.d && typeof parsed.d === "object") {
      return new Map(Object.entries(parsed.d) as [string, number][]);
    }
  } catch {}
  return new Map();
}

function saveLsScores(observerPubkey: string, scores: Map<string, number>) {
  try {
    const obj: Record<string, number> = {};
    let count = 0;
    for (const [k, v] of scores) {
      if (v < 0) continue;
      obj[k] = v;
      count++;
      if (count >= 2000) break;
    }
    localStorage.setItem(lsKey(observerPubkey), JSON.stringify({ ts: Date.now(), d: obj }));
  } catch {}
}

function clearLsScores(observerPubkey: string) {
  try {
    localStorage.removeItem(lsKey(observerPubkey));
  } catch {}
}

export { loadLsScores, saveLsScores, clearLsScores };

export async function fetchNip85ScoresBulk(pubkeys: string[]): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  if (pubkeys.length === 0) return results;

  const MAX_BATCH = 50;
  const batches: string[][] = [];
  for (let i = 0; i < pubkeys.length; i += MAX_BATCH) {
    batches.push(pubkeys.slice(i, i + MAX_BATCH));
  }

  for (const batch of batches) {
    try {
      const events = await Promise.race([
        pool.querySync([NIP85_RELAY], {
          kinds: [KIND_NIP85],
          authors: [NIP85_PROVIDER],
          "#d": batch,
          limit: batch.length * 3,
        }),
        new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 5000)),
      ]);

      if (!events || events.length === 0) continue;

      const byPubkey = new Map<string, typeof events>();
      for (const ev of events) {
        const dTag = ev.tags.find((t: string[]) => t[0] === "d");
        if (!dTag || !dTag[1]) continue;
        const pk = dTag[1];
        if (!byPubkey.has(pk)) byPubkey.set(pk, []);
        byPubkey.get(pk)!.push(ev);
      }

      for (const [pk, pkEvents] of byPubkey) {
        let bestEvent: typeof events[0] | null = null;
        for (const ev of pkEvents) {
          const metric = getEventMetricType(ev);
          if (metric === "rank" || metric === "graperank" || metric === "influence") {
            if (!bestEvent || ev.created_at > bestEvent.created_at) bestEvent = ev;
          }
        }
        if (!bestEvent) {
          for (const ev of pkEvents) {
            if (!bestEvent || ev.created_at > bestEvent.created_at) bestEvent = ev;
          }
        }
        if (bestEvent) {
          const contentData = parseNip85Content(bestEvent);
          if (contentData) {
            const influence = extractNip85Influence(contentData);
            if (influence !== null) {
              results.set(pk, influence);
            }
          }
        }
      }
    } catch (err) {
      console.warn("[GrapeRank] NIP-85 bulk fetch error:", err);
    }
  }

  console.log(`[GrapeRank] NIP-85 bulk: ${pubkeys.length} requested, ${results.size} returned`);
  return results;
}

const inflightRequests = new Map<string, Promise<GrapeRankScore | null>>();

async function doAuthenticate(observerPubkey: string): Promise<boolean> {
  const failAndEmit = (reason: string): false => {
    _authLastFailAt = Date.now();
    _authLastFailReason = reason;
    emitAuthEvent({ type: "failure", pubkey: observerPubkey, at: _authLastFailAt, reason });
    return false;
  };
  try {
    console.log("[GrapeRank] Auth: requesting challenge for", observerPubkey.slice(0, 8));
    const challengeRes = await fetch(`${BRAINSTORM_API}/authChallenge/${observerPubkey}`);
    if (!challengeRes.ok) {
      console.log("[GrapeRank] Auth: challenge request failed:", challengeRes.status);
      return failAndEmit(`Challenge request failed (${challengeRes.status})`);
    }
    const challengeData = await challengeRes.json();
    const challenge = challengeData?.data?.challenge;
    if (!challenge) {
      console.log("[GrapeRank] Auth: no challenge in response:", JSON.stringify(challengeData));
      return failAndEmit("No challenge returned by Brainstorm");
    }
    console.log("[GrapeRank] Auth: got challenge", challenge.slice(0, 8) + "...");

    // Prefer the app's active signer (extension, local nsec, remote bunker).
    // Only fall back to window.nostr when no app signer is registered, so we
    // never prompt the wrong signer when a user is logged in via nsec on a
    // device that also happens to have an extension installed.
    const appSigner = getGlobalSigner();
    const eventTemplate: EventTemplate = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["t", "brainstorm_login"],
        ["challenge", challenge],
      ],
      content: "",
    };

    let signedEvent: NostrEvent;
    try {
      if (appSigner) {
        console.log("[GrapeRank] Auth: requesting signature from app signer...");
        signedEvent = await signWithTimeout(appSigner, eventTemplate, SIGNER_SIGN_TIMEOUT);
      } else if (typeof window !== "undefined" && window.nostr) {
        console.log("[GrapeRank] Auth: no app signer, falling back to window.nostr...");
        signedEvent = await withSignerTimeout(
          window.nostr.signEvent(eventTemplate) as Promise<NostrEvent>,
          SIGNER_SIGN_TIMEOUT,
          "signEvent",
        );
      } else {
        console.log("[GrapeRank] Auth: no signer available (app or extension)");
        return failAndEmit("No Nostr signer available");
      }
    } catch (signErr: unknown) {
      if (signErr instanceof SignerTimeoutError) {
        console.log("[GrapeRank] Auth: signer timed out");
        return failAndEmit("Signer didn't respond");
      }
      const message = signErr instanceof Error ? signErr.message : String(signErr ?? "");
      const lower = message.toLowerCase();
      if (lower.includes("denied") || lower.includes("rejected") || lower.includes("refused") || lower.includes("cancel")) {
        return failAndEmit("Signer rejected");
      }
      console.warn("[GrapeRank] Auth: signing failed:", signErr);
      return failAndEmit(message || "Signer failed");
    }
    console.log("[GrapeRank] Auth: event signed, id:", signedEvent?.id?.slice(0, 12));

    console.log("[GrapeRank] Auth: sending verify POST...");
    const verifyRes = await fetch(`${BRAINSTORM_API}/authChallenge/${observerPubkey}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signed_event: signedEvent }),
    });

    if (!verifyRes.ok) {
      let detail = "";
      try { detail = await verifyRes.text(); } catch {}
      console.log("[GrapeRank] Auth: verify rejected — status:", verifyRes.status, "detail:", detail.slice(0, 120));
      return failAndEmit(`Verify rejected (${verifyRes.status})`);
    }

    let verifyData: Record<string, unknown>;
    try {
      verifyData = await verifyRes.json();
    } catch {
      console.log("[GrapeRank] Auth: verify response not JSON");
      return failAndEmit("Verify response was not JSON");
    }
    console.log("[GrapeRank] Auth: verify OK — status:", verifyRes.status, "keys:", Object.keys(verifyData), "data keys:", verifyData?.data && typeof verifyData.data === "object" ? Object.keys(verifyData.data as object) : "n/a");

    const token = (verifyData?.data as Record<string, unknown>)?.token as string
      ?? (verifyData as Record<string, unknown>)?.token as string
      ?? (verifyData as Record<string, unknown>)?.access_token as string
      ?? null;
    const tokenSource = token === ((verifyData?.data as Record<string, unknown>)?.token)
      ? "data.token"
      : token === ((verifyData as Record<string, unknown>)?.token)
        ? "token"
        : token === ((verifyData as Record<string, unknown>)?.access_token)
          ? "access_token"
          : "unknown";
    if (!token) {
      console.log("[GrapeRank] Auth: no token in verify response");
      return failAndEmit("No token in verify response");
    }

    console.log("[GrapeRank] Auth: SUCCESS — token obtained via", tokenSource);
    authToken = token;
    authPubkey = observerPubkey;
    saveSessionAuth();
    _authLastSuccessAt = Date.now();
    _authLastFailReason = "";
    emitAuthEvent({ type: "success", pubkey: observerPubkey, at: _authLastSuccessAt });
    return true;
  } catch (err: unknown) {
    console.warn("[GrapeRank] Auth: exception during auth flow:", err);
    const message = err instanceof Error ? err.message : String(err ?? "");
    return failAndEmit(message || "Signing or verification failed");
  }
}

export async function authenticateWithBrainstorm(observerPubkey: string): Promise<boolean> {
  if (authToken && authPubkey === observerPubkey) return true;

  if (authPromise && authPromise.pubkey === observerPubkey) return authPromise.promise;

  const promise = doAuthenticate(observerPubkey).finally(() => {
    if (authPromise?.pubkey === observerPubkey) authPromise = null;
  });
  authPromise = { pubkey: observerPubkey, promise };
  return promise;
}

export type TriggerResult = { ok: boolean; error?: "auth" | "rate_limited" | "upstream" | string };

// Kick off a GrapeRank calculation for the signed-in user, in-app. Authenticates
// (signs the brainstorm_login challenge with the user's signer → JWT), then POSTs
// the trigger. Returns a discriminated result so the UI can message rate-limits
// (the upstream enforces a ~30-min per-user cooldown) vs. real failures. Watch
// for completion via the existing recalc poller (notifyRecalculating).
export async function triggerGrapeRankCalculation(observerPubkey: string): Promise<TriggerResult> {
  const authed = await authenticateWithBrainstorm(observerPubkey);
  if (!authed || !authToken) return { ok: false, error: "auth" };

  const doPost = () =>
    fetch(`${BRAINSTORM_API}/trigger`, { method: "POST", headers: { access_token: authToken! } });

  try {
    let res = await doPost();
    if (res.status === 401 || res.status === 403) {
      clearAuth();
      const reAuthed = await doAuthenticate(observerPubkey);
      if (!reAuthed || !authToken) return { ok: false, error: "auth" };
      res = await doPost();
    }
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) {
      // Some deployments return 400 with a cooldown message rather than 429.
      let body = "";
      try { body = (await res.text()).toLowerCase(); } catch {}
      if (body.includes("frequent") || body.includes("cooldown") || body.includes("wait")) {
        return { ok: false, error: "rate_limited" };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "upstream" };
  }
}

async function fetchAuthenticatedUser(targetPubkey: string, observerPubkey: string): Promise<Response | null> {
  console.log("[GrapeRank] fetchAuthenticatedUser: GET /user/", targetPubkey.slice(0, 8), "token present:", !!authToken);
  const res = await fetch(`${BRAINSTORM_API}/user/${targetPubkey}`, {
    headers: { access_token: authToken! },
  });
  console.log("[GrapeRank] fetchAuthenticatedUser: status", res.status);
  if (res.status === 401 || res.status === 403) {
    console.log("[GrapeRank] fetchAuthenticatedUser: token expired/invalid, re-authenticating...");
    clearAuth();
    const reAuthed = await doAuthenticate(observerPubkey);
    if (!reAuthed) {
      console.log("[GrapeRank] fetchAuthenticatedUser: re-auth failed");
      return null;
    }
    const retry = await fetch(`${BRAINSTORM_API}/user/${targetPubkey}`, {
      headers: { access_token: authToken! },
    });
    console.log("[GrapeRank] fetchAuthenticatedUser: retry status", retry.status);
    if (!retry.ok) return null;
    return retry;
  }
  if (!res.ok) return null;
  return res;
}

function extractGraphData(json: Record<string, unknown>): UserGraphData {
  const root = (json?.data ?? json) as Record<string, unknown>;

  const graph = (root?.graph ?? root) as Record<string, unknown>;

  const isHexPubkey = (v: unknown): v is string => typeof v === "string" && v.length === 64 && /^[0-9a-f]+$/.test(v);
  const safeInfluence = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

  const normalize = (arr: unknown): UserConnection[] => {
    if (!Array.isArray(arr)) return [];
    const result: UserConnection[] = [];
    for (const c of arr) {
      if (c && typeof c === "object" && !Array.isArray(c) && "pubkey" in c) {
        const obj = c as Record<string, unknown>;
        if (isHexPubkey(obj.pubkey)) {
          // Reporters of this connection (with their own influence), one level
          // deep — reporters' own reporter lists aren't parsed.
          const reporters = normalize(obj.reported_by ?? obj.reportedBy);
          result.push({
            pubkey: obj.pubkey,
            influence: safeInfluence(obj.influence),
            trusted_reporters: typeof obj.trusted_reporters === "number" ? obj.trusted_reporters : null,
            ...(reporters.length > 0 ? { reported_by: reporters } : {}),
          });
        }
      } else if (Array.isArray(c) && c.length >= 2 && isHexPubkey(c[0])) {
        result.push({ pubkey: c[0], influence: safeInfluence(c[1]), trusted_reporters: null });
      } else if (isHexPubkey(c)) {
        result.push({ pubkey: c, influence: null, trusted_reporters: null });
      }
    }
    return result;
  };

  return {
    followed_by: normalize(graph.followed_by ?? graph.followedBy ?? graph.followers),
    following: normalize(graph.following),
    muted_by: normalize(graph.muted_by ?? graph.mutedBy),
    muting: normalize(graph.muting ?? []),
    reported_by: normalize(graph.reported_by ?? graph.reportedBy ?? []),
    reporting: normalize(graph.reporting ?? []),
    influence: typeof graph.influence === "number" ? graph.influence
      : typeof root.influence === "number" ? root.influence
      : null,
  };
}

function hasUsableData(data: UserGraphData): boolean {
  return (
    data.influence !== null ||
    data.followed_by.length > 0 ||
    data.following.length > 0 ||
    data.muted_by.length > 0
  );
}

export async function fetchGrapeRankScore(
  targetPubkey: string,
  observerPubkey: string | null
): Promise<GrapeRankScore | null> {
  const cached = getCached(targetPubkey, observerPubkey);
  if (cached) return cached;

  const key = cacheKey(targetPubkey, observerPubkey);
  const inflight = inflightRequests.get(key);
  if (inflight) return inflight;

  const promise = fetchGrapeRankScoreInner(targetPubkey, observerPubkey);
  inflightRequests.set(key, promise);
  promise.finally(() => inflightRequests.delete(key));
  return promise;
}

function buildScoreFromGraphData(data: UserGraphData, observerPubkey: string | null): GrapeRankScore {
  const followedByPubkeys = new Set(data.followed_by.map((c) => c.pubkey));
  const followingPubkeys = new Set(data.following.map((c) => c.pubkey));
  const mutedByPubkeys = new Set(data.muted_by.map((c) => c.pubkey));

  let relationship: GrapeRankScore["relationship"] = "none";
  if (observerPubkey) {
    const observerInFollowedBy = followedByPubkeys.has(observerPubkey);
    const observerInFollowing = followingPubkeys.has(observerPubkey);
    const observerInMutedBy = mutedByPubkeys.has(observerPubkey);
    if (observerInMutedBy) relationship = "muted";
    else if (observerInFollowedBy && observerInFollowing) relationship = "mutual";
    else if (observerInFollowedBy) relationship = "you-follow";
    else if (observerInFollowing) relationship = "follows-you";
  }

  const allConnections = [...data.followed_by, ...data.following];
  const maxTrustedReporters = allConnections.reduce<number | null>((max, c) => {
    if (c.trusted_reporters === null) return max;
    return max === null ? c.trusted_reporters : Math.max(max, c.trusted_reporters);
  }, null);

  return {
    influence: data.influence,
    trustedReporters: maxTrustedReporters,
    followedByCount: data.followed_by.length,
    followingCount: data.following.length,
    mutedByCount: data.muted_by.length,
    relationship,
    lastCalculated: null,
  };
}

async function fetchAuthenticatedScore(
  targetPubkey: string,
  observerPubkey: string
): Promise<GrapeRankScore | null> {
  const authed = await authenticateWithBrainstorm(observerPubkey);
  if (!authed) {
    console.log("[GrapeRank] Auth failed for", targetPubkey.slice(0, 8));
    return null;
  }

  console.log("[GrapeRank] Fetching authenticated /user/ for", targetPubkey.slice(0, 8));
  const res = await fetchAuthenticatedUser(targetPubkey, observerPubkey);
  if (!res) {
    console.log("[GrapeRank] Auth request returned null for", targetPubkey.slice(0, 8));
    return null;
  }
  const json = await res.json();
  const safeJson = (typeof json === "object" && json !== null) ? json : {};
  console.log("[GrapeRank] Raw response keys:", Object.keys(safeJson), "| data keys:", safeJson.data && typeof safeJson.data === "object" ? Object.keys(safeJson.data) : "no .data");
  const data = extractGraphData(safeJson);
  console.log("[GrapeRank] Parsed:", { influence: data.influence, followedBy: data.followed_by.length, following: data.following.length, mutedBy: data.muted_by.length });

  if (!hasUsableData(data)) {
    console.log("[GrapeRank] Auth returned empty data for", targetPubkey.slice(0, 8));
    return null;
  }

  const score = buildScoreFromGraphData(data, observerPubkey);
  console.log("[GrapeRank] Score:", { influence: score.influence, tier: getSignalTier(score.influence), relationship: score.relationship, followedBy: score.followedByCount });
  return score;
}

async function fetchGrapeRankScoreInner(
  targetPubkey: string,
  observerPubkey: string | null
): Promise<GrapeRankScore | null> {
  if (!observerPubkey) {
    return fetchPublicScore(targetPubkey);
  }

  const hasTokenCached = authToken && authPubkey === observerPubkey;

  if (hasTokenCached) {
    try {
      const authScore = await fetchAuthenticatedScore(targetPubkey, observerPubkey);
      if (authScore) {
        setCache(targetPubkey, observerPubkey, authScore);
        return authScore;
      }
    } catch (err) {
      console.warn("[GrapeRank] Cached-token fetch failed:", err);
    }
    return fetchPublicScore(targetPubkey);
  }

  const nip85Promise = fetchNip85Score(targetPubkey).catch(() => null);
  const authScorePromise = fetchAuthenticatedScore(targetPubkey, observerPubkey).catch(() => null);

  type RaceResult = { source: "auth"; score: GrapeRankScore | null } | { source: "nip85"; score: GrapeRankScore | null };
  const winner = await Promise.race([
    authScorePromise.then((s): RaceResult => ({ source: "auth", score: s })),
    nip85Promise.then((s): RaceResult => ({ source: "nip85", score: s })),
  ]);

  if (winner.source === "auth" && winner.score) {
    setCache(targetPubkey, observerPubkey, winner.score);
    return winner.score;
  }

  if (winner.source === "nip85" && winner.score) {
    setCache(targetPubkey, observerPubkey, winner.score);
    authScorePromise.then((authScore) => {
      if (authScore) {
        setCache(targetPubkey, observerPubkey, authScore);
      }
    }).catch(() => {});
    return winner.score;
  }

  const otherResult = winner.source === "auth" ? await nip85Promise : await authScorePromise;
  if (otherResult) {
    setCache(targetPubkey, observerPubkey, otherResult);
    return otherResult;
  }

  return fetchPublicScore(targetPubkey);
}

async function fetchPublicScore(targetPubkey: string): Promise<GrapeRankScore | null> {
  try {
    const setupRes = await fetch(`${BRAINSTORM_API}/setup/${targetPubkey}`);
    if (!setupRes.ok) {
      return fetchNip85Score(targetPubkey);
    }
    const setupData = await setupRes.json();
    if (!Array.isArray(setupData) || setupData.length === 0) {
      return fetchNip85Score(targetPubkey);
    }

    const nip85Result = await fetchNip85Score(targetPubkey);
    if (nip85Result && nip85Result.influence !== null) {
      return nip85Result;
    }

    const score: GrapeRankScore = {
      influence: null,
      trustedReporters: null,
      followedByCount: 0,
      followingCount: 0,
      mutedByCount: 0,
      relationship: "none",
      lastCalculated: null,
    };
    setCache(targetPubkey, null, score);
    return score;
  } catch {
    return fetchNip85Score(targetPubkey);
  }
}

interface Nip85ContentData {
  influence?: number;
  rank?: number;
  average?: number;
  confidence?: number;
  followers?: number;
  followedBy?: number;
}

function parseNip85Content(event: { content: string; tags: string[][] }): Nip85ContentData | null {
  try {
    const parsed = JSON.parse(event.content);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Nip85ContentData;
  } catch {
    return null;
  }
}

function extractNip85Influence(contentData: Nip85ContentData): number | null {
  if (typeof contentData.influence === "number" && isFinite(contentData.influence)) {
    return contentData.influence;
  }
  if (typeof contentData.rank === "number" && isFinite(contentData.rank)) {
    return contentData.rank;
  }
  if (typeof contentData.average === "number" && isFinite(contentData.average)) {
    return contentData.average;
  }
  return null;
}

function extractNip85Followers(contentData: Nip85ContentData): number {
  if (typeof contentData.followers === "number" && contentData.followers >= 0) {
    return contentData.followers;
  }
  if (typeof contentData.followedBy === "number" && contentData.followedBy >= 0) {
    return contentData.followedBy;
  }
  return 0;
}

function getEventMetricType(event: { tags: string[][] }): string | null {
  for (const tag of event.tags) {
    if (tag[0] === "t" && tag[1]) return tag[1];
    if (tag[0] === "metric" && tag[1]) return tag[1];
  }
  return null;
}

async function fetchNip85Score(targetPubkey: string): Promise<GrapeRankScore | null> {
  try {
    const events = await Promise.race([
      pool.querySync([NIP85_RELAY], {
        kinds: [KIND_NIP85],
        authors: [NIP85_PROVIDER],
        "#d": [targetPubkey],
        limit: 10,
      }),
      new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 4000)),
    ]);

    if (!events || events.length === 0) return null;

    let rankEvent: typeof events[0] | null = null;
    let followersEvent: typeof events[0] | null = null;
    let genericEvent: typeof events[0] | null = null;

    for (const ev of events) {
      const metric = getEventMetricType(ev);
      if (metric === "rank" || metric === "graperank" || metric === "influence") {
        if (!rankEvent || ev.created_at > rankEvent.created_at) rankEvent = ev;
      } else if (metric === "followers" || metric === "followedBy") {
        if (!followersEvent || ev.created_at > followersEvent.created_at) followersEvent = ev;
      } else {
        if (!genericEvent || ev.created_at > genericEvent.created_at) genericEvent = ev;
      }
    }

    let influence: number | null = null;
    let followedByCount = 0;
    let latestTimestamp = 0;

    const primaryEvent = rankEvent || genericEvent;
    if (primaryEvent) {
      const contentData = parseNip85Content(primaryEvent);
      if (contentData) {
        influence = extractNip85Influence(contentData);
        followedByCount = extractNip85Followers(contentData);
      }
      latestTimestamp = Math.max(latestTimestamp, primaryEvent.created_at);
    }

    if (followersEvent) {
      const followersData = parseNip85Content(followersEvent);
      if (followersData) {
        const fc = extractNip85Followers(followersData);
        if (fc > followedByCount) followedByCount = fc;
        if (influence === null) {
          influence = extractNip85Influence(followersData);
        }
      }
      latestTimestamp = Math.max(latestTimestamp, followersEvent.created_at);
    }

    if (influence === null && followedByCount === 0) return null;

    const lastCalc = latestTimestamp > 0
      ? new Date(latestTimestamp * 1000).toISOString()
      : null;

    const score: GrapeRankScore = {
      influence,
      trustedReporters: null,
      followedByCount,
      followingCount: 0,
      mutedByCount: 0,
      relationship: "none",
      lastCalculated: lastCalc,
    };
    setCache(targetPubkey, null, score);
    return score;
  } catch {
    return null;
  }
}

function extractFlaggedPubkeys(json: Record<string, unknown>, graphData?: UserGraphData): Set<string> {
  const result = new Set<string>();
  const root = (json?.data ?? json) as Record<string, unknown>;
  const isHexPubkey = (v: unknown): v is string => typeof v === "string" && v.length === 64 && /^[0-9a-f]+$/.test(v);

  const candidateKeys = [
    "low_and_reported_by_2_or_more_trusted_pubkeys",
    "flagged_pubkeys",
    "flagged",
  ];

  for (const key of candidateKeys) {
    const arr = root[key] ?? (json as Record<string, unknown>)[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (isHexPubkey(item)) {
          result.add(item);
        } else if (item && typeof item === "object" && "pubkey" in item && isHexPubkey((item as Record<string, unknown>).pubkey)) {
          result.add((item as Record<string, unknown>).pubkey as string);
        }
      }
    }
  }

  // Only treat the backend's flagged list as authoritative when it actually
  // carried entries. The previous check accepted an empty `flagged_pubkeys: []`
  // as "dedicated", which short-circuited the derivation below and left the
  // "Flagged" tier permanently empty in deployments where the API ships the
  // field but no members.
  const hasDedicatedFlagged = result.size > 0;

  if (graphData) {
    // Accounts YOU have personally muted or reported are always flagged. This is
    // the most reliable flag signal we have, and it makes the "Flagged" tier real
    // even when the backend returns no flagged list at all.
    for (const c of graphData.muting) if (isHexPubkey(c.pubkey)) result.add(c.pubkey);
    for (const c of graphData.reporting) if (isHexPubkey(c.pubkey)) result.add(c.pubkey);
  }

  if (graphData && !hasDedicatedFlagged) {
    const LOW_INFLUENCE_THRESHOLD = 0.02;
    const mutingSet = new Set(graphData.muting.map(c => c.pubkey));
    const reportingSet = new Set(graphData.reporting.map(c => c.pubkey));

    const allConnections = [
      ...graphData.followed_by,
      ...graphData.following,
      ...graphData.muted_by,
      ...graphData.muting,
      ...graphData.reported_by,
      ...graphData.reporting,
    ];

    const agg = new Map<string, { minInfluence: number | null; maxReporters: number | null }>();
    for (const conn of allConnections) {
      const prev = agg.get(conn.pubkey);
      if (!prev) {
        agg.set(conn.pubkey, { minInfluence: conn.influence, maxReporters: conn.trusted_reporters });
      } else {
        if (conn.influence !== null) {
          prev.minInfluence = prev.minInfluence === null ? conn.influence : Math.min(prev.minInfluence, conn.influence);
        }
        if (conn.trusted_reporters !== null) {
          prev.maxReporters = prev.maxReporters === null ? conn.trusted_reporters : Math.max(prev.maxReporters, conn.trusted_reporters);
        }
      }
    }

    for (const [pk, stats] of agg) {
      const isMuting = mutingSet.has(pk);
      const isReporting = reportingSet.has(pk);
      const hasLowInfluence = stats.minInfluence !== null && stats.minInfluence < LOW_INFLUENCE_THRESHOLD;
      const hasReporters = stats.maxReporters !== null && stats.maxReporters >= 2;

      if (hasReporters && hasLowInfluence) {
        result.add(pk);
      } else if ((isMuting || isReporting) && hasLowInfluence) {
        result.add(pk);
      }
    }

  }

  if (graphData && result.size > 0) {
    console.log(`[GrapeRank] flagged set: ${result.size} pubkeys (own muting=${graphData.muting.length}, reporting=${graphData.reporting.length}, dedicated=${hasDedicatedFlagged})`);
  }

  return result;
}

/**
 * Per-pubkey count of trusted accounts that flagged them — the same
 * `trusted_reporters` the connection payload already carries, surfaced as a map
 * so the Follow-list-health page can say "N people you trust flagged this". Takes
 * the MAX across every connection list a pubkey appears in (the strongest signal).
 * The binary `flaggedPubkeys` set discards this; this keeps it.
 */
/**
 * Per-connection reporter lists: pubkey → the accounts that reported them, WITH
 * their influence. This is the un-collapsed form of {@link extractFlagReporterCounts}
 * — the Follow-list-health verdict needs to know how trusted each reporter is,
 * not just how many there were. Merges reporters (unique by pubkey, strongest
 * influence kept) across every list a connection appears in.
 */
export function extractReportedByMap(graphData: UserGraphData): Map<string, UserConnection[]> {
  const out = new Map<string, Map<string, UserConnection>>();
  const lists = [
    graphData.followed_by, graphData.following, graphData.muted_by,
    graphData.muting, graphData.reported_by, graphData.reporting,
  ];
  for (const list of lists) {
    for (const c of list) {
      if (!c.reported_by || c.reported_by.length === 0) continue;
      let bucket = out.get(c.pubkey);
      if (!bucket) { bucket = new Map(); out.set(c.pubkey, bucket); }
      for (const r of c.reported_by) {
        const prev = bucket.get(r.pubkey);
        if (!prev || (r.influence ?? -1) > (prev.influence ?? -1)) bucket.set(r.pubkey, r);
      }
    }
  }
  const result = new Map<string, UserConnection[]>();
  for (const [pk, bucket] of out) result.set(pk, Array.from(bucket.values()));
  return result;
}

export function extractFlagReporterCounts(graphData: UserGraphData): Map<string, number> {
  const counts = new Map<string, number>();
  const lists = [
    graphData.followed_by, graphData.following, graphData.muted_by,
    graphData.muting, graphData.reported_by, graphData.reporting,
  ];
  for (const list of lists) {
    for (const c of list) {
      if (c.trusted_reporters === null || c.trusted_reporters === undefined) continue;
      const prev = counts.get(c.pubkey);
      counts.set(c.pubkey, prev === undefined ? c.trusted_reporters : Math.max(prev, c.trusted_reporters));
    }
  }
  return counts;
}

function extractSelfData(json: Record<string, unknown>): {
  influence: number | null;
  lastCalculated: string | null;
  lastTriggered: string | null;
} {
  const root = (json?.data ?? json) as Record<string, unknown>;
  const graph = root?.graph as Record<string, unknown> | undefined;
  const history = root?.history as Record<string, unknown> | undefined;

  let influence: number | null = null;
  if (graph && typeof graph.influence === "number") {
    influence = graph.influence;
  } else if (typeof root.influence === "number") {
    influence = root.influence;
  }

  const lastCalculated = (history?.last_time_calculated_graperank as string)
    ?? (root?.last_time_calculated_graperank as string)
    ?? null;
  const lastTriggered = (history?.last_time_triggered_graperank as string)
    ?? (root?.last_time_triggered_graperank as string)
    ?? null;

  return { influence, lastCalculated, lastTriggered };
}

export async function fetchSelfGrapeRank(observerPubkey: string): Promise<{
  influence: number | null;
  lastCalculated: string | null;
  lastTriggered: string | null;
} | null> {
  const authed = await authenticateWithBrainstorm(observerPubkey);
  if (!authed) {
    console.log("[GrapeRank] Self: auth failed for", observerPubkey.slice(0, 8));
    return null;
  }

  try {
    console.log("[GrapeRank] Fetching /user/self for", observerPubkey.slice(0, 8));
    const res = await fetch(`${BRAINSTORM_API}/user/self`, {
      headers: { access_token: authToken! },
    });
    if (res.status === 401 || res.status === 403) {
      clearAuth();
      const reAuthed = await doAuthenticate(observerPubkey);
      if (!reAuthed) return null;
      const retry = await fetch(`${BRAINSTORM_API}/user/self`, {
        headers: { access_token: authToken! },
      });
      if (!retry.ok) return null;
      const retryJson = await retry.json();
      const safeRetry = (typeof retryJson === "object" && retryJson !== null) ? retryJson : {};
      console.log("[GrapeRank] Self retry response keys:", Object.keys(safeRetry));
      return extractSelfData(safeRetry);
    }
    if (!res.ok) {
      console.log("[GrapeRank] Self returned", res.status);
      return null;
    }
    const json = await res.json();
    const safeJson = (typeof json === "object" && json !== null) ? json : {};
    console.log("[GrapeRank] Self response keys:", Object.keys(safeJson), "| data keys:", safeJson.data && typeof safeJson.data === "object" ? Object.keys(safeJson.data) : "no .data");
    const result = extractSelfData(safeJson);
    console.log("[GrapeRank] Self parsed:", result);
    return result;
  } catch (err) {
    console.warn("[GrapeRank] Self fetch failed:", err);
    return null;
  }
}

export interface ConnectionScoresResult {
  scores: Map<string, number>;
  flaggedPubkeys: Set<string>;
  /** pubkey → count of trusted accounts that flagged them (from the same payload). */
  flagReporterCounts: Map<string, number>;
  /** pubkey → the accounts that flagged them, WITH influence (un-collapsed). */
  reportedBy: Map<string, UserConnection[]>;
  followedByPubkeys: Set<string>;
  lastCalculated: string | null;
  lastTriggered: string | null;
}

let connectionScoresCache: { key: string; result: ConnectionScoresResult; ts: number } | null = null;
let connectionScoresInflight: { key: string; promise: Promise<ConnectionScoresResult | null> } | null = null;

export async function fetchConnectionScores(targetPubkey: string, observerPubkey?: string): Promise<ConnectionScoresResult | null> {
  const authPk = observerPubkey || targetPubkey;
  const cacheKey = targetPubkey;

  if (connectionScoresCache && connectionScoresCache.key === cacheKey && Date.now() - connectionScoresCache.ts < CACHE_TTL) {
    return connectionScoresCache.result;
  }

  if (connectionScoresInflight && connectionScoresInflight.key === cacheKey) {
    return connectionScoresInflight.promise;
  }

  const promise = (async (): Promise<ConnectionScoresResult | null> => {
    const t0 = performance.now();
    console.log("[GrapeRank] Connection scores: starting auth for", authPk.slice(0, 8), "target:", targetPubkey.slice(0, 8));
    const authed = await authenticateWithBrainstorm(authPk);
    const t1 = performance.now();
    if (!authed) {
      console.warn("[GrapeRank] Connection scores: auth failed after", ((t1 - t0) / 1000).toFixed(1) + "s");
      _connLastFailAt = Date.now();
      _connLastError = "Authentication with Brainstorm failed";
      return null;
    }
    console.log("[GrapeRank] Connection scores: auth OK in", ((t1 - t0) / 1000).toFixed(1) + "s");

    try {
      const isSelf = targetPubkey === authPk;
      const endpoint = isSelf
        ? `${BRAINSTORM_API}/user/self`
        : `${BRAINSTORM_API}/user/${targetPubkey}`;
      let res = await fetch(endpoint, {
        headers: { access_token: authToken! },
      });
      if (res.status === 401 || res.status === 403) {
        console.warn("[GrapeRank] Connection scores: /user/ returned", res.status, "— re-authenticating");
        clearAuth();
        const reAuthed = await doAuthenticate(authPk);
        if (!reAuthed) {
          console.warn("[GrapeRank] Connection scores: re-auth failed");
          _connLastFailAt = Date.now();
          _connLastError = "Re-authentication failed";
          return null;
        }
        res = await fetch(endpoint, {
          headers: { access_token: authToken! },
        });
      }
      const t2 = performance.now();
      if (!res.ok) {
        console.warn("[GrapeRank] Connection scores: /user/ returned", res.status, "after", ((t2 - t1) / 1000).toFixed(1) + "s");
        _connLastFailAt = Date.now();
        _connLastError = `Brainstorm /user/ returned ${res.status}`;
        return null;
      }
      console.log("[GrapeRank] Connection scores: /user/", targetPubkey.slice(0, 8), "200 in", ((t2 - t1) / 1000).toFixed(1) + "s");

      const json = await res.json();
      const safeJson = (typeof json === "object" && json !== null) ? json : {};

      const data = extractGraphData(safeJson);
      const selfData = extractSelfData(safeJson);

      const followingWithScores = data.following.filter(c => c.influence !== null).length;
      const followedByWithScores = data.followed_by.filter(c => c.influence !== null).length;
      console.log(`[GrapeRank] Connection scores: ${data.following.length} following (${followingWithScores} with scores), ${data.followed_by.length} followed_by (${followedByWithScores} with scores)`);

      const scores = new Map<string, number>();
      const allLists = [data.followed_by, data.following, data.muted_by, data.muting, data.reported_by, data.reporting];
      for (const list of allLists) {
        for (const conn of list) {
          if (conn.influence !== null) scores.set(conn.pubkey, conn.influence);
        }
      }

      const flaggedPubkeys = extractFlaggedPubkeys(safeJson, data);
      const flagReporterCounts = extractFlagReporterCounts(data);
      const reportedBy = extractReportedByMap(data);

      const t3 = performance.now();
      if (scores.size === 0) {
        console.warn("[GrapeRank] Connection scores: Map is empty — no connections had influence scores");
      } else {
        let minScore = 1, maxScore = 0;
        for (const v of scores.values()) {
          if (v < minScore) minScore = v;
          if (v > maxScore) maxScore = v;
        }
        console.log(`[GrapeRank] Connection scores: ${scores.size} in Map, range ${minScore.toFixed(3)}-${maxScore.toFixed(3)}, ${flaggedPubkeys.size} flagged`);
      }
      console.log(`[GrapeRank] Connection scores timing: auth ${((t1 - t0) / 1000).toFixed(1)}s, fetch ${((t2 - t1) / 1000).toFixed(1)}s, parse ${((t3 - t2) / 1000).toFixed(1)}s, total ${((t3 - t0) / 1000).toFixed(1)}s`);

      const followedByPubkeys = new Set(data.followed_by.map(c => c.pubkey));

      const result: ConnectionScoresResult = { scores, flaggedPubkeys, flagReporterCounts, reportedBy, followedByPubkeys, lastCalculated: selfData.lastCalculated, lastTriggered: selfData.lastTriggered };
      connectionScoresCache = { key: cacheKey, result, ts: Date.now() };
      _connLastSuccessAt = Date.now();
      return result;
    } catch (err: any) {
      console.warn("[GrapeRank] Connection scores fetch failed:", err);
      _connLastFailAt = Date.now();
      _connLastError = err?.message || "Connection fetch threw";
      return null;
    }
  })();

  connectionScoresInflight = { key: cacheKey, promise };
  promise.finally(() => { connectionScoresInflight = null; });
  return promise;
}

export function clearGrapeRankCache() {
  scoreCache.clear();
  connectionScoresCache = null;
}

export { NIP85_RELAY, NIP85_PROVIDER };
