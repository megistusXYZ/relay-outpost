import { useState, useEffect, useCallback, useRef, useMemo } from "react";

import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import { nip19 } from "nostr-tools";
import { resolveTab } from "./console-nav";
import type { Event as NostrEvent, Filter as NostrToolsFilter } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { withReach, type Reached } from "@/lib/relay-reach";

import { getRelaysByType } from "@/lib/outpost-relays";

import { getAuthStatus, onAuthChange } from "@/lib/nip42-auth";

import { copyNostrId } from "@/lib/clipboard-bridge";

import { LinkPreviewCard } from "@/components/MediaRenderer";

import { Badge } from "@/components/ui/badge";
import { Radio, Activity, Info, Shield, Lock, RefreshCw, Hash, Zap, Copy, Check, Search, Megaphone, ScrollText, X, User, Users, Music, Video, ExternalLink, BarChart3, Key, Vote, Clock, ListChecks, MessageSquare, Inbox } from "lucide-react";

export interface NostrFilter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  limit?: number;
  since?: number;
  until?: number;
  "#e"?: string[];
  "#p"?: string[];
  "#a"?: string[];
  "#d"?: string[];
}

export interface SubCloser {
  close: () => void;
}

export const KIND_LABELS: Record<number, string> = {
  0: "Metadata",
  1: "Note",
  2: "Relay List",
  3: "Contacts",
  4: "DM (NIP-04)",
  5: "Deletion",
  6: "Repost",
  7: "Reaction",
  8: "Badge Award",
  9: "Chat Message",
  10: "Group Chat",
  11: "Group Thread",
  12: "Group Reply",
  16: "Generic Repost",
  40: "Channel Create",
  41: "Channel Metadata",
  42: "Channel Message",
  43: "Channel Hide",
  44: "Channel Mute",
  1018: "Poll Vote",
  1059: "Gift Wrap",
  1063: "File Metadata",
  1068: "Poll",
  1111: "Comment",
  1311: "Live Chat",
  1984: "Report",
  1985: "Label",
  9000: "Group Add User",
  9001: "Group Remove User",
  9002: "Group Edit Meta",
  9003: "Group Delete Event",
  9004: "Group Create",
  9005: "Group Delete",
  9006: "Group Create Invite",
  9007: "Group Edit Status",
  9008: "Group Set Permission",
  9009: "Group Delete Group",
  9021: "Group Join Request",
  9022: "Group Leave",
  9735: "Zap Receipt",
  9734: "Zap Request",
  10000: "Mute List",
  10001: "Pin List",
  10002: "Relay List",
  10009: "Group List",
  22242: "Auth",
  24133: "NIP-46",
  27235: "HTTP Auth",
  30000: "Follow Set",
  30001: "Bookmark Set",
  30008: "Profile Badge",
  30009: "Badge Def",
  30023: "Article",
  30024: "Draft Article",
  30078: "App Data",
  30311: "Live Event",
  31989: "Handler Rec",
  31990: "Handler Info",
  39000: "Group Admins",
  39001: "Group Members",
  39002: "Group Roles",
};

export function getKindLabel(kind: number, tags?: string[][]): string {
  if (kind === 1 && tags && tags.some(t => t[0] === "r" && t[1] && /^wss?:\/\//.test(t[1]))) {
    return "Announcement";
  }
  return KIND_LABELS[kind] || `Kind ${kind}`;
}

export function getKindBadgeClasses(kind: number, tags?: string[][]): string {
  if (kind === 1 && tags && tags.some(t => t[0] === "r" && t[1] && /^wss?:\/\//.test(t[1]))) {
    return "border-brand/30 dark:border-brand/20 text-brand dark:text-brand/80 bg-brand/5";
  }
  switch (kind) {
    case 1:
      return "border-blue-400/30 dark:border-blue-400/20 text-blue-600 dark:text-blue-400/80 bg-blue-500/5";
    case 6:
    case 16:
      return "border-green-400/30 dark:border-green-400/20 text-green-600 dark:text-green-400/80 bg-green-500/5";
    case 7:
      return "border-pink-400/30 dark:border-pink-400/20 text-pink-600 dark:text-pink-400/80 bg-pink-500/5";
    case 9735:
    case 9734:
      return "border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/80 bg-amber-500/5";
    case 4:
    case 1059:
      return "border-rose-400/30 dark:border-rose-400/20 text-rose-600 dark:text-rose-400/80 bg-rose-500/5";
    case 5:
      return "border-red-400/30 dark:border-red-400/20 text-red-600 dark:text-red-400/80 bg-red-500/5";
    case 0:
    case 3:
    case 10002:
      return "border-cyan-400/30 dark:border-cyan-400/20 text-cyan-600 dark:text-cyan-400/80 bg-cyan-500/5";
    case 30023:
    case 30024:
      return "border-brand/30 dark:border-brand/20 text-brand dark:text-brand/80 bg-brand/5";
    case 30311:
    case 1311:
    case 9:
    case 10:
    case 42:
      return "border-red-400/30 dark:border-red-400/20 text-red-500 dark:text-red-400/80 bg-red-500/5";
    case 1984:
    case 1985:
      return "border-orange-400/30 dark:border-orange-400/20 text-orange-600 dark:text-orange-400/80 bg-orange-500/5";
    case 1068:
      return "border-brand/30 dark:border-brand/20 text-brand dark:text-brand/80 bg-brand/5";
    case 1018:
      return "border-emerald-400/30 dark:border-emerald-400/20 text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/5";
    case 1111:
      return "border-sky-400/30 dark:border-sky-400/20 text-sky-600 dark:text-sky-400/80 bg-sky-500/5";
    case 9000: case 9001: case 9002: case 9003: case 9004: case 9005:
    case 9006: case 9007: case 9008: case 9009:
    case 9021: case 9022:
    case 11: case 12:
    case 39000: case 39001: case 39002:
    case 10009:
      return "border-teal-400/30 dark:border-teal-400/20 text-teal-600 dark:text-teal-400/80 bg-teal-500/5";
    default:
      return "border-brand/30 dark:border-brand/20 text-brand dark:text-brand/70";
  }
}

export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function pubkeyToNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex;
  }
}

export function npubToHex(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {}
  return null;
}

/**
 * Collect events, and say whether the relay ever answered.
 *
 * This function ALREADY asked the only question that distinguishes "empty" from
 * "offline" — `pool.ensureRelay(url)` below — and then dropped the answer on
 * the floor with `.catch(() => doSubscribe())`, subscribing to a socket it had
 * just been told would not open. The subscription then EOSEs with nothing, and
 * the caller counts zero events on a relay it never reached. In OverviewTab
 * those zeros were written into the operator's durable storage-trend history.
 */
export function subscribeWithReach(
  relayUrls: string[],
  filters: NostrFilter[],
  timeoutMs: number,
): Promise<{ events: NostrEvent[]; reached: boolean; refused?: string }> {
  return new Promise((resolve) => {
    const collected: NostrEvent[] = [];
    let reached = true;
    /**
     * The relay answered with "auth-required:"/"restricted:" instead of
     * results. A third outcome, not "empty": the relay is up and has posts,
     * it just won't show them to a reader who hasn't signed in to it.
     */
    let refused: string | undefined;

    const doSubscribe = () => {
      const filter: NostrFilter = filters.length === 1 ? filters[0] : Object.assign({}, ...filters);
      const sub: SubCloser = pool.subscribeMany(
        relayUrls,
        filter,
        {
          onevent(e: NostrEvent) { collected.push(e); },
          // nostr-tools reports a refusal as "end of results" first and passes
          // the CLOSED reason a moment later (abstract-pool handleClose), so
          // wait a tick before answering — or a refusal reads as "empty".
          oneose() { clearTimeout(timer); setTimeout(() => { sub.close(); resolve({ events: collected, reached, refused }); }, 0); },
          onclose(reasons: string[]) {
            // "auth-required: …" from the relay, or nostr-tools' own wording
            // when its automatic sign-in was turned down.
            const r = reasons.find((x) => /^(auth-required|restricted)|auth was required/i.test(x ?? ""));
            if (r) { refused = r; clearTimeout(timer); resolve({ events: collected, reached, refused }); }
          },
        },
      );
      const timer = setTimeout(() => { sub.close(); resolve({ events: collected, reached, refused }); }, timeoutMs);
    };

    const url = relayUrls[0];
    pool.ensureRelay(url)
      .then(() => {
        const authState = getAuthStatus(url);
        if (authState.status === "authenticating" || authState.status === "challenged") {
          const unsub = onAuthChange(() => {
            const s = getAuthStatus(url);
            if (s.status === "authenticated" || s.status === "failed" || s.status === "none") {
              unsub();
              doSubscribe();
            }
          });
          setTimeout(() => { unsub(); doSubscribe(); }, 3000);
        } else {
          doSubscribe();
        }
      })
      .catch(() => {
        // Still subscribe — a multi-relay call can be answered by the others,
        // and a socket may come up late. But REMEMBER that the relay we probed
        // refused, instead of letting an empty result read as "nothing here".
        reached = false;
        doSubscribe();
      });
  });
}

/** Bare-events shim for callers that don't render a claim about emptiness. */
export async function subscribeWithTimeout(
  relayUrls: string[],
  filters: NostrFilter[],
  timeoutMs: number,
): Promise<NostrEvent[]> {
  return (await subscribeWithReach(relayUrls, filters, timeoutMs)).events;
}

// NIP-45 COUNT probe.
//
// Hardened compared to a naive single-shot:
//  - Tolerates unrelated NOTICEs (only treats as unsupported when the relay
//    explicitly says COUNT is unknown/unsupported).
//  - If the relay sends an AUTH challenge first (NIP-42), signs it with the
//    active app signer and resends the COUNT once. Without this an
//    AUTH-required relay would be permanently misdetected as "no NIP-45".
//  - Generous timeout so slow mobile connections don't false-negative.
//  - On a CLOSED frame whose reason starts with "auth-required:" /
//    "restricted:", does the AUTH dance and retries once.
export function countWithNip45(
  relayUrl: string,
  filter: NostrFilter,
  timeoutMs = 7000,
): Promise<{ count: number | null; supported: boolean; approximate?: boolean }> {
  // NIP-45: a relay may answer with an estimate; carried back so the screen can say "About".
  let lastApproximate = false;
  // One-shot probe (single WS connection). Wraps the actual implementation
  // and retries it once on a transient/inconclusive failure before
  // declaring the relay as not supporting NIP-45.
  const attempt = (): Promise<{ count: number | null; supported: boolean; transient: boolean }> => new Promise((resolve) => {
    let settled = false;
    const finish = (result: { count: number | null; supported: boolean; transient: boolean }) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      clearTimeout(timer);
      clearTimeout(authWaitTimer);
      resolve(result);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
    } catch {
      // Constructing the socket failed — treat as transient so the caller
      // can retry once.
      resolve({ count: null, supported: false, transient: true });
      return;
    }

    const subId = `count_${Math.random().toString(36).slice(2, 10)}`;
    let authAttempted = false;
    let authWaitTimer: ReturnType<typeof setTimeout> = setTimeout(() => {}, 0);
    clearTimeout(authWaitTimer);

    const sendCount = () => {
      try { ws.send(JSON.stringify(["COUNT", subId, filter])); } catch {}
    };

    const handleAuthChallenge = async (challenge: string) => {
      if (authAttempted) {
        finish({ count: null, supported: false, transient: false });
        return;
      }
      authAttempted = true;
      try {
        // Lazy-import to avoid a circular dep with this shared module.
        const { getGlobalSigner, shouldAutoAuth } = await import("@/lib/nip42-auth");
        // Never sign a NIP-42 challenge (revealing pubkey↔IP to the relay) for a
        // relay the user hasn't opted into — this hand-rolled COUNT path is NOT
        // behind the pool's scoped auth handler, so it must apply the same gate
        // itself. Without this, a crafted /relay-ops-center/<attacker-relay> link
        // could harvest a user-signed 22242. Refuse = the count is simply
        // unavailable for that relay, never an auth leak.
        if (!shouldAutoAuth(relayUrl)) {
          finish({ count: null, supported: false, transient: false });
          return;
        }
        const { signWithTimeout, SIGNER_SIGN_TIMEOUT } = await import("@/lib/signer-timeout");
        const signer = getGlobalSigner();
        // No signer yet (e.g. signer hydration is briefly delayed) — treat
        // as transient so the wrapper can retry once instead of locking in
        // unsupported.
        if (!signer) { finish({ count: null, supported: false, transient: true }); return; }
        const authEvent = await signWithTimeout(
          signer,
          {
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["relay", relayUrl], ["challenge", challenge]],
            content: "",
          },
          SIGNER_SIGN_TIMEOUT,
        );
        if (settled) return;
        try { ws.send(JSON.stringify(["AUTH", authEvent])); } catch {}
        // Resend COUNT immediately; the relay will reply OK + COUNT in some
        // order. Either order is fine because we wait for the COUNT frame.
        sendCount();
      } catch {
        finish({ count: null, supported: false, transient: true });
      }
    };

    const timer = setTimeout(() => finish({ count: null, supported: false, transient: true }), timeoutMs);

    ws.onopen = () => sendCount();
    ws.onerror = () => finish({ count: null, supported: false, transient: true });
    ws.onclose = () => { if (!settled) finish({ count: null, supported: false, transient: true }); };

    ws.onmessage = (msg) => {
      let data: unknown[];
      try { data = JSON.parse(msg.data as string) as unknown[]; } catch { return; }
      if (!Array.isArray(data) || data.length === 0) return;
      const verb = data[0];

      if (verb === "COUNT" && data[1] === subId) {
        const result = data[2] as { count?: number; approximate?: boolean } | undefined;
        lastApproximate = result?.approximate === true;
        finish({ count: result?.count ?? 0, supported: true, transient: false });
        return;
      }

      if (verb === "AUTH" && typeof data[1] === "string") {
        void handleAuthChallenge(data[1] as string);
        return;
      }

      if (verb === "CLOSED" && data[1] === subId) {
        const reason = typeof data[2] === "string" ? (data[2] as string).toLowerCase() : "";
        if (!authAttempted && (reason.startsWith("auth-required") || reason.startsWith("restricted"))) {
          // Two relay behaviors: (a) AUTH frame arrives before CLOSED, (b)
          // CLOSED arrives first and the AUTH challenge follows. Wait
          // briefly for a possible AUTH frame so we can complete the dance.
          // If nothing arrives, treat as transient so the caller may retry.
          authWaitTimer = setTimeout(() => {
            if (!authAttempted) finish({ count: null, supported: false, transient: true });
          }, 1500);
          return;
        }
        if (reason.includes("count") || reason.includes("unsupported") || reason.includes("unknown")) {
          finish({ count: null, supported: false, transient: false });
          return;
        }
        // Other CLOSED reasons (rate-limit, blocked, etc.) — the relay
        // didn't actually answer the COUNT, so we can't claim it works.
        // Mark transient so the wrapper retries once; if the second attempt
        // still doesn't produce a real COUNT frame, the result is reported
        // as supported=false and the UI falls back to sampling. Avoids the
        // misleading "exact mode + count=0" presentation.
        finish({ count: null, supported: false, transient: true });
        return;
      }

      if (verb === "NOTICE") {
        const text = typeof data[1] === "string" ? (data[1] as string).toLowerCase() : "";
        // Only treat NOTICE as a definitive "no NIP-45" if it talks about it.
        if (
          text.includes("count") &&
          (text.includes("unsupported") || text.includes("unknown") || text.includes("not supported") || text.includes("invalid"))
        ) {
          finish({ count: null, supported: false, transient: false });
        }
        // Otherwise ignore — keep waiting for the real COUNT frame or timeout.
        return;
      }
    };
  });

  return (async () => {
    const first = await attempt();
    if (!first.transient) return { count: first.count, supported: first.supported, approximate: lastApproximate };
    // One retry on transient failures (timeout / connect error / auth wait
    // expired) before concluding the relay does not support NIP-45.
    const second = await attempt();
    return { count: second.count, supported: second.supported, approximate: lastApproximate };
  })();
}

export interface ProfileInfo {
  name?: string;
  picture?: string;
  nip05?: string;
}

export const profileCacheGlobal = new Map<string, ProfileInfo>();

export async function resolveProfileBatch(pubkeys: string[]): Promise<Map<string, ProfileInfo>> {
  const toFetch = pubkeys.filter(pk => pk && !profileCacheGlobal.has(pk));
  if (toFetch.length > 0) {
    const events = await subscribeWithTimeout(
      ["wss://purplepag.es", "wss://relay.damus.io"],
      [{ kinds: [0], authors: toFetch.slice(0, 20), limit: 20 }],
      3000,
    );
    for (const e of events) {
      try {
        const p = JSON.parse(e.content);
        profileCacheGlobal.set(e.pubkey, { name: p.name || p.display_name, picture: p.picture, nip05: p.nip05 });
      } catch {}
    }
  }
  const result = new Map<string, ProfileInfo>();
  for (const pk of pubkeys) {
    const cached = profileCacheGlobal.get(pk);
    if (cached) result.set(pk, cached);
  }
  return result;
}

export function ProfileName({ pubkey, profiles, showCopy = false }: { pubkey: string; profiles: Map<string, ProfileInfo>; showCopy?: boolean }) {
  const profile = profiles.get(pubkey);
  const npub = pubkeyToNpub(pubkey);
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    copyNostrId(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [npub]);
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {profile?.picture ? (
        <img src={profile.picture} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full bg-primary/20 shrink-0 flex items-center justify-center">
          <User className="w-2.5 h-2.5 text-brand/50" />
        </span>
      )}
      <span className="text-[10px] font-medium text-foreground truncate">{profile?.name || "Unknown"}</span>
      {showCopy && (
        <button onClick={handleCopy} className="shrink-0 text-muted-foreground/60 hover:text-brand transition-colors" title="Copy npub">
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
    </span>
  );
}

export const MEDIA_EXT_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|flac|m4a|aac)/gi;
export const AUDIO_EXT_RE = /\.(?:mp3|wav|ogg|flac|m4a|aac)$/i;
export const VIDEO_EXT_RE = /\.(?:mp4|webm|mov)$/i;
export const IMAGE_EXT_RE = /\.(?:jpg|jpeg|png|webp)$/i;
export const GIF_EXT_RE = /\.gif$/i;

export const AUDIO_DOMAINS = /(?:wavlake\.com|soundcloud\.com|music\.apple\.com|open\.spotify\.com|tidal\.com|bandcamp\.com)/i;
export const VIDEO_DOMAINS = /(?:youtube\.com|youtu\.be|vimeo\.com|rumble\.com|odysee\.com|streamable\.com|v\.nostr\.build)/i;

export function classifyUrl(url: string): "image" | "gif" | "video" | "audio" | "link" {
  if (GIF_EXT_RE.test(url)) return "gif";
  if (IMAGE_EXT_RE.test(url)) return "image";
  if (VIDEO_EXT_RE.test(url)) return "video";
  if (AUDIO_EXT_RE.test(url)) return "audio";
  if (AUDIO_DOMAINS.test(url)) return "audio";
  if (VIDEO_DOMAINS.test(url)) return "video";
  return "link";
}

export function extractMediaUrls(event: { content: string; tags: string[][] }): string[] {
  const urls: string[] = [];
  MEDIA_EXT_RE.lastIndex = 0;
  let match;
  while ((match = MEDIA_EXT_RE.exec(event.content)) !== null) {
    urls.push(match[0]);
  }
  for (const tag of event.tags) {
    if ((tag[0] === "image" || tag[0] === "thumb" || tag[0] === "url") && tag[1]) {
      if (!urls.includes(tag[1])) urls.push(tag[1]);
    }
    if (tag[0] === "imeta") {
      const urlEntry = tag.find(t => t.startsWith("url "));
      if (urlEntry) {
        const u = urlEntry.slice(4);
        if (!urls.includes(u)) urls.push(u);
      }
    }
  }
  return urls;
}

export function extractAllUrls(content: string): string[] {
  const urlRe = /https?:\/\/[^\s)>\]]+/gi;
  const matches: string[] = [];
  let m;
  while ((m = urlRe.exec(content)) !== null) {
    matches.push(m[0].replace(/[.,;:!?]+$/, ""));
  }
  return matches;
}

export function stripUrls(content: string): string {
  return content.replace(/https?:\/\/[^\s)>\]]+/gi, "").trim();
}

export function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function isRelayAnnouncement(kind?: number, tags?: string[][]): boolean {
  if (kind !== 1 || !tags) return false;
  return tags.some(t => t[0] === "r" && t[1] && /^wss?:\/\//.test(t[1]));
}

export function tryParseRepostInner(content: string): { content: string; kind?: number; pubkey?: string; tags?: string[][]; created_at?: number } | null {
  const trimmed = content?.trimStart();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const raw = JSON.parse(trimmed);
    if (!raw || typeof raw.content !== "string") return null;
    const result: { content: string; kind?: number; pubkey?: string; tags?: string[][]; created_at?: number } = {
      content: raw.content,
    };
    if (typeof raw.kind === "number") result.kind = raw.kind;
    if (typeof raw.pubkey === "string") result.pubkey = raw.pubkey;
    if (typeof raw.created_at === "number") result.created_at = raw.created_at;
    if (Array.isArray(raw.tags)) {
      result.tags = raw.tags.filter((t: unknown) => Array.isArray(t) && t.every((v: unknown) => typeof v === "string"));
    }
    return result;
  } catch {}
  return null;
}

export interface AudioMeta {
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export function AudioPreviewCard({ url }: { url: string }) {
  const isDirectFile = AUDIO_EXT_RE.test(url);
  const [meta, setMeta] = useState<AudioMeta | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDirectFile) return;
    const controller = new AbortController();
    setMeta(null);
    setLoading(true);
    fetch(`/api/og?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted && data && (data.title || data.description || data.image || data.siteName)) {
          setMeta(data);
        }
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, isDirectFile]);

  const platformName = useMemo(() => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host.includes("wavlake")) return "Wavlake";
      if (host.includes("spotify")) return "Spotify";
      if (host.includes("soundcloud")) return "SoundCloud";
      if (host.includes("apple")) return "Apple Music";
      if (host.includes("tidal")) return "Tidal";
      if (host.includes("bandcamp")) return "Bandcamp";
      return host;
    } catch { return "Audio"; }
  }, [url]);

  const filename = useMemo(() => {
    try {
      const path = new URL(url).pathname;
      const name = decodeURIComponent(path.split("/").pop() || "").replace(/\.[^.]+$/, "");
      if (!name || /^[0-9a-f]{32,}$/i.test(name)) return "Audio file";
      return name.replace(/[-_]/g, " ");
    } catch { return "Audio file"; }
  }, [url]);

  if (isDirectFile) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-accent dark:bg-brand/10 border border-brand/20 dark:border-brand/15">
        <div data-art className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
          <Music className="w-5 h-5 text-brand/70" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-foreground/80 truncate">{filename}</p>
          <audio src={url} controls preload="metadata" className="w-full h-7 [&::-webkit-media-controls-panel]:bg-transparent" onClick={e => e.stopPropagation()} />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-accent dark:bg-brand/10 border border-brand/20 dark:border-brand/15 animate-pulse">
        <div data-art className="w-10 h-10 rounded-lg bg-primary/15 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-3 bg-primary/10 rounded w-3/4" />
          <div className="h-2.5 bg-primary/5 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (meta) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-md bg-accent dark:bg-brand/10 border border-brand/20 dark:border-brand/15 hover:bg-brand/10 dark:hover:bg-brand/15 transition-colors group" onClick={e => e.stopPropagation()}>
        {meta.image ? (
          <img src={meta.image} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0 ring-1 ring-primary/20" />
        ) : (
          <div data-art className="w-12 h-12 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
            <Music className="w-5 h-5 text-brand/70" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-foreground/90 truncate group-hover:text-brand transition-colors">{meta.title}</p>
          {meta.description && (
            <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">{meta.description.slice(0, 100)}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            <Music className="w-2.5 h-2.5 text-brand/50" />
            <span className="text-[10px] text-brand dark:text-brand/70 uppercase tracking-wider">{meta.siteName || platformName}</span>
            <ExternalLink className="w-2 h-2 text-muted-foreground/50 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </a>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-md bg-accent dark:bg-brand/10 border border-brand/20 dark:border-brand/15 hover:bg-brand/10 dark:hover:bg-brand/15 transition-colors group" onClick={e => e.stopPropagation()}>
      <div data-art className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
        <Music className="w-5 h-5 text-brand/70" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-brand truncate group-hover:underline">{url.replace(/^https?:\/\//, "").slice(0, 60)}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <Music className="w-2.5 h-2.5 text-brand/50" />
          <span className="text-[10px] text-brand dark:text-brand/70 uppercase tracking-wider">{platformName}</span>
          <ExternalLink className="w-2 h-2 text-muted-foreground/50 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </a>
  );
}

export const reactionRefCache = new Map<string, { content: string; pubkey?: string; tags?: string[][]; created_at?: number; kind?: number } | "failed">();

export function ReactionReferencePreview({ eventId, relayUrl, profiles }: { eventId: string; relayUrl: string; profiles: Map<string, ProfileInfo> }) {
  const cached = reactionRefCache.get(eventId);
  const [ref, setRef] = useState<{ content: string; pubkey?: string; tags?: string[][]; created_at?: number; kind?: number } | null>(
    cached && cached !== "failed" ? cached : null
  );
  const [loading, setLoading] = useState(!reactionRefCache.has(eventId));
  const [failed, setFailed] = useState(cached === "failed");

  useEffect(() => {
    if (reactionRefCache.has(eventId)) {
      const c = reactionRefCache.get(eventId)!;
      if (c === "failed") {
        setFailed(true);
        setLoading(false);
        return;
      }
      setRef(c);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const relays = [relayUrl, ...getRelaysByType("public").slice(0, 3)];
    const unique = [...new Set(relays)];
    subscribeWithTimeout(unique, [{ ids: [eventId] }], 5000).then((events) => {
      if (cancelled) return;
      if (events.length > 0) {
        const e = events[0];
        const parsed = { content: e.content, pubkey: e.pubkey, tags: e.tags as string[][], created_at: e.created_at, kind: e.kind };
        reactionRefCache.set(eventId, parsed);
        setRef(parsed);
        setLoading(false);
        if (e.pubkey) {
          resolveProfileBatch([e.pubkey]).then(() => {});
        }
      } else {
        reactionRefCache.set(eventId, "failed");
        setLoading(false);
        setFailed(true);
      }
    });
    return () => { cancelled = true; };
  }, [eventId, relayUrl]);

  if (loading) {
    return (
      <div className="rounded-md bg-black/[0.02] dark:bg-white/[0.015] border border-black/[0.04] dark:border-white/[0.04] p-3 animate-pulse">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-primary/10 shrink-0" />
          <div className="h-2.5 bg-primary/10 rounded w-24" />
        </div>
        <div className="space-y-1.5">
          <div className="h-2.5 bg-primary/5 rounded w-full" />
          <div className="h-2.5 bg-primary/5 rounded w-3/4" />
        </div>
      </div>
    );
  }

  if (failed || !ref) {
    return (
      <div className="rounded-md bg-black/[0.02] dark:bg-white/[0.015] border border-black/[0.04] dark:border-white/[0.04] px-3 py-2">
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{eventId.slice(0, 16)}…</span>
      </div>
    );
  }

  const refMedia = extractMediaUrls({ content: ref.content, tags: ref.tags || [] });
  const refAllUrls = extractAllUrls(ref.content);
  const refAudioUrls = refAllUrls.filter(u => classifyUrl(u) === "audio");
  const refVideoLinkUrls = refAllUrls.filter(u => classifyUrl(u) === "video" && !VIDEO_EXT_RE.test(u));
  const refLinkUrls = refAllUrls.filter(u => classifyUrl(u) === "link");
  const refText = stripUrls(ref.content).trim();

  return (
    <div className="rounded-md bg-black/[0.02] dark:bg-white/[0.015] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-black/[0.04] dark:border-white/[0.04]">
        {ref.pubkey && (
          <span className="text-[10px] text-muted-foreground/60 min-w-0">
            <ProfileName pubkey={ref.pubkey} profiles={profiles} showCopy />
          </span>
        )}
        {ref.created_at && (
          <span className="text-[10px] text-muted-foreground/50 font-mono">{timeAgo(ref.created_at)}</span>
        )}
        {ref.kind !== undefined && (
          <Badge variant="outline" className={`text-[10px] shrink-0 ml-auto ${getKindBadgeClasses(ref.kind, ref.tags)}`}>
            {getKindLabel(ref.kind, ref.tags)}
          </Badge>
        )}
      </div>
      {refText && (
        <p className="text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words px-3 py-2">{refText}</p>
      )}
      {refMedia.length > 0 && (
        <div className={`${refMedia.length === 1 ? "flex" : "grid grid-cols-2"} gap-px`}>
          {refMedia.slice(0, 4).map((url, i) => {
            const type = classifyUrl(url);
            if (type === "video") return <video key={i} src={url} controls className="w-full max-h-[200px] object-contain bg-black/10 dark:bg-black/30" />;
            if (type === "audio") return null;
            return <img key={i} src={url} alt="" className="w-full max-h-[200px] object-contain bg-black/10 dark:bg-black/30" loading="lazy" />;
          })}
        </div>
      )}
      {refAudioUrls.length > 0 && (
        <div className="px-3 py-2 space-y-2">
          {refAudioUrls.map(url => (
            <AudioPreviewCard key={url} url={url} />
          ))}
        </div>
      )}
      {refVideoLinkUrls.length > 0 && (
        <div className="px-3 py-2 space-y-2">
          {refVideoLinkUrls.map((url, i) => (
            <div key={i} className="flex items-center gap-2.5 p-2 rounded-md bg-blue-500/5 dark:bg-blue-500/10 border border-blue-300/20 dark:border-blue-400/15">
              <Video className="w-3.5 h-3.5 text-blue-500/70 shrink-0" />
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline truncate flex-1" onClick={e => e.stopPropagation()}>
                {url.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
            </div>
          ))}
        </div>
      )}
      {refLinkUrls.length > 0 && (
        <div className="px-3 pb-2 space-y-2">
          {refLinkUrls.map((url, i) => (
            <LinkPreviewCard key={i} url={url} compact />
          ))}
        </div>
      )}
      {!refText && refMedia.length === 0 && refAudioUrls.length === 0 && refVideoLinkUrls.length === 0 && refLinkUrls.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60 italic px-3 py-2">No displayable content</p>
      )}
    </div>
  );
}

export function RenderedEventPreview({ event, profiles, relayUrl }: { event: { id: string; kind: number; pubkey: string; content: string; created_at: number; tags: string[][] }; profiles: Map<string, ProfileInfo>; relayUrl?: string }) {
  const profile = profiles.get(event.pubkey);
  const npub = pubkeyToNpub(event.pubkey);
  const media = extractMediaUrls(event);

  if (event.kind === 0) {
    try {
      const meta = JSON.parse(event.content);
      return (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
          {meta.picture && <img src={meta.picture} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-primary/20" />}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{meta.display_name || meta.name || "Unknown"}</p>
            {meta.nip05 && <p className="text-[10px] text-brand dark:text-brand/70">{meta.nip05}</p>}
            {meta.about && <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-2">{meta.about}</p>}
            {meta.lud16 && <p className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1"><Zap className="w-2.5 h-2.5" />{meta.lud16}</p>}
          </div>
        </div>
      );
    } catch {
      return <p className="text-xs text-muted-foreground/60 italic">Invalid metadata JSON</p>;
    }
  }

  if (event.kind === 6 || event.kind === 16) {
    const inner = tryParseRepostInner(event.content);
    if (inner) {
      const innerMedia = extractMediaUrls({ content: inner.content, tags: inner.tags || [] });
      const innerAllUrls = extractAllUrls(inner.content);
      const innerAudioUrls = innerAllUrls.filter(u => classifyUrl(u) === "audio");
      const innerVideoLinkUrls = innerAllUrls.filter(u => classifyUrl(u) === "video" && !VIDEO_EXT_RE.test(u));
      const innerLinkUrls = innerAllUrls.filter(u => classifyUrl(u) === "link");
      const innerText = stripUrls(inner.content).trim();
      const innerIsArticle = inner.kind === 30023 || inner.kind === 30024;
      const innerTitle = innerIsArticle ? inner.tags?.find((t: string[]) => t[0] === "title")?.[1] : undefined;

      return (
        <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden p-3 space-y-2">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-green-500/70 shrink-0" />
            <span className="text-[10px] text-green-600 dark:text-green-400/70 uppercase tracking-wider font-medium">
              {event.kind === 16 ? "Generic Repost" : "Reposted"}
            </span>
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(event.created_at)}</span>
          </div>
          <div className="rounded-md bg-black/[0.02] dark:bg-white/[0.015] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-black/[0.04] dark:border-white/[0.04]">
              {inner.pubkey && (
                <span className="text-[10px] text-muted-foreground/60 min-w-0">
                  <ProfileName pubkey={inner.pubkey} profiles={profiles} showCopy />
                </span>
              )}
              {inner.created_at && (
                <span className="text-[10px] text-muted-foreground/50 font-mono">{timeAgo(inner.created_at)}</span>
              )}
              {inner.kind !== undefined && (
                <Badge variant="outline" className={`text-[10px] shrink-0 ml-auto ${getKindBadgeClasses(inner.kind, inner.tags)}`}>
                  {getKindLabel(inner.kind, inner.tags)}
                </Badge>
              )}
            </div>
            {innerIsArticle && innerTitle && (
              <div className="px-3 pt-2">
                <p className="text-[12px] font-medium text-foreground/90">{innerTitle}</p>
              </div>
            )}
            {innerText && (
              <p className="text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words px-3 py-2">{innerText}</p>
            )}
            {innerMedia.length > 0 && (
              <div className={`${innerMedia.length === 1 ? "flex" : "grid grid-cols-2"} gap-px`}>
                {innerMedia.slice(0, 4).map((url, i) => {
                  const type = classifyUrl(url);
                  if (type === "video") return <video key={i} src={url} controls className="w-full max-h-[200px] object-contain bg-black/10 dark:bg-black/30" />;
                  if (type === "audio") return null;
                  return <img key={i} src={url} alt="" className="w-full max-h-[200px] object-contain bg-black/10 dark:bg-black/30" loading="lazy" />;
                })}
              </div>
            )}
            {innerAudioUrls.length > 0 && (
              <div className="px-3 py-2 space-y-2">
                {innerAudioUrls.map(url => (
                  <AudioPreviewCard key={url} url={url} />
                ))}
              </div>
            )}
            {innerVideoLinkUrls.length > 0 && (
              <div className="px-3 py-2 space-y-2">
                {innerVideoLinkUrls.map((url, i) => (
                  <div key={i} className="flex items-center gap-2.5 p-2 rounded-md bg-blue-500/5 dark:bg-blue-500/10 border border-blue-300/20 dark:border-blue-400/15">
                    <Video className="w-3.5 h-3.5 text-blue-500/70 shrink-0" />
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline truncate flex-1" onClick={e => e.stopPropagation()}>
                      {url.replace(/^https?:\/\//, "").slice(0, 60)}
                    </a>
                  </div>
                ))}
              </div>
            )}
            {innerLinkUrls.length > 0 && (
              <div className="px-3 pb-2 space-y-2">
                {innerLinkUrls.map((url, i) => (
                  <LinkPreviewCard key={i} url={url} compact />
                ))}
              </div>
            )}
            {!innerText && innerMedia.length === 0 && innerAudioUrls.length === 0 && innerVideoLinkUrls.length === 0 && innerLinkUrls.length === 0 && (
              <p className="text-[10px] text-muted-foreground/60 italic px-3 py-2">No displayable content</p>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="p-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-3 h-3 text-green-500/60 shrink-0" />
          <span className="text-[11px] text-green-600 dark:text-green-400/70 font-medium">Reposted</span>
          <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(event.created_at)}</span>
        </div>
        {event.content && <p className="text-[11px] text-muted-foreground/60 mt-1.5 line-clamp-2 break-all">{event.content.slice(0, 200)}</p>}
      </div>
    );
  }

  if (event.kind === 7) {
    const reactedTo = event.tags.find(t => t[0] === "e");
    const emoji = event.content === "+" ? "❤️" : event.content || "❤️";
    return (
      <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{emoji}</span>
          <span className="text-[10px] text-pink-600/60 dark:text-pink-400/50 uppercase tracking-wider font-medium">Reaction</span>
          <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(event.created_at)}</span>
        </div>
        {reactedTo && relayUrl ? (
          <ReactionReferencePreview eventId={reactedTo[1]} relayUrl={relayUrl} profiles={profiles} />
        ) : reactedTo ? (
          <div className="rounded-md bg-black/[0.02] dark:bg-white/[0.015] border border-black/[0.04] dark:border-white/[0.04] px-3 py-2">
            <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{reactedTo[1].slice(0, 16)}…</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (event.kind === 30023 || event.kind === 30024) {
    const titleTag = event.tags.find((t: string[]) => t[0] === "title");
    const imageTag = event.tags.find((t: string[]) => t[0] === "image");
    const summaryTag = event.tags.find((t: string[]) => t[0] === "summary");
    const title = titleTag?.[1] || "";
    const bannerImage = imageTag?.[1] || "";
    const summary = summaryTag?.[1] || "";
    const cleanedContent = event.content
      .replace(/<[^>]*>/g, "")
      .replace(/#{1,6}\s+/g, "\n")
      .replace(/[*_~`>]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return (
      <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
        {bannerImage && (
          <img src={bannerImage} alt={title} className="w-full max-h-[200px] object-cover" loading="lazy" />
        )}
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ScrollText className="w-3.5 h-3.5 text-brand/70 shrink-0" />
            <span className="text-[10px] text-brand dark:text-brand/70 uppercase tracking-wider font-medium">Long-form Article</span>
          </div>
          {title && (
            <h3 className="text-sm font-semibold text-foreground/90 leading-snug">{title}</h3>
          )}
          {summary && (
            <p className="text-[11px] text-muted-foreground/70 italic">{summary}</p>
          )}
          <div className="max-h-[400px] overflow-y-auto pr-1">
            <p className="text-[11px] leading-relaxed text-muted-foreground/60 whitespace-pre-wrap break-words">{cleanedContent}</p>
          </div>
        </div>
      </div>
    );
  }

  if (event.kind === 1068) {
    const optionTags = event.tags.filter(t => t[0] === "option" && t[1] !== undefined && t[2] !== undefined);
    const expirationTag = event.tags.find(t => t[0] === "expiration" && t[1]);
    const expTs = expirationTag ? parseInt(expirationTag[1], 10) : null;
    const isExpired = expTs ? expTs * 1000 < Date.now() : false;

    return (
      <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-black/[0.04] dark:border-white/[0.04] flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-brand/70 shrink-0" />
          <span className="text-[10px] text-brand dark:text-brand/70 uppercase tracking-wider font-medium">Poll</span>
          {isExpired ? (
            <span className="text-[10px] text-red-500/70 uppercase tracking-wider font-medium ml-1">Expired</span>
          ) : expTs ? (
            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1 ml-1">
              <Clock className="w-2.5 h-2.5" />
              Closes {timeAgo(expTs)}
            </span>
          ) : null}
          <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(event.created_at)}</span>
        </div>
        <div className="px-3 py-2.5">
          <div className="flex items-start gap-2.5 mb-3">
            {profile?.picture && <img src={profile.picture} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-primary/20 mt-0.5" />}
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-foreground/70">
                <ProfileName pubkey={event.pubkey} profiles={profiles} showCopy />
              </p>
              <p className="text-[12px] font-semibold text-foreground/90 mt-1 whitespace-pre-wrap break-words leading-snug">
                {event.content || "—"}
              </p>
            </div>
          </div>
          {optionTags.length > 0 && (
            <div className="space-y-1.5 mt-2">
              {optionTags.map((tag, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-accent dark:bg-brand/10 border border-brand/20 dark:border-brand/15">
                  <span className="text-[10px] font-mono font-bold text-brand/70 shrink-0 w-4 text-center">{String.fromCharCode(65 + i)}</span>
                  <span className="text-[11px] text-foreground/80">{tag[2]}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-3 pt-2 border-t border-black/[0.04] dark:border-white/[0.04]">
            <span className="text-[10px] text-muted-foreground/50 font-mono">{optionTags.length} option{optionTags.length !== 1 ? "s" : ""}</span>
            <span className="text-[10px] text-muted-foreground/40">•</span>
            <span className="text-[10px] text-muted-foreground/50 font-mono">Kind 1068</span>
          </div>
        </div>
      </div>
    );
  }

  if (event.kind === 1018) {
    const pollRef = event.tags.find(t => t[0] === "e");
    const responseTag = event.tags.find(t => t[0] === "response" || t[0] === "poll_option");
    const optionIdx = responseTag?.[1];

    return (
      <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-black/[0.04] dark:border-white/[0.04] flex items-center gap-2">
          <Vote className="w-3.5 h-3.5 text-emerald-500/70 shrink-0" />
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400/70 uppercase tracking-wider font-medium">Poll Vote</span>
          <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(event.created_at)}</span>
        </div>
        <div className="px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            {profile?.picture && <img src={profile.picture} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-emerald-400/20" />}
            <span className="text-[10px] text-foreground/70">
              <ProfileName pubkey={event.pubkey} profiles={profiles} showCopy />
            </span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-300/20 dark:border-emerald-400/15">
            <ListChecks className="w-3.5 h-3.5 text-emerald-500/60 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-emerald-600/60 dark:text-emerald-400/50 uppercase tracking-wider font-medium">Selected Option</span>
              <p className="text-[12px] font-mono font-semibold text-foreground/80 mt-0.5">
                {optionIdx !== undefined && /^\d+$/.test(optionIdx) ? `Option ${String.fromCharCode(65 + Number(optionIdx))} (index ${optionIdx})` : optionIdx !== undefined ? `Response: ${optionIdx}` : "Unknown"}
              </p>
            </div>
          </div>
          {pollRef?.[1] && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent dark:bg-brand/10 border border-brand/15 dark:border-brand/10">
              <BarChart3 className="w-3 h-3 text-brand/50 shrink-0" />
              <span className="text-[10px] text-brand/60 dark:text-brand/50 uppercase tracking-wider font-medium shrink-0">Poll</span>
              <span className="text-[10px] font-mono text-foreground/60 truncate">{pollRef[1].length > 20 ? `${pollRef[1].slice(0, 12)}…${pollRef[1].slice(-8)}` : pollRef[1]}</span>
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-[10px] text-muted-foreground/50 font-mono">Kind 1018</span>
          </div>
        </div>
      </div>
    );
  }

  if (event.kind === 1111) {
    const parentETag = event.tags.find(t => t[0] === "E" || t[0] === "e");
    const parentKTag = event.tags.find(t => t[0] === "K" || t[0] === "k");
    const parentKind = parentKTag?.[1];
    const parentKindLabel = parentKind ? (KIND_LABELS[Number(parentKind)] || `Kind ${parentKind}`) : null;
    const commentText = event.content || "";
    const allUrls = extractAllUrls(commentText);
    const commentMedia = extractMediaUrls(event);
    const textContent = stripUrls(commentText).trim();

    return (
      <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-black/[0.04] dark:border-white/[0.04] flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-sky-500/70 shrink-0" />
          <span className="text-[10px] text-sky-600 dark:text-sky-400/70 uppercase tracking-wider font-medium">Comment</span>
          <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(event.created_at)}</span>
        </div>
        <div className="px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            {profile?.picture && <img src={profile.picture} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-sky-400/20" />}
            <span className="text-[10px] text-foreground/70">
              <ProfileName pubkey={event.pubkey} profiles={profiles} showCopy />
            </span>
          </div>
          {textContent && (
            <p className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">{textContent}</p>
          )}
          {commentMedia.length > 0 && (
            <div className={`${commentMedia.length === 1 ? "flex" : "grid grid-cols-2"} gap-px rounded-md overflow-hidden`}>
              {commentMedia.slice(0, 4).map((url, i) => {
                const type = classifyUrl(url);
                if (type === "video") return <video key={i} src={url} controls className="w-full max-h-[200px] object-contain bg-black/10 dark:bg-black/30" />;
                return <img key={i} src={url} alt="" className="w-full max-h-[200px] object-contain bg-black/10 dark:bg-black/30" loading="lazy" />;
              })}
            </div>
          )}
          {parentETag?.[1] && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-sky-500/5 dark:bg-sky-500/10 border border-sky-300/15 dark:border-sky-400/10">
              <MessageSquare className="w-3 h-3 text-sky-500/50 shrink-0" />
              <span className="text-[10px] text-sky-600/60 dark:text-sky-400/50 uppercase tracking-wider font-medium shrink-0">
                {parentKindLabel ? `Reply to ${parentKindLabel}` : "In reply to"}
              </span>
              <span className="text-[10px] font-mono text-foreground/60 truncate">
                {parentETag[1].length > 20 ? `${parentETag[1].slice(0, 12)}…${parentETag[1].slice(-8)}` : parentETag[1]}
              </span>
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-[10px] text-muted-foreground/50 font-mono">Kind 1111 · NIP-22</span>
          </div>
        </div>
      </div>
    );
  }

  if (isRelayAnnouncement(event.kind, event.tags)) {
    const rTag = event.tags.find((t: string[]) => t[0] === "r" && /^wss?:\/\//.test(t[1]));
    const relayUrl = rTag?.[1] || "";
    const announcementText = event.content.replace(/\s*wss?:\/\/\S+/g, "").trim();

    return (
      <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Megaphone className="w-3.5 h-3.5 text-brand/70 shrink-0" />
          <span className="text-[10px] text-brand dark:text-brand/70 uppercase tracking-wider font-medium">Relay Announcement</span>
        </div>
        {announcementText && (
          <p className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">{announcementText}</p>
        )}
        {relayUrl && (
          <div className="flex items-center gap-2 rounded-md bg-accent dark:bg-brand/10 border border-brand/20 dark:border-brand/15 px-2.5 py-1.5">
            <Radio className="w-3 h-3 text-brand/60 shrink-0" />
            <span className="text-[11px] font-mono text-brand dark:text-brand/80">{relayUrl}</span>
          </div>
        )}
      </div>
    );
  }

  const isNip29Kind = (event.kind >= 9000 && event.kind <= 9022) ||
    (event.kind >= 39000 && event.kind <= 39002) ||
    event.kind === 10009 || event.kind === 11 || event.kind === 12;

  if (isNip29Kind) {
    const hTag = event.tags.find(t => t[0] === "h");
    const groupId = hTag?.[1] || "";
    const pTags = event.tags.filter(t => t[0] === "p");
    const eTags = event.tags.filter(t => t[0] === "e");
    const dTag = event.tags.find(t => t[0] === "d");
    const nameTag = event.tags.find(t => t[0] === "name");
    const aboutTag = event.tags.find(t => t[0] === "about");
    const pictureTag = event.tags.find(t => t[0] === "picture");
    const roleTag = event.tags.find(t => t[0] === "role");
    const permTags = event.tags.filter(t => t[0] === "permission");
    const publicTag = event.tags.find(t => t[0] === "public");
    const openTag = event.tags.find(t => t[0] === "open");
    const closedTag = event.tags.find(t => t[0] === "closed");
    const privateTag = event.tags.find(t => t[0] === "private");

    const actionDescriptions: Record<number, string> = {
      9000: "Add User",
      9001: "Remove User",
      9002: "Edit Group Metadata",
      9003: "Delete Event",
      9004: "Create Group",
      9005: "Delete Group",
      9006: "Create Invite",
      9007: "Edit Group Status",
      9008: "Set Permission",
      9009: "Delete Group",
      9021: "Join Request",
      9022: "Leave Group",
      11: "Group Thread",
      12: "Group Reply",
      39000: "Group Admins List",
      39001: "Group Members List",
      39002: "Group Roles List",
      10009: "Group List (User)",
    };

    const details: { label: string; value: string; icon?: React.ReactNode }[] = [];

    if (groupId) {
      details.push({ label: "Group", value: `#${groupId}`, icon: <Hash className="w-3 h-3 text-teal-500/70" /> });
    }

    if (pTags.length > 0) {
      pTags.forEach(t => {
        const pk = t[1] || "";
        if (!pk) return;
        const role = t[2];
        const displayPk = pk.length > 16 ? `${pk.slice(0, 8)}…${pk.slice(-8)}` : pk;
        details.push({
          label: role ? `User (${role})` : "User",
          value: displayPk,
          icon: <User className="w-3 h-3 text-teal-500/70" />,
        });
      });
    }

    if (nameTag?.[1]) {
      details.push({ label: "Name", value: nameTag[1] });
    }
    if (aboutTag?.[1]) {
      details.push({ label: "About", value: aboutTag[1] });
    }
    if (pictureTag?.[1]) {
      details.push({ label: "Picture", value: pictureTag[1].replace(/^https?:\/\//, "").slice(0, 50) + "…" });
    }
    if (roleTag?.[1]) {
      details.push({ label: "Role", value: roleTag[1], icon: <Shield className="w-3 h-3 text-teal-500/70" /> });
    }
    if (permTags.length > 0) {
      details.push({ label: "Permissions", value: permTags.map(t => t[1]).join(", "), icon: <Key className="w-3 h-3 text-teal-500/70" /> });
    }

    const statusParts: string[] = [];
    if (publicTag) statusParts.push("public");
    if (privateTag) statusParts.push("private");
    if (openTag) statusParts.push("open");
    if (closedTag) statusParts.push("closed");
    if (statusParts.length > 0) {
      details.push({ label: "Status", value: statusParts.join(", "), icon: <Info className="w-3 h-3 text-teal-500/70" /> });
    }

    if (eTags.length > 0) {
      eTags.forEach(t => {
        if (!t[1]) return;
        details.push({ label: "Event", value: t[1].length > 16 ? `${t[1].slice(0, 8)}…${t[1].slice(-8)}` : t[1] });
      });
    }

    if (dTag?.[1]) {
      details.push({ label: "Identifier", value: dTag[1] });
    }

    if (event.kind >= 39000 && event.kind <= 39002 && pTags.length > 3) {
      const countLabel = event.kind === 39000 ? "admins" : event.kind === 39001 ? "members" : "roles";
      details.length = 0;
      if (groupId) details.push({ label: "Group", value: `#${groupId}`, icon: <Hash className="w-3 h-3 text-teal-500/70" /> });
      details.push({ label: "Contains", value: `${pTags.length} ${countLabel}`, icon: <Users className="w-3 h-3 text-teal-500/70" /> });
    }

    return (
      <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-teal-500/70 shrink-0" />
          <span className="text-[10px] text-teal-600 dark:text-teal-400/70 uppercase tracking-wider font-medium">
            {actionDescriptions[event.kind] || `NIP-29 Kind ${event.kind}`}
          </span>
          <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(event.created_at)}</span>
        </div>
        {event.content && (
          <p className="text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">{event.content}</p>
        )}
        {details.length > 0 && (
          <div className="space-y-1">
            {details.map((d, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-teal-500/5 dark:bg-teal-500/10 border border-teal-300/15 dark:border-teal-400/10">
                {d.icon || <Info className="w-3 h-3 text-teal-500/50 shrink-0" />}
                <span className="text-[10px] text-teal-600/70 dark:text-teal-400/50 uppercase tracking-wider font-medium shrink-0">{d.label}</span>
                <span className="text-[11px] font-mono text-foreground/70 truncate">{d.value}</span>
              </div>
            ))}
          </div>
        )}
        {details.length === 0 && !event.content && (
          <p className="text-[10px] text-muted-foreground/50 italic">No additional details in event</p>
        )}
      </div>
    );
  }

  const allUrls = extractAllUrls(event.content);
  const audioUrls = allUrls.filter(u => classifyUrl(u) === "audio");
  const videoLinkUrls = allUrls.filter(u => classifyUrl(u) === "video" && !VIDEO_EXT_RE.test(u));
  const linkUrls = allUrls.filter(u => classifyUrl(u) === "link");
  const textContent = stripUrls(event.content).trim();

  const hasNoVisualContent = !textContent && media.length === 0 && audioUrls.length === 0 && videoLinkUrls.length === 0 && linkUrls.length === 0;
  const meaningfulTags = event.tags.filter(t => t[0] !== "nonce" && t.length >= 2);

  return (
    <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
      {textContent && (
        <p className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words p-3 pb-2">{textContent}</p>
      )}
      {media.length > 0 && (
        <div className={`${media.length === 1 ? "flex" : "grid grid-cols-2"} gap-px`}>
          {media.slice(0, 4).map((url, i) => {
            const type = classifyUrl(url);
            if (type === "video") return <video key={i} src={url} controls className="w-full max-h-[240px] object-contain bg-black/10 dark:bg-black/30" />;
            if (type === "audio") return null;
            return <img key={i} src={url} alt="" className="w-full max-h-[240px] object-contain bg-black/10 dark:bg-black/30" loading="lazy" />;
          })}
        </div>
      )}
      {audioUrls.length > 0 && (
        <div className="p-3 space-y-2">
          {audioUrls.map(url => (
            <AudioPreviewCard key={url} url={url} />
          ))}
        </div>
      )}
      {videoLinkUrls.length > 0 && (
        <div className="p-3 space-y-2">
          {videoLinkUrls.map((url, i) => (
            <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-md bg-blue-500/5 dark:bg-blue-500/10 border border-blue-300/20 dark:border-blue-400/15">
              <Video className="w-4 h-4 text-blue-500/70 shrink-0" />
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline truncate flex-1" onClick={e => e.stopPropagation()}>
                {url.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
            </div>
          ))}
        </div>
      )}
      {linkUrls.length > 0 && (
        <div className="px-3 pb-2 space-y-2">
          {linkUrls.map((url, i) => (
            <LinkPreviewCard key={i} url={url} compact />
          ))}
        </div>
      )}
      {hasNoVisualContent && meaningfulTags.length > 0 && (
        <div className="p-3 space-y-1">
          <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium">Event Tags</span>
          <div className="space-y-0.5">
            {meaningfulTags.slice(0, 8).map((t, i) => (
              <div key={i} className="flex items-baseline gap-1.5">
                <span className="text-[10px] font-mono text-brand/60 shrink-0">{t[0]}</span>
                <span className="text-[10px] font-mono text-foreground/60 truncate">{t.slice(1).join(" · ")}</span>
              </div>
            ))}
            {meaningfulTags.length > 8 && (
              <span className="text-[10px] text-muted-foreground/40">+{meaningfulTags.length - 8} more tags</span>
            )}
          </div>
        </div>
      )}
      {hasNoVisualContent && meaningfulTags.length === 0 && (
        <p className="text-[11px] text-muted-foreground/60 italic p-3">No displayable content</p>
      )}
    </div>
  );
}

export const ADMIN_ALLOWLIST_KEY = "nostr_admin_allowlist_";
export const ADMIN_BLOCKLIST_KEY = "nostr_admin_blocklist_";
export const ADMIN_READONLY_KEY = "nostr_admin_readonly_";
export const MANUAL_TEAM_KEY = "nostr_relay_team_";
export const UPTIME_HISTORY_KEY = "relay_ops_uptime_";
export const STORAGE_TRENDS_KEY = "relay_ops_storage_";
export const MOD_LOG_KEY = "relay_ops_mod_log_";

export type ModAction =
  | "delete_event"
  | "bulk_delete"
  | "block_author"
  | "add_allowlist"
  | "add_readonly"
  | "add_blocklist"
  | "remove_allowlist"
  | "remove_readonly"
  | "remove_blocklist"
  | "import_allowlist"
  | "import_readonly"
  | "import_blocklist"
  | "relay_offline"
  | "relay_online"
  | "relay_latency_spike";

export interface ModerationLogEntry {
  id: string;
  ts: number;
  action: ModAction;
  targetPubkey?: string;
  targetEventId?: string;
  targetKind?: number;
  count?: number;
  note?: string;
}

export function getModLog(relayUrl: string): ModerationLogEntry[] {
  try {
    const stored = localStorage.getItem(MOD_LOG_KEY + relayUrl);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e: unknown) =>
      typeof e === "object" && e !== null && "id" in e && "ts" in e && "action" in e
    );
  } catch {
    return [];
  }
}

/**
 * Where a moderation entry is shared with the relay's team (lib/relay-team.ts).
 * The console registers one while it's open for a relay; every action that
 * writes the log here also lands in the team's shared log, from every screen,
 * without each screen knowing about teams.
 */
const teamLogSinks = new Map<string, (entry: Omit<ModerationLogEntry, "id" | "ts">) => void>();
export function setTeamLogSink(relayUrl: string, sink: ((entry: Omit<ModerationLogEntry, "id" | "ts">) => void) | null) {
  if (sink) teamLogSinks.set(relayUrl, sink); else teamLogSinks.delete(relayUrl);
}

export function addModLogEntry(relayUrl: string, entry: Omit<ModerationLogEntry, "id" | "ts">) {
  // Health events (offline/online/latency) are this device's own observations, not team decisions.
  if (!/^relay_/.test(entry.action)) { try { teamLogSinks.get(relayUrl)?.(entry); } catch {} }
  try {
    const log = getModLog(relayUrl);
    log.push({ ...entry, id: crypto.randomUUID(), ts: Date.now() });
    const trimmed = log.slice(-500);
    localStorage.setItem(MOD_LOG_KEY + relayUrl, JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return getModLog(relayUrl);
  }
}

export function clearModLog(relayUrl: string) {
  try { localStorage.removeItem(MOD_LOG_KEY + relayUrl); } catch {}
}

export function getStoredList(key: string, relayUrl: string): string[] {
  try {
    const stored = localStorage.getItem(key + relayUrl);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveStoredList(key: string, relayUrl: string, list: string[]) {
  localStorage.setItem(key + relayUrl, JSON.stringify(list));
}

export interface StorageTrendEntry {
  ts: number;
  totalEvents: number;
}

export function getStorageTrends(relayUrl: string): StorageTrendEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_TRENDS_KEY + relayUrl);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addStorageTrend(relayUrl: string, entry: StorageTrendEntry) {
  const history = getStorageTrends(relayUrl);
  history.push(entry);
  const trimmed = history.slice(-50);
  localStorage.setItem(STORAGE_TRENDS_KEY + relayUrl, JSON.stringify(trimmed));
}

export interface UptimeEntry {
  ts: number;
  latency: number | null;
  online: boolean;
}

export function getUptimeHistory(relayUrl: string): UptimeEntry[] {
  try {
    const stored = localStorage.getItem(UPTIME_HISTORY_KEY + relayUrl);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addUptimeEntry(relayUrl: string, entry: UptimeEntry) {
  const history = getUptimeHistory(relayUrl);
  history.push(entry);
  const trimmed = history.slice(-100);
  localStorage.setItem(UPTIME_HISTORY_KEY + relayUrl, JSON.stringify(trimmed));
}

/**
 * "settings" is the console's Settings section itself (three rows); the three
 * screens inside it keep their old ids so links made before the redesign land.
 */
export type TabId = "overview" | "live" | "events" | "people" | "access" | "announce" | "featured" | "community" | "feedback" | "settings" | "contact" | "team" | "log" | "connection" | "advanced" | "card" | "scans" | "groups";

export const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "live", label: "Live Feed", icon: Radio },
  { id: "events", label: "Events", icon: Search },
  { id: "announce", label: "Announce", icon: Megaphone },
  { id: "featured", label: "Featured Feeds", icon: MagicStarIcon },
  { id: "feedback", label: "Feedback", icon: Inbox },
  // "Relay" is load-bearing in both labels. This console governs the RELAY —
  // Access Control is NIP-86 allow/ban across every space on the box, and these
  // settings are the relay's own public face. A space's own door and name now
  // live in its admin drawer, and the two must never read as the same control.
  { id: "access", label: "Relay Access Control", icon: Lock },
  { id: "community", label: "Relay Settings", icon: Users },
];

export const CHART_COLORS = ["#a855f7", "#9333ea", "#7e22ce", "#6b21a8", "#c084fc", "#d8b4fe"];

export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number | null }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-foreground">
          {entry.name}: <span className="text-brand font-mono">{entry.value != null ? Number(entry.value).toLocaleString() : "—"}</span>
        </p>
      ))}
    </div>
  );
}

export interface KindCountEntry {
  kind: number;
  label: string;
  count: number;
}
export const URL_RE = /https?:\/\/\S+/i;

export interface SavedToolbarState {
  kindFilter?: string;
  authorFilter?: string;
  sourceFilter?: string;
  timeRange?: string;
  searchKind?: string;
  searchAuthor?: string;
  searchContent?: string;
  searchSince?: string;
  searchUntil?: string;
  timePreset?: string;
  searchEventId?: string;
}

export const VALID_TABS: Set<string> = new Set([...TABS.map(t => t.id), "settings", "people", "contact", "team", "log", "connection"]);

export function getTabFromHash(): TabId {
  // Every old address lands somewhere sensible (console-nav resolveTab).
  try { return resolveTab(window.location.hash.replace("#", "")); } catch { return "overview"; }
}

export const ADDED_AT_KEY = "relay_ops_added_at_";
export const ACTIVITY_CACHE_KEY = "relay_ops_activity_";
export const ACTIVITY_OPTIN_KEY = "relay_ops_activity_optin_";
export const ACTIVITY_REFRESH_KEY = "relay_ops_activity_refresh_";

const ACTIVITY_BACKGROUND_REFRESH_MS = 1000 * 60 * 60 * 24;
const ACTIVITY_AUTO_LIMIT = 200;
const ACTIVITY_BATCH_SIZE = 50;
const ACTIVITY_WINDOW_DAYS = 90;
const ACTIVITY_PROBE_TIMEOUT_MS = 8000;

export type UserListSort = "name-asc" | "name-desc" | "added-desc" | "added-asc" | "active-desc" | "active-asc";
export type UserListFilter = "all" | "active30" | "inactive" | "noprofile" | "nip05";

export interface UserListControls {
  query: string;
  sort: UserListSort;
  filter: UserListFilter;
}

export const DEFAULT_USER_LIST_CONTROLS: UserListControls = {
  query: "",
  sort: "name-asc",
  filter: "all",
};

const VALID_SORT = new Set<UserListSort>(["name-asc", "name-desc", "added-desc", "added-asc", "active-desc", "active-asc"]);
const VALID_FILTER = new Set<UserListFilter>(["all", "active30", "inactive", "noprofile", "nip05"]);

function readUrlControls(key: string): UserListControls {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get(`q-${key}`) || "";
    const s = params.get(`sort-${key}`) || "";
    const f = params.get(`filter-${key}`) || "";
    return {
      query: q,
      sort: VALID_SORT.has(s as UserListSort) ? (s as UserListSort) : "name-asc",
      filter: VALID_FILTER.has(f as UserListFilter) ? (f as UserListFilter) : "all",
    };
  } catch {
    return { ...DEFAULT_USER_LIST_CONTROLS };
  }
}

function writeUrlControls(key: string, controls: UserListControls) {
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    if (controls.query) params.set(`q-${key}`, controls.query); else params.delete(`q-${key}`);
    if (controls.sort !== "name-asc") params.set(`sort-${key}`, controls.sort); else params.delete(`sort-${key}`);
    if (controls.filter !== "all") params.set(`filter-${key}`, controls.filter); else params.delete(`filter-${key}`);
    window.history.replaceState(window.history.state, "", url.pathname + (params.toString() ? "?" + params.toString() : "") + url.hash);
  } catch {}
}

export function useUrlListControls(key: string) {
  const [controls, setControlsState] = useState<UserListControls>(() => readUrlControls(key));

  useEffect(() => {
    setControlsState(readUrlControls(key));
  }, [key]);

  const setQuery = useCallback((query: string) => {
    setControlsState(prev => {
      const next = { ...prev, query };
      writeUrlControls(key, next);
      return next;
    });
  }, [key]);

  const setSort = useCallback((sort: UserListSort) => {
    setControlsState(prev => {
      const next = { ...prev, sort };
      writeUrlControls(key, next);
      return next;
    });
  }, [key]);

  const setFilter = useCallback((filter: UserListFilter) => {
    setControlsState(prev => {
      const next = { ...prev, filter };
      writeUrlControls(key, next);
      return next;
    });
  }, [key]);

  return { controls, setQuery, setSort, setFilter };
}

function dateAddedStorageKey(relayUrl: string, listKey: string): string {
  return ADDED_AT_KEY + listKey + ":" + relayUrl;
}

export function getDateAddedMap(relayUrl: string, listKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(dateAddedStorageKey(relayUrl, listKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveDateAddedMap(relayUrl: string, listKey: string, map: Record<string, number>) {
  try { localStorage.setItem(dateAddedStorageKey(relayUrl, listKey), JSON.stringify(map)); } catch {}
}

export function recordDateAdded(relayUrl: string, listKey: string, pubkey: string, ts?: number): void {
  if (!pubkey) return;
  const map = getDateAddedMap(relayUrl, listKey);
  if (map[pubkey]) return;
  map[pubkey] = ts ?? Date.now();
  saveDateAddedMap(relayUrl, listKey, map);
}

export function recordDateAddedMany(relayUrl: string, listKey: string, pubkeys: string[]): void {
  if (pubkeys.length === 0) return;
  const map = getDateAddedMap(relayUrl, listKey);
  let changed = false;
  const now = Date.now();
  for (const pk of pubkeys) {
    if (!map[pk]) { map[pk] = now; changed = true; }
  }
  if (changed) saveDateAddedMap(relayUrl, listKey, map);
}

export function removeDateAdded(relayUrl: string, listKey: string, pubkey: string): void {
  const map = getDateAddedMap(relayUrl, listKey);
  if (map[pubkey] !== undefined) {
    delete map[pubkey];
    saveDateAddedMap(relayUrl, listKey, map);
  }
}

const ADDED_UPDATED_EVENT = "relay-ops-added-updated";

export function reconcileFirstSeen(relayUrl: string, listKey: string, list: string[]): Record<string, number> {
  const map = getDateAddedMap(relayUrl, listKey);
  if (list.length === 0) return map;
  let changed = false;
  for (const pk of list) {
    if (!(pk in map)) { map[pk] = 0; changed = true; }
  }
  if (changed) saveDateAddedMap(relayUrl, listKey, map);
  return map;
}

export function recordDateAddedHistorical(
  relayUrl: string,
  listKey: string,
  history: Record<string, number>,
): void {
  const entries = Object.entries(history);
  if (entries.length === 0) return;
  const map = getDateAddedMap(relayUrl, listKey);
  let changed = false;
  for (const [pk, rawTs] of entries) {
    if (!rawTs || !pk) continue;
    const tsMs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
    const existing = map[pk];
    if (!existing || existing === 0 || tsMs < existing) {
      map[pk] = tsMs;
      changed = true;
    }
  }
  if (changed) {
    saveDateAddedMap(relayUrl, listKey, map);
    try {
      window.dispatchEvent(new CustomEvent(ADDED_UPDATED_EVENT, { detail: { relayUrl, listKey } }));
    } catch {}
  }
}

export function useDateAdded(relayUrl: string, listKey: string, list: string[]): Record<string, number> {
  const [map, setMap] = useState<Record<string, number>>(() => getDateAddedMap(relayUrl, listKey));
  useEffect(() => {
    setMap(reconcileFirstSeen(relayUrl, listKey, list));
  }, [relayUrl, listKey, list]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.relayUrl === relayUrl && detail?.listKey === listKey) {
        setMap(getDateAddedMap(relayUrl, listKey));
      }
    };
    window.addEventListener(ADDED_UPDATED_EVENT, handler);
    return () => window.removeEventListener(ADDED_UPDATED_EVENT, handler);
  }, [relayUrl, listKey]);
  return map;
}

interface ActivityCacheEntry {
  lastActive: Record<string, number>;
  ts: number;
}

function activityCacheKey(relayUrl: string): string {
  return ACTIVITY_CACHE_KEY + relayUrl;
}

function loadActivityCache(relayUrl: string): ActivityCacheEntry {
  try {
    const raw = localStorage.getItem(activityCacheKey(relayUrl));
    if (!raw) return { lastActive: {}, ts: 0 };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.lastActive) return parsed as ActivityCacheEntry;
  } catch {}
  return { lastActive: {}, ts: 0 };
}

function saveActivityCache(relayUrl: string, entry: ActivityCacheEntry) {
  try { localStorage.setItem(activityCacheKey(relayUrl), JSON.stringify(entry)); } catch {}
}

function activityRefreshKey(relayUrl: string, listKey: string): string {
  return ACTIVITY_REFRESH_KEY + listKey + ":" + relayUrl;
}

function loadActivityRefreshTs(relayUrl: string, listKey: string): number {
  try {
    const raw = localStorage.getItem(activityRefreshKey(relayUrl, listKey));
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch { return 0; }
}

function saveActivityRefreshTs(relayUrl: string, listKey: string, ts: number) {
  try { localStorage.setItem(activityRefreshKey(relayUrl, listKey), String(ts)); } catch {}
}

const ACTIVITY_PROBE_QUEUES: Map<string, Promise<unknown>> = new Map();

function probeAuthorActivityBatch(
  relayUrl: string,
  pubkeys: string[],
  signal?: AbortSignal,
): Promise<Reached<Record<string, number>>> {
  return withReach(relayUrl, {} as Record<string, number>, () => new Promise((resolve) => {
    const result: Record<string, number> = {};
    if (pubkeys.length === 0) { resolve(result); return; }
    const since = Math.floor(Date.now() / 1000) - ACTIVITY_WINDOW_DAYS * 86400;
    const filter: NostrToolsFilter = { authors: pubkeys, since, limit: pubkeys.length * 3 };
    let resolved = false;
    let sub: SubCloser | null = null;
    const timer = setTimeout(finish, ACTIVITY_PROBE_TIMEOUT_MS);

    function finish() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (sub) { try { sub.close(); } catch {} }
      if (signal) signal.removeEventListener("abort", finish);
      resolve(result);
    }

    if (signal) {
      if (signal.aborted) { finish(); return; }
      signal.addEventListener("abort", finish);
    }

    try {
      sub = pool.subscribeMany(
        [relayUrl],
        filter,
        {
          onevent(e: NostrEvent) {
            const prev = result[e.pubkey] || 0;
            if (e.created_at > prev) result[e.pubkey] = e.created_at;
          },
          oneose() { finish(); },
        },
      );
    } catch {
      finish();
    }
  }));
}

export function probeAuthorActivity(
  relayUrl: string,
  pubkeys: string[],
  signal?: AbortSignal,
): Promise<Reached<Record<string, number>>> {
  if (pubkeys.length === 0) return Promise.resolve({ data: {}, reached: true });
  const previous = ACTIVITY_PROBE_QUEUES.get(relayUrl) || Promise.resolve();
  const next = previous.then(async () => {
    if (signal?.aborted) return { data: {}, reached: true } as Reached<Record<string, number>>;
    const merged: Record<string, number> = {};
    // One reachable batch is enough to call the relay reachable; the probe is
    // chunked, so a socket that drops midway still leaves the earlier answers
    // meaningful.
    let anyReached = false;
    for (let i = 0; i < pubkeys.length; i += ACTIVITY_BATCH_SIZE) {
      if (signal?.aborted) break;
      const batch = pubkeys.slice(i, i + ACTIVITY_BATCH_SIZE);
      const partial = await probeAuthorActivityBatch(relayUrl, batch, signal);
      if (partial.reached) anyReached = true;
      for (const pk of batch) {
        const found = partial.data[pk];
        if (found !== undefined && (!merged[pk] || found > merged[pk])) merged[pk] = found;
      }
    }
    return { data: merged, reached: anyReached };
  });
  const queueTail = next.catch(() => {});
  ACTIVITY_PROBE_QUEUES.set(relayUrl, queueTail);
  queueTail.then(() => {
    if (ACTIVITY_PROBE_QUEUES.get(relayUrl) === queueTail) {
      ACTIVITY_PROBE_QUEUES.delete(relayUrl);
    }
  });
  return next;
}

export type ActivityStatus = "idle" | "loading" | "loaded" | "gated" | "unreachable";

export function useActivityProbe(
  relayUrl: string,
  listKey: string,
  pubkeys: string[],
): { lastActive: Record<string, number>; status: ActivityStatus; run: () => void } {
  const [lastActive, setLastActive] = useState<Record<string, number>>(() => loadActivityCache(relayUrl).lastActive);
  const [status, setStatus] = useState<ActivityStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const optInKey = ACTIVITY_OPTIN_KEY + listKey + ":" + relayUrl;

  useEffect(() => {
    setLastActive(loadActivityCache(relayUrl).lastActive);
  }, [relayUrl]);

  const runProbe = useCallback((silent: boolean = false) => {
    if (pubkeys.length === 0) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!silent) setStatus("loading");
    probeAuthorActivity(relayUrl, pubkeys, ctrl.signal).then(({ data: probed, reached }) => {
      if (ctrl.signal.aborted) return;
      // A relay we never opened tells us nothing about who is active. The
      // branch below writes 0 ("No activity seen") for every pubkey it didn't
      // find AND persists it to localStorage — so an unreachable relay used to
      // stamp every row in every operator list as inactive, durably.
      if (!reached) { setStatus("unreachable"); return; }
      const prev = loadActivityCache(relayUrl);
      const merged: Record<string, number> = { ...prev.lastActive };
      for (const pk of pubkeys) {
        const found = probed[pk];
        if (found !== undefined) {
          if (!merged[pk] || found > merged[pk]) merged[pk] = found;
        } else if (merged[pk] === undefined) {
          merged[pk] = 0;
        }
      }
      const now = Date.now();
      saveActivityCache(relayUrl, { lastActive: merged, ts: now });
      saveActivityRefreshTs(relayUrl, listKey, now);
      setLastActive(merged);
      setStatus("loaded");
    });
  }, [relayUrl, pubkeys, listKey]);

  useEffect(() => {
    if (pubkeys.length === 0) { setStatus("idle"); return; }
    const cache = loadActivityCache(relayUrl);
    const haveAll = pubkeys.every(pk => pk in cache.lastActive);
    let optedIn = false;
    try { optedIn = localStorage.getItem(optInKey) === "1"; } catch {}
    const allowProbe = pubkeys.length <= ACTIVITY_AUTO_LIMIT || optedIn;

    // If we have any prior cached activity for this relay, surface it immediately
    // and never flicker back to "Activity not loaded". A silent background
    // refresh is dispatched at most once per day per relay+list, even when
    // membership has changed — newly added pubkeys will be picked up by the
    // next daily cycle (or by an explicit user-triggered refresh via run()).
    if (cache.ts > 0) {
      setLastActive(cache.lastActive);
      setStatus("loaded");
      const lastRefresh = loadActivityRefreshTs(relayUrl, listKey);
      const stale = Date.now() - lastRefresh > ACTIVITY_BACKGROUND_REFRESH_MS;
      if (stale && allowProbe) {
        runProbe(true);
      }
      return () => {
        if (abortRef.current) abortRef.current.abort();
      };
    }

    if (allowProbe) {
      runProbe();
    } else {
      setStatus("gated");
    }
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [relayUrl, listKey, optInKey, runProbe, pubkeys]);

  const run = useCallback(() => {
    try { localStorage.setItem(optInKey, "1"); } catch {}
    runProbe(false);
  }, [optInKey, runProbe]);

  return { lastActive, status, run };
}

export function userListMatch(rawQuery: string, hex: string, profile?: ProfileInfo): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  if (hex.toLowerCase().startsWith(query)) return true;
  const npub = pubkeyToNpub(hex).toLowerCase();
  if (npub.includes(query)) return true;
  const name = (profile?.name || "").toLowerCase();
  if (name && name.includes(query)) return true;
  const nip05 = (profile?.nip05 || "").toLowerCase();
  if (nip05 && nip05.includes(query)) return true;
  return false;
}

export function applyUserListControls(opts: {
  list: string[];
  controls: UserListControls;
  profileCache: Record<string, ProfileInfo>;
  addedAt: Record<string, number>;
  lastActive: Record<string, number>;
}): { filtered: string[]; total: number } {
  const { list, controls, profileCache, addedAt, lastActive } = opts;
  const total = list.length;
  const thirtyDaysAgoSec = Math.floor(Date.now() / 1000) - 30 * 86400;
  const filteredByQuery = controls.query
    ? list.filter(hex => userListMatch(controls.query, hex, profileCache[hex]))
    : list;
  const filteredByFilter = filteredByQuery.filter(hex => {
    const profile = profileCache[hex];
    const active = lastActive[hex];
    switch (controls.filter) {
      case "active30": return typeof active === "number" && active > 0 && active >= thirtyDaysAgoSec;
      case "inactive": return active === 0 || (typeof active === "number" && active < thirtyDaysAgoSec);
      case "noprofile": return !profile || (!profile.name && !profile.picture);
      case "nip05": return !!profile?.nip05;
      default: return true;
    }
  });
  const compareName = (a: string, b: string) => {
    const an = (profileCache[a]?.name || pubkeyToNpub(a)).toLowerCase();
    const bn = (profileCache[b]?.name || pubkeyToNpub(b)).toLowerCase();
    return an.localeCompare(bn);
  };
  const sorted = [...filteredByFilter].sort((a, b) => {
    switch (controls.sort) {
      case "name-asc": return compareName(a, b);
      case "name-desc": return compareName(b, a);
      case "added-desc": return (addedAt[b] || 0) - (addedAt[a] || 0);
      case "added-asc": return (addedAt[a] || Number.MAX_SAFE_INTEGER) - (addedAt[b] || Number.MAX_SAFE_INTEGER);
      case "active-desc": return (lastActive[b] || 0) - (lastActive[a] || 0);
      case "active-asc": return (lastActive[a] || Number.MAX_SAFE_INTEGER) - (lastActive[b] || Number.MAX_SAFE_INTEGER);
      default: return 0;
    }
  });
  return { filtered: sorted, total };
}

export function formatRelativeMs(ms: number | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export function formatRelativeSec(sec: number | undefined): string {
  if (sec === undefined || sec === 0) return "No activity seen";
  return "Active " + formatRelativeMs(sec * 1000).replace(" ago", " ago");
}

export function UserListToolbar({
  controls,
  setQuery,
  setSort,
  setFilter,
  total,
  matched,
  activityStatus,
  onLoadActivity,
  className,
}: {
  controls: UserListControls;
  setQuery: (v: string) => void;
  setSort: (v: UserListSort) => void;
  setFilter: (v: UserListFilter) => void;
  total: number;
  matched: number;
  activityStatus: ActivityStatus;
  onLoadActivity: () => void;
  className?: string;
}) {
  const showCounter = controls.query || controls.filter !== "all" || matched !== total;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 mb-2 ${className || ""}`}>
      <div className="relative flex-1 min-w-[140px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50 pointer-events-none" />
        <input
          type="text"
          value={controls.query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or address"
          className="w-full h-7 pl-7 pr-7 text-[11px] rounded-md bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none focus:border-primary/40"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
        {controls.query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground/60 hover:text-foreground"
            title="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <select
        value={controls.sort}
        onChange={(e) => setSort(e.target.value as UserListSort)}
        className="h-7 text-[10px] px-1.5 rounded-md bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none"
        title="Sort"
      >
        <option value="name-asc">Name A→Z</option>
        <option value="name-desc">Name Z→A</option>
        <option value="added-desc">Newest added</option>
        <option value="added-asc">Oldest added</option>
        <option value="active-desc">Most recently active</option>
        <option value="active-asc">Least recently active</option>
      </select>
      <select
        value={controls.filter}
        onChange={(e) => setFilter(e.target.value as UserListFilter)}
        className="h-7 text-[10px] px-1.5 rounded-md bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none"
        title="Filter"
      >
        <option value="all">All</option>
        <option value="active30">Active in 30d</option>
        <option value="inactive">No recent activity</option>
        <option value="noprofile">No profile metadata</option>
        <option value="nip05">Has a verified address</option>
      </select>
      {activityStatus === "gated" && (
        <button
          onClick={onLoadActivity}
          className="h-7 text-[10px] px-2 rounded-md bg-accent hover:bg-accent border border-brand/30 text-brand"
          title="Probe relay for last-active timestamps"
        >
          Load activity
        </button>
      )}
      {activityStatus === "loading" && (
        <span className="text-[10px] text-muted-foreground/60">Loading activity…</span>
      )}
      {activityStatus === "unreachable" && (
        // Offer the retry rather than leaving every row reading "Relay
        // unreachable" with no way forward — the probe is cheap and the relay
        // is usually back within seconds.
        <button
          onClick={onLoadActivity}
          className="h-7 text-[10px] px-2 rounded-md bg-accent hover:bg-accent border border-amber-400/30 text-amber-700 dark:text-amber-400/80"
          title="We couldn't reach the relay to read activity"
        >
          Couldn't reach relay — retry
        </button>
      )}
      <span className="text-[10px] text-muted-foreground/60 ml-auto">
        {showCounter ? `Showing ${matched} of ${total}` : `${total}`}
      </span>
    </div>
  );
}
