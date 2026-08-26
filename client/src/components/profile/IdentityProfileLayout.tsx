/**
 * The "living identity" desktop profile layout (viewer skin) — Chunk 1: the
 * two-column frame. It is purely PRESENTATIONAL: it reuses the profile page's
 * already-computed data (passed as `data`) and embeds the SAME tab content the
 * classic layout renders (passed as `children`) in the main column, so there is
 * one data layer, not a fork.
 *
 * MySpace *bones*, modern skin: segmented sections with quiet title bars, a
 * left rail (identity · contact · details · trust), a stats strip, and the post
 * stream. Built on design tokens so it reads in light AND dark. Restraint
 * budget: one accent, generous whitespace, no garish chrome.
 *
 * Later chunks fill the Circle (friends-in-common), conditional vouch wall, the
 * portfolio shelves, and the posting-activity heatmap. WoT is additive here —
 * the trust chip only shows when a tier is actually available.
 */
import type { ReactNode } from "react";
import { IdentitySection as Section, IdentityBanner, IdentityHead } from "@/components/identity/identity-shared";
import { useIsMobile } from "@/hooks/use-mobile";
import { Nip05Badge } from "@/components/Nip05Badge";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { ProfileLayoutSwitch } from "@/components/profile/ProfileLayoutSwitch";
import { LiveNowBanner } from "./LiveNowBanner";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { getPetname, usePetnamesVersion } from "@/lib/petnames";
import { PetnameDialog } from "@/components/PetnameDialog";
import { DetailLink, linkifyBio } from "@/components/profile/ProfileDetailLink";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { CalendarDays } from "lucide-react";

export interface IdentityProfileData {
  pubkey: string;
  npub: string;
  isOwnProfile: boolean;
  bannerSrc: string;
  /** Shown when the real banner fails to load. Stable per account. */
  bannerFallbackSrc?: string;
  avatarUrl?: string;
  displayName: string;
  /** Raw profile name — shown in the reveal caption + rename dialog. */
  realName: string;
  about?: string;
  /** Bio pre-rendered through the note renderer (nostr: mentions → @names, URLs
   *  linkified). Preferred over `about`; falls back to plain linkified text. */
  aboutNode?: ReactNode;
  nip05?: string;
  website?: string;
  lud16?: string;
  /** Seconds since epoch — shown as "Joined <month year>". */
  joinedAt?: number;
  followers?: number;
  following?: number;
  notes?: number;
  /** WoT tier (additive — chip hidden when absent or trust is off). */
  grapeRankTier?: string;
  wotEnabled: boolean;
}

// Section/banner/head visuals live in identity-shared.tsx — shared with the
// outpost hero so person and place wear one skin.


function CirclesAndCommunities({ circleSlot, communitiesSlot }: { circleSlot?: ReactNode; communitiesSlot?: ReactNode }) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"circle" | "communities">("circle");
  if (!circleSlot && !communitiesSlot) return null;
  const both = !!circleSlot && !!communitiesSlot;

  if (!isMobile || !both) {
    return (
      <>
        {circleSlot && <Section title="Circle">{circleSlot}</Section>}
        {communitiesSlot && <Section title="Communities">{communitiesSlot}</Section>}
      </>
    );
  }

  const active = view === "circle" ? circleSlot : communitiesSlot;
  return (
    <section className="rounded-xl border border-border/60 dark:border-white/[0.07] bg-card overflow-hidden shadow-sm shadow-black/[0.04] dark:shadow-none">
      <div className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-primary/[0.10] to-primary/[0.03] border-b border-border/50" role="tablist" aria-label="Circle or communities">
        {(["circle", "communities"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`text-[11px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 transition-colors ${
              view === key ? "text-brand/90" : "text-muted-foreground/50 hover:text-muted-foreground"
            }`}
            data-testid={`profile-people-tab-${key}`}
          >
            {key === "circle" ? "Circle" : "Communities"}
          </button>
        ))}
      </div>
      <div className="p-3">{active}</div>
    </section>
  );
}

export function IdentityProfileLayout({ data, actions, networkSlot, overflowSlot, circleSlot, communitiesSlot, vouchSlot, onZapLud16, children }: { data: IdentityProfileData; actions: ReactNode; networkSlot?: ReactNode; overflowSlot?: ReactNode; circleSlot?: ReactNode; communitiesSlot?: ReactNode; vouchSlot?: ReactNode; onZapLud16?: () => void; children: ReactNode }) {
  const joined = data.joinedAt ? new Date(data.joinedAt * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null;
  const showTrust = data.wotEnabled && !!data.grapeRankTier && data.grapeRankTier !== "none";
  // Same predicate LiveNowBanner uses, so this tracks exactly whether that
  // banner renders between the cover and the identity card below.
  const { getLiveStream } = useLiveStatus();
  const isLive = !!getLiveStream(data.pubkey);
  // Petname reveal + edit ("you call them X"). The identity card keeps the
  // REAL name as the headline — the page that verifies identity never hides
  // the claimed name; your private name lives on the line below it.
  usePetnamesVersion();
  const [petnameOpen, setPetnameOpen] = useState(false);
  const petname = getPetname("person", data.pubkey)?.name;

  return (
    // min-w-0 w-full: this container sits in a column-flex scroller, where a
    // block child grows to its content's MIN-CONTENT width instead of
    // shrinking (the min-width:auto flex trap this repo has hit before, on
    // inputs). Measured at 520px: the layout rendered 737px wide — banner,
    // live banner and buttons all bleeding past the right edge — because the
    // Circle/montage strips' unshrinkable rows set the min-content. With
    // min-w-0 the container honors the viewport and those strips scroll
    // inside themselves, which is what they were built to do.
    <div className="max-w-6xl w-full min-w-0 mx-auto px-4 py-5" data-testid="identity-profile-layout">
      {/* Banner — FILLS the band, edge to edge, on every width. A contained
          image with a blurred fill behind it was tried and reverted: it showed
          more of the picture but left the band looking framed rather than
          full-bleed, and the full-bleed band is the look. Cropping is the
          accepted cost. */}
      <IdentityBanner src={data.bannerSrc} fallbackSrc={data.bannerFallbackSrc} topRight={<ProfileLayoutSwitch />} />

      {/* Above the fold and above the grid, because a broadcast outranks
          everything else on the page while it is happening — and unlike a post,
          it is gone if you miss it. Renders nothing when they are not live. */}
      <LiveNowBanner pubkey={data.pubkey} className="mt-4" />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 mt-4">
        {/* ── Left rail ─────────────────────────────────────────── */}
        <aside className="space-y-4">
          {/* Identity — NOT clipped (overflow-visible) so the avatar can lift
              over the banner without its top being cropped. */}
          <div className="rounded-xl border border-border/60 dark:border-white/[0.07] bg-card p-3 shadow-sm shadow-black/[0.04] dark:shadow-none">
            {/* The -mt-14 lifts the avatar over the COVER IMAGE — the classic
                profile idiom. But when a LiveNowBanner renders, IT occupies
                the space between cover and card, and the lift lands the
                avatar on top of the live banner's title instead (owner
                screenshot at 520px: the avatar sat on "Get tickets…"). While
                live, the card keeps its natural position; the cover overlap
                is a look, not a load-bearing layout. */}
            <IdentityHead avatarUrl={data.avatarUrl} title={data.displayName} lift={!isLive}>
              {data.nip05 && (
                <Nip05Badge nip05={data.nip05} pubkey={data.pubkey} className="mt-0.5" textClassName="text-[11px] text-muted-foreground" iconClassName="w-3 h-3" />
              )}
              {!data.isOwnProfile && (
                <button
                  type="button"
                  onClick={() => setPetnameOpen(true)}
                  className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                  data-testid="profile-petname-line"
                >
                  <Pencil className="w-3 h-3" />
                  {petname
                    ? <>Real name <span className="text-foreground/85 font-medium">“{data.realName}”</span></>
                    : "Rename for you"}
                </button>
              )}
              {showTrust && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1">
                  <TrustTierGlyph tier={data.grapeRankTier as never} size="w-3 h-3" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-brand/90 capitalize">{data.grapeRankTier} in your network</span>
                </div>
              )}
            </IdentityHead>
          </div>

          {/* Contact — Follow/Message, with Network as a button right underneath. */}
          {/* "Your account", not "You" — the rail's Account node and this card
              are the same destination wearing two names otherwise, and the
              other-user title names what the card DOES ("Connect with …")
              rather than naming the person. */}
          <Section title={data.isOwnProfile ? "Your account" : `Connect with ${data.displayName}`}>
            <div className="flex flex-col gap-2">
              {actions}
              {networkSlot}
              {overflowSlot}
            </div>
          </Section>

          {/* People you follow who follow THIS profile — real social proof (not
              gameable shared-follows). Only shown when there's genuine overlap.
              Labeled "Circle" for brevity; the data is the un-gameable kind. */}
          {/* Circle + Communities share one slot on MOBILE (owner call,
              2026-08-18): a chip toggle, Circle preset — two stacked people
              sections cost a phone screen its calm. Desktop's rail has the
              room, so both render there and nothing hides. Either alone
              renders plain — a toggle with one option is a dead control. */}
          <CirclesAndCommunities circleSlot={circleSlot} communitiesSlot={communitiesSlot} />

          {/* Vouched by — signed endorsements (only shown when they exist). */}
          {vouchSlot && (
            <Section title="Vouched by">{vouchSlot}</Section>
          )}

          {/* Details */}
          {(data.about || data.website || data.lud16 || joined) && (
            <Section title="Details">
              <div className="space-y-2.5">
                {data.aboutNode ?? (data.about && <p className="text-sm text-foreground/85 whitespace-pre-wrap break-words leading-relaxed">{linkifyBio(data.about)}</p>)}
                <dl className="space-y-1.5 text-[13px]">
                  {data.website && <DetailLink url={data.website} />}
                  {data.lud16 && (
                    onZapLud16 ? (
                      // Tapping the Lightning address opens the Zap module — the
                      // address IS a "send sats here" affordance, so make it act like one.
                      <button
                        type="button"
                        onClick={onZapLud16}
                        className="group flex items-center gap-2 min-w-0 w-full text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-orange-500/5 transition-colors"
                        title={`Zap ${data.lud16}`}
                        data-testid="identity-lud16-zap"
                      >
                        <BtcZapIcon className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span className="text-muted-foreground group-hover:text-orange-500 truncate transition-colors">{data.lud16}</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <BtcZapIcon className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span className="text-muted-foreground truncate">{data.lud16}</span>
                      </div>
                    )
                  )}
                  {joined && (
                    <div className="flex items-center gap-2 min-w-0">
                      <CalendarDays className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                      <span className="text-muted-foreground">Joined {joined}</span>
                    </div>
                  )}
                </dl>
              </div>
            </Section>
          )}

          {/* Circle + Vouched-by land here in the next chunk (config lists them). */}
        </aside>

        {/* ── Main column ───────────────────────────────────────── */}
        <main className="min-w-0">
          {/* Headline stats (Following/Followers/Posts) now live at the top of
              the Presence card in `children`, so the identity summary is one
              block instead of two stacked cards showing "posts" twice. */}
          {children}
        </main>
      </div>
      {!data.isOwnProfile && (
        <PetnameDialog
          open={petnameOpen}
          onOpenChange={setPetnameOpen}
          kind="person"
          id={data.pubkey}
          realName={data.realName}
        />
      )}
    </div>
  );
}
