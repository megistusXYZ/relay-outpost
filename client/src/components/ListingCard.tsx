/**
 * NIP-99 listing surfaces (Conduit et al) — read-side marketplace interop.
 *
 * Three renderers over one parsed shape (lib/listing.ts):
 *  - ListingCard: the embed/feed card (same fixed-height, opaque,
 *    stopPropagation contract as GroupInviteCard/AudioSpaceCard).
 *  - ListingDialog: the in-app detail — image-led, quiet chrome, the
 *    product carries the frame. Actions hand off to things we already do
 *    well (DM the seller, view their profile); no checkout here, ever —
 *    orders and payment belong to the marketplace apps.
 *  - ProfileListingsStrip: a self-hiding "For sale" rail on profiles —
 *    renders NOTHING until listings actually resolve (reach-honest
 *    silence), so profiles without a shop carry zero clutter.
 */
import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useAttestations } from "@/hooks/use-attestations";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { Tag, MessageCircle, MapPin, ExternalLink, Flag, ShieldAlert, BadgeCheck, ChevronDown } from "lucide-react";
import { ReportDialog } from "@/components/ReportDialog";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTier, getSignalTierLabel } from "@/lib/graperank";
import { isReportedEvent, isReportedPubkey } from "@/lib/spam-filter";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { eventStore, fetchProfilesCached, FAST_RELAYS } from "@/lib/nostr";
import { getWriteRelays } from "@/lib/outbox";
import { queryAnswered } from "@/lib/relay-reach";
import { getDisplayName, getAvatarUrl, formatNpub, shortenNpub, KIND_METADATA } from "@/lib/nostr-helpers";
import { formatListingPrice, listingWebUrl, pickMarketListings, KIND_CLASSIFIED_LISTING, LISTING_RELAYS, type Listing } from "@/lib/listing";

function useSellerIdentity(pubkey: string) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { if (!profile) fetchProfilesCached([pubkey]); }, [pubkey, profile]);
  const fallback = shortenNpub(formatNpub(pubkey));
  const name = profile ? (getDisplayName(profile, fallback) ?? fallback) : fallback;
  let npub = pubkey;
  try { npub = nip19.npubEncode(pubkey); } catch {}
  return { name, avatarUrl: getAvatarUrl(profile ?? undefined), npub };
}

function VoucherChip({ pubkey }: { pubkey: string }) {
  const who = useSellerIdentity(pubkey);
  return (
    <span className="flex items-center gap-1.5 min-w-0 shrink-0">
      <Avatar className="w-4 h-4 border border-border/40">
        <AvatarImage src={who.avatarUrl} alt={who.name} />
        <AvatarFallback className="bg-brand/10 text-brand text-[7px] font-semibold">{who.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="text-[11px] font-medium truncate max-w-[110px]">{who.name}</span>
    </span>
  );
}

/**
 * Seller reputation — the un-gameable review panel. Vouches are signed
 * kind-31871 statements from identifiable people (positive-only by design),
 * surfaced with progressive disclosure: a count line, tap for quotes, the
 * profile for everything. Absence shows NOTHING — no seller is accused of
 * being unvouched (PersonBadges philosophy, same as the tier chip above).
 */
function SellerVouches({ pubkey, sellerNpub }: { pubkey: string; sellerNpub: string }) {
  const { attestations, fetched, fetch } = useAttestations(pubkey);
  useEffect(() => { fetch(); }, [fetch]);
  const [expanded, setExpanded] = useState(false);
  const vouches = useMemo(
    () => attestations.filter((a) => a.status !== "revoked" && a.status !== "rejected"),
    [attestations],
  );
  if (!fetched || vouches.length === 0) return null;
  return (
    <div className="border-t border-border/40 pt-3 space-y-2" data-testid="listing-vouches">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
        data-testid="listing-vouches-toggle"
      >
        <BadgeCheck className="w-3.5 h-3.5" />
        Vouched for by {vouches.length} {vouches.length === 1 ? "person" : "people"} on the network
        <ChevronDown className={`w-3.5 h-3.5 ml-auto text-muted-foreground/60 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-2.5">
          {vouches.slice(0, 3).map((v) => (
            <div key={v.eventId} className="rounded-lg bg-muted/30 dark:bg-muted/15 px-3 py-2" data-testid={`listing-vouch-${v.eventId.slice(0, 8)}`}>
              <div className="flex items-center gap-2">
                <VoucherChip pubkey={v.attesterPubkey} />
                <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                  {formatDistanceToNow(new Date(v.createdAt * 1000), { addSuffix: true })}
                </span>
              </div>
              {v.content.trim() && (
                <p className="mt-1 text-[12px] text-foreground/75 leading-relaxed line-clamp-2">{v.content.trim()}</p>
              )}
            </div>
          ))}
          <Link
            href={`/profile/${sellerNpub}`}
            className="block text-[11px] text-brand hover:text-brand-strong transition-colors"
            data-testid="listing-vouches-all"
          >
            See all vouches on their profile →
          </Link>
        </div>
      )}
    </div>
  );
}

function SoldChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      Sold
    </span>
  );
}

export function ListingDialog({ listing, open, onOpenChange }: { listing: Listing; open: boolean; onOpenChange: (o: boolean) => void }) {
  const seller = useSellerIdentity(listing.pubkey);
  const [imageIndex, setImageIndex] = useState(0);
  const image = listing.images[imageIndex] ?? listing.images[0];
  // Purchase happens on the WEB, not here — checkout belongs to the
  // marketplace apps. Seller's own declared page wins; else the Conduit shop
  // page for this exact listing (see lib/listing.listingWebUrl).
  const web = useMemo(() => listingWebUrl(listing), [listing]);
  const [reportOpen, setReportOpen] = useState(false);
  // Web-of-trust on the price tag — POSITIVE claims only (PersonBadges
  // philosophy): a chip for sellers the graph vouches for, a warning for
  // flagged ones, NOTHING for missing data — commerce must not paint
  // accusations on absence.
  const { getAuthorInfluence, flaggedPubkeys } = useGrapeRankScores();
  const sellerTier = getSignalTier(getAuthorInfluence(listing.pubkey));
  const sellerFlagged = flaggedPubkeys?.has(listing.pubkey) ?? false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden rounded-2xl" data-testid={`listing-dialog-${listing.id}`}>
        <div className="max-h-[85dvh] overflow-y-auto">
          {image && (
            <div className="relative bg-muted/40">
              <img
                src={image}
                alt={listing.title}
                className={`w-full aspect-[4/3] object-cover ${listing.sold ? "grayscale opacity-80" : ""}`}
                loading="lazy"
                decoding="async"
              />
              {listing.images.length > 1 && (
                <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {listing.images.slice(0, 8).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setImageIndex(i)}
                      aria-label={`Photo ${i + 1}`}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${i === imageIndex ? "bg-white" : "bg-white/40"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-brand/70">
                <Tag className="w-3 h-3" />
                <span>Listing</span>
                {listing.sold && <SoldChip />}
              </div>
              <DialogTitle className="text-xl font-semibold tracking-tight leading-snug">{listing.title}</DialogTitle>
              {listing.price && (
                <p className="text-lg font-medium tabular-nums" data-testid="listing-price">
                  {formatListingPrice(listing.price)}
                </p>
              )}
            </div>
            {listing.summary && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{listing.summary}</p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 tabular-nums">
              {listing.location && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{listing.location}</span>
              )}
              <span>{new Date(listing.publishedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
            <div className="flex items-center gap-3 pt-1 border-t border-border/40">
              <Link href={`/profile/${seller.npub}`} className="flex items-center gap-2.5 min-w-0 flex-1 pt-3 pb-1" data-testid="listing-seller">
                <Avatar className="w-8 h-8 border border-border/40">
                  <AvatarImage src={seller.avatarUrl} alt={seller.name} />
                  <AvatarFallback className="bg-brand/10 text-brand text-[10px] font-semibold">{seller.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{seller.name}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    Seller
                    {sellerFlagged ? (
                      <span className="inline-flex items-center gap-1 text-destructive font-medium" data-testid="listing-seller-flagged">
                        <ShieldAlert className="w-3 h-3" /> Flagged in your network
                      </span>
                    ) : (sellerTier === "strong" || sellerTier === "moderate") ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400" data-testid="listing-seller-trust">
                        <span className={`w-1.5 h-1.5 rounded-full ${sellerTier === "strong" ? "bg-emerald-500" : "bg-sky-500"}`} />
                        {getSignalTierLabel(sellerTier)}
                      </span>
                    ) : null}
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-2 mt-2 shrink-0">
                <Link
                  href={`/messages/${seller.npub}`}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-border/60 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
                  data-testid="listing-message-seller"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Message
                </Link>
                {!listing.sold && (
                  <a
                    href={web.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                    data-testid="listing-buy-link"
                  >
                    {web.via === "conduit" ? "Buy on Conduit" : "View listing"}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
            <SellerVouches pubkey={listing.pubkey} sellerNpub={seller.npub} />
            {/* Quiet by design: reporting should be findable, never shouting.
                Files a standard NIP-56 report on the listing event itself. */}
            <button
              onClick={() => setReportOpen(true)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              data-testid="listing-report"
            >
              <Flag className="w-3 h-3" />
              Report this listing
            </button>
          </div>
        </div>
        <ReportDialog open={reportOpen} onOpenChange={setReportOpen} event={listing.event} />
      </DialogContent>
    </Dialog>
  );
}

export function ListingCard({ listing, compact = false }: { listing: Listing; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const image = listing.images[0];
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`group/listing flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5 overflow-hidden hover:border-brand/40 transition-colors cursor-pointer text-left ${compact ? "h-[84px]" : "h-[100px]"}`}
        data-testid={`media-listing-${listing.id}`}
      >
        <div className={`shrink-0 rounded-lg overflow-hidden bg-muted/40 ring-1 ring-border/40 flex items-center justify-center ${compact ? "w-[64px] h-[64px]" : "w-[76px] h-[76px]"}`}>
          {image ? (
            <img src={image} alt={listing.title} className={`w-full h-full object-cover ${listing.sold ? "grayscale opacity-70" : ""}`} loading="lazy" decoding="async" />
          ) : (
            <Tag className="w-6 h-6 text-brand/50" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-brand/70">
            <Tag className="w-3 h-3 shrink-0" />
            <span>For sale</span>
            {listing.sold && <SoldChip />}
          </div>
          <div className="text-sm font-semibold tracking-tight text-foreground truncate mt-0.5">{listing.title}</div>
          <div className="flex items-center gap-2 mt-0.5 text-xs">
            {listing.price && <span className="font-medium tabular-nums text-foreground">{formatListingPrice(listing.price)}</span>}
            {listing.location && <span className="text-muted-foreground truncate">· {listing.location}</span>}
          </div>
        </div>
      </button>
      {open && <ListingDialog listing={listing} open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function ListingTile({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
  const image = listing.images[0];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className="w-[120px] shrink-0 text-left group/tile"
      data-testid={`listing-tile-${listing.id}`}
    >
      <div className="w-[120px] h-[120px] rounded-xl overflow-hidden bg-muted/40 ring-1 ring-border/40 flex items-center justify-center">
        {image ? (
          <img src={image} alt={listing.title} className={`w-full h-full object-cover transition-transform duration-500 group-hover/tile:scale-105 ${listing.sold ? "grayscale opacity-70" : ""}`} loading="lazy" decoding="async" />
        ) : (
          <Tag className="w-6 h-6 text-brand/50" />
        )}
      </div>
      <p className="mt-1.5 text-xs font-medium text-foreground truncate">{listing.title}</p>
      <p className="text-[11px] text-muted-foreground tabular-nums truncate">
        {listing.sold ? "Sold" : listing.price ? formatListingPrice(listing.price) : ""}
      </p>
    </button>
  );
}

/**
 * "For sale" rail on profiles. Reach-honest self-hiding: silence until
 * listings RESOLVE — an empty rail or a "no listings" line would be clutter
 * on the overwhelming majority of profiles that sell nothing.
 */
export function ProfileListingsStrip({ pubkey }: { pubkey: string }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [openListing, setOpenListing] = useState<Listing | null>(null);

  useEffect(() => {
    let cancelled = false;
    setListings([]);
    const relays = Array.from(new Set([...LISTING_RELAYS, ...getWriteRelays(pubkey, []), ...FAST_RELAYS.slice(0, 3)]));
    // 100, not a couple dozen: a merchant's rail is their whole catalog, and
    // the marketplace relay answers up to 100 per REQ (measured).
    queryAnswered(relays, { kinds: [KIND_CLASSIFIED_LISTING], authors: [pubkey], limit: 100 }, 8_000).then((res) => {
      if (cancelled) return;
      setListings(pickMarketListings(res.events as Event[], {
        isReported: (e) => isReportedEvent(e.id) || isReportedPubkey(e.pubkey),
      }));
    });
    return () => { cancelled = true; };
  }, [pubkey]);

  if (listings.length === 0) return null;
  return (
    <div className="mt-4" data-testid="profile-listings-strip">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-brand/70 mb-2">
        <Tag className="w-3 h-3" />
        <span>For sale</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1.5 -mx-1 px-1" style={{ scrollbarWidth: "thin" }}>
        {listings.map((l) => (
          <ListingTile key={`${l.pubkey}:${l.dTag}`} listing={l} onOpen={() => setOpenListing(l)} />
        ))}
      </div>
      {openListing && (
        <ListingDialog listing={openListing} open onOpenChange={(o) => { if (!o) setOpenListing(null); }} />
      )}
    </div>
  );
}
