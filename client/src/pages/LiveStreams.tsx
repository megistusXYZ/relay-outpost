import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { MissionBriefing, LIVE_STREAMS_BRIEFING } from "@/components/MissionBriefing";
import { use$ } from "applesauce-react/hooks";
import { pool, eventStore, fetchProfilesCached, publishEvent, throttledPoolSubscribe } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import {
  clientTags, KIND_LIVE_EVENT, KIND_LIVE_CHAT, KIND_METADATA, LIVE_STREAM_RELAYS,
  getDisplayName, getRealName, getAvatarUrl, getProfileContent, formatNpub, shortenNpub
} from "@/lib/nostr-helpers";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { createShareMention } from "@/lib/share-mention";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { ZapDialog } from "@/components/ZapDialog";
import { BtcZapIcon } from "@/components/NostrPost";
import { Link, useParams, useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { formatDistanceToNow, format, isToday, isTomorrow, isThisWeek } from "date-fns";
import {
  Radio, Users, ArrowLeft, Send, Zap, Eye, Clock, Calendar,
  Satellite, Signal, Volume2, ExternalLink, RefreshCw, Copy, Check, Share2,
  Maximize2, PictureInPicture2, ChevronDown, History,
} from "lucide-react";
import { usePiP, supportsNativeHls } from "@/contexts/PiPContext";
import { useLiveMiniPlayer } from "@/contexts/LiveMiniPlayerContext";
import Hls from "hls.js";
import nostrOstrichGif from "@assets/219719339-5eff628c-3470-4cc3-81eb-404f8902de9f_1771392554698.gif";
import { parseLiveEvent, needsProxy, proxyUrl, getStreamHost, pickStreamSource, hasReplay } from "@/lib/live-events";
import type { LiveEventData } from "@/lib/live-events";
import { classifyUrl, resolveEmbedId, isEmbedType } from "@/lib/media-utils";
import { InlineEmbedPlayer } from "@/components/InlineEmbedPlayer";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { useBatchStreamLiveness, type StreamLiveness } from "@/hooks/use-stream-liveness";

function buildATag(event: Event): string | null {
  const dTag = event.tags.find(t => t[0] === "d")?.[1];
  if (!dTag) return null;
  return `${KIND_LIVE_EVENT}:${event.pubkey}:${dTag}`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "live") {
    return (
      <Badge data-testid="badge-status-live" className="bg-red-600/90 text-white border-red-500/50 gap-1 animate-pulse">
        <Signal className="w-3 h-3" />
        LIVE
      </Badge>
    );
  }
  if (status === "planned") {
    return (
      <Badge data-testid="badge-status-planned" className="bg-amber-600/80 text-white border-amber-500/50 gap-1">
        <Clock className="w-3 h-3" />
        Planned
      </Badge>
    );
  }
  return (
    <Badge data-testid="badge-status-ended" className="bg-brand/60 dark:bg-zinc-700/80 text-brand/60 dark:text-zinc-300 border-brand/40 dark:border-zinc-600/50 gap-1">
      Ended
    </Badge>
  );
}

function StreamCard({ stream, onClick, liveness }: { stream: LiveEventData; onClick: () => void; liveness?: StreamLiveness }) {
  // Credit the HOST (the human streamer) — not stream.pubkey, which is the
  // publishing platform account that authored the kind-30311 event.
  const hostPubkey = useMemo(() => getStreamHost(stream), [stream]);
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, hostPubkey), [hostPubkey]);
  const profileContent = profile ? getProfileContent(profile) : null;
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(hostPubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;
  const [imgError, setImgError] = useState(false);
  const proxiedImage = stream.image && needsProxy(stream.image) ? proxyUrl(stream.image) : stream.image;
  let hostNpub: string;
  try { hostNpub = nip19.npubEncode(hostPubkey); } catch { hostNpub = hostPubkey; }

  return (
    <button
      onClick={onClick}
      data-testid={`card-stream-${stream.id}`}
      className="group relative overflow-hidden rounded-xl border border-border dark:border-white/[0.06] bg-card dark:bg-gradient-to-br dark:from-[#0c0c14] dark:to-[#080810] backdrop-blur-sm dark:backdrop-blur-none hover:border-brand/30 dark:hover:border-brand/20 hover:shadow-[0_4px_20px_rgba(76,29,149,0.08)] dark:hover:shadow-[0_0_20px_rgba(139,92,246,0.08)] transition-all duration-300 text-left w-full"
    >
      <div className="relative aspect-video overflow-hidden rounded-t-xl bg-brand/50 dark:bg-black/50">
        {proxiedImage && !imgError ? (
          <img
            src={proxiedImage}
            alt={stream.title}
            className="w-full h-full object-cover opacity-90 dark:opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand/60 via-brand/40 to-brand/30 dark:from-[#0e0a1a] dark:via-[#0c0818] dark:to-[#080610] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.08)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.15)_0%,transparent_70%)]" />
            <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(1px 1px at 20px 30px, white, transparent), radial-gradient(1px 1px at 40px 70px, white, transparent), radial-gradient(1px 1px at 80px 20px, white, transparent), radial-gradient(1px 1px at 90px 80px, white, transparent), radial-gradient(1px 1px at 150px 50px, white, transparent), radial-gradient(1px 1px at 170px 90px, white, transparent)' }} />
            <div className="relative z-10 flex flex-col items-center gap-2.5">
              <div className="relative">
                <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-brand/30 to-brand/20 dark:from-brand/40 dark:to-brand/30 blur-sm group-hover:from-brand/40 group-hover:to-brand/30 dark:group-hover:from-brand/50 dark:group-hover:to-brand/40 transition-all duration-500" />
                <Avatar className="w-16 h-16 relative border-2 border-brand/40 dark:border-brand/30 shadow-lg shadow-brand/10 dark:shadow-brand/20 group-hover:border-brand/60 dark:group-hover:border-brand/50 transition-all duration-500">
                  <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" />
                  <AvatarFallback className="text-lg font-bold bg-gradient-to-br from-brand/80 to-brand/60 text-brand">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
                </Avatar>
              </div>
              <span className="text-sm font-semibold text-brand/70 dark:text-brand/80 tracking-wide group-hover:text-brand-strong transition-colors duration-300 px-3 text-center leading-snug">{displayName}</span>
            </div>
          </div>
        )}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          {liveness === "offline" ? (
            <Badge className="bg-zinc-700/80 text-zinc-300 border-zinc-600/50 gap-1">
              <Signal className="w-3 h-3" />
              Signal Lost
            </Badge>
          ) : (
            <StatusBadge status={stream.status} />
          )}
          {liveness === "verified-live" && stream.status === "live" && (
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" title="Verified live" />
          )}
        </div>
        {stream.currentParticipants != null && (
          <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white/80 text-xs backdrop-blur-sm">
            <Eye className="w-3 h-3" />
            {stream.currentParticipants}
          </div>
        )}
        {stream.status === "live" && liveness !== "offline" && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        )}
        {liveness === "offline" && (
          <div className="absolute inset-0 bg-black/40" />
        )}
      </div>
      <div className="p-3 space-y-2">
        <h3 className="font-semibold text-sm text-foreground dark:text-white/90 line-clamp-2 group-hover:text-brand dark:group-hover:text-brand/90 transition-colors">
          {stream.title}
        </h3>
        <Link
          href={`/profile/${hostNpub}`}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className="flex items-center gap-2 group/host rounded-md -mx-1 px-1 py-0.5 hover:bg-accent dark:hover:bg-brand/10 transition-colors"
        >
          <Avatar className="w-6 h-6 border border-brand/30 dark:border-brand/20 ring-1 ring-brand/20 dark:ring-brand/10">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-[9px] font-medium bg-brand/60 dark:bg-brand/50 text-brand">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] text-muted-foreground dark:text-white/30 uppercase tracking-wider font-medium leading-none">Hosted by</span>
            <p className="text-xs font-medium text-foreground dark:text-white/70 truncate group-hover/host:text-brand transition-colors leading-tight">{displayName}</p>
          </div>
        </Link>
        {stream.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stream.hashtags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand/70">
                #{tag}
              </span>
            ))}
          </div>
        )}
        {stream.participants.filter(p => p.pubkey !== hostPubkey).length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
            {stream.participants
              .filter(p => p.pubkey !== hostPubkey)
              .slice(0, 5)
              .map(p => (
                <ParticipantBadge key={p.pubkey} pubkey={p.pubkey} role={p.role} />
              ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground dark:text-white/30">
          {stream.starts ? (
            <>
              {stream.status === "planned" ? "Starts " : "Started "}
              {formatDistanceToNow(new Date(stream.starts * 1000), { addSuffix: true })}
            </>
          ) : (
            <>
              {"Posted "}
              {formatDistanceToNow(new Date(stream.event.created_at * 1000), { addSuffix: true })}
            </>
          )}
        </p>
      </div>
    </button>
  );
}

function formatDuration(starts?: number, ends?: number): string | null {
  if (!starts || !ends || ends <= starts) return null;
  const diff = ends - starts;
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getDateGroup(ts: number): string {
  const date = new Date(ts * 1000);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isThisWeek(date, { weekStartsOn: 1 })) return format(date, "EEEE");
  return format(date, "MMM d, yyyy");
}

function PastBroadcastRow({ stream, onClick }: { stream: LiveEventData; onClick: () => void }) {
  const hostPubkey = useMemo(() => getStreamHost(stream), [stream]);
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, hostPubkey), [hostPubkey]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(hostPubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;
  const duration = formatDuration(stream.starts, stream.ends);
  const airedTs = stream.starts || stream.event.created_at;
  const airedDate = new Date(airedTs * 1000);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-md bg-card dark:bg-muted/20 border border-border dark:border-brand/15 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_rgba(168,85,247,0.06),0_0_8px_rgba(168,85,247,0.04)] dark:shadow-[0_0_8px_rgba(168,85,247,0.08),0_0_2px_rgba(168,85,247,0.15)] hover-elevate hover:border-brand/30 transition-all text-left group"
    >
      <div className="w-14 shrink-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold text-foreground/80 leading-none">{format(airedDate, "d")}</span>
        <span className="text-[10px] uppercase text-muted-foreground/50 font-medium">{format(airedDate, "MMM")}</span>
        <span className="text-[10px] text-muted-foreground/40 mt-0.5">{format(airedDate, "h:mm a")}</span>
      </div>
      <div className="w-px h-10 bg-border dark:bg-brand/15 shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <h4 className="text-sm font-medium text-foreground/90 line-clamp-1 group-hover:text-brand transition-colors">
          {stream.title}
        </h4>
        <div className="flex items-center gap-2 flex-wrap">
          <Avatar className="w-5 h-5 border border-border/30">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-[8px] bg-muted/30">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground/60">{displayName}</span>
          <span className="text-muted-foreground/20">·</span>
          <span className="text-xs text-muted-foreground/40">
            {formatDistanceToNow(airedDate, { addSuffix: true })}
          </span>
          {duration && (
            <>
              <span className="text-muted-foreground/20">·</span>
              <span className="text-xs text-muted-foreground/40 flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {duration}
              </span>
            </>
          )}
        </div>
        {stream.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {stream.hashtags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand/60 dark:text-brand/50">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function CollapsibleDateGroup({
  label, count, icon, labelColor, defaultOpen, children,
}: {
  label: string; count: number; icon: React.ReactNode; labelColor?: string; defaultOpen: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 px-1 w-full text-left group/hdr"
      >
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 transition-transform ${open ? "" : "-rotate-90"}`} />
        {icon}
        <h3 className={`text-[11px] font-medium uppercase tracking-wider ${labelColor || "text-muted-foreground/40"}`}>{label}</h3>
        <span className="text-[10px] text-muted-foreground/25">{count}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {children}
        </div>
      )}
    </div>
  );
}

function PastBroadcastList({ streams, onSelect }: { streams: LiveEventData[]; onSelect: (s: LiveEventData) => void }) {
  const grouped = useMemo(() => {
    const sorted = [...streams].sort((a, b) => (b.starts || b.event.created_at) - (a.starts || a.event.created_at));
    const groups: { label: string; items: LiveEventData[] }[] = [];
    const seen = new Map<string, LiveEventData[]>();
    for (const s of sorted) {
      const ts = s.starts || s.event.created_at;
      const date = new Date(ts * 1000);
      let label: string;
      if (isToday(date)) label = "Today";
      else if (isThisWeek(date, { weekStartsOn: 1 })) label = "This week";
      else label = format(date, "MMMM yyyy");
      if (!seen.has(label)) {
        const items: LiveEventData[] = [];
        seen.set(label, items);
        groups.push({ label, items });
      }
      seen.get(label)!.push(s);
    }
    return groups;
  }, [streams]);

  return (
    <div className="space-y-4">
      {grouped.map((group, i) => (
        <CollapsibleDateGroup
          key={group.label}
          label={group.label}
          count={group.items.length}
          icon={<History className="w-3.5 h-3.5 text-muted-foreground/30" />}
          defaultOpen={group.label === "Today" || i === 0}
        >
          {group.items.map(stream => (
            <PastBroadcastRow key={`${stream.pubkey}:${stream.dTag}`} stream={stream} onClick={() => onSelect(stream)} />
          ))}
        </CollapsibleDateGroup>
      ))}
    </div>
  );
}

function UpcomingScheduleRow({ stream, onClick }: { stream: LiveEventData; onClick: () => void }) {
  const hostPubkey = useMemo(() => getStreamHost(stream), [stream]);
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, hostPubkey), [hostPubkey]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(hostPubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;
  const scheduledTs = stream.starts || stream.event.created_at;
  const scheduledDate = new Date(scheduledTs * 1000);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-md bg-white/70 dark:bg-muted/20 border border-amber-300/25 dark:border-amber-500/15 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_rgba(245,158,11,0.06),0_0_8px_rgba(245,158,11,0.04)] dark:shadow-[0_0_8px_rgba(245,158,11,0.08),0_0_2px_rgba(245,158,11,0.15)] hover-elevate hover:border-amber-500/30 transition-all text-left group"
    >
      <div className="w-14 shrink-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold text-foreground/80 leading-none">{format(scheduledDate, "d")}</span>
        <span className="text-[10px] uppercase text-muted-foreground/50 font-medium">{format(scheduledDate, "MMM")}</span>
        <span className="text-[10px] text-amber-600/70 dark:text-amber-400/70 mt-0.5">{format(scheduledDate, "h:mm a")}</span>
      </div>
      <div className="w-px h-10 bg-amber-300/20 dark:bg-amber-500/15 shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <h4 className="text-sm font-medium text-foreground/90 line-clamp-1 group-hover:text-amber-700 dark:group-hover:text-amber-300 transition-colors">
          {stream.title}
        </h4>
        <div className="flex items-center gap-2">
          <Avatar className="w-5 h-5 border border-border/30">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-[8px] bg-muted/30">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground/60">{displayName}</span>
          <span className="text-muted-foreground/20">·</span>
          <span className="text-xs text-amber-600/60 dark:text-amber-400/50 flex items-center gap-0.5">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(scheduledDate, { addSuffix: true })}
          </span>
        </div>
        {stream.summary && (
          <p className="text-[11px] text-muted-foreground/40 line-clamp-1">{stream.summary}</p>
        )}
      </div>
    </button>
  );
}

function UpcomingScheduleList({ streams, onSelect }: { streams: LiveEventData[]; onSelect: (s: LiveEventData) => void }) {
  const grouped = useMemo(() => {
    const sorted = [...streams].sort((a, b) => (a.starts || a.event.created_at) - (b.starts || b.event.created_at));
    const groups: { label: string; items: LiveEventData[] }[] = [];
    const seen = new Map<string, LiveEventData[]>();
    for (const s of sorted) {
      const ts = s.starts || s.event.created_at;
      const label = getDateGroup(ts);
      if (!seen.has(label)) {
        const items: LiveEventData[] = [];
        seen.set(label, items);
        groups.push({ label, items });
      }
      seen.get(label)!.push(s);
    }
    return groups;
  }, [streams]);

  return (
    <div className="space-y-4">
      {grouped.map((group, i) => (
        <CollapsibleDateGroup
          key={group.label}
          label={group.label}
          count={group.items.length}
          icon={<Calendar className="w-3.5 h-3.5 text-amber-500/50" />}
          labelColor="text-amber-600/60 dark:text-amber-400/50"
          defaultOpen={group.label === "Today" || group.label === "Tomorrow" || i === 0}
        >
          {group.items.map(stream => (
            <UpcomingScheduleRow key={`${stream.pubkey}:${stream.dTag}`} stream={stream} onClick={() => onSelect(stream)} />
          ))}
        </CollapsibleDateGroup>
      ))}
    </div>
  );
}

const KIND_TEXT_NOTE = 1;

function ShareStreamDialog({ stream, open, onOpenChange }: { stream: LiveEventData; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pubkey: myPubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);

  // Credit/tag the HOST (the human streamer) — not stream.pubkey, which is the
  // publishing platform account that authored the kind-30311 event.
  const hostPubkey = useMemo(() => getStreamHost(stream), [stream]);
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, hostPubkey), [hostPubkey]);
  const fallbackName = shortenNpub(formatNpub(hostPubkey));
  const streamerName = (profile ? getDisplayName(profile, fallbackName) : null) ?? fallbackName;
  // Real name on purpose: the mention text is prefilled into a PUBLISHED post.
  const streamerRealName = (profile ? getRealName(profile, fallbackName) : null) ?? fallbackName;
  // Show the streamer's profile name in the editable prefill (raw npubs are
  // user-hostile); the mention is swapped back to a nostr:npub token at
  // publish time so other clients render a tappable @mention.
  const streamerMention = useMemo(() => createShareMention(hostPubkey, streamerRealName), [hostPubkey, streamerName]);
  const statusLabel = stream.status === "live" ? "[LIVE]" : stream.status === "planned" ? "[UPCOMING]" : "[PAST BROADCAST]";
  const defaultContent = `${statusLabel} ${stream.title}\n\nStreamer: ${streamerMention ? streamerMention.display : streamerName}${stream.streamUrl ? `\n\n${stream.streamUrl}` : ""}${stream.hashtags.length > 0 ? `\n\n${stream.hashtags.slice(0, 5).map(t => `#${t}`).join(" ")}` : ""}`;
  const [content, setContent] = useState(defaultContent);
  const userEditedRef = useRef(false);

  useEffect(() => {
    if (open) {
      userEditedRef.current = false;
      setContent(defaultContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Refresh the prefill if the streamer's profile finishes loading after the
  // dialog opened, but never clobber text the user has already edited.
  useEffect(() => {
    if (!userEditedRef.current) setContent(defaultContent);
  }, [defaultContent]);

  const handleShare = async () => {
    if (!signer || !myPubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    if (!content.trim()) return;

    setIsPublishing(true);
    try {
      // Primary credit + notification goes to the HOST (the streamer). If the
      // stream was published by a distinct platform account, attribute it as a
      // secondary p-tag only — never as the labeled "Streamer".
      const tags: string[][] = [
        ["p", hostPubkey],
      ];
      if (stream.pubkey !== hostPubkey) {
        tags.push(["p", stream.pubkey]);
      }
      if (stream.streamUrl) {
        tags.push(["r", stream.streamUrl]);
      }
      stream.hashtags.slice(0, 5).forEach(t => tags.push(["t", t]));

      tags.push(...clientTags());
      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: (streamerMention ? streamerMention.resolve(content) : content).trim(),
      };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, undefined, isUserSelected);
      toast({ title: "Shared!", description: "Your post about this stream has been published." });
      onOpenChange(false);
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to share stream:", err);
        toast({ title: "Failed to share", description: "Something went wrong.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md glass-dialog-card border-border overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Share Stream
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-primary/10 border border-border p-3 overflow-hidden">
            <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-1.5">Sharing</p>
            <p className="text-sm font-medium text-foreground dark:text-white/80 line-clamp-2">{stream.title}</p>
            {streamerName && (
              <p className="text-xs text-muted-foreground dark:text-white/40 mt-1">by {streamerName}</p>
            )}
          </div>

          <Textarea
            value={content}
            onChange={(e) => { userEditedRef.current = true; setContent(e.target.value); }}
            rows={6}
            className="text-sm bg-muted dark:bg-white/[0.04] border-border dark:border-white/[0.06] text-foreground dark:text-white/80 resize-none rounded-lg"
            style={{ fontSize: 16, wordBreak: "break-word", overflowWrap: "break-word" }}
            placeholder="Add your thoughts..."
            autoComplete="off"
            data-testid="textarea-share-stream"
          />

          <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider leading-relaxed">
            This creates a public post tagging the streamer. Others can reply and zap your post.
          </p>

          <div className="flex gap-2.5 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 font-brand uppercase tracking-widest text-xs border-border dark:border-white/10 text-muted-foreground"
              data-testid="button-cancel-share-stream"
            >
              Cancel
            </Button>
            <Button
              onClick={handleShare}
              disabled={isPublishing || !content.trim()}
              className="flex-1 bg-primary text-primary-foreground font-brand uppercase tracking-widest text-xs border-0"
              data-testid="button-confirm-share-stream"
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-2" />
              )}
              {isPublishing ? "Posting..." : "Share"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function renderChatContent(text: string) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      urlRegex.lastIndex = 0;
      const display = part.length > 40 ? part.slice(0, 37) + "..." : part;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand/80 dark:text-brand/70 hover:text-brand underline underline-offset-2 decoration-brand/30 dark:decoration-brand/20"
          data-testid={`link-chat-url-${i}`}
        >
          {display}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function ChatMessage({ msg, aTag }: { msg: Event; aTag: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, msg.pubkey), [msg.pubkey]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(msg.pubkey));
  let npub: string;
  try { npub = nip19.npubEncode(msg.pubkey); } catch { npub = msg.pubkey; }

  const truncated = msg.content.length > 200 ? msg.content.slice(0, 200) + "..." : msg.content;
  const cleaned = truncated.replace(/nostr:npub1\w+/g, "@user").replace(/\n+/g, " ");

  return (
    <div data-testid={`chat-msg-${msg.id}`} className="px-2.5 py-[3px] hover:bg-accent dark:hover:bg-white/[0.02] group leading-[1.35] break-words overflow-hidden">
      <Link href={`/profile/${npub}`} className="inline">
        <span className="text-[11px] font-semibold text-brand/80 hover:text-brand dark:hover:text-brand/90 cursor-pointer mr-1">{displayName}</span>
      </Link>
      <span className="text-[11px] text-foreground dark:text-white/60 break-all [overflow-wrap:anywhere]">{renderChatContent(cleaned)}</span>
      <span className="text-[9px] text-muted-foreground dark:text-white/15 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        {formatDistanceToNow(new Date(msg.created_at * 1000), { addSuffix: true })}
      </span>
    </div>
  );
}

function StreamPlayerLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand/80 to-brand/60 dark:from-[#0a0a14] dark:to-[#080810] z-10 transition-opacity duration-500">
      <div className="text-center space-y-3">
        <RelayOutpostLoader size="lg" className="text-brand/70 dark:text-brand/60" label="Tuning in..." />
      </div>
    </div>
  );
}

function StreamPlayer({ url, title, hlsUrl, isZapStream, zapStreamNaddr, mini, image, status, expandNaddr }: { url: string; title: string; hlsUrl?: string; isZapStream?: boolean; zapStreamNaddr?: string; mini?: boolean; image?: string; status?: string; expandNaddr?: string }) {
  const [videoLoading, setVideoLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const manifestLoadedRef = useRef(false);
  const retriedRef = useRef(false);
  const isMobile = typeof window !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const { enterPiP, pipSupported, notifyUnmount, isPiP, pipVideoSrc } = usePiP();

  const isUrlHls = url.endsWith(".m3u8") || url.includes("m3u8");
  // Platform embeds go through the shared media pipeline (classifyUrl →
  // resolveEmbedId → InlineEmbedPlayer): the old hand-rolled check ironed raw
  // /watch URLs into an iframe — which YouTube refuses to frame — and never
  // knew Rumble existed, so a Rumble recording hung on "Tuning in…" forever.
  const embedType = useMemo(() => classifyUrl(url), [url]);
  const embedId = useMemo(() => (isEmbedType(embedType) ? resolveEmbedId(url, embedType) : null), [url, embedType]);
  const isIframeEmbed = !!embedId;

  const effectiveHlsUrl = useMemo(() => {
    const raw = isUrlHls ? url : hlsUrl || null;
    if (!raw) return null;
    if (needsProxy(raw)) return proxyUrl(raw);
    return raw;
  }, [url, hlsUrl, isUrlHls]);

  const directVideoUrl = effectiveHlsUrl;
  // hls.js only ever gets a real manifest — the parser routes .mp4/.webm
  // recordings into hlsUrl too, and feeding those to hls.js is a guaranteed
  // fatal ("not a playlist"). Direct files take the plain <video> paths.
  const rawIsManifest = useMemo(() => {
    const raw = isUrlHls ? url : hlsUrl || "";
    return /m3u8/i.test(raw);
  }, [url, hlsUrl, isUrlHls]);
  const useHlsJs = !!directVideoUrl && rawIsManifest && !isMobile && !isIframeEmbed && Hls.isSupported();

  const externalUrl = useMemo(() => {
    if (zapStreamNaddr) return `https://zap.stream/${zapStreamNaddr}`;
    if (isZapStream) return "https://zap.stream";
    return url;
  }, [url, isZapStream, zapStreamNaddr]);

  useEffect(() => {
    setVideoLoading(true);
    setError(null);
    manifestLoadedRef.current = false;
    retriedRef.current = false;
  }, [url, hlsUrl]);

  useEffect(() => {
    if (!useHlsJs) return;
    const video = videoRef.current;
    if (!video || !directVideoUrl) return;

    const onError = () => {
      if (!manifestLoadedRef.current) {
        setError("Stream unavailable — it may have ended");
        setVideoLoading(false);
      }
    };
    video.addEventListener("error", onError);

    const loadingTimeout = setTimeout(() => {
      if (!manifestLoadedRef.current) {
        setError("Stream took too long to load");
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        video.pause();
        video.removeAttribute("src");
        video.load();
        setVideoLoading(false);
      }
    }, 15000);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(directVideoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        manifestLoadedRef.current = true;
        clearTimeout(loadingTimeout);
        setVideoLoading(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (!retriedRef.current && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            retriedRef.current = true;
            hls.startLoad();
            return;
          }
          hls.destroy();
          hlsRef.current = null;
          video.pause();
          video.removeAttribute("src");
          video.load();
          clearTimeout(loadingTimeout);
          setVideoLoading(false);
          setError("Stream unavailable — it may have ended");
        }
      });
    }

    return () => {
      clearTimeout(loadingTimeout);
      video.removeEventListener("error", onError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const pipActive = document.pictureInPictureElement || (video as any).webkitPresentationMode === "picture-in-picture";
      if (!pipActive) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [useHlsJs, directVideoUrl]);

  useEffect(() => {
    if (useHlsJs) return;
    const video = videoRef.current;
    if (!video) return;
    return () => {
      try {
        const inPiP = document.pictureInPictureElement || (video as any).webkitPresentationMode === "picture-in-picture";
        if (!inPiP) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
      } catch {}
    };
  }, [url, hlsUrl, useHlsJs]);


  const pipSrcForStream = directVideoUrl || url;
  const pipIsHls = !!(directVideoUrl && (directVideoUrl.includes(".m3u8") || directVideoUrl.includes("m3u8"))) || isUrlHls;

  // "Pop Out" → hand the stream to the global in-app floating mini-player (X
  // style) instead of the flaky OS PiP. Works on desktop, mobile, and PWA. The
  // inline player pauses so there's no double audio.
  const { openMini } = useLiveMiniPlayer();
  const handlePopOut = useCallback(() => {
    const video = videoRef.current;
    openMini({
      src: pipSrcForStream,
      isHls: pipIsHls,
      title,
      naddr: expandNaddr,
      startTime: video?.currentTime ?? 0,
      muted: video?.muted ?? true,
    });
    video?.pause();
  }, [openMini, pipSrcForStream, pipIsHls, title, expandNaddr]);

  useEffect(() => {
    const streamUrl = pipSrcForStream;
    return () => { notifyUnmount(streamUrl); };
  }, [pipSrcForStream, notifyUnmount]);

  if (!url && !hlsUrl) {
    const isPlanned = status === "planned";
    return (
      <div className="relative aspect-video bg-brand/10 dark:bg-black/80 rounded-lg flex items-center justify-center border border-brand/20 dark:border-transparent overflow-hidden">
        {image ? (
          <>
            <img src={image} alt={title} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
            <div className="relative text-center space-y-2 z-10">
              {isPlanned ? (
                <>
                  <Calendar className="w-10 h-10 mx-auto text-white/70" />
                  <p className="text-sm font-medium text-white/80">Upcoming Stream</p>
                  <p className="text-xs text-white/50">This stream hasn't started yet</p>
                </>
              ) : (
                <>
                  <Satellite className="w-10 h-10 mx-auto text-white/50" />
                  <p className="text-sm text-white/60">Stream offline</p>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="text-center space-y-2 text-brand/30 dark:text-white/30">
            {isPlanned ? (
              <>
                <Calendar className="w-16 h-16 mx-auto opacity-30" />
                <p className="text-sm">Upcoming Stream</p>
                <p className="text-xs opacity-60">This stream hasn't started yet</p>
              </>
            ) : (
              <>
                <Satellite className="w-16 h-16 mx-auto opacity-30" />
                <p className="text-sm">No stream URL available</p>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="aspect-video bg-brand/10 dark:bg-black/80 rounded-lg flex items-center justify-center border border-brand/20 dark:border-transparent">
        <div className="text-center space-y-3 text-brand/50 dark:text-white/40 px-6">
          <Satellite className="w-12 h-12 mx-auto opacity-40" />
          <p className="text-sm">{error}</p>
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium border border-brand/30 text-brand hover:bg-brand/10 transition-colors"
            data-testid="link-stream-external"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Watch on {isZapStream ? "zap.stream" : "source"}
          </a>
        </div>
      </div>
    );
  }

  if ((isMobile || (directVideoUrl && !Hls.isSupported() && supportsNativeHls)) && directVideoUrl && !isIframeEmbed) {
    return (
      <div className={`space-y-0 ${mini ? "h-full" : ""}`}>
        <div className={`relative ${mini ? "h-full" : "aspect-video"} bg-brand/5 dark:bg-black ${mini ? "rounded-none" : "rounded-t-lg sm:rounded-lg"} overflow-hidden border border-brand/20 dark:border-transparent group/stream`}>
          {videoLoading && <StreamPlayerLoader />}
          <video
            ref={videoRef}
            src={directVideoUrl}
            controls
            autoPlay
            muted
            playsInline
            webkit-playsinline=""
            className="w-full h-full outline-none focus:outline-none"
            onCanPlay={() => setVideoLoading(false)}
            onPlaying={() => setVideoLoading(false)}
            onError={() => { setError(status === "ended" ? "This replay can't play here" : "Stream unavailable — it may have ended"); setVideoLoading(false); }}
            data-testid="stream-player-video"
          >
            <source src={directVideoUrl} type="application/x-mpegURL" />
          </video>
        </div>
        {!mini && (
          <div className="flex sm:hidden items-center gap-2 px-2 py-1.5 bg-muted dark:bg-[#0c0c14]/60 rounded-b-lg border border-t-0 border-border dark:border-transparent">
            {true ? (
              <button
                onClick={async () => {
                  handlePopOut();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
                data-testid="button-pip-stream"
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
                Pop Out
              </button>
            ) : (
              <button
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
                  else if ((video as any).webkitEnterFullscreen) (video as any).webkitEnterFullscreen();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
                data-testid="button-expand-stream"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Expand
              </button>
            )}
            <span className="text-[10px] text-muted-foreground/40 ml-auto">{status === "ended" ? "Replay" : "Live Broadcast"}</span>
          </div>
        )}
      </div>
    );
  }

  if (isIframeEmbed && embedId) {
    return (
      <div className={`relative ${mini ? "h-full" : "aspect-video"} bg-brand/5 dark:bg-black ${mini ? "rounded-none" : "rounded-lg"} overflow-hidden border border-brand/20 dark:border-transparent`}>
        <InlineEmbedPlayer
          type={embedType}
          embedId={embedId}
          autoplay
          className="w-full h-full"
          testId="stream-player-embed"
        />
      </div>
    );
  }

  if (useHlsJs) {
    return (
      <div className={`space-y-0 ${mini ? "h-full" : ""}`}>
        <div className={`relative ${mini ? "h-full" : "aspect-video"} bg-brand/5 dark:bg-black ${mini ? "rounded-none" : "rounded-t-lg sm:rounded-lg"} overflow-hidden border border-brand/20 dark:border-transparent group/stream`}>
          {videoLoading && <StreamPlayerLoader />}
          <video
            ref={videoRef}
            controls
            autoPlay
            muted
            playsInline
            className="w-full h-full outline-none focus:outline-none"
            data-testid="stream-player-video"
          />
          {!mini && (
            <button
              onClick={async () => {
                const video = videoRef.current;
                if (!video) return;
                handlePopOut();
              }}
              className="hidden sm:block absolute top-2 right-2 z-10 p-1.5 rounded-full backdrop-blur-md bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-all opacity-0 group-hover/stream:opacity-100 focus:opacity-100"
              title="Picture-in-Picture"
              data-testid="button-pip-stream-desktop"
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>
          )}
        </div>
        {!mini && (
          <div className="flex sm:hidden items-center gap-2 px-2 py-1.5 bg-muted dark:bg-[#0c0c14]/60 rounded-b-lg border border-t-0 border-border dark:border-transparent">
            {true ? (
              <button
                onClick={async () => {
                  const video = videoRef.current;
                  if (!video) return;
                  handlePopOut();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
                data-testid="button-pip-stream"
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
                Pop Out
              </button>
            ) : (
              <button
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
                  else if ((video as any).webkitEnterFullscreen) (video as any).webkitEnterFullscreen();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
                data-testid="button-expand-stream"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Expand
              </button>
            )}
            <span className="text-[10px] text-muted-foreground/40 ml-auto">{status === "ended" ? "Replay" : "Live Broadcast"}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-0 ${mini ? "h-full" : ""}`}>
      <div className={`relative ${mini ? "h-full" : "aspect-video"} bg-brand/5 dark:bg-black ${mini ? "rounded-none" : "rounded-t-lg sm:rounded-lg"} overflow-hidden border border-brand/20 dark:border-transparent group/stream`}>
        {videoLoading && <StreamPlayerLoader />}
        <video
          ref={videoRef}
          src={directVideoUrl || url}
          controls
          autoPlay
          muted
          playsInline
          webkit-playsinline=""
          className="w-full h-full outline-none focus:outline-none"
          onCanPlay={() => setVideoLoading(false)}
          onPlaying={() => setVideoLoading(false)}
          onError={() => { setError(status === "ended" ? "This replay can't play here" : "Stream unavailable — it may have ended"); setVideoLoading(false); }}
          data-testid="stream-player-video"
        >
          <source src={directVideoUrl || url} />
        </video>
        {!mini && (
          <button
            onClick={async () => {
              const video = videoRef.current;
              if (!video) return;
              handlePopOut();
            }}
            className="hidden sm:block absolute top-2 right-2 z-10 p-1.5 rounded-full backdrop-blur-md bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-all opacity-0 group-hover/stream:opacity-100 focus:opacity-100"
            title="Picture-in-Picture"
            data-testid="button-pip-stream-desktop"
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {!mini && (
        <div className="flex sm:hidden items-center gap-2 px-2 py-1.5 bg-muted dark:bg-[#0c0c14]/60 rounded-b-lg border border-t-0 border-border dark:border-transparent">
          {true ? (
            <button
              onClick={async () => {
                const video = videoRef.current;
                if (!video) return;
                handlePopOut();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
              data-testid="button-pip-stream"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
              Pop Out
            </button>
          ) : (
            <button
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
                else if ((video as any).webkitEnterFullscreen) (video as any).webkitEnterFullscreen();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
              data-testid="button-expand-stream"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Expand
            </button>
          )}
          <span className="text-[10px] text-muted-foreground/40 ml-auto">{status === "ended" ? "Replay" : "Live Broadcast"}</span>
        </div>
      )}
    </div>
  );
}

function StreamDetail({ stream }: { stream: LiveEventData }) {
  const { pubkey: myPubkey, signer, attemptReconnect } = useNostrAuth();
  // Watching a stream fullscreen → dismiss any floating mini-player (round-trips
  // cleanly with the mini's "expand" which routes back here).
  const { closeMini } = useLiveMiniPlayer();
  useEffect(() => { closeMini(); }, [stream.pubkey, stream.dTag, closeMini]);
  // naddr so the mini-player's expand button can deep-link back to this stream.
  const expandNaddr = useMemo(() => {
    try {
      if (stream.zapStreamNaddr) return stream.zapStreamNaddr;
      if (!stream.dTag) return undefined;
      return nip19.naddrEncode({ identifier: stream.dTag, pubkey: stream.pubkey, kind: KIND_LIVE_EVENT });
    } catch { return undefined; }
  }, [stream.zapStreamNaddr, stream.dTag, stream.pubkey]);
  const { toast } = useToast();
  const [chatMessages, setChatMessages] = useState<Event[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [zapOpen, setZapOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [chatHeight, setChatHeight] = useState<number | null>(null);
  const [chatFocused, setChatFocused] = useState(false);
  const isAtBottomRef = useRef(true);
  const initialLoadDoneRef = useRef(false);
  const eoseReceivedRef = useRef(false);
  const chatReadyPrevRef = useRef(false);
  const [chatReady, setChatReady] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const prevMessageCountRef = useRef(0);
  const [isMobileChat, setIsMobileChat] = useState(typeof window !== "undefined" && window.innerWidth < 1024);

  useEffect(() => {
    const checkMobile = () => setIsMobileChat(window.innerWidth < 1024);
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!isMobileChat) {
      setChatFocused(false);
    }
  }, [isMobileChat]);

  useEffect(() => {
    if (chatFocused && isMobileChat && chatContainerRef.current) {
      setTimeout(() => {
        const c = chatContainerRef.current;
        if (c) c.scrollTop = c.scrollHeight;
      }, 150);
    }
  }, [chatFocused, isMobileChat]);

  const chatPanelRef = useRef<HTMLDivElement>(null);

  const handleChatBlur = useCallback(() => {
    setTimeout(() => {
      const active = document.activeElement;
      if (chatPanelRef.current && chatPanelRef.current.contains(active)) return;
      setChatFocused(false);
    }, 200);
  }, []);

  const aTag = useMemo(() => buildATag(stream.event) || `${KIND_LIVE_EVENT}:${stream.pubkey}:${stream.dTag}`, [stream.event, stream.pubkey, stream.dTag]);

  // Displayed/credited streamer = the HOST participant, not stream.pubkey (the
  // publishing platform account that authored the kind-30311 event). Identity,
  // coordinate, liveness and subscriptions still key off stream.pubkey below.
  const hostPubkey = useMemo(() => getStreamHost(stream), [stream]);
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, hostPubkey), [hostPubkey]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(hostPubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;

  const zapTargetPubkey = hostPubkey;
  const zapRecipientName = displayName || "Streamer";

  let npub: string;
  try { npub = nip19.npubEncode(hostPubkey); } catch { npub = hostPubkey; }

  useEffect(() => {
    fetchProfilesCached([stream.pubkey, ...stream.participants.map(p => p.pubkey)]);
  }, [stream.pubkey, stream.participants]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
      setChatHeight(isDesktop ? el.offsetHeight : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  useEffect(() => {
    if (!stream.chatEnabled) {
      setChatMessages([]);
      setChatReady(true);
      return;
    }

    const chatRelays = Array.from(new Set([
      ...stream.relays,
      ...LIVE_STREAM_RELAYS,
    ]));

    const seen = new Set<string>();
    initialLoadDoneRef.current = false;
    eoseReceivedRef.current = false;
    chatReadyPrevRef.current = false;
    prevMessageCountRef.current = 0;
    setUnseenCount(0);
    setChatReady(false);
    isAtBottomRef.current = true;

    let initialBatch: Event[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimeout: ReturnType<typeof setTimeout> | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let cleaned = false;

    const finishInitialLoad = () => {
      if (initialLoadDoneRef.current || cleaned) return;
      initialLoadDoneRef.current = true;
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (maxTimeout) { clearTimeout(maxTimeout); maxTimeout = null; }

      if (initialBatch.length > 0) {
        const batch = [...initialBatch];
        initialBatch = [];
        batch.sort((a, b) => a.created_at - b.created_at);
        setChatMessages(prev => {
          const merged = [...prev];
          for (const ev of batch) {
            if (!merged.some(m => m.id === ev.id)) merged.push(ev);
          }
          merged.sort((a, b) => a.created_at - b.created_at);
          return merged;
        });
      }

      readyTimer = setTimeout(() => {
        if (cleaned) return;
        requestAnimationFrame(() => {
          if (cleaned) return;
          const c = chatContainerRef.current;
          if (c) c.scrollTop = c.scrollHeight;
          isAtBottomRef.current = true;
          setChatReady(true);
        });
      }, 50);
    };

    const tryFinish = () => {
      if (eoseReceivedRef.current && !initialLoadDoneRef.current) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        flushTimer = setTimeout(finishInitialLoad, 100);
      }
    };

    maxTimeout = setTimeout(finishInitialLoad, 1500);

    const sub = pool.subscribeMany(chatRelays, { kinds: [KIND_LIVE_CHAT], "#a": [aTag], limit: 150 } as any, {
      onevent(event: Event) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        fetchProfilesCached([event.pubkey]);

        if (!initialLoadDoneRef.current) {
          initialBatch.push(event);
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(() => {
            if (eoseReceivedRef.current) {
              finishInitialLoad();
            }
          }, 300);
        } else {
          setChatMessages(prev => {
            const updated = [...prev, event];
            updated.sort((a, b) => a.created_at - b.created_at);
            return updated;
          });
        }
      },
      oneose() {
        eoseReceivedRef.current = true;
        tryFinish();
      },
    });

    return () => {
      cleaned = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (maxTimeout) clearTimeout(maxTimeout);
      if (readyTimer) clearTimeout(readyTimer);
      if (initialBatch.length > 0) {
        const batch = [...initialBatch];
        initialBatch = [];
        batch.sort((a, b) => a.created_at - b.created_at);
        setChatMessages(prev => {
          const merged = [...prev];
          for (const ev of batch) {
            if (!merged.some(m => m.id === ev.id)) merged.push(ev);
          }
          merged.sort((a, b) => a.created_at - b.created_at);
          return merged;
        });
      }
      sub.close();
    };
  }, [aTag, stream.relays, stream.chatEnabled]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const threshold = 60;
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
      isAtBottomRef.current = atBottom;
      if (atBottom) setUnseenCount(0);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!chatReady) return;

    if (!chatReadyPrevRef.current) {
      chatReadyPrevRef.current = true;
      prevMessageCountRef.current = chatMessages.length;
      return;
    }

    const count = chatMessages.length;
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = count;

    const newMessages = count - prevCount;
    if (newMessages <= 0) return;

    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        const c = chatContainerRef.current;
        if (c) c.scrollTop = c.scrollHeight;
      });
    } else {
      setUnseenCount(prev => prev + newMessages);
    }
  }, [chatMessages.length, chatReady]);

  const scrollChatToBottom = useCallback(() => {
    const c = chatContainerRef.current;
    if (c) c.scrollTop = c.scrollHeight;
    isAtBottomRef.current = true;
    setUnseenCount(0);
  }, []);

  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || !signer || !myPubkey) return;
    setSending(true);
    try {
      const unsigned: any = {
        kind: KIND_LIVE_CHAT,
        content: chatInput.trim(),
        tags: [["a", aTag, stream.relays[0] || ""], ...clientTags()],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: myPubkey,
      };
      const signed = await signWithTimeout(signer, unsigned);
      const chatRelays = Array.from(new Set([
        ...stream.relays,
        ...LIVE_STREAM_RELAYS,
      ]));
      await publishEvent(signed, chatRelays);
      setChatInput("");
      requestAnimationFrame(() => scrollChatToBottom());
    } catch (err: any) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else { toast({ title: "Failed to send", description: err?.message || "Could not send chat message", variant: "destructive" }); }
    } finally {
      setSending(false);
    }
  }, [chatInput, signer, myPubkey, aTag, stream.relays, toast, scrollChatToBottom, attemptReconnect]);

  // Status-aware: an ended stream's recording beats its stale streaming tag
  // (user report: a Rumble replay sat unplayed behind a dead HLS URL).
  const playableUrl = pickStreamSource(stream.status, stream.streamUrl, stream.recordingUrl);

  const mobileChatActive = isMobileChat && chatFocused && stream.chatEnabled;

  return (
    <div className="overflow-x-hidden space-y-4" data-testid="stream-detail">
      {/* No "Back to Streams" here: the app chrome's back owns /live/:naddr
          (back-affordance.ts maps cold entries to /search?tab=live) — this
          used to stack a second arrow under it. */}
      <div className={mobileChatActive ? "flex flex-col" : `flex flex-col ${stream.chatEnabled ? "lg:flex-row" : ""} gap-4 lg:items-start`}>
        <div
          ref={videoRef}
          className={mobileChatActive ? "shrink-0 h-[30dvh] bg-black relative" : "flex-1 min-w-0"}
        >
          {mobileChatActive && (
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-gradient-to-b from-black/60 to-transparent">
              <button
                type="button"
                onClick={() => { setChatFocused(false); inputRef.current?.blur(); }}
                className="p-1 -ml-1 text-white/70 hover:text-white"
                data-testid="button-chat-collapse"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Signal className="w-3 h-3 text-red-500 animate-pulse" />
              <span className="text-xs font-medium text-white/80 truncate flex-1">{stream.title}</span>
            </div>
          )}
          <StreamPlayer url={playableUrl || ""} title={stream.title} hlsUrl={stream.hlsUrl} isZapStream={stream.isZapStream} zapStreamNaddr={stream.zapStreamNaddr} mini={mobileChatActive} image={stream.image} status={stream.status} expandNaddr={expandNaddr} />
        </div>

        {stream.chatEnabled ? (
          <div
            ref={chatPanelRef}
            className={`flex flex-col border border-border dark:border-white/[0.06] bg-card dark:bg-[#0a0a12]/80 backdrop-blur-sm dark:backdrop-blur-none overflow-hidden ${
              mobileChatActive
                ? "rounded-none border-x-0 border-b-0"
                : "w-full lg:w-[340px] lg:shrink-0 rounded-xl h-[280px] sm:h-[320px]"
            }`}
            style={mobileChatActive ? { height: "calc(100dvh - 30dvh)" } : chatHeight ? { height: chatHeight } : undefined}
            data-testid="chat-panel"
          >
            {!mobileChatActive && (
              <div className="px-2.5 py-1.5 border-b border-border dark:border-white/[0.06] flex items-center gap-2 bg-muted dark:bg-[#0c0c14]/60 shrink-0">
                <Radio className="w-3 h-3 text-brand/60" />
                <span className="text-[11px] font-medium text-foreground dark:text-white/60">Live Chat</span>
                <span className="text-[9px] text-muted-foreground dark:text-white/20 ml-auto">{chatMessages.length}</span>
              </div>
            )}

            <div className="relative flex-1 min-h-0">
              <div
                ref={chatContainerRef}
                className={`absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain transition-opacity duration-150 ${chatReady ? "opacity-100" : "opacity-0"}`}
                data-testid="chat-messages"
              >
                {chatMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground dark:text-white/20 text-xs">
                    <div className="text-center space-y-1">
                      <Radio className="w-5 h-5 mx-auto opacity-30" />
                      <p className="text-[11px]">No chat messages yet</p>
                      <p className="text-[9px] text-muted-foreground dark:text-white/10">Be the first to say something</p>
                    </div>
                  </div>
                ) : (
                  <div className="py-1">
                    {chatMessages.map(msg => (
                      <ChatMessage key={msg.id} msg={msg} aTag={aTag} />
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>
              {unseenCount > 0 && (
                <button
                  onClick={scrollChatToBottom}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-3 py-1 rounded-full bg-primary dark:bg-brand/90 hover:bg-primary/90 dark:hover:bg-brand text-white text-[11px] font-medium shadow-lg shadow-brand/30 dark:shadow-brand/40 transition-all cursor-pointer backdrop-blur-sm"
                  data-testid="button-chat-new-messages"
                >
                  <ChevronDown className="w-3 h-3" />
                  {unseenCount} new {unseenCount === 1 ? "message" : "messages"}
                </button>
              )}
            </div>

            <div className={`border-t border-border dark:border-white/[0.06] bg-muted dark:bg-[#0c0c14]/80 shrink-0 sticky bottom-0 ${mobileChatActive ? "px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" : "px-2 py-1.5"}`}>
              {myPubkey && signer ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); sendChat(); }}
                  className="flex items-center gap-1.5"
                  data-testid="form-chat-send"
                >
                  <Input
                    ref={inputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onFocus={() => isMobileChat && setChatFocused(true)}
                    onBlur={handleChatBlur}
                    placeholder="Send a message..."
                    className={`flex-1 bg-muted dark:bg-white/[0.04] border-border dark:border-white/[0.06] text-foreground dark:text-white/80 placeholder:text-muted-foreground dark:placeholder:text-white/20 focus-visible:ring-ring dark:focus-visible:ring-brand/30 rounded-md ${mobileChatActive ? "h-10 text-base" : "h-8 text-base sm:text-[11px]"}`}
                    disabled={sending}
                    data-testid="input-chat-message"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!chatInput.trim() || sending}
                    data-testid="button-chat-send"
                    className={`p-0 bg-primary dark:bg-brand/80 hover:bg-primary/90 dark:hover:bg-brand/80 text-white ${mobileChatActive ? "h-10 w-10" : "h-7 w-7"}`}
                  >
                    <Send className={mobileChatActive ? "w-4 h-4" : "w-3 h-3"} />
                  </Button>
                </form>
              ) : (
                <p className="text-[10px] text-muted-foreground dark:text-white/25 text-center py-0.5">
                  Sign in to chat
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border dark:border-white/[0.06] bg-card dark:bg-[#0a0a12]/40" data-testid="chat-disabled-notice">
            <Radio className="w-3.5 h-3.5 text-muted-foreground dark:text-white/15" />
            <span className="text-[11px] text-muted-foreground dark:text-white/25">Chat disabled by streamer</span>
          </div>
        )}
      </div>

      {!mobileChatActive && (
        <div className="space-y-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={stream.status} />
              {stream.hashtags.slice(0, 3).map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand/60">#{t}</span>
              ))}
              <div className="flex items-center gap-1.5 ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareOpen(true)}
                  data-testid="button-share-stream"
                  className="h-7 px-2 sm:px-3 border-brand/30 dark:border-brand/20 text-brand gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZapOpen(true)}
                  data-testid="button-zap-streamer"
                  className="h-7 px-2 sm:px-3 border-amber-500/30 text-amber-600 dark:text-amber-400 gap-1.5"
                >
                  <BtcZapIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Zap</span>
                </Button>
              </div>
            </div>
            <h1 className="text-lg font-bold text-foreground dark:text-white/90">{stream.title}</h1>
            {stream.summary && (
              <p className="text-sm text-muted-foreground dark:text-white/40 line-clamp-2">{stream.summary}</p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Link href={`/profile/${npub}`}>
              <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                <Avatar className="w-8 h-8 border border-border dark:border-white/10">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="text-xs bg-muted dark:bg-brand/50">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium text-foreground dark:text-white/80">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground dark:text-white/30">{shortenNpub(formatNpub(hostPubkey))}</p>
                </div>
              </div>
            </Link>
            {stream.currentParticipants != null && (
              <div className="flex items-center gap-1 text-muted-foreground dark:text-white/30 text-xs ml-auto">
                <Eye className="w-3.5 h-3.5" />
                {stream.currentParticipants} watching
              </div>
            )}
          </div>

          {stream.participants.filter(p => p.pubkey !== hostPubkey).length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {stream.participants.filter(p => p.pubkey !== hostPubkey).slice(0, 10).map(p => (
                <ParticipantBadge key={p.pubkey} pubkey={p.pubkey} role={p.role} />
              ))}
            </div>
          )}

          {stream.streamUrl && (
            <a
              href={stream.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-brand/50 hover:text-brand/80 transition-colors mt-1"
              data-testid="link-stream-url"
            >
              <ExternalLink className="w-3 h-3" />
              Open stream in new tab
            </a>
          )}
        </div>
      )}

      <ZapDialog
        open={zapOpen}
        onOpenChange={setZapOpen}
        pubkey={zapTargetPubkey}
        recipientName={zapRecipientName}
      />

      <ShareStreamDialog
        stream={stream}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}

function ParticipantBadge({ pubkey, role }: { pubkey: string; role: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const profileContent = useMemo(() => profile ? getProfileContent(profile) : null, [profile]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;
  const nip05 = (profileContent as any)?.nip05 || null;
  const lud16 = (profileContent as any)?.lud16 || null;
  const about = (profileContent as any)?.about || null;
  let npub: string;
  try { npub = nip19.npubEncode(pubkey); } catch { npub = pubkey; }
  const shortNpub = `${npub.slice(0, 12)}...${npub.slice(-6)}`;

  const [copied, setCopied] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const { toast } = useToast();

  const handleCopyNpub = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    copyNostrId(npub).then(() => {
      setCopied(true);
      toast({ title: "Copied", description: "npub copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  }, [npub, toast]);

  const handleZapClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowZapDialog(true);
  }, []);

  const roleColor = role === "Host" ? "text-amber-600 dark:text-amber-400/80 border-amber-400/20 dark:border-amber-500/20" :
    role === "Speaker" ? "text-primary dark:text-brand/80 border-primary/20 dark:border-brand/20" :
    "text-muted-foreground dark:text-white/40 border-border dark:border-white/10";

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        <Link href={`/profile/${npub}`}>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${roleColor} bg-muted dark:bg-white/[0.02] hover:bg-accent dark:hover:bg-white/[0.05] transition-colors cursor-pointer`}>
            <Avatar className="w-4 h-4 border border-border dark:border-white/5">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[6px] bg-muted dark:bg-brand/50">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="text-[10px] font-medium">{displayName}</span>
            <span className="text-[8px] opacity-60">{role}</span>
          </div>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-72 p-0 border-0 bg-transparent shadow-none mention-hover-card"
        data-testid={`hover-card-participant-${npub.slice(0, 12)}`}
      >
        <div className="relative rounded-xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#1a0533] via-[#0d0d2b] to-[#0a0a1a] opacity-95" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.15),_transparent_60%)]" />
          <div className="absolute inset-0 border border-brand/20 rounded-xl" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-[1px] bg-gradient-to-r from-transparent via-brand/50 to-transparent" />

          <div className="relative z-10 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Link href={`/profile/${npub}`}>
                <Avatar className="w-12 h-12 ring-2 ring-brand/30 border-2 border-[#0d0d2b] shrink-0 cursor-pointer">
                  <AvatarImage src={avatarUrl} alt={displayName || "Profile"} />
                  <AvatarFallback className="bg-brand/40 text-brand text-sm font-bold">
                    {(displayName || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
              <div className="flex-1 min-w-0">
                <Link href={`/profile/${npub}`} className="no-underline">
                  <p className="text-sm font-semibold text-white/90 truncate hover:text-brand transition-colors cursor-pointer">
                    {displayName || shortNpub}
                  </p>
                </Link>
                {nip05 && (
                  <p className="text-[11px] text-brand/70 truncate mt-0.5">{nip05}</p>
                )}
                <Badge className={`mt-1 text-[9px] px-1.5 py-0 ${role === "Host" ? "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/30" : role === "Speaker" ? "bg-brand/20 text-brand border-brand/30" : "bg-white/5 text-white/50 border-white/10"}`}>
                  {role}
                </Badge>
              </div>
            </div>

            {about && (
              <p className="text-[11px] text-white/50 leading-relaxed line-clamp-2">{about}</p>
            )}

            <div className="space-y-1.5 pt-1">
              <button
                type="button"
                onClick={handleCopyNpub}
                className="flex items-center gap-2 group w-full text-left cursor-pointer hover:bg-white/[0.04] rounded-md px-1 -mx-1 py-0.5 transition-colors"
              >
                <img src={nostrOstrichGif} alt="" className="w-4 h-4 object-contain shrink-0" />
                <span className="text-[11px] text-white/40 font-mono truncate group-hover:text-white/60 transition-colors">
                  {shortNpub}
                </span>
                {copied ? (
                  <Check className="w-3 h-3 text-green-800 dark:text-green-400 ml-auto shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-white/25 ml-auto shrink-0 group-hover:text-white/50 transition-colors" />
                )}
              </button>

              {lud16 && (
                <button
                  type="button"
                  onClick={handleZapClick}
                  className="flex items-center gap-2 group w-full text-left cursor-pointer hover:bg-white/[0.04] rounded-md px-1 -mx-1 py-0.5 transition-colors"
                >
                  <BtcZapIcon className="w-4 h-4 text-amber-800/70 dark:text-amber-400/70 shrink-0" />
                  <span className="text-[11px] text-amber-800/60 dark:text-amber-300/60 truncate group-hover:text-amber-800/80 dark:group-hover:text-amber-300/80 transition-colors">
                    {lud16}
                  </span>
                  <Zap className="w-3 h-3 text-amber-800/25 dark:text-amber-400/25 ml-auto shrink-0 group-hover:text-amber-800/60 dark:group-hover:text-amber-400/60 transition-colors" />
                </button>
              )}
            </div>
          </div>
        </div>
      </HoverCardContent>
      {lud16 && (
        <ZapDialog
          open={showZapDialog}
          onOpenChange={setShowZapDialog}
          pubkey={pubkey}
          recipientName={displayName || shortNpub}
        />
      )}
    </HoverCard>
  );
}

type FilterTab = "live" | "planned" | "ended";

export default function LiveStreams() {
  useDocumentTitle("Live Streams | Relay Outpost");
  const params = useParams<{ naddr?: string }>();
  const { getLiveStream } = useLiveStatus();
  const [streams, setStreams] = useState<LiveEventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStream, setSelectedStream] = useState<LiveEventData | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("live");
  const deepLinkAppliedRef = useRef(false);

  const scrollToTop = useCallback(() => {
    const scroll = () => {
      const scrollContainer = document.querySelector('main.feed-scroll-container') || document.querySelector('main');
      if (scrollContainer) scrollContainer.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    scroll();
    requestAnimationFrame(() => requestAnimationFrame(scroll));
  }, []);

  const [, navigate] = useLocation();
  const selectStream = useCallback((stream: LiveEventData) => {
    // From the LIST page a selection is a NAVIGATION: the detail gets a real
    // URL — shareable, and the chrome back appears. (/live is a top-level
    // route with no back of its own; an in-place switch left the viewer with
    // no way out of the detail after the internal back was removed.) On the
    // detail route itself, keep the in-place swap (host switches etc.).
    if (!params.naddr) {
      try {
        const naddr = nip19.naddrEncode({ kind: KIND_LIVE_EVENT, pubkey: stream.pubkey, identifier: stream.dTag, relays: [] });
        navigate(`/live/${naddr}`);
        return;
      } catch { /* malformed identifier — fall back to the in-place swap */ }
    }
    scrollToTop();
    setSelectedStream(stream);
  }, [scrollToTop, params.naddr, navigate]);

  useEffect(() => {
    if (selectedStream) {
      scrollToTop();
    }
  }, [selectedStream, scrollToTop]);

  useEffect(() => {
    if (!selectedStream) return;
    const updated = streams.find(s => s.pubkey === selectedStream.pubkey && s.dTag === selectedStream.dTag);
    if (updated && updated.event.created_at > selectedStream.event.created_at) {
      setSelectedStream(updated);
    }
  }, [streams, selectedStream]);

  useEffect(() => {
    setLoading(true);
    const seen = new Map<string, LiveEventData>();

    const sub = throttledPoolSubscribe(LIVE_STREAM_RELAYS, { kinds: [KIND_LIVE_EVENT], limit: 100 }, {
      onevent(event: Event) {
        const parsed = parseLiveEvent(event);
        if (!parsed) return;
        const key = `${parsed.pubkey}:${parsed.dTag}`;
        const existing = seen.get(key);
        if (!existing || event.created_at > existing.event.created_at) {
          seen.set(key, parsed);
          fetchProfilesCached([parsed.pubkey]);
          setStreams(Array.from(seen.values()));
        }
      },
      oneose() {
        setLoading(false);
      },
    });

    return () => sub.close();
  }, []);

  const prevNaddrRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (params.naddr !== prevNaddrRef.current) {
      const hadNaddr = !!prevNaddrRef.current;
      prevNaddrRef.current = params.naddr;
      deepLinkAppliedRef.current = false;
      // The URL is the selection now (a card tap NAVIGATES to /live/<naddr>):
      // when the naddr leaves the URL — chrome back, history pop — the detail
      // must leave the screen with it, or /live shows a detail over a list URL.
      if (hadNaddr && !params.naddr) {
        setSelectedStream(null);
        return;
      }
    }
    if (!params.naddr || deepLinkAppliedRef.current) return;
    const currentNaddr = params.naddr;
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(currentNaddr);
    } catch { return; }
    if (decoded.type !== "naddr") return;
    const { pubkey, identifier, relays: hintRelays } = decoded.data;

    const contextStream = getLiveStream(pubkey);
    if (contextStream && contextStream.dTag === identifier) {
      deepLinkAppliedRef.current = true;
      setSelectedStream(contextStream);
      return;
    }

    const listMatch = streams.find(s => s.pubkey === pubkey && s.dTag === identifier);
    if (listMatch) {
      deepLinkAppliedRef.current = true;
      setSelectedStream(listMatch);
      return;
    }

    let cancelled = false;
    const queryRelays = [...new Set([...LIVE_STREAM_RELAYS, ...(hintRelays || [])])];
    Promise.race([
      pool.querySync(queryRelays, { kinds: [KIND_LIVE_EVENT], authors: [pubkey], "#d": [identifier], limit: 5 }),
      new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 8000)),
    ]).then((events) => {
      if (cancelled || deepLinkAppliedRef.current || params.naddr !== currentNaddr) return;
      let best: LiveEventData | null = null;
      for (const ev of events) {
        const parsed = parseLiveEvent(ev);
        if (parsed && (!best || ev.created_at > best.event.created_at)) {
          best = parsed;
        }
      }
      if (best) {
        deepLinkAppliedRef.current = true;
        fetchProfilesCached([best.pubkey]);
        setSelectedStream(best);
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [params.naddr, streams, getLiveStream]);

  const streamUrls = useMemo(() =>
    streams.filter(s => s.status === "live").map(s => s.streamUrl || s.hlsUrl),
    [streams]
  );
  const livenessMap = useBatchStreamLiveness(streamUrls);

  const getStreamLiveness = useCallback((stream: LiveEventData): StreamLiveness => {
    const url = stream.streamUrl || stream.hlsUrl;
    if (!url) return "unknown";
    return livenessMap.get(url) || "unknown";
  }, [livenessMap]);

  const effectiveStatus = useCallback((s: LiveEventData): "live" | "planned" | "ended" => {
    if (s.status === "live") return "live";
    if (s.status === "planned") {
      const startTs = s.starts || s.event.created_at;
      if (startTs < Math.floor(Date.now() / 1000)) return "ended";
      return "planned";
    }
    return "ended";
  }, []);

  const filteredStreams = useMemo(() => {
    let list = [...streams];
    if (filterTab === "live") {
      const now = Math.floor(Date.now() / 1000);
      const STALE_AGE = 2 * 60 * 60;
      list = list.filter(s => {
        if (s.status !== "live") return false;
        const liveness = getStreamLiveness(s);
        if (liveness === "verified-live") return true;
        if (liveness === "offline") return false;
        if (s.currentParticipants != null) return true;
        const eventAge = now - s.event.created_at;
        const startAge = s.starts ? now - s.starts : eventAge;
        const age = Math.min(eventAge, startAge);
        if (age > STALE_AGE) return false;
        return true;
      });
    } else {
      // Past broadcasts list only what a viewer can actually WATCH: a
      // declared recording (hasReplay). An ended event without one is a tap
      // into an error card — invisible beats disappointing.
      list = list.filter(s => effectiveStatus(s) === filterTab && (filterTab !== "ended" || hasReplay(s)));
    }
    list.sort((a, b) => {
      const statusOrder = { live: 0, planned: 1, ended: 2 };
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;

      if (a.status === "live" && b.status === "live") {
        const aLive = getStreamLiveness(a);
        const bLive = getStreamLiveness(b);
        const aOffline = aLive === "offline" ? 1 : 0;
        const bOffline = bLive === "offline" ? 1 : 0;
        if (aOffline !== bOffline) return aOffline - bOffline;

        const viewsA = a.currentParticipants ?? 0;
        const viewsB = b.currentParticipants ?? 0;
        if (viewsA !== viewsB) return viewsB - viewsA;

        const livenessOrder = { "verified-live": 0, "unknown": 1, "offline": 2 };
        const liveDiff = livenessOrder[aLive] - livenessOrder[bLive];
        if (liveDiff !== 0) return liveDiff;
      }

      const aUntitled = a.title === "Untitled Stream" && !a.image && (a.currentParticipants ?? 0) === 0;
      const bUntitled = b.title === "Untitled Stream" && !b.image && (b.currentParticipants ?? 0) === 0;
      if (aUntitled !== bUntitled) return aUntitled ? 1 : -1;

      return b.event.created_at - a.event.created_at;
    });
    return list;
  }, [streams, filterTab, getStreamLiveness]);

  if (selectedStream) {
    return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <StreamDetail stream={selectedStream} />
      </div>
    );
  }

  const liveCount = (() => {
    const now = Math.floor(Date.now() / 1000);
    const STALE_AGE = 2 * 60 * 60;
    return streams.filter(s => {
      if (s.status !== "live") return false;
      const liveness = getStreamLiveness(s);
      if (liveness === "verified-live") return true;
      if (liveness === "offline") return false;
      if (s.currentParticipants != null) return true;
      const eventAge = now - s.event.created_at;
      const startAge = s.starts ? now - s.starts : eventAge;
      const age = Math.min(eventAge, startAge);
      if (age > STALE_AGE) return false;
      return true;
    }).length;
  })();
  const plannedCount = streams.filter(s => effectiveStatus(s) === "planned").length;
  const endedCount = streams.filter(s => effectiveStatus(s) === "ended" && hasReplay(s)).length;

  const tabs: { key: FilterTab; label: string; shortLabel: string; count: number }[] = [
    { key: "live", label: "Live", shortLabel: "Live", count: liveCount },
    { key: "planned", label: "Upcoming", shortLabel: "Upcoming", count: plannedCount },
    // "Past broadcasts" wrapped to two lines at 375px and broke the tab row's
    // baseline — phones get the short word, sm+ keeps the full label.
    { key: "ended", label: "Past broadcasts", shortLabel: "Past", count: endedCount },
  ];

  return (
    <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-5 overflow-x-hidden" data-testid="page-live-streams">
      <MissionBriefing pageId="live" steps={LIVE_STREAMS_BRIEFING} />
      <div className="flex items-center gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground" data-testid="text-page-title">Live Streams</h1>
            {liveCount > 0 && (
              <Badge className="bg-red-600/80 text-white text-[10px] animate-pulse">
                {liveCount} LIVE
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground/70">Watch live broadcasts and join the conversation</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border/30 pb-0.5 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            data-testid={`tab-streams-${tab.key}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors relative whitespace-nowrap shrink-0 ${
              filterTab === tab.key
                ? "text-brand after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand/60"
                : "text-muted-foreground/50 hover:text-muted-foreground/80"
            }`}
          >
            <span className="sm:hidden">{tab.shortLabel}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count > 0 && (
              <span className={`ml-1.5 text-[10px] ${filterTab === tab.key ? "text-brand/60" : "text-muted-foreground/30"}`}>
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RelayOutpostInlineLoader />
        </div>
      ) : filteredStreams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/30 space-y-3">
          {filterTab === "ended" ? (
            <History className="w-12 h-12 opacity-30" />
          ) : filterTab === "planned" ? (
            <Calendar className="w-12 h-12 opacity-30" />
          ) : (
            <Satellite className="w-12 h-12 opacity-30" />
          )}
          <p className="text-sm">
            {filterTab === "live" ? "No live streams right now" :
             filterTab === "planned" ? "No upcoming streams scheduled" :
             filterTab === "ended" ? "No past broadcasts found" :
             "No streams found"}
          </p>
          <p className="text-[11px] text-muted-foreground/20">
            {filterTab === "live" ? "Streams from Nostr relays will appear here when broadcasters go live" :
             filterTab === "planned" ? "Scheduled streams will show up here with date and time" :
             filterTab === "ended" ? "Previously aired streams will be listed here" :
             "Streams from Nostr relays will appear here"}
          </p>
        </div>
      ) : filterTab === "ended" ? (
        <PastBroadcastList streams={filteredStreams} onSelect={selectStream} />
      ) : filterTab === "planned" ? (
        <UpcomingScheduleList streams={filteredStreams} onSelect={selectStream} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStreams.map(stream => (
            <StreamCard
              key={`${stream.pubkey}:${stream.dTag}`}
              stream={stream}
              onClick={() => selectStream(stream)}
              liveness={stream.status === "live" ? getStreamLiveness(stream) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}