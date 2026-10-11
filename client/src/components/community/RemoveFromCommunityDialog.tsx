import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { removalWords, type RemovalKind } from "@/lib/community-removal";

/**
 * One confirmation for every admin removal in a community: a post, a topic,
 * a comment, or banning a person. The words say what happens and that the
 * author will hear (lib/community-removal.ts). The reason is for the log.
 */
export function RemoveFromCommunityDialog({ open, kind, communityName, reason, onReasonChange, busy, onConfirm, onOpenChange }: {
  open: boolean;
  kind: RemovalKind;
  communityName: string;
  reason: string;
  onReasonChange: (v: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const words = removalWords(kind, communityName);
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o && !busy) onOpenChange(o); }}>
      <AlertDialogContent className="glass-dialog-card max-w-sm" data-testid="dialog-remove-from-community">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm font-brand tracking-wide">{words.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-xs text-muted-foreground/70">{words.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Reason (optional, for your log)"
          className="text-base sm:text-sm"
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) onConfirm(); }}
          data-testid="input-mod-reason"
        />
        <AlertDialogFooter>
          <AlertDialogCancel className="h-8 text-xs" disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            className="h-8 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={busy}
            data-testid="button-confirm-mod-action"
          >
            {busy ? "Working…" : words.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
