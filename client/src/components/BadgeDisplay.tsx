import { useState, useMemo, useCallback, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { Button } from "@/components/ui/button";
import { Award, ChevronDown, ChevronUp, User, Plus, ArrowUp, ArrowDown, EyeOff } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { showBadgeOnProfile, acceptBadges } from "@/lib/nip58-badges";
import { besideName, moveShownBadge, hideShownBadge } from "@/lib/badge-events";
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

// On unless turned off (owner, 2026-10-06). It was off unless turned on, so
// almost nobody saw a badge — giving one was pointless. Only badges a person
// accepted ever show, so nothing appears on anyone without their say-so.
function getBadgesSnapshot(): boolean {
  try { return localStorage.getItem(SHOW_BADGES_KEY) !== "false"; } catch { return true; }
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
          Show on my profile
        </Button>
      )}
    </div>
  );
}

/**
 * Your own profile: put your badges in the order you want and hide any you'd
 * rather not show (owner, 2026-10-06 — badges-plan). The first one is what
 * shows beside your name. Saved to both profile lists.
 */
function ArrangeBadges({ accepted, onSaved, onCancel }: { accepted: ResolvedBadge[]; onSaved: () => void; onCancel: () => void }) {
  const { signer } = useNostrAuth();
  const { toast } = useToast();
  const [order, setOrder] = useState(() => accepted.map((b) => ({ badgeRef: b.badgeRef, awardEventId: b.awardEventId })));
  const [saving, setSaving] = useState(false);
  const byKey = useMemo(() => new Map(accepted.map((b) => [`${b.badgeRef}:${b.awardEventId}`, b])), [accepted]);

  const save = async () => {
    if (!signer) return;
    setSaving(true);
    try {
      if (await acceptBadges(signer, order)) {
        toast({ title: "Your badges are updated", description: order.length ? "The first one shows beside your name." : "No badges show on your profile now." });
        onSaved();
      } else {
        toast({ title: "Couldn't save your badges", description: "Nothing was changed. Try again in a moment.", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="arrange-badges">
      {order.length === 0 && <p className="text-sm text-muted-foreground">No badges will show on your profile.</p>}
      {order.map((o, i) => {
        const b = byKey.get(`${o.badgeRef}:${o.awardEventId}`);
        const src = b?.definition.thumb || b?.definition.image;
        return (
          <div key={`${o.badgeRef}:${o.awardEventId}`} className="flex items-center gap-2 rounded-lg border border-border p-2" data-testid={`arrange-badge-${i}`}>
            {src ? <img src={src} alt="" className="h-8 w-8 object-contain" /> : <Award className="h-6 w-6 text-brand" aria-hidden />}
            <span className="min-w-0 flex-1 truncate text-sm">{b?.definition.name ?? "Badge"}{i === 0 && <span className="ml-2 text-xs text-muted-foreground">Beside your name</span>}</span>
            <Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Move up" disabled={i === 0} onClick={() => setOrder((x) => moveShownBadge(x, i, -1))} data-testid={`arrange-up-${i}`}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Move down" disabled={i === order.length - 1} onClick={() => setOrder((x) => moveShownBadge(x, i, 1))} data-testid={`arrange-down-${i}`}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Hide from my profile" onClick={() => setOrder((x) => hideShownBadge(x, i))} data-testid={`arrange-hide-${i}`}><EyeOff className="h-4 w-4" /></Button>
          </div>
        );
      })}
      <div className="flex gap-2 pt-1">
        <Button className="min-h-[44px]" disabled={saving || !signer} onClick={() => void save()} data-testid="button-save-badge-order">{saving ? "Saving…" : "Save"}</Button>
        <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>Cancel</Button>
      </div>
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
  const [arranging, setArranging] = useState(false);
  const isOwnProfile = myPubkey === pubkey;

  const accepted = useMemo(() => badges.filter(b => b.isAccepted), [badges]);
  const unaccepted = useMemo(() => badges.filter(b => !b.isAccepted), [badges]);

  const handleAccept = useCallback(async (badge: ResolvedBadge) => {
    if (!signer || !myPubkey) return;
    setAccepting(true);
    try {
      const r = await showBadgeOnProfile(signer, myPubkey, { badgeRef: badge.badgeRef, awardEventId: badge.awardEventId || badge.award?.id || "" });
      if (r === "shown") {
        toast({ title: "On your profile", description: `${badge.definition.name} now shows on your profile.` });
        onRefresh?.();
      } else {
        toast({ title: "Couldn't add the badge", description: r === "unreachable" ? "Your relays didn't answer, so nothing was changed. Try again in a moment." : "Try again in a moment.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Couldn't add the badge", description: "Try again in a moment.", variant: "destructive" });
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
        <div className="flex items-center gap-1">
          {isOwnProfile && accepted.length > 0 && !arranging && (
            <Button size="sm" variant="ghost" className="min-h-[44px] text-xs" onClick={() => setArranging(true)} data-testid="button-arrange-badges">
              Edit
            </Button>
          )}
          {!arranging && visibleBadges.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="min-h-[44px] px-2 text-xs text-brand/80 hover:text-brand-strong flex items-center gap-0.5 transition-colors"
            >
              {expanded ? "Show less" : `Show all`}
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>
      {arranging ? (
        <ArrangeBadges accepted={accepted} onCancel={() => setArranging(false)} onSaved={() => { setArranging(false); onRefresh?.(); }} />
      ) : (
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
      )}
      {isOwnProfile && unaccepted.length > 0 && !expanded && !arranging && (
        <p className="text-[10px] text-amber-500/70 pl-1">
          {unaccepted.length} badge{unaccepted.length > 1 ? "s" : ""} waiting for you to show
        </p>
      )}
    </div>
  );
}

/**
 * Beside a name: the person's first badge only, and "+N" for the rest
 * (owner, 2026-10-06 — badges-plan). Three icons crowded the name.
 */
export function BadgeIcons({ badges, pubkey }: {
  badges: ResolvedBadge[];
  pubkey?: string;
}) {
  const accepted = useMemo(() => badges.filter(b => b.isAccepted), [badges]);
  const { first, more } = besideName(accepted);
  if (!first) return null;
  const npub = pubkey ? (() => { try { return nip19.npubEncode(pubkey); } catch { return null; } })() : null;
  const imgSrc = first.definition.thumb || first.definition.image;

  return (
    <span className="inline-flex items-center gap-0.5 shrink-0" data-testid="badge-icons">
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={first.definition.name}
          title={first.definition.name}
          className="w-4 h-4 rounded-sm object-contain"
          loading="lazy"
        />
      ) : (
        <span title={first.definition.name} className="w-4 h-4 rounded-sm bg-brand/10 border border-brand/20 flex items-center justify-center">
          <Award className="w-2.5 h-2.5 text-brand/60" />
        </span>
      )}
      {more > 0 && (npub ? (
        <Link href={`/profile/${npub}#badges`} className="text-[10px] text-muted-foreground hover:text-brand transition-colors ml-0.5" data-testid="badge-icons-more">
          +{more}
        </Link>
      ) : (
        <span className="text-[10px] text-muted-foreground ml-0.5" data-testid="badge-icons-more">+{more}</span>
      ))}
    </span>
  );
}

export function PostBadgeIcons({ pubkey }: { pubkey: string }) {
  const enabled = useBadgesEnabled();
  const badges = useAcceptedBadgesCached(pubkey);
  if (!enabled || badges.length === 0) return null;
  return <BadgeIcons badges={badges} pubkey={pubkey} />;
}
