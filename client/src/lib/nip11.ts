import { nip19 } from "nostr-tools";

/**
 * Normalize any operator-key shape a relay might publish in its NIP-11 doc to
 * lowercase 64-char hex: bare hex (any case, stray whitespace) OR an npub. The
 * app's signed-in pubkey is always lowercase hex, so normalizing at the parse
 * boundary means every downstream `doc.pubkey === myPubkey` comparison is
 * reliable — an npub- or uppercase-published operator key no longer locks the
 * real operator out of their own dashboard.
 */
export function toHexPubkey(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  if (s.startsWith("npub1")) {
    try {
      const d = nip19.decode(s);
      if (d.type === "npub") return d.data as string;
    } catch { /* malformed npub — treat as no operator key */ }
  }
  return undefined;
}

/**
 * Is `hexPubkey` (lowercase hex) the operator of this relay per its NIP-11 doc —
 * either the published operator `pubkey` or a listed moderator? Both fields are
 * already hex-normalized at parse, so this is a plain membership check. The
 * single source of truth for "can this account manage this relay", shared by the
 * ops-center access gate and the sidebar's auto-promote so they can't disagree.
 */
export function isNip11Operator(doc: Nip11Document | null | undefined, hexPubkey: string | null | undefined): boolean {
  if (!doc || !hexPubkey) return false;
  if (doc.pubkey && doc.pubkey === hexPubkey) return true;
  return doc.moderators?.includes(hexPubkey) ?? false;
}

export interface Nip11Document {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  limitation?: {
    max_message_length?: number;
    max_subscriptions?: number;
    max_filters?: number;
    max_limit?: number;
    max_subid_length?: number;
    max_event_tags?: number;
    max_content_length?: number;
    min_pow_difficulty?: number;
    auth_required?: boolean;
    payment_required?: boolean;
    restricted_writes?: boolean;
    created_at_lower_limit?: number;
    created_at_upper_limit?: number;
  };
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  payments_url?: string;
  fees?: {
    admission?: { amount: number; unit: string }[];
    subscription?: { amount: number; unit: string; period: number }[];
    publication?: { kinds: number[]; amount: number; unit: string }[];
  };
  icon?: string;
  banner?: string;
  retention?: Array<{
    kinds?: number[];
    time?: number | null;
    count?: number;
  }>;
  moderators?: string[];
  blossom_servers?: string[];
}

const nip11Cache = new Map<string, { data: Nip11Document; fetchedAt: number }>();
const NIP11_CACHE_TTL = 5 * 60 * 1000;

function wsToHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

export async function fetchNip11(relayUrl: string): Promise<Nip11Document | null> {
  const normalizedUrl = relayUrl.replace(/\/+$/, "");
  const cached = nip11Cache.get(normalizedUrl);
  if (cached && Date.now() - cached.fetchedAt < NIP11_CACHE_TTL) {
    return cached.data;
  }

  try {
    const httpUrl = wsToHttpUrl(normalizedUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(httpUrl, {
      headers: { Accept: "application/nostr+json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const doc: Nip11Document = {
      name: data.name,
      description: data.description,
      pubkey: toHexPubkey(data.pubkey),
      contact: data.contact,
      supported_nips: data.supported_nips,
      software: data.software,
      version: data.version,
      limitation: data.limitation,
      relay_countries: data.relay_countries,
      language_tags: data.language_tags,
      tags: data.tags,
      posting_policy: data.posting_policy,
      payments_url: data.payments_url,
      fees: data.fees,
      icon: data.icon,
      banner: typeof data.banner === "string" ? data.banner : undefined,
      retention: data.retention,
      moderators: (() => {
        // Normalize each entry the same way as the operator pubkey (hex or npub →
        // lowercase hex) so a moderator published as an npub still matches.
        const hexList = (arr: unknown[]) => arr.map(toHexPubkey).filter((p): p is string => !!p);
        if (Array.isArray(data.moderators)) return hexList(data.moderators);
        if (Array.isArray(data.admins)) return hexList(data.admins);
        if (Array.isArray(data.operator_pubkeys)) return hexList(data.operator_pubkeys);
        if (Array.isArray(data.operators)) return hexList(data.operators);
        return undefined;
      })(),
      blossom_servers: (() => {
        const raw = data.blossom_servers ?? data.blossomServers ?? data.blossom;
        if (!Array.isArray(raw)) return undefined;
        const urls = raw.filter(
          (s: unknown) => typeof s === "string" && /^https?:\/\//i.test(s as string)
        ) as string[];
        return urls.length > 0 ? urls : undefined;
      })(),
    };

    nip11Cache.set(normalizedUrl, { data: doc, fetchedAt: Date.now() });
    return doc;
  } catch {
    return null;
  }
}

export function clearNip11Cache(relayUrl?: string) {
  if (relayUrl) {
    nip11Cache.delete(relayUrl.replace(/\/+$/, ""));
  } else {
    nip11Cache.clear();
  }
}

export function supportsNip(doc: Nip11Document, nip: number): boolean {
  return doc.supported_nips?.includes(nip) ?? false;
}

export function getSoftwareDisplay(doc: Nip11Document): string | null {
  if (!doc.software && !doc.version) return null;
  const sw = doc.software?.split("/").pop() ?? doc.software ?? "";
  return doc.version ? `${sw} v${doc.version}` : sw;
}
