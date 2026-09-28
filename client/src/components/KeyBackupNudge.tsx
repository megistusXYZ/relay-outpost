/**
 * The reminder to back up a key that lives only in this browser, a day after
 * sign-up (lib/key-backup.ts decides when). "Later" snoozes it for three days;
 * making a backup ends it.
 */
import { useLocation } from "wouter";
import { KeyRound } from "lucide-react";
import { useKeyBackupNudge } from "@/hooks/use-key-backup";

export function KeyBackupNudge() {
  const [, navigate] = useLocation();
  const { state, snooze } = useKeyBackupNudge();
  if (state !== "nudge") return null;
  return (
    <div className="m-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5" data-testid="key-backup-nudge">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Back up your key</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            If this browser's data is cleared, this account can't be recovered. A backup takes a few seconds.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/key-backup")}
              className="min-h-11 md:min-h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
              data-testid="key-backup-nudge-go"
            >
              Back up now
            </button>
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
