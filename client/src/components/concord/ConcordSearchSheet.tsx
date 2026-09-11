/**
 * Search a group chat: the messages this device has opened, in every room,
 * matched on the words you type (concord-search). Nothing leaves the device.
 * Tapping a result jumps to the message.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, Hash, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getCachedMessages, type StoredCommunity } from "@/lib/concord/concord-keys";
import { searchGroup, type SearchHit, type SearchRoom } from "@/lib/concord/concord-search";
import { useConcordProfile } from "@/components/concord/ConcordIdentity";
import { formatCompactTime } from "@/lib/time";

const SHOWN = 50;

export function ConcordSearchSheet({ open, onOpenChange, community, rooms, onJump }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  community: StoredCommunity;
  /** The rooms to search, as the room list shows them. */
  rooms: { id: string; name: string }[];
  onJump: (hit: SearchHit) => void;
}) {
  const { pubkey } = useNostrAuth();
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<SearchRoom[] | null>(null);
  const roomKey = rooms.map((r) => `${r.id}:${r.name}`).join(",");

  // Read fresh each time it opens: messages keep arriving while it's closed.
  useEffect(() => {
    if (!open || !pubkey) return;
    let live = true;
    setLoaded(null);
    Promise.all(rooms.map(async (r) => ({ id: r.id, name: r.name, messages: await getCachedMessages(pubkey, community.community_id, r.id) })))
      .then((all) => { if (live) setLoaded(all); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roomKey covers `rooms`
  }, [open, pubkey, community.community_id, roomKey]);
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const hits = useMemo(() => (loaded ? searchGroup(loaded, query, { limit: SHOWN }) : []), [loaded, query]);
  const searched = query.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[85dvh] flex flex-col gap-3" data-testid="group-search">
        {/* pr-8 keeps a long group name clear of the close button. */}
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-base min-w-0">
            <Search className="w-4 h-4 text-brand shrink-0" /> <span className="truncate min-w-0">Search {community.name}</span>
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages"
          aria-label="Search messages"
          className="h-11 md:h-9 text-sm"
          data-testid="input-group-search"
        />
        <p className="text-[11px] text-muted-foreground/60 -mt-1">Searches the messages this device has opened. Nothing is sent anywhere.</p>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-0.5" data-testid="group-search-results">
          {!loaded ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground/60">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading messages…
            </div>
          ) : !searched ? null : hits.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground/60">No messages match “{query.trim()}”.</p>
          ) : (
            hits.map((h) => <SearchResultRow key={`${h.roomId}:${h.msg.id}`} hit={h} showRoom={rooms.length > 1} onSelect={() => onJump(h)} />)
          )}
        </div>
        {searched && hits.length >= SHOWN && (
          <p className="text-[11px] text-muted-foreground/60">Showing the {SHOWN} newest. Add a word to narrow it down.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SearchResultRow({ hit, showRoom, onSelect }: { hit: SearchHit; showRoom: boolean; onSelect: () => void }) {
  const { name } = useConcordProfile(hit.msg.pubkey);
  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-lg px-2.5 py-2 min-h-11 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
      data-testid={`group-search-hit-${hit.msg.id.slice(0, 8)}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 min-w-0">
        <span className="font-medium text-foreground/80 truncate">{name}</span>
        {showRoom && <span className="flex items-center gap-0.5 shrink-0"><Hash className="w-3 h-3" aria-hidden="true" />{hit.roomName}</span>}
        {hit.msg.rootId && <span className="shrink-0">· in a thread</span>}
        <span className="ml-auto shrink-0 tabular-nums">{formatCompactTime(Math.floor(hit.msg.t / 1000))}</span>
      </div>
      <p className="text-xs text-foreground/85 break-words [overflow-wrap:anywhere] line-clamp-2 mt-0.5">
        {hit.snippet.before}<mark className="bg-primary/20 text-foreground rounded px-0.5">{hit.snippet.match}</mark>{hit.snippet.after}
      </p>
    </button>
  );
}
