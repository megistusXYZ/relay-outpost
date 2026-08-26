type VerifyStatus = "unknown" | "loading" | "verified" | "unverified";

interface CacheEntry {
  status: VerifyStatus;
  ts: number;
}

const CACHE_TTL = 4 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();

function cacheKey(nip05: string, pubkey: string): string {
  return `${nip05}:${pubkey}`;
}

export function getVerificationStatus(nip05: string | null | undefined, pubkey: string): VerifyStatus {
  if (!nip05) return "unknown";
  const key = cacheKey(nip05, pubkey);
  const entry = cache.get(key);
  if (!entry) return "unknown";
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return "unknown";
  }
  return entry.status;
}

export function subscribeVerification(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

export async function verifyNip05(nip05: string, pubkey: string): Promise<boolean> {
  const key = cacheKey(nip05, pubkey);

  const existing = cache.get(key);
  if (existing && Date.now() - existing.ts < CACHE_TTL && existing.status !== "loading") {
    return existing.status === "verified";
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  cache.set(key, { status: "loading", ts: Date.now() });
  notify();

  const promise = (async () => {
    try {
      const params = new URLSearchParams({ nip05, pubkey });
      const resp = await fetch(`/api/nip05/verify?${params.toString()}`);
      if (!resp.ok) {
        cache.set(key, { status: "unverified", ts: Date.now() });
        notify();
        return false;
      }
      const data = await resp.json();
      const verified = data?.verified === true;
      cache.set(key, { status: verified ? "verified" : "unverified", ts: Date.now() });
      notify();
      return verified;
    } catch {
      cache.set(key, { status: "unverified", ts: Date.now() });
      notify();
      return false;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export function requestVerification(nip05: string, pubkey: string): void {
  const key = cacheKey(nip05, pubkey);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.ts < CACHE_TTL && existing.status !== "unknown") {
    return;
  }
  verifyNip05(nip05, pubkey);
}
