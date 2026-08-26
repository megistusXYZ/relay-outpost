import { useState, useEffect, useRef } from "react";
import { usePageVisibility } from "@/hooks/use-page-visibility";

export type StreamLiveness = "verified-live" | "offline" | "unknown";

interface HealthResult {
  alive: boolean | null;
  checkedAt: number;
}

const CACHE_TTL = 5 * 60 * 1000;
const REFRESH_INTERVAL = 5 * 60 * 1000;
const BATCH_DELAY = 150;
const MAX_BATCH_SIZE = 20;
const livenessCache = new Map<string, { result: HealthResult; fetchedAt: number }>();

let batchQueue: { url: string; resolve: (r: HealthResult) => void }[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function getCached(url: string): HealthResult | null {
  const entry = livenessCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    livenessCache.delete(url);
    return null;
  }
  return entry.result;
}

function setCache(url: string, result: HealthResult) {
  livenessCache.set(url, { result, fetchedAt: Date.now() });
}

async function flushBatch() {
  const batch = batchQueue.splice(0);
  if (batch.length === 0) return;

  const uniqueUrls = [...new Set(batch.map(b => b.url))];

  for (let i = 0; i < uniqueUrls.length; i += MAX_BATCH_SIZE) {
    const chunk = uniqueUrls.slice(i, i + MAX_BATCH_SIZE);
    const chunkItems = batch.filter(b => chunk.includes(b.url));

    try {
      const resp = await fetch("/api/stream/health-check-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: chunk }),
      });

      if (!resp.ok) throw new Error("batch failed");

      const data = await resp.json();
      const results: Record<string, HealthResult> = data.results || {};

      for (const item of chunkItems) {
        const result = results[item.url] || { alive: null, checkedAt: Date.now() };
        setCache(item.url, result);
        item.resolve(result);
      }
    } catch {
      for (const item of chunkItems) {
        const fallback = { alive: null as boolean | null, checkedAt: Date.now() };
        item.resolve(fallback);
      }
    }
  }
}

function queueHealthCheck(url: string): Promise<HealthResult> {
  const cached = getCached(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    batchQueue.push({ url, resolve });

    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
      batchTimer = null;
      flushBatch();
    }, BATCH_DELAY);
  });
}

export function checkStreamHealth(url: string): Promise<HealthResult> {
  return queueHealthCheck(url);
}

export function toLiveness(result: HealthResult): StreamLiveness {
  if (result.alive === true) return "verified-live";
  if (result.alive === false) return "offline";
  return "unknown";
}

export function useStreamLiveness(streamUrl: string | undefined): StreamLiveness {
  const [liveness, setLiveness] = useState<StreamLiveness>("unknown");
  const urlRef = useRef(streamUrl);
  const pageVisible = usePageVisibility();

  useEffect(() => {
    urlRef.current = streamUrl;
    if (!streamUrl || !pageVisible) {
      if (!streamUrl) setLiveness("unknown");
      return;
    }

    let cancelled = false;

    const check = () => {
      livenessCache.delete(streamUrl);
      queueHealthCheck(streamUrl).then((result) => {
        if (!cancelled && urlRef.current === streamUrl) {
          setLiveness(toLiveness(result));
        }
      });
    };

    check();
    const interval = setInterval(check, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [streamUrl, pageVisible]);

  return liveness;
}

export function useBatchStreamLiveness(urls: (string | undefined)[]): Map<string, StreamLiveness> {
  const [results, setResults] = useState<Map<string, StreamLiveness>>(new Map());
  const serialized = urls.filter(Boolean).sort().join("|");
  const pageVisible = usePageVisibility();

  useEffect(() => {
    const validUrls = [...new Set(urls.filter((u): u is string => !!u))];
    if (validUrls.length === 0) {
      setResults(new Map());
      return;
    }

    if (!pageVisible) return;

    let cancelled = false;

    const check = () => {
      for (const url of validUrls) livenessCache.delete(url);
      Promise.all(validUrls.map(async (url) => {
        const result = await queueHealthCheck(url);
        return [url, toLiveness(result)] as [string, StreamLiveness];
      })).then((entries) => {
        if (!cancelled) {
          setResults(new Map(entries));
        }
      });
    };

    check();
    const interval = setInterval(check, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serialized, pageVisible]);

  return results;
}
