import type { Event as NostrEvent, Filter } from "nostr-tools";
import { getGlobalSigner } from "./nip42-auth";
import { signWithTimeout } from "@/lib/signer-timeout";
import { fetchNip11, supportsNip } from "./nip11";
import { pool } from "./nostr";

export interface Nip86Response<T = unknown> {
  result?: T;
  error?: string;
  /**
   * The status the RELAY gave our proxy, when the proxy couldn't get usable
   * JSON out of it. 0 means no request ever completed (DNS, refused, timeout);
   * 5xx means the relay's own server failed. Both mean "we never got an
   * answer", which is not the same as "this relay has no management API" —
   * and without this field the two were the same value.
   */
  upstreamStatus?: number;
}

export interface PubkeyEntry {
  pubkey: string;
  reason?: string;
  timestamp?: number;
  created_at?: number;
  added_at?: number;
  since?: number;
  when?: number;
  ts?: number;
  [key: string]: unknown;
}

const TIMESTAMP_FIELDS = ["timestamp", "created_at", "added_at", "since", "when", "ts", "createdAt", "addedAt"] as const;

export function extractEntryTimestamp(entry: unknown): number | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const obj = entry as Record<string, unknown>;
  for (const field of TIMESTAMP_FIELDS) {
    const v = obj[field];
    if (typeof v === "number" && v > 0) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
      const parsed = Date.parse(v);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
    }
  }
  return undefined;
}

export function extractAddedAtMap(entries: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const pk = (e as { pubkey?: unknown }).pubkey;
    if (typeof pk !== "string" || !/^[0-9a-f]{64}$/i.test(pk)) continue;
    const ts = extractEntryTimestamp(e);
    if (ts) out[pk.toLowerCase()] = ts;
  }
  return out;
}

export type Nip86Method =
  | "allowpubkey"
  | "banpubkey"
  | "unallowpubkey"
  | "unbanpubkey"
  | "listallowedpubkeys"
  | "listbannedpubkeys"
  | "allowevent"
  | "banevent"
  | "listbannedevents"
  | "changerelayname"
  | "changerelaydescription"
  | "changerelayicon"
  | "changerelaybanner"
  | "changerelaymoderators"
  | "allowkind"
  | "disallowkind"
  | "listallowedkinds"
  | "listdisallowedkinds"
  | "blockip"
  | "unblockip"
  | "listblockedips";

async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeHttpUrl(relayUrl: string): string {
  const wsToHttp = relayUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");
  try {
    const u = new URL(wsToHttp);
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return wsToHttp.replace(/\/+$/, "");
  }
}

export async function nip86Call<T = unknown>(
  relayUrl: string,
  method: Nip86Method,
  params: string[] = [],
): Promise<Nip86Response<T>> {
  try {
    const signer = getGlobalSigner();
    if (!signer) {
      return { error: "No signer available. Sign in to manage relay." };
    }

    const httpUrl = normalizeHttpUrl(relayUrl);
    const body = JSON.stringify({ method, params });
    const payloadHash = await sha256Hex(body);

    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", httpUrl],
        ["method", "POST"],
        ["payload", payloadHash],
      ],
      content: "",
    };

    let signed;
    try {
      signed = await signWithTimeout(signer, authEvent as any);
    } catch (err) {
      return { error: `Signing failed: ${err instanceof Error ? err.message : "unknown error"}` };
    }

    let response;
    try {
      response = await fetch("/api/nip86", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relayUrl,
          method,
          params,
          authEvent: signed,
        }),
      });
    } catch (err) {
      return { error: `Network error: ${err instanceof Error ? err.message : "failed to reach proxy"}` };
    }

    if (response.status === 401) {
      return { error: "Unauthorized — your key may not have management access to this relay." };
    }

    if (!response.ok) {
      try {
        const errData = await response.json();
        if (errData.error) return { error: errData.error };
      } catch {}
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    try {
      const data = await response.json();
      if (data && typeof data === "object" && ("result" in data || "error" in data)) {
        return data as Nip86Response<T>;
      }
      return { error: "Relay returned non-NIP-86 response" };
    } catch {
      return { error: "Invalid JSON response from relay" };
    }
  } catch (err) {
    return { error: `Unexpected error: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

export async function allowPubkey(relayUrl: string, pubkey: string, reason?: string): Promise<Nip86Response<boolean>> {
  const params = [pubkey];
  if (reason) params.push(reason);
  return nip86Call<boolean>(relayUrl, "allowpubkey", params);
}

export async function banPubkey(relayUrl: string, pubkey: string, reason?: string): Promise<Nip86Response<boolean>> {
  const params = [pubkey];
  if (reason) params.push(reason);
  return nip86Call<boolean>(relayUrl, "banpubkey", params);
}

export async function unallowPubkey(relayUrl: string, pubkey: string, reason?: string): Promise<Nip86Response<boolean>> {
  const params = [pubkey];
  if (reason) params.push(reason);
  return nip86Call<boolean>(relayUrl, "unallowpubkey", params);
}

export async function unbanPubkey(relayUrl: string, pubkey: string, reason?: string): Promise<Nip86Response<boolean>> {
  const params = [pubkey];
  if (reason) params.push(reason);
  return nip86Call<boolean>(relayUrl, "unbanpubkey", params);
}

export async function listAllowedPubkeys(relayUrl: string): Promise<Nip86Response<PubkeyEntry[]>> {
  return nip86Call<PubkeyEntry[]>(relayUrl, "listallowedpubkeys");
}

export async function listBannedPubkeys(relayUrl: string): Promise<Nip86Response<PubkeyEntry[]>> {
  return nip86Call<PubkeyEntry[]>(relayUrl, "listbannedpubkeys");
}

export type Nip86SupportStatus =
  | "supported"
  | "advertised_but_nonfunctional"
  | "not_supported"
  /**
   * We could not ask. The relay's HTTP endpoint was down, DNS failed, the
   * request was blocked, or it 502'd.
   *
   * Distinct from `not_supported` on purpose, and not cosmetically: the caller
   * switches to a local-only allow/ban path whenever the status isn't
   * "supported", so collapsing this into "not_supported" told an operator their
   * relay has no management API AND quietly wrote their bans to localStorage
   * instead of to the relay that was about to come back up.
   */
  | "unreachable";

export async function changeRelayName(relayUrl: string, name: string): Promise<Nip86Response<boolean>> {
  return nip86Call<boolean>(relayUrl, "changerelayname", [name]);
}

export async function changeRelayDescription(relayUrl: string, description: string): Promise<Nip86Response<boolean>> {
  return nip86Call<boolean>(relayUrl, "changerelaydescription", [description]);
}

export async function changeRelayIcon(relayUrl: string, iconUrl: string): Promise<Nip86Response<boolean>> {
  return nip86Call<boolean>(relayUrl, "changerelayicon", [iconUrl]);
}

export async function changeRelayBanner(relayUrl: string, bannerUrl: string): Promise<Nip86Response<boolean>> {
  return nip86Call<boolean>(relayUrl, "changerelaybanner", [bannerUrl]);
}

export async function banEvent(relayUrl: string, eventId: string, reason?: string): Promise<Nip86Response<boolean>> {
  const params = [eventId];
  if (reason) params.push(reason);
  return nip86Call<boolean>(relayUrl, "banevent", params);
}

export async function changeRelayModerators(relayUrl: string, moderatorPubkeys: string[]): Promise<Nip86Response<boolean>> {
  return nip86Call<boolean>(relayUrl, "changerelaymoderators", moderatorPubkeys);
}

/**
 * Did the request fail to ARRIVE, rather than come back with an answer?
 *
 * nip86Call is a total function — every transport failure is flattened into a
 * plain `{ error: string }`, identical in shape to "this relay told us no". So
 * the string is all we have. Kept deliberately narrow: a 4xx means something
 * answered and declined, which IS a capability answer; only a dead socket or a
 * server-side 5xx means we never got to ask.
 */
function isTransportFailure(res: Nip86Response<unknown>): boolean {
  // The proxy's own verdict, when it has one. Checked FIRST because it is the
  // only signal derived from the actual HTTP exchange rather than from prose:
  // a relay that 502s serves an HTML error page, which reads exactly like a
  // relay serving its landing page unless you look at the status.
  if (res.upstreamStatus !== undefined) {
    if (res.upstreamStatus === 0 || res.upstreamStatus >= 500) return true;
  }
  const e = (res.error ?? "").toLowerCase();
  if (e.includes("network error") || e.includes("failed to reach")) return true;
  return /^http 5\d\d/.test(e);
}

export async function checkNip86Support(relayUrl: string): Promise<Nip86SupportStatus> {
  let advertisedInNip11 = false;
  try {
    const nip11 = await fetchNip11(relayUrl);
    if (nip11 && supportsNip(nip11, 86)) {
      advertisedInNip11 = true;
    }
  } catch {}

  console.log(`[NIP-86] Checking support for ${relayUrl}, NIP-11 advertised: ${advertisedInNip11}`);

  const signer = getGlobalSigner();
  console.log(`[NIP-86] Signer available: ${!!signer}`);

  if (signer) {
    console.log(`[NIP-86] Sending authenticated probe to ${relayUrl}...`);
    const probeResult = await nip86Call<PubkeyEntry[]>(relayUrl, "listallowedpubkeys");
    console.log(`[NIP-86] Probe result:`, JSON.stringify(probeResult).slice(0, 500));
    if (probeResult.result !== undefined) {
      console.log(`[NIP-86] ✓ Supported (got result)`);
      return "supported";
    }
    if (probeResult.error) {
      const err = probeResult.error.toLowerCase();
      if (err.includes("unauthorized") || err.includes("signing failed") || err.includes("forbidden") || err.includes("restricted") || err.includes("not allowed")) {
        console.log(`[NIP-86] ✓ Supported (auth error means it understood the protocol)`);
        return "supported";
      }
      // Never got an answer. Reporting "not supported" here would be a claim
      // about the relay's capabilities based on a request that never landed.
      if (isTransportFailure(probeResult)) {
        console.log(`[NIP-86] ? Unreachable (upstream ${probeResult.upstreamStatus ?? "n/a"}): ${probeResult.error}`);
        return "unreachable";
      }
      if (err.includes("html") || err.includes("non-json") || err.includes("non-nip-86")) {
        console.log(`[NIP-86] ✗ HTML/non-JSON response, advertised: ${advertisedInNip11}`);
        return advertisedInNip11 ? "advertised_but_nonfunctional" : "not_supported";
      }
    }
    console.log(`[NIP-86] Fallback decision: advertisedInNip11=${advertisedInNip11}`);
    return advertisedInNip11 ? "supported" : "not_supported";
  }

  try {
    const response = await fetch("/api/nip86", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relayUrl,
        method: "listallowedpubkeys",
        params: [],
      }),
    });

    if (response.status === 401 || response.status === 403) {
      return "supported";
    }

    // The proxy or the relay's HTTP endpoint fell over — not an answer about
    // whether the relay speaks NIP-86.
    if (response.status >= 500) {
      return "unreachable";
    }

    if (response.ok) {
      try {
        const data = await response.json();
        if (data && typeof data === "object") {
          // Same trap as the signed path: the proxy answers 200 with an
          // isHtml body whether the relay served a landing page or a 502
          // error page. Only upstreamStatus tells them apart.
          if (isTransportFailure(data as Nip86Response<unknown>)) {
            return "unreachable";
          }
          if (data.isHtml || data.raw) {
            return advertisedInNip11 ? "advertised_but_nonfunctional" : "not_supported";
          }
          if ("result" in data || "error" in data) {
            return "supported";
          }
        }
      } catch {}
    }
  } catch {
    // fetch() itself threw: offline, DNS, CORS. We never asked.
    return "unreachable";
  }

  return advertisedInNip11 ? "advertised_but_nonfunctional" : "not_supported";
}

const KIND_REPORT = 1984;
const KIND_RELAY_AUDIT = 1986;

export interface Nip86HistoryResult {
  allow: Record<string, number>;
  ban: Record<string, number>;
}

export interface Nip86HistoryOptions {
  moderators?: string[];
  allowPubkeys?: string[];
  banPubkeys?: string[];
  timeoutMs?: number;
}

function applyEarliest(map: Record<string, number>, pk: string, ts: number) {
  if (!ts || !pk) return;
  if (!map[pk] || ts < map[pk]) map[pk] = ts;
}

export async function fetchNip86History(
  relayUrl: string,
  options: Nip86HistoryOptions = {},
): Promise<Nip86HistoryResult> {
  const { moderators, allowPubkeys, banPubkeys, timeoutMs = 6000 } = options;
  const allowList = (allowPubkeys || []).map(p => p.toLowerCase());
  const banList = (banPubkeys || []).map(p => p.toLowerCase());
  const trackedAllow = new Set<string>(allowList);
  const trackedBan = new Set<string>(banList);
  const trackedAll = new Set<string>(allowList.concat(banList));

  if (trackedAll.size === 0) {
    return { allow: {}, ban: {} };
  }

  const modAuthors = (moderators || [])
    .filter(m => typeof m === "string" && /^[0-9a-f]{64}$/i.test(m))
    .map(m => m.toLowerCase());

  const pubkeyList = Array.from(trackedAll);

  const auditFilter: Filter = {
    kinds: [KIND_RELAY_AUDIT],
    "#p": pubkeyList,
    limit: 1000,
  };
  const reportFilter: Filter | null = modAuthors.length > 0
    ? { kinds: [KIND_REPORT], authors: modAuthors, "#p": pubkeyList, limit: 1000 }
    : null;

  return new Promise<Nip86HistoryResult>((resolve) => {
    const allow: Record<string, number> = {};
    const ban: Record<string, number> = {};
    const subs: SubCloser[] = [];
    let pending = reportFilter ? 2 : 1;
    let closed = false;

    const finishOne = () => {
      if (closed) return;
      pending--;
      if (pending <= 0) {
        closed = true;
        for (const s of subs) { try { s.close(); } catch {} }
        clearTimeout(timer);
        resolve({ allow, ban });
      }
    };

    const onevent = (e: NostrEvent) => {
      if (closed) return;
      const ts = e.created_at;
      if (!ts) return;
      const targets = e.tags
        .filter(t => t[0] === "p" && typeof t[1] === "string" && /^[0-9a-f]{64}$/i.test(t[1]))
        .map(t => t[1].toLowerCase())
        .filter(pk => trackedAll.has(pk));
      if (targets.length === 0) return;

      if (e.kind === KIND_REPORT) {
        for (const pk of targets) {
          if (trackedBan.has(pk)) applyEarliest(ban, pk, ts);
        }
        return;
      }

      if (e.kind === KIND_RELAY_AUDIT) {
        const action = classifyAuditAction(e.tags);
        if (action === "unknown") return;
        for (const pk of targets) {
          if (action === "allow" && trackedAllow.has(pk)) applyEarliest(allow, pk, ts);
          if (action === "ban" && trackedBan.has(pk)) applyEarliest(ban, pk, ts);
        }
      }
    };

    subs.push(pool.subscribeMany([relayUrl], auditFilter, { onevent, oneose: finishOne }));
    if (reportFilter) {
      subs.push(pool.subscribeMany([relayUrl], reportFilter, { onevent, oneose: finishOne }));
    }

    const timer = setTimeout(() => {
      if (closed) return;
      closed = true;
      for (const s of subs) { try { s.close(); } catch {} }
      resolve({ allow, ban });
    }, timeoutMs);
  });
}

interface SubCloser { close: () => void; }

const ALLOW_ACTIONS = new Set([
  "allow",
  "allowpubkey",
  "add",
  "addpubkey",
  "permit",
  "approve",
  "whitelist",
]);

const BAN_ACTIONS = new Set([
  "ban",
  "banpubkey",
  "block",
  "blockpubkey",
  "deny",
  "blacklist",
]);

export function classifyAuditAction(tags: string[][]): "allow" | "ban" | "unknown" {
  for (const tag of tags) {
    if (tag[0] !== "action" && tag[0] !== "method") continue;
    const value = tag[1]?.toLowerCase().trim();
    if (!value) continue;
    if (ALLOW_ACTIONS.has(value)) return "allow";
    if (BAN_ACTIONS.has(value)) return "ban";
    return "unknown";
  }
  return "unknown";
}
