/**
 * /marketplace — things for sale across the open network (NIP-99 kind 30402).
 *
 * Browse-only, deliberately: discovery and connection are ours; orders and
 * money belong to the marketplace apps (see components/ListingCard for the
 * whole boundary). Reach-honest like every browse surface — loading, goods,
 * genuinely quiet, or couldn't-reach-with-retry; never a confident empty.
 * Flagged sellers are excluded via the shared GrapeRank set: the one cheap,
 * positive scam signal we hold. Guests hit the standard browse wall.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Event } from "nostr-tools";
import { Tag, Search, X } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { GuestWall } from "@/components/GuestWall";
import { RelayOutpostLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import { ListingDialog } from "@/components/ListingCard";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { queryAnswered } from "@/lib/relay-reach";
import { FAST_RELAYS, fetchProfilesCached } from "@/lib/nostr";
import { isReportedEvent, isReportedPubkey } from "@/lib/spam-filter";
import { formatListingPrice, pickMarketListings, rankListingCategories, filterListings, KIND_CLASSIFIED_LISTING, LISTING_RELAYS, type Listing } from "@/lib/listing";

type PageState =
  | { status: "loading" }
  | { status: "ready"; listings: Listing[] }
  | { status: "unreachable" };

function MarketCard({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
  const image = listing.images[0];
  return (
    <button onClick={onOpen} className="text-left group/mcard min-w-0" data-testid={`market-card-${listing.id}`}>
      <div className="aspect-square w-full rounded-xl overflow-hidden bg-muted/40 ring-1 ring-border/40 flex items-center justify-center">
        {image ? (
          <img
            src={image}
            alt={listing.title}
            className={`w-full h-full object-cover transition-transform duration-500 group-hover/mcard:scale-105 ${listing.sold ? "grayscale opacity-70" : ""}`}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Tag className="w-7 h-7 text-brand/50" />
        )}
      </div>
      <p className="mt-2 text-sm font-medium tracking-tight text-foreground truncate">{listing.title}</p>
      <p className="text-xs text-muted-foreground tabular-nums truncate mt-0.5">
        {listing.sold ? "Sold" : listing.price ? formatListingPrice(listing.price) : ""}
      </p>
    </button>
  );
}

export default function Marketplace() {
  useDocumentTitle("Marketplace");
  const { pubkey: myPubkey } = useNostrAuth();
  const { flaggedPubkeys } = useGrapeRankScores();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [openListing, setOpenListing] = useState<Listing | null>(null);
  // The typical shop controls: search + category chips, both client-side
  // over the loaded set. Category vocabulary comes from sellers' own t tags.
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(
    () => (state.status === "ready" ? rankListingCategories(state.listings).slice(0, 12) : []),
    [state],
  );
  const visible = useMemo(
    () => (state.status === "ready" ? filterListings(state.listings, { query, category: category ?? undefined }) : []),
    [state, query, category],
  );

  const load = useCallback(() => {
    setState({ status: "loading" });
    const relays = Array.from(new Set([...LISTING_RELAYS, ...FAST_RELAYS.slice(0, 4)]));
    queryAnswered(relays, { kinds: [KIND_CLASSIFIED_LISTING], limit: 120 }, 10_000).then((res) => {
      if (res.events.length === 0 && !res.answered) {
        setState({ status: "unreachable" });
        return;
      }
      setState({
        status: "ready",
        listings: pickMarketListings(res.events as Event[], {
          flagged: flaggedPubkeys ?? undefined,
          // What YOU reported disappears from the shelf immediately — same
          // id-or-author rule the feeds use — without waiting for the
          // network-level flag to catch up.
          isReported: (e) => isReportedEvent(e.id) || isReportedPubkey(e.pubkey),
        }),
      });
    });
  }, [flaggedPubkeys]);
  useEffect(() => { if (myPubkey) load(); }, [load, myPubkey]);

  const sellers = useMemo(
    () => (state.status === "ready" ? Array.from(new Set(state.listings.map((l) => l.pubkey))) : []),
    [state],
  );
  useEffect(() => { if (sellers.length > 0) fetchProfilesCached(sellers.slice(0, 60)); }, [sellers]);

  if (!myPubkey) {
    return (
      <div className="px-4 py-6 max-w-2xl mx-auto">
        <GuestWall context="Browse things for sale across the open network" />
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-6xl mx-auto" data-testid="page-marketplace">
      <div className="mb-5">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-brand/70">
          <Tag className="w-3 h-3" />
          <span>Marketplace</span>
        </div>
        <h1 className="text-lg font-semibold tracking-tight mt-1">Things for sale, from people you can talk to</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Listings from across the open network. Buying happens with the seller or their marketplace — never through us.
        </p>
      </div>

      {state.status === "ready" && (
        <div className="mb-5 space-y-3">
          {/* Shop controls: one rounded search, one chip rail. Mobile gets the
              full-width field and a sideways-scrolling rail; desktop caps the
              field so the rail breathes beside the grid width. */}
          <div className="relative max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the shelves…"
              className="w-full h-10 rounded-full border border-border/60 bg-card pl-10 pr-9 text-sm outline-none focus:border-brand/40 transition-colors"
              data-testid="marketplace-search"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground/60 hover:text-foreground"
                aria-label="Clear search"
                data-testid="marketplace-search-clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }} data-testid="marketplace-categories">
              <button
                onClick={() => setCategory(null)}
                className={`shrink-0 h-8 px-3.5 rounded-full text-xs font-medium transition-colors ${category === null ? "bg-primary text-primary-foreground" : "border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                data-testid="marketplace-category-all"
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.tag}
                  onClick={() => setCategory(category === c.tag ? null : c.tag)}
                  className={`shrink-0 h-8 px-3.5 rounded-full text-xs font-medium transition-colors ${category === c.tag ? "bg-primary text-primary-foreground" : "border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                  data-testid={`marketplace-category-${c.tag}`}
                >
                  {c.tag}
                  <span className={`ml-1.5 tabular-nums ${category === c.tag ? "text-primary-foreground/70" : "text-muted-foreground/50"}`}>{c.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {state.status === "loading" && (
        <div className="flex flex-col items-center justify-center py-20" data-testid="marketplace-loading">
          <RelayOutpostLoader size="lg" label="Browsing the shelves..." />
        </div>
      )}
      {state.status === "unreachable" && (
        <div className="flex flex-col items-center gap-3 py-20 text-sm text-muted-foreground" data-testid="marketplace-unreachable">
          Couldn't reach the marketplace relays — nothing is known about what's for sale right now.
          <Button size="sm" variant="outline" onClick={load} data-testid="button-marketplace-retry">Try again</Button>
        </div>
      )}
      {state.status === "ready" && state.listings.length === 0 && (
        <p className="py-20 text-center text-sm text-muted-foreground" data-testid="marketplace-empty">
          The relays answered and the shelves are genuinely quiet right now.
        </p>
      )}
      {state.status === "ready" && state.listings.length > 0 && visible.length === 0 && (
        <p className="py-20 text-center text-sm text-muted-foreground" data-testid="marketplace-no-match">
          Nothing matches{query ? ` "${query}"` : ""}{category ? ` in ${category}` : ""} — try fewer words or another category.
        </p>
      )}
      {visible.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-6" data-testid="marketplace-grid">
          {visible.map((l) => (
            <MarketCard key={`${l.pubkey}:${l.dTag}`} listing={l} onOpen={() => setOpenListing(l)} />
          ))}
        </div>
      )}

      {openListing && (
        <ListingDialog listing={openListing} open onOpenChange={(o) => { if (!o) setOpenListing(null); }} />
      )}
    </div>
  );
}
