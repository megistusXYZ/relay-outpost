/**
 * Create a Concord channel: a public (community-derived key) or private (sealed,
 * independent key) text channel — plus a greyed "Voice" type reserved for
 * CORD-07 (Phase 3). Private channels distribute their key to the current
 * roster via a channel-scoped rekey, so the dialog collects the roster from the
 * governance planes while open.
 */
import { useEffect, useMemo, useState } from "react";
import { Hash, Lock, Mic, Loader2 } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { persistentPoolSubscribe, publishEvent } from "@/lib/nostr";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useDialogKeyboardFit } from "@/hooks/use-dialog-keyboard-fit";
import { useToast } from "@/hooks/use-toast";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import { createChannel } from "@/lib/concord/concord-community";
import { createPrivateChannel } from "@/lib/concord/concord-governance";
import { subscribeGovernance } from "@/lib/concord/concord-stream";
import { parseControlEdition, editionKey, foldEditions, computeRoster, KIND_CONTROL_EDITION, KIND_JOIN_LEAVE, type ControlEdition } from "@/lib/concord/concord-events";

type ChannelType = "text" | "private" | "voice";

export function ConcordCreateChannelDialog({ open, onOpenChange, community, onCommunityChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  community: StoredCommunity;
  onCommunityChange: (c: StoredCommunity) => void;
  onCreated: (channelId: string) => void;
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("text");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Mobile keyboard: top-anchor + cap to the visual viewport (see hook docs).
  const kbFit = useDialogKeyboardFit(open);

  // Collect the roster while the dialog is open (only needed for private channels).
  const [editions, setEditions] = useState<Map<string, ControlEdition>>(new Map());
  const [joinLeave, setJoinLeave] = useState<Map<string, { pubkey: string; created_at: number; tags: string[][] }>>(new Map());
  useEffect(() => {
    if (!open || !pubkey) return;
    setEditions(new Map()); setJoinLeave(new Map());
    const sub = subscribeGovernance(pubkey, community, (rumor) => {
      if (rumor.kind === KIND_CONTROL_EDITION) {
        const ed = parseControlEdition(rumor);
        // Same key as the governance hook — and it must be, because this roster
        // decides who receives a PRIVATE channel key. Keyed on coordinate+version
        // alone, two banlist editions collided here too (last delivery winning
        // outright, with no dedup guard), so a banned member could reappear in
        // the roster and be handed the key.
        if (ed) setEditions((p) => (p.has(editionKey(ed)) ? p : new Map(p).set(editionKey(ed), ed)));
      } else if (rumor.kind === KIND_JOIN_LEAVE) {
        setJoinLeave((p) => new Map(p).set(rumor.id, rumor));
      }
    }, (relays, filter, onevent) => persistentPoolSubscribe(relays, filter, { onevent }));
    return () => sub.close();
  }, [open, pubkey, community]);

  const roster = useMemo(
    () => computeRoster([...joinLeave.values()], foldEditions([...editions.values()], community.owner), community.owner),
    [editions, joinLeave, community.owner],
  );

  const submit = async () => {
    const trimmed = name.trim();
    const signer = getGlobalSigner();
    if (!trimmed || !pubkey || !signer || busy) return;
    setBusy(true);
    try {
      let updated: StoredCommunity;
      if (type === "private") {
        setProgress({ done: 0, total: roster.length });
        updated = await createPrivateChannel(signer, pubkey, community, { name: trimmed, roster },
          (e, relays) => publishEvent(e, relays), (done, total) => setProgress({ done, total }));
      } else {
        const wr = community.relays;
        updated = await createChannel(signer, pubkey, community, { name: trimmed },
          (e, relays) => publishEvent(e, relays), (e) => publishEvent(e, wr));
      }
      onCommunityChange(updated);
      onCreated(updated.channels[updated.channels.length - 1].id);
      toast({ title: type === "private" ? "Private channel created" : "Channel created" });
      onOpenChange(false);
      setName(""); setType("text");
    } catch (err) {
      toast({ title: "Couldn't create room", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className={cn("w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto", kbFit.className)} style={kbFit.style} onFocusCapture={kbFit.onFocusCapture}>
        <DialogHeader>
          <DialogTitle className="text-base">New room</DialogTitle>
          <DialogDescription className="text-xs">Pick a type and give it a name.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {([
            ["text", "Text", Hash, "Anyone in the group"],
            ["private", "Private", Lock, "Sealed for members"],
            ["voice", "Voice", Mic, "Coming soon"],
          ] as const).map(([key, label, Icon, sub]) => {
            const disabled = key === "voice";
            const active = type === key;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setType(key)}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-colors ${
                  active ? "border-primary/40 bg-primary/10" : "border-border/30 hover:border-border/60"
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                data-testid={`concord-channel-type-${key}`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{label}</span>
                <span className="text-[9px] text-muted-foreground/50 leading-tight">{sub}</span>
              </button>
            );
          })}
        </div>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="room-name"
          className="w-full h-10 px-3 rounded-lg bg-muted/20 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          data-testid="concord-channel-name"
        />

        {type === "private" && (
          <p className="text-[11px] text-muted-foreground/55 flex items-center gap-1.5">
            <Lock className="w-3 h-3 shrink-0" /> The key goes to the current {roster.length} member{roster.length !== 1 ? "s" : ""}. New members get it on their next invite.
          </p>
        )}

        <button
          onClick={submit}
          disabled={!name.trim() || busy}
          className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
          data-testid="concord-channel-create"
        >
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" />{progress ? `Sealing… ${progress.done}/${progress.total}` : "Creating…"}</> : "Create room"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
