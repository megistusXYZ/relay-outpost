/**
 * Pending direct invites (received 3313s) on the Outposts hub: a compact
 * "You're invited" card per invite with explicit Accept / Dismiss. Self-loads
 * from localStorage and refreshes on the concord-invite-received event the
 * DM pipeline fires when a new invite lands.
 */
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Lock, Check, X, Loader2 } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useConcordProfile } from "./ConcordIdentity";
import { listPendingInvites, removePendingInvite, adoptInviteBundle, type PendingInvite } from "@/lib/concord/concord-invites";
import { getCommunity } from "@/lib/concord/concord-keys";

export function ConcordPendingInvites({ onAccepted }: { onAccepted?: () => void }) {
  const { pubkey } = useNostrAuth();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const reload = useCallback(async () => {
    if (!pubkey) { setInvites([]); return; }
    const list = listPendingInvites(pubkey);
    // Drop invites for outposts we already joined (e.g. accepted on another tab).
    const filtered: PendingInvite[] = [];
    for (const inv of list) {
      const existing = await getCommunity(pubkey, inv.bundle.community_id).catch(() => null);
      if (existing) removePendingInvite(pubkey, inv.bundle.community_id);
      else filtered.push(inv);
    }
    setInvites(filtered);
  }, [pubkey]);

  useEffect(() => {
    void reload();
    const onNew = () => void reload();
    window.addEventListener("concord-invite-received", onNew);
    return () => window.removeEventListener("concord-invite-received", onNew);
  }, [reload]);

  const accept = async (inv: PendingInvite) => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer || busy) return;
    setBusy(inv.bundle.community_id);
    try {
      const record = await adoptInviteBundle(pubkey, signer, inv.bundle,
        (e, r) => publishEvent(e, r), (e) => publishEvent(e, inv.bundle.relays));
      if (!record) throw new Error("This invite didn't verify.");
      removePendingInvite(pubkey, inv.bundle.community_id);
      toast({ title: "Joined", description: record.name });
      onAccepted?.();
      setLocation(`/outposts/c/${record.community_id}`);
    } catch (err) {
      toast({ title: "Couldn't join", description: String((err as Error)?.message ?? err), variant: "destructive" });
      setBusy(null);
    }
  };

  const dismiss = (inv: PendingInvite) => {
    if (!pubkey) return;
    removePendingInvite(pubkey, inv.bundle.community_id);
    setInvites((prev) => prev.filter((p) => p.bundle.community_id !== inv.bundle.community_id));
  };

  if (!pubkey || invites.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="concord-pending-invites">
      {invites.map((inv) => (
        <InviteCard key={inv.bundle.community_id} invite={inv} busy={busy === inv.bundle.community_id}
          onAccept={() => accept(inv)} onDismiss={() => dismiss(inv)} />
      ))}
    </div>
  );
}

function InviteCard({ invite, busy, onAccept, onDismiss }: {
  invite: PendingInvite; busy: boolean; onAccept: () => void; onDismiss: () => void;
}) {
  const { name: fromName } = useConcordProfile(invite.from);
  const initials = (invite.bundle.name ?? "??").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-3" data-testid={`concord-invite-${invite.bundle.community_id.slice(0, 8)}`}>
      <Avatar className="w-10 h-10 border border-primary/30 shrink-0">
        <AvatarFallback className="bg-brand/25 text-brand text-xs font-bold">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate flex items-center gap-1.5">
          {invite.bundle.name ?? "Group chat"}
          <span className="inline-flex shrink-0" title="End-to-end encrypted" aria-label="End-to-end encrypted"><Lock className="w-3 h-3 text-muted-foreground/50" /></span>
        </p>
        <p className="text-[11px] text-muted-foreground/60 truncate"><span className="font-medium text-foreground/60">{fromName}</span> invited you</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={onAccept} disabled={busy} className="flex items-center gap-1 h-9 px-3 rounded-full bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50" data-testid="concord-invite-accept">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Join
        </button>
        <button onClick={onDismiss} disabled={busy} className="flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 disabled:opacity-50" title="Dismiss" data-testid="concord-invite-dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
