import { useState } from "react";
import { nip19 } from "nostr-tools";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { publishEvent, getEventRelays } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { formatEventWhen } from "@/components/EventCard";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Clock, MapPin, Send, Share2 } from "lucide-react";
import type { CalendarEventData } from "@/lib/calendar-events";

const KIND_TEXT_NOTE = 1;

// naddr for a calendar event, with up to 3 seen-on relay hints so other
// clients can resolve the addressable event.
export function buildEventNaddr(ce: CalendarEventData): string | null {
  try {
    return nip19.naddrEncode({
      kind: ce.kind,
      pubkey: ce.pubkey,
      identifier: ce.dTag,
      relays: getEventRelays(ce.id).slice(0, 3),
    });
  } catch {
    return null;
  }
}

// Share-to-feed for calendar events, mirroring the article share sheet: a
// kind-1 post whose content carries a nostr:naddr1... reference (rendered by
// the feed as an embedded event card) plus a q-tag with the addressable
// coordinate for clients that resolve quotes from tags.
function ShareEventForm({ ce, onClose }: { ce: CalendarEventData; onClose: () => void }) {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);

  const naddr = buildEventNaddr(ce);
  const defaultContent = naddr ? `${ce.title}\n\nnostr:${naddr}` : ce.title;
  const [content, setContent] = useState(defaultContent);

  const handleShare = async () => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    if (!content.trim()) return;

    setIsPublishing(true);
    try {
      const relayHint = getEventRelays(ce.id)[0];
      const tags: string[][] = [];
      tags.push(["p", ce.pubkey]);
      const coord = `${ce.kind}:${ce.pubkey}:${ce.dTag}`;
      tags.push(relayHint ? ["q", coord, relayHint] : ["q", coord]);
      ce.hashtags.forEach((t) => tags.push(["t", t.toLowerCase()]));
      tags.push(...clientTags());

      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: content.trim(),
      };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      publishEvent(signedEvent, userRelays, undefined, isUserSelected).catch((err) => {
        console.error("Background publish failed:", err);
      });
      toast({ title: "Shared", description: "Event posted." });
      onClose();
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to share event:", err);
        toast({ title: "Failed to share", description: "Something went wrong.", variant: "destructive" });
      }
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-brand/[0.06] border border-brand/15 p-3 overflow-hidden">
        {ce.image && (
          <div className="rounded-md overflow-hidden mb-2 max-h-32 bg-muted/20">
            <img src={ce.image} alt={`${ce.title || "Event"} image`} className="w-full h-full object-cover max-h-32" loading="lazy" decoding="async" />
          </div>
        )}
        <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-1.5">Sharing Event</p>
        <p className="text-sm font-medium text-foreground/90 line-clamp-2 break-words">{ce.title}</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1 flex items-center gap-1.5">
          <Clock className="w-3 h-3 shrink-0" />
          {formatEventWhen(ce)}
        </p>
        {ce.location && (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5 flex items-center gap-1.5 min-w-0">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{ce.location}</span>
          </p>
        )}
      </div>

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        className="text-sm resize-none bg-white/[0.04] border-white/[0.08] focus:border-brand/30 focus:bg-white/[0.06] rounded-lg break-words"
        style={{ wordBreak: "break-word", overflowWrap: "break-word" }}
        placeholder="Add your thoughts..."
        autoComplete="off"
        data-testid="textarea-share-event-content"
      />

      <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider leading-relaxed">
        This creates a public post with the event attached. Others can reply and zap your post.
      </p>

      <div className="flex gap-2.5 pt-1">
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1 font-brand uppercase tracking-widest text-xs border-white/10 text-muted-foreground"
          data-testid="button-cancel-share-event"
        >
          Cancel
        </Button>
        <Button
          onClick={handleShare}
          disabled={isPublishing || !content.trim()}
          className="flex-1 bg-brand text-white font-brand uppercase tracking-widest text-xs border-0"
          data-testid="button-confirm-share-event"
        >
          {isPublishing ? (
            <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
          ) : (
            <Send className="w-3.5 h-3.5 mr-2" />
          )}
          {isPublishing ? "Posting..." : "Share"}
        </Button>
      </div>
    </div>
  );
}

// Render when the user picks "Share" on an event card. Drawer on mobile,
// dialog on desktop — same shell as the article/track share sheets.
export function ShareEventDialog({ ce, onClose }: { ce: CalendarEventData; onClose: () => void }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
              <Share2 className="w-4 h-4" />
              Share
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">
            <ShareEventForm ce={ce} onClose={onClose} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm sm:max-w-md glass-dialog-card border-brand/15 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Share
          </DialogTitle>
        </DialogHeader>
        <ShareEventForm ce={ce} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
