import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { eventStore, pool, fetchProfiles, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import { KIND_METADATA, KIND_TEXT_NOTE, getAvatarUrl, getDisplayName, getProfileContent } from "@/lib/nostr-helpers";
import { NostrPost } from "@/components/NostrPost";
import { PollPost } from "@/components/PollPost";
import { isPollEvent } from "@/lib/polls";
import { InlineThreadReplyBar, ReplyThread } from "@/components/nostr-post/thread";
import { ThreadEndBlock } from "@/components/nostr-post/ThreadEndBlock";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getWriteRelays, getReadRelays } from "@/lib/outbox";
import { RelayOutpostLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { use$ } from "applesauce-react/hooks";
import { Link } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Heart, Repeat, Zap, Radio, ArrowLeft, RefreshCw, MessageCircle } from "lucide-react";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { usePrimalStats } from "@/hooks/use-primal-stats";
import { useInteractionCounts } from "@/contexts/InteractionIndexContext";
import { formatEngagementSummary, formatRootMarkerLabel, shouldShowRootMarker } from "@/lib/thread-spine";

interface DecodedNote {
  id: string;
  relays: string[];
}

function decodeNoteId(noteId: string): DecodedNote | null {
  try {
    if (noteId.startsWith("note1")) {
      const decoded = nip19.decode(noteId);
      if (decoded.type === "note") return { id: decoded.data as string, relays: [] };
    } else if (noteId.startsWith("nevent")) {
      const decoded = nip19.decode(noteId);
      if (decoded.type === "nevent") {
        const data = decoded.data as { id: string; relays?: string[] };
        return { id: data.id, relays: data.relays || [] };
      }
    } else {
      return { id: noteId, relays: [] };
    }
  } catch {
    return { id: noteId, relays: [] };
  }
  return null;
}

function InlineReplyPanel({ replyTo }: { replyTo: Event }) {
  const { pubkey } = useNostrAuth();

  if (!pubkey) return null;

  return (
    <div
      className="mt-3 glass-thread rounded-xl overflow-hidden"
      data-testid="inline-thread-reply-panel"
    >
      <InlineThreadReplyBar replyTo={replyTo} variant="full" />
    </div>
  );
}

function getReplyTargetId(event: Event): string | null {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return null;
  const replyTag = eTags.find((t) => t[3] === "reply");
  if (replyTag) return replyTag[1];
  const rootTag = eTags.find((t) => t[3] === "root");
  if (rootTag) {
    const nonRootTags = eTags.filter((t) => t[3] !== "root");
    if (nonRootTags.length > 0) return nonRootTags[nonRootTags.length - 1][1];
    return rootTag[1];
  }
  if (eTags.length === 1) return eTags[0][1];
  return eTags[eTags.length - 1][1];
}

function getRootEventId(event: Event): string | null {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return null;
  const rootTag = eTags.find((t) => t[3] === "root");
  if (rootTag) return rootTag[1];
  return eTags[0][1];
}

const HEX64_RE = /^[0-9a-f]{64}$/;

function buildSearchRelays(hintRelays: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (url: string) => {
    const norm = url.replace(/\/+$/, "").toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(url);
    }
  };
  for (const r of hintRelays) add(r);
  for (const r of DEFAULT_RELAYS.slice(0, 5)) add(r);
  const outposts = getOutpostRelays();
  for (const r of outposts) add(r.url);
  return result;
}

async function fetchEventById(id: string, extraRelays: string[] = []): Promise<Event | null> {
  if (!HEX64_RE.test(id)) return null;
  const existingSet = eventStore.getByFilters({ ids: [id] });
  const existing = existingSet ? [...existingSet][0] : null;
  if (existing) return existing;

  const relays = buildSearchRelays(extraRelays);
  try {
    const events = await pool.querySync(relays, { ids: [id] });
    if (events.length > 0) {
      eventStore.add(events[0]);
      return events[0];
    }
  } catch {}
  return null;
}

async function fetchAncestorChain(event: Event): Promise<Event[]> {
  const chain: Event[] = [];
  let current = event;
  const visited = new Set<string>([event.id]);
  const MAX_DEPTH = 20;

  for (let i = 0; i < MAX_DEPTH; i++) {
    const parentId = getReplyTargetId(current);
    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);

    const parent = await fetchEventById(parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }

  const rootId = getRootEventId(event);
  if (rootId && !visited.has(rootId) && chain.length > 0 && chain[0].id !== rootId) {
    const root = await fetchEventById(rootId);
    if (root) {
      chain.unshift(root);
    }
  }

  return chain;
}


const NOSTR_ENTITY_RE = /nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+)/g;

function MentionName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { fetchProfiles([pubkey], DEFAULT_RELAYS.slice(0, 3)); }, [pubkey]);
  const name = useMemo(() => {
    const content = getProfileContent(profile);
    if (content?.display_name || content?.name) return content.display_name || content.name;
    try { const n = nip19.npubEncode(pubkey); return `${n.slice(0, 9)}...${n.slice(-4)}`; } catch { return pubkey.slice(0, 8) + "..."; }
  }, [profile, pubkey]);
  return <>{name}</>;
}

function NostrEntityText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const result: Array<{ type: "text"; value: string } | { type: "mention"; pubkey: string; npub: string } | { type: "noteref"; id: string; encoded: string }> = [];
    let lastIndex = 0;
    const regex = new RegExp(NOSTR_ENTITY_RE.source, "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) result.push({ type: "text", value: text.slice(lastIndex, match.index) });
      const bech32 = match[1];
      try {
        const decoded = nip19.decode(bech32);
        if (decoded.type === "npub") {
          result.push({ type: "mention", pubkey: decoded.data as string, npub: bech32 });
        } else if (decoded.type === "nprofile") {
          const data = decoded.data as { pubkey: string };
          const npub = nip19.npubEncode(data.pubkey);
          result.push({ type: "mention", pubkey: data.pubkey, npub });
        } else if (decoded.type === "note") {
          result.push({ type: "noteref", id: decoded.data as string, encoded: bech32 });
        } else if (decoded.type === "nevent") {
          const data = decoded.data as { id: string };
          const noteEncoded = nip19.noteEncode(data.id);
          result.push({ type: "noteref", id: data.id, encoded: noteEncoded });
        } else {
          result.push({ type: "text", value: match[0] });
        }
      } catch {
        result.push({ type: "text", value: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) result.push({ type: "text", value: text.slice(lastIndex) });
    return result;
  }, [text]);

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text") return <span key={i}>{part.value}</span>;
        if (part.type === "mention") {
          return (
            <Link
              key={i}
              href={`/profile/${part.npub}`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="text-brand hover:text-brand dark:hover:text-brand-strong no-underline"
              data-testid={`link-mention-${part.pubkey.slice(0, 8)}`}
            >
              @<MentionName pubkey={part.pubkey} />
            </Link>
          );
        }
        if (part.type === "noteref") {
          return (
            <Link
              key={i}
              href={`/thread/${part.encoded}`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="text-brand hover:text-brand dark:hover:text-brand-strong no-underline"
              data-testid={`link-noteref-${part.id.slice(0, 8)}`}
            >
              {part.encoded.slice(0, 10)}...{part.encoded.slice(-4)}
            </Link>
          );
        }
        return null;
      })}
    </>
  );
}

function AncestorPost({ event, isLast, isRoot }: { event: Event; isLast: boolean; isRoot: boolean }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const [, navigate] = useLocation();

  useEffect(() => {
    fetchProfiles([event.pubkey], DEFAULT_RELAYS.slice(0, 3));
  }, [event.pubkey]);

  const npub = useMemo(() => {
    try { return nip19.npubEncode(event.pubkey); } catch { return ""; }
  }, [event.pubkey]);

  const displayName = useMemo(() => {
    return getDisplayName(profile, npub ? `${npub.slice(0, 9)}...${npub.slice(-4)}` : event.pubkey.slice(0, 8) + "...");
  }, [profile, npub, event.pubkey]);

  const avatarUrl = getAvatarUrl(profile);

  const timeAgo = useMemo(() => {
    try { return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true }); } catch { return ""; }
  }, [event.created_at]);

  const previewText = useMemo(() => {
    const cleaned = event.content.replace(/https?:\/\/\S+/g, "").trim();
    return cleaned.length > 400 ? cleaned.slice(0, 400) + "..." : cleaned;
  }, [event.content]);

  const noteId = useMemo(() => {
    try { return nip19.noteEncode(event.id); } catch { return event.id; }
  }, [event.id]);

  const handleClick = useCallback(() => {
    navigate(`/thread/${noteId}`);
  }, [navigate, noteId]);

  // Engagement counts from the SAME source the feed's NostrPost uses
  // (usePrimalStats → EventStats), so an ancestor's tallies and the focused
  // post's action bar never disagree. Likes are max'd with the shared
  // interaction index's live reaction count — mirroring NostrPost — so a
  // reaction we already know about shows before Primal indexes it. Ancestors are
  // few (chain length), so a per-ancestor lookup here is cheap.
  const primalStats = usePrimalStats(event.id);
  const { reactionCount: localReactionCount } = useInteractionCounts(event.id);
  const replyCount = primalStats?.replies ?? 0;
  const engagementSummary = useMemo(
    () =>
      formatEngagementSummary({
        replies: replyCount,
        reposts: primalStats?.reposts ?? 0,
        likes: Math.max(primalStats?.likes ?? 0, localReactionCount),
        zaps: primalStats?.zaps ?? 0,
      }),
    [replyCount, primalStats?.reposts, primalStats?.likes, primalStats?.zaps, localReactionCount],
  );

  return (
    <div className="relative" data-testid={`ancestor-post-${event.id}`}>
      {isRoot && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); navigate(`/thread/${noteId}`); }}
          className="flex items-center gap-1.5 mx-4 mb-1 min-h-[44px] text-xs font-medium text-brand/80 hover:text-brand-strong transition-colors"
          data-testid={`button-root-marker-${event.id}`}
        >
          <MessageCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{formatRootMarkerLabel(replyCount)}</span>
        </button>
      )}
      <div
        className="flex gap-3 px-4 py-3 cursor-pointer hover-elevate rounded-lg transition-colors"
        onClick={handleClick}
        data-testid={`button-ancestor-navigate-${event.id}`}
      >
        <div className="flex flex-col items-center shrink-0">
          <Link href={`/profile/${npub}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <Avatar className="w-9 h-9 ring-1 ring-brand/20 border border-background cursor-pointer">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback className="bg-brand/10 text-brand text-xs font-bold">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Link>
          {!isLast && (
            <div className="w-0.5 flex-1 mt-2 bg-gradient-to-b from-brand/30 to-brand/10 rounded-full min-h-[16px]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/profile/${npub}`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="no-underline"
            >
              <span className="text-sm font-semibold text-foreground/90 cursor-pointer truncate max-w-[200px] block">{displayName}</span>
            </Link>
            <span className="text-xs text-muted-foreground/60">{timeAgo}</span>
          </div>
          {previewText && (
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words mt-1.5 line-clamp-6">
              <NostrEntityText text={previewText} />
            </p>
          )}
          {engagementSummary && (
            <p
              className="text-xs text-muted-foreground/70 mt-2"
              data-testid={`ancestor-engagement-${event.id}`}
            >
              {engagementSummary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const VALID_NOTIF_TYPES = new Set(["reaction", "repost", "zap"]);
const HEX64_NOTIF_RE = /^[0-9a-f]{64}$/;

function NotificationBanner({ ntype, byPubkey, sats, emoji }: { ntype: string; byPubkey: string; sats?: string; emoji?: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, byPubkey), [byPubkey]);

  useEffect(() => {
    fetchProfiles([byPubkey], DEFAULT_RELAYS.slice(0, 3));
  }, [byPubkey]);

  const displayName = useMemo(() => {
    return getDisplayName(profile, (() => {
      try { const npub = nip19.npubEncode(byPubkey); return `${npub.slice(0, 9)}...${npub.slice(-4)}`; } catch { return byPubkey.slice(0, 8) + "..."; }
    })());
  }, [profile, byPubkey]);

  const avatarUrl = getAvatarUrl(profile);

  const npub = useMemo(() => {
    try { return nip19.npubEncode(byPubkey); } catch { return ""; }
  }, [byPubkey]);

  const profileLink = npub ? `/profile/${npub}` : undefined;

  const { icon, label, color, bgColor, borderColor } = useMemo(() => {
    switch (ntype) {
      case "reaction": {
        const isLike = !emoji || emoji === "+" || emoji === "❤️" || emoji === "❤";
        const reactionIcon = isLike
          ? <Heart className="w-4 h-4 fill-current" />
          : <span className="text-base leading-none">{emoji}</span>;
        return {
          icon: reactionIcon,
          label: "reacted to this post",
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-500/10 dark:bg-red-500/8",
          borderColor: "border-red-500/25 dark:border-red-500/15",
        };
      }
      case "repost":
        return {
          icon: <Repeat className="w-4 h-4" />,
          label: "reposted this note",
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-500/10 dark:bg-green-500/8",
          borderColor: "border-green-500/25 dark:border-green-500/15",
        };
      case "zap":
        return {
          icon: <Zap className="w-4 h-4 fill-current" />,
          label: sats ? `zapped ${Number(sats).toLocaleString()} sats` : "zapped this post",
          color: "text-amber-600 dark:text-amber-400",
          bgColor: "bg-amber-500/10 dark:bg-amber-500/8",
          borderColor: "border-amber-500/25 dark:border-amber-500/15",
        };
      default:
        return {
          icon: <Heart className="w-4 h-4" />,
          label: "interacted with this post",
          color: "text-brand",
          bgColor: "bg-brand/10 dark:bg-brand/8",
          borderColor: "border-brand/25 dark:border-brand/15",
        };
    }
  }, [ntype, sats, emoji]);

  const nameEl = profileLink
    ? <Link href={profileLink} className="font-medium text-foreground/90 no-underline hover:underline">{displayName}</Link>
    : <span className="font-medium text-foreground/90">{displayName}</span>;

  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg mb-3 border ${bgColor} ${borderColor} animate-in fade-in slide-in-from-top-2 duration-300`} data-testid="notification-banner">
      {profileLink ? (
        <Link href={profileLink}>
          <Avatar className="w-6 h-6 ring-1 ring-foreground/10 cursor-pointer">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="text-[9px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        </Link>
      ) : (
        <Avatar className="w-6 h-6 ring-1 ring-foreground/10">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
          <AvatarFallback className="text-[9px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
      <span className={`${color}`}>{icon}</span>
      <span className="text-[13px] text-foreground/80">
        {nameEl}
        {" "}{label}
      </span>
    </div>
  );
}

function AncestorChainLoading() {
  return (
    <div className="flex items-center gap-3 px-4 py-3" data-testid="ancestor-loading">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-9 h-9 rounded-full bg-muted/30 animate-pulse" />
        <div className="w-0.5 flex-1 mt-2 bg-brand/15 rounded-full min-h-[16px]" />
      </div>
      <div className="flex-1 space-y-2">
        <div className="h-3 w-24 bg-muted/30 rounded animate-pulse" />
        <div className="h-3 w-48 bg-muted/20 rounded animate-pulse" />
      </div>
    </div>
  );
}

function EventNotFound({
  hexId,
  hintRelays,
  myRelays,
  notifParams,
  onEventFound,
}: {
  hexId: string | null;
  hintRelays: string[];
  myRelays: string[];
  notifParams: { ntype: string; by: string; sats?: string; emoji?: string } | null;
  onEventFound: (evt: Event) => void;
}) {
  const [, navigate] = useLocation();
  const goBack = useGoBack();
  const [retrying, setRetrying] = useState(false);
  const [retryDone, setRetryDone] = useState(false);
  const autoRanRef = useRef(false);

  const outpostRelays = useMemo(() => getOutpostRelays(), []);
  const hasOutposts = outpostRelays.length > 0;

  const handleRetry = useCallback(async () => {
    if (!hexId || retrying) return;
    setRetrying(true);
    setRetryDone(false);

    const allRelays = buildSearchRelays([...hintRelays, ...myRelays]);
    const remainingDefaults = DEFAULT_RELAYS.filter(
      (r) => !allRelays.includes(r),
    );
    const expandedRelays = [...allRelays, ...remainingDefaults];

    try {
      const events = await pool.querySync(expandedRelays, { ids: [hexId] });
      if (events.length > 0) {
        eventStore.add(events[0]);
        onEventFound(events[0]);
        return;
      }
    } catch {}
    setRetrying(false);
    setRetryDone(true);
  }, [hexId, hintRelays, myRelays, retrying, onEventFound]);

  // Arrived here from a notification (e.g. someone reacted to your post) — run
  // the broad relay search once automatically so the user isn't dead-ended.
  useEffect(() => {
    if (autoRanRef.current) return;
    if (!notifParams || !hexId) return;
    autoRanRef.current = true;
    void handleRetry();
  }, [notifParams, hexId, handleRetry]);

  const relaySource = hintRelays.length > 0
    ? hintRelays[0].replace("wss://", "").replace(/\/+$/, "")
    : null;

  return (
    <div className="py-8 px-4" data-testid="text-thread-not-found">
      <div className="max-w-sm mx-auto text-center space-y-5">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-brand/10 dark:bg-brand/8 border border-brand/20 flex items-center justify-center">
          <Radio className="w-7 h-7 text-brand/70" />
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold text-foreground/90">
            {retryDone ? "Still unavailable" : "Event not found"}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {retryDone
              ? "This event couldn't be located on any available relay. It may have been deleted or is on a relay you haven't connected to yet."
              : relaySource
                ? `This event may live on ${relaySource} or another relay not in your current connections.`
                : "This event isn't available from your connected relays. It may be on a community relay you haven't joined yet."}
          </p>
        </div>

        {notifParams && (
          <div className="text-xs text-muted-foreground/70 py-2 px-3 rounded-lg glass-card border">
            From a {notifParams.ntype} notification
            {notifParams.sats ? ` (${Number(notifParams.sats).toLocaleString()} sats)` : ""}
          </div>
        )}

        <div className="space-y-2.5 pt-1">
          {!retryDone && (
            <Button
              onClick={handleRetry}
              disabled={retrying}
              variant="outline"
              className="w-full gap-2 border-brand/20 hover:border-brand/40 hover:bg-brand/5"
            >
              <RefreshCw className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} />
              {retrying ? "Searching relays..." : "Search all relays"}
            </Button>
          )}

          {hasOutposts && (
            <Button
              onClick={() => navigate("/relays")}
              variant="outline"
              className="w-full gap-2 border-brand/20 hover:border-brand/40 hover:bg-brand/5"
            >
              <Radio className="w-4 h-4" />
              Browse your outposts
            </Button>
          )}

          <Button
            onClick={() => goBack("/")}
            variant="ghost"
            className="w-full gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Thread() {
  const [, params] = useRoute("/thread/:noteId");
  const [, navigate] = useLocation();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [ancestors, setAncestors] = useState<Event[]>([]);
  const [ancestorsLoading, setAncestorsLoading] = useState(false);
  const mountedRef = useRef(true);
  const targetRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useDocumentTitle("Thread");

  const noteId = params?.noteId;
  const decoded = useMemo(() => (noteId ? decodeNoteId(noteId) : null), [noteId]);
  const hexId = decoded?.id ?? null;
  const searchString = useSearch();
  const notifParams = useMemo(() => {
    const sp = new URLSearchParams(searchString);
    const ntype = sp.get("ntype");
    const by = sp.get("by");
    if (!ntype || !by || !VALID_NOTIF_TYPES.has(ntype) || !HEX64_NOTIF_RE.test(by)) return null;
    return { ntype, by, sats: sp.get("sats") || undefined, emoji: sp.get("emoji") || undefined };
  }, [searchString]);

  const hintRelays = useMemo(() => {
    const hints: string[] = decoded?.relays || [];
    const sp = new URLSearchParams(searchString);
    const relayHint = sp.get("relay");
    if (relayHint && relayHint.startsWith("wss://")) hints.push(relayHint);
    return hints;
  }, [decoded, searchString]);

  // Your own NIP-65 relays. A reaction/repost/zap notification points at YOUR
  // post, which usually lives on your write relay (incl. a relay you run) — not
  // necessarily the app defaults — so include them when resolving the event.
  const { pubkey: myPubkey } = useNostrAuth();
  const myRelays = useMemo(() => {
    if (!myPubkey) return [] as string[];
    try { return Array.from(new Set([...getWriteRelays(myPubkey), ...getReadRelays(myPubkey)])); }
    catch { return [] as string[]; }
  }, [myPubkey]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hexId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setEvent(null);
    setAncestors([]);
    setAncestorsLoading(false);
    scrolledRef.current = false;

    const existingSet = eventStore.getByFilters({ ids: [hexId] });
    const existing = existingSet ? [...existingSet][0] : null;
    if (existing) {
      setEvent(existing);
      setLoading(false);
      fetchProfiles([existing.pubkey], DEFAULT_RELAYS.slice(0, 3));
      return;
    }

    const searchRelays = buildSearchRelays([...hintRelays, ...myRelays]);
    let closed = false;
    const sub = throttledPoolSubscribe(searchRelays, { ids: [hexId] }, {
      onevent(evt) {
        if (!mountedRef.current || closed) return;
        eventStore.add(evt);
        setEvent(evt);
        setLoading(false);
        fetchProfiles([evt.pubkey], DEFAULT_RELAYS.slice(0, 3));
      },
      oneose() {
        if (mountedRef.current) setLoading(false);
        if (!closed) {
          closed = true;
          sub.close();
        }
      },
    });

    return () => {
      if (!closed) {
        closed = true;
        sub.close();
      }
    };
  }, [hexId, hintRelays, myRelays]);

  useEffect(() => {
    if (!event) return;

    const isReply = getReplyTargetId(event) !== null;
    if (!isReply) {
      setAncestors([]);
      return;
    }

    setAncestorsLoading(true);
    fetchAncestorChain(event).then((chain) => {
      if (!mountedRef.current) return;
      setAncestors(chain);
      setAncestorsLoading(false);

      const pubkeys = chain.map((e) => e.pubkey);
      if (pubkeys.length > 0) {
        fetchProfiles(pubkeys, DEFAULT_RELAYS.slice(0, 3));
      }
    }).catch(() => {
      if (mountedRef.current) setAncestorsLoading(false);
    });
  }, [event]);

  useEffect(() => {
    if (!event || scrolledRef.current) return;
    if (ancestorsLoading) return;

    const timer = setTimeout(() => {
      if (targetRef.current && !scrolledRef.current) {
        scrolledRef.current = true;
        if (ancestors.length > 0) {
          // Instant (not smooth): a smooth scroll animates the SHARED <main>
          // asynchronously and keeps running into the back-press, racing the
          // return scroll restore (both write <main>.scrollTop; the restorer only
          // cancels on wheel/touch/keydown, never a programmatic smooth scroll).
          // Instant completes synchronously on open, so it can't still be
          // animating when the user backs out — closing the thread-specific race.
          targetRef.current.scrollIntoView({ behavior: "auto", block: "center" });
        } else {
          window.scrollTo({ top: 0, behavior: "auto" });
        }
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [event, ancestors, ancestorsLoading]);

  const filteredAncestors = useMemo(() => {
    if (!event) return [];
    return ancestors.filter(a => a.id !== event.id);
  }, [ancestors, event]);
  const hasAncestors = filteredAncestors.length > 0;
  // The "Start of conversation" root marker only makes sense when the focused
  // post sits inside a larger conversation (i.e. it's a reply with ancestors).
  const showRootMarker = shouldShowRootMarker(filteredAncestors.length);

  const inlineReplyBar = useMemo(
    () => (event ? <InlineReplyPanel replyTo={event} /> : null),
    [event],
  );

  return (
    <div
      className="max-w-2xl mx-auto p-4 pb-24 md:pb-20"
      ref={containerRef}
      data-testid="thread-page"
    >
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-brand tracking-wider uppercase" data-testid="text-thread-title">Thread</h1>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <RelayOutpostLoader size="lg" label="Loading thread..." />
        </div>
      )}

      {!loading && event && (
        <>
          {ancestorsLoading && (
            <div className="mb-2">
              <AncestorChainLoading />
            </div>
          )}

          {hasAncestors && (
            <div className="mb-1" data-testid="ancestor-chain">
              {filteredAncestors.map((ancestor, index) => (
                <AncestorPost
                  key={ancestor.id}
                  event={ancestor}
                  isLast={index === filteredAncestors.length - 1}
                  isRoot={index === 0 && showRootMarker}
                />
              ))}
              <div className="flex items-center gap-2 px-4 pb-1">
                <div className="w-9 flex justify-center shrink-0">
                  <div className="w-0.5 h-4 bg-gradient-to-b from-brand/20 to-brand/40 rounded-full" />
                </div>
              </div>
            </div>
          )}

          {notifParams && (
            <NotificationBanner
              ntype={notifParams.ntype}
              byPubkey={notifParams.by}
              sats={notifParams.sats}
              emoji={notifParams.emoji}
            />
          )}

          <div
            ref={targetRef}
            className={`rounded-xl transition-all duration-200 ${
              hasAncestors ? "ring-1 ring-brand/20" : ""
            } ${notifParams ? "ring-1 ring-brand/30 bg-brand/5" : ""}`}
            data-no-navigate
            data-testid="target-post"
          >
            {isPollEvent(event) ? (
              // Polls have their own renderer (question + options + live results
              // + voting). Mirror the focused NostrPost layout: reply composer,
              // then the full reply thread beneath the card.
              <>
                <PollPost key={event.id} event={event} />
                {inlineReplyBar && (
                  <div className="ml-1 sm:ml-3">{inlineReplyBar}</div>
                )}
                <div className="ml-1 sm:ml-3">
                  <ReplyThread
                    rootId={event.id}
                    rootEvent={event}
                    onClose={() => {}}
                    showFloatingCollapse={false}
                    bare
                  />
                </div>
              </>
            ) : (
              <NostrPost
                key={event.id}
                event={event}
                showReplies={true}
                inlineReplyBar={inlineReplyBar}
                focused
              />
            )}
          </div>

          {/* Engagement block filling the space below the conversation: the
              people who spoke here (one-tap follow), more from the author, and
              a share affordance. */}
          <ThreadEndBlock rootEvent={event} ancestors={ancestors} myPubkey={myPubkey} />
        </>
      )}

      {!loading && !event && (
        <EventNotFound
          hexId={hexId}
          hintRelays={hintRelays}
          myRelays={myRelays}
          notifParams={notifParams}
          onEventFound={(evt) => {
            setEvent(evt);
            fetchProfiles([evt.pubkey], DEFAULT_RELAYS.slice(0, 3));
          }}
        />
      )}

    </div>
  );
}
