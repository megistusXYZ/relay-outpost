import { useEffect, useMemo, useState, useCallback } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { eventStore, pool, fetchProfilesCached, DEFAULT_RELAYS } from "@/lib/nostr";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  getAvatarUrl,
  getDisplayName,
  getProfileContent,
  KIND_METADATA,
  formatNpub,
  shortenNpub,
} from "@/lib/nostr-helpers";
import { Nip05Badge } from "@/components/Nip05Badge";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useTopZappers } from "@/hooks/use-top-zappers";
import { useReactionDetails } from "@/hooks/use-reaction-details";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatSats } from "@/lib/zap";
import { formatCount } from "@/lib/format-count";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { BtcZapIcon, VouchedBySection, TrustedBySection, HoverCardTrustBadge } from "./author-hover";

// Re-exported from the pure lib module so existing importers keep working while
// the Thread spine can consume the same helper without pulling in this component.
export { formatCount };

export function parseBolt11Sats(bolt11: string): number {
  const match = bolt11.match(/lnbc(\d+)([munp]?)/i);
  if (!match) return 0;
  const num = parseInt(match[1]);
  const unit = match[2] || "";
  const btcAmount =
    unit === "m" ? num / 1000 :
    unit === "u" ? num / 1000000 :
    unit === "n" ? num / 1000000000 :
    unit === "p" ? num / 1000000000000 :
    num;
  return Math.round(btcAmount * 100_000_000);
}

export function parseZapReceiptAmount(zapReceipt: Event): number {
  const bolt11Tag = zapReceipt.tags.find(t => t[0] === "bolt11");
  if (bolt11Tag?.[1]) {
    const sats = parseBolt11Sats(bolt11Tag[1]);
    if (sats > 0) return sats;
  }
  const descTag = zapReceipt.tags.find(t => t[0] === "description");
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1]);
      const amountTag = zapRequest.tags?.find((t: string[]) => t[0] === "amount");
      if (amountTag?.[1]) return Math.floor(parseInt(amountTag[1]) / 1000);
    } catch {}
  }
  return 0;
}

export function getZapReceiptSender(zapReceipt: Event): string | null {
  const descTag = zapReceipt.tags.find(t => t[0] === "description");
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1]);
      return zapRequest.pubkey || null;
    } catch {}
  }
  return null;
}

export function getZapReceiptComment(zapReceipt: Event): string | null {
  const descTag = zapReceipt.tags.find(t => t[0] === "description");
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1]);
      return zapRequest.content || null;
    } catch {}
  }
  return null;
}

export interface ZapperInfo {
  pubkey: string;
  amount: number;
  comment: string | null;
  timestamp: number;
}

export function ZapReceiptsPopover({ eventId, zapAmount, zapCount, size = "default" }: { eventId: string; zapAmount: number; zapCount: number; size?: "default" | "compact" }) {
  const [open, setOpen] = useState(false);
  const [zappers, setZappers] = useState<ZapperInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const fetchZapReceipts = useCallback(async () => {
    if (fetched) return;
    setLoading(true);
    try {
      const relays = DEFAULT_RELAYS.slice(0, 3);
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [9735],
          "#e": [eventId],
          limit: 50,
        }),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000)),
      ]) as any[];

      const parsed: ZapperInfo[] = [];
      const seen = new Set<string>();
      for (const ev of events) {
        const sender = getZapReceiptSender(ev);
        const amount = parseZapReceiptAmount(ev);
        if (!sender || amount <= 0) continue;
        const key = `${sender}-${ev.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        parsed.push({
          pubkey: sender,
          amount,
          comment: getZapReceiptComment(ev),
          timestamp: ev.created_at,
        });
      }

      parsed.sort((a, b) => b.amount - a.amount);
      setZappers(parsed);
      setFetched(true);

      const pubkeys = Array.from(new Set(parsed.map(z => z.pubkey)));
      if (pubkeys.length > 0) {
        fetchProfilesCached(pubkeys);
      }
    } catch (err) {
      console.error("Failed to fetch zap receipts:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId, fetched]);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && !fetched) {
      fetchZapReceipts();
    }
  }, [fetched, fetchZapReceipts]);

  const displayText = zapAmount > 0 ? formatSats(zapAmount) : String(zapCount);
  const textClass = size === "compact"
    ? "text-[11px] -ml-0.5 mr-0.5 text-muted-foreground"
    : "text-[11px] sm:text-xs -ml-0.5 sm:-ml-1 mr-0.5 sm:mr-1 text-muted-foreground";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`${textClass} cursor-pointer`}
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-zap-receipts-${eventId}`}
        >
          {displayText}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 border-amber-500/20 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(4,4,10,0.97)]"
        side="top"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-display text-amber-700 dark:text-amber-400/90">Zap Receipts</p>
            <span className="text-xs font-mono text-amber-700 dark:text-amber-400/70">
              {zapAmount > 0 ? `${zapAmount.toLocaleString()} sats` : `${zapCount} zaps`}
            </span>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-4">
              <RelayOutpostInlineLoader className="w-4 h-4 text-amber-800/50 dark:text-amber-400/50" />
            </div>
          )}

          {!loading && fetched && zappers.length === 0 && (
            <p className="text-[11px] text-muted-foreground/50 text-center py-3">
              No zap receipts found on relays
            </p>
          )}

          {!loading && zappers.length > 0 && (
            <div className="space-y-0.5 max-h-64 overflow-y-auto">
              {zappers.map((zapper, idx) => (
                <ZapperRow key={`${zapper.pubkey}-${idx}`} zapper={zapper} />
              ))}
            </div>
          )}

          {!loading && zappers.length > 0 && (
            <div className="flex items-center justify-between pt-1.5 border-t border-amber-500/10 text-[11px]">
              <span className="text-muted-foreground/50">{zappers.length} zapper{zappers.length !== 1 ? "s" : ""}</span>
              <span className="text-amber-700 dark:text-amber-400/70 font-mono">{zappers.reduce((s, z) => s + z.amount, 0).toLocaleString()} sats total</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ZapperRow({ zapper }: { zapper: ZapperInfo }) {
  const { pubkey: myPubkey } = useNostrAuth();
  const isMe = !!myPubkey && myPubkey === zapper.pubkey;
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, zapper.pubkey), [zapper.pubkey]);
  const fallbackName = shortenNpub(formatNpub(zapper.pubkey));
  const displayName = profile ? (getDisplayName(profile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(profile);
  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(zapper.pubkey)}`; } catch { return "#"; }
  }, [zapper.pubkey]);

  useEffect(() => {
    fetchProfilesCached([zapper.pubkey]);
  }, [zapper.pubkey]);

  return (
    <Link href={profileUrl} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
      <div className={`flex items-center gap-2 py-1.5 px-1.5 rounded-md hover-elevate cursor-pointer ${isMe ? "bg-amber-500/10 ring-1 ring-amber-500/25" : ""}`} data-testid={`zapper-row-${zapper.pubkey}`}>
        <Avatar className="w-5 h-5 shrink-0 ring-1 ring-amber-500/20 border border-background">
          <AvatarImage src={avatarUrl} alt={displayName} data-testid={`img-zapper-avatar-${zapper.pubkey}`} />
          <AvatarFallback className="bg-amber-500/10 text-amber-800 dark:text-amber-400 font-bold text-[8px]">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-foreground/80 truncate block" data-testid={`text-zapper-name-${zapper.pubkey}`}>
            {displayName}
            {isMe && <span className="ml-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400/90">You</span>}
          </span>
          {zapper.comment && (
            <span className="text-[10px] text-muted-foreground/50 truncate block" data-testid={`text-zapper-comment-${zapper.pubkey}`}>{zapper.comment}</span>
          )}
        </div>
        <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400 shrink-0" data-testid={`text-zapper-amount-${zapper.pubkey}`}>{formatSats(zapper.amount)}</span>
      </div>
    </Link>
  );
}

export function ReactorAvatarRow({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const fallbackName = shortenNpub(formatNpub(pubkey));
  const displayName = profile ? (getDisplayName(profile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(profile);
  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(pubkey)}`; } catch { return "#"; }
  }, [pubkey]);

  useEffect(() => {
    fetchProfilesCached([pubkey]);
  }, [pubkey]);

  return (
    <Link href={profileUrl} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
      <div className="flex items-center gap-2 py-1 px-1 rounded-md hover-elevate cursor-pointer" data-testid={`reactor-row-${pubkey}`}>
        <Avatar className="w-5 h-5 shrink-0 ring-1 ring-brand/20 border border-background">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback className="bg-brand/10 text-brand font-bold text-[8px]">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-[11px] text-foreground/80 truncate" data-testid={`text-reactor-name-${pubkey}`}>{displayName}</span>
      </div>
    </Link>
  );
}

export function TopZapDetailContent({ pubkey, amount, message, emoji }: { pubkey: string; amount: number; message: string; emoji: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const fallbackName = shortenNpub(formatNpub(pubkey));
  const displayName = profile ? (getDisplayName(profile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(profile);
  const npub = useMemo(() => {
    try { return nip19.npubEncode(pubkey); } catch { return ""; }
  }, [pubkey]);

  return (
    <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        <Link href={npub ? `/profile/${npub}` : "#"} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <Avatar className="w-10 h-10 ring-2 ring-amber-500/30 dark:ring-amber-400/25 cursor-pointer transition-transform hover:scale-105">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="bg-amber-500/10 text-amber-800 dark:text-amber-400 font-bold text-xs">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex flex-col min-w-0">
          <Link href={npub ? `/profile/${npub}` : "#"} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <span className="text-sm font-semibold text-foreground hover:underline cursor-pointer truncate">{displayName}</span>
          </Link>
          <div className="flex items-center gap-1.5">
            {emoji && <span className="text-sm">{emoji}</span>}
            <BtcZapIcon className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{amount.toLocaleString()} sats</span>
          </div>
        </div>
      </div>
      {message && (
        <div className="rounded-lg bg-amber-500/5 dark:bg-amber-400/5 border border-amber-500/10 dark:border-amber-400/10 px-3.5 py-3">
          <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">{message}</p>
        </div>
      )}
      {!message && (
        <p className="text-xs text-muted-foreground/60 italic">No message attached to this zap</p>
      )}
    </div>
  );
}

export function TopZapperAvatars({ eventId, hasZaps }: { eventId: string; hasZaps: boolean }) {
  const topZappers = useTopZappers(eventId, hasZaps, 3);
  const [detailOpen, setDetailOpen] = useState(false);
  const isMobile = useIsMobile();

  if (topZappers.length === 0) return null;

  const [leader, ...rest] = topZappers;
  const leaderLabel = leader.message
    ? (leader.message.length > 24 ? leader.message.slice(0, 24) + "..." : leader.message)
    : null;

  const hasClickableContent = leader.message || leader.amount > 0;

  const detailContent = (
    <TopZapDetailContent
      pubkey={leader.pubkey}
      amount={leader.amount}
      message={leader.message}
      emoji={leader.emoji}
    />
  );

  const zapInfoRow = (
    <>
      {leader.emoji && <span className="text-[13px] shrink-0">{leader.emoji}</span>}
      <BtcZapIcon className="w-3 h-3 zap-leader-amount shrink-0" />
      <span className="text-[11px] sm:text-xs font-medium zap-leader-amount shrink-0">{formatCount(leader.amount)}</span>
      {leaderLabel && (
        <span className="text-[10px] sm:text-[11px] zap-leader-message truncate max-w-[80px] sm:max-w-[140px]">
          {leaderLabel}
        </span>
      )}
    </>
  );

  return (
    <div className="flex items-center justify-between px-2.5 sm:px-5 py-1.5" data-testid={`top-zappers-${eventId}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <TopZapperAvatar pubkey={leader.pubkey} size="leader" />
        {hasClickableContent ? (
          <>
            {isMobile ? (
              <>
                <button
                  className="flex items-center gap-1.5 min-w-0 cursor-pointer active:opacity-70 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setDetailOpen(true); }}
                  aria-label="View top zap details"
                >
                  {zapInfoRow}
                </button>
                <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
                  <SheetContent
                    side="bottom"
                    className="rounded-t-2xl border-t border-amber-500/15 dark:border-amber-400/10 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(12,10,24,0.98)] px-5 pt-3 pb-8 backdrop-blur-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SheetTitle className="sr-only">Top Zap Details</SheetTitle>
                    <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/20 mb-4" />
                    <div className="flex items-center gap-1.5 mb-4">
                      <BtcZapIcon className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                      <span className="text-xs font-display uppercase tracking-wider text-amber-600 dark:text-amber-400/90">Top Zap</span>
                    </div>
                    {detailContent}
                  </SheetContent>
                </Sheet>
              </>
            ) : (
              <Popover open={detailOpen} onOpenChange={setDetailOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="View top zap details"
                  >
                    {zapInfoRow}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 p-4 border-amber-500/15 dark:border-amber-400/10 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(12,10,24,0.98)] backdrop-blur-xl shadow-xl"
                  side="top"
                  align="start"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5 mb-3">
                    <BtcZapIcon className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                    <span className="text-xs font-display uppercase tracking-wider text-amber-600 dark:text-amber-400/90">Top Zap</span>
                  </div>
                  {detailContent}
                </PopoverContent>
              </Popover>
            )}
          </>
        ) : (
          zapInfoRow
        )}
      </div>
      {rest.length > 0 && (
        <div className="flex items-center -space-x-1.5 shrink-0 ml-2">
          {rest.map((z) => (
            <TopZapperAvatar key={z.pubkey} pubkey={z.pubkey} size="small" />
          ))}
        </div>
      )}
    </div>
  );
}

export function TopZapperAvatar({ pubkey, size = "small" }: { pubkey: string; size?: "leader" | "small" }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const fallbackName = shortenNpub(formatNpub(pubkey));
  const displayName = profile ? (getDisplayName(profile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(profile);
  const npub = useMemo(() => {
    try { return nip19.npubEncode(pubkey); } catch { return ""; }
  }, [pubkey]);

  const sizeClass = size === "leader"
    ? "w-6 h-6 sm:w-7 sm:h-7 ring-1 ring-amber-600/25 dark:ring-amber-400/20"
    : "w-5 h-5 sm:w-[22px] sm:h-[22px] ring-1 ring-border/30 dark:ring-border/20";

  const profileContent = useMemo(() => {
    if (!profile) return null;
    return getProfileContent(profile);
  }, [profile]);
  const nip05 = (profileContent as any)?.nip05 || null;
  const about = (profileContent as any)?.about || null;

  const avatarNode = (
    <Avatar className={`${sizeClass} border border-background shadow-sm cursor-pointer transition-transform hover:scale-110`} data-testid={`img-top-zapper-${pubkey}`}>
      <AvatarImage src={avatarUrl} alt={displayName} />
      <AvatarFallback className="bg-amber-500/10 text-amber-800 dark:text-amber-400 font-bold text-[7px]">
        {displayName.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );

  const avatarEl = npub ? (
    <Link href={`/profile/${npub}`} onClick={(e: React.MouseEvent) => e.stopPropagation()} data-testid={`link-top-zapper-${pubkey}`}>
      {avatarNode}
    </Link>
  ) : avatarNode;

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        {avatarEl}
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-72 p-0 border-0 bg-transparent shadow-none mention-hover-card"
        onClick={(e) => e.stopPropagation()}
        data-testid={`hover-card-zapper-${pubkey.slice(0, 8)}`}
      >
        <div
          className="relative rounded-xl overflow-hidden border border-amber-500/20"
          style={{ background: 'var(--mention-hover-solid-bg)', boxShadow: '0 8px 24px var(--mention-hover-shadow)' }}
        >
          <div className="absolute inset-0 mention-hover-radial pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-[1px] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent pointer-events-none" />
          <div className="relative z-10 p-3 space-y-2">
            <div className="flex items-center gap-2.5">
              <Link href={`/profile/${npub}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <Avatar className="w-10 h-10 ring-2 ring-amber-500/30 border-2 border-brand dark:border-[#0d0d2b] shrink-0 cursor-pointer">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="bg-amber-500/10 text-amber-800 dark:text-amber-400 text-sm font-bold">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link href={`/profile/${npub}`} className="no-underline min-w-0" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <p className="text-sm font-semibold text-foreground truncate hover:text-amber-600 dark:hover:text-amber-300 transition-colors cursor-pointer">
                      {displayName}
                    </p>
                  </Link>
                  <HoverCardTrustBadge pubkey={pubkey} />
                </div>
                {nip05 && (
                  <Nip05Badge nip05={nip05} pubkey={pubkey} className="mt-0.5" textClassName="text-[11px] text-amber-800/60 dark:text-amber-400/60" iconClassName="w-3 h-3" />
                )}
              </div>
            </div>
            {about && (
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed line-clamp-2">{about}</p>
            )}
            <VouchedBySection pubkey={pubkey} />
            <TrustedBySection pubkey={pubkey} />
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function ReactionDetailsPopover({ eventId, likeCount, trigger }: { eventId: string; likeCount: number; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { groups, loading, fetched, fetch: fetchReactions } = useReactionDetails(eventId);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && !fetched) {
      fetchReactions();
    }
  }, [fetched, fetchReactions]);

  const totalReactors = useMemo(() => {
    const seen = new Set<string>();
    for (const g of groups) {
      for (const r of g.reactors) seen.add(r.pubkey);
    }
    return seen.size;
  }, [groups]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <span onClick={(e) => e.stopPropagation()} data-testid={`button-reaction-details-${eventId}`}>
          {trigger}
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 border-brand/20 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(4,4,10,0.97)]"
        side="top"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-display text-brand dark:text-brand/90">Reactions</p>
            <span className="text-xs font-mono text-brand dark:text-brand/70">
              {likeCount} total
            </span>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-4">
              <RelayOutpostInlineLoader className="w-4 h-4 text-brand/50" />
            </div>
          )}

          {!loading && fetched && groups.length === 0 && (
            <p className="text-[11px] text-muted-foreground/50 text-center py-3">
              No reactions found on relays
            </p>
          )}

          {!loading && groups.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {groups.map((group) => (
                <div key={group.emoji} className="space-y-0.5">
                  <div className="flex items-center gap-2 px-1 pb-0.5 border-b border-brand/10">
                    {group.imageUrl ? (
                      <img src={group.imageUrl} alt={group.emoji} className="w-5 h-5 object-contain" loading="lazy" />
                    ) : (
                      <span className="text-base">{group.displayEmoji}</span>
                    )}
                    <span className="text-[11px] font-mono text-brand/70">{group.count}</span>
                  </div>
                  <div className="space-y-0">
                    {group.reactors.slice(0, 8).map((reactor) => (
                      <ReactorAvatarRow key={reactor.pubkey} pubkey={reactor.pubkey} />
                    ))}
                    {group.reactors.length > 8 && (
                      <span className="text-[10px] text-muted-foreground/50 px-1">+{group.reactors.length - 8} more</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && groups.length > 0 && (
            <div className="flex items-center justify-between pt-1.5 border-t border-brand/10 text-[11px]">
              <span className="text-muted-foreground/50">{totalReactors} reactor{totalReactors !== 1 ? "s" : ""}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

