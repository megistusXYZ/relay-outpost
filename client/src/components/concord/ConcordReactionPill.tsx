/**
 * A single Concord message reaction pill that also answers "who reacted?".
 *
 * The reactor pubkeys are already folded into each reaction group locally
 * (ConcordChat's ReactionAgg.reactors), so surfacing them costs no extra
 * fetch. Behaviour is pointer-appropriate:
 *   • Desktop (hover pointer): hovering the pill reveals the reactor list;
 *     a click still toggles your own reaction — the fast path stays intact.
 *   • Mobile/touch: tapping the pill opens the reactor list (there is no
 *     hover), with an explicit control to add/remove your own reaction.
 * Either way the pill shows the emoji + count exactly as before.
 */
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ConcordIdentity } from "./ConcordIdentity";

interface ConcordReactionPillProps {
  emoji: string;
  emojiUrl?: string;
  /** Reactor pubkeys for this emoji (already deduped upstream). */
  reactors: string[];
  reacted: boolean;
  onReact: () => void;
  myPubkey?: string | null;
}

function ReactorList({ emoji, emojiUrl, reactors, myPubkey }: { emoji: string; emojiUrl?: string; reactors: string[]; myPubkey?: string | null }) {
  // Show "you" first so the reader instantly sees their own reaction.
  const ordered = myPubkey && reactors.includes(myPubkey)
    ? [myPubkey, ...reactors.filter((p) => p !== myPubkey)]
    : reactors;
  return (
    <div className="w-56 max-w-[70vw]">
      <div className="flex items-center gap-1.5 px-1 pb-1.5 mb-1.5 border-b border-border/30">
        {emojiUrl
          ? <img src={emojiUrl} alt={emoji} className="w-4 h-4 object-contain" />
          : <span className="text-sm leading-none">{emoji}</span>}
        <span className="text-[11px] text-muted-foreground/70">
          {reactors.length} {reactors.length === 1 ? "reaction" : "reactions"}
        </span>
      </div>
      <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-0.5">
        {ordered.map((pk) => (
          <div key={pk} className="flex items-center justify-between gap-2">
            <ConcordIdentity pubkey={pk} size={22} />
            {pk === myPubkey && <span className="text-[10px] text-brand/70 shrink-0">you</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConcordReactionPill({ emoji, emojiUrl, reactors, reacted, onReact, myPubkey }: ConcordReactionPillProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const pillClass = `flex items-center gap-1 h-8 px-2 md:h-6 md:px-1.5 rounded-full border text-xs transition-colors ${
    reacted
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-border/30 bg-muted/20 hover:bg-muted/40 text-foreground/70"
  }`;

  const pillInner = (
    <>
      {emojiUrl ? <img src={emojiUrl} alt={emoji} className="w-4 h-4 object-contain" /> : <span>{emoji}</span>}
      <span className="tabular-nums text-[11px]">{reactors.length}</span>
    </>
  );

  if (isMobile) {
    // Touch: the tap opens the "who reacted" sheet (no hover available); the
    // toggle moves inside so it stays reachable without hijacking the tap.
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={pillClass} data-testid={`concord-reaction-${emoji}`}>{pillInner}</button>
        </PopoverTrigger>
        <PopoverContent align="start" className="p-2 w-auto">
          <ReactorList emoji={emoji} emojiUrl={emojiUrl} reactors={reactors} myPubkey={myPubkey} />
          <button
            onClick={() => { onReact(); setOpen(false); }}
            className={`mt-2 w-full h-8 rounded-md text-[11px] font-medium transition-colors ${
              reacted ? "bg-muted/40 text-foreground/70 hover:bg-muted/60" : "bg-brand/10 text-brand hover:bg-brand/20"
            }`}
            data-testid={`concord-reaction-toggle-${emoji}`}
          >
            {reacted ? "Remove my reaction" : "Add my reaction"}
          </button>
        </PopoverContent>
      </Popover>
    );
  }

  // Desktop: hover reveals the reactor list; click still toggles (fast path).
  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button onClick={onReact} className={pillClass} data-testid={`concord-reaction-${emoji}`}>{pillInner}</button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="p-2 w-auto">
        <ReactorList emoji={emoji} emojiUrl={emojiUrl} reactors={reactors} myPubkey={myPubkey} />
      </HoverCardContent>
    </HoverCard>
  );
}
