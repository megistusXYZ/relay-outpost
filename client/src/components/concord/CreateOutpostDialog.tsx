/**
 * Create a relay-less Concord group chat in seconds: name + optional avatar → done.
 * The "no relay required" moment — the whole point of the Concord integration.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDialogKeyboardFit } from "@/hooks/use-dialog-keyboard-fit";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { useToast } from "@/hooks/use-toast";
import { createCommunity } from "@/lib/concord/concord-community";
import { publishCommunityList, type StoredCommunity } from "@/lib/concord/concord-keys";
import { RoomImagePicker } from "./RoomImagePicker";
import createBg from "../../assets/images/create-bg.webp";

export function CreateOutpostDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /**
   * Take over what happens next. Set when the caller has something to do with
   * the fresh community before anyone sees it — inviting the person you started
   * it for, say. Providing this suppresses the default "land in the room with
   * the invite nudge open", because that nudge exists to solve exactly the
   * empty-room problem the caller is already solving.
   */
  onCreated?: (record: StoredCommunity) => void;
}) {
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  // Mobile keyboard: top-anchor + cap to the visual viewport so the Name/
  // Description fields never end up behind the iOS keyboard/AutoFill bar.
  const kbFit = useDialogKeyboardFit(open);

  const create = async () => {
    const signer = getGlobalSigner();
    if (!name.trim() || !pubkey || !signer) {
      toast({ title: "Sign in first", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const relays = getActiveDefaultRelays().slice(0, 5);
      const record = await createCommunity(
        signer, pubkey, { name: name.trim(), icon: icon.trim() || undefined, about: about.trim() || undefined, relays },
        (e, r) => publishEvent(e, r),
        (e) => publishEvent(e, relays),
      );
      onOpenChange(false);
      setName(""); setIcon(""); setAbout("");
      toast({ title: "Group chat created", description: record.name });
      if (onCreated) { onCreated(record); return; }
      // Land in the new group chat with the invite dialog open — an empty community
      // is a dead end, so nudge the creator to share a link immediately.
      setLocation(`/outposts/c/${record.community_id}?invite=1`);
    } catch (err) {
      toast({ title: "Couldn't create group chat", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("w-[calc(100vw-2rem)] max-w-md glass-dialog-card border-brand/15 max-h-[85vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 rounded-2xl sm:rounded-2xl", kbFit.className)} style={kbFit.style} onFocusCapture={kbFit.onFocusCapture}>
        {/* Same subtle space backdrop as the Create studio (photo/video/track)
            so the group-chat flow shares one visual language. Negative z keeps
            it behind the content and the close button; static gradients only —
            no fixed-attachment textures (PR #98 mobile-flicker rule). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
          <img
            src={createBg}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.12] dark:opacity-[0.24]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/25 via-background/60 to-background/92" />
          <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,rgba(139,92,246,0.14),transparent_70%)] dark:bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,rgba(139,92,246,0.22),transparent_70%)]" />
        </div>
        <DialogHeader className="-mx-4 sm:-mx-6 px-4 sm:px-6 pb-3.5 border-b border-brand/10 dark:border-white/[0.06]">
          <DialogTitle className="flex items-center gap-2 text-sm font-brand uppercase tracking-widest">
            <div className="w-7 h-7 rounded-lg bg-brand/10 dark:bg-brand/15 flex items-center justify-center shadow-sm">
              <Lock className="w-3.5 h-3.5 text-brand/70" />
            </div>
            New group chat
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground/60">
            An end-to-end-encrypted group chat on Nostr — no relay to run. You own the keys; members join by invite.
          </p>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground/70">Room image <span className="opacity-50">(optional)</span></label>
            <RoomImagePicker value={icon || undefined} onChange={(url) => setIcon(url ?? "")} fallback={name || "?"} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground/70">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Community" autoFocus onKeyDown={(e) => { if (e.key === "Enter") create(); }} data-testid="input-concord-name" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground/70">Description <span className="opacity-50">(optional)</span></label>
            <Textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} maxLength={500} placeholder="What's this group chat about?" className="resize-none text-sm" data-testid="input-concord-about" />
          </div>
          <Button onClick={create} disabled={!name.trim() || busy} className="w-full" data-testid="button-concord-create">
            {busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Creating…</> : "Create group chat"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Republish the 13302 backup — imported here so callers have one entry point. */
export { publishCommunityList };
