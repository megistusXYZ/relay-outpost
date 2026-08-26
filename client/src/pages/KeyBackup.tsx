import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { KeyRound, Download, ShieldCheck, Lock } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { loadLocalAccount, downloadBackupFile } from "@/lib/local-account";
import { getWriteRelays } from "@/lib/outbox";

/**
 * Re-download the ENCRYPTED (NIP-49 ncryptsec) key backup for a local account.
 *
 * SECURITY: this reuses the existing encrypted `downloadBackupFile` path only.
 * It never reveals or copies a plaintext nsec (no `nsec` extra is passed), and
 * the whole page is gated to local accounts — NIP-07 extension and NIP-46
 * remote-signer logins don't hold an exportable local key, so they never see
 * this at all. The ncryptsec is already stored encrypted, so no passphrase
 * re-entry is needed to regenerate the file.
 */
export default function KeyBackup() {
  useDocumentTitle("Back up your key");
  const { pubkey, loginMethod } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [done, setDone] = useState(false);

  // A local account holds an exportable, encrypted key. Extension/bunker/QR
  // logins do not — there is nothing here to back up for them.
  const account = useMemo(() => (loginMethod === "local" ? loadLocalAccount() : null), [loginMethod]);
  const isLocal = loginMethod === "local" && !!account;

  useEffect(() => {
    if (!pubkey) { setLocation("/"); return; }
    // Non-local logins can reach the route directly — bounce them to Tools.
    if (pubkey && loginMethod && !isLocal) setLocation("/tools");
  }, [pubkey, loginMethod, isLocal, setLocation]);

  if (!pubkey || !isLocal || !account) return null;

  const download = () => {
    try {
      downloadBackupFile(account, {
        displayName: account.label,
        relays: getWriteRelays(pubkey),
      });
      setDone(true);
      toast({ title: "Encrypted backup downloaded", description: "Store it somewhere only you can reach." });
    } catch {
      toast({ title: "Couldn't create backup", description: "Please try again.", variant: "destructive" });
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-5" data-testid="page-key-backup">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <KeyRound className="h-4 w-4" />
        </span>
        <h1 className="text-lg font-brand uppercase tracking-widest">Back up your key</h1>
      </div>

      <Card className="glass-card p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-brand/25 bg-brand/[0.05] p-3">
          <Lock className="h-4 w-4 shrink-0 mt-0.5 text-brand" />
          <p className="text-xs leading-relaxed text-muted-foreground/80">
            This downloads an <strong className="text-foreground/85">encrypted</strong> backup (NIP-49 ncryptsec).
            Without your passphrase the file is useless to anyone who finds it — so it's safe to store in the cloud.
            Your raw secret key is never included.
          </p>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Keep at least one copy somewhere you'll find it again. If you ever lose access to this device, you can
          restore your account from this file plus your passphrase.
        </p>

        <Button
          onClick={download}
          className="w-full min-h-11 gap-2 bg-brand text-white hover:bg-brand"
          data-testid="button-download-key-backup"
        >
          <Download className="h-4 w-4" />
          Download encrypted backup
        </Button>

        {done && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Backup downloaded. Store the file and your passphrase separately.
          </div>
        )}
      </Card>
    </div>
  );
}
