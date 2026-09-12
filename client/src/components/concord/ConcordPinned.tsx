/**
 * A room's pins (CORD-04 §7): a bar above the conversation with the newest
 * pin, and the list of all of them. Each pin is a proof, so it shows the
 * author's own words even to someone who joined after they were written.
 *
 * A pin always says something: its words, or what it is when it has none
 * ("Photo", "GIF", "Attachment"). A media-only pin used to read "Handled:"
 * and nothing else, in the bar and in the list alike.
 */
import type { ReactNode } from "react";
import { Pin, PinOff, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { VerifiedPin } from "@/lib/concord/concord-pins";
import { pinMediaLabel } from "@/lib/concord/concord-pin-preview";
import { useConcordProfile } from "./ConcordIdentity";

/** Renders a pin's words; `fallback` names what it is when it has none. */
type Preview = (content: string, fallback: string) => ReactNode;

const fallbackOf = (pin: VerifiedPin) => pinMediaLabel(pin.rumor) || "Message";

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
      className="group w-full flex items-center gap-3 px-3 md:px-4 py-2 border-b border-border/20 bg-brand/[0.04] text-left hover:bg-brand/[0.08] transition-colors"
      aria-label={pins.length > 1 ? `${pins.length} pinned messages` : "Pinned message"}
      data-testid="concord-pinned-bar"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden="true">
        <Pin className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[11px] font-medium text-brand/80">
          {pins.length > 1 ? `Pinned · ${pins.length}` : "Pinned"}
        </span>
        <span className="block truncate text-xs">
          <span className="font-medium text-foreground/85">{name}</span>
          <span className="text-muted-foreground"> · {preview(textOf(latest), fallbackOf(latest))}</span>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
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
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[calc(100dvh-4rem)] overflow-y-auto gap-3" data-testid="concord-pinned-sheet">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-base flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden="true"><Pin className="h-3.5 w-3.5" /></span>
            Pinned
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground/70">{spaceLine}</p>
        </DialogHeader>
        {pins.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground/60">Nothing is pinned in this room.</p>
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
    <div className="rounded-xl border border-border/30 bg-background/60 p-3" data-testid="concord-pinned-row">
      <div className="flex items-center gap-2 min-w-0">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground/60">{formatDistanceToNow(new Date(pin.rumor.created_at * 1000), { addSuffix: true })}</span>
        {onUnpin && (
          <button
            onClick={onUnpin}
            className="ml-auto shrink-0 inline-flex min-h-11 md:min-h-8 items-center gap-1 rounded-lg border border-border/40 px-2.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            data-testid="concord-unpin"
          >
            <PinOff className="h-3.5 w-3.5" /> Unpin
          </button>
        )}
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {preview(text, fallbackOf(pin))}
        {edited && <span className="ml-1 text-[10px] text-muted-foreground/50">(edited)</span>}
      </div>
    </div>
  );
}
