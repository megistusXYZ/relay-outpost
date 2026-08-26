/**
 * Signal/WhatsApp-style message actions: one ⋯ entry point opens a compact menu
 * with a quick-reaction emoji row on top and the rest (reply, copy, edit,
 * delete) as a tidy list — instead of a crowded row of always-on icons.
 */
import { useState } from "react";
import { MoreHorizontal, Reply, Copy, Pencil, Trash2, SmilePlus, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ComposeEmojiPicker } from "@/components/ComposeEmojiPicker";

const QUICK = ["👍", "❤️", "😂", "🎉", "😮", "😢"];

export function ConcordMessageActions({ content, mine, onReact, onReply, onEdit, onDelete }: {
  content: string;
  mine: boolean;
  onReact: (emoji: string, emojiUrl?: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const act = (fn: () => void) => { setOpen(false); fn(); };
  const react = (emoji: string, emojiUrl?: string) => { setOpen(false); onReact(emoji, emojiUrl); };
  const copy = () => { try { navigator.clipboard?.writeText(content); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1200); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center justify-center w-9 h-9 md:w-7 md:h-7 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
          title="Message actions" data-testid="concord-msg-actions"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5" data-testid="concord-msg-menu">
        {/* Quick reactions */}
        <div className="flex items-center gap-0.5 pb-1.5 mb-1 border-b border-border/20">
          {QUICK.map((e) => (
            <button key={e} onClick={() => react(e)} className="flex-1 h-11 md:h-9 rounded-lg text-lg hover:bg-muted/50 transition-colors" data-testid={`concord-quick-react-${e}`}>{e}</button>
          ))}
          <div className="shrink-0" onClick={() => setOpen(false)}>
            <ComposeEmojiPicker hideStickers onInsert={(emoji, custom) => onReact(custom?.shortcode ? `:${custom.shortcode}:` : emoji, custom?.url)} />
          </div>
        </div>
        {/* Actions */}
        <MenuItem icon={Reply} label="Reply" onClick={() => act(onReply)} testid="concord-menu-reply" />
        <MenuItem icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy text"} onClick={copy} testid="concord-menu-copy" />
        {mine && <MenuItem icon={Pencil} label="Edit" onClick={() => act(onEdit)} testid="concord-menu-edit" />}
        {mine && <MenuItem icon={Trash2} label="Delete" onClick={() => act(onDelete)} destructive testid="concord-menu-delete" />}
      </PopoverContent>
    </Popover>
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
