const HEALTH_SESSION_KEY = "relay_health_data";

interface RelayHealthData {
  failures: number;
  lastFailure: number;
  cooldownUntil: number;
  successCount: number;
  totalLatency: number;
  avgLatency: number;
}

const healthMap = new Map<string, RelayHealthData>();

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function loadFromSession() {
  try {
    const raw = sessionStorage.getItem(HEALTH_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, RelayHealthData>;
      for (const [url, data] of Object.entries(parsed)) {
        healthMap.set(normalizeUrl(url), data);
      }
    }
  } catch {}
}

function persistToSession() {
  try {
    const obj: Record<string, RelayHealthData> = {};
    healthMap.forEach((data, url) => {
      obj[url] = data;
    });
    sessionStorage.setItem(HEALTH_SESSION_KEY, JSON.stringify(obj));
  } catch {}
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistToSession();
  }, 1000);
}

loadFromSession();

function getOrCreate(url: string): RelayHealthData {
  const key = normalizeUrl(url);
  let data = healthMap.get(key);
  if (!data) {
    data = { failures: 0, lastFailure: 0, cooldownUntil: 0, successCount: 0, totalLatency: 0, avgLatency: 5000 };
    healthMap.set(key, data);
  }
  return data;
}

export function markRelaySuccess(url: string, latencyMs: number) {
  const data = getOrCreate(url);
  data.successCount++;
  data.totalLatency += latencyMs;
  data.avgLatency = Math.round(data.totalLatency / data.successCount);
  data.failures = Math.max(0, data.failures - 1);
  data.cooldownUntil = 0;
  schedulePersist();
}

/**
 * Escalating per-relay cool-off after consecutive failures: 3 min for the
 * first, 5 min for the second, 10 min for the third and beyond. Pure so the
 * backoff curve is unit-testable independent of the module's Date/storage state.
 */
export function relayCooldownMs(failures: number): number {
  if (failures <= 1) return 3 * 60 * 1000;
  if (failures <= 2) return 5 * 60 * 1000;
  return 10 * 60 * 1000;
}

export function markRelayFailure(url: string) {
  const data = getOrCreate(url);
  const now = Date.now();
  data.failures++;
  data.lastFailure = now;
  data.cooldownUntil = now + relayCooldownMs(data.failures);
  schedulePersist();
}

export function isRelayCoolingDown(url: string): boolean {
  const key = normalizeUrl(url);
  const data = healthMap.get(key);
  if (!data) return false;
  if (data.cooldownUntil === 0) return false;
  if (Date.now() >= data.cooldownUntil) {
    data.cooldownUntil = 0;
    return false;
  }
  return true;
}

const LIVENESS_SESSION_KEY = "relay_liveness_data";
const LIVENESS_TTL_MS = 15 * 60 * 1000;
let onlineRelaySet: Set<string> | null = null;
let livenessFetchedAt = 0;

function loadLivenessFromSession() {
  try {
    const raw = sessionStorage.getItem(LIVENESS_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { ts: number; relays: string[] };
    if (Date.now() - parsed.ts < LIVENESS_TTL_MS) {
      onlineRelaySet = new Set(parsed.relays.map(normalizeUrl));
      livenessFetchedAt = parsed.ts;
    }
  } catch {}
}

loadLivenessFromSession();

export async function fetchRelayLiveness(): Promise<void> {
  if (onlineRelaySet && Date.now() - livenessFetchedAt < LIVENESS_TTL_MS) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("https://api.nostr.watch/v1/online", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return;
    const data = await res.json() as string[];
    if (!Array.isArray(data) || data.length < 10) return;
    onlineRelaySet = new Set(data.map(normalizeUrl));
    livenessFetchedAt = Date.now();
    try {
      sessionStorage.setItem(LIVENESS_SESSION_KEY, JSON.stringify({
        ts: livenessFetchedAt,
        relays: data,
      }));
    } catch {}
  } catch {}
}

const coreRelaySet = new Set<string>();

export function registerCoreRelays(relays: string[]) {
  for (const url of relays) {
    coreRelaySet.add(normalizeUrl(url));
  }
}

export function isRelayLikelyDead(url: string): boolean {
  if (!onlineRelaySet) return false;
  if (coreRelaySet.has(normalizeUrl(url))) return false;
  return !onlineRelaySet.has(normalizeUrl(url));
}

/**
 * True if `url` is a well-formed relay URL the pool can dial. A ws/ws(s) scheme
 * is assumed when one is missing (nostr-tools normalizes bare hosts the same
 * way), so bare `relay.example.com` passes — but empty strings, a bare `wss://`
 * with no host, and non-ws garbage do not. This is the guard that stops
 * "Invalid URL: wss://" unhandled rejections when a malformed nevent/naddr relay
 * hint reaches `pool.subscribeMany`.
 */
export function isValidRelayUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const isWs = /^wss?:\/\//i.test(trimmed);
  // A scheme that isn't ws/wss (http, javascript, …) is not a relay.
  if (!isWs && /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false;
  const withScheme = isWs ? trimmed : `wss://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "wss:" || u.protocol === "ws:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** Drop empty / malformed relay URLs, preserving the originals that are valid. */
export function sanitizeRelayUrls(relays: string[]): string[] {
  return relays.filter(isValidRelayUrl);
}

export function getHealthyRelays(relays: string[]): string[] {
  // Sanitize FIRST so the `< 3` fallback below can never hand a malformed URL
  // (e.g. a bad nevent/naddr relay hint) back to the pool, which throws
  // "Invalid URL: wss://" as an unhandled rejection.
  const valid = sanitizeRelayUrls(relays);
  const healthy = valid.filter(url => !isRelayCoolingDown(url) && !isRelayLikelyDead(url));
  if (healthy.length < 3) return valid.slice(0, Math.max(3, valid.length));
  return healthy;
}

export function getRelayScore(url: string): number {
  const key = normalizeUrl(url);
  const data = healthMap.get(key);
  if (!data) return 5000;

  const latencyScore = data.avgLatency;
  const reliabilityPenalty = data.failures * 500;
  const total = data.successCount + data.failures;
  const successBonus = total > 0 ? (1 - data.successCount / total) * 1000 : 0;

  return latencyScore + reliabilityPenalty + successBonus;
}

export function sortRelaysByScore(relays: string[]): string[] {
  return [...relays].sort((a, b) => getRelayScore(a) - getRelayScore(b));
}

export function getRelayHealthData(url: string): RelayHealthData | undefined {
  return healthMap.get(normalizeUrl(url));
}

export function getAllRelayHealth(): Map<string, RelayHealthData> {
  return new Map(healthMap);
}
