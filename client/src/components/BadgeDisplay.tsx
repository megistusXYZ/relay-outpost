import { useState, useMemo, useCallback, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { Button } from "@/components/ui/button";
import { Award, ChevronDown, ChevronUp, User, Plus } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { acceptBadges, fetchProfileBadgesList } from "@/lib/nip58-badges";
import { useToast } from "@/hooks/use-toast";
import { useAcceptedBadgesCached } from "@/hooks/use-badges";
import type { ResolvedBadge } from "@/hooks/use-badges";

const SHOW_BADGES_KEY = "relay-outpost-show-badges";
const BADGES_CHANGED_EVENT = "relay-outpost-badges-changed";

function subscribeBadgesChange(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(BADGES_CHANGED_EVENT, handler);
  return () => window.removeEventListener(BADGES_CHANGED_EVENT, handler);
}

function getBadgesSnapshot(): boolean {
  try { return localStorage.getItem(SHOW_BADGES_KEY) === "true"; } catch { return false; }
}

export function useBadgesEnabled(): boolean {
  return useSyncExternalStore(subscribeBadgesChange, getBadgesSnapshot);
}

export function areBadgesEnabled(): boolean {
  return getBadgesSnapshot();
}

export function setBadgesEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SHOW_BADGES_KEY, enabled ? "true" : "false");
  } catch {}
  window.dispatchEvent(new CustomEvent(BADGES_CHANGED_EVENT));
}

function AwarderName({ pubkey }: { pubkey: string }) {
  const metadataEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const npub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return pubkey; } }, [pubkey]);
  const name = metadataEvent ? (getDisplayName(metadataEvent, npub.slice(0, 12) + "...") ?? npub.slice(0, 12) + "...") : npub.slice(0, 12) + "...";
  const avatar = metadataEvent ? getAvatarUrl(metadataEvent) : undefined;

  return (
    <Link href={`/profile/${npub}`} className="flex items-center gap-1 min-w-0 hover:underline">
      {avatar ? (
        <img src={avatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover shrink-0" />
      ) : (
        <span className="w-3.5 h-3.5 rounded-full bg-brand/20 shrink-0 flex items-center justify-center">
          <User className="w-2 h-2 text-brand/50" />
        </span>
      )}
      <span className="text-[10px] text-muted-foreground/70 truncate">{name}</span>
    </Link>
  );
}

function BadgeCard({ badge, showAccept, onAccept, accepting }: {
  badge: ResolvedBadge;
  showAccept?: boolean;
  onAccept?: (badge: ResolvedBadge) => void;
  accepting?: boolean;
}) {
  const def = badge.definition;
  const imgSrc = def.thumb || def.image;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/30 bg-card/50 hover:bg-card/80 transition-colors">
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={def.name}
          className="w-10 h-10 rounded-md object-cover shrink-0 border border-border/20"
          loading="lazy"
        />
      ) : (
        <div className="w-10 h-10 rounded-md bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
          <Award className="w-5 h-5 text-brand/60" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground truncate">{def.name}</span>
        </div>
        {def.description && (
          <p className="text-[11px] text-muted-foreground/60 line-clamp-2 mt-0.5">{def.description}</p>
        )}
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Awarded by</span>
          <AwarderName pubkey={badge.awarderPubkey} />
          {badge.awardedAt > 0 && (
            <>
              <span className="text-[9px] text-muted-foreground/30">·</span>
              <span className="text-[9px] text-muted-foreground/40">
                {formatDistanceToNow(new Date(badge.awardedAt * 1000), { addSuffix: true })}
              </span>
            </>
          )}
        </div>
      </div>
      {showAccept && onAccept && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 h-7 text-xs gap-1"
          onClick={() => onAccept(badge)}
          disabled={accepting}
        >
          <Plus className="w-3 h-3" />
          Accept
        </Button>
      )}
    </div>
  );
}

export function ProfileBadgesSection({ badges, pubkey, onRefresh }: {
  badges: ResolvedBadge[];
  pubkey: string;
  onRefresh?: () => void;
}) {
  const enabled = useBadgesEnabled();
  const [expanded, setExpanded] = useState(false);
  const { pubkey: myPubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [accepting, setAccepting] = useState(false);
  const isOwnProfile = myPubkey === pubkey;

  const accepted = useMemo(() => badges.filter(b => b.isAccepted), [badges]);
  const unaccepted = useMemo(() => badges.filter(b => !b.isAccepted), [badges]);

  const handleAccept = useCallback(async (badge: ResolvedBadge) => {
    if (!signer || !myPubkey) return;
    setAccepting(true);
    try {
      const existing = await fetchProfileBadgesList(myPubkey);
      const currentBadges = existing?.badges || [];
      const newEntry = { badgeRef: badge.badgeRef, awardEventId: badge.awardEventId || badge.award?.id || "" };
      const dedupedBadges = currentBadges.filter(
        b => !(b.badgeRef === newEntry.badgeRef && b.awardEventId === newEntry.awardEventId)
      );
      const allBadges = [
        ...dedupedBadges.map(b => ({ badgeRef: b.badgeRef, awardEventId: b.awardEventId })),
        newEntry,
      ];
      const result = await acceptBadges(signer, allBadges);
      if (result) {
        toast({ title: "Badge accepted", description: `${badge.definition.name} added to your profile` });
        onRefresh?.();
      } else {
        toast({ title: "Failed to accept badge", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to accept badge", variant: "destructive" });
    } finally {
      setAccepting(false);
    }
  }, [signer, myPubkey, toast]);

  const visibleBadges = useMemo(() => {
    if (isOwnProfile) return badges;
    return accepted;
  }, [isOwnProfile, badges, accepted]);

  if (!enabled || visibleBadges.length === 0) return null;

  const displayBadges = expanded ? visibleBadges : visibleBadges.slice(0, 3);

  return (
    <div id="badges" className="space-y-2 scroll-mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Award className="w-4 h-4 text-brand/70" />
          <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
            Badges ({visibleBadges.length})
          </span>
        </div>
        {visibleBadges.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-brand/70 hover:text-brand-strong flex items-center gap-0.5 transition-colors"
          >
            {expanded ? "Show less" : `Show all`}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {displayBadges.map((badge) => (
          <BadgeCard
            key={`${badge.badgeRef}:${badge.awardEventId}`}
            badge={badge}
            showAccept={isOwnProfile && !badge.isAccepted}
            onAccept={handleAccept}
            accepting={accepting}
          />
        ))}
      </div>
      {isOwnProfile && unaccepted.length > 0 && !expanded && (
        <p className="text-[10px] text-amber-500/70 pl-1">
          {unaccepted.length} pending badge{unaccepted.length > 1 ? "s" : ""} to accept
        </p>
      )}
    </div>
  );
}

export function BadgeIcons({ badges, maxVisible = 3, pubkey }: {
  badges: ResolvedBadge[];
  maxVisible?: number;
  pubkey?: string;
}) {
  const accepted = useMemo(() => badges.filter(b => b.isAccepted), [badges]);
  if (accepted.length === 0) return null;

  const visible = accepted.slice(0, maxVisible);
  const overflow = accepted.length - maxVisible;
  const npub = pubkey ? (() => { try { return nip19.npubEncode(pubkey); } catch { return null; } })() : null;

  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {visible.map((badge) => {
        const imgSrc = badge.definition.thumb || badge.definition.image;
        return imgSrc ? (
          <img
            key={`${badge.badgeRef}:${badge.awardEventId}`}
            src={imgSrc}
            alt={badge.definition.name}
            title={badge.definition.name}
            className="w-4 h-4 rounded-sm object-cover border border-border/20"
            loading="lazy"
          />
        ) : (
          <span
            key={`${badge.badgeRef}:${badge.awardEventId}`}
            title={badge.definition.name}
            className="w-4 h-4 rounded-sm bg-brand/10 border border-brand/20 flex items-center justify-center"
          >
            <Award className="w-2.5 h-2.5 text-brand/60" />
          </span>
        );
      })}
      {overflow > 0 && npub && (
        <Link
          href={`/profile/${npub}#badges`}
          className="text-[9px] text-muted-foreground/50 hover:text-brand transition-colors ml-0.5"
        >
          +{overflow}
        </Link>
      )}
      {overflow > 0 && !npub && (
        <span className="text-[9px] text-muted-foreground/50 ml-0.5">+{overflow}</span>
      )}
    </span>
  );
}

export function PostBadgeIcons({ pubkey }: { pubkey: string }) {
  const enabled = useBadgesEnabled();
  const badges = useAcceptedBadgesCached(pubkey);
  if (!enabled || badges.length === 0) return null;
  return <BadgeIcons badges={badges} maxVisible={3} pubkey={pubkey} />;
}
