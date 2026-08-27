/**
 * "Accepted content" — the kind gate on the relay's front door, via NIP-86
 * allowkind/disallowkind. Self-contained card mounted beside Access Control.
 *
 * The readout is the relay's OWN answer (describeKindPolicy), refreshed after
 * every action — never a local mirror of what we asked for. When management
 * isn't supported the card says so and renders no dead controls.
 */
import { useState, useEffect, useCallback } from "react";
import { type Nip11Document } from "@/lib/nip11";
import {
  checkNip86Support,
  allowKind,
  disallowKind,
  listAllowedKinds,
  listDisallowedKinds,
  type Nip86SupportStatus,
} from "@/lib/nip86";
import { describeKindPolicy, GATE_KIND_OPTIONS, formatKindList, type KindPolicy } from "@/lib/kind-gate";
import { OpsCard, OpsSectionHeader } from "./ops-ui";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DoorOpen, RefreshCw, Check, Ban } from "lucide-react";

export function KindGateCard({ relayUrl }: { relayUrl: string; nip11: Nip11Document | null }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Nip86SupportStatus | null>(null);
  const [policy, setPolicy] = useState<KindPolicy | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    const [allowedRes, disallowedRes] = await Promise.all([
      listAllowedKinds(relayUrl),
      listDisallowedKinds(relayUrl),
    ]);
    setPolicy(describeKindPolicy(
      allowedRes.error !== undefined ? null : (allowedRes.result ?? []),
      disallowedRes.error !== undefined ? null : (disallowedRes.result ?? []),
    ));
  }, [relayUrl]);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setPolicy(null);
    checkNip86Support(relayUrl).then((s) => {
      if (cancelled) return;
      setStatus(s);
      if (s === "supported") loadPolicy();
    });
    return () => { cancelled = true; };
  }, [relayUrl, loadPolicy]);

  const act = useCallback(async (label: string, kinds: number[], action: "allow" | "block") => {
    setBusyLabel(label);
    try {
      const fn = action === "allow" ? allowKind : disallowKind;
      const results = await Promise.all(kinds.map((k) => fn(relayUrl, k)));
      const failed = results.filter((r) => r.error !== undefined).length;
      if (failed > 0) {
        toast({ title: "The relay declined", description: `${failed} of ${kinds.length} changes were refused.`, variant: "destructive" });
      }
      // The relay's answer is the truth — re-list rather than mirroring locally.
      await loadPolicy();
    } finally {
      setBusyLabel(null);
    }
  }, [relayUrl, loadPolicy, toast]);

  const policyLine = (() => {
    if (!policy) return "Reading the relay's policy…";
    switch (policy.mode) {
      case "allowlist":
        return `Allowlist: this relay only accepts ${formatKindList(policy.kinds)}.`;
      case "blocklist":
        return `This relay accepts everything except ${formatKindList(policy.kinds)}.`;
      case "unrestricted":
        return "No kind restrictions — this relay accepts any event kind its other rules allow.";
      case "unknown":
        return "The relay didn't answer the policy question — the readout below may be incomplete.";
    }
  })();

  const stateOf = (kinds: number[]): "allowed" | "blocked" | null => {
    if (!policy || policy.mode === "unknown") return null;
    if (policy.mode === "allowlist") return kinds.every((k) => policy.kinds.includes(k)) ? "allowed" : "blocked";
    if (policy.mode === "blocklist") return kinds.some((k) => policy.kinds.includes(k)) ? "blocked" : "allowed";
    return "allowed";
  };

  return (
    <OpsCard className="mt-4">
      <div className="space-y-3" data-testid="kind-gate-card">
        <OpsSectionHeader
          icon={DoorOpen}
          label="Accepted content"
          action={status === "supported" ? (
            <Button size="sm" variant="ghost" onClick={loadPolicy} aria-label="Refresh policy"><RefreshCw className="w-3.5 h-3.5" /></Button>
          ) : undefined}
        >
          <p className="text-xs text-muted-foreground">
            Shape what this relay accepts at the door — which content types can be published here at all.
          </p>
        </OpsSectionHeader>

        {status === null ? (
          <p className="text-xs text-muted-foreground/70 py-2">Checking whether this relay supports kind management…</p>
        ) : status !== "supported" ? (
          <p className="text-xs text-muted-foreground/70 py-2" data-testid="kind-gate-unsupported">
            This relay doesn't expose content-kind management (NIP-86), so accepted kinds can't be changed from here.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground" data-testid="kind-gate-policy">{policyLine}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {GATE_KIND_OPTIONS.map((opt) => {
                const st = stateOf(opt.kinds);
                const busy = busyLabel === opt.label;
                return (
                  <div key={opt.label} className="flex items-center justify-between gap-2 rounded-lg border border-border/25 bg-muted/5 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{opt.label}</p>
                      <p className="text-[10px] text-muted-foreground/50">kind {opt.kinds.join(", ")}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {st === "allowed" && <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-500"><Check className="w-3 h-3" />in</span>}
                      {st === "blocked" && <span className="flex items-center gap-0.5 text-[10px] text-red-500"><Ban className="w-3 h-3" />out</span>}
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => act(opt.label, opt.kinds, "allow")} data-testid={`button-kind-allow-${opt.kinds[0]}`}>
                        Allow
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-red-500" disabled={busy} onClick={() => act(opt.label, opt.kinds, "block")} data-testid={`button-kind-block-${opt.kinds[0]}`}>
                        Block
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground/50">
              How the relay applies allow vs. block depends on its software — the line above always shows what the relay itself reports.
            </p>
          </>
        )}
      </div>
    </OpsCard>
  );
}
