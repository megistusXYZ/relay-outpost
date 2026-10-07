/**
 * The badges you've made, each with Edit and Delete (badges-plan, step 2).
 * Before, a badge you made existed only inside the "give" dropdown — no way
 * to see, fix or remove it.
 */
import { useCallback, useEffect, useState } from "react";
import { Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { fetchBadgeDefinitionsByAuthorResult, deleteBadgeDefinition, type BadgeDefinition } from "@/lib/nip58-badges";

function Thumb({ def }: { def: BadgeDefinition }) {
  const [broken, setBroken] = useState(false);
  const src = def.thumb || def.image;
  if (!src || broken) return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand/10"><Award className="h-6 w-6 text-brand" aria-hidden /></span>;
  return <img src={src} alt="" className="h-12 w-12 shrink-0 object-contain" onError={() => setBroken(true)} />;
}

export function YourBadgesList({ refreshKey, onEdit, onCreate, onThank, community, author, readOnly = false, title = "Badges you've made" }: {
  refreshKey: number;
  /** Only this community's badges; leave out for your personal ones. */
  community?: string;
  /** Whose badges to list (a community's owner); defaults to you. */
  author?: string;
  /** Moderators see the community's badges but can't change them yet. */
  readOnly?: boolean;
  title?: string;
  onEdit: (def: BadgeDefinition) => void;
  onCreate: () => void;
  onThank: () => void;
}) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [defs, setDefs] = useState<BadgeDefinition[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [deleting, setDeleting] = useState<BadgeDefinition | null>(null);

  const whose = author ?? pubkey;
  const load = useCallback(async () => {
    if (!whose) return;
    const r = await fetchBadgeDefinitionsByAuthorResult(whose);
    setUnreachable(!r.reached);
    setDefs(r.data.filter((d) => (d.community ?? undefined) === community).sort((a, b) => b.createdAt - a.createdAt));
  }, [whose, community]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const confirmDelete = async () => {
    if (!deleting || !signer) return;
    const gone = deleting;
    setDeleting(null);
    if (await deleteBadgeDefinition(signer, gone)) {
      setDefs((prev) => (prev ?? []).filter((d) => d.dTag !== gone.dTag));
      toast({ title: "Badge deleted", description: "People who already have it keep it." });
    } else {
      toast({ title: "Couldn't delete the badge", description: "Try again in a moment.", variant: "destructive" });
    }
  };

  return (
    <section className="space-y-3" data-testid="your-badges">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {!readOnly && <Button className="min-h-[44px]" onClick={onCreate} data-testid="button-create-badge">Create a badge</Button>}
      </div>
      {defs === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : defs.length === 0 ? (
        unreachable ? (
          <p className="text-sm text-muted-foreground">Couldn't reach your relays to list your badges. Try again in a moment.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4" data-testid="your-badges-empty">
            <p className="text-sm text-muted-foreground">{readOnly ? "No badges yet." : community ? "No badges yet. Founding member is a good first one." : "You haven't made a badge yet. Start by thanking someone."}</p>
            {!readOnly && (
              <Button variant="outline" className="min-h-[44px]" onClick={onThank} data-testid="button-thank-someone">
                {community ? "Make Founding member" : "Thank someone with a badge"}
              </Button>
            )}
          </div>
        )
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {defs.map((d) => (
            <li key={d.dTag} className="flex flex-wrap items-center gap-3 p-3" data-testid={`your-badge-${d.dTag}`}>
              <Thumb def={d} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{d.name}</p>
                {d.description && <p className="line-clamp-2 text-xs text-muted-foreground">{d.description}</p>}
              </div>
              {!readOnly && <div className="flex gap-2">
                <Button variant="outline" className="min-h-[44px]" onClick={() => onEdit(d)} data-testid={`button-edit-badge-${d.dTag}`}>Edit</Button>
                <Button variant="ghost" className="min-h-[44px] text-destructive" onClick={() => setDeleting(d)} data-testid={`button-delete-badge-${d.dTag}`}>Delete</Button>
              </div>}
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>You won't be able to give it any more. People who already have it keep it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} data-testid="button-confirm-delete-badge">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
