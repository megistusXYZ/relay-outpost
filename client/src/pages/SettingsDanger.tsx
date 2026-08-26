import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getVanishTargetRelays, getVanishTargetRelaysAsync, publishVanishRequest, performFullLocalWipe, type VanishRelayResult } from "@/lib/nip62-vanish";
import { shortenNpub, formatNpub } from "@/lib/nostr-helpers";
import { ArrowLeft, AlertTriangle, CheckCircle2, Loader2, UserX, XCircle } from "lucide-react";

// Local copies of Settings' section chrome — this page is a separate lazy chunk
// and importing them from Settings.tsx would drag the whole Settings bundle in.
function GlassSection({
  children,
  testId,
  className,
}: {
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-md border border-border dark:border-brand/15 overflow-visible glass-settings-section shadow-sm dark:shadow-none ${className || ""}`}
      data-testid={testId}
    >
      <div className="absolute inset-0 rounded-md opacity-25 pointer-events-none glass-settings-glow" />
      <div className="relative p-4 space-y-3">{children}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, label }: { icon: typeof UserX; label: string }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand/70 flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </h3>
  );
}

// Moved verbatim from Settings.tsx (AccountIdentitySection) so the destructive
// Vanish flow lives off the main Settings scroll. All guards preserved.
function AccountIdentitySection() {
  const { pubkey, signer, logout } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<VanishRelayResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Preview only — render the best-effort initial target list for the user
  // to see. We recompute fresh inside handleConfirm() so late-arriving
  // NIP-65 relay-list data is not missed.
  const [targetRelays, setTargetRelays] = useState<string[]>([]);
  useEffect(() => {
    if (!pubkey || !open) return;
    setTargetRelays(getVanishTargetRelays(pubkey));
  }, [pubkey, open]);

  const npubShort = pubkey ? shortenNpub(formatNpub(pubkey)) : "";
  // Two-step confirmation: the user must first acknowledge the
  // irreversibility by ticking the checkbox, and then type DELETE
  // exactly. Both gates must pass before the destructive action unlocks.
  const canConfirm =
    acknowledged && phrase.trim() === "DELETE" && !running && !!signer;

  const handleOpenChange = (next: boolean) => {
    if (running) return; // don't close mid-run
    setOpen(next);
    if (!next) {
      setPhrase("");
      setAcknowledged(false);
      setResults(null);
      setErrorMessage(null);
    }
  };

  const handleConfirm = async () => {
    if (!signer || !pubkey) return;
    setRunning(true);
    setErrorMessage(null);
    setResults(null);
    try {
      // Symmetry with the "[vanish] broadcast outcome" log below — emit
      // an attempt-started marker so support can correlate a user's
      // report of "I tried to vanish" with what actually got signed and
      // broadcast. No PII beyond the already-public npub prefix.
      console.log("[vanish] attempt started", {
        npub: npubShort,
        at: new Date().toISOString(),
      });
      // Recompute targets at confirm time, awaiting a fresh NIP-65
      // relay-list lookup with a short timeout so we don't silently
      // broadcast to a stale subset of write relays.
      const relays = await getVanishTargetRelaysAsync(pubkey);
      setTargetRelays(relays);
      if (relays.length === 0) {
        setErrorMessage("No target relays available. Check your relay configuration and retry.");
        toast({
          title: "Vanish request not sent",
          description: "No target relays available.",
          variant: "destructive",
        });
        setRunning(false);
        return;
      }

      const result = await publishVanishRequest({ signer, pubkey, relays });
      setResults(result.results);
      console.log("[vanish] broadcast outcome", {
        eventId: result.eventId,
        success: result.successCount,
        total: result.total,
      });

      if (result.successCount === 0) {
        setErrorMessage(
          "No relay accepted the vanish request. Your local account has not been wiped — you can retry or check your connection.",
        );
        toast({
          title: "Vanish request not accepted",
          description: "No relay confirmed the request. Nothing was wiped locally.",
          variant: "destructive",
        });
        setRunning(false);
        return;
      }

      // At least one relay accepted. Wipe persistent storage first, then
      // tear down the in-memory signer/session, then navigate. Any error
      // from logout() is surfaced — we do not want to leak a live signer
      // after telling the user their account is cleared.
      toast({
        title: "Vanish request broadcast",
        description: `${result.successCount} of ${result.total} relays accepted. Clearing your local keys now.`,
      });
      performFullLocalWipe(pubkey);
      logout(); // void, synchronous — tears down signer + in-memory session.
      setLocation("/");
    } catch (err) {
      console.error("[vanish] sign or broadcast failed", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(
        `Could not sign or broadcast the vanish request: ${msg}. Your local account is intact — you can retry.`,
      );
      toast({
        title: "Vanish request failed",
        description: "Signer or relays did not complete. Nothing was wiped.",
        variant: "destructive",
      });
      setRunning(false);
    }
  };

  if (!pubkey) return null;

  return (
    <GlassSection testId="section-account-identity" className="border-red-500/30 dark:border-red-500/20">
      <SectionHeader icon={UserX} label="Account" />
      <p className="text-xs text-foreground/50 dark:text-muted-foreground/60">
        Your identity is a keypair, not a row in our database. You can broadcast a
        request for every relay to forget you — this client will then wipe every
        local trace of your account from this device.
      </p>

      <div className="rounded-md border border-red-500/25 dark:border-red-500/20 bg-red-500/[0.04] dark:bg-red-500/[0.06] p-3 space-y-2.5" data-testid="container-danger-zone">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500/80" />
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-red-600/80 dark:text-red-400/80 font-semibold">
            Danger zone
          </span>
        </div>
        <p className="text-[11px] text-foreground/60 dark:text-foreground/55 leading-relaxed">
          <strong className="text-foreground/80">Vanish from relays</strong> publishes a
          NIP-62 request asking every relay you broadcast to to delete all your
          events. Compliant relays will honor it. Non-compliant relays and any
          clients that already cached your posts may still hold copies.
        </p>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={!signer}
          className="w-full sm:w-auto gap-1.5 text-xs font-brand uppercase tracking-widest"
          data-testid="button-open-vanish"
        >
          <UserX className="w-3.5 h-3.5" />
          Vanish from relays
        </Button>
        {!signer && (
          <p className="text-[10px] text-muted-foreground/70">
            Reconnect your signer to use this.
          </p>
        )}
      </div>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="max-w-lg" data-testid="dialog-vanish">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <UserX className="w-4 h-4" />
              Vanish from relays
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-xs text-foreground/70 dark:text-foreground/60">
                <p>
                  This will publish a NIP-62 <span className="font-mono">kind:62</span> event
                  signed by your key ({npubShort}) asking every relay below to
                  delete every event you've ever published.
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-foreground/55 dark:text-foreground/50">
                  <li>Compliant relays will delete your history.</li>
                  <li>Non-compliant relays may keep copies anyway.</li>
                  <li>Other clients that already cached your posts may still show them.</li>
                  <li>After at least one relay accepts, your encrypted key, signup draft, and bunker config are wiped from this device.</li>
                  <li>This cannot be undone. Back up your key first if there's any chance you'll want it back.</li>
                </ul>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-brand/70 dark:text-brand/60 mb-1">
                    Target relays ({targetRelays.length})
                  </p>
                  <div className="rounded-md border border-border dark:border-brand/10 bg-black/[0.03] dark:bg-white/[0.02] max-h-32 overflow-y-auto p-2" data-testid="list-vanish-relays">
                    {targetRelays.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/60">No relays available. Add a relay first.</p>
                    ) : (
                      <ul className="space-y-0.5 font-mono text-[10px] text-foreground/65 dark:text-foreground/55">
                        {targetRelays.map((r) => {
                          const outcome = results?.find((x) => x.relay === r);
                          return (
                            <li key={r} className="flex items-center gap-1.5">
                              {outcome ? (
                                outcome.status === "accepted" ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                ) : (
                                  <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                                )
                              ) : (
                                <span className="w-3 h-3 rounded-full bg-muted-foreground/20 shrink-0" />
                              )}
                              <span className="truncate">{r}</span>
                              {outcome?.error && (
                                <span className="text-red-500/70 text-[9px] truncate">({outcome.error})</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/[0.04] p-2.5">
                  <Checkbox
                    id="vanish-ack"
                    checked={acknowledged}
                    onCheckedChange={(v) => setAcknowledged(v === true)}
                    disabled={running}
                    className="mt-0.5 border-red-500/40 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                    data-testid="checkbox-vanish-ack"
                  />
                  <label
                    htmlFor="vanish-ack"
                    className="text-[11px] leading-snug text-foreground/70 cursor-pointer select-none"
                  >
                    I understand this cannot be undone. My events will be
                    requested for deletion from every relay above, and my
                    encrypted key and session data will be wiped from this
                    device.
                  </label>
                </div>
                <div>
                  <label
                    htmlFor="vanish-confirm"
                    className={`block text-[11px] font-medium mb-1 ${acknowledged ? "text-foreground/70" : "text-foreground/40"}`}
                  >
                    Then type <span className="font-mono font-bold text-red-600 dark:text-red-400">DELETE</span> to confirm.
                  </label>
                  <Input
                    id="vanish-confirm"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    disabled={running || !acknowledged}
                    placeholder="DELETE"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    data-testid="input-vanish-confirm"
                  />
                </div>
                {errorMessage && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/[0.06] p-2 text-[11px] text-red-700 dark:text-red-300" data-testid="text-vanish-error">
                    {errorMessage}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running} data-testid="button-vanish-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (canConfirm) handleConfirm();
              }}
              disabled={!canConfirm}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
              data-testid="button-vanish-confirm"
            >
              {running ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Broadcasting…
                </>
              ) : (
                <>
                  <UserX className="w-3.5 h-3.5 mr-1.5" />
                  Broadcast vanish
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassSection>
  );
}

export default function SettingsDanger() {
  useDocumentTitle("Advanced & danger zone");

  return (
    <div className="px-3 sm:px-4 py-4 sm:py-6 pb-[calc(7rem+env(safe-area-inset-bottom))]" data-testid="page-settings-danger">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Chrome back owns the route (back-affordance.ts maps it to /settings
            on cold entry) — the "Back to settings" link here duplicated it. */}
        <div className="relative rounded-md overflow-hidden border border-border dark:border-brand/15 glass-settings-header shadow-sm dark:shadow-none">
          <div className="absolute inset-0 pointer-events-none glass-settings-header-glow" />
          <div className="relative p-4 sm:p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0"
              style={{ background: "rgba(220, 60, 60, 0.10)", border: "1px solid rgba(220, 60, 60, 0.18)" }}
            >
              <AlertTriangle className="w-5 h-5 text-red-500/70" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground" data-testid="text-danger-title">
                Advanced &amp; danger zone
              </h1>
              <p className="text-xs text-muted-foreground/60">
                Irreversible account actions. Read carefully before you act.
              </p>
            </div>
          </div>
        </div>

        <AccountIdentitySection />
      </div>
    </div>
  );
}
