import { useMemo, useState } from "react";
import type { Event } from "nostr-tools";
import { ConfirmAction } from "@/components/ConfirmAction";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { publishEventDetailed } from "@/lib/nostr";
import { getPublishTarget, getOutpostRelays } from "@/lib/outpost-relays";
import { buildDeletion, deletionHome, deletionWords, deletionReport, communityFor } from "@/lib/deletion";
import { verifyDeletion } from "@/lib/deletion-check";
import { markDeleted } from "@/lib/deleted-events";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";

/**
 * "Delete" for the author of a post or reply: the confirmation tells the
 * truth for where the post lives, the deletion goes out, the post leaves
 * this screen at once, and one toast a few seconds later says what the
 * relays did (lib/deletion.ts).
 */
export function DeletePostConfirm({ event, open, onOpenChange, onDeleted }: {
  event: Event;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  // Re-read each time the dialog opens: the relay preference and the joined
  // communities can change between one Delete and the next.
  const plan = useMemo(() => {
    const { relays, userSelected } = getPublishTarget();
    const ours = getOutpostRelays();
    const home = deletionHome(relays, ours.map((r) => r.url));
    return { relays, userSelected, words: deletionWords(home, communityFor(relays, ours)) };
  }, [open]); // `open` is the refresh trigger, on purpose: no linter runs here, so the comment is the record

  const confirm = async () => {
    if (!signer || busy) return;
    setBusy(true);
    try {
      const signed = await signWithTimeout(signer, buildDeletion(event));
      const { ok } = await publishEventDetailed(signed, plan.relays, undefined, plan.userSelected);
      if (!ok) {
        toast({ title: "Couldn't reach your relays", description: "The post is still up. Try again in a moment.", variant: "destructive" });
        return;
      }
      markDeleted(event.id, event.pubkey);
      onDeleted?.();
      toast({ title: "Deletion sent", description: "Checking what the relays did…" });
      const outcome = await verifyDeletion(event.id, plan.relays);
      toast({ title: "Deleted", description: outcome.asked === 0 ? "Couldn't reach your relays to check." : deletionReport(outcome) });
    } catch (err) {
      if (isSignerError(err)) await handleSignerError(err, toast, attemptReconnect);
      else toast({ title: "Couldn't delete the post", variant: "destructive" });
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  };

  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      title={plan.words.title}
      description={plan.words.description}
      confirmLabel={plan.words.confirmLabel}
      cancelLabel="Keep it"
      onConfirm={confirm}
    />
  );
}

/** Where a deleted post stood in a thread, so the replies under it keep their place. */
export function DeletedPost({ id, className = "" }: { id: string; className?: string }) {
  return (
    <div className={`px-3.5 sm:px-5 py-3 text-sm italic text-muted-foreground/60 ${className}`} data-testid={`deleted-post-${id}`}>
      This post was deleted by its author.
    </div>
  );
}
