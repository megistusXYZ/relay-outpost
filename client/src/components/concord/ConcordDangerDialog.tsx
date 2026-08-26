/**
 * The one confirm for leaving or dissolving a Concord group chat.
 *
 * Extracted from ConcordOutpost rather than copied into the second host. The
 * admin drawer's danger section already states the rule it depends on — "it
 * hands off to the host's existing confirm rather than minting a second one;
 * two confirms would be two chances to word the irreversible thing
 * differently" — and that rule only holds while there IS one. A second host
 * needing the confirm is precisely when a codebase grows the second wording.
 *
 * Both acts live here because they are the same decision seen from two sides:
 * an owner leaving IS dissolving, which is why ConcordChat withholds Leave from
 * an owner. Splitting them into two components would put that relationship in
 * two files that cannot see each other.
 *
 * `onDone` rather than a navigation of its own: the standalone page leaves for
 * /messages, while the relay outpost's Chat tab stays put and re-reads. The
 * publish is identical; where you end up afterwards is the host's business.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { dissolveCommunity, leaveCommunity } from "@/lib/concord/concord-governance";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export type ConcordDangerMode = "dissolve" | "leave";

export function ConcordDangerDialog({ mode, onOpenChange, community, pubkey, onDone }: {
  /** `null` closes it. */
  mode: ConcordDangerMode | null;
  onOpenChange: (mode: ConcordDangerMode | null) => void;
  community: StoredCommunity;
  pubkey: string | null | undefined;
  /** Ran only after the act SUCCEEDED — never on the error path. */
  onDone: (mode: ConcordDangerMode) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer || !mode) return;
    setBusy(true);
    try {
      const relays = community.relays;
      if (mode === "dissolve") {
        await dissolveCommunity(signer, pubkey, community, (e, r) => publishEvent(e, r), (e) => publishEvent(e, relays));
        toast({ title: "Group chat deleted" });
      } else {
        await leaveCommunity(signer, pubkey, community, (e, r) => publishEvent(e, r), (e) => publishEvent(e, relays));
        toast({ title: "Left group chat" });
      }
      onDone(mode);
    } catch (err) {
      toast({ title: "Couldn't complete", description: String((err as Error)?.message ?? err), variant: "destructive" });
      // Reopened for a retry, not left spinning behind a dismissed dialog.
      setBusy(false);
      onOpenChange(null);
    }
  };

  return (
    <AlertDialog open={!!mode} onOpenChange={(o) => { if (!o && !busy) onOpenChange(null); }}>
      {/* z-[210] — ABOVE the admin drawer's z-[200], the same tier CommsTab's
          panels already use for exactly this reason. Both this dialog's layers
          are raised: shadcn defaults them to z-50, so the confirm opened by the
          drawer's "End this space" rendered UNDER the drawer and its scrim —
          half-hidden and not reliably clickable. Found by opening it; nothing
          in the type system or the suite can see a stacking order. */}
      <AlertDialogContent className="z-[210] max-w-sm" overlayClassName="z-[210]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">
            {mode === "dissolve" ? "Delete this group chat?" : "Leave this group chat?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            {mode === "dissolve"
              ? "This deletes the group chat for everyone and removes it from your devices. Members lose access. This can't be undone."
              : "You'll be removed from the roster and it'll disappear from your devices. You can rejoin later with a new invite."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs" disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); run(); }}
            disabled={busy}
            className="text-xs bg-destructive hover:bg-destructive/90"
            data-testid="concord-danger-confirm"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : mode === "dissolve" ? "Delete" : "Leave"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
