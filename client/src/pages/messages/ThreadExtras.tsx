import { CornerUpLeft, X } from "lucide-react";
import { QUICK_REACTIONS, type ReactionTally } from "@/lib/dm-thread";

/**
 * The small pieces a private chat's replies and reactions are drawn with
 * (the rules are in lib/dm-thread.ts; the Messages page owns what they do).
 */

/** Inside a bubble, above its text: the message being answered. */
export function ReplyQuote({
  author, text, mine, onOpen, testId,
}: {
  /** Who wrote the message being answered; empty when it isn't loaded here. */
  author: string;
  text: string;
  /** The bubble is the reader's own (it sits on the brand colour). */
  mine: boolean;
  /** Go to that message, when it is on screen to go to. */
  onOpen?: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className={`mb-1.5 block w-full text-left rounded-md border-l-2 px-2 py-1 ${mine ? "border-white/50 bg-white/10" : "border-brand/60 bg-foreground/[0.04]"} ${onOpen ? "cursor-pointer" : "cursor-default"}`}
      data-testid={testId}
    >
      {author && <span className={`block text-[11px] font-medium truncate ${mine ? "text-white/90" : "text-brand"}`}>{author}</span>}
      <span className={`block text-[12px] truncate ${mine ? "text-white/70" : "text-muted-foreground"}`}>{text}</span>
    </button>
  );
}

/** Under a bubble: its reactions. Tapping one adds yours. */
export function ReactionChips({
  tallies, onPick, namesOf, testId,
}: {
  tallies: ReactionTally[];
  onPick: (emoji: string) => void;
  /** The people behind a reaction, as one line for the tooltip. */
  namesOf: (people: string[]) => string;
  testId: string;
}) {
  if (tallies.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid={testId}>
      {tallies.map((t) => (
        <button
          key={t.emoji}
          type="button"
          onClick={(e) => { e.stopPropagation(); onPick(t.emoji); }}
          title={namesOf(t.people)}
          aria-label={`${t.emoji} ${t.count}: ${namesOf(t.people)}`}
          aria-pressed={t.mine}
          className={`relative after:content-[''] after:absolute after:-inset-y-2 after:inset-x-0 inline-flex items-center gap-1 rounded-full border px-2 h-7 text-[13px] leading-none transition-colors ${
            t.mine ? "border-brand/50 bg-brand/15 text-foreground" : "border-border/60 bg-muted/60 text-muted-foreground hover:text-foreground"
          }`}
          data-testid={`${testId}-${t.emoji}`}
        >
          <span>{t.emoji}</span>
          {t.count > 1 && <span className="tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The row of reactions to pick from. */
export function QuickReactions({ onPick, size, testId }: { onPick: (emoji: string) => void; size: "sheet" | "popover"; testId: string }) {
  const cell = size === "sheet" ? "w-11 h-11 text-2xl" : "w-9 h-9 text-xl";
  return (
    <div className="flex items-center justify-between gap-1" role="group" aria-label="React" data-testid={testId}>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          aria-label={`React with ${emoji}`}
          className={`${cell} inline-flex items-center justify-center rounded-full hover:bg-muted/70 active:scale-95 transition`}
          data-testid={`${testId}-${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Above the composer: the message about to be answered. */
export function ReplyingBar({ name, text, onCancel }: { name: string; text: string; onCancel: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/40 pl-3 pr-1 py-1.5" data-testid="dm-replying-to">
      <CornerUpLeft className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-brand truncate">Replying to {name}</p>
        <p className="text-[12px] text-muted-foreground truncate">{text}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="w-9 h-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
        aria-label="Cancel reply"
        data-testid="button-cancel-reply"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
