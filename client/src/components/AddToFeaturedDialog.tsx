/**
 * One-tap curation: feature the post you're looking at on a relay you run.
 * Opened from the post menu and the ops Live Feed — pick a feed (or name a
 * new one), done. The append itself lives in lib/featured-append (freshest
 * edition, duplicate guard, copy-to-relay).
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import {
  getAdminOutposts,
  fetchFeedsForRelay,
  addToFeaturedFeed,
} from "@/lib/featured-append";
import { curationRowTitle, type CurationSet } from "@/lib/curation-set";
import { getOutpostMeta } from "@/lib/outpost-relays";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import { Plus, RefreshCw, Check } from "lucide-react";

function relayLabel(url: string): string {
  return getOutpostMeta(url)?.name || url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

export function AddToFeaturedDialog({
  event,
  open,
  onOpenChange,
  presetRelayUrl,
}: {
  event: Event;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Skip the relay step (the ops Live Feed already knows its relay). */
  presetRelayUrl?: string;
}) {
  const { toast } = useToast();
  const adminRelays = useMemo(() => getAdminOutposts(), []);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<CurationSet[] | null>(null);
  const [unreached, setUnreached] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setNewTitle("");
    setAddedTo(new Set());
    setRelayUrl(presetRelayUrl ?? (adminRelays.length === 1 ? adminRelays[0].url : null));
  }, [open, presetRelayUrl, adminRelays]);

  const loadFeeds = useCallback(async (url: string) => {
    setFeeds(null);
    setUnreached(false);
    try {
      setFeeds(await fetchFeedsForRelay(url));
    } catch {
      setUnreached(true);
      setFeeds([]);
    }
  }, []);

  useEffect(() => {
    if (open && relayUrl) loadFeeds(relayUrl);
  }, [open, relayUrl, loadFeeds]);

  const add = useCallback(async (target: { coord: string } | { newTitle: string }) => {
    if (!relayUrl) return;
    const busyKey = "coord" in target ? target.coord : "new";
    setBusyTarget(busyKey);
    try {
      const result = await addToFeaturedFeed({ relayUrl, target, event });
      if (result.ok) {
        setAddedTo((prev) => new Set(prev).add(busyKey));
        toast({
          title: `Featured in "${result.feedTitle}"`,
          description: result.copied ? "The relay now serves this post too." : undefined,
        });
        if ("newTitle" in target) {
          setNewTitle("");
          loadFeeds(relayUrl);
        }
      } else if (result.reason === "duplicate") {
        toast({ title: "Already featured", description: `This is already in "${result.feedTitle}".` });
      } else if (result.reason === "not-signed-in") {
        toast({ title: "Not signed in", description: "Sign in to curate feeds.", variant: "destructive" });
      } else {
        toast({ title: "Couldn't add", description: "The relay didn't take the update — try again.", variant: "destructive" });
      }
    } finally {
      setBusyTarget(null);
    }
  }, [relayUrl, event, toast, loadFeeds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="add-to-featured-dialog" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MagicStarIcon className="w-4 h-4 text-brand" />
            Add to Featured
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground truncate -mt-1">{curationRowTitle(event)}</p>

        {!relayUrl ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground/70">Which of your relays should feature this?</p>
            {adminRelays.map((r) => (
              <button
                key={r.url}
                onClick={() => setRelayUrl(r.url)}
                className="w-full text-left rounded-lg border border-border/25 bg-muted/5 px-3 py-2 text-sm hover:bg-muted/15 transition-colors"
                data-testid={`featured-relay-${r.url.replace(/\W+/g, "-")}`}
              >
                {relayLabel(r.url)}
              </button>
            ))}
          </div>
        ) : feeds === null ? (
          <div className="flex items-center justify-center py-6"><RelayOutpostInlineLoader className="w-5 h-5" /></div>
        ) : unreached ? (
          <div className="text-center py-4 space-y-2">
            <p className="text-sm text-muted-foreground">Couldn't reach the relay.</p>
            <Button size="sm" variant="outline" onClick={() => loadFeeds(relayUrl)}><RefreshCw className="w-3.5 h-3.5 mr-1" />Retry</Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {adminRelays.length > 1 && !presetRelayUrl && (
              <button className="text-[11px] text-muted-foreground/60 hover:text-foreground" onClick={() => setRelayUrl(null)}>
                ← {relayLabel(relayUrl)}
              </button>
            )}
            {feeds.map((f) => {
              const coord = `${f.pubkey}:${f.dTag}`;
              const done = addedTo.has(coord);
              return (
                <button
                  key={coord}
                  onClick={() => { if (!done) add({ coord }); }}
                  disabled={busyTarget !== null || done}
                  className={`w-full flex items-center justify-between gap-2 rounded-lg border border-border/25 px-3 py-2 text-left transition-colors ${done ? "bg-brand/5" : "bg-muted/5 hover:bg-muted/15"}`}
                  data-testid={`featured-feed-pick-${f.dTag}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{f.title}</span>
                    <span className="block text-[10px] text-muted-foreground/60">{f.items.length} item{f.items.length !== 1 ? "s" : ""}</span>
                  </span>
                  {busyTarget === coord ? (
                    <RelayOutpostInlineLoader className="w-4 h-4 shrink-0" />
                  ) : done ? (
                    <span className="flex items-center gap-1 text-xs text-brand shrink-0"><Check className="w-3.5 h-3.5" />Added</span>
                  ) : (
                    <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
            <div className="flex gap-2 pt-1">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={feeds.length === 0 ? "Name your first feed — e.g. Weekly Picks" : "New feed name"}
                data-testid="input-featured-new-name"
              />
              <Button
                onClick={() => add({ newTitle })}
                disabled={!newTitle.trim() || busyTarget !== null}
                data-testid="button-featured-create-add"
              >
                {busyTarget === "new" ? <RelayOutpostInlineLoader className="w-4 h-4" /> : "Create"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
