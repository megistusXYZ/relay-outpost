/**
 * The outpost's identity hero — the community page wearing the profile's
 * visual language (owner decision, 2026-08-15). Person→place translation:
 * Connect→Join/Invite, WoT chip→health badge, Presence→pulse (members +
 * bucketed activity — no post totals: the old "30 posts" was just the fetch
 * cap), Circle→member facepile. Relay-scoped controls (moderators, policy,
 * fees, NIPs) deliberately stay OUT of the hero — space-scope rule; they live
 * in the About tab. Composed from identity-shared so profiles and outposts
 * stay one skin.
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { IdentitySection, IdentityBanner, IdentityHead } from "@/components/identity/identity-shared";
import { IdentityCircleCard } from "@/components/profile/IdentityCircleCard";
import { activityStatus } from "@/components/profile/IdentityPresence";
import { displayNameWith, getPetname, usePetnamesVersion } from "@/lib/petnames";
import type { OutpostPresenceProps } from "@/lib/outpost-presence";

export function OutpostHero({
  relayUrl,
  realName,
  bannerSrc,
  bannerFallbackSrc,
  avatarUrl,
  authRequired,
  description,
  presence,
  memberPubkeys,
  healthBadge,
  operatorCredit,
  actions,
  metaRow,
  condenseControl,
}: {
  relayUrl: string;
  /** The relay's own NIP-11 name — petnames overlay it, never replace it here. */
  realName: string;
  bannerSrc?: string;
  bannerFallbackSrc?: string;
  avatarUrl?: string;
  authRequired?: boolean;
  description?: string;
  presence: OutpostPresenceProps;
  memberPubkeys: string[];
  healthBadge?: ReactNode;
  operatorCredit?: ReactNode;
  /** Join/Leave + Invite — handlers stay with the page; the hero only frames them. */
  actions: ReactNode;
  /** Quiet admin/meta leftovers (operator toggle etc.) — function preserved, demoted visually. */
  metaRow?: ReactNode;
  /** The ⌄ condense toggle — the collapse mechanics belong to the page. */
  condenseControl?: ReactNode;
}) {
  usePetnamesVersion();
  const title = displayNameWith("community", relayUrl, realName);
  const petnamed = !!getPetname("community", relayUrl) && title !== realName;
  const hostname = relayUrl.replace(/^wss?:\/\//, "").replace(/\/$/, "");
  const active = activityStatus(presence.lastActiveAt, Math.floor(Date.now() / 1000));

  return (
    <div data-testid="outpost-hero">
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <IdentityBanner src={bannerSrc} fallbackSrc={bannerFallbackSrc} blurBackdropSrc={avatarUrl} topRight={condenseControl} />
      </div>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="rounded-xl bg-card px-3 pb-3">
          <IdentityHead avatarUrl={avatarUrl} title={title}>
            {petnamed && (
              <span className="mt-0.5 text-[11px] text-muted-foreground/70">
                Real name <span className="text-foreground/85 font-medium">“{realName}”</span>
              </span>
            )}
            <span className="mt-0.5 text-[10px] font-mono text-muted-foreground/60 truncate max-w-full" data-testid="hero-outpost-hostname">{hostname}</span>
            <span className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
              {authRequired && (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-amber-500/40 text-amber-600 dark:text-amber-300 bg-amber-500/10 shrink-0">
                  <Lock className="w-2.5 h-2.5 mr-0.5" />
                  AUTH
                </Badge>
              )}
              {healthBadge}
              {operatorCredit}
            </span>
            {description && (
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground/75 leading-relaxed line-clamp-3 max-w-xl">{description}</p>
            )}
            {/* Pulse: positive claims only — members appear once a set actually
                loaded; the activity label is bucketed and calm; nothing here
                ever prints a number nobody measured. */}
            {(presence.members !== undefined || active) && (
              <span className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/70" data-testid="hero-outpost-pulse">
                {presence.members !== undefined && (
                  <span><span className="font-semibold text-foreground/85 tabular-nums">{presence.members.toLocaleString()}</span> members</span>
                )}
                {active && <span className="text-emerald-600/80 dark:text-emerald-400/80">{active}</span>}
              </span>
            )}
          </IdentityHead>

          <IdentitySection title={`Join ${title}`} className="mt-3">
            {actions}
          </IdentitySection>

          {memberPubkeys.length >= 4 && (
            <div className="mt-3">
              <IdentityCircleCard pubkeys={memberPubkeys} horizontal />
            </div>
          )}

          {metaRow && <div className="mt-3">{metaRow}</div>}
        </div>
      </div>
    </div>
  );
}
