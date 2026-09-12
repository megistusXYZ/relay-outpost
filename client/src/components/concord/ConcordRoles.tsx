/**
 * The group's roles (CORD-04 §2–§3): who ranks where and what each may do, in
 * plain words. Anyone who can manage roles makes roles below themselves and
 * edits the ones they outrank; the rest are shown, not offered.
 */
import { useMemo, useState } from "react";
import { Loader2, Plus, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { createRole, editRole } from "@/lib/concord/concord-governance";
import { grantableRoles, newRolePosition, withChoices, MODERATOR_PRESET, ROLE_PERMISSION_CHOICES } from "@/lib/concord/concord-roles";
import { OWNER_POSITION, STAFF_PERMS, VSK, type Role } from "@/lib/concord/concord-events";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import { useConcordGovernance } from "./useConcordGovernance";
import { SpaceAdminAction } from "@/components/space/SpaceAdminSection";

/** A small, legible palette; 0 means the theme's own color (CORD-04 §2). */
const ROLE_COLORS = [0, 0x3b82f6, 0x10b981, 0xf59e0b, 0xef4444, 0x8b5cf6, 0xec4899];
const hexColor = (c?: number) => (c ? `#${c.toString(16).padStart(6, "0")}` : undefined);
const byRank = (a: Role, b: Role) => a.position - b.position || (a.role_id < b.role_id ? -1 : 1);

/** What a role lets people do, in the same words the editor uses. */
export function rolePermissionWords(permissions: bigint): string {
  const words = ROLE_PERMISSION_CHOICES.filter((c) => (permissions & c.bit) !== 0n).map((c) => c.label);
  return words.length ? words.join(" · ") : "No extra permissions";
}

export function ConcordRoles({ community }: { community: StoredCommunity }) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const { state, roster, myMember } = useConcordGovernance(community);
  const [editing, setEditing] = useState<{ role?: Role; preset?: { name: string; permissions: bigint } } | null>(null);
  const [saving, setSaving] = useState(false);

  const isOwner = !!pubkey && pubkey === community.owner;
  const myRank = isOwner ? OWNER_POSITION : (myMember?.rank ?? Infinity);
  const roles = useMemo(() => [...state.roles.values()].sort(byRank), [state.roles]);
  const editable = useMemo(() => new Set(grantableRoles(state, community.owner, pubkey ?? "").map((r) => r.role_id)), [state, community.owner, pubkey]);
  const holders = (id: string) => roster.filter((m) => m.roleIds.includes(id)).length;
  const hasModerator = roles.some((r) => r.name.trim().toLowerCase() === MODERATOR_PRESET.name.toLowerCase());

  const save = async (draft: { name: string; permissions: bigint; color?: number }) => {
    const signer = getGlobalSigner();
    if (!signer || !pubkey || saving) return;
    setSaving(true);
    try {
      if (editing?.role) {
        await editRole(signer, pubkey, community, editing.role.role_id, { ...draft, position: editing.role.position },
          state.heads.get(`${VSK.ROLE}:${editing.role.role_id}`), (e, r) => publishEvent(e, r));
      } else {
        // Always below its maker, and below every role there is.
        await createRole(signer, pubkey, community, { ...draft, position: newRolePosition(roles, myRank) }, (e, r) => publishEvent(e, r));
      }
      toast({ title: editing?.role ? "Role updated" : "Role made" });
      setEditing(null);
    } catch (err) {
      toast({ title: "Couldn't save the role", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="concord-roles">
      <p className="text-[11px] text-muted-foreground/60">
        Roles rank from the top down. People can only change roles below their own.
      </p>
      {roles.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-2">No roles yet.</p>
      ) : (
        <div className="space-y-1">
          {roles.map((r) => (
            <div key={r.role_id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5" data-testid={`concord-role-${r.role_id.slice(0, 8)}`}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border/40" style={{ background: hexColor(r.color) ?? "transparent" }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={hexColor(r.color) ? { color: hexColor(r.color) } : undefined}>{r.name || "Unnamed role"}</p>
                <p className="text-[11px] text-muted-foreground/60 truncate">
                  {holders(r.role_id) === 1 ? "1 person" : `${holders(r.role_id)} people`} · {rolePermissionWords(r.permissions)}
                </p>
              </div>
              {editable.has(r.role_id) && (
                <button onClick={() => setEditing({ role: r })} className="shrink-0 h-9 md:h-7 px-2.5 rounded-full text-[11px] text-primary hover:bg-primary/10 transition-colors" data-testid="concord-role-edit">
                  Edit
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!hasModerator && (
          <SpaceAdminAction icon={Shield} onClick={() => setEditing({ preset: MODERATOR_PRESET })} testId="concord-role-add-moderator">
            Add a Moderator role
          </SpaceAdminAction>
        )}
        <SpaceAdminAction icon={Plus} onClick={() => setEditing({})} testId="concord-role-new">
          New role
        </SpaceAdminAction>
      </div>
      {editing && (
        <ConcordRoleDialog
          open
          onOpenChange={(o) => { if (!o && !saving) setEditing(null); }}
          initial={editing.role ?? { name: editing.preset?.name ?? "", permissions: editing.preset?.permissions ?? 0n, color: 0 }}
          isNew={!editing.role}
          saving={saving}
          onSave={save}
        />
      )}
    </div>
  );
}

function ConcordRoleDialog({ open, onOpenChange, initial, isNew, saving, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { name: string; permissions: bigint; color?: number };
  isNew: boolean;
  saving: boolean;
  onSave: (draft: { name: string; permissions: bigint; color?: number }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color ?? 0);
  const [chosen, setChosen] = useState<Set<bigint>>(() => new Set(ROLE_PERMISSION_CHOICES.filter((c) => (initial.permissions & c.bit) !== 0n).map((c) => c.bit)));
  const permissions = withChoices(initial.permissions, [...chosen]);
  const staff = (permissions & STAFF_PERMS) !== 0n;
  const toggle = (bit: bigint, on: boolean) => setChosen((prev) => { const next = new Set(prev); if (on) next.add(bit); else next.delete(bit); return next; });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto z-[230]" data-testid="concord-role-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">{isNew ? "New role" : "Edit role"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground/70">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="Moderator, Supporter…" data-testid="input-role-name" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground/70">Color</label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Role color">
              {ROLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c ? hexColor(c) : "No color"}
                  onClick={() => setColor(c)}
                  className={cn("w-8 h-8 md:w-7 md:h-7 rounded-full border transition-shadow", color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "border-border/40")}
                  style={{ background: hexColor(c) ?? "transparent" }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground/70">What people with this role can do</label>
            <div className="space-y-1">
              {ROLE_PERMISSION_CHOICES.map((c) => (
                <div key={String(c.bit)} className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5">
                  <div className="min-w-0">
                    <p className="text-sm">{c.label}</p>
                    <p className="text-[11px] text-muted-foreground/60">{c.detail}</p>
                  </div>
                  <Switch checked={chosen.has(c.bit)} onCheckedChange={(on) => toggle(c.bit, on)} aria-label={c.label} />
                </div>
              ))}
            </div>
            {staff && (
              <p className="text-[11px] text-muted-foreground/60">
                People with this role help run the group, so they'll get the key that lets them change its settings.
              </p>
            )}
          </div>
          <Button onClick={() => onSave({ name, permissions, color: color || undefined })} disabled={!name.trim() || saving} className="w-full" data-testid="button-save-role">
            {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…</> : isNew ? "Make role" : "Save role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
