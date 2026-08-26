/**
 * What has been done in this space, and to whom.
 *
 * Extracted from ConcordMembers so the admin drawer's "Moderation history"
 * section and the members panel render the SAME thing. Mounting ConcordMembers
 * whole inside the drawer would have shown this twice — once as "People" and
 * again as its own section — and two copies of a moderation log are two things
 * that can disagree about what happened.
 *
 * Pure presentation over the governance fold: `auditLog` (kind-3314 rumors),
 * `events` (join/leave), and the folded banlist. No fetching, no authority
 * decisions — the CALLER decides whether the viewer may see this at all
 * (PERM.VIEW_AUDIT_LOG), because that gate belongs with the capability model,
 * not with the rendering.
 */
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Ban, ChevronDown, Hash, History, LogIn, LogOut, Settings2, Shield, ShieldCheck, ShieldOff, Trash2, UserMinus } from "lucide-react";
import { useConcordProfile } from "./ConcordIdentity";
import type { AuditEntry, AuditAction } from "@/lib/concord/concord-events";
import type { MembershipEvent } from "./useConcordGovernance";

/** One line in the activity log: a join / leave / banned entry with a name + when. */
function ActivityRow({ pubkey, kind, t }: { pubkey: string; kind: "join" | "leave" | "ban"; t?: number }) {
  const { name } = useConcordProfile(pubkey);
  const Icon = kind === "join" ? LogIn : kind === "leave" ? LogOut : Ban;
  const color = kind === "join" ? "text-emerald-500/70" : kind === "ban" ? "text-destructive/70" : "text-muted-foreground/50";
  const verb = kind === "join" ? "joined" : kind === "leave" ? "left" : "banned";
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70 px-0.5">
      <Icon className={`w-3 h-3 shrink-0 ${color}`} />
      <span className="font-medium text-foreground/70 truncate">{name}</span>
      <span className="shrink-0">{verb}</span>
      {t ? <span className="ml-auto shrink-0 text-muted-foreground/40">{formatDistanceToNow(new Date(t), { addSuffix: true })}</span> : null}
    </div>
  );
}

const AUDIT_META: Record<AuditAction, { icon: typeof Ban; color: string; verb: string; hasTarget: boolean }> = {
  ban: { icon: Ban, color: "text-destructive/70", verb: "banned", hasTarget: true },
  kick: { icon: UserMinus, color: "text-amber-500/70", verb: "removed", hasTarget: true },
  unban: { icon: ShieldCheck, color: "text-emerald-500/70", verb: "unbanned", hasTarget: true },
  make_admin: { icon: Shield, color: "text-primary/70", verb: "made admin", hasTarget: true },
  remove_admin: { icon: ShieldOff, color: "text-muted-foreground/60", verb: "removed admin from", hasTarget: true },
  rename_channel: { icon: Hash, color: "text-muted-foreground/60", verb: "renamed a channel to", hasTarget: false },
  delete_channel: { icon: Trash2, color: "text-destructive/70", verb: "deleted channel", hasTarget: false },
  edit_metadata: { icon: Settings2, color: "text-muted-foreground/60", verb: "edited the group chat", hasTarget: false },
  dissolve: { icon: Trash2, color: "text-destructive/70", verb: "dissolved the group chat", hasTarget: false },
};

/** One rich moderation-audit line: actor · action · target/detail · reason · when. */
function AuditRow({ entry }: { entry: AuditEntry }) {
  const { name: actorName } = useConcordProfile(entry.actor);
  const { name: targetName } = useConcordProfile(entry.target ?? "");
  const meta = AUDIT_META[entry.action];
  const Icon = meta?.icon ?? History;
  return (
    <div className="flex items-start gap-2 text-[11px] text-muted-foreground/70 px-0.5">
      <Icon className={`w-3 h-3 shrink-0 mt-0.5 ${meta?.color ?? "text-muted-foreground/50"}`} />
      <div className="min-w-0 flex-1">
        <p className="leading-snug">
          <span className="font-medium text-foreground/70">{actorName}</span>{" "}
          <span>{meta?.verb ?? entry.action}</span>
          {meta?.hasTarget && entry.target ? <> <span className="font-medium text-foreground/70">{targetName}</span></> : null}
          {!meta?.hasTarget && entry.detail ? <> <span className="font-medium text-foreground/70">{entry.detail}</span></> : null}
        </p>
        {entry.reason && <p className="text-muted-foreground/45 italic truncate">“{entry.reason}”</p>}
      </div>
      <span className="shrink-0 text-muted-foreground/40">{formatDistanceToNow(new Date(entry.t * 1000), { addSuffix: true })}</span>
    </div>
  );
}

export interface ConcordActivityLogProps {
  auditLog: AuditEntry[];
  events: MembershipEvent[];
  banned: string[];
  /**
   * Members-panel usage folds this behind a disclosure so a roster stays a
   * roster. The drawer already put the viewer inside a section called
   * "Moderation history", so a second thing to click would be a door to a room
   * they are standing in.
   */
  collapsible?: boolean;
}

export function ConcordActivityLog({ auditLog, events, banned, collapsible = false }: ConcordActivityLogProps) {
  const [open, setOpen] = useState(!collapsible);
  const empty = auditLog.length === 0 && events.length === 0 && banned.length === 0;

  // Self-hiding when collapsed inside the roster (the old behaviour), but the
  // drawer says so out loud: a section that renders nothing reads as broken when
  // the viewer navigated to it deliberately.
  if (empty) {
    return collapsible ? null : (
      <p className="text-xs text-muted-foreground/60">Nothing has happened here yet.</p>
    );
  }

  return (
    <div className={collapsible ? "pt-2 border-t border-border/20" : ""}>
      {collapsible && (
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 w-full py-1.5 md:py-0 text-left" data-testid="concord-activity-toggle">
          <History className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">Activity</span>
          {banned.length > 0 && <span className="text-[10px] text-destructive/70">{banned.length} banned</span>}
          <ChevronDown className={`w-3.5 h-3.5 ml-auto text-muted-foreground/40 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {open && (
        <div className={collapsible ? "mt-2 space-y-2" : "space-y-2"}>
          {banned.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-destructive/60">Banned</p>
              {banned.map((pk) => <ActivityRow key={pk} pubkey={pk} kind="ban" />)}
            </div>
          )}
          {auditLog.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Moderation</p>
              {auditLog.slice(0, 50).map((a) => <AuditRow key={a.id} entry={a} />)}
            </div>
          )}
          {events.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Joins &amp; leaves</p>
              {events.slice(0, 50).map((e, i) => <ActivityRow key={i} pubkey={e.pubkey} kind={e.action} t={e.t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
