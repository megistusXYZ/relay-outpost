/**
 * Saving your key, the same three moves wherever it is offered (owner,
 * 2026-10-10): the sign-up's last step, the day-after card in Chats, the
 * community page the moment it depends on you, and the Save-your-key page.
 *
 * Save key file · Save to password manager · Check it works. The check reads
 * the saved file (or the pasted key) back and says whether it opens THIS
 * account — the only feedback that settles "did this work?". Saving marks the
 * key as saved (lib/key-backup.ts); a successful check marks it checked.
 *
 * When the key is not in memory (the card in Chats, a community page), the
 * prompt form sends them to the page that asks for the password first.
 */
import { useCallback, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Check, CheckCircle2, Download, FileText, KeyRound, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { buildKeyFile, saveKeyFile, checkBackup } from "@/lib/key-file";
import { markBackedUp, markBackupChecked } from "@/lib/key-backup";
import { saveCredentialToPasswordManager } from "@/lib/local-account";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

export interface KeyMaterial {
  nsec: string;
  npub: string;
  pubkey: string;
  /** The name they chose; "" when none. */
  name: string;
  createdAt?: number;
}

export function KeyBackupActions({ material, relays, isOverlay = false, onSaved, testIdPrefix = "key" }: {
  material: KeyMaterial;
  relays: string[];
  /** The sign-up cockpit draws on a dark overlay. */
  isOverlay?: boolean;
  onSaved?: () => void;
  testIdPrefix?: string;
}) {
  const { toast } = useToast();
  const [fileSaved, setFileSaved] = useState(false);
  const [managerSaved, setManagerSaved] = useState(false);
  const [managerWorking, setManagerWorking] = useState(false);
  const [check, setCheck] = useState<"idle" | "opens" | "other-account" | "unreadable">("idle");
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const saved = fileSaved || managerSaved;
  const who = material.name || "this account";

  const outline = isOverlay ? "border-white/20 text-white/85 hover:bg-white/10" : "";
  const done = isOverlay ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-emerald-500/40 bg-emerald-500/10 text-success";
  const quiet = isOverlay ? "text-white/60" : "text-muted-foreground";

  const saveFile = useCallback(() => {
    try {
      saveKeyFile(buildKeyFile({ name: material.name, npub: material.npub, nsec: material.nsec, relays, createdAt: material.createdAt ?? Date.now() }), material.npub);
      markBackedUp(material.pubkey, Date.now(), "key");
      setFileSaved(true);
      onSaved?.();
      toast({ title: "Key file saved", description: "Keep it somewhere only you can reach, then check it works below." });
    } catch {
      toast({ title: "Couldn't save the file", description: "Try again.", variant: "destructive" });
    }
  }, [material, relays, onSaved, toast]);

  const saveToManager = useCallback(async () => {
    setManagerWorking(true);
    try {
      const label = material.name ? `${material.name} — Relay Outpost` : "Relay Outpost";
      const result = await saveCredentialToPasswordManager({ username: material.npub, password: material.nsec, label });
      if (result === "credential-api") {
        markBackedUp(material.pubkey, Date.now(), "key");
        setManagerSaved(true);
        onSaved?.();
        toast({ title: "Offered to your password manager", description: "Confirm in the browser prompt. Your key is the password; your address is the username." });
      } else {
        // Safari and Firefox offer no no-network save: copy, and say where to paste.
        await navigator.clipboard.writeText(material.nsec);
        markBackedUp(material.pubkey, Date.now(), "key");
        setManagerSaved(true);
        onSaved?.();
        toast({ title: "Key copied", description: "Paste it into your password manager as the password, with your address as the username." });
      }
    } catch {
      toast({ title: "Couldn't reach your password manager", description: "Save the key file instead.", variant: "destructive" });
    } finally {
      setManagerWorking(false);
    }
  }, [material, onSaved, toast]);

  const runCheck = useCallback((text: string) => {
    const result = checkBackup(text, material.pubkey);
    setCheck(result);
    if (result === "opens") markBackupChecked(material.pubkey, Date.now());
  }, [material.pubkey]);

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    try { runCheck(await f.text()); } catch { setCheck("unreadable"); }
  }, [runCheck]);

  return (
    <div className="space-y-2.5" data-testid={`${testIdPrefix}-actions`}>
      <Button onClick={saveFile} variant="outline" className={`w-full text-xs font-brand uppercase tracking-widest transition-all ${fileSaved ? done : outline}`} data-testid={`${testIdPrefix}-save-file`}>
        {fileSaved ? <Check className="w-4 h-4 mr-2" /> : <Download className="w-4 h-4 mr-2" />}
        {fileSaved ? "Key file saved — save again" : "Save key file"}
      </Button>
      <Button onClick={saveToManager} disabled={managerWorking} variant="outline" className={`w-full text-xs font-brand uppercase tracking-widest transition-all ${managerSaved ? done : outline}`} data-testid={`${testIdPrefix}-save-manager`}>
        {managerWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : managerSaved ? <Check className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
        {managerWorking ? "Saving…" : managerSaved ? "Saved to password manager" : "Save to password manager"}
      </Button>

      {saved && (
        <div className={`rounded-md p-3 space-y-2 ${isOverlay ? "border border-white/10 bg-white/[0.03]" : "border border-border/40 bg-foreground/[0.02]"}`} data-testid={`${testIdPrefix}-check`}>
          <p className={`text-xs font-semibold ${isOverlay ? "text-white" : ""}`}>Check it works</p>
          <p className={`text-xs leading-relaxed ${quiet}`}>Open the saved file here, or paste the key. We read it back and say whether it opens {who}. Nothing is sent anywhere.</p>
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid={`${testIdPrefix}-check-file`} />
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className={`h-8 text-[11px] font-brand uppercase tracking-[0.12em] font-bold ${outline}`} data-testid={`${testIdPrefix}-check-open`}>
              <FileText className="w-3.5 h-3.5 mr-1.5" /> Open the file
            </Button>
            <span className={`text-[11px] ${quiet}`}>or paste the key:</span>
            <input
              type="password"
              value={pasted}
              onChange={(e) => { setPasted(e.target.value); if (e.target.value.trim()) runCheck(e.target.value); else setCheck("idle"); }}
              placeholder="nsec1…"
              autoComplete="off"
              className={`flex-1 min-w-0 h-8 rounded-md border px-2 text-xs bg-transparent ${isOverlay ? "border-white/15 text-white placeholder:text-white/40" : "border-border/50"}`}
              style={{ fontSize: 16 }}
              data-testid={`${testIdPrefix}-check-paste`}
            />
          </div>
          {check !== "idle" && (
            <p
              className={`text-xs flex items-center gap-1.5 ${check === "opens" ? (isOverlay ? "text-emerald-200" : "text-success") : "text-destructive"}`}
              role="status"
              data-testid={`${testIdPrefix}-check-result`}
            >
              {check === "opens" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
              {check === "opens" ? `This key opens ${who}.` : check === "other-account" ? "That is a key for a different account." : "No key found in that."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The key is not in memory here: one button to the page that asks for the password and saves. */
export function KeyBackupPrompt({ testId = "key-backup-go" }: { testId?: string }) {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      onClick={() => navigate("/key-backup")}
      className="min-h-11 md:min-h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
      data-testid={testId}
    >
      Save your key
    </button>
  );
}
