import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "@/lib/nostr";
import { prefetchProfileOnHover } from "@/hooks/use-prefetch-visible";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { KIND_METADATA, getProfileContent, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { ZapDialog } from "@/components/ZapDialog";
import { useToast } from "@/hooks/use-toast";
import { ActivityIndicator } from "@/components/ActivityIndicator";
import { ExternalLink, MessageCircle, Copy, BadgeCheck, X, Globe, Check } from "lucide-react";
import { nip19 } from "nostr-tools";
import { getSignalTier, getSignalTierColor, getSignalTierBg, type SignalTier } from "@/lib/graperank";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { copyNostrId } from "@/lib/clipboard-bridge";

function signalTierRingClass(tier: SignalTier): string {
  switch (tier) {
    case "strong": return "ring-emerald-500/60";
    case "moderate": return "ring-blue-500/50";
    case "low": return "ring-cyan-500/40";
    case "weak": return "ring-amber-500/40";
    case "flagged": return "ring-red-500/50";
    case "none": return "ring-border/30";
  }
}

export function ConstellationIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="5" r="1.5" fill="currentColor" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
      <circle cx="8" cy="19" r="1.5" fill="currentColor" />
      <circle cx="16" cy="19" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" opacity="0.5" />
      <line x1="12" y1="5" x2="5" y2="12" opacity="0.4" />
      <line x1="12" y1="5" x2="19" y2="12" opacity="0.4" />
      <line x1="5" y1="12" x2="8" y2="19" opacity="0.4" />
      <line x1="19" y1="12" x2="16" y2="19" opacity="0.4" />
      <line x1="8" y1="19" x2="16" y2="19" opacity="0.3" />
      <line x1="12" y1="5" x2="12" y2="12" opacity="0.25" />
      <line x1="5" y1="12" x2="19" y2="12" opacity="0.2" />
    </svg>
  );
}

function ProfileCardContent({
  pubkey,
  displayName,
  avatarUrl,
  nip05,
  about,
  lud16,
  npub,
  profileUrl,
  banner,
  website,
  onClose,
  influence,
}: {
  pubkey: string;
  displayName: string;
  avatarUrl: string | undefined;
  nip05: string | null;
  about: string | null;
  lud16: string | null;
  npub: string;
  profileUrl: string;
  banner: string | null;
  website: string | null;
  onClose: () => void;
  influence?: number | null;
}) {
  const { toast } = useToast();
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const shortNpub = `${npub.slice(0, 12)}...${npub.slice(-6)}`;

  const { wotEnabled } = useGrapeRankScores();
  const tier = wotEnabled && influence !== null && influence !== undefined ? getSignalTier(influence) : null;
  const scorePct = wotEnabled && influence !== null && influence !== undefined ? Math.round(influence * 100) : null;

  const websiteDisplay = useMemo(() => {
    if (!website) return null;
    try {
      const url = website.startsWith("http") ? website : `https://${website}`;
      return { href: url, label: new URL(url).hostname.replace(/^www\./, "") };
    } catch { return { href: website, label: website }; }
  }, [website]);

  const handleCopyNpub = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    copyNostrId(npub);
    setCopiedNpub(true);
    toast({ title: "Copied", description: "npub copied to clipboard" });
    setTimeout(() => setCopiedNpub(false), 2000);
  }, [npub, toast]);

  return (
    <div className="overflow-hidden">
      <div className="relative h-20 sm:h-16 overflow-hidden">
        {banner ? (
          <img src={banner} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-brand/50 via-brand/40 to-brand/50 dark:from-brand/60 dark:to-brand/60" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-white/20 to-transparent dark:from-[#0d0d14]/95 dark:via-[#0d0d14]/30 dark:to-transparent" />
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-brand/50 to-transparent" />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/30 dark:bg-black/50 text-white/90 hover:text-white hover:bg-black/50 backdrop-blur-sm"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          data-testid={`button-close-${pubkey.slice(0, 8)}`}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      <div className="relative px-4 pb-5 sm:pb-4">
        <div className="-mt-8 sm:-mt-7 mb-3 flex items-end gap-3">
          <Link href={profileUrl} data-testid={`link-expanded-profile-${pubkey.slice(0, 8)}`}>
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-brand/60 via-brand/50 to-brand/60 blur-sm" />
              <Avatar className="relative w-14 h-14 sm:w-12 sm:h-12 ring-2 ring-brand/60 border-[3px] border-white dark:border-[#0d0d14] shadow-lg shadow-brand/25 dark:shadow-brand/30" data-testid={`avatar-expanded-${pubkey.slice(0, 8)}`}>
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-gradient-to-br from-brand to-brand dark:from-brand/20 dark:to-brand/20 text-brand font-bold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {nip05 && (
                <div className="absolute -bottom-0.5 -right-0.5 bg-white dark:bg-[#0d0d14] rounded-full p-[2px] shadow-sm">
                  <BadgeCheck className="w-4 h-4 text-brand" />
                </div>
              )}
            </div>
          </Link>
          <div className="min-w-0 flex-1 pb-0.5">
            <div className="flex items-center gap-1.5">
              <Link href={profileUrl} className="no-underline min-w-0" data-testid={`text-expanded-name-${pubkey.slice(0, 8)}`}>
                <h3 className="text-sm font-bold truncate text-foreground hover:text-brand transition-colors" style={{ fontFamily: "var(--font-display)" }}>
                  {displayName}
                </h3>
              </Link>
              {scorePct !== null && tier && tier !== "none" && (
                <span className={`shrink-0 inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums border shadow-sm dark:shadow-none ${getSignalTierBg(tier)} ${getSignalTierColor(tier)}`}>
                  {scorePct}
                </span>
              )}
            </div>
            {nip05 && (
              <p className="text-[10px] text-brand/70 truncate flex items-center gap-0.5 font-mono" data-testid={`text-expanded-nip05-${pubkey.slice(0, 8)}`}>
                {nip05}
              </p>
            )}
            <ActivityIndicator pubkey={pubkey} />
          </div>
        </div>

        <button
          onClick={handleCopyNpub}
          className="flex items-center gap-1.5 mb-2.5 px-2.5 py-1.5 rounded-lg bg-brand/80 dark:bg-brand/30 border border-brand/50 dark:border-brand/20 hover:bg-brand/80 dark:hover:bg-brand/30 hover:border-brand/60 dark:hover:border-brand/30 transition-all w-full group cursor-pointer"
          data-testid={`button-expanded-copy-${pubkey.slice(0, 8)}`}
        >
          <span className="text-[10px] font-mono text-foreground/50 dark:text-muted-foreground/60 truncate flex-1 text-left">{shortNpub}</span>
          {copiedNpub ? (
            <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground/30 group-hover:text-brand transition-colors shrink-0" />
          )}
        </button>

        {about && (
          <p className="text-[11px] sm:text-xs text-foreground/60 dark:text-muted-foreground/70 line-clamp-3 sm:line-clamp-2 leading-relaxed mb-2.5" data-testid={`text-expanded-about-${pubkey.slice(0, 8)}`}>
            {about}
          </p>
        )}

        {(websiteDisplay || lud16) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {websiteDisplay && (
              <a
                href={websiteDisplay.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-brand dark:bg-brand/30 text-brand dark:text-brand/80 border border-brand/50 dark:border-brand/20 hover:bg-brand dark:hover:bg-brand/30 hover:border-brand/60 dark:hover:border-brand/30 transition-all"
                data-testid={`link-expanded-website-${pubkey.slice(0, 8)}`}
              >
                <Globe className="w-2.5 h-2.5 shrink-0" />
                {websiteDisplay.label}
              </a>
            )}
            {lud16 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowZapDialog(true);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-amber-50/80 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400/80 border border-amber-200/50 dark:border-amber-700/20 hover:bg-amber-100/80 dark:hover:bg-amber-900/20 hover:border-amber-300/60 dark:hover:border-amber-600/30 transition-all cursor-pointer"
                data-testid={`button-expanded-lud16-${pubkey.slice(0, 8)}`}
              >
                <BtcZapIcon className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate max-w-[140px]">{lud16}</span>
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-3 border-t border-brand/30 dark:border-brand/10">
          <Link
            href={profileUrl}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-gradient-to-r from-brand to-brand text-white hover:from-brand hover:to-brand shadow-sm shadow-brand/20 dark:shadow-brand/25 transition-all no-underline"
            data-testid={`button-expanded-view-${pubkey.slice(0, 8)}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Profile
          </Link>
          <Link
            href={`/messages?to=${npub}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-brand/80 dark:bg-brand/30 text-brand dark:text-brand/90 border border-brand/50 dark:border-brand/20 hover:bg-brand dark:hover:bg-brand/30 hover:border-brand/60 dark:hover:border-brand/30 transition-all no-underline"
            data-testid={`button-expanded-dm-${pubkey.slice(0, 8)}`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Message
          </Link>
          <button
            className={`h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg transition-all cursor-pointer ${lud16 ? "bg-amber-50/80 dark:bg-amber-950/20 text-amber-500 dark:text-amber-400/80 border border-amber-200/50 dark:border-amber-700/20 hover:bg-amber-100/80 dark:hover:bg-amber-900/20 hover:border-amber-300/60 dark:hover:border-amber-600/30" : "bg-muted/20 dark:bg-muted/5 text-muted-foreground/30 border border-border/20 dark:border-border/10 cursor-not-allowed"}`}
            onClick={(e) => {
              e.stopPropagation();
              if (lud16) {
                setShowZapDialog(true);
              } else {
                toast({ title: "No lightning address", description: "This user hasn't set up a lightning address." });
              }
            }}
            data-testid={`button-expanded-zap-${pubkey.slice(0, 8)}`}
          >
            <BtcZapIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {lud16 && (
        <ZapDialog
          open={showZapDialog}
          onOpenChange={setShowZapDialog}
          pubkey={pubkey}
          recipientName={displayName}
        />
      )}
    </div>
  );
}

function MobileSheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button")) return;
    startYRef.current = e.touches[0].clientY;
    currentYRef.current = 0;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    const diff = e.touches[0].clientY - startYRef.current;
    const clamped = Math.max(0, diff);
    currentYRef.current = clamped;
    setTranslateY(clamped);
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (currentYRef.current > 80) {
      setTranslateY(window.innerHeight);
      setTimeout(onClose, 200);
    } else {
      setTranslateY(0);
    }
  }, [isDragging, onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-[2px] transition-opacity duration-200"
        style={{ opacity: isDragging ? Math.max(0, 1 - translateY / 300) : 1 }}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="absolute bottom-0 inset-x-0 rounded-t-2xl border-t border-brand/20 dark:border-brand/30 bg-white dark:bg-[#0d0d14] backdrop-blur-xl shadow-2xl shadow-brand/15 dark:shadow-brand/20 overflow-hidden"
        style={{
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? "none" : "transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 8px) + 72px)",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Grab handle doubles as a tap-to-close target; the ✕ is the explicit escape
            (the sheet's drag handlers skip buttons, so both stay plain taps). */}
        <button
          type="button"
          onClick={onClose}
          className="flex w-full justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing"
          aria-label="Close"
        >
          <span className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-1.5 top-1.5 z-10 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground active:bg-muted/40 transition-colors"
          aria-label="Close"
          data-testid="constellation-sheet-close"
        >
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

function ConstellationBubble({
  pubkey,
  isExpanded,
  onToggle,
  connectionScores,
}: {
  pubkey: string;
  isExpanded: boolean;
  onToggle: (pubkey: string) => void;
  connectionScores?: Map<string, number> | null;
}) {
  const { isUserLive } = useLiveStatus();
  const isLive = isUserLive(pubkey);
  const metadataEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [showAbove, setShowAbove] = useState(false);
  const [cardShift, setCardShift] = useState(0);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);

  const fallbackName = shortenNpub(formatNpub(pubkey));
  const profileData = useMemo(() => {
    if (!metadataEvent) return null;
    return getProfileContent(metadataEvent);
  }, [metadataEvent]);

  const displayName = profileData?.display_name || profileData?.name || fallbackName;
  const avatarUrl = profileData?.picture;
  const nip05 = profileData?.nip05 ?? null;
  const about = profileData?.about ?? null;
  const lud16 = profileData?.lud16 ?? null;
  const banner = (profileData as any)?.banner ?? null;
  const website = (profileData as any)?.website ?? null;

  const { wotEnabled } = useGrapeRankScores();
  const influence = connectionScores?.get(pubkey) ?? null;
  const tier = wotEnabled && influence !== null ? getSignalTier(influence) : null;
  const hasSignalScore = tier !== null && tier !== "none";
  const scorePct = wotEnabled && influence !== null ? Math.round(influence * 100) : null;

  const npub = useMemo(() => {
    try { return nip19.npubEncode(pubkey); } catch { return pubkey; }
  }, [pubkey]);
  const profileUrl = `/profile/${npub}`;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!isExpanded || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isExpanded, isMobile]);

  useEffect(() => {
    if (!isExpanded || isMobile) {
      setCardShift(0);
      return;
    }
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const CARD_HEIGHT = 320;
      setShowAbove(spaceBelow < CARD_HEIGHT);
    }
    requestAnimationFrame(() => {
      if (cardRef.current) {
        const cardRect = cardRef.current.getBoundingClientRect();
        const EDGE_PAD = 12;
        let shift = 0;
        if (cardRect.right > window.innerWidth - EDGE_PAD) {
          shift = window.innerWidth - EDGE_PAD - cardRect.right;
        } else if (cardRect.left < EDGE_PAD) {
          shift = EDGE_PAD - cardRect.left;
        }
        setCardShift(shift);
      }
    });
  }, [isExpanded, isMobile]);

  const handleClose = useCallback(() => onToggle(pubkey), [onToggle, pubkey]);

  const cardProps = {
    pubkey,
    displayName,
    avatarUrl,
    nip05,
    about,
    lud16,
    npub,
    profileUrl,
    banner,
    website,
    onClose: handleClose,
    influence,
  };

  const avatarRingClass = isLive
    ? "ring-red-500/60 signal-ring-live shadow-[0_0_8px_1px_rgba(239,68,68,0.2)] shadow-lg"
    : isExpanded
      ? "ring-primary shadow-primary/30 shadow-lg"
      : hasSignalScore && tier
        ? signalTierRingClass(tier)
        : nip05
          ? "ring-primary/40"
          : "ring-border/30";

  return (
    <div ref={triggerRef} className="relative" data-testid={`bubble-${pubkey.slice(0, 8)}`}>
      <Button
        variant="ghost"
        className="flex flex-col items-center gap-1.5 h-auto p-1.5 rounded-xl"
        onClick={() => onToggle(pubkey)}
        onMouseEnter={() => prefetchProfileOnHover(pubkey)}
        data-testid={`button-bubble-${pubkey.slice(0, 8)}`}
      >
        <div className="relative">
          <Avatar
            className={`w-14 h-14 sm:w-16 sm:h-16 ring-2 transition-colors duration-200 border-2 border-background shadow-md ${avatarRingClass}`}
            data-testid={`avatar-bubble-${pubkey.slice(0, 8)}`}
          >
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="bg-brand/10 text-brand font-bold text-sm">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {isLive && (
            <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 px-1.5 py-0 rounded-full bg-red-500 text-white text-[7px] font-bold uppercase tracking-wider shadow-[0_0_4px_1px_rgba(239,68,68,0.4)] live-dot border border-red-400/50 z-10">
              LIVE
            </div>
          )}
          {!isLive && hasSignalScore && tier && scorePct !== null && (
            <div className={`absolute -bottom-1 -right-1 bg-background rounded-full px-1 py-0 border shadow-sm ${getSignalTierBg(tier)}`} data-testid={`badge-signal-${pubkey.slice(0, 8)}`}>
              <span className={`text-[8px] font-bold tabular-nums ${getSignalTierColor(tier)}`}>{scorePct}</span>
            </div>
          )}
          {!isLive && !hasSignalScore && nip05 && (
            <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5" data-testid={`badge-verified-${pubkey.slice(0, 8)}`}>
              <BadgeCheck className="w-3.5 h-3.5 text-brand" />
            </div>
          )}
        </div>
        <span className={`text-[11px] leading-tight text-center max-w-[72px] sm:max-w-[80px] truncate ${
          isExpanded ? "text-brand font-semibold" : "text-muted-foreground"
        }`} data-testid={`text-bubble-name-${pubkey.slice(0, 8)}`}>
          {displayName}
        </span>
      </Button>

      {isExpanded && isMobile && (
        <MobileSheet onClose={handleClose}>
          <ProfileCardContent {...cardProps} />
        </MobileSheet>
      )}

      {isExpanded && !isMobile && (
        <div
          ref={cardRef}
          className={`absolute z-50 left-1/2 w-[300px] rounded-xl border bg-white dark:bg-[#0d0d14] backdrop-blur-xl shadow-2xl shadow-brand/20 dark:shadow-brand/25 border-brand/30 dark:border-brand/25 animate-in fade-in-0 zoom-in-95 duration-200 overflow-hidden ${showAbove ? "bottom-full mb-2" : "top-full mt-2"}`}
          style={{ transform: `translateX(calc(-50% + ${cardShift}px))` }}
          data-testid={`card-expanded-${pubkey.slice(0, 8)}`}
        >
          <ProfileCardContent {...cardProps} />
        </div>
      )}
    </div>
  );
}

export function ConstellationView({ pubkeys, connectionScores }: { pubkeys: string[]; connectionScores?: Map<string, number> | null }) {
  const [expandedPubkey, setExpandedPubkey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback((pubkey: string) => {
    setExpandedPubkey((prev) => (prev === pubkey ? null : pubkey));
  }, []);

  useEffect(() => {
    if (!expandedPubkey) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setExpandedPubkey(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expandedPubkey]);

  return (
    <div
      ref={containerRef}
      className="flex flex-wrap justify-center gap-4 sm:gap-5 py-2"
      data-testid="container-constellation"
    >
      {pubkeys.map((pk) => (
        <ConstellationBubble
          key={pk}
          pubkey={pk}
          isExpanded={expandedPubkey === pk}
          onToggle={handleToggle}
          connectionScores={connectionScores}
        />
      ))}
    </div>
  );
}
