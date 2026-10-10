/**
 * The reminder to save a key that lives only in this browser, with the signal
 * and the message together (owner, 2026-10-10): the card says why now, and
 * carries the save buttons itself when the key is in memory. A day after
 * sign-up in Chats (lib/key-backup.ts decides when); "Later" snoozes it for
 * three days; saving ends it.
 */
import { KeyRound } from "lucide-react";
import { useKeyBackupNudge } from "@/hooks/use-key-backup";
import { KeyBackupActions, KeyBackupPrompt } from "@/components/KeyBackupActions";
import { useKeyMaterial } from "@/hooks/use-key-material";

export function KeyBackupNudge() {
  const { state, snooze, refresh } = useKeyBackupNudge();
  const material = useKeyMaterial();
  if (state !== "nudge") return null;
  return (
    <div className="m-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5" data-testid="key-backup-nudge">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Save your key</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            This account lives only in this browser. If it is cleared, the account is gone and nobody, including us, can bring it back. Your key is the only way.
          </p>
          <div className="mt-3 space-y-2">
            {material ? (
              <KeyBackupActions material={material.material} relays={material.relays} onSaved={refresh} testIdPrefix="key-nudge" />
            ) : (
              <KeyBackupPrompt testId="key-backup-nudge-go" />
            )}
            <button
              type="button"
              onClick={snooze}
              className="min-h-11 md:min-h-9 rounded-full px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="key-backup-nudge-later"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
