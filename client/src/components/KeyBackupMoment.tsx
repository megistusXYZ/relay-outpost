/**
 * The reminder where loss becomes expensive (owner, 2026-10-10): on a
 * community you own, the moment it exists ("this community now depends on
 * your key") and again once people have joined ("they are counting on you").
 * Signal and message together, the save buttons on the card, shown once per
 * moment; saving the key ends all of it.
 */
import { KeyRound, X } from "lucide-react";
import { useKeyBackupNudge } from "@/hooks/use-key-backup";
import { useKeyMaterial } from "@/hooks/use-key-material";
import { KeyBackupActions, KeyBackupPrompt } from "@/components/KeyBackupActions";

export function KeyBackupMoment({ members, name }: { members: number; name: string }) {
  const { due, dismiss, refresh } = useKeyBackupNudge();
  const material = useKeyMaterial();
  const moment = members >= 2 ? "members" : "community";
  if (!due(moment)) return null;
  const others = members - 1;
  const lead = moment === "members"
    ? `${others === 1 ? "Someone is" : `${others} people are`} counting on ${name || "this community"}. It depends on your key.`
    : `${name || "This community"} now depends on your key.`;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5" data-testid={`key-backup-moment-${moment}`}>
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Save your key</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {lead} If this browser is cleared, nobody, including us, can bring the account back.
          </p>
          <div className="mt-3">
            {material ? (
              <KeyBackupActions material={material.material} relays={material.relays} onSaved={refresh} testIdPrefix="key-moment" />
            ) : (
              <KeyBackupPrompt testId="key-backup-moment-go" />
            )}
          </div>
        </div>
        <button type="button" onClick={() => dismiss(moment)} aria-label="Close" className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground" data-testid="key-backup-moment-close">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
