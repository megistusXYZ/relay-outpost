import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, Fingerprint, KeyRound } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadLocalAccount, decryptStored } from "@/lib/local-account";
import { getWriteRelays } from "@/lib/outbox";
import { unlockWithPasskey, describePasskeyPlatform } from "@/lib/passkey";
import { useKeyMaterial } from "@/hooks/use-key-material";
import { KeyBackupActions, type KeyMaterial } from "@/components/KeyBackupActions";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

/**
 * Save your key (owner, 2026-10-10). The key file holds the key itself, so
 * this page needs the key unlocked: it is in memory when the person chose to
 * stay signed in; otherwise the password for this browser (or Touch ID) opens
 * the copy kept here first. Only local accounts hold a key to save — an
 * extension, signer app or connection link keeps it elsewhere.
 */
export default function KeyBackup() {
  useDocumentTitle("Save your key");
  const { pubkey, loginMethod, profile } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const inMemory = useKeyMaterial();
  const [unlocked, setUnlocked] = useState<KeyMaterial | null>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [working, setWorking] = useState(false);

  const account = useMemo(() => (loginMethod === "local" ? loadLocalAccount() : null), [loginMethod]);
  const isLocal = loginMethod === "local" && !!account;
  const platform = describePasskeyPlatform();

  useEffect(() => {
    if (!pubkey) { setLocation("/"); return; }
    if (pubkey && loginMethod && !isLocal) setLocation("/tools");
  }, [pubkey, loginMethod, isLocal, setLocation]);

  const name = profile?.display_name || profile?.name || account?.label || "";
  const toMaterial = useCallback((secret: Uint8Array): KeyMaterial | null => {
    if (!account || !pubkey) return null;
    return { nsec: nip19.nsecEncode(secret), npub: account.npub, pubkey, name, createdAt: account.createdAt };
  }, [account, pubkey, name]);

  const unlockWithPassword = useCallback(async () => {
    if (!account || !password) return;
    setWorking(true);
    try {
      const secret = await new Promise<Uint8Array>((resolve, reject) => setTimeout(() => { try { resolve(decryptStored(account.ncryptsec, password)); } catch (e) { reject(e); } }, 20));
      setUnlocked(toMaterial(secret));
      setPassword("");
    } catch {
      toast({ title: "Wrong password", description: "That is not the password for this browser.", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }, [account, password, toMaterial, toast]);

  const unlockWithTouch = useCallback(async () => {
    if (!account?.passkey) return;
    setWorking(true);
    try {
      setUnlocked(toMaterial(await unlockWithPasskey(account.passkey)));
    } catch {
      toast({ title: `${platform.name} didn't unlock it`, description: "Try again.", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  }, [account, toMaterial, toast, platform.name]);

  if (!pubkey || !isLocal || !account) return null;
  const material = unlocked ?? inMemory?.material ?? null;
  const relays = inMemory?.relays ?? getWriteRelays(pubkey);

  return (
    <div className="max-w-xl mx-auto px-3 sm:px-4 pt-4 sm:pt-6 pb-10 space-y-5" data-testid="page-key-backup">
      <Card className="glass-card p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-2.5">
          <KeyRound className="h-4 w-4 shrink-0 mt-0.5 text-brand" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {name ? `${name} lives` : "This account lives"} only in this browser. If it is cleared or this device is lost, the account is gone and nobody, including us, can bring it back. Your key is the only way. We keep no copy.
          </p>
        </div>

        {material ? (
          <KeyBackupActions material={material} relays={relays} testIdPrefix="key-page" />
        ) : (
          <div className="space-y-3" data-testid="key-page-unlock">
            <p className="text-xs text-muted-foreground">Unlock the copy kept here first.</p>
            {account.passkey && (
              <Button onClick={unlockWithTouch} disabled={working} className="w-full min-h-11 gap-2 bg-brand text-white hover:bg-brand" data-testid="key-page-unlock-passkey">
                {working ? <RelayOutpostInlineLoader className="h-4 w-4" /> : <Fingerprint className="h-4 w-4" />}
                Unlock with {platform.name}
              </Button>
            )}
            <div className="space-y-2">
              <Label className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground">Password for this browser</Label>
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void unlockWithPassword(); }}
                  autoComplete="current-password"
                  className="pr-10"
                  style={{ fontSize: 16 }}
                  data-testid="key-page-password"
                />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button onClick={unlockWithPassword} disabled={!password || working} variant="outline" className="w-full min-h-11" data-testid="key-page-unlock-password">
                {working ? <RelayOutpostInlineLoader className="h-4 w-4 mr-2" /> : null}
                Unlock
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
