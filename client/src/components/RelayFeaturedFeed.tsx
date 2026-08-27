/**
 * The public "Featured" tab on a relay's community page — the operator-curated
 * front door. Sets come from the relay itself (kind 30004), gated to the
 * relay's NIP-11 operator/moderators by relayFeaturedSets; every item renders
 * through the app's existing reach-honest embed cards, so a post, article,
 * listing, stream, or web link all look like themselves.
 */
import { useState, useEffect } from "react";
import { nip19 } from "nostr-tools";
import { pool } from "@/lib/nostr";
import type { Nip11Document } from "@/lib/nip11";
import {
  KIND_CURATION_SET,
  relayFeaturedSets,
  type CurationSet,
  type CurationItem,
} from "@/lib/curation-set";
import { EmbeddedNote, EmbeddedAddressCard } from "@/components/NostrPost";
import { LinkPreviewCard } from "@/components/MediaRenderer";
import { Sparkles } from "lucide-react";

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

function FeaturedItem({ item, relayUrl }: { item: CurationItem; relayUrl: string }) {
  if (item.type === "url") {
    return <LinkPreviewCard url={item.url} />;
  }
  const relays = item.relayHint ? [relayUrl, item.relayHint] : [relayUrl];
  if (item.type === "note") {
    return (
      <EmbeddedNote
        eventId={item.id}
        encoded={nip19.neventEncode({ id: item.id, relays })}
        relays={relays}
      />
    );
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

export function RelayFeaturedFeed({ sets, relayUrl }: { sets: CurationSet[]; relayUrl: string }) {
  return (
    <div className="space-y-8 max-w-2xl mx-auto" data-testid="relay-featured-feed">
      {sets.map((set) => (
        <section key={`${set.pubkey}:${set.dTag}`} data-testid={`featured-set-${set.dTag}`}>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-brand/70" />
              <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-brand/70">Featured</span>
            </div>
            <h2 className="text-lg font-semibold tracking-tight mt-1">{set.title}</h2>
            {set.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{set.description}</p>
            )}
          </div>
          <div className="space-y-3">
            {set.items.map((item, i) => (
              <FeaturedItem
                key={`${i}-${item.type === "url" ? item.url : item.type === "note" ? item.id : `${item.kind}:${item.identifier}`}`}
                item={item}
                relayUrl={relayUrl}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
