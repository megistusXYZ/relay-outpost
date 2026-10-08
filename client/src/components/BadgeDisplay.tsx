import { useState, useMemo, useCallback, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { IdentitySection } from "@/components/identity/identity-shared";
import { Award, ChevronDown, ChevronUp, User, Plus, ArrowUp, ArrowDown, EyeOff } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { showBadgeOnProfile, acceptBadges } from "@/lib/nip58-badges";
import { besideName, moveShownBadge, hideShownBadge, badgeForContext } from "@/lib/badge-events";
import { useBadgeCommunity } from "@/components/badges/badge-context";
import { FromCommunity } from "@/components/badges/FromCommunity";
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

function AwarderName({ pubkey, large }: { pubkey: string; large?: boolean }) {
  const metadataEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const npub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return pubkey; } }, [pubkey]);
  const name = metadataEvent ? (getDisplayName(metadataEvent, npub.slice(0, 12) + "...") ?? npub.slice(0, 12) + "...") : npub.slice(0, 12) + "...";
  const avatar = metadataEvent ? getAvatarUrl(metadataEvent) : undefined;

  return (
    <Link href={`/profile/${npub}`} className={`relative z-10 flex items-center min-w-0 hover:underline ${large ? "gap-1.5 min-h-[44px]" : "gap-1"}`}>
      {avatar ? (
        <img src={avatar} alt="" className={`${large ? "w-6 h-6" : "w-3.5 h-3.5"} rounded-full object-cover shrink-0`} />
      ) : (
        <span className={`${large ? "w-6 h-6" : "w-3.5 h-3.5"} rounded-full bg-brand/20 shrink-0 flex items-center justify-center`}>
          <User className={`${large ? "w-3.5 h-3.5" : "w-2 h-2"} text-brand/50`} />
        </span>
      )}
      <span className={`${large ? "text-sm font-medium text-foreground" : "text-[11px] text-muted-foreground"} truncate`}>{name}</span>
    </Link>
  );
}

/** One badge, large: its picture, its whole description, who gave it and when. */
function BadgeDetails({ badge, open, onOpenChange }: { badge: ResolvedBadge; open: boolean; onOpenChange: (open: boolean) => void }) {
  const def = badge.definition;
  const imgSrc = def.image || def.thumb;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-6" data-testid="badge-details">
        <div className="flex flex-col items-center text-center gap-3">
          {imgSrc ? (
            <img src={imgSrc} alt="" className="w-32 h-32 rounded-2xl object-contain bg-muted/40 border border-border/40" />
          ) : (
            <div className="w-32 h-32 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center">
              <Award className="w-12 h-12 text-brand/60" />
            </div>
          )}
          <DialogTitle className="text-lg font-semibold leading-snug [text-wrap:balance]">{def.name}</DialogTitle>
          {def.description ? (
            <DialogDescription className="text-sm text-muted-foreground whitespace-pre-line">{def.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">A badge</DialogDescription>
          )}
        </div>
        <div className="mt-1 border-t border-border/50 pt-3 flex flex-col items-center gap-0.5 text-sm">
          {def.community ? (
            <FromCommunity url={def.community} className="text-sm text-muted-foreground" />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0">Given by</span>
              <AwarderName pubkey={badge.awarderPubkey} large />
            </div>
          )}
          {badge.awardedAt > 0 && (
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(badge.awardedAt * 1000), { addSuffix: true })}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex items-start gap-3 p-2 -mx-1 rounded-lg hover:bg-muted/50 transition-colors">
      {/* The whole card opens the badge (owner, 2026-10-07). "Given by" and
          "Show on my profile" sit above this button and keep their own taps. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`About ${def.name}`}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="badge-card-open"
      />
      <BadgeDetails badge={badge} open={open} onOpenChange={setOpen} />
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={def.name}
          className="w-12 h-12 rounded-lg object-cover shrink-0 border border-border/30"
          loading="lazy"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
          <Award className="w-5 h-5 text-brand/60" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground truncate">{def.name}</span>
        </div>
        {def.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{def.description}</p>
        )}
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {/* A community's badge reads "from <community>"; a personal one names who gave it. */}
          {def.community ? (
            <FromCommunity url={def.community} className="text-[11px] text-muted-foreground" />
          ) : (
            <>
              <span className="text-[11px] text-muted-foreground">Given by</span>
              <AwarderName pubkey={badge.awarderPubkey} />
            </>
          )}
          {badge.awardedAt > 0 && (
            <>
              <span className="text-[11px] text-muted-foreground/50" aria-hidden="true">·</span>
              <span className="text-[11px] text-muted-foreground">
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
          className="relative z-10 shrink-0 min-h-[44px] text-xs gap-1"
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
    // The same title bar as Circle and Details (owner, 2026-10-07): it had a
    // heading of its own (an icon and grey caps) and looked out of place.
    <div id="badges" className="scroll-mt-4">
      <IdentitySection
        title="Badges"
        actions={(isOwnProfile && accepted.length > 0 && !arranging) || (!arranging && visibleBadges.length > 3) ? (
          <>
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
                {expanded ? "Show less" : `Show all ${visibleBadges.length}`}
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </>
        ) : undefined}
      >
      {arranging ? (
        <ArrangeBadges accepted={accepted} onCancel={() => setArranging(false)} onSaved={() => { setArranging(false); onRefresh?.(); }} />
      ) : (
      <div className="space-y-1">
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
        <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-500/70 pl-1">
          {unaccepted.length} badge{unaccepted.length > 1 ? "s" : ""} waiting for you to show
        </p>
      )}
      </IdentitySection>
    </div>
  );
}

/**
 * Beside a name: the person's first badge only, and "+N" for the rest
 * (owner, 2026-10-06 — badges-plan). Three icons crowded the name.
 */
export function BadgeIcons({ badges, pubkey, community }: {
  badges: ResolvedBadge[];
  pubkey?: string;
  /** Inside this community: only its own badge, and no "+N" (badgeForContext). */
  community?: string;
}) {
  const accepted = useMemo(() => badges.filter(b => b.isAccepted), [badges]);
  const general = besideName(accepted);
  const first = community
    ? badgeForContext(accepted.map((b) => ({ b, community: b.definition.community })), community)?.b
    : general.first;
  const more = community ? 0 : general.more;
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

export function PostBadgeIcons({ pubkey, linkMore = true }: { pubkey: string; /** False inside something that is already a link (a member row). */ linkMore?: boolean }) {
  const enabled = useBadgesEnabled();
  const badges = useAcceptedBadgesCached(pubkey);
  const community = useBadgeCommunity();
  if (!enabled || badges.length === 0) return null;
  return <BadgeIcons badges={badges} pubkey={linkMore ? pubkey : undefined} community={community} />;
}
