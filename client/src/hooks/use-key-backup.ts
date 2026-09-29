/**
 * Should this account be reminded to back up its key? One answer for every
 * place that asks (the Account row, the Chats nudge), from lib/key-backup.ts.
 */
import { useCallback, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { backupFacts, backupNudge, snoozeBackupNudge } from "@/lib/key-backup";
import { isNewAccount } from "@/lib/local-account";

export function useKeyBackupNudge(): { state: "none" | "row" | "nudge"; snooze: () => void } {
  const { pubkey, loginMethod } = useNostrAuth();
  // Re-read after a snooze; a backup made elsewhere is picked up on the next mount.
  const [tick, setTick] = useState(0);
  void tick;
  // Only an account made here: someone who brought their own key has it already.
  const state = pubkey ? backupNudge(backupFacts(pubkey, loginMethod === "local", isNewAccount(pubkey)), Date.now()) : "none";
  const snooze = useCallback(() => {
    if (!pubkey) return;
    snoozeBackupNudge(pubkey, Date.now());
    setTick((t) => t + 1);
  }, [pubkey]);
  return { state, snooze };
}
