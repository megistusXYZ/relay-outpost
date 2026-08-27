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
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { Tag, MessageCircle, MapPin, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { eventStore, fetchProfilesCached, FAST_RELAYS } from "@/lib/nostr";
import { getWriteRelays } from "@/lib/outbox";
import { queryAnswered } from "@/lib/relay-reach";
import { getDisplayName, getAvatarUrl, formatNpub, shortenNpub, KIND_METADATA } from "@/lib/nostr-helpers";
import { parseListing, formatListingPrice, listingWebUrl, KIND_CLASSIFIED_LISTING, LISTING_RELAYS, type Listing } from "@/lib/listing";

function useSellerIdentity(pubkey: string) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { if (!profile) fetchProfilesCached([pubkey]); }, [pubkey, profile]);
  const fallback = shortenNpub(formatNpub(pubkey));
  const name = profile ? (getDisplayName(profile, fallback) ?? fallback) : fallback;
  let npub = pubkey;
  try { npub = nip19.npubEncode(pubkey); } catch {}
  return { name, avatarUrl: getAvatarUrl(profile ?? undefined), npub };
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
                  <p className="text-[11px] text-muted-foreground">Seller</p>
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
          </div>
        </div>
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

function ListingTile({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
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
    queryAnswered(relays, { kinds: [KIND_CLASSIFIED_LISTING], authors: [pubkey], limit: 24 }, 8_000).then((res) => {
      if (cancelled) return;
      // Addressable: newest per d-tag wins. Active listings lead; sold trail.
      const byAddr = new Map<string, Event>();
      for (const e of res.events as Event[]) {
        const d = e.tags.find((t) => t[0] === "d")?.[1] ?? e.id;
        const prior = byAddr.get(d);
        if (!prior || e.created_at > prior.created_at) byAddr.set(d, e);
      }
      const parsed = [...byAddr.values()]
        .map(parseListing)
        .filter((l): l is Listing => l !== null)
        .sort((a, b) => (Number(a.sold) - Number(b.sold)) || (b.publishedAt - a.publishedAt));
      setListings(parsed);
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
