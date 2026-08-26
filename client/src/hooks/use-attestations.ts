import { useState, useEffect, useCallback, useRef } from "react";
import { pool, DEFAULT_RELAYS, fetchProfilesCached, publishEvent } from "@/lib/nostr";
import { clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";

export type AttestationStatus = "accepted" | "rejected" | "verifying" | "verified" | "revoked" | "legacy";
export type AttestationValidity = "valid" | "invalid" | "unknown";
export type AttestationType = "vouch" | "identity";

export interface Attestation {
  attesterPubkey: string;
  subjectPubkey: string;
  content: string;
  createdAt: number;
  eventId: string;
  kind: number;
  status: AttestationStatus;
  validity: AttestationValidity;
  validFrom: number | null;
  validTo: number | null;
  type: AttestationType;
}

interface CacheEntry {
  attestations: Attestation[];
  timestamp: number;
  isError: boolean;
}

const attestationCache = new Map<string, CacheEntry>();
const pendingFetches = new Map<string, Promise<Attestation[]>>();
const listeners = new Map<string, Set<(atts: Attestation[]) => void>>();

const KIND_LABEL = 1985;
const KIND_ATTESTATION_LEGACY = 30382;
export const KIND_ATTESTATION = 31871;
// NIP-22 generic comment — used here for a profile owner's public response to a vouch.
export const KIND_VOUCH_RESPONSE = 1111;
const ATTESTATION_LABELS = ["attestation", "identity", "vouch", "verification"];
const FETCH_TIMEOUT = 8000;
const ERROR_CACHE_TTL = 60_000;

export function getTag(tags: string[][], name: string): string | null {
  const tag = tags.find((t) => t[0] === name);
  return tag?.[1] ?? null;
}

export function parseStatus(raw: string | null): AttestationStatus {
  if (!raw) return "legacy";
  const lower = raw.toLowerCase();
  if (lower === "accepted" || lower === "rejected" || lower === "verifying" || lower === "verified" || lower === "revoked") {
    return lower as AttestationStatus;
  }
  return "legacy";
}

export function parseValidity(raw: string | null): AttestationValidity {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower === "valid" || lower === "invalid") return lower as AttestationValidity;
  return "unknown";
}

// Reviews come in two flavours: a "vouch" (I personally vouch for this person) and
// an "identity" attestation (I confirm this npub belongs to who it claims). The
// kind-31871 event carries this in a ["t", "vouch"|"identity"] tag. Default to
// "vouch" when the tag is absent, since a free-text review is a vouch by nature.
export function parseType(tags: string[][]): AttestationType {
  for (const t of tags) {
    if (t[0] !== "t") continue;
    const v = (t[1] || "").toLowerCase();
    if (v === "identity") return "identity";
    if (v === "vouch") return "vouch";
  }
  return "vouch";
}

export function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

// Some "attestations" (kind 1985 / 30382 emitted by metrics/indexer tools) carry
// a JSON-object payload as their content, e.g.
//   {"followers_count":0,"following_count":0,"notes_count":0,"reactions_received":0}
// These are MACHINE data attestations, not human vouches, and dumping them as raw
// text in the Trust Reviews panel is noise. Detect them so we can filter them out
// at the hook level (every consumer benefits, and the panel's counts stay correct).
// We keep prose vouches AND genuinely-empty ones (silent vouches).
export function isDataPayloadContent(content: string): boolean {
  const trimmed = (content || "").trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return true;
  } catch {
    return false;
  }
}

function isExpired(att: Attestation): boolean {
  if (!att.validTo) return false;
  return att.validTo < Math.floor(Date.now() / 1000);
}

function isNotYetValid(att: Attestation): boolean {
  if (!att.validFrom) return false;
  return att.validFrom > Math.floor(Date.now() / 1000);
}

export function isActiveAttestation(att: Attestation): boolean {
  if (att.status === "revoked" || att.status === "rejected") return false;
  if (att.validity === "invalid") return false;
  if (isExpired(att)) return false;
  if (isNotYetValid(att)) return false;
  return true;
}

export function getAttestationStatusLabel(att: Attestation): string {
  if (isExpired(att)) return "Expired";
  if (isNotYetValid(att)) return "Pending";
  switch (att.status) {
    case "verified": return "Verified";
    case "accepted": return "Accepted";
    case "verifying": return "Verifying";
    case "rejected": return "Rejected";
    case "revoked": return "Revoked";
    // A peer vouch carries no formal verification "s" status. Read it as
    // "Identity" for identity attestations, otherwise "Vouched".
    case "legacy": return att.type === "identity" ? "Identity" : "Vouched";
  }
}

export function getAttestationStatusColor(att: Attestation): string {
  if (isExpired(att) || isNotYetValid(att)) return "text-muted-foreground/60";
  switch (att.status) {
    case "verified": return "text-emerald-500";
    case "accepted": return "text-emerald-400/80";
    case "verifying": return "text-amber-400/80";
    case "rejected": return "text-red-400/80";
    case "revoked": return "text-red-500/80";
    case "legacy": return "text-emerald-400/60";
  }
}

function notifyListeners(pubkey: string, atts: Attestation[]) {
  const subs = listeners.get(pubkey);
  if (subs) subs.forEach((cb) => cb(atts));
}

async function doFetch(pubkey: string): Promise<Attestation[]> {
  const relays = DEFAULT_RELAYS.slice(0, 4);
  const results: Attestation[] = [];
  const seen = new Map<string, number>();

  const [labelEvents, legacyEvents, nipEvents] = await Promise.all([
    Promise.race([
      pool.querySync(relays, {
        kinds: [KIND_LABEL],
        "#p": [pubkey],
        limit: 30,
      }),
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), FETCH_TIMEOUT)),
    ]) as Promise<any[]>,
    Promise.race([
      pool.querySync(relays, {
        kinds: [KIND_ATTESTATION_LEGACY],
        "#p": [pubkey],
        limit: 30,
      }),
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), FETCH_TIMEOUT)),
    ]) as Promise<any[]>,
    Promise.race([
      pool.querySync(relays, {
        kinds: [KIND_ATTESTATION],
        "#p": [pubkey],
        limit: 50,
      }),
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), FETCH_TIMEOUT)),
    ]) as Promise<any[]>,
  ]);

  function addOrReplace(att: Attestation, key: string) {
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      if (att.createdAt > results[existingIdx].createdAt) {
        results[existingIdx] = att;
      }
      return;
    }
    seen.set(key, results.length);
    results.push(att);
  }

  for (const ev of nipEvents) {
    if (ev.pubkey === pubkey) continue;
    const key = `${ev.pubkey}:${ev.kind}`;

    const status = parseStatus(getTag(ev.tags, "s"));
    const validity = parseValidity(getTag(ev.tags, "v"));
    const validFrom = parseTimestamp(getTag(ev.tags, "valid_from"));
    const validTo = parseTimestamp(getTag(ev.tags, "valid_to"));

    addOrReplace({
      attesterPubkey: ev.pubkey,
      subjectPubkey: pubkey,
      content: ev.content || "",
      createdAt: ev.created_at,
      eventId: ev.id,
      kind: KIND_ATTESTATION,
      status,
      validity,
      validFrom,
      validTo,
      type: parseType(ev.tags),
    }, key);
  }

  for (const ev of labelEvents) {
    const lTags = ev.tags.filter((t: string[]) => t[0] === "l");
    const isAttestation = lTags.some((t: string[]) =>
      ATTESTATION_LABELS.some((label) => t[1]?.toLowerCase().includes(label))
    );
    if (!isAttestation) continue;
    if (ev.pubkey === pubkey) continue;
    const key = `${ev.pubkey}:${ev.kind}`;
    addOrReplace({
      attesterPubkey: ev.pubkey,
      subjectPubkey: pubkey,
      content: ev.content || "",
      createdAt: ev.created_at,
      eventId: ev.id,
      kind: KIND_LABEL,
      status: "legacy",
      validity: "unknown",
      validFrom: null,
      validTo: null,
      type: parseType(ev.tags),
    }, key);
  }

  for (const ev of legacyEvents) {
    if (ev.pubkey === pubkey) continue;
    const key = `${ev.pubkey}:${ev.kind}`;
    const pTags = ev.tags.filter((t: string[]) => t[0] === "p" && t[1] === pubkey);
    if (pTags.length === 0) continue;
    const contentLower = (ev.content || "").toLowerCase();
    const isVouch =
      contentLower.includes("attest") ||
      contentLower.includes("vouch") ||
      contentLower.includes("verif") ||
      contentLower.includes("new account") ||
      contentLower.includes("new npub") ||
      contentLower.includes("identity");
    if (!isVouch && ev.content.length === 0) continue;
    addOrReplace({
      attesterPubkey: ev.pubkey,
      subjectPubkey: pubkey,
      content: ev.content || "",
      createdAt: ev.created_at,
      eventId: ev.id,
      kind: KIND_ATTESTATION_LEGACY,
      status: "legacy",
      validity: "unknown",
      validFrom: null,
      validTo: null,
      type: parseType(ev.tags),
    }, key);
  }

  // Drop machine data-payload attestations (JSON-object content) — these are not
  // human vouches and should never reach any consumer (panel counts, Search
  // vouches browser, etc.). Prose vouches and silent (empty) vouches are kept.
  const humanResults = results.filter((att) => !isDataPayloadContent(att.content));

  humanResults.sort((a, b) => {
    const aActive = isActiveAttestation(a) ? 1 : 0;
    const bActive = isActiveAttestation(b) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const statusPriority: Record<AttestationStatus, number> = {
      verified: 5, accepted: 4, verifying: 3, legacy: 2, rejected: 1, revoked: 0,
    };
    const aPri = statusPriority[a.status] ?? 0;
    const bPri = statusPriority[b.status] ?? 0;
    if (aPri !== bPri) return bPri - aPri;
    return b.createdAt - a.createdAt;
  });

  return humanResults;
}

// Publish a peer "vouch" (kind 31871) about another user. The event is
// addressable on ["d", subjectPubkey], so re-vouching the same person UPDATES
// the author's existing vouch rather than stacking duplicates. We include BOTH
// ["p", subject] (which the read-side fetch filters on via "#p") and
// ["d", subject] (for replaceability) so the new vouch shows in their panel.
export async function publishVouch(opts: {
  signer: any;
  authorPubkey: string;
  subjectPubkey: string;
  type: AttestationType;
  content: string;
}): Promise<boolean> {
  const { signer, authorPubkey, subjectPubkey, type, content } = opts;
  if (!signer) return false;
  // Self-vouches are meaningless (and the read-side skips ev.pubkey === subject).
  if (authorPubkey === subjectPubkey) return false;

  const tags: string[][] = [
    ["d", subjectPubkey],
    ["p", subjectPubkey],
    ["t", type],
    ["s", "vouched"],
    ["alt", "Trust vouch"],
    ...clientTags(),
  ];

  const eventTemplate = {
    kind: KIND_ATTESTATION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: content.trim(),
  };

  try {
    const signed = await signWithTimeout(signer, eventTemplate);
    if (!signed) return false;
    await publishEvent(signed, DEFAULT_RELAYS);
    // Drop the cached attestations for the subject so the next fetch hits the
    // network and the new/updated vouch is picked up.
    attestationCache.delete(subjectPubkey);
    return true;
  } catch (err) {
    console.error("[Attestations] publishVouch error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Authored vouches — the OTHER direction from doFetch(). These are the vouches a
// user has WRITTEN about other people (author = the user). Used by the "By you"
// tab on the Trust Reviews page.
// ---------------------------------------------------------------------------

export interface AuthoredAttestation {
  /** Who the vouch is about (from the ["d", subject] tag). */
  subjectPubkey: string;
  type: AttestationType;
  /** The free-text review body (event content). */
  note: string;
  timestamp: number;
  eventId: string;
}

/**
 * Pure parse + dedup for a user's authored kind-31871 vouches. Given the raw
 * events (all authored by one pubkey), returns one entry per subject — the
 * newest wins, since these events are addressable on ["d", subject]. Machine
 * data-payload attestations (JSON-object content) and self-vouches are dropped.
 * Result is sorted newest-first.
 */
export function parseAuthoredAttestations(
  events: { id: string; pubkey: string; content?: string; created_at: number; tags: string[][] }[],
): AuthoredAttestation[] {
  const bySubject = new Map<string, AuthoredAttestation>();

  for (const ev of events) {
    // Subject is the addressable d-tag; fall back to the p-tag if absent.
    const subjectPubkey = getTag(ev.tags, "d") || getTag(ev.tags, "p");
    if (!subjectPubkey) continue;
    // A self-vouch is meaningless (mirrors publishVouch's guard).
    if (subjectPubkey === ev.pubkey) continue;
    const content = ev.content || "";
    // Skip machine metrics payloads — not human vouches.
    if (isDataPayloadContent(content)) continue;

    const existing = bySubject.get(subjectPubkey);
    if (existing && existing.timestamp >= ev.created_at) continue;

    bySubject.set(subjectPubkey, {
      subjectPubkey,
      type: parseType(ev.tags),
      note: content,
      timestamp: ev.created_at,
      eventId: ev.id,
    });
  }

  return Array.from(bySubject.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Fetch the vouches a user has AUTHORED (kind-31871, authors=[pubkey]). Follows
 * the same relay/timeout pattern as doFetch(). Returns latest-per-subject.
 */
export async function fetchAuthoredAttestations(pubkey: string): Promise<AuthoredAttestation[]> {
  const relays = DEFAULT_RELAYS.slice(0, 4);
  const events = (await Promise.race([
    pool.querySync(relays, { kinds: [KIND_ATTESTATION], authors: [pubkey], limit: 100 }),
    new Promise<any[]>((resolve) => setTimeout(() => resolve([]), FETCH_TIMEOUT)),
  ])) as any[];
  return parseAuthoredAttestations(events);
}

/**
 * Revoke one of the user's own vouches via a NIP-09 deletion request. Targets
 * both the event id and the addressable coordinate (31871:author:subject) so
 * relays drop every version. Invalidates the subject's read-side cache so their
 * panel refetches without the removed vouch.
 */
export async function revokeVouch(opts: {
  signer: any;
  authorPubkey: string;
  subjectPubkey: string;
  eventId: string;
}): Promise<boolean> {
  const { signer, authorPubkey, subjectPubkey, eventId } = opts;
  if (!signer) return false;

  const eventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", eventId],
      ["a", `${KIND_ATTESTATION}:${authorPubkey}:${subjectPubkey}`],
      ["k", String(KIND_ATTESTATION)],
      ...clientTags(),
    ] as string[][],
    content: "Vouch removed",
  };

  try {
    const signed = await signWithTimeout(signer, eventTemplate);
    if (!signed) return false;
    await publishEvent(signed, DEFAULT_RELAYS);
    // The subject's received-vouch panel should refetch without this vouch.
    attestationCache.delete(subjectPubkey);
    return true;
  } catch (err) {
    console.error("[Attestations] revokeVouch error:", err);
    return false;
  }
}

// NIP-22 (kind 1111) public response a profile OWNER can publish under a vouch
// written about them. It references the vouch event (uppercase = root scope,
// lowercase = parent; same here since the comment hangs directly off the vouch)
// and the vouch author. Re-responding just publishes a newer 1111; the fetch
// below keeps only the latest per vouch id. Signer is required.
export async function publishVouchResponse(opts: {
  signer: any;
  subjectPubkey: string;
  vouch: { eventId: string; attesterPubkey: string };
  content: string;
}): Promise<boolean> {
  const { signer, subjectPubkey, vouch, content } = opts;
  if (!signer) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;

  const tags: string[][] = [
    ["E", vouch.eventId],
    ["e", vouch.eventId],
    ["K", String(KIND_ATTESTATION)],
    ["k", String(KIND_ATTESTATION)],
    ["P", vouch.attesterPubkey],
    ["p", vouch.attesterPubkey],
    ["alt", "Response to a trust vouch"],
    ...clientTags(),
  ];

  const eventTemplate = {
    kind: KIND_VOUCH_RESPONSE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: trimmed,
  };

  try {
    const signed = await signWithTimeout(signer, eventTemplate);
    if (!signed) return false;
    await publishEvent(signed, DEFAULT_RELAYS);
    // Invalidate the response cache for this subject so a refetch sees it.
    vouchResponseCache.delete(subjectPubkey);
    return true;
  } catch (err) {
    console.error("[Attestations] publishVouchResponse error:", err);
    return false;
  }
}

export interface VouchResponse {
  eventId: string;
  vouchId: string;
  content: string;
  createdAt: number;
}

// Cache the LATEST owner response per vouch id, keyed by subject pubkey, so the
// panel doesn't refetch on every render. subjectPubkey -> Map<vouchId, response>.
const vouchResponseCache = new Map<string, Map<string, VouchResponse>>();

// Fetch the profile owner's (subject's) kind-1111 responses that #e-tag any of
// the given vouch ids. Returns a Map<vouchId, latest response>. Authored-by the
// subject is enforced via the `authors` filter so only the owner's responses count.
export async function fetchVouchResponses(
  subjectPubkey: string,
  vouchIds: string[]
): Promise<Map<string, VouchResponse>> {
  if (vouchIds.length === 0) return new Map();

  const cached = vouchResponseCache.get(subjectPubkey);
  if (cached) return cached;

  const relays = DEFAULT_RELAYS.slice(0, 4);
  const byVouch = new Map<string, VouchResponse>();

  try {
    const events = (await Promise.race([
      pool.querySync(relays, {
        kinds: [KIND_VOUCH_RESPONSE],
        authors: [subjectPubkey],
        "#e": vouchIds,
        limit: 100,
      }),
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), FETCH_TIMEOUT)),
    ])) as any[];

    for (const ev of events) {
      if (ev.pubkey !== subjectPubkey) continue;
      // The vouch this response hangs off: prefer the "e" (parent) tag.
      const vouchId = getTag(ev.tags, "e");
      if (!vouchId || !vouchIds.includes(vouchId)) continue;
      const existing = byVouch.get(vouchId);
      if (!existing || ev.created_at > existing.createdAt) {
        byVouch.set(vouchId, {
          eventId: ev.id,
          vouchId,
          content: ev.content || "",
          createdAt: ev.created_at,
        });
      }
    }
  } catch (err) {
    console.error("[Attestations] fetchVouchResponses error:", err);
  }

  vouchResponseCache.set(subjectPubkey, byVouch);
  return byVouch;
}

/**
 * Hook wrapper around fetchAuthoredAttestations for the "By you" tab. Prefetches
 * the subjects' profiles so the timeline can render avatars/names, and exposes a
 * local optimistic `remove(subjectPubkey)` for the revoke flow.
 */
export function useAuthoredAttestations(pubkey: string | null) {
  const [authored, setAuthored] = useState<AuthoredAttestation[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    try {
      const results = await fetchAuthoredAttestations(pubkey);
      if (!mountedRef.current) return;
      if (results.length > 0) fetchProfilesCached(results.map((a) => a.subjectPubkey));
      setAuthored(results);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setFetched(true);
      }
    }
  }, [pubkey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setAuthored([]);
    setFetched(false);
    if (pubkey) void refetch();
  }, [pubkey, refetch]);

  // Optimistic local removal — drop the subject's card immediately after revoke.
  const removeLocal = useCallback((subjectPubkey: string) => {
    setAuthored((prev) => prev.filter((a) => a.subjectPubkey !== subjectPubkey));
  }, []);

  return { authored, loading, fetched, refetch, removeLocal };
}

export function useAttestations(pubkey: string) {
  const cached = attestationCache.get(pubkey);
  const isCacheValid = cached && (!cached.isError || Date.now() - cached.timestamp < ERROR_CACHE_TTL);

  const [attestations, setAttestations] = useState<Attestation[]>(
    () => (isCacheValid ? cached.attestations : [])
  );
  const [fetched, setFetched] = useState(() => !!isCacheValid);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const listener = (atts: Attestation[]) => {
      if (mountedRef.current) {
        setAttestations(atts);
        setFetched(true);
      }
    };
    let subs = listeners.get(pubkey);
    if (!subs) {
      subs = new Set();
      listeners.set(pubkey, subs);
    }
    subs.add(listener);
    return () => {
      mountedRef.current = false;
      subs!.delete(listener);
      if (subs!.size === 0) listeners.delete(pubkey);
    };
  }, [pubkey]);

  const fetchAttestations = useCallback(async () => {
    const existing = attestationCache.get(pubkey);
    if (existing && (!existing.isError || Date.now() - existing.timestamp < ERROR_CACHE_TTL)) return;

    if (pendingFetches.has(pubkey)) {
      const results = await pendingFetches.get(pubkey)!;
      if (mountedRef.current) {
        setAttestations(results);
        setFetched(true);
      }
      return;
    }

    const fetchPromise = doFetch(pubkey);
    pendingFetches.set(pubkey, fetchPromise);

    try {
      const results = await fetchPromise;
      attestationCache.set(pubkey, { attestations: results, timestamp: Date.now(), isError: false });

      if (results.length > 0) {
        fetchProfilesCached(results.map((a) => a.attesterPubkey));
      }

      notifyListeners(pubkey, results);
    } catch (err) {
      console.error("[Attestations] fetch error:", err);
      attestationCache.set(pubkey, { attestations: [], timestamp: Date.now(), isError: true });
      notifyListeners(pubkey, []);
    } finally {
      pendingFetches.delete(pubkey);
    }
  }, [pubkey]);

  return { attestations, fetched, fetch: fetchAttestations };
}
