import type { Event } from "nostr-tools";
import { eventStore } from "@/lib/nostr";
import { KIND_METADATA } from "@/lib/nostr-helpers";

export interface LnurlPayInfo {
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  allowsNostr?: boolean;
  nostrPubkey?: string;
  commentAllowed?: number;
  tag: string;
}

export function getLightningAddress(pubkey: string): string | null {
  const profile = eventStore.getReplaceable(KIND_METADATA, pubkey);
  if (!profile) return null;
  try {
    const content = JSON.parse(profile.content);
    if (content.lud16) return content.lud16;
    if (content.lud06) return content.lud06;
    return null;
  } catch {
    return null;
  }
}

const lnurlCache = new Map<string, { data: LnurlPayInfo; ts: number }>();
const LNURL_CACHE_TTL = 5 * 60 * 1000;

export async function resolveLnurl(addressOrLnurl: string): Promise<LnurlPayInfo> {
  if (!addressOrLnurl.includes("@")) {
    throw new Error("Only lightning addresses (user@domain) are supported");
  }

  const cacheKey = addressOrLnurl.trim().toLowerCase();
  const cached = lnurlCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LNURL_CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(`/api/lnurl/pay?address=${encodeURIComponent(addressOrLnurl)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `LNURL endpoint returned ${res.status}`);
  }
  const data = await res.json();

  if (data.status === "ERROR") {
    throw new Error(data.reason || "LNURL error");
  }

  const result = data as LnurlPayInfo;
  if (lnurlCache.size > 100) {
    const oldest = [...lnurlCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) lnurlCache.delete(oldest[0]);
  }
  lnurlCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

export function buildZapRequest(
  recipientPubkey: string,
  eventId: string,
  amountMsat: number,
  relays: string[],
  lnurl?: string,
  comment?: string
) {
  const tags: string[][] = [
    ["p", recipientPubkey],
    ["amount", amountMsat.toString()],
    ["relays", ...relays],
  ];

  if (eventId) {
    tags.splice(1, 0, ["e", eventId, relays[0] || ""]);
  }

  if (lnurl) {
    tags.push(["lnurl", lnurl]);
  }

  return {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: comment || "",
  };
}

export async function fetchZapInvoice(
  lnurlInfo: LnurlPayInfo,
  amountMsat: number,
  zapRequest?: Event,
  comment?: string
): Promise<string> {
  const params = new URLSearchParams({
    callback: lnurlInfo.callback,
    amount: amountMsat.toString(),
  });

  if (zapRequest && lnurlInfo.allowsNostr) {
    params.set("nostr", JSON.stringify(zapRequest));
  }

  if (comment && lnurlInfo.commentAllowed && lnurlInfo.commentAllowed > 0) {
    params.set("comment", comment.slice(0, lnurlInfo.commentAllowed));
  }

  const res = await fetch(`/api/lnurl/invoice?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Invoice request failed: ${res.status}`);
  }
  const data = await res.json();

  if (data.status === "ERROR") {
    throw new Error(data.reason || "Failed to get invoice");
  }

  if (!data.pr) throw new Error("No invoice returned");
  return data.pr;
}

export function formatSats(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(amount >= 10_000 ? 0 : 1)}k`;
  return amount.toString();
}

export async function payWithWebLN(invoice: string): Promise<boolean> {
  try {
    const webln = (window as any).webln;
    if (!webln) return false;
    await webln.enable();
    await webln.sendPayment(invoice);
    return true;
  } catch {
    return false;
  }
}
