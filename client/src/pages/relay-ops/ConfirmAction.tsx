/**
 * "Remove 214 posts from Harbour Club?" / "Ban Bob from Harbour Club?" — the
 * one confirmation for acting on a relay (Content and People share it).
 *
 * A reason is optional for one, required for many or for a whole search; a
 * whole search or more than 25 needs the count typed back (content-model.ts).
 * It stays open, showing progress, until the relay has answered every one.
 */
import { useState } from "react";
import { Ban, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { confirmPhrase, reasonRequired, removalReason, REMOVAL_REASONS, typedConfirmRequired } from "./content-model";

export type PendingAction =
  | { kind: "remove"; ids: string[]; rule: boolean }
  | { kind: "ban"; pubkeys: string[]; rule: boolean };

export function ConfirmAction({ pending, relayName, canRestore, progress, onCancel, onConfirm, nameOf }: {
  pending: PendingAction; relayName: string; canRestore: boolean; progress: { done: number; total: number } | null;
  onCancel: () => void; onConfirm: (reason: string | undefined) => void; nameOf: (pk: string) => string | undefined;
}) {
  const [pick, setPick] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const removing = pending.kind === "remove";
  const count = removing ? pending.ids.length : pending.pubkeys.length;
  const needReason = reasonRequired(count, pending.rule);
  const needTyping = typedConfirmRequired(count, pending.rule);
  const phrase = removing ? confirmPhrase(count) : `ban ${count}`;
  const reason = removalReason(pick, note);
  const ready = (!needReason || !!reason) && (!needTyping || typed.trim().toLowerCase() === phrase);
  const one = removing ? "this post" : (nameOf(pending.pubkeys[0]) ?? "this person");
  const title = removing
    ? count === 1 ? `Remove ${one} from ${relayName}?` : `Remove ${count} posts from ${relayName}?`
    : count === 1 ? `Ban ${one} from ${relayName}?` : `Ban ${count} people from ${relayName}?`;
  const body = removing
    ? `People using ${relayName} won't see ${count === 1 ? "it" : "them"}. ${canRestore ? "You can bring them back from Removed." : "This relay can't bring removed posts back from here."}`
    : `They won't be able to post on ${relayName}. What they've already posted stays unless you remove it.`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md" data-testid="ops-content-confirm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Reason {needReason ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}</p>
          <div className="flex flex-wrap gap-1.5">
            {REMOVAL_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setPick(pick === r ? undefined : r)} aria-pressed={pick === r} data-testid={`ops-content-reason-${r.toLowerCase().replace(/\s+/g, "-")}`}
                className={`h-9 px-3 rounded-full text-[13px] font-medium ${pick === r ? "bg-brand text-white" : "bg-black/[0.05] dark:bg-white/[0.06]"}`}>
                {r}
              </button>
            ))}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="h-10" data-testid="ops-content-reason-note" />
          {pending.rule && <p className="text-[12px] text-muted-foreground">This covers everything your search found, not just what you picked.</p>}
        </div>
        {needTyping && (
          <label className="block space-y-1.5">
            <span className="text-[13px]">Type <strong className="font-mono">{phrase}</strong> to confirm</span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="h-10" data-testid="ops-content-confirm-typed" />
          </label>
        )}
        {progress && (
          <p className="text-[13px] text-muted-foreground" role="status" data-testid="ops-content-progress">
            {removing ? "Removing" : "Banning"} {progress.done} of {progress.total}…
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={!!progress} className="h-11 rounded-full">Cancel</Button>
          <Button onClick={() => onConfirm(reason)} disabled={!ready || !!progress} className={`h-11 rounded-full ${removing ? "bg-red-600 hover:bg-red-700 text-white" : ""}`} data-testid="ops-content-confirm-go">
            {progress ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : removing ? <Trash2 className="w-4 h-4 mr-2" /> : <Ban className="w-4 h-4 mr-2" />}
            {removing ? (count === 1 ? "Remove" : `Remove ${count}`) : (count === 1 ? "Ban" : `Ban ${count}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
