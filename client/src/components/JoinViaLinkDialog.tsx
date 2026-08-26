/**
 * "Join via link" (Chats "+" menu): paste an encrypted group-chat invite link
 * — ours or one minted by ANOTHER Concord client (https://armada.buzz/invite/
 * naddr1…#secret), or a bare naddr…#secret — and join it IN Relay Outpost.
 *
 * Pasted input is untrusted: it is only PARSED (detectGroupInvite), never
 * opened raw. A valid invite navigates to our internal /invite accept screen
 * with the #fragment secret preserved client-side (the accept screen runs the
 * explicit confirm/join flow — nothing auto-joins from here). Anything else
 * gets a calm inline error.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Link2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { detectGroupInvite } from "@/lib/concord/invite-detect";

export default function JoinViaLinkDialog({ onClose }: { onClose: () => void }) {
  const [, setLocation] = useLocation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tryJoin = (raw: string) => {
    const invite = detectGroupInvite(raw);
    if (!invite) {
      setError("That doesn't look like a group invite link. It should contain /invite/naddr… — copy the full link, including everything after the #.");
      return;
    }
    onClose();
    setLocation(invite.path);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm p-0 overflow-hidden border-border" data-testid="dialog-join-via-link">
        <VisuallyHidden><DialogTitle>Join via link</DialogTitle></VisuallyHidden>
        <div className="p-4 space-y-3" aria-describedby="join-via-link-desc">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-brand" />
            <span className="text-sm font-semibold">Join via link</span>
          </div>
          <p id="join-via-link-desc" className="text-xs text-muted-foreground/70">
            Paste a group chat invite link — from Relay Outpost or any other Concord app — and it opens here.
          </p>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); tryJoin(value); }}
          >
            <Input
              autoFocus
              value={value}
              placeholder="https://…/invite/naddr1…#…"
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              onPaste={(e) => {
                // Fast path: a pasted valid invite joins immediately; invalid
                // pastes fall through to the field + inline error on submit.
                const text = e.clipboardData?.getData("text") ?? "";
                if (detectGroupInvite(text)) {
                  e.preventDefault();
                  tryJoin(text);
                }
              }}
              className="h-10 text-base sm:text-sm"
              data-testid="input-join-via-link"
            />
            {error && (
              <p className="text-xs text-destructive" data-testid="text-join-link-error">{error}</p>
            )}
            <Button type="submit" className="w-full min-h-11" disabled={!value.trim()} data-testid="button-join-via-link">
              Join group chat
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
