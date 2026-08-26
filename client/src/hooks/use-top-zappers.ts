import { useState, useEffect, useRef } from "react";
import { pool, DEFAULT_RELAYS, fetchProfilesCached } from "@/lib/nostr";
import type { Event } from "nostr-tools";

interface TopZapper {
  pubkey: string;
  amount: number;
  message: string;
  emoji: string;
}

const topZappersCache = new Map<string, { zappers: TopZapper[]; ts: number }>();
const inflight = new Map<string, Promise<TopZapper[]>>();

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_CONCURRENT = 3;

let activeCount = 0;
const pendingQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => pendingQueue.push(resolve));
}

function releaseSlot() {
  const next = pendingQueue.shift();
  if (next) {
    next();
  } else {
    activeCount--;
  }
}

interface ZapRequestInfo {
  pubkey: string;
  message: string;
  emoji: string;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

function parseZapRequest(ev: Event): ZapRequestInfo | null {
  const descTag = ev.tags.find(t => t[0] === "description");
  if (!descTag?.[1]) return null;
  try {
    const req = JSON.parse(descTag[1]);
    if (!req.pubkey || typeof req.pubkey !== "string" || !HEX64_RE.test(req.pubkey)) return null;
    const emoji = (req.tags?.find((t: string[]) => t[0] === "emoji")?.[1]) || "";
    return { pubkey: req.pubkey, message: req.content || "", emoji };
  } catch {
    return null;
  }
}

function parseBolt11Amount(bolt11: string): number {
  const lower = bolt11.toLowerCase();
  const mMatch = lower.match(/lnbc(\d+)m/);
  if (mMatch) return parseInt(mMatch[1]) * 100000;
  const uMatch = lower.match(/lnbc(\d+)u/);
  if (uMatch) return parseInt(uMatch[1]) * 100;
  const nMatch = lower.match(/lnbc(\d+)n/);
  if (nMatch) return Math.floor(parseInt(nMatch[1]) / 10);
  const pMatch = lower.match(/lnbc(\d+)p/);
  if (pMatch) return Math.floor(parseInt(pMatch[1]) / 10000);
  return 0;
}

function getZapAmount(ev: Event): number {
  const bolt11Tag = ev.tags.find(t => t[0] === "bolt11");
  if (bolt11Tag?.[1]) {
    const sats = parseBolt11Amount(bolt11Tag[1]);
    if (sats > 0) return sats;
  }
  const descTag = ev.tags.find(t => t[0] === "description");
  if (descTag?.[1]) {
    try {
      const req = JSON.parse(descTag[1]);
      const amountTag = req.tags?.find((t: string[]) => t[0] === "amount");
      if (amountTag?.[1]) return Math.floor(parseInt(amountTag[1]) / 1000);
    } catch {}
  }
  return 0;
}

function fetchTopZappers(eventId: string, limit: number): Promise<TopZapper[]> {
  const existing = inflight.get(eventId);
  if (existing) return existing;

  const promise = (async () => {
    await acquireSlot();
    try {
      const relays = DEFAULT_RELAYS.slice(0, 3);
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [9735],
          "#e": [eventId],
          limit: 15,
        }),
        new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 5000)),
      ]) as Event[];

      const byPubkey = new Map<string, { amount: number; bestAmount: number; message: string; emoji: string }>();
      for (const ev of events) {
        const info = parseZapRequest(ev);
        const amount = getZapAmount(ev);
        if (!info || amount <= 0) continue;
        const existing = byPubkey.get(info.pubkey);
        if (existing) {
          existing.amount += amount;
          if (amount > existing.bestAmount) {
            existing.bestAmount = amount;
            if (info.message) existing.message = info.message;
            if (info.emoji) existing.emoji = info.emoji;
          }
        } else {
          byPubkey.set(info.pubkey, { amount, bestAmount: amount, message: info.message, emoji: info.emoji });
        }
      }
      const sorted = Array.from(byPubkey.entries())
        .map(([pubkey, d]) => ({ pubkey, amount: d.amount, message: d.message, emoji: d.emoji }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, limit);

      if (sorted.length > 0) {
        topZappersCache.set(eventId, { zappers: sorted, ts: Date.now() });
        if (topZappersCache.size > CACHE_MAX) {
          const firstKey = topZappersCache.keys().next().value;
          if (firstKey) topZappersCache.delete(firstKey);
        }
        const pubkeys = sorted.map(z => z.pubkey);
        fetchProfilesCached(pubkeys);
      }

      return sorted;
    } finally {
      releaseSlot();
      inflight.delete(eventId);
    }
  })();

  inflight.set(eventId, promise);
  return promise;
}

export function useTopZappers(eventId: string, hasZaps: boolean, limit = 3): TopZapper[] {
  const [zappers, setZappers] = useState<TopZapper[]>([]);
  const prevEventIdRef = useRef<string>("");

  useEffect(() => {
    if (!hasZaps || !eventId) {
      if (zappers.length > 0) setZappers([]);
      return;
    }

    if (prevEventIdRef.current !== eventId) {
      prevEventIdRef.current = eventId;
    }

    const cached = topZappersCache.get(eventId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setZappers(cached.zappers);
      return;
    }

    let cancelled = false;
    fetchTopZappers(eventId, limit).then(result => {
      if (!cancelled) setZappers(result);
    });

    return () => { cancelled = true; };
  }, [eventId, hasZaps, limit]);

  return zappers;
}
