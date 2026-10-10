/**
 * The signed-in account's key, when this browser holds it unlocked (a local
 * account that chose to stay signed in). Null otherwise: the Save-your-key
 * page asks for the password first.
 */
import { useMemo } from "react";
import { nip19 } from "nostr-tools";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { loadLocalAccount, loadLocalSecret } from "@/lib/local-account";
import { getWriteRelays } from "@/lib/outbox";
import type { KeyMaterial } from "@/components/KeyBackupActions";

export function useKeyMaterial(): { material: KeyMaterial; relays: string[] } | null {
  const { pubkey, loginMethod, profile } = useNostrAuth();
  return useMemo(() => {
    if (!pubkey || loginMethod !== "local") return null;
    try {
      const secret = loadLocalSecret();
      const account = loadLocalAccount();
      if (!secret || !account || account.pubkey !== pubkey) return null;
      const name = profile?.display_name || profile?.name || account.label || "";
      return {
        material: { nsec: nip19.nsecEncode(secret), npub: account.npub, pubkey, name, createdAt: account.createdAt },
        relays: getWriteRelays(pubkey),
      };
    } catch {
      return null;
    }
  }, [pubkey, loginMethod, profile?.display_name, profile?.name]);
}
