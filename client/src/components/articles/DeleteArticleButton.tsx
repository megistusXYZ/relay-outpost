import { useState } from "react";
import type { Event } from "nostr-tools";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ConfirmAction";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { publishEvent } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { buildArticleDeletion } from "@/lib/nip23";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";

/**
 * "Delete article" for the author, with the one honest sentence about what a
 * deletion on an open network can and can't do. One component so the words are
 * the same on the article page and in the Account list.
 */
export function DeleteArticleButton({ event, onDeleted, testId = "button-delete-article", className }: {
  event: Event;
  onDeleted?: () => void;
  testId?: string;
  className?: string;
}) {
  const { signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!signer) return;
    setBusy(true);
    try {
      const signed = await signWithTimeout(signer, buildArticleDeletion(event));
      const { relays, userSelected } = getPublishTarget();
      const ok = await publishEvent(signed, relays, undefined, userSelected);
      if (!ok) {
        toast({ title: "Couldn't reach your relays", description: "The article is still up. Try again in a moment.", variant: "destructive" });
        return;
      }
      toast({ title: "Article deleted", description: "Relays that honour deletions will remove it. Copies elsewhere may remain." });
      onDeleted?.();
    } catch (err) {
      if (isSignerError(err)) await handleSignerError(err, toast, attemptReconnect);
      else toast({ title: "Couldn't delete the article", variant: "destructive" });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete article"
        title="Delete article"
        className={className}
        disabled={busy}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
      <ConfirmAction
        open={open}
        onOpenChange={setOpen}
        title="Delete this article?"
        description="Relays that honour deletions will remove it. Copies elsewhere may remain, and the link will stop opening here."
        confirmLabel="Delete article"
        cancelLabel="Keep it"
        onConfirm={confirm}
      />
    </>
  );
}
