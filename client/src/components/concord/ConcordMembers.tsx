/**
 * Concord community roster (CORD-04). Live-folds the control + guestbook planes
 * into a member list; the owner can remove or ban a member — which fires the
 * CORD-06 rekey that actually cuts their access, with a progress indicator.
 */
import { useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { Crown, ShieldCheck, UserMinus, Ban, Loader2, Users, Shield, ShieldOff, History, LogIn, LogOut, ChevronDown, Hash, Trash2, Settings2 } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { useConcordProfile } from "./ConcordIdentity";
import { PersonBadges } from "@/components/PersonBadges";
import { useConcordGovernance } from "./useConcordGovernance";
import { ConcordActivityLog } from "./ConcordActivityLog";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import { hasPermission, canActOn, PERM, VSK, OWNER_POSITION, type Member, type AuditEntry, type AuditAction } from "@/lib/concord/concord-events";
import { removeMember, setAdmin, ADMIN_ROLE_ID } from "@/lib/concord/concord-governance";
import { BANLIST_EID } from "@/lib/concord/concord-banlist";

export function ConcordMembers({ community, onCommunityChange, showActivity = true }: {
  community: StoredCommunity; onCommunityChange: (c: StoredCommunity) => void;
  /** False when the admin drawer renders the log as its own "Moderation history"
   *  section — otherwise the same log appears twice in one drawer. */
  showActivity?: boolean;
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const { state, roster, myMember, events, auditLog } = useConcordGovernance(community);
  const [pending, setPending] = useState<{ target: string; ban: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const isOwner = pubkey === community.owner;
  // Owner + admins see the activity log + banned list; members see neither.
  const canAudit = isOwner || (!!myMember && hasPermission(myMember, PERM.VIEW_AUDIT_LOG));
  const banned = [...state.banlist];

  const doRemove = useCallback(async () => {
    const signer = getGlobalSigner();
    if (!pending || !pubkey || !signer) return;
    const target = pending.target; const ban = pending.ban;
    setProgress({ done: 0, total: roster.length });
    try {
      // The UNION, not the enforced set. If a fork left someone banned by an
      // edition that lost the fold's tie-break, this ban puts them back — the
      // only chance to heal it, since nothing else ever rewrites the coordinate.
      const banlist = [...state.banlistSeen];
      const updated = await removeMember(
        signer, pubkey, community, target,
        {
          ban, currentBanlist: banlist, roster, reason: reason.trim() || undefined,
          // The head the relays actually hold — NOT a literal version. The
          // banlist is multi-writer, so this device's own history is only a
          // floor (removeMember reads that from the community record).
          banHead: state.heads.get(`${VSK.BANLIST}:${BANLIST_EID}`),
        },
        (e, r) => publishEvent(e, r),
        (done, total) => setProgress({ done, total }),
      );
      if (updated) { onCommunityChange(updated); toast({ title: ban ? "Member banned" : "Member removed", description: "Keys rotated." }); }
      else toast({ title: "Couldn't complete removal", variant: "destructive" });
    } catch (err) {
      toast({ title: "Removal failed", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setPending(null); setReason(""); setProgress(null);
    }
  }, [pending, pubkey, community, roster, state, reason, onCommunityChange, toast]);

  const [adminBusy, setAdminBusy] = useState<string | null>(null);
  const [pendingAdmin, setPendingAdmin] = useState<{ target: string; make: boolean } | null>(null);
  const doSetAdmin = useCallback(async (target: string, makeAdmin: boolean) => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer) return;
    setAdminBusy(target);
    try {
      const updated = await setAdmin(signer, pubkey, community, target, makeAdmin,
        // Same reason the ban above passes `banHead`: the local grant cursor is
        // only written by the device that published, so a second device would
        // restart this member's chain at v1 — onto a coordinate that already
        // holds one, where the loser's payload is simply discarded.
        state.heads.get(`${VSK.GRANT}:${target}`), state.heads.size > 0,
        (e, r) => publishEvent(e, r), (e) => publishEvent(e, community.relays));
      onCommunityChange(updated);
      toast({ title: makeAdmin ? "Made admin" : "Removed admin" });
    } catch (err) {
      toast({ title: "Couldn't update role", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setAdminBusy(null); setPendingAdmin(null);
    }
    // `state` IS a dependency — it is read two lines up, and it is the one value
    // here that arrives late. Omitting it froze this callback on the render that
    // created it: every other dep is referentially stable (`onCommunityChange`
    // is a useState setter at both call sites, `toast` is module-level), so that
    // render was the mount, when the edition map is still empty. `foldArrived`
    // was therefore false forever and the owner could never promote anyone —
    // "Couldn't update role — grant chain head unknown", permanently, with
    // waiting and retrying no help. `doRemove` above reads the same fold and got
    // this right, which is why banning worked while granting never did.
  }, [pubkey, community, state, onCommunityChange, toast]);

  // My own rank/permissions decide what I can do. Admins moderate members they
  // outrank; only the owner grants/revokes admin.
  const myRank = isOwner ? OWNER_POSITION : (myMember?.rank ?? Infinity);
  const canModerate = (target: Member) =>
    target.pubkey !== pubkey && canActOn(myRank, target.rank) &&
    (isOwner || (!!myMember && (hasPermission(myMember, PERM.KICK) || hasPermission(myMember, PERM.BAN))));
  const canToggleAdmin = (target: Member) =>
    isOwner && target.pubkey !== pubkey && target.rank !== OWNER_POSITION;

  return (
    <div className="rounded-xl border border-border/30 p-4 space-y-3" data-testid="concord-members">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-brand/70" />
        <p className="text-sm font-semibold">Members</p>
        <span className="text-[11px] text-muted-foreground/40">{roster.length}</span>
      </div>

      {roster.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 py-4 text-center">Loading roster…</p>
      ) : (
        <div className="space-y-1.5">
          {roster.sort((a, b) => a.rank - b.rank).map((m) => (
            <MemberRow key={m.pubkey} member={m} isSelf={m.pubkey === pubkey}
              isAdmin={m.roleIds.includes(ADMIN_ROLE_ID)}
              canModerate={canModerate(m)}
              canToggleAdmin={canToggleAdmin(m)}
              adminBusy={adminBusy === m.pubkey}
              onRemove={() => setPending({ target: m.pubkey, ban: false })}
              onBan={() => setPending({ target: m.pubkey, ban: true })}
              onToggleAdmin={(make) => setPendingAdmin({ target: m.pubkey, make })} />
          ))}
        </div>
      )}

      {/* Moderation history. Suppressed when the admin drawer renders it as its
          own section — one log, not two that can disagree. */}
      {canAudit && showActivity && (
        <ConcordActivityLog auditLog={auditLog} events={events} banned={banned} collapsible />
      )}

      {/* Above the admin drawer (z-[200]) and its sub-panels (z-[210]).
          A confirm is the last thing that should ever be underneath something:
          Radix locks pointer events while it is open, so a modal rendering
          behind an overlay does not merely look wrong — the page stops
          responding, with the dimmed confirm visible but unreachable. This is
          the same failure ui/alert-dialog's overlayClassName was added for when
          the channel room frame (z-[60]) hit it. */}
      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o && !progress) { setPending(null); setReason(""); } }}>
        <AlertDialogContent className="max-w-sm z-[220]" overlayClassName="z-[219]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">{pending?.ban ? "Ban this member?" : "Remove this member?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {pending?.ban ? "They'll be banned and " : "They'll be removed and "} the community keys will be rotated so they lose access to future messages. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {progress ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground/70">
              <Loader2 className="w-4 h-4 animate-spin" /> Re-securing keys… {progress.done}/{progress.total}
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground/70">Reason <span className="opacity-50">(optional, shown in the audit log)</span></label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} placeholder="Why?" className="resize-none text-xs" data-testid="input-remove-reason" />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={doRemove} className="text-xs bg-destructive hover:bg-destructive/90">{pending?.ban ? "Ban" : "Remove"}</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingAdmin} onOpenChange={(o) => { if (!o && !adminBusy) setPendingAdmin(null); }}>
        <AlertDialogContent className="max-w-sm z-[220]" overlayClassName="z-[219]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">{pendingAdmin?.make ? "Make this member an admin?" : "Remove admin from this member?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {pendingAdmin?.make
                ? "Admins can manage channels, create invites, edit the group chat, and remove or ban members. You can undo this anytime."
                : "They'll lose admin powers and become a regular member."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs" disabled={!!adminBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (pendingAdmin) doSetAdmin(pendingAdmin.target, pendingAdmin.make); }}
              disabled={!!adminBusy}
              className="text-xs"
            >
              {adminBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pendingAdmin?.make ? "Make admin" : "Remove admin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemberRow({ member, isSelf, isAdmin, canModerate, canToggleAdmin, adminBusy, onRemove, onBan, onToggleAdmin }: {
  member: Member; isSelf: boolean; isAdmin: boolean; canModerate: boolean; canToggleAdmin: boolean;
  adminBusy: boolean; onRemove: () => void; onBan: () => void; onToggleAdmin: (make: boolean) => void;
}) {
  const { name, avatar, hasProfile, nip05, claimedName } = useConcordProfile(member.pubkey);
  const owner = member.rank === OWNER_POSITION;
  const joined = member.joinedAt > 0 ? `joined ${formatDistanceToNow(new Date(member.joinedAt), { addSuffix: true })}` : null;
  const npub = useMemo(() => { try { return nip19.npubEncode(member.pubkey); } catch { return ""; } }, [member.pubkey]);
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/20 transition-colors group">
      {/* Avatar + name click through to the member's profile so people can
          connect; moderation controls stay OUTSIDE the link. */}
      <Link
        href={npub ? `/profile/${npub}` : "#"}
        className="flex items-center gap-2.5 flex-1 min-w-0 no-underline rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={`View ${name}'s profile`}
        data-testid={`concord-member-profile-${member.pubkey.slice(0, 8)}`}
      >
        <Avatar className="w-8 h-8 border border-border/30 shrink-0">
          {avatar && <AvatarImage src={avatar} alt={name} />}
          <AvatarFallback className="text-[10px] bg-brand/10 text-brand font-semibold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate flex items-center gap-1.5 group-hover:text-brand transition-colors">
            <span className="truncate">{name}</span>
            {/* Positive-only: a check when a domain vouches for the key, a warning
                only for a real name collision, nothing otherwise. Never
                "Unverified" — absence of data is not an accusation. Collision
                checking is off without a real kind-0, since `name` would be an
                npub. */}
            <PersonBadges pubkey={member.pubkey} nip05={nip05} claimedName={claimedName} showCollision={hasProfile} />
            {isSelf && <span className="text-[9px] text-brand/60">you</span>}
          </p>
          <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1 min-w-0">
            <span className="flex items-center gap-1 shrink-0">{owner ? <><Crown className="w-2.5 h-2.5 text-amber-500/70" /> Owner</> : isAdmin ? <><Shield className="w-2.5 h-2.5 text-brand/60" /> Admin</> : "Member"}</span>
            {joined && <span className="truncate">· {joined}</span>}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-1 reveal-on-hover">
        {canToggleAdmin && (
          adminBusy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50 mx-1.5" />
            : isAdmin
              ? <button onClick={() => onToggleAdmin(false)} className="p-2.5 md:p-1.5 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground" title="Remove admin" data-testid={`concord-demote-${member.pubkey.slice(0, 8)}`}><ShieldOff className="w-3.5 h-3.5" /></button>
              : <button onClick={() => onToggleAdmin(true)} className="p-2.5 md:p-1.5 rounded hover:bg-brand/10 text-muted-foreground/50 hover:text-brand" title="Make admin" data-testid={`concord-promote-${member.pubkey.slice(0, 8)}`}><Shield className="w-3.5 h-3.5" /></button>
        )}
        {canModerate && (
          <>
            <button onClick={onRemove} className="p-2.5 md:p-1.5 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground" title="Remove" data-testid={`concord-remove-${member.pubkey.slice(0, 8)}`}><UserMinus className="w-3.5 h-3.5" /></button>
            <button onClick={onBan} className="p-2.5 md:p-1.5 rounded hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive" title="Ban" data-testid={`concord-ban-${member.pubkey.slice(0, 8)}`}><Ban className="w-3.5 h-3.5" /></button>
          </>
        )}
      </div>
    </div>
  );
}
