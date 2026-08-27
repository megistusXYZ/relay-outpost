/**
 * The public "Featured" tab on a relay's community page — the operator-curated
 * front door. Sets come from the relay itself (kind 30004), gated to the
 * relay's NIP-11 operator/moderators by relayFeaturedSets; every item renders
 * through the app's existing reach-honest embed cards, so a post, article,
 * listing, stream, or web link all look like themselves.
 */
import { useState, useEffect } from "react";
import { nip19, type Event } from "nostr-tools";
import { pool, FAST_RELAYS, eventStore } from "@/lib/nostr";
import { getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import type { Nip11Document } from "@/lib/nip11";
import {
  KIND_CURATION_SET,
  relayFeaturedSets,
  eventToCurationItem,
  curationItemKey,
  type CurationSet,
  type CurationItem,
} from "@/lib/curation-set";
import { NostrPost, EmbeddedAddressCard } from "@/components/NostrPost";
import { LinkPreviewCard } from "@/components/MediaRenderer";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";

export function useRelayFeaturedSets(relayUrl: string, nip11: Nip11Document | null) {
  const [sets, setSets] = useState<CurationSet[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    // No named operator yet (NIP-11 still loading, or the doc names none):
    // there is nothing to gate against, so don't ask. The nip11 dep re-runs
    // this the moment the doc lands.
    if (!nip11?.pubkey && !nip11?.moderators?.length) {
      setSets([]);
      setLoaded(!!nip11);
      return;
    }
    pool.querySync([relayUrl], { kinds: [KIND_CURATION_SET], limit: 100 })
      .then((events) => {
        if (cancelled) return;
        setSets(relayFeaturedSets(events, { pubkey: nip11?.pubkey, moderators: nip11?.moderators }));
      })
      .catch(() => { if (!cancelled) setSets([]); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [relayUrl, nip11]);

  return { sets, loaded };
}

/**
 * A featured PERSON: their recent published content, fetched live from the
 * relay (plus hints/defaults) — the feed follows them, not a snapshot.
 */
function FeaturedPersonBlock({ pubkey, relayUrl, relayHint }: { pubkey: string; relayUrl: string; relayHint?: string }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [unreached, setUnreached] = useState(false);
  const [profile, setProfile] = useState<Event | null>(null);

  useEffect(() => {
    let cancelled = false;
    const relays = [...new Set([relayUrl, ...(relayHint ? [relayHint] : []), ...FAST_RELAYS])];
    pool.querySync(relays, { kinds: [0], authors: [pubkey], limit: 1 })
      .then((evs) => { if (!cancelled && evs[0]) setProfile(evs[0]); })
      .catch(() => {});
    pool.querySync(relays, { kinds: [1, 30023, 21, 22, 34235, 34236, 30311, 30402], authors: [pubkey], limit: 12 })
      .then((evs) => {
        if (cancelled) return;
        const unique = [...new Map(evs.map((e) => [e.id, e])).values()]
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 4);
        setEvents(unique);
      })
      .catch(() => { if (!cancelled) { setUnreached(true); setEvents([]); } });
    return () => { cancelled = true; };
  }, [pubkey, relayUrl, relayHint]);

  const name = profile ? getDisplayName(profile, pubkey.slice(0, 8)) : pubkey.slice(0, 8) + "…";
  const avatar = profile ? getAvatarUrl(profile) : undefined;

  return (
    <div className="rounded-xl border border-border/25 p-3 space-y-3" data-testid={`featured-person-${pubkey.slice(0, 8)}`}>
      <div className="flex items-center gap-2.5">
        {avatar ? (
          <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-border/30" />
        ) : (
          <span className="w-8 h-8 rounded-full bg-brand/10" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-[10px] font-mono uppercase tracking-wider text-brand/60">Featured creator</p>
        </div>
      </div>
      {events === null ? (
        <p className="text-xs text-muted-foreground/60">Loading their latest…</p>
      ) : unreached ? (
        <p className="text-xs text-muted-foreground/60">Couldn't reach the relays to load their content.</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">Nothing published from them where we looked.</p>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            ev.kind < 30000
              ? <NostrPost key={ev.id} event={ev} />
              : <FeaturedItem key={ev.id} item={eventToCurationItem(ev, relayUrl)} relayUrl={relayUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A featured POST is a real post, not a quote: once the event resolves it
 * renders through NostrPost — the full card with media, replies, reposts,
 * likes and zaps (owner call: featured content must carry its engagement).
 * Loading keeps the slot's shape; an unreached fetch says so and retries.
 */
function FeaturedNoteCard({ id, relays }: { id: string; relays: string[] }) {
  const [event, setEvent] = useState<Event | null>(() => {
    const cached = eventStore.getByFilters({ ids: [id] });
    return cached && cached.length > 0 ? (cached[0] as Event) : null;
  });
  const [unreached, setUnreached] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (event) return;
    let cancelled = false;
    setUnreached(false);
    pool.querySync([...new Set([...relays, ...FAST_RELAYS])], { ids: [id] })
      .then((evs) => {
        if (cancelled) return;
        if (evs[0]) { eventStore.add(evs[0]); setEvent(evs[0] as Event); }
        else setUnreached(true);
      })
      .catch(() => { if (!cancelled) setUnreached(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nonce]);

  if (event) return <NostrPost event={event} />;
  if (unreached) {
    return (
      <button
        type="button"
        onClick={() => setNonce((n) => n + 1)}
        className="w-full rounded-xl border border-dashed border-border/30 px-4 py-6 text-center text-xs text-muted-foreground/60 hover:text-foreground"
        data-testid={`featured-note-retry-${id.slice(0, 8)}`}
      >
        Couldn't load this featured post — tap to retry
      </button>
    );
  }
  return <div className="h-28 animate-pulse rounded-xl border border-border/20 bg-muted/10" />;
}

function FeaturedItem({ item, relayUrl }: { item: CurationItem; relayUrl: string }) {
  if (item.type === "url") {
    return <LinkPreviewCard url={item.url} />;
  }
  if (item.type === "person") {
    return <FeaturedPersonBlock pubkey={item.pubkey} relayUrl={relayUrl} relayHint={item.relayHint} />;
  }
  const relays = item.relayHint ? [relayUrl, item.relayHint] : [relayUrl];
  if (item.type === "note") {
    return <FeaturedNoteCard id={item.id} relays={relays} />;
  }
  return (
    <EmbeddedAddressCard
      kind={item.kind}
      pubkey={item.pubkey}
      identifier={item.identifier}
      relays={relays}
      encoded={nip19.naddrEncode({ kind: item.kind, pubkey: item.pubkey, identifier: item.identifier, relays })}
    />
  );
}

export function RelayFeaturedFeed({
  sets,
  relayUrl,
  activeCoord,
  onSelectFeed,
}: {
  sets: CurationSet[];
  relayUrl: string;
  /** Lifted selection — the tab's options sheet and the chips drive the same state. */
  activeCoord: string | null;
  onSelectFeed: (coord: string) => void;
}) {
  // One feed shown at a time; selection is by coordinate so a republished
  // edition keeps the reader where they were.
  const active = sets.find((s) => `${s.pubkey}:${s.dTag}` === activeCoord) || sets[0];
  if (!active) return null;

  return (
    <div className="space-y-4 max-w-2xl mx-auto" data-testid="relay-featured-feed">
      {sets.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="featured-feed-chips">
          {sets.map((set) => {
            const coord = `${set.pubkey}:${set.dTag}`;
            const isActive = set === active;
            return (
              <button
                key={coord}
                onClick={() => onSelectFeed(coord)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isActive ? "bg-accent text-accent-foreground border border-brand/25" : "text-muted-foreground hover:text-foreground hover:bg-muted/20 border border-border/20"}`}
                data-testid={`featured-chip-${set.dTag}`}
              >
                {set.title}
              </button>
            );
          })}
        </div>
      )}

      <section key={`${active.pubkey}:${active.dTag}`} data-testid={`featured-set-${active.dTag}`}>
        {active.image && (
          <img
            src={active.image}
            alt=""
            loading="lazy"
            className="w-full aspect-[3/1] object-cover rounded-xl ring-1 ring-border/20 mb-3"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <MagicStarIcon className="w-3.5 h-3.5 text-brand/70" />
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-brand/70">Featured</span>
          </div>
          <h2 className="text-lg font-semibold tracking-tight mt-1">{active.title}</h2>
          {active.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{active.description}</p>
          )}
        </div>
        <div className="space-y-3">
          {active.items.map((item, i) => (
            <FeaturedItem
              key={`${i}-${curationItemKey(item)}`}
              item={item}
              relayUrl={relayUrl}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
