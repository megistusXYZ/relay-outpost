import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { nip19 } from "nostr-tools";
import type { Event as NostrEvent, Filter as NostrToolsFilter } from "nostr-tools";
import { pool, searchCachedProfiles } from "@/lib/nostr";
import { withReach, type Reached } from "@/lib/relay-reach";
import { searchUsers } from "@/lib/primal-cache";
import { classifyRelayUrl, getRelaysByType, type RelayType } from "@/lib/outpost-relays";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getAuthStatus, onAuthChange, type AuthStatus } from "@/lib/nip42-auth";
import { getSignalTierLabel, type SignalTier } from "@/lib/graperank";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { computeEngagementScore, formatEngagementScore, getEngagementTier } from "@/lib/engagement";
import type { EventStats } from "@/lib/primal-cache";
import { LinkPreviewCard } from "@/components/MediaRenderer";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Badge } from "@/components/ui/badge";
import {
  Radio,
  Activity,
  Info,
  Shield,
  Lock,
  Unlock,
  RefreshCw,
  Hash,
  Zap,
  Copy,
  Check,
  AlertTriangle,
  Search,
  Megaphone,
  ScrollText,
  Filter,
  X,
  User,
  Users,
  Music,
  Video,
  Image,
  Link,
  ExternalLink,
  Bookmark,
  FileDown,
  BarChart3,
  Repeat,
  Newspaper,
  Type,
  Package,
  Key,
  Award,
  FileText,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Vote,
  Clock,
  ListChecks,
  MessageSquare,
  Inbox,
} from "lucide-react";

export interface NostrFilter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  limit?: number;
  since?: number;
  until?: number;
  "#e"?: string[];
  "#p"?: string[];
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

export function shortHex(hex: string, len = 8): string {
  return hex.length > len * 2 ? `${hex.slice(0, len)}...${hex.slice(-len)}` : hex;
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
): Promise<{ events: NostrEvent[]; reached: boolean }> {
  return new Promise((resolve) => {
    const collected: NostrEvent[] = [];
    let reached = true;

    const doSubscribe = () => {
      const filter: NostrFilter = filters.length === 1 ? filters[0] : Object.assign({}, ...filters);
      const sub: SubCloser = pool.subscribeMany(
        relayUrls,
        filter,
        {
          onevent(e: NostrEvent) { collected.push(e); },
          oneose() { clearTimeout(timer); sub.close(); resolve({ events: collected, reached }); },
        },
      );
      const timer = setTimeout(() => { sub.close(); resolve({ events: collected, reached }); }, timeoutMs);
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
): Promise<{ count: number | null; supported: boolean }> {
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
        const { getGlobalSigner } = await import("@/lib/nip42-auth");
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
        const result = data[2] as { count?: number } | undefined;
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
    if (!first.transient) return { count: first.count, supported: first.supported };
    // One retry on transient failures (timeout / connect error / auth wait
    // expired) before concluding the relay does not support NIP-45.
    const second = await attempt();
    return { count: second.count, supported: second.supported };
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

export function EngagementTarget({ event, profiles }: { event: { kind: number; pubkey: string; tags: string[][]; content: string }; profiles: Map<string, ProfileInfo> }) {
  const targetPubkey = getEngagementTarget(event);
  const [copied, setCopied] = useState(false);
  const npub = targetPubkey ? pubkeyToNpub(targetPubkey) : "";
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    copyNostrId(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [npub]);
  if (!targetPubkey) return <span className="text-[10px] text-muted-foreground/40">—</span>;
  const profile = profiles.get(targetPubkey);
  const name = profile?.name || `${npub.slice(0, 12)}...`;
  return (
    <span className="flex items-center gap-1 min-w-0">
      {profile?.picture ? (
        <img src={profile.picture} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
      ) : (
        <span className="w-4 h-4 rounded-full bg-primary/15 shrink-0 flex items-center justify-center">
          <User className="w-2.5 h-2.5 text-brand/40" />
        </span>
      )}
      <span className="text-[10px] text-foreground/80 truncate">{name}</span>
      <button onClick={handleCopy} className="shrink-0 text-muted-foreground/60 hover:text-brand transition-colors" title="Copy npub">
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </button>
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

export const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([k, label]) => ({
  value: k,
  label: `${label} (${k})`,
  search: `${label} ${k}`.toLowerCase(),
}));

export function KindFilterSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const filtered = useMemo(() => {
    if (!query) return KIND_OPTIONS;
    const q = query.toLowerCase();
    return KIND_OPTIONS.filter(o => o.search.includes(q));
  }, [query]);

  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const dropUp = spaceBelow < 220 && rect.top > spaceBelow;
    setDropdownStyle({
      position: "fixed" as const,
      left: rect.left,
      width: rect.width,
      ...(dropUp ? { bottom: viewportH - rect.top + 4 } : { top: rect.bottom + 4 }),
      zIndex: 9999,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, filtered, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => updatePosition();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => { window.removeEventListener("scroll", handleScroll, true); window.removeEventListener("resize", handleScroll); };
  }, [open, updatePosition]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target) && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayValue = value === "all" ? "" : (KIND_OPTIONS.find(o => o.value === value)?.label || value);

  const select = (v: string) => {
    onChange(v);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={className}>
      <div className="relative">
        <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60 pointer-events-none" />
        <input
          ref={inputRef}
          placeholder="All Kinds"
          value={open ? query : displayValue}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(""); }}
          className="w-full h-7 text-[11px] pl-7 pr-6 rounded-md border border-input bg-background ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
        {value !== "all" && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); select("all"); }}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="rounded-lg overflow-hidden shadow-2xl border border-border/40 max-h-[220px] overflow-y-auto bg-popover backdrop-blur-xl"
        >
          <div
            className={`px-3 py-2 cursor-pointer transition-colors hover:bg-accent text-[11px] ${value === "all" ? "text-brand font-medium" : "text-muted-foreground/70"}`}
            onClick={() => select("all")}
          >
            All Kinds
          </div>
          {filtered.map(o => (
            <div
              key={o.value}
              className={`px-3 py-2 cursor-pointer transition-colors hover:bg-accent text-[11px] ${value === o.value ? "text-brand font-medium" : "text-foreground/80"}`}
              onClick={() => select(o.value)}
            >
              {o.label}
            </div>
          ))}
          {filtered.length === 0 && query && /^\d+$/.test(query.trim()) && (
            <div
              className="px-3 py-2 cursor-pointer transition-colors hover:bg-accent text-[11px] text-foreground/80"
              onClick={() => select(query.trim())}
            >
              Kind {query.trim()}
            </div>
          )}
          {filtered.length === 0 && query && !/^\d+$/.test(query.trim()) && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/60">No matching event kinds</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function AuthorSearchFilter({ value, onChange, className, placeholder }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NostrEvent[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [selectedName, setSelectedName] = useState("");

  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const dropUp = spaceBelow < 220 && rect.top > spaceBelow;
    setDropdownStyle({
      position: "fixed" as const,
      left: rect.left,
      width: Math.max(rect.width, 280),
      ...(dropUp ? { bottom: viewportH - rect.top + 4 } : { top: rect.bottom + 4 }),
      zIndex: 9999,
    });
  }, []);

  useLayoutEffect(() => {
    if (showResults) updatePosition();
  }, [showResults, searchResults, updatePosition]);

  useEffect(() => {
    if (!showResults) return;
    const handleScroll = () => updatePosition();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => { window.removeEventListener("scroll", handleScroll, true); window.removeEventListener("resize", handleScroll); };
  }, [showResults, updatePosition]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target) && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = useCallback((val: string) => {
    setQuery(val);
    setSelectedName("");
    const trimmed = val.trim();
    if (trimmed.startsWith("npub") || /^[0-9a-f]{10,}$/i.test(trimmed)) {
      onChange(trimmed);
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    if (!trimmed) {
      onChange("");
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cached = searchCachedProfiles(trimmed, 5);
      if (cached.length > 0) {
        setSearchResults(cached);
        setShowResults(true);
      }
      setSearching(true);
      try {
        const remote = await searchUsers(trimmed, 6);
        const seen = new Set<string>();
        const merged: NostrEvent[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) { seen.add(e.pubkey); merged.push(e); }
        }
        setSearchResults(merged.slice(0, 6));
        if (merged.length > 0) setShowResults(true);
      } catch {}
      setSearching(false);
    }, 300);
  }, [onChange]);

  const selectProfile = useCallback((pubkey: string) => {
    const event = searchResults.find(e => e.pubkey === pubkey);
    let name = "";
    if (event) {
      try {
        const p = JSON.parse(event.content);
        name = p.display_name || p.name || "";
      } catch {}
    }
    setSelectedName(name);
    setQuery("");
    setShowResults(false);
    setSearchResults([]);
    onChange(pubkey);
  }, [searchResults, onChange]);

  const clearFilter = useCallback(() => {
    setQuery("");
    setSelectedName("");
    setSearchResults([]);
    setShowResults(false);
    onChange("");
  }, [onChange]);

  const displayValue = selectedName || (value && !query ? (value.startsWith("npub") ? `${value.slice(0, 12)}...` : value.length === 64 ? `${value.slice(0, 10)}...` : value) : query);

  const dropdown = showResults && searchResults.length > 0 ? createPortal(
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="rounded-lg overflow-hidden shadow-2xl border border-border/40 max-h-[240px] overflow-y-auto bg-popover backdrop-blur-xl"
    >
      {searchResults.map((event) => {
        let content: Record<string, string> = {};
        try { content = JSON.parse(event.content); } catch {}
        const name = content.display_name || content.name || "";
        const picture = content.picture || "";
        const nip05 = content.nip05 || "";
        return (
          <div
            key={event.pubkey}
            className="flex items-center gap-2.5 px-3 py-2.5 sm:py-2 cursor-pointer transition-colors hover:bg-accent active:bg-accent"
            onClick={() => selectProfile(event.pubkey)}
          >
            <Avatar className="w-6 h-6 shrink-0">
              {picture ? <AvatarImage src={picture} alt={name} /> : null}
              <AvatarFallback className="bg-brand/20 text-brand text-[10px]">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground/90 truncate">{name || `${event.pubkey.slice(0, 12)}...`}</div>
              {nip05 && <div className="text-[10px] text-muted-foreground/70 truncate">{nip05}</div>}
            </div>
          </div>
        );
      })}
      {searching && <div className="px-3 py-1.5 text-[10px] text-muted-foreground/50 text-center">Searching...</div>}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef} className={className}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60 pointer-events-none" />
        <input
          ref={inputRef}
          placeholder={placeholder || "Filter by author"}
          value={displayValue}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => searchResults.length > 0 && setShowResults(true)}
          className="w-full h-7 text-[11px] pl-7 pr-6 rounded-md border border-input bg-background ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
        {value && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); clearFilter(); }}
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {searching && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
            <RelayOutpostInlineLoader className="w-3 h-3 text-brand" />
          </div>
        )}
      </div>
      {dropdown}
    </div>
  );
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

export function getEngagementTarget(event: { kind: number; pubkey: string; tags: string[][]; content: string }): string | null {
  if (event.kind === 7) {
    const pTag = event.tags.find(t => t[0] === "p" && t[1] && t[1] !== event.pubkey);
    return pTag?.[1] || null;
  }
  if (event.kind === 6 || event.kind === 16) {
    const pTag = event.tags.find(t => t[0] === "p" && t[1] && t[1] !== event.pubkey);
    if (pTag) return pTag[1];
    const inner = tryParseRepostInner(event.content);
    if (inner?.pubkey && inner.pubkey !== event.pubkey) return inner.pubkey;
    return null;
  }
  if (event.kind === 1) {
    const hasReplyTag = event.tags.some(t => t[0] === "e") || event.tags.some(t => t[0] === "q");
    if (hasReplyTag) {
      const pTag = event.tags.find(t => t[0] === "p" && t[1] && t[1] !== event.pubkey);
      return pTag?.[1] || null;
    }
  }
  return null;
}

export function ContentPreviewText({ content, maxLen = 80, kind, tags }: { content: string; maxLen?: number; kind?: number; tags?: string[][] }) {
  if (kind === 6 || kind === 16) {
    const inner = tryParseRepostInner(content);
    if (inner) {
      const innerText = stripUrls(inner.content).trim();
      const truncated = innerText.length > maxLen ? innerText.slice(0, maxLen) + "…" : innerText;
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400/70 shrink-0">
            <RefreshCw className="w-2.5 h-2.5" />
          </span>
          <span className="truncate">{truncated || "Repost"}</span>
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400/70 shrink-0">
          <RefreshCw className="w-2.5 h-2.5" />
        </span>
        <span className="truncate italic text-muted-foreground/60">Repost</span>
      </span>
    );
  }

  if (isRelayAnnouncement(kind, tags)) {
    const clean = content.replace(/\s*wss?:\/\/\S+/g, "").trim();
    const truncated = clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean;
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="flex items-center gap-0.5 text-brand dark:text-brand/70 shrink-0">
          <Megaphone className="w-2.5 h-2.5" />
        </span>
        <span className="truncate">{truncated}</span>
      </span>
    );
  }

  if (kind === 30023 || kind === 30024) {
    const titleTag = tags?.find((t) => t[0] === "title");
    const title = titleTag?.[1] || "";
    const displayText = title || content.replace(/<[^>]*>/g, "").replace(/#{1,6}\s+/g, "").replace(/[*_~`>]/g, "").trim();
    const truncated = displayText.length > maxLen ? displayText.slice(0, maxLen) + "…" : displayText;
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="flex items-center gap-0.5 text-brand dark:text-brand/70 shrink-0">
          <ScrollText className="w-2.5 h-2.5" />
        </span>
        <span className="truncate">{truncated}</span>
      </span>
    );
  }

  if (kind === 7) {
    const emoji = (!content || content === "+") ? "❤️" : content === "-" ? "👎" : content;
    const emojiTag = tags?.find(t => t[0] === "emoji" && t[2]);
    if (emojiTag) {
      return (
        <span className="flex items-center gap-1 min-w-0">
          <img src={emojiTag[2]} alt={emojiTag[1]} className="w-4 h-4 object-contain" />
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="truncate">{emoji}</span>
      </span>
    );
  }

  const isNip29Kind = kind !== undefined && (
    (kind >= 9000 && kind <= 9022) ||
    (kind >= 39000 && kind <= 39002) ||
    kind === 10009 || kind === 11 || kind === 12
  );
  if (isNip29Kind && tags) {
    const hTag = tags.find(t => t[0] === "h");
    const groupId = hTag?.[1] || "";
    const pTags = tags.filter(t => t[0] === "p");
    const nameTag = tags.find(t => t[0] === "name");
    const roleTag = tags.find(t => t[0] === "role");
    const parts: string[] = [];
    if (groupId) parts.push(`#${groupId}`);
    if (nameTag?.[1]) parts.push(`name: ${nameTag[1]}`);
    if (roleTag?.[1]) parts.push(`role: ${roleTag[1]}`);
    if (pTags.length === 1 && pTags[0][1]) parts.push(`user: ${pTags[0][1].slice(0, 8)}…`);
    else if (pTags.length > 1) parts.push(`${pTags.length} users`);
    if (content && content.trim()) parts.push(content.trim().slice(0, 40));
    const summary = parts.join(" · ") || KIND_LABELS[kind] || `Kind ${kind}`;
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <Users className="w-2.5 h-2.5 text-teal-500/70 shrink-0" />
        <span className="truncate">{summary}</span>
      </span>
    );
  }

  if (!content && tags && tags.length > 0) {
    const hTag = tags.find(t => t[0] === "h");
    const dTag = tags.find(t => t[0] === "d");
    const eTag = tags.find(t => t[0] === "e");
    const pTag = tags.find(t => t[0] === "p");
    const parts: string[] = [];
    if (hTag?.[1]) parts.push(`h: ${hTag[1]}`);
    if (dTag?.[1]) parts.push(`d: ${dTag[1]}`);
    if (eTag?.[1]) parts.push(`e: ${(eTag[1].length > 8 ? eTag[1].slice(0, 8) + "…" : eTag[1])}`);
    if (pTag?.[1]) parts.push(`p: ${(pTag[1].length > 8 ? pTag[1].slice(0, 8) + "…" : pTag[1])}`);
    if (parts.length > 0) {
      return (
        <span className="flex items-center gap-1.5 min-w-0 text-muted-foreground/50 italic">
          <Package className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{parts.join(" · ")}</span>
        </span>
      );
    }
    return (
      <span className="text-muted-foreground/40 italic text-[10px]">{tags.length} tags</span>
    );
  }

  if (!content) return null;
  const allUrls = extractAllUrls(content);
  const clean = stripUrls(content).trim();

  const types = allUrls.map(classifyUrl);
  const hasGif = types.includes("gif");
  const hasVideo = types.includes("video");
  const hasAudio = types.includes("audio");
  const hasImage = types.includes("image");
  const imageCount = types.filter(t => t === "image").length;

  if (clean) {
    const truncated = clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean;
    const badges: { icon: typeof Music; label: string }[] = [];
    if (hasAudio) badges.push({ icon: Music, label: "Audio" });
    if (hasVideo) badges.push({ icon: Video, label: "Video" });
    if (hasGif) badges.push({ icon: Image, label: "GIF" });
    if (hasImage) badges.push({ icon: Image, label: `${imageCount} img` });

    return (
      <span className="flex items-center gap-1.5 min-w-0">
        {badges.map(b => (
          <span key={b.label} className="flex items-center gap-0.5 text-brand dark:text-brand/70 shrink-0">
            <b.icon className="w-2.5 h-2.5" />
          </span>
        ))}
        <span className="truncate">{truncated}</span>
      </span>
    );
  }

  if (allUrls.length > 0) {
    const IconComp = hasAudio ? Music : hasVideo ? Video : hasGif ? Image : hasImage ? Image : Link;
    const label = hasAudio ? "Audio" : hasVideo ? "Video" : hasGif ? "GIF" : hasImage ? `${imageCount} image${imageCount > 1 ? "s" : ""}` : "Link";
    return (
      <span className="flex items-center gap-1 text-brand dark:text-brand/70 italic">
        <IconComp className="w-3 h-3" />
        {label}
      </span>
    );
  }
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
        <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
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
        <div className="w-10 h-10 rounded-lg bg-primary/15 shrink-0" />
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
          <div className="w-12 h-12 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
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
      <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
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

export function addModLogEntry(relayUrl: string, entry: Omit<ModerationLogEntry, "id" | "ts">) {
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

export type TabId = "overview" | "live" | "events" | "access" | "announce" | "community" | "feedback";

export const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "live", label: "Live Feed", icon: Radio },
  { id: "events", label: "Events", icon: Search },
  { id: "announce", label: "Announce", icon: Megaphone },
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

export function AuthStatusBadge({ status }: { status: AuthStatus }) {
  switch (status) {
    case "authenticated":
      return <Badge variant="outline" className="text-[10px] border-green-400/30 dark:border-green-400/20 text-green-600 dark:text-green-400/70"><Lock className="w-2.5 h-2.5 mr-0.5" />Authenticated</Badge>;
    case "authenticating":
      return <Badge variant="outline" className="text-[10px] border-yellow-400/30 dark:border-yellow-400/20 text-yellow-600 dark:text-yellow-400/60"><RefreshCw className="w-2.5 h-2.5 mr-0.5 animate-spin" />Authenticating</Badge>;
    case "challenged":
      return <Badge variant="outline" className="text-[10px] border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Challenged</Badge>;
    case "failed":
      return <Badge variant="outline" className="text-[10px] border-red-400/30 dark:border-red-400/20 text-red-600 dark:text-red-400/70"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Failed</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] border-black/10 dark:border-white/10 text-muted-foreground/70"><Unlock className="w-2.5 h-2.5 mr-0.5" />No Auth</Badge>;
  }
}

export interface KindCountEntry {
  kind: number;
  label: string;
  count: number;
}



export type RelaySource = "public" | "private" | "both" | "unknown";

export function relaySourceLabel(source: RelaySource): string {
  switch (source) {
    case "public": return "Public";
    case "private": return "Private";
    case "both": return "Both";
    default: return "—";
  }
}

export function relaySourceClasses(source: RelaySource): string {
  switch (source) {
    case "public": return "border-green-400/30 dark:border-green-400/20 text-green-700 dark:text-green-400/70";
    case "private": return "border-amber-400/30 dark:border-amber-400/20 text-amber-700 dark:text-amber-400/70";
    case "both": return "border-brand/30 dark:border-brand/20 text-brand dark:text-brand/70";
    default: return "border-black/10 dark:border-white/10 text-muted-foreground/60";
  }
}

export function getOppositeRelays(currentRelayUrl: string): { type: RelayType; oppositeUrls: string[] } {
  const currentType = classifyRelayUrl(currentRelayUrl);
  if (currentType === "private") {
    return { type: currentType, oppositeUrls: getRelaysByType("public") };
  }
  return { type: currentType, oppositeUrls: getRelaysByType("private") };
}

export async function checkEventPresenceOnRelays(eventIds: string[], relayUrls: string[]): Promise<Set<string>> {
  if (eventIds.length === 0 || relayUrls.length === 0) return new Set();
  const found = new Set<string>();
  await Promise.all(
    relayUrls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const sub = pool.subscribeMany([url], { ids: eventIds }, {
            onevent(e: NostrEvent) { found.add(e.id); },
            oneose() { clearTimeout(timer); sub.close(); resolve(); },
          });
          const timer = setTimeout(() => { sub.close(); resolve(); }, 5000);
        }),
    ),
  );
  return found;
}

export function determineRelaySource(currentType: RelayType, presentOnOpposite: boolean): RelaySource {
  if (currentType === "private") {
    return presentOnOpposite ? "both" : "private";
  }
  return presentOnOpposite ? "both" : "public";
}

export type ContentType = "image" | "gif" | "video" | "audio" | "article" | "repost" | "link" | "text";

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection } | null;

export const CONTENT_TYPE_META: { type: ContentType; label: string; icon: typeof Image }[] = [
  { type: "image", label: "Image", icon: Image },
  { type: "gif", label: "GIF", icon: Image },
  { type: "video", label: "Video", icon: Video },
  { type: "audio", label: "Music", icon: Music },
  { type: "article", label: "Article", icon: Newspaper },
  { type: "repost", label: "Repost", icon: Repeat },
  { type: "link", label: "Link", icon: Link },
  { type: "text", label: "Text", icon: Type },
];

export const IMAGE_RE = /https?:\/\/\S+\.(jpg|jpeg|png|webp|svg|bmp|avif)(?=[?\s#]|$)/i;
export const GIF_RE = /https?:\/\/\S+\.gif(?=[?\s#]|$)/i;
export const VIDEO_RE = /https?:\/\/\S+\.(mp4|webm|mov|avi|mkv|m3u8)(?=[?\s#]|$)/i;
export const AUDIO_RE = /https?:\/\/\S+\.(mp3|wav|ogg|flac|m4a|aac|opus)(?=[?\s#]|$)/i;
export const URL_RE = /https?:\/\/\S+/i;

export function detectContentTypes(e: { kind: number; content: string; tags: string[][] }): ContentType[] {
  const types: ContentType[] = [];
  if (e.kind === 6 || e.kind === 16) { types.push("repost"); return types; }
  if (e.kind === 30023 || e.kind === 30024) { types.push("article"); return types; }
  const hasImeta = e.tags.some(t => t[0] === "imeta");
  const imetaUrls = hasImeta ? e.tags.filter(t => t[0] === "imeta").map(t => t.find(v => v.startsWith("url "))?.slice(4) || "").filter(Boolean) : [];
  const allText = e.content + " " + imetaUrls.join(" ");
  if (GIF_RE.test(allText)) types.push("gif");
  if (IMAGE_RE.test(allText) || e.kind === 20) types.push("image");
  if (VIDEO_RE.test(allText) || e.kind === 34235) types.push("video");
  if (AUDIO_RE.test(allText) || e.kind === 31337) types.push("audio");
  if (types.length === 0 && URL_RE.test(allText)) types.push("link");
  if (types.length === 0) types.push("text");
  return types;
}

export interface ColumnFilters {
  sources: string[];
  kinds: number[];
  authors: string[];
  wotTiers: string[];
  scoreTiers: string[];
  engagement: string[];
  contentSearch: string;
  contentTypes: ContentType[];
  dateRange: { since: number | null; until: number | null };
}

export const EMPTY_COLUMN_FILTERS: ColumnFilters = { sources: [], kinds: [], authors: [], wotTiers: [], scoreTiers: [], engagement: [], contentSearch: "", contentTypes: [], dateRange: { since: null, until: null } };

export function hasActiveColumnFilters(f: ColumnFilters): boolean {
  return f.sources.length > 0 || f.kinds.length > 0 || f.authors.length > 0 || (f.wotTiers?.length || 0) > 0 || (f.scoreTiers?.length || 0) > 0 || f.engagement.length > 0 || f.contentSearch !== "" || (f.contentTypes?.length || 0) > 0 || f.dateRange.since !== null || f.dateRange.until !== null;
}

export function countActiveColumnFilters(f: ColumnFilters): number {
  let c = 0;
  if (f.sources.length > 0) c++;
  if (f.kinds.length > 0) c++;
  if (f.authors.length > 0) c++;
  if ((f.wotTiers?.length || 0) > 0) c++;
  if ((f.scoreTiers?.length || 0) > 0) c++;
  if (f.engagement.length > 0) c++;
  if (f.contentSearch) c++;
  if ((f.contentTypes?.length || 0) > 0) c++;
  if (f.dateRange.since !== null || f.dateRange.until !== null) c++;
  return c;
}

export const WOT_NODATA = "__nodata__";

export const WOT_TIER_OPTIONS: { value: string; label: string; dotClass: string }[] = [
  { value: "strong", label: "Highly Trusted", dotClass: "bg-emerald-500" },
  { value: "moderate", label: "Trusted", dotClass: "bg-blue-500" },
  { value: "low", label: "Neutral", dotClass: "bg-cyan-400" },
  { value: "weak", label: "Low Trust", dotClass: "bg-amber-400" },
  { value: "flagged", label: "Flagged", dotClass: "bg-red-500" },
  { value: "none", label: "Unverified", dotClass: "bg-slate-400/50 dark:bg-slate-500/40" },
  { value: WOT_NODATA, label: "— No Data", dotClass: "bg-slate-300/30 dark:bg-slate-600/30" },
];

export const SCORE_TIER_OPTIONS: { value: string; label: string; colorClass: string }[] = [
  { value: "high", label: "High (50+)", colorClass: "text-emerald-600 dark:text-emerald-400" },
  { value: "mid", label: "Medium (10–49)", colorClass: "text-blue-600 dark:text-blue-400" },
  { value: "low", label: "Low (1–9)", colorClass: "text-amber-600 dark:text-amber-400" },
  { value: "none", label: "None (0)", colorClass: "text-slate-400 dark:text-slate-500" },
];

export function wotTierDotClass(tier: SignalTier): string {
  return WOT_TIER_OPTIONS.find(o => o.value === tier)?.dotClass || "bg-slate-400/50";
}

export function WotBadge({ pubkey, observerPubkey, event, getAuthorTier, isAuthorFlagged }: { pubkey: string; observerPubkey?: string; event?: { kind: number; pubkey: string; tags: string[][]; content: string }; getAuthorTier: (pk: string) => SignalTier; isAuthorFlagged: (pk: string) => boolean }) {
  const { wotEnabled } = useGrapeRankScores();
  if (!wotEnabled) return null; // Web of Trust off → no trust column data
  if (!observerPubkey || !event) {
    return <span className="text-[10px] text-muted-foreground/30">—</span>;
  }
  const target = getEngagementTarget(event);
  const isObserverAuthor = pubkey === observerPubkey;
  const isObserverTarget = target === observerPubkey;
  if (!isObserverAuthor && !isObserverTarget) {
    return <span className="text-[10px] text-muted-foreground/30">—</span>;
  }
  if (isObserverAuthor && !target) {
    return <span className="text-[10px] text-muted-foreground/30">—</span>;
  }
  const lookupPk = isObserverAuthor ? target! : pubkey;
  const flagged = isAuthorFlagged(lookupPk);
  const tier = flagged ? "flagged" as SignalTier : getAuthorTier(lookupPk);
  const label = getSignalTierLabel(tier);
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/70 truncate">
      <TrustTierGlyph tier={tier} size="w-2 h-2" decorative />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function getEngagementTargetEventId(event: { kind: number; tags: string[][]; content: string }): string | null {
  if (event.kind === 7) {
    const eTags = event.tags.filter(t => t[0] === "e" && t[1]);
    return eTags.length > 0 ? eTags[eTags.length - 1][1] : null;
  }
  if (event.kind === 6 || event.kind === 16) {
    const eTag = event.tags.find(t => t[0] === "e" && t[1]);
    if (eTag) return eTag[1];
    const inner = tryParseRepostInner(event.content);
    return inner?.id ?? null;
  }
  if (event.kind === 9735) {
    const eTag = event.tags.find(t => t[0] === "e" && t[1]);
    return eTag?.[1] ?? null;
  }
  if (event.kind === 1) {
    const eTags = event.tags.filter(t => t[0] === "e" && t[1]);
    if (eTags.length > 0) {
      const replyTag = eTags.find(t => t[3] === "reply");
      if (replyTag) return replyTag[1];
      return eTags[eTags.length - 1][1];
    }
    const qTag = event.tags.find(t => t[0] === "q" && t[1]);
    return qTag?.[1] ?? null;
  }
  return null;
}

export function getScoreEventId(event: { id: string; kind: number; tags: string[][]; content: string }): string {
  const targetId = getEngagementTargetEventId(event);
  return targetId ?? event.id;
}

export function ScoreBadge({ eventId, statsMap }: { eventId: string; statsMap: Record<string, EventStats> }) {
  const stats = statsMap[eventId];
  const score = computeEngagementScore(stats ?? null);
  const tier = getEngagementTier(score);
  const colorClass = SCORE_TIER_OPTIONS.find(o => o.value === tier)?.colorClass || "text-slate-400";
  return (
    <span className={`text-[10px] font-mono tabular-nums ${colorClass}`}>
      {formatEngagementScore(score)}
    </span>
  );
}

export function getVisibleWotTier(event: { kind: number; pubkey: string; tags: string[][]; content: string }, getTier: (pk: string) => SignalTier, observerPubkey?: string): SignalTier | null {
  if (!observerPubkey) return null;
  const target = getEngagementTarget(event);
  const isObserverAuthor = event.pubkey === observerPubkey;
  const isObserverTarget = target === observerPubkey;
  if (!isObserverAuthor && !isObserverTarget) return null;
  if (isObserverAuthor && !target) return null;
  const lookupPk = isObserverAuthor ? target! : event.pubkey;
  return getTier(lookupPk);
}

export function applyColumnFilters<T extends { kind: number; pubkey: string; content: string; tags: string[][]; created_at: number; id: string }>(
  events: T[],
  filters: ColumnFilters,
  getSource?: (e: T) => string | undefined,
  getTier?: (pubkey: string) => SignalTier,
  getScore?: (eventId: string) => number,
  observerPubkey?: string,
): T[] {
  if (!hasActiveColumnFilters(filters)) return events;
  return events.filter(e => {
    if (filters.sources.length > 0) {
      const src = getSource?.(e);
      if (!src || !filters.sources.includes(src)) return false;
    }
    if (filters.kinds.length > 0 && !filters.kinds.includes(e.kind)) return false;
    if (filters.authors.length > 0 && !filters.authors.includes(e.pubkey)) return false;
    if ((filters.wotTiers?.length || 0) > 0 && getTier) {
      const visibleTier = getVisibleWotTier(e, getTier, observerPubkey);
      if (visibleTier === null) {
        if (!filters.wotTiers.includes(WOT_NODATA)) return false;
      } else {
        if (!filters.wotTiers.includes(visibleTier)) return false;
      }
    }
    if ((filters.scoreTiers?.length || 0) > 0 && getScore) {
      const score = getScore(e.id);
      const tier = getEngagementTier(score);
      if (!filters.scoreTiers.includes(tier)) return false;
    }
    if (filters.engagement.length > 0) {
      const target = getEngagementTarget(e);
      if (!target) {
        if (!filters.engagement.includes(ENGAGEMENT_NONE)) return false;
      } else {
        if (!filters.engagement.includes(target)) return false;
      }
    }
    if (filters.contentSearch) {
      if (!e.content.toLowerCase().includes(filters.contentSearch.toLowerCase())) return false;
    }
    if (filters.contentTypes?.length > 0) {
      const types = detectContentTypes(e);
      if (!filters.contentTypes.some(ct => types.includes(ct))) return false;
    }
    if (filters.dateRange.since !== null && e.created_at < filters.dateRange.since) return false;
    if (filters.dateRange.until !== null && e.created_at > filters.dateRange.until) return false;
    return true;
  });
}

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

export const DEFAULT_LIVE_TOOLBAR: SavedToolbarState = { kindFilter: "all", authorFilter: "", sourceFilter: "all", timeRange: "live" };

export function hasNonDefaultToolbar(t: SavedToolbarState | undefined): boolean {
  if (!t) return false;
  return (t.kindFilter !== undefined && t.kindFilter !== "all") ||
    (t.authorFilter !== undefined && t.authorFilter !== "") ||
    (t.sourceFilter !== undefined && t.sourceFilter !== "all") ||
    (t.timeRange !== undefined && t.timeRange !== "live") ||
    (t.searchKind !== undefined && t.searchKind !== "") ||
    (t.searchAuthor !== undefined && t.searchAuthor !== "") ||
    (t.searchContent !== undefined && t.searchContent !== "") ||
    (t.searchSince !== undefined && t.searchSince !== "") ||
    (t.searchUntil !== undefined && t.searchUntil !== "") ||
    (t.timePreset !== undefined && t.timePreset !== "none");
}

export interface SavedFilterView {
  id: string;
  name: string;
  filters: ColumnFilters;
  toolbar?: SavedToolbarState;
  createdAt: number;
}

export function getSavedViews(relayUrl: string, tab: string): SavedFilterView[] {
  try {
    const raw = localStorage.getItem(`relay-ops-views:${tab}:${relayUrl}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function persistSavedViews(relayUrl: string, tab: string, views: SavedFilterView[]): void {
  localStorage.setItem(`relay-ops-views:${tab}:${relayUrl}`, JSON.stringify(views));
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportEventsAsCSV(events: { kind: number; pubkey: string; content: string; tags: string[][]; created_at: number }[], profiles: Map<string, ProfileInfo>, getSource?: (e: { kind: number; pubkey: string; content: string; tags: string[][]; created_at: number }) => string): void {
  const header = ["Date/Time", "Source", "Kind", "Author Name", "Author npub", "Engagement Name", "Engagement npub", "Content"];
  const rows = events.map(e => {
    const authorP = profiles.get(e.pubkey);
    const engTarget = getEngagementTarget(e);
    const engP = engTarget ? profiles.get(engTarget) : null;
    return [
      formatTimestamp(e.created_at),
      getSource?.(e) || "",
      getKindLabel(e.kind, e.tags),
      authorP?.name || "Unknown",
      pubkeyToNpub(e.pubkey),
      engP?.name || (engTarget ? pubkeyToNpub(engTarget).slice(0, 16) + "..." : ""),
      engTarget ? pubkeyToNpub(engTarget) : "",
      e.content.replace(/[\n\r]+/g, " ").slice(0, 500),
    ];
  });
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile(csv, "relay-events.csv", "text/csv");
}

export function exportEventsAsJSON(events: Array<{ id: string; kind: number; pubkey: string; content: string; created_at: number; tags: string[][]; sig?: string }>): void {
  const raw = events.map(e => ({
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags,
    content: e.content,
    ...(e.sig ? { sig: e.sig } : {}),
  }));
  downloadFile(JSON.stringify(raw, null, 2), "relay-events.json", "application/json");
}

export function FilterPopover({ children, anchorRef, open, onClose }: { children: React.ReactNode; anchorRef: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const w = 220;
    let left = rect.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 4) left = 4;
    setStyle({ position: "fixed", top: rect.bottom + 4, left, zIndex: 9999 });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      style={style}
      className="bg-background/98 backdrop-blur-xl border border-black/[0.12] dark:border-white/[0.1] rounded-lg shadow-2xl p-2.5 min-w-[200px] max-h-[min(300px,60vh)] overflow-y-auto overscroll-contain"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function CheckboxFilterContent({ label, options, selected, onChange, onClear }: {
  label: string;
  options: { value: string; label: string; count?: number }[];
  selected: string[];
  onChange: (val: string[]) => void;
  onClear: () => void;
}) {
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">{label}</div>
      {options.map(opt => (
        <label key={opt.value} className="flex items-center gap-2 py-1.5 px-1.5 rounded-md cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] active:bg-accent select-none">
          <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} className="rounded border-brand/40 text-brand focus:ring-ring w-3.5 h-3.5" />
          <span className="text-[10px] text-foreground/80 truncate flex-1">{opt.label}</span>
          {opt.count !== undefined && <span className="text-[10px] text-muted-foreground/50">{opt.count}</span>}
        </label>
      ))}
      {selected.length > 0 && (
        <button onClick={onClear} className="text-[10px] text-brand hover:text-brand/80 mt-1.5 px-1">Clear filter</button>
      )}
    </div>
  );
}

export const ENGAGEMENT_NONE = "__none__";

export function ProfileFilterContent({ label, options, selected, onChange, onClear, profiles, showNoneOption, noneCount }: {
  label: string;
  options: { pubkey: string; count: number }[];
  selected: string[];
  onChange: (val: string[]) => void;
  onClear: () => void;
  profiles: Map<string, ProfileInfo>;
  showNoneOption?: boolean;
  noneCount?: number;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? options.filter(o => {
        const p = profiles.get(o.pubkey);
        const name = p?.name || pubkeyToNpub(o.pubkey);
        return name.toLowerCase().includes(search.toLowerCase());
      })
    : options;
  const toggle = (pk: string) => {
    onChange(selected.includes(pk) ? selected.filter(x => x !== pk) : [...selected, pk]);
  };
  const showNone = showNoneOption && (!search || "none".includes(search.toLowerCase()));
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">{label}</div>
      <input
        type="text"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        onClick={e => e.stopPropagation()}
        className="w-full h-6 px-2 mb-2 rounded border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02] text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {showNone && (
        <label className="flex items-center gap-1.5 py-1.5 px-1.5 rounded-md cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] active:bg-accent border-b border-black/[0.06] dark:border-white/[0.04] mb-1 pb-2 select-none">
          <input type="checkbox" checked={selected.includes(ENGAGEMENT_NONE)} onChange={() => toggle(ENGAGEMENT_NONE)} className="rounded border-brand/40 text-brand focus:ring-ring w-3.5 h-3.5 shrink-0" />
          <span className="text-[10px] text-muted-foreground/60 italic flex-1">— None</span>
          {noneCount !== undefined && noneCount > 0 && <span className="text-[10px] text-muted-foreground/50">{noneCount}</span>}
        </label>
      )}
      {filtered.length === 0 && !showNone && <div className="text-[10px] text-muted-foreground/50 px-1 py-2">No data available</div>}
      {filtered.slice(0, 20).map(opt => {
        const p = profiles.get(opt.pubkey);
        return (
          <label key={opt.pubkey} className="flex items-center gap-1.5 py-1.5 px-1.5 rounded-md cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] active:bg-accent select-none">
            <input type="checkbox" checked={selected.includes(opt.pubkey)} onChange={() => toggle(opt.pubkey)} className="rounded border-brand/40 text-brand focus:ring-ring w-3.5 h-3.5 shrink-0" />
            {p?.picture ? (
              <img src={p.picture} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
            ) : (
              <span className="w-4 h-4 rounded-full bg-primary/15 shrink-0 flex items-center justify-center">
                <User className="w-2.5 h-2.5 text-brand/40" />
              </span>
            )}
            <span className="text-[10px] text-foreground/80 truncate flex-1">{p?.name || pubkeyToNpub(opt.pubkey).slice(0, 16) + "..."}</span>
            <span className="text-[10px] text-muted-foreground/50">{opt.count}</span>
          </label>
        );
      })}
      {filtered.length > 20 && <div className="text-[10px] text-muted-foreground/50 px-1 mt-1">{filtered.length - 20} more...</div>}
      {selected.length > 0 && (
        <button onClick={onClear} className="text-[10px] text-brand hover:text-brand/80 mt-1.5 px-1">Clear filter</button>
      )}
    </div>
  );
}

export function ContentFilterContent({ value, onChange, contentTypes, onContentTypesChange, typeCounts }: {
  value: string;
  onChange: (v: string) => void;
  contentTypes: ContentType[];
  onContentTypesChange: (v: ContentType[]) => void;
  typeCounts?: Map<ContentType, number>;
}) {
  const toggleType = (t: ContentType) => {
    onContentTypesChange(contentTypes.includes(t) ? contentTypes.filter(ct => ct !== t) : [...contentTypes, t]);
  };
  return (
    <div onClick={e => e.stopPropagation()}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Filter by Type</div>
      {CONTENT_TYPE_META.map(({ type, label, icon: Icon }) => {
        const count = typeCounts?.get(type) || 0;
        return (
          <label key={type} className="flex items-center gap-2 py-1.5 px-1.5 rounded-md cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] active:bg-accent select-none">
            <input type="checkbox" checked={contentTypes.includes(type)} onChange={() => toggleType(type)} className="rounded border-brand/40 text-brand focus:ring-ring w-3.5 h-3.5" />
            <Icon className="w-3 h-3 text-muted-foreground/70 shrink-0" />
            <span className="text-[10px] text-foreground/80 truncate flex-1">{label}</span>
            {count > 0 && <span className="text-[10px] text-muted-foreground/50">{count}</span>}
          </label>
        );
      })}
      {contentTypes.length > 0 && (
        <button onClick={() => onContentTypesChange([])} className="text-[10px] text-brand hover:text-brand/80 mt-1.5 px-1">Clear types</button>
      )}
      <div className="border-t border-black/[0.06] dark:border-white/[0.04] mt-2 pt-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Search Text</div>
        <input
          type="text"
          placeholder="Contains text..."
          value={value}
          onChange={e => onChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          className="w-full h-7 px-2 rounded border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02] text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {value && (
          <button onClick={() => onChange("")} className="text-[10px] text-brand hover:text-brand/80 mt-1.5 px-1">Clear text</button>
        )}
      </div>
    </div>
  );
}

export function DateRangeFilterContent({ dateRange, onChange }: { dateRange: { since: number | null; until: number | null }; onChange: (v: { since: number | null; until: number | null }) => void }) {
  const toLocal = (ts: number | null) => {
    if (ts === null) return "";
    const d = new Date(ts * 1000);
    return d.toISOString().slice(0, 16);
  };
  const fromLocal = (s: string): number | null => {
    if (!s) return null;
    return Math.floor(new Date(s).getTime() / 1000);
  };
  const presets = [
    { label: "Last 1h", since: () => Math.floor(Date.now() / 1000) - 3600, until: () => null as number | null },
    { label: "Last 6h", since: () => Math.floor(Date.now() / 1000) - 21600, until: () => null as number | null },
    { label: "Last 24h", since: () => Math.floor(Date.now() / 1000) - 86400, until: () => null as number | null },
    { label: "Last 7d", since: () => Math.floor(Date.now() / 1000) - 604800, until: () => null as number | null },
  ];
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Filter Date/Time</div>
      <div className="flex flex-wrap gap-1 mb-2">
        {presets.map(p => (
          <button key={p.label} onClick={() => onChange({ since: p.since(), until: p.until() })} className="text-[10px] px-2 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.03] hover:bg-accent dark:hover:bg-brand/20 text-foreground/80 hover:text-brand">
            {p.label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] text-muted-foreground/60">Start:</label>
        <input type="datetime-local" value={toLocal(dateRange.since)} onChange={e => onChange({ ...dateRange, since: fromLocal(e.target.value) })} onClick={e => e.stopPropagation()} className="w-full h-7 px-2 rounded border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02] text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
        <label className="text-[10px] text-muted-foreground/60">End:</label>
        <input type="datetime-local" value={toLocal(dateRange.until)} onChange={e => onChange({ ...dateRange, until: fromLocal(e.target.value) })} onClick={e => e.stopPropagation()} className="w-full h-7 px-2 rounded border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02] text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      {(dateRange.since !== null || dateRange.until !== null) && (
        <button onClick={() => onChange({ since: null, until: null })} className="text-[10px] text-brand hover:text-brand/80 mt-1.5 px-1">Clear filter</button>
      )}
    </div>
  );
}

export const LIVE_DEFAULT_WIDTHS = [130, 55, 85, 150, 80, 60, 130];
export const EVT_DEFAULT_WIDTHS = [130, 55, 85, 150, 80, 60, 130];
export const COL_MIN_WIDTH = 40;

export function useColumnWidths(defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(defaults);
  const startRef = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const onResizeStart = useCallback((col: number, clientX: number) => {
    startRef.current = { col, startX: clientX, startW: widths[col] };
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const delta = e.clientX - startRef.current.startX;
      const newW = Math.max(COL_MIN_WIDTH, startRef.current.startW + delta);
      setWidths(prev => {
        const next = [...prev];
        next[startRef.current!.col] = newW;
        return next;
      });
    };
    const onUp = () => {
      startRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [widths]);

  const resetWidths = useCallback(() => setWidths(defaults), [defaults]);

  return { widths, onResizeStart, resetWidths };
}

export function gridTemplateStyle(widths: number[], hasTrailing?: boolean): React.CSSProperties {
  const cols = widths.map(w => `${w}px`).join(" ");
  return { gridTemplateColumns: hasTrailing ? `${cols} 1fr 50px` : `${cols} 1fr` };
}

export function ColumnResizeHandle({ colIndex, onResizeStart }: { colIndex: number; onResizeStart: (col: number, clientX: number) => void }) {
  return (
    <span
      className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-20 group/resize hover:bg-accent active:bg-accent"
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
        onResizeStart(colIndex, e.clientX);
      }}
    >
      <span className="absolute right-[2px] top-1 bottom-1 w-[1px] bg-transparent group-hover/resize:bg-primary/40 transition-colors" />
    </span>
  );
}

function SortIndicator({ sortKey, sortState, onSort }: { sortKey?: string; sortState?: SortState; onSort?: (key: string) => void }) {
  if (!sortKey || !onSort) return null;
  const isActive = sortState?.key === sortKey;
  const dir = isActive ? sortState.direction : null;
  return (
    <span
      className={`shrink-0 cursor-pointer rounded p-0.5 transition-colors hover:bg-accent ${isActive ? "text-brand" : "text-muted-foreground/30 hover:text-muted-foreground/60"}`}
      onClick={(e) => { e.stopPropagation(); onSort(sortKey); }}
      title={dir === "asc" ? "Sorted ascending" : dir === "desc" ? "Sorted descending" : "Click to sort"}
    >
      {dir === "asc" ? <ArrowUp className="w-2.5 h-2.5" /> : dir === "desc" ? <ArrowDown className="w-2.5 h-2.5" /> : <ArrowUpDown className="w-2.5 h-2.5" />}
    </span>
  );
}

export function ResizableFilterableHeader({ label, active, borderClass, colIndex, onResizeStart, children, sortKey, sortState, onSort }: {
  label: string;
  active: boolean;
  borderClass: string;
  colIndex: number;
  onResizeStart: (col: number, clientX: number) => void;
  children: (onClose: () => void) => React.ReactNode;
  sortKey?: string;
  sortState?: SortState;
  onSort?: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={anchorRef}
      className={`text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 ${borderClass} flex items-center gap-0.5 cursor-pointer hover:text-brand transition-colors select-none relative overflow-visible`}
      onClick={() => setOpen(!open)}
    >
      <span className="truncate">{label}</span>
      <SortIndicator sortKey={sortKey} sortState={sortState} onSort={onSort} />
      <Filter className={`w-2.5 h-2.5 shrink-0 transition-colors ${active ? "text-brand" : "text-muted-foreground/40"}`} />
      {active && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
      <ColumnResizeHandle colIndex={colIndex} onResizeStart={onResizeStart} />
      <FilterPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        {children(() => setOpen(false))}
      </FilterPopover>
    </span>
  );
}

export function FilterableHeader({ label, active, borderClass, children, sortKey, sortState, onSort }: {
  label: string;
  active: boolean;
  borderClass: string;
  children: (onClose: () => void) => React.ReactNode;
  sortKey?: string;
  sortState?: SortState;
  onSort?: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={anchorRef}
      className={`text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 ${borderClass} flex items-center gap-0.5 cursor-pointer hover:text-brand transition-colors select-none`}
      onClick={() => setOpen(!open)}
    >
      {label}
      <SortIndicator sortKey={sortKey} sortState={sortState} onSort={onSort} />
      <Filter className={`w-2.5 h-2.5 shrink-0 transition-colors ${active ? "text-brand" : "text-muted-foreground/40"}`} />
      {active && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
      <FilterPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        {children(() => setOpen(false))}
      </FilterPopover>
    </span>
  );
}

export function useEventStats<T extends { kind: number; pubkey: string; content: string; tags: string[][] }>(
  events: T[],
  profiles: Map<string, ProfileInfo>,
  getSource?: (e: T) => string | undefined,
) {
  return useMemo(() => {
    const kindCounts = new Map<number, number>();
    const authorCounts = new Map<string, number>();
    const engCounts = new Map<string, number>();
    const ctCounts = new Map<ContentType, number>();
    let pub = 0, pvt = 0, both = 0, noEng = 0;
    for (const e of events) {
      kindCounts.set(e.kind, (kindCounts.get(e.kind) || 0) + 1);
      authorCounts.set(e.pubkey, (authorCounts.get(e.pubkey) || 0) + 1);
      const eng = getEngagementTarget(e);
      if (eng) engCounts.set(eng, (engCounts.get(eng) || 0) + 1);
      else noEng++;
      const src = getSource?.(e);
      if (src === "public") pub++;
      else if (src === "private") pvt++;
      else if (src === "both") both++;
      for (const ct of detectContentTypes(e)) {
        ctCounts.set(ct, (ctCounts.get(ct) || 0) + 1);
      }
    }
    return {
      total: events.length,
      topKinds: [...kindCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      topAuthors: [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      topEngagement: [...engCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      pubCount: pub,
      pvtCount: pvt,
      bothCount: both,
      uniqueKinds: [...kindCounts.entries()].sort((a, b) => b[1] - a[1]),
      uniqueAuthors: [...authorCounts.entries()].sort((a, b) => b[1] - a[1]),
      uniqueEngagement: [...engCounts.entries()].sort((a, b) => b[1] - a[1]),
      noEngagementCount: noEng,
      contentTypeCounts: ctCounts,
    };
  }, [events, profiles, getSource]);
}

export function AnalyticsSummary({ stats, profiles }: {
  stats: ReturnType<typeof useEventStats>;
  profiles: Map<string, ProfileInfo>;
}) {
  const [open, setOpen] = useState(false);
  if (stats.total === 0) return null;
  const srcTotal = stats.pubCount + stats.pvtCount + stats.bothCount;
  return (
    <div className="border border-black/[0.06] dark:border-white/[0.04] rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <BarChart3 className="w-3 h-3 text-brand/60 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Analytics</span>
        <Badge variant="outline" className="text-[10px] border-brand/30 dark:border-brand/20 text-brand dark:text-brand/70 ml-1">{stats.total} events</Badge>
        {srcTotal > 0 && (
          <span className="text-[10px] text-muted-foreground/60 ml-auto mr-2">
            {stats.pubCount > 0 && <span className="text-green-700 dark:text-green-400/70">{stats.pubCount} pub</span>}
            {stats.pubCount > 0 && stats.pvtCount > 0 && " / "}
            {stats.pvtCount > 0 && <span className="text-amber-700 dark:text-amber-400/70">{stats.pvtCount} pvt</span>}
            {(stats.pubCount > 0 || stats.pvtCount > 0) && stats.bothCount > 0 && " / "}
            {stats.bothCount > 0 && <span className="text-brand dark:text-brand/70">{stats.bothCount} both</span>}
          </span>
        )}
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground/50 shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/50 shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Top Kinds</div>
            {stats.topKinds.map(([kind, count]) => (
              <div key={kind} className="flex items-center justify-between py-0.5">
                <span className="text-[10px] text-foreground/80">{getKindLabel(kind)}</span>
                <span className="text-[10px] text-muted-foreground/60">{count}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Top Authors</div>
            {stats.topAuthors.map(([pk, count]) => {
              const p = profiles.get(pk);
              return (
                <div key={pk} className="flex items-center gap-1 justify-between py-0.5">
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    {p?.picture ? (
                      <img src={p.picture} alt="" className="w-3 h-3 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-3 h-3 rounded-full bg-primary/15 shrink-0" />
                    )}
                    <span className="text-[10px] text-foreground/80 truncate">{p?.name || pubkeyToNpub(pk).slice(0, 12) + "..."}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Top Engaged</div>
            {stats.topEngagement.length === 0 && <div className="text-[10px] text-muted-foreground/50">No engagement data</div>}
            {stats.topEngagement.map(([pk, count]) => {
              const p = profiles.get(pk);
              return (
                <div key={pk} className="flex items-center gap-1 justify-between py-0.5">
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    {p?.picture ? (
                      <img src={p.picture} alt="" className="w-3 h-3 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-3 h-3 rounded-full bg-primary/15 shrink-0" />
                    )}
                    <span className="text-[10px] text-foreground/80 truncate">{p?.name || pubkeyToNpub(pk).slice(0, 12) + "..."}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SavedViewsManager({ relayUrl, tab, filters, toolbar, onLoad, onClearFilters }: {
  relayUrl: string;
  tab: string;
  filters: ColumnFilters;
  toolbar?: SavedToolbarState;
  onLoad: (f: ColumnFilters, t?: SavedToolbarState) => void;
  onClearFilters: () => void;
}) {
  const [views, setViews] = useState<SavedFilterView[]>(() => getSavedViews(relayUrl, tab));
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showList, setShowList] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViews(getSavedViews(relayUrl, tab));
  }, [relayUrl, tab]);

  useEffect(() => {
    if (!showList) return;
    const handler = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) { setShowList(false); setRenamingId(null); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showList]);

  const handleSave = () => {
    if (!saveName.trim()) return;
    const view: SavedFilterView = { id: Date.now().toString(36), name: saveName.trim(), filters: { ...filters }, toolbar: toolbar ? { ...toolbar } : undefined, createdAt: Date.now() };
    const updated = [...views, view];
    setViews(updated);
    persistSavedViews(relayUrl, tab, updated);
    setSaveName("");
    setShowSave(false);
  };

  const handleDelete = (id: string) => {
    const updated = views.filter(v => v.id !== id);
    setViews(updated);
    persistSavedViews(relayUrl, tab, updated);
  };

  const handleRename = (id: string) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    const updated = views.map(v => v.id === id ? { ...v, name: renameValue.trim() } : v);
    setViews(updated);
    persistSavedViews(relayUrl, tab, updated);
    setRenamingId(null);
  };

  const hasAnyFilter = hasActiveColumnFilters(filters) || hasNonDefaultToolbar(toolbar);

  return (
    <div className="flex items-center gap-1">
      {hasActiveColumnFilters(filters) && (
        <>
          <Badge variant="outline" className="text-[10px] border-brand/30 dark:border-brand/20 text-brand dark:text-brand/70">
            {countActiveColumnFilters(filters)} filter{countActiveColumnFilters(filters) !== 1 ? "s" : ""}
          </Badge>
          <button onClick={onClearFilters} className="text-[10px] text-brand hover:text-brand/80 px-1" title="Clear all filters">
            <X className="w-3 h-3" />
          </button>
        </>
      )}
      {hasAnyFilter && (
        <button
          onClick={() => setShowSave(!showSave)}
          className="text-[10px] text-muted-foreground/70 hover:text-brand flex items-center gap-0.5 px-1"
          title="Save current filter view"
        >
          <Bookmark className="w-3 h-3" />
        </button>
      )}
      {showSave && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            placeholder="View name..."
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            className="h-5 px-1.5 rounded border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.02] text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-24"
          />
          <button onClick={handleSave} className="text-[10px] text-brand hover:text-brand/80">Save</button>
        </div>
      )}
      {views.length > 0 && (
        <div className="relative" ref={listRef}>
          <button
            onClick={() => setShowList(!showList)}
            className="text-[10px] text-muted-foreground/70 hover:text-brand flex items-center gap-0.5 px-1"
            title="Load saved view"
          >
            <Bookmark className="w-3 h-3 fill-current" />
            <span>{views.length}</span>
          </button>
          {showList && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-background/98 backdrop-blur-xl border border-black/[0.12] dark:border-white/[0.1] rounded-lg shadow-2xl p-1.5 min-w-[180px]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-1.5 mb-1">Saved Views</div>
              {views.map(v => (
                <div key={v.id} className="flex items-center gap-1 py-1 px-1.5 rounded hover:bg-black/[0.03] dark:hover:bg-white/[0.03] group">
                  {renamingId === v.id ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleRename(v.id); if (e.key === "Escape") setRenamingId(null); }}
                      onBlur={() => handleRename(v.id)}
                      autoFocus
                      className="h-4 px-1 rounded border border-primary/30 bg-black/[0.03] dark:bg-white/[0.02] text-[10px] text-foreground focus:outline-none w-full"
                    />
                  ) : (
                    <button className="text-[10px] text-foreground/80 hover:text-brand flex-1 text-left truncate" onClick={() => { onLoad(v.filters, v.toolbar); setShowList(false); }}>
                      {v.name}
                    </button>
                  )}
                  <button onClick={() => { setRenamingId(v.id); setRenameValue(v.name); }} className="text-muted-foreground/40 hover:text-brand reveal-on-hover touch-target shrink-0" aria-label="Rename this view" title="Rename">
                    <FileText className="w-2.5 h-2.5" />
                  </button>
                  <button onClick={() => handleDelete(v.id)} className="text-muted-foreground/40 hover:text-red-500 reveal-on-hover touch-target shrink-0" aria-label="Delete this view" title="Delete">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ExportDropdown({ onCSV, onJSON, count }: { onCSV: () => void; onJSON: () => void; count: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={count === 0}
        className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-brand disabled:opacity-30 disabled:hover:text-muted-foreground/70 px-1 h-6"
        title="Export events"
      >
        <FileDown className="w-3 h-3" />
        <span>Export</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-background/98 backdrop-blur-xl border border-black/[0.12] dark:border-white/[0.1] rounded-lg shadow-2xl p-1.5 min-w-[120px]">
          <button className="w-full text-left text-[10px] text-foreground/80 hover:text-brand py-1 px-2 rounded hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" onClick={() => { onCSV(); setOpen(false); }}>
            Export as CSV
          </button>
          <button className="w-full text-left text-[10px] text-foreground/80 hover:text-brand py-1 px-2 rounded hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" onClick={() => { onJSON(); setOpen(false); }}>
            Export as JSON
          </button>
        </div>
      )}
    </div>
  );
}

export function MobileFilterDrawer({ filters, onChange, stats, profiles }: {
  filters: ColumnFilters;
  onChange: (f: ColumnFilters | ((prev: ColumnFilters) => ColumnFilters)) => void;
  stats: ReturnType<typeof useEventStats>;
  profiles: Map<string, ProfileInfo>;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveColumnFilters(filters);
  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg transition-all active:scale-[0.97] ${hasActiveColumnFilters(filters) ? "bg-accent dark:bg-brand/10 text-accent-foreground dark:text-brand border border-brand/20" : "text-muted-foreground/70 border border-black/[0.08] dark:border-white/[0.06] active:bg-black/[0.04] dark:active:bg-white/[0.04]"}`}
      >
        <Filter className="w-3.5 h-3.5" />
        <span className="font-medium">Filters</span>
        {activeCount > 0 && (
          <span className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col" onClick={() => setOpen(false)}>
          <div className="flex-1 bg-black/40 backdrop-blur-[2px]" />
          <div className="bg-background border-t border-black/[0.1] dark:border-white/[0.1] rounded-t-2xl max-h-[75vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-background px-5 pt-4 pb-3 border-b border-black/[0.06] dark:border-white/[0.04]">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/20 mx-auto mb-3" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Filters</span>
                <div className="flex items-center gap-3">
                  {hasActiveColumnFilters(filters) && (
                    <button onClick={() => onChange(EMPTY_COLUMN_FILTERS)} className="text-[11px] font-medium text-red-500/70 active:text-red-500">Clear all</button>
                  )}
                  <button onClick={() => setOpen(false)} className="-my-2 w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center active:bg-muted" aria-label="Close filters">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 space-y-5">
              <DateRangeFilterContent dateRange={filters.dateRange} onChange={v => onChange(f => ({ ...f, dateRange: v }))} />
              <div className="border-t border-black/[0.04] dark:border-white/[0.03] pt-4">
                <CheckboxFilterContent
                  label="Filter by Source"
                  options={[
                    { value: "public", label: "Public", count: stats.pubCount },
                    { value: "private", label: "Private", count: stats.pvtCount },
                    { value: "both", label: "Both", count: stats.bothCount },
                  ]}
                  selected={filters.sources}
                  onChange={v => onChange(f => ({ ...f, sources: v }))}
                  onClear={() => onChange(f => ({ ...f, sources: [] }))}
                />
              </div>
              <div className="border-t border-black/[0.04] dark:border-white/[0.03] pt-4">
                <CheckboxFilterContent
                  label="Filter by Kind"
                  options={stats.uniqueKinds.map(([k, c]) => ({ value: String(k), label: getKindLabel(k), count: c }))}
                  selected={filters.kinds.map(String)}
                  onChange={v => onChange(f => ({ ...f, kinds: v.map(Number) }))}
                  onClear={() => onChange(f => ({ ...f, kinds: [] }))}
                />
              </div>
              <div className="border-t border-black/[0.04] dark:border-white/[0.03] pt-4">
                <ProfileFilterContent
                  label="Filter by Author"
                  options={stats.uniqueAuthors.map(([pk, c]) => ({ pubkey: pk, count: c }))}
                  selected={filters.authors}
                  onChange={v => onChange(f => ({ ...f, authors: v }))}
                  onClear={() => onChange(f => ({ ...f, authors: [] }))}
                  profiles={profiles}
                />
              </div>
              <div className="border-t border-black/[0.04] dark:border-white/[0.03] pt-4">
                <CheckboxFilterContent
                  label="Filter by WoT Tier"
                  options={WOT_TIER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                  selected={filters.wotTiers}
                  onChange={v => onChange(f => ({ ...f, wotTiers: v }))}
                  onClear={() => onChange(f => ({ ...f, wotTiers: [] }))}
                />
              </div>
              <div className="border-t border-black/[0.04] dark:border-white/[0.03] pt-4">
                <CheckboxFilterContent
                  label="Filter by Score Tier"
                  options={SCORE_TIER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                  selected={filters.scoreTiers ?? []}
                  onChange={v => onChange(f => ({ ...f, scoreTiers: v }))}
                  onClear={() => onChange(f => ({ ...f, scoreTiers: [] }))}
                />
              </div>
              <div className="border-t border-black/[0.04] dark:border-white/[0.03] pt-4">
                <ProfileFilterContent
                  label="Filter by Engagement Target"
                  options={stats.uniqueEngagement.map(([pk, c]) => ({ pubkey: pk, count: c }))}
                  selected={filters.engagement}
                  onChange={v => onChange(f => ({ ...f, engagement: v }))}
                  onClear={() => onChange(f => ({ ...f, engagement: [] }))}
                  profiles={profiles}
                  showNoneOption
                  noneCount={stats.noEngagementCount}
                />
              </div>
              <div className="border-t border-black/[0.04] dark:border-white/[0.03] pt-4">
                <ContentFilterContent
                  value={filters.contentSearch}
                  onChange={v => onChange(f => ({ ...f, contentSearch: v }))}
                  contentTypes={filters.contentTypes || []}
                  onContentTypesChange={v => onChange(f => ({ ...f, contentTypes: v }))}
                  typeCounts={stats.contentTypeCounts}
                />
              </div>
            </div>
            <div className="sticky bottom-0 bg-background px-5 py-3 border-t border-black/[0.06] dark:border-white/[0.04] safe-area-bottom">
              <button
                onClick={() => setOpen(false)}
                className="w-full h-10 rounded-lg bg-primary dark:bg-brand text-primary-foreground text-sm font-semibold active:bg-primary/90 dark:active:bg-brand transition-colors"
              >
                Apply Filters{activeCount > 0 ? ` (${activeCount})` : ""}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export function MobileFilterBar({ filters, onChange, profiles, stats }: { filters: ColumnFilters; onChange: (f: ColumnFilters | ((prev: ColumnFilters) => ColumnFilters)) => void; profiles: Map<string, ProfileInfo>; stats: ReturnType<typeof useEventStats> }) {
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.sources.length > 0) chips.push({ key: "src", label: `Source: ${filters.sources.join(", ")}`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, sources: [] }) });
  if (filters.kinds.length > 0) chips.push({ key: "kind", label: `Kind: ${filters.kinds.map(k => getKindLabel(k)).join(", ")}`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, kinds: [] }) });
  if (filters.authors.length > 0) {
    const names = filters.authors.map(pk => {
      const p = profiles.get(pk);
      return p?.name || pk.slice(0, 8) + "...";
    });
    chips.push({ key: "auth", label: `Author: ${names.join(", ")}`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, authors: [] }) });
  }
  if ((filters.wotTiers?.length || 0) > 0) {
    const names = filters.wotTiers.map(t => WOT_TIER_OPTIONS.find(o => o.value === t)?.label || t);
    chips.push({ key: "wot", label: `WoT: ${names.join(", ")}`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, wotTiers: [] }) });
  }
  if ((filters.scoreTiers?.length || 0) > 0) {
    const names = filters.scoreTiers.map(t => SCORE_TIER_OPTIONS.find(o => o.value === t)?.label || t);
    chips.push({ key: "score", label: `Score: ${names.join(", ")}`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, scoreTiers: [] }) });
  }
  if (filters.engagement.length > 0) {
    const names = filters.engagement.map(pk => {
      if (pk === ENGAGEMENT_NONE) return "None";
      const p = profiles.get(pk);
      return p?.name || pk.slice(0, 8) + "...";
    });
    chips.push({ key: "eng", label: `Target: ${names.join(", ")}`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, engagement: [] }) });
  }
  if (filters.contentSearch) chips.push({ key: "content", label: `Content: "${filters.contentSearch}"`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, contentSearch: "" }) });
  if ((filters.contentTypes?.length || 0) > 0) chips.push({ key: "ctype", label: `Type: ${filters.contentTypes.join(", ")}`, onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, contentTypes: [] }) });
  if (filters.dateRange.since !== null || filters.dateRange.until !== null) chips.push({ key: "date", label: "Date range active", onRemove: () => onChange({ ...EMPTY_COLUMN_FILTERS, ...filters, dateRange: { since: null, until: null } }) });
  return (
    <div className="md:hidden space-y-2">
      <MobileFilterDrawer filters={filters} onChange={onChange} stats={stats} profiles={profiles} />
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-1 py-1.5">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 text-[10px] bg-accent dark:bg-brand/10 text-accent-foreground dark:text-brand/80 rounded-full px-2.5 py-1 border border-brand/20 dark:border-brand/15">
              <span className="truncate max-w-[140px]">{c.label}</span>
              <button onClick={(e) => { e.stopPropagation(); c.onRemove(); }} className="ml-0.5 active:text-red-500 -mr-0.5">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button onClick={() => onChange(EMPTY_COLUMN_FILTERS)} className="text-[10px] text-red-500/60 active:text-red-500 px-1.5 py-1">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

export interface LiveEvent {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  created_at: number;
  tags: string[][];
  sig: string;
  relaySource?: RelaySource;
}


export const VALID_TABS: Set<string> = new Set(TABS.map(t => t.id));

export function getTabFromHash(): TabId {
  try {
    const h = window.location.hash.replace("#", "");
    if (h === "badges") return "access";
    if (VALID_TABS.has(h)) return h as TabId;
  } catch {}
  return "overview";
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
          placeholder="Search name, npub, hex, NIP-05"
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
        <option value="nip05">Has NIP-05</option>
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
