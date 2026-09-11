/**
 * A room's pins (CORD-04 §7): a bar above the conversation with the newest
 * pin, and the list of all of them. Each pin is a proof, so it shows the
 * author's own words even to someone who joined after they were written.
 */
import type { ReactNode } from "react";
import { Pin, PinOff, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { VerifiedPin } from "@/lib/concord/concord-pins";
import { useConcordProfile } from "./ConcordIdentity";

type Preview = (content: string) => ReactNode;

/** The newest pin, above the conversation; tapping it opens the list. */
export function ConcordPinnedBar({ pins, textOf, preview, onOpen }: {
  pins: VerifiedPin[];
  /** The words to show: the room's current text when this device holds it (an edit), else the proof's. */
  textOf: (pin: VerifiedPin) => string;
  preview: Preview;
  onOpen: () => void;
}) {
  const latest = pins[pins.length - 1];
  const { name } = useConcordProfile(latest.rumor.pubkey);
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-2 px-3 md:px-4 py-2 border-b border-border/20 bg-muted/10 text-left hover:bg-muted/20 transition-colors"
      data-testid="concord-pinned-bar"
    >
      <Pin className="w-3.5 h-3.5 shrink-0 text-brand/70" />
      <span className="min-w-0 flex-1 truncate text-xs">
        <span className="font-medium text-foreground/80">{name}:</span>{" "}
        <span className="text-muted-foreground">{preview(textOf(latest))}</span>
      </span>
      {pins.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">{pins.length} pinned</span>}
      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40" />
    </button>
  );
}

/** A private room's pins sealed under a key this device never held: shown as such, never as none. */
export function ConcordPinsUnavailable() {
  return (
    <div className="flex items-center gap-1.5 px-3 md:px-4 py-1.5 border-b border-border/20 text-[11px] text-muted-foreground/60" data-testid="concord-pins-unavailable">
      <Pin className="w-3 h-3 shrink-0" /> This room's pins can't be shown on this device.
    </div>
  );
}

/** Every pin in the room, newest first. */
export function ConcordPinnedSheet({ open, onOpenChange, pins, textOf, editedOf, preview, canUnpin, onUnpin, spaceLine }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pins: VerifiedPin[];
  textOf: (pin: VerifiedPin) => string;
  /** This device holds an edit newer than the pin's proof: say so rather than show old words as current. */
  editedOf: (pin: VerifiedPin) => boolean;
  preview: Preview;
  canUnpin: boolean;
  onUnpin: (id: string) => void;
  /** How much room is left: a count for a public room, an estimate for a private one (bytes decide there). */
  spaceLine: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[calc(100dvh-4rem)] overflow-y-auto" data-testid="concord-pinned-sheet">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2"><Pin className="w-4 h-4 text-brand/70" /> Pinned</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground/60">{spaceLine}</p>
        {pins.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground/60">Nothing is pinned in this room.</p>
        ) : (
          <div className="space-y-2">
            {[...pins].reverse().map((p) => (
              <PinnedRow key={p.id} pin={p} text={textOf(p)} edited={editedOf(p)} preview={preview}
                onUnpin={canUnpin ? () => onUnpin(p.id) : undefined} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PinnedRow({ pin, text, edited, preview, onUnpin }: {
  pin: VerifiedPin; text: string; edited: boolean; preview: Preview; onUnpin?: () => void;
}) {
  const { name } = useConcordProfile(pin.rumor.pubkey);
  return (
    <div className="rounded-lg border border-border/30 p-2.5" data-testid="concord-pinned-row">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium truncate">{name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground/50">{formatDistanceToNow(new Date(pin.rumor.created_at * 1000), { addSuffix: true })}</span>
        {onUnpin && (
          <button onClick={onUnpin} className="ml-auto shrink-0 h-9 md:h-7 px-2.5 flex items-center gap-1 rounded-full text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors" data-testid="concord-unpin">
            <PinOff className="w-3 h-3" /> Unpin
          </button>
        )}
      </div>
      <div className="mt-1 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {preview(text)}
        {edited && <span className="ml-1 text-[10px] text-muted-foreground/40">(edited)</span>}
      </div>
    </div>
  );
}
