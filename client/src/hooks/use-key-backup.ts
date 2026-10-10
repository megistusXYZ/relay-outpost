/**
 * Should this account be reminded to save its key? One answer for every
 * place that asks (the Account row, the Chats card, the community page), from
 * lib/key-backup.ts.
 */
import { useCallback, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { backupFacts, backupNudge, backupStatus, snoozeBackupNudge, dismissMoment, momentDue, type BackupFacts, type BackupMoment } from "@/lib/key-backup";
import { isNewAccount, loadLocalAccount } from "@/lib/local-account";

export function useKeyBackupNudge(): {
  state: "none" | "row" | "nudge";
  status: "none" | "not-saved" | "saved" | "checked";
  facts: BackupFacts | null;
  snooze: () => void;
  due: (moment: BackupMoment) => boolean;
  dismiss: (moment: BackupMoment) => void;
  refresh: () => void;
} {
  const { pubkey, loginMethod } = useNostrAuth();
  // Re-read after a snooze or a save; a backup made elsewhere is picked up on the next mount.
  const [tick, setTick] = useState(0);
  void tick;
  const local = loginMethod === "local";
  // Touch ID-first accounts carry a passkey and never saw their password: an
  // old "backed up" mark on one pointed at a file they could not open.
  const passkeyFirst = local ? !!loadLocalAccount()?.passkey : false;
  // Only an account made here: someone who brought their own key has it already.
  const facts = pubkey ? backupFacts(pubkey, local, isNewAccount(pubkey), { passkeyFirst }) : null;
  const state = facts ? backupNudge(facts, Date.now()) : "none";
  const status = facts ? backupStatus(facts) : "none";
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const snooze = useCallback(() => {
    if (!pubkey) return;
    snoozeBackupNudge(pubkey, Date.now());
    setTick((t) => t + 1);
  }, [pubkey]);
  const due = useCallback((moment: BackupMoment) => (facts ? momentDue(facts, moment) : false), [facts]);
  const dismiss = useCallback((moment: BackupMoment) => {
    if (!pubkey) return;
    dismissMoment(pubkey, moment);
    setTick((t) => t + 1);
  }, [pubkey]);
  return { state, status, facts, snooze, due, dismiss, refresh };
}
