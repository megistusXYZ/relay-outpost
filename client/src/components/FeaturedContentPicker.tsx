/**
 * Browse-and-pick for Featured feeds: paste an npub into the composer and this
 * sheet opens the person's catalog — posts, articles, videos, streams,
 * listings — old or new, each one tap from the feed. Fetches are per-lane and
 * reach-honest: a lane that never got an answer says so and offers Retry,
 * never "no content".
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import type { Event } from "nostr-tools";
import { pool, FAST_RELAYS, eventStore } from "@/lib/nostr";
import { LIVE_STREAM_RELAYS, KIND_LIVE_EVENT, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { LISTING_RELAYS, KIND_CLASSIFIED_LISTING } from "@/lib/listing";
import { eventToCurationItem, curationItemKey, curationRowTitle, type CurationItem } from "@/lib/curation-set";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Check, Plus, RefreshCw, MessageSquare, FileText, Film, Radio, Tag } from "lucide-react";
import { format } from "date-fns";

type Lane = "posts" | "articles" | "videos" | "streams" | "listings";

const LANES: { id: Lane; label: string; icon: typeof MessageSquare }[] = [
  { id: "posts", label: "Posts", icon: MessageSquare },
  { id: "articles", label: "Articles", icon: FileText },
  { id: "videos", label: "Videos", icon: Film },
  { id: "streams", label: "Streams", icon: Radio },
  { id: "listings", label: "Listings", icon: Tag },
];

function laneQuery(lane: Lane, pubkey: string): { relays: string[]; filters: object[] } {
  switch (lane) {
    case "posts":
      return { relays: FAST_RELAYS, filters: [{ kinds: [1], authors: [pubkey], limit: 30 }] };
    case "articles":
      return { relays: FAST_RELAYS, filters: [{ kinds: [30023], authors: [pubkey], limit: 30 }] };
    case "videos":
      return { relays: FAST_RELAYS, filters: [{ kinds: [21, 22, 34235, 34236], authors: [pubkey], limit: 30 }] };
    case "streams":
      // Streams are usually AUTHORED by a platform with the human p-tagged —
      // the same host-not-author rule the profile Shows tab follows.
      return {
        relays: LIVE_STREAM_RELAYS,
        filters: [
          { kinds: [KIND_LIVE_EVENT], authors: [pubkey], limit: 20 },
          { kinds: [KIND_LIVE_EVENT], "#p": [pubkey], limit: 20 },
        ],
      };
    case "listings":
      return { relays: [...LISTING_RELAYS, ...FAST_RELAYS], filters: [{ kinds: [KIND_CLASSIFIED_LISTING], authors: [pubkey], limit: 30 }] };
  }
}


type LaneState = { events: Event[]; loaded: boolean; unreached: boolean };

export function FeaturedContentPicker({
  pubkey,
  open,
  onOpenChange,
  onPick,
  pickedKeys,
}: {
  pubkey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the item AND its source event so the composer can rebroadcast without refetching. */
  onPick: (item: CurationItem, event: Event) => void;
  pickedKeys: Set<string>;
}) {
  const [lane, setLane] = useState<Lane>("posts");
  const [lanes, setLanes] = useState<Partial<Record<Lane, LaneState>>>({});
  const [profile, setProfile] = useState<Event | null>(null);

  useEffect(() => {
    if (!open) return;
    setLane("posts");
    setLanes({});
    setProfile(null);
    pool.querySync(FAST_RELAYS, { kinds: [0], authors: [pubkey], limit: 1 })
      .then((evs) => { if (evs[0]) setProfile(evs[0]); })
      .catch(() => {});
  }, [open, pubkey]);

  const loadLane = useCallback(async (l: Lane) => {
    setLanes((prev) => ({ ...prev, [l]: { events: prev[l]?.events || [], loaded: false, unreached: false } }));
    const { relays, filters } = laneQuery(l, pubkey);
    try {
      const results = await Promise.all(
        filters.map((f) => pool.querySync(relays, f as { kinds: number[] })),
      );
      const byId = new Map<string, Event>();
      for (const ev of results.flat()) {
        byId.set(ev.id, ev);
        eventStore.add(ev);
      }
      const events = [...byId.values()]
        .filter((ev) => l !== "streams" || ev.pubkey === pubkey || ev.tags.some((t) => t[0] === "p" && t[1] === pubkey))
        .sort((a, b) => b.created_at - a.created_at);
      setLanes((prev) => ({ ...prev, [l]: { events, loaded: true, unreached: false } }));
    } catch {
      setLanes((prev) => ({ ...prev, [l]: { events: [], loaded: true, unreached: true } }));
    }
  }, [pubkey]);

  useEffect(() => {
    if (open && !lanes[lane]) loadLane(lane);
  }, [open, lane, lanes, loadLane]);

  const state = lanes[lane];
  const name = useMemo(() => (profile ? getDisplayName(profile, pubkey.slice(0, 8)) : pubkey.slice(0, 8) + "…"), [profile, pubkey]);
  const avatar = useMemo(() => (profile ? getAvatarUrl(profile) : undefined), [profile]);
  const relayHint = laneQuery(lane, pubkey).relays[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col" data-testid="featured-content-picker">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {avatar ? (
              <img src={avatar} alt="" className="w-7 h-7 rounded-full object-cover ring-1 ring-border/30" />
            ) : (
              <span className="w-7 h-7 rounded-full bg-brand/10" />
            )}
            <span className="truncate">Feature content by {name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 flex-wrap">
          {LANES.map((l) => {
            const Icon = l.icon;
            const active = lane === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setLane(l.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${active ? "bg-accent text-accent-foreground border border-brand/25" : "text-muted-foreground hover:text-foreground hover:bg-muted/20 border border-transparent"}`}
                data-testid={`picker-lane-${l.id}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {l.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px] -mx-1 px-1" data-testid="picker-results">
          {!state || !state.loaded ? (
            <div className="flex items-center justify-center py-10">
              <RelayOutpostInlineLoader className="w-5 h-5" />
            </div>
          ) : state.unreached ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-sm text-muted-foreground">Couldn't reach the relays to look.</p>
              <Button size="sm" variant="outline" onClick={() => loadLane(lane)}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" />Retry
              </Button>
            </div>
          ) : state.events.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 text-center py-8">Nothing in this lane from {name}.</p>
          ) : (
            <ul className="space-y-1">
              {state.events.map((ev) => {
                const item = eventToCurationItem(ev, relayHint);
                const key = curationItemKey(item);
                const picked = pickedKeys.has(key);
                return (
                  <li key={ev.id}>
                    <button
                      onClick={() => { if (!picked) onPick(item, ev); }}
                      disabled={picked}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${picked ? "bg-brand/5 cursor-default" : "hover:bg-muted/20"}`}
                      data-testid={`picker-row-${ev.id.slice(0, 8)}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{curationRowTitle(ev)}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{format(new Date(ev.created_at * 1000), "MMM d, yyyy")}</p>
                      </div>
                      {picked ? (
                        <span className="flex items-center gap-1 text-xs text-brand shrink-0"><Check className="w-3.5 h-3.5" />Added</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"><Plus className="w-3.5 h-3.5" />Add</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
