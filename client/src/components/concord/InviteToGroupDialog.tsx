/**
 * Bring a specific person into one of your group chats — the inverse of
 * ConcordInviteDialog.
 *
 * Every other invite flow starts inside a community and searches for a person.
 * This one starts from the person (you're on their profile) and picks the
 * community, which is the direction you actually want when someone turns out to
 * be worth knowing. Same wire path as the in-community invite: a gift-wrapped
 * kind-3313 to their inbox relays, logged to the local sent-invite history so
 * you can see you already asked.
 *
 * Presented as a bottom drawer on mobile and a centred dialog on desktop (the
 * ShareEventDialog shell), because it's a list you thumb through on a phone.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Send, Check, Users, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { formatCompactTime } from "@/lib/time";
import { useGroupChats } from "@/pages/messages/useGroupChats";
import { sendDirectInvite } from "@/lib/concord/concord-invites";
import { invitableCommunities, isTrustedInviteTarget } from "@/lib/concord/concord-invite-targets";
import { canInviteToCommunity } from "@/lib/concord/concord-invite-gate";
import { useConcordGovernance } from "./useConcordGovernance";
import { listSentInvites, recordSentInvite } from "@/lib/concord/concord-sent-invites";
import { CreateOutpostDialog } from "./CreateOutpostDialog";
import type { StoredCommunity } from "@/lib/concord/concord-keys";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Who you're inviting (hex). */
  recipientPubkey: string;
  recipientName: string;
}

export function InviteToGroupDialog(props: Props) {
  const isMobile = useIsMobile();
  const { open, onOpenChange, recipientName } = props;
  const title = `Invite ${recipientName} to…`;
  const blurb = "They'll get a private invite they can accept whenever they like.";

  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle className="text-base">{title}</DrawerTitle>
              <DrawerDescription className="text-xs">{blurb}</DrawerDescription>
            </DrawerHeader>
            <div className="px-4 pb-[max(env(safe-area-inset-bottom,0px),1.25rem)]">
              <InviteTargetList {...props} />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-xs">{blurb}</DialogDescription>
        </DialogHeader>
        <InviteTargetList {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** The shared body — identical in the drawer and the dialog. */
function InviteTargetList({ onOpenChange, recipientPubkey, recipientName, open }: Props) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { groups, reload } = useGroupChats(pubkey);
  const [sending, setSending] = useState<string | null>(null);
  /** Armed by tapping Invite; an invite hands over the group's keys, so it asks first. */
  const [pending, setPending] = useState<StoredCommunity | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** community_id → when we last invited this person there. */
  const [invited, setInvited] = useState<Record<string, number>>({});

  const targets = useMemo(() => invitableCommunities(groups, pubkey), [groups, pubkey]);

  // The list is drawn from the stored record, which is cheap and stale. Before
  // an invite actually goes we fold the ONE community the user picked and ask
  // the same question the in-community path asks — this send path had no
  // permission check at all, so a member whose record still said "invites are
  // open" could hand out the community root after the owner closed them, or
  // after being removed.
  //
  // `pending` is null until a row is tapped, so this costs nothing until then.
  // Owners never wait: canInviteToCommunity decides ownership locally.
  const { state: pendingGov, myMember: pendingMember } = useConcordGovernance(pending);
  const pendingTrusted = !!pending && isTrustedInviteTarget(pending, pubkey);
  const pendingAllowed = pendingTrusted || canInviteToCommunity({
    community: pending, pubkey, myMember: pendingMember, govMetadata: pendingGov.metadata,
  });

  // "You already asked" comes from the local sent log — the roster isn't on the
  // stored record, so claiming they're *in* a group would be a guess.
  useEffect(() => {
    if (!open || !pubkey) return;
    const map: Record<string, number> = {};
    for (const c of targets) {
      const hit = listSentInvites(pubkey, c.community_id).find((s) => s.recipient === recipientPubkey);
      if (hit) map[c.community_id] = hit.at;
    }
    setInvited(map);
  }, [open, pubkey, targets, recipientPubkey]);

  const invite = useCallback(async (community: StoredCommunity, opts?: { thenOpen?: boolean; allowed?: boolean }) => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer) { toast({ title: "Sign in to invite", variant: "destructive" }); return; }
    // The check lives at the CHOKE POINT, not only on the buttons. `allowed`
    // carries a verdict a caller has already proved against the live fold; with
    // none, this falls back to the strictest local answer — ownership — so a
    // caller added later gets the safe default instead of a hole.
    if (!(opts?.allowed ?? isTrustedInviteTarget(community, pubkey))) {
      toast({ title: "You can't invite to this group", description: "Its invite setting may have changed.", variant: "destructive" });
      return;
    }
    setSending(community.community_id);
    try {
      const ok = await sendDirectInvite(signer, pubkey, recipientPubkey, community, (e, r) => publishEvent(e, r));
      if (!ok) { toast({ title: "Couldn't send the invite", variant: "destructive" }); return; }
      const at = Date.now();
      recordSentInvite(pubkey, community.community_id, { recipient: recipientPubkey, at, name: recipientName });
      setInvited((prev) => ({ ...prev, [community.community_id]: at }));
      toast({ title: `Invited ${recipientName}`, description: community.name });
      // Fresh group: you made it FOR this person, so go be in it.
      if (opts?.thenOpen) { onOpenChange(false); setLocation(`/outposts/c/${community.community_id}`); }
    } catch (err) {
      toast({ title: "Couldn't send the invite", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setSending(null);
    }
  }, [pubkey, recipientPubkey, recipientName, toast, onOpenChange, setLocation]);

  return (
    <>
      {targets.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-2 py-5">
          <Users className="w-8 h-8 text-muted-foreground/25" />
          <p className="text-sm text-muted-foreground/70">No group chats yet</p>
          <p className="text-xs text-muted-foreground/50 max-w-[16rem]">
            Start one and {recipientName} gets the first invite.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="mt-1 w-full h-11 md:h-9 gap-1.5" data-testid="invite-create-group">
            <Plus className="w-4 h-4" /> New group chat
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {targets.map((c) => {
            const at = invited[c.community_id];
            const busy = sending === c.community_id;
            return (
              <div key={c.community_id} className="flex items-center gap-2.5 min-h-11 md:min-h-0 py-1.5" data-testid={`invite-target-${c.community_id.slice(0, 8)}`}>
                <Avatar className="w-8 h-8 shrink-0 border border-border/30">
                  {c.icon && <AvatarImage src={c.icon} alt="" />}
                  <AvatarFallback className="text-[10px] bg-brand/10 text-brand font-semibold">
                    {c.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{c.name}</p>
                  {at && <p className="text-[11px] text-muted-foreground/50">Invited {formatCompactTime(at)}</p>}
                </div>
                <Button
                  size="sm"
                  variant={at ? "outline" : "default"}
                  disabled={busy}
                  onClick={() => setPending(c as StoredCommunity)}
                  className="h-11 md:h-8 px-3 shrink-0 text-xs"
                  data-testid={`invite-send-${c.community_id.slice(0, 8)}`}
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : at ? <><Check className="w-3.5 h-3.5 mr-1" /> Again</>
                    : <><Send className="w-3.5 h-3.5 mr-1" /> Invite</>}
                </Button>
              </div>
            );
          })}
          {/* Starting fresh is a peer of picking an existing group, not a
              fallback — sometimes the point is a room just for the two of you. */}
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2.5 min-h-11 md:min-h-9 mt-1 pt-2 border-t border-border/30 text-left text-brand"
            data-testid="invite-create-group"
          >
            <span className="flex items-center justify-center w-8 h-8 shrink-0 rounded-full bg-primary/10">
              <Plus className="w-4 h-4" />
            </span>
            <span className="text-sm font-medium">New group chat with {recipientName}</span>
          </button>
        </div>
      )}

      {/* An invite carries the group's keys — it can't be taken back without
          rekeying the whole community, so it asks before it goes. */}
      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Invite {recipientName} to {pending?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              They'll be able to read this group and everything posted in it from here on.
              You can remove them later, but you can't un-send an invite.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Say what we are waiting for. A dead confirm button with no reason
              is its own defect, and "this group's invite setting may have
              changed since your device last heard from it" is the true one. */}
          {!pendingAllowed && (
            <p className="text-[11px] text-muted-foreground/60" data-testid="invite-target-not-ready">
              Checking whether this group still lets members invite. If it doesn't, ask an admin to send this one.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingAllowed}
              onClick={() => { const c = pending; setPending(null); if (c) void invite(c, { allowed: true }); }}
              className="text-xs"
              data-testid="invite-confirm"
            >
              Send invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Creating here skips the usual "empty room, go invite someone" nudge —
          the whole point is that we invite them the moment it exists. */}
      <CreateOutpostDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(record) => { reload(); void invite(record, { thenOpen: true }); }}
      />
    </>
  );
}
