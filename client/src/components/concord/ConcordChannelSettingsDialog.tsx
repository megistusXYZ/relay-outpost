/**
 * Rename or delete a channel (owner/admin). Delete publishes a vsk-2 tombstone
 * so every member's fold drops the channel; the owner's local list updates
 * immediately.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDialogKeyboardFit } from "@/hooks/use-dialog-keyboard-fit";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { editChannel } from "@/lib/concord/concord-governance";
import type { ChannelMetadata } from "@/lib/concord/concord-events";
import { canPublishChannelEdition, type ChannelChanges, type ChannelHead } from "@/lib/concord/concord-channel-edition";
import type { StoredCommunity, StoredChannel } from "@/lib/concord/concord-keys";

export function ConcordChannelSettingsDialog({ open, onOpenChange, community, channel, onCommunityChange, govChannel, foldHead, channelCount }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  community: StoredCommunity;
  channel: StoredChannel | undefined;
  onCommunityChange: (c: StoredCommunity) => void;
  /** Live folded metadata for this channel — the base every unedited field is
   *  published from, and the only correct seed for the Name box: the stored
   *  record is a join-time snapshot for anyone who did not create the channel. */
  govChannel: ChannelMetadata | undefined;
  /** Live head of this channel's vsk-2 chain, so an edit chains onto what the
   *  relays hold rather than onto a per-device counter. */
  foldHead: ChannelHead | undefined;
  /** Size of the LIVE channel list, not the stored one — see canDelete. */
  channelCount: number;
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  // The fold goes BACKWARDS: useConcordGovernance clears its rumor maps when
  // `community` changes identity (a rekey does), so govChannel returns to
  // undefined mid-session. An emptied fold is a torn-down subscription, not a
  // deletion. Hold the last one we actually saw.
  const lastFolded = useRef<ChannelMetadata | undefined>(undefined);
  if (govChannel) lastFolded.current = govChannel;
  const folded = govChannel ?? lastFolded.current;
  const baseName = folded?.name ?? channel?.name ?? "";
  const ready = canPublishChannelEdition({ local: channel, govChannel: folded, foldHead });
  const [name, setName] = useState(baseName);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Mobile keyboard: top-anchor + cap to the visual viewport (see hook docs).
  const kbFit = useDialogKeyboardFit(open);

  useEffect(() => { if (open) { setName(baseName); setConfirmDelete(false); } }, [open, channel, baseName]);

  //  or absent, never false — there is no un-delete edition.
  const run = async (change: ChannelChanges) => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer || !channel || busy) return;
    setBusy(true);
    try {
      const relays = community.relays;
      const updated = await editChannel(signer, pubkey, community, channel.id, change,
        { channel: folded, head: foldHead },
        (e, r) => publishEvent(e, r), (e) => publishEvent(e, relays));
      onCommunityChange(updated);
      toast({ title: change.delete ? "Room deleted" : "Room renamed" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't update room", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Counts the LIVE list. Counting the stored one disabled Delete with "needs
  // at least one channel" while the drawer listed several.
  const canDelete = channelCount > 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className={cn("w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto", kbFit.className)} style={kbFit.style} onFocusCapture={kbFit.onFocusCapture}>
        <DialogHeader>
          <DialogTitle className="text-base">Room settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground/70">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run({ name: name.trim() }); }} data-testid="input-channel-name" />
          </div>
          {/* Say WHY it is disabled. A dead Save with no reason is its own
              defect, and "we don't know this channel's current details" really
              happens — permanently, to anyone who joined after a rekey. */}
          {!ready && (
            <p className="text-[11px] text-muted-foreground/60" data-testid="channel-settings-not-ready">
              Waiting for this channel's current details. Saving before they arrive would publish over whatever they turn out to be.
            </p>
          )}
          <Button onClick={() => run({ name: name.trim() })} disabled={!name.trim() || name.trim() === baseName || busy || !ready} className="w-full" data-testid="button-save-channel">
            {busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…</> : "Save"}
          </Button>

          <div className="pt-3 border-t border-border/20">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={!canDelete || busy || !ready}
                className="flex items-center gap-1.5 text-xs text-destructive hover:underline disabled:opacity-40 disabled:no-underline"
                data-testid="button-delete-channel"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete room
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground/70">Delete #{channel?.name}? Its messages become unreadable. This can't be undone.</p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy} className="text-xs">Cancel</Button>
                  <Button size="sm" onClick={() => run({ delete: true })} disabled={busy || !ready} className="text-xs bg-destructive hover:bg-destructive/90" data-testid="button-confirm-delete-channel">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                  </Button>
                </div>
              </div>
            )}
            {!canDelete && <p className="text-[10px] text-muted-foreground/40 mt-1">A group chat needs at least one room.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
