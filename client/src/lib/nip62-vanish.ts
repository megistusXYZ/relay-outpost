import type { ISigner } from "applesauce-signers";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { pool, DEFAULT_RELAYS, filterBlockedRelays } from "./nostr";
import { getOutpostRelays } from "./outpost-relays";
import { getAllWriteRelays, getRelayListTimestamp, fetchRelayLists } from "./outbox";
import { signWithTimeout, SIGNER_SIGN_TIMEOUT } from "./signer-timeout";
import { removeAccount as removeRegisteredAccount } from "./account-registry";

export interface VanishRelayResult {
  relay: string;
  status: "accepted" | "rejected";
  error?: string;
}

export interface VanishBroadcastResult {
  eventId: string;
  results: VanishRelayResult[];
  successCount: number;
  total: number;
}

const PUBLISH_TIMEOUT_MS = 10_000;
const RELAY_LIST_WAIT_MS = 2_500;

/**
 * Canonicalize a relay URL for dedupe. Lowercases the scheme+host, forces
 * `wss://`, strips trailing slashes. We need this stronger than a plain
 * trim because NIP-62 broadcasts combine several sources (NIP-65 write
 * list, Outpost relays, DEFAULT_RELAYS) that may disagree on case or
 * scheme and would otherwise produce duplicate publish attempts.
 */
function normalizeRelayUrl(url: string): string {
  let u = (url || "").trim();
  if (!u) return "";
  if (u.startsWith("ws://")) u = "wss://" + u.slice(5);
  if (!u.startsWith("wss://") && !u.startsWith("wss:/")) {
    if (u.startsWith("//")) u = "wss:" + u;
    else u = "wss://" + u;
  }
  try {
    const parsed = new URL(u);
    parsed.protocol = "wss:";
    let out = `wss://${parsed.host.toLowerCase()}${parsed.pathname || ""}`;
    if (parsed.search) out += parsed.search;
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    if (u.endsWith("/")) u = u.slice(0, -1);
    return u.toLowerCase();
  }
}

/**
 * Assemble the relay set we'll broadcast the kind-62 to. We intentionally
 * use the *uncapped* NIP-65 write list because vanish wants maximum
 * coverage: missing a relay means that relay keeps holding the user's
 * history. We also union the Outpost-configured relays and the default
 * fallback set so we still have somewhere to send to even if we never
 * observed a NIP-65 list for this pubkey.
 */
export function computeVanishTargets(pubkey: string): string[] {
  const set = new Set<string>();
  for (const r of getAllWriteRelays(pubkey, [])) {
    const n = normalizeRelayUrl(r);
    if (n) set.add(n);
  }
  for (const r of getOutpostRelays().map((o) => o.url)) {
    const n = normalizeRelayUrl(r);
    if (n) set.add(n);
  }
  for (const r of DEFAULT_RELAYS) {
    const n = normalizeRelayUrl(r);
    if (n) set.add(n);
  }
  return filterBlockedRelays(Array.from(set));
}

/**
 * Force a NIP-65 lookup for this pubkey and wait up to
 * {@link RELAY_LIST_WAIT_MS} for it to land in the outbox cache before
 * returning the final target list. Guarantees we compute targets against
 * the freshest relay-list data we can reach at confirm time, so the user
 * isn't silently broadcasting to an outdated subset of relays.
 */
export async function getVanishTargetRelaysAsync(pubkey: string): Promise<string[]> {
  // Capture the pre-fetch created_at so we can detect a *refresh*, not
  // merely the presence of a (possibly stale) cache entry.
  const baselineTs = getRelayListTimestamp(pubkey);
  try { fetchRelayLists([pubkey], { force: true }); } catch {}
  const deadline = Date.now() + RELAY_LIST_WAIT_MS;
  while (Date.now() < deadline) {
    const nowTs = getRelayListTimestamp(pubkey);
    if (nowTs > baselineTs) break; // refresh observed
    await new Promise((r) => setTimeout(r, 100));
  }
  return computeVanishTargets(pubkey);
}

/** Synchronous snapshot — used for initial dialog render only. */
export function getVanishTargetRelays(pubkey: string): string[] {
  try { fetchRelayLists([pubkey]); } catch {}
  return computeVanishTargets(pubkey);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(
        () => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s (${label})`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(t!));
}

/**
 * Build, sign, and broadcast a NIP-62 "Request to Vanish" (kind 62).
 * Returns per-relay results so the UI can show the user exactly which
 * relays accepted the request. Throws if signing fails — callers treat
 * that as the signal to leave the local account intact for retry.
 */
export async function publishVanishRequest(opts: {
  signer: ISigner;
  pubkey: string;
  relays: string[];
  reason?: string;
}): Promise<VanishBroadcastResult> {
  const { signer, pubkey, relays } = opts;
  const template: EventTemplate = {
    kind: 62,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: opts.reason?.trim() || "",
  };

  const signed = (await signWithTimeout(signer, template, SIGNER_SIGN_TIMEOUT)) as NostrEvent;
  if (signed.pubkey !== pubkey) {
    // Signer returned a signature for a different key. Refuse to broadcast
    // — a vanish event for the wrong pubkey is at best useless and at
    // worst identity-confusing.
    throw new Error("Signed vanish event pubkey does not match the active account");
  }
  const targets = Array.from(
    new Set(relays.map(normalizeRelayUrl).filter((u) => u.length > 0)),
  );
  if (targets.length === 0) {
    return { eventId: signed.id, results: [], successCount: 0, total: 0 };
  }

  const promises = pool.publish(targets, signed);
  const settled = await Promise.allSettled(
    promises.map((p, i) => withTimeout(p, PUBLISH_TIMEOUT_MS, targets[i])),
  );
  const results: VanishRelayResult[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return { relay: targets[i], status: "accepted" };
    const err = r.reason instanceof Error ? r.reason.message : String(r.reason ?? "failed");
    return { relay: targets[i], status: "rejected", error: err };
  });
  const successCount = results.filter((r) => r.status === "accepted").length;
  console.log(
    `[vanish] kind-62 ${signed.id.slice(0, 8)} → ${successCount}/${targets.length} relays`,
    results.map(
      (r) =>
        `${r.status === "accepted" ? "OK" : "FAIL"} ${r.relay}${r.error ? ` (${r.error})` : ""}`,
    ),
  );
  return { eventId: signed.id, results, successCount, total: targets.length };
}

/**
 * Wipe every identity-scoped value this client may hold for the given
 * pubkey: encrypted key blob, resume-signup draft, onboarding marker,
 * first-post draft, cached pubkey, login-method, bunker URI, and any
 * saved QR (NIP-46) session key. Run this *before* calling logout() so
 * persistent storage is clean even if the in-memory teardown stumbles.
 */
export function performFullLocalWipe(pubkey: string | null): void {
  // Multi-account registry entry + per-pubkey namespaced credential copies
  // (bunker URI, QR session, encrypted blob, opt-in plaintext secret).
  if (pubkey) {
    try { removeRegisteredAccount(pubkey); } catch {}
  }
  // Encrypted-key blob (NIP-49 ncryptsec + metadata).
  try { localStorage.removeItem("relay-outpost-local-account"); } catch {}
  // Plaintext "stay signed in" secret (only set when the user opted into
  // device-resident persistence on import or via the unlock-screen promote).
  try { localStorage.removeItem("relay-outpost-local-secret"); } catch {}
  // "Stay signed in next time?" dismissal markers — clearing these too so
  // re-importing the same npub on a wiped device sees the prompt fresh.
  try { localStorage.removeItem("relay-outpost-stay-nudge-dismissed"); } catch {}
  // Short-lived signup draft in sessionStorage.
  try { sessionStorage.removeItem("relay-outpost-signup-draft"); } catch {}
  // Per-pubkey onboarding-complete marker.
  try {
    const raw = localStorage.getItem("relay-outpost-onboarding-complete");
    if (raw && pubkey) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const next = arr.filter((p: string) => p !== pubkey);
        if (next.length === 0) localStorage.removeItem("relay-outpost-onboarding-complete");
        else localStorage.setItem("relay-outpost-onboarding-complete", JSON.stringify(next));
      }
    }
  } catch {}
  // Unpublished first-post draft for this pubkey.
  if (pubkey) {
    try {
      localStorage.removeItem(`relay-outpost-onboarding-first-post-draft:${pubkey}`);
    } catch {}
  }
  // Cached pubkey / login-method / bunker config / QR-session secret.
  try { localStorage.removeItem("relay-outpost-pubkey"); } catch {}
  try { localStorage.removeItem("relay-outpost-login-method"); } catch {}
  try { localStorage.removeItem("relay-outpost-bunker-uri"); } catch {}
  try { localStorage.removeItem("relay-outpost-qr-session"); } catch {}
}
