/**
 * Signal/WhatsApp-style message actions: one ⋯ entry point opens a compact menu
 * with a quick-reaction emoji row on top and the rest (reply, reply in thread,
 * copy, edit, delete) as a tidy list — instead of a crowded row of always-on icons.
 */
import { useState } from "react";
import { MoreHorizontal, Reply, MessageSquare, Pin, PinOff, Copy, Pencil, Trash2, SmilePlus, Check, Flag } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ComposeEmojiPicker } from "@/components/ComposeEmojiPicker";

const QUICK = ["👍", "❤️", "😂", "🎉", "😮", "😢"];
/** The three a hover toolbar offers without opening the menu. */
const TOOLBAR = QUICK.slice(0, 3);
const TOOL = "msg-toolbar-quick items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";

export function ConcordMessageActions({ content, mine, onReact, onReply, onReplyInThread, readOnly, pinned, onTogglePin, onEdit, onDelete, removable, onReport }: {
  content: string;
  mine: boolean;
  onReact: (emoji: string, emojiUrl?: string) => void;
  /** In the room: an inline quote. In a thread: a reply in that thread. */
  onReply: () => void;
  /** In the room only: open this message's thread with its composer ready. */
  onReplyInThread?: () => void;
  /** A deleted group: only copying, and deleting your own, remain. */
  readOnly?: boolean;
  pinned?: boolean;
  /** Pin or unpin: offered to the owner and anyone with Pin messages. */
  onTogglePin?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Someone else's message I may remove, as a moderator who outranks them (CORD-04 §5). */
  removable?: boolean;
  /** Report someone else's message to the group's moderators (concord-reports). */
  onReport?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const act = (fn: () => void) => { setOpen(false); fn(); };
  const react = (emoji: string, emojiUrl?: string) => { setOpen(false); onReact(emoji, emojiUrl); };
  const copy = () => { try { navigator.clipboard?.writeText(content); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1200); };

  return (
    <>
    {/* On a device with a real hover these ride in the row's floating toolbar
        (.msg-toolbar in index.css). On touch they're hidden: the ⋯ menu below
        has every one of them. No display utilities here — the class owns it. */}
    {!readOnly && (
      <>
        {TOOLBAR.map((e) => (
          <button key={e} onClick={() => onReact(e)} className={`msg-toolbar-quick ${TOOL} text-[15px]`} title={`React ${e}`} aria-label={`React ${e}`} data-testid={`concord-toolbar-react-${e}`}>{e}</button>
        ))}
        <button onClick={onReply} className={TOOL} title="Reply" aria-label="Reply" data-testid="concord-toolbar-reply"><Reply className="w-4 h-4" /></button>
        {onReplyInThread && (
          <button onClick={onReplyInThread} className={TOOL} title="Reply in thread" aria-label="Reply in thread" data-testid="concord-toolbar-thread"><MessageSquare className="w-4 h-4" /></button>
        )}
      </>
    )}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center justify-center w-9 h-9 md:w-7 md:h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Message actions" data-testid="concord-msg-actions"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5" data-testid="concord-msg-menu">
        {/* Quick reactions */}
        {!readOnly && (
        <div className="flex items-center gap-0.5 pb-1.5 mb-1 border-b border-border/20">
          {QUICK.map((e) => (
            <button key={e} onClick={() => react(e)} className="flex-1 h-11 md:h-9 rounded-lg text-lg hover:bg-muted/50 transition-colors" data-testid={`concord-quick-react-${e}`}>{e}</button>
          ))}
          <div className="shrink-0" onClick={() => setOpen(false)}>
            <ComposeEmojiPicker hideStickers onInsert={(emoji, custom) => onReact(custom?.shortcode ? `:${custom.shortcode}:` : emoji, custom?.url)} />
          </div>
        </div>
        )}
        {/* Actions */}
        {!readOnly && <MenuItem icon={Reply} label="Reply" onClick={() => act(onReply)} testid="concord-menu-reply" />}
        {onReplyInThread && !readOnly && <MenuItem icon={MessageSquare} label="Reply in thread" onClick={() => act(onReplyInThread)} testid="concord-menu-reply-thread" />}
        {onTogglePin && !readOnly && <MenuItem icon={pinned ? PinOff : Pin} label={pinned ? "Unpin" : "Pin"} onClick={() => act(onTogglePin)} testid="concord-menu-pin" />}
        <MenuItem icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy text"} onClick={copy} testid="concord-menu-copy" />
        {onReport && !mine && <MenuItem icon={Flag} label="Report" onClick={() => act(onReport)} testid="concord-menu-report" />}
        {mine && !readOnly && <MenuItem icon={Pencil} label="Edit" onClick={() => act(onEdit)} testid="concord-menu-edit" />}
        {(mine || removable) && (
          <MenuItem icon={Trash2} label={mine ? "Delete" : "Remove for everyone"} onClick={() => act(onDelete)} destructive testid={mine ? "concord-menu-delete" : "concord-menu-remove"} />
        )}
      </PopoverContent>
    </Popover>
    </>
  );
}

function MenuItem({ icon: Icon, label, onClick, destructive, testid }: {
  icon: typeof Reply; label: string; onClick: () => void; destructive?: boolean; testid?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-2.5 h-11 md:h-9 rounded-lg text-sm transition-colors ${destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground/80 hover:bg-muted/50"}`}
      data-testid={testid}
    >
      <Icon className="w-4 h-4 shrink-0" /> {label}
    </button>
  );
}

export { SmilePlus };
