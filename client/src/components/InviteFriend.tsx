import { useState } from "react";
import { UserPlus, Copy, Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { buildFriendInviteLink } from "@/lib/invite-links";

/**
 * "Invite a friend" — generates a personal invite link carrying the user's npub
 * (and optionally one of their outposts). The receiving side already exists:
 * App.tsx reads `?inviter=` so a brand-new account created from this link
 * auto-follows the inviter (and auto-joins the outpost when included). So the
 * new user lands already following you — the core viral loop.
 *
 * Self-contained: renders a trigger button that opens a copy/share dialog.
 */
export function InviteFriend({
  npub,
  relayUrl,
  triggerLabel = "Invite friends",
  triggerVariant = "outline",
  triggerClassName = "",
  trigger,
  open: openProp,
  onOpenChange,
}: {
  npub: string;
  /** Optional: invite straight into one of your outposts. */
  relayUrl?: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
  triggerClassName?: string;
  /** Custom trigger node; overrides the default button. */
  trigger?: React.ReactNode;
  /** Controlled mode: when provided, the parent owns open state and no trigger
   *  is rendered (open it yourself, e.g. from a menu row). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const controlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlled ? openProp! : internalOpen;
  const setOpen = (v: boolean) => { if (controlled) onOpenChange?.(v); else setInternalOpen(v); };
  const [copied, setCopied] = useState(false);
  const link = npub ? buildFriendInviteLink(npub, relayUrl) : "";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible to copy by hand */
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: "Join me on Relay Outpost",
        text: "Come hang out with me on Relay Outpost — you'll start out already following me.",
        url: link,
      });
    } catch {
      /* user cancelled or share unavailable — no-op */
    }
  };

  if (!npub) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant={triggerVariant} size="sm" className={triggerClassName} data-testid="button-invite-friend">
              <UserPlus className="w-3.5 h-3.5" />
              {triggerLabel}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-[calc(100vw-2rem)] gap-5 overflow-hidden glass-dialog-card border-brand/15 rounded-2xl sm:rounded-2xl sm:max-w-md">
        <DialogHeader className="text-center sm:text-center">
          {/* Centered, icon-free header — the chip read as clutter next to the
              already-descriptive title. */}
          <DialogTitle className="text-center font-brand">Invite a friend</DialogTitle>
          <DialogDescription className="text-center leading-relaxed">
            Share this link. When they sign up, they'll start out already following you — no searching required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-brand/20 bg-brand/[0.06] px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" data-testid="text-invite-link">
            {link}
          </span>
          <button
            onClick={handleCopy}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-brand/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label="Copy invite link"
            data-testid="button-copy-invite-link"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleCopy}
            className="min-h-11 flex-1"
            data-testid="button-invite-copy-cta"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy link"}
          </Button>
          {canNativeShare && (
            <Button onClick={handleShare} variant="outline" className="min-h-11 flex-1" data-testid="button-invite-share-cta">
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
