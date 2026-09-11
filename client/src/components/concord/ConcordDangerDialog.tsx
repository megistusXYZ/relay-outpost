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
 * Both acts live here because they are the two ways out, and their wording
 * belongs side by side: leaving (for an owner, stepping back: the group goes
 * on under its admins and they stay its owner, concord-step-back) and deleting
 * it for everyone. An owner leaving used to be treated as dissolving, so owners
 * had no way to step away without ending the group.
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
import { leaveCopy } from "@/lib/concord/concord-step-back";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export type ConcordDangerMode = "dissolve" | "leave";

export function ConcordDangerDialog({ mode, onOpenChange, community, pubkey, onDone, otherStaff }: {
  /** `null` closes it. */
  mode: ConcordDangerMode | null;
  onOpenChange: (mode: ConcordDangerMode | null) => void;
  community: StoredCommunity;
  pubkey: string | null | undefined;
  /** Ran only after the act SUCCEEDED — never on the error path. */
  onDone: (mode: ConcordDangerMode) => void;
  /** Other staff in the group, when the host knows: an owner stepping back with none is warned. */
  otherStaff?: number;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const leave = leaveCopy({ isOwner: !!pubkey && pubkey === community.owner, otherStaff });

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
        toast({ title: leave.done });
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
            {mode === "dissolve" ? "Delete this group chat?" : leave.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            {mode === "dissolve"
              ? "This deletes the group chat for everyone and removes it from your devices. Members lose access. This can't be undone."
              : leave.body}
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
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : mode === "dissolve" ? "Delete" : leave.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
