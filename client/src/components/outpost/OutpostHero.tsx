/**
 * The community page's head — one flat surface, the profile head's twin
 * (owner, 2026-10-02: "slick, clean, simple, Apple-like").
 *
 * Person→place: Follow/Message → Join/Invite; the counts line → members,
 * activity and who runs it; the Circle → the members' faces. What used to be
 * here as small print (operator credit, relay version, media host, tags, the
 * health badge) belongs to the About tab, where someone looking for it looks.
 *
 * Phones: the cover runs edge to edge under the transparent top bar; the
 * avatar overlaps its bottom edge; name, one quiet line, one row of actions.
 * The head measures its cover against the bar and tells the page, which
 * condenses the identity into the bar once the cover is gone (the same
 * mechanics as IdentityProfileLayout). Desktop: the cover is a rounded band,
 * and the head reads left to right — avatar, then name and line, actions on
 * the right — no card, no boxes.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { IdentityBanner, IdentityHead } from "@/components/identity/identity-shared";
import { IdentityCircleCard } from "@/components/profile/IdentityCircleCard";
import { activityStatus } from "@/components/profile/IdentityPresence";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useIsMobile } from "@/hooks/use-mobile";
import { displayNameWith, usePetnamesVersion } from "@/lib/petnames";
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
  operator,
  actions,
  onCoverState,
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
  /** Who runs it, as a name (linked) — drawn as "run by …" in the quiet line. */
  operator?: ReactNode;
  /** The one row: Join/Leave · Invite · ⋯ — handlers stay with the page. */
  actions: ReactNode;
  /** Where the cover is against the top bar (phones) — see IdentityProfileLayout. */
  onCoverState?: (state: { underBar: boolean; gone: boolean }) => void;
}) {
  usePetnamesVersion();
  const isMobile = useIsMobile();
  const title = displayNameWith("community", relayUrl, realName);
  const active = activityStatus(presence.lastActiveAt, Math.floor(Date.now() / 1000));

  const coverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const cover = coverRef.current;
    if (!isMobile || !cover || !onCoverState) return;
    let last = "";
    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = cover.getBoundingClientRect();
      const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0;
      const next = { underBar: r.top <= safeTop + 1, gone: r.bottom <= 68 + safeTop };
      const key = `${next.underBar}:${next.gone}`;
      if (key !== last) { last = key; onCoverState(next); }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      onCoverState({ underBar: false, gone: false });
    };
  }, [isMobile, onCoverState]);

  const quiet = (
    <p className="mt-1 flex items-center justify-center lg:justify-start flex-wrap gap-x-1.5 text-[13px] leading-snug text-muted-foreground" data-testid="hero-outpost-pulse">
      {presence.members !== undefined && (
        <span><span className="font-semibold text-foreground tabular-nums">{presence.members.toLocaleString()}</span> members</span>
      )}
      {presence.members !== undefined && active && <span className="text-muted-foreground/50" aria-hidden="true">·</span>}
      {active && <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />{active}</span>}
      {(presence.members !== undefined || active) && operator && <span className="text-muted-foreground/50" aria-hidden="true">·</span>}
      {operator && <span className="inline-flex items-center gap-1">run by {operator}</span>}
    </p>
  );
  const authGlyph = authRequired ? (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 shrink-0" title="Members only — the relay asks you to sign in" aria-label="Members only">
      <Lock className="w-3 h-3" />
    </span>
  ) : undefined;

  return (
    <div data-testid="outpost-hero">
      <div ref={coverRef}>
        <IdentityBanner variant={isMobile ? "hero" : "card"} src={bannerSrc} fallbackSrc={bannerFallbackSrc} blurBackdropSrc={avatarUrl} />
      </div>

      {isMobile ? (
        <div className="px-4">
          <IdentityHead avatarUrl={avatarUrl} title={title} inlineBadge={authGlyph}>
            {quiet}
          </IdentityHead>
          <div className="mt-3" data-testid="outpost-actions-row">{actions}</div>
        </div>
      ) : (
        <div className="flex items-start gap-4 px-1 -mt-10">
          <Avatar className="w-24 h-24 border-4 border-background shadow-lg shrink-0">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={title} />}
            <AvatarFallback className="text-2xl bg-brand/10 text-brand font-semibold">{title.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 pt-12">
            <h1 className="text-xl font-bold leading-tight break-words inline-flex items-center gap-1.5 max-w-full" data-testid="hero-outpost-name">
              <span className="min-w-0">{title}</span>
              {authGlyph}
            </h1>
            {quiet}
          </div>
          <div className="pt-12 shrink-0" data-testid="outpost-actions-row">{actions}</div>
        </div>
      )}

      {description && (
        <p className="mt-3 px-4 lg:px-1 text-sm text-foreground/85 leading-relaxed line-clamp-3 max-w-2xl text-center lg:text-left mx-auto lg:mx-0" data-testid="hero-outpost-description">{description}</p>
      )}

      {memberPubkeys.length >= 4 && (
        <div className="mt-4 px-4 lg:px-1">
          <IdentityCircleCard pubkeys={memberPubkeys} horizontal />
        </div>
      )}
    </div>
  );
}
