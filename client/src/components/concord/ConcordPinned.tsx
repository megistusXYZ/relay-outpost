/**
 * A room's pins (CORD-04 §7), the way Discord and Slack show them: a pin
 * button with a count in the room's header, opening a list of the pinned
 * messages themselves — words, photos, GIFs — each with Jump and Unpin.
 *
 * It replaced a bar above the conversation that previewed one pin as a name
 * and a snippet: a media-only pin read "Handled:", and the list showed a name
 * and a date with nothing under them. Each pin is a proof, so it shows the
 * author's own message even to someone who joined after it was written.
 */
import { useState } from "react";
import { Pin, PinOff, CornerDownRight, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { VerifiedPin } from "@/lib/concord/concord-pins";
import { pinMediaLabel, type PinnedCard } from "@/lib/concord/concord-pin-preview";
import { senderColor } from "@/lib/sender-color";
import { useConcordProfile } from "./ConcordIdentity";
import { ConcordMessageBody } from "./ConcordMessageBody";
import { ConcordMediaView } from "./ConcordMediaView";

/** The header's pin button and the list it opens. */
export function ConcordPinsButton({ pins, unavailable, cardOf, canPin, canUnpin, onUnpin, onJump, spaceLine, compact }: {
  pins: VerifiedPin[];
  /** Sealed under a key this device never held: said so, never shown as none. */
  unavailable: boolean;
  /** The message a pin points at: the room's copy when held, else the proof's. */
  cardOf: (pin: VerifiedPin) => PinnedCard;
  canPin: boolean;
  canUnpin: boolean;
  onUnpin: (id: string) => void;
  /** Scroll the room to the message, fetching it first when it's older than
   *  what this device holds. False when it couldn't be found. */
  onJump: (pin: VerifiedPin) => Promise<boolean>;
  /** How much room is left: a count for a public room, an estimate for a private one. */
  spaceLine: string;
  /** The phone header, which is short on room: shown only when there's something to open. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The pin whose message is being fetched, so its Jump can say so.
  const [finding, setFinding] = useState<string | null>(null);
  if (compact && pins.length === 0 && !unavailable) return null;
  const count = pins.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center justify-center gap-1 shrink-0 rounded-full transition-colors hover:bg-muted/40 data-[state=open]:bg-brand/10 data-[state=open]:text-brand ${
            compact ? "h-10 min-w-10 px-2" : "h-7 min-w-7 px-1.5"
          } ${count > 0 ? "text-foreground/70 hover:text-foreground" : "text-muted-foreground/50 hover:text-foreground"}`}
          title="Pinned messages"
          aria-label={count > 0 ? `Pinned messages: ${count}` : "Pinned messages"}
          data-testid={compact ? "concord-pins-mobile" : "concord-pins"}
        >
          <Pin className={compact ? "w-[18px] h-[18px]" : "w-4 h-4"} />
          {count > 0 && <span className="text-[11px] font-semibold tabular-nums">{count}</span>}
        </button>
      </PopoverTrigger>
      {/* Focus stays on the button: landing on the first Jump drew a ring
          round it on every open, as if it were already chosen. */}
      <PopoverContent align="end" sideOffset={8} collisionPadding={12} onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[min(26rem,calc(100vw-1.5rem))] p-0 overflow-hidden" data-testid="concord-pinned-sheet">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          <Pin className="w-4 h-4 text-brand" />
          <p className="text-sm font-semibold">Pinned messages</p>
          {!unavailable && <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{spaceLine}</span>}
        </div>
        <div className="max-h-[min(70vh,34rem)] overflow-y-auto overscroll-contain p-2 space-y-2">
          {unavailable ? (
            <Empty title="Pins can't be shown on this device" body="This room's pins are sealed with a key this device doesn't hold." />
          ) : count === 0 ? (
            <Empty title="No pinned messages yet"
              body={canPin ? "Pin a message from its ⋯ menu and it stays here for everyone." : "When someone pins a message, it stays here for everyone."} />
          ) : (
            [...pins].reverse().map((p) => (
              <PinnedMessage key={p.id} pin={p} card={cardOf(p)} finding={finding === p.id}
                // The list stays open while an older message is fetched, and
                // closes once there's somewhere to land.
                onJump={async () => {
                  if (finding) return;
                  setFinding(p.id);
                  const ok = await onJump(p);
                  setFinding(null);
                  if (ok) setOpen(false);
                }}
                onUnpin={canUnpin ? () => onUnpin(p.id) : undefined} />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One pinned message, shown as the message: who, when, what they said or shared. */
function PinnedMessage({ pin, card, finding, onJump, onUnpin }: {
  pin: VerifiedPin; card: PinnedCard; finding: boolean; onJump: () => void; onUnpin?: () => void;
}) {
  const author = pin.rumor.pubkey;
  const { name, avatar, hasProfile } = useConcordProfile(author);
  const words = card.text.trim();
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 dark:border-white/[0.08] dark:bg-white/[0.03]" data-testid="concord-pinned-row">
      <div className="flex items-start gap-2.5">
        <Avatar className="w-8 h-8 shrink-0 border border-border/30">
          {avatar && <AvatarImage src={avatar} alt="" />}
          <AvatarFallback className="text-[10px] bg-brand/10 text-brand font-semibold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="min-w-0 truncate text-[13px] font-semibold" style={hasProfile ? { color: senderColor(author) } : undefined}>{name}</span>
            <time className="shrink-0 text-[11px] text-muted-foreground/70">{formatDistanceToNow(new Date(pin.rumor.created_at * 1000), { addSuffix: true })}</time>
          </div>
          {words && (
            <div className="mt-0.5 text-sm line-clamp-6 post-content-text reply-content-text break-words [overflow-wrap:anywhere] whitespace-pre-wrap">
              <ConcordMessageBody id={pin.id} pubkey={author} content={card.text} />
              {card.edited && <span className="ml-1 text-[10px] text-muted-foreground/50">(edited)</span>}
            </div>
          )}
          {card.media.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1.5 [&_img]:max-h-48 [&_video]:max-h-48">
              {card.media.map((m, i) => <ConcordMediaView key={i} media={m} />)}
            </div>
          )}
          {!words && card.media.length === 0 && (
            <p className="mt-0.5 text-sm italic text-muted-foreground">{pinMediaLabel(pin.rumor) || "Message"}</p>
          )}
        </div>
      </div>
      {/* Jump on every pin: one older than this device's history is fetched first. */}
      <div className="mt-2 flex items-center justify-end gap-1.5">
          <button onClick={onJump} disabled={finding} aria-busy={finding}
            className="inline-flex min-h-11 md:min-h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-brand hover:bg-brand/10 disabled:opacity-70 transition-colors" data-testid="concord-pin-jump">
            {finding ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding…</> : <><CornerDownRight className="h-3.5 w-3.5" /> Jump</>}
          </button>
          {onUnpin && (
            <button onClick={onUnpin} className="inline-flex min-h-11 md:min-h-7 items-center gap-1 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors" data-testid="concord-unpin">
              <PinOff className="h-3.5 w-3.5" /> Unpin
            </button>
          )}
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden="true"><Pin className="h-4 w-4" /></span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-[18rem] text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
