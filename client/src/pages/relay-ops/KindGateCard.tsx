/**
 * "Accepted content" — the kind gate on the relay's front door, via NIP-86
 * allowkind/disallowkind. Self-contained card mounted beside Access Control.
 *
 * The readout is the relay's OWN answer (describeKindPolicy), refreshed after
 * every action — never a local mirror of what we asked for. The Allow/Block
 * buttons show only where the relay lists allowkind and disallowkind for you:
 * a relay that answers other management calls but not these refused every
 * tap (owner, 2026-10-04). Elsewhere it says where to change it.
 */
import { useTechnicalDetails } from "@/lib/technical-details";
import { useState, useEffect, useCallback } from "react";
import { type Nip11Document } from "@/lib/nip11";
import {
  allowKind,
  disallowKind,
  listAllowedKinds,
  listDisallowedKinds,
  fetchRelayCapabilities,
} from "@/lib/nip86";
import { canDo, managedAt, type RelayCapabilities } from "@/lib/relay-capabilities";
import { describeKindPolicy, GATE_KIND_OPTIONS, formatKindList, type KindPolicy } from "@/lib/kind-gate";
import { OpsCard, OpsSectionHeader, ManagedAtNote } from "./ops-ui";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DoorOpen, RefreshCw, Check, Ban } from "lucide-react";

export function KindGateCard({ relayUrl }: { relayUrl: string; nip11: Nip11Document | null }) {
  const technical = useTechnicalDetails();
  const { toast } = useToast();
  const [caps, setCaps] = useState<RelayCapabilities | null>(null);
  const canChange = !!caps && canDo(caps, "allowKind") && canDo(caps, "disallowKind");
  const canRead = !!caps && (canDo(caps, "listAllowedKinds") || canDo(caps, "listDisallowedKinds"));
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
    setCaps(null);
    setPolicy(null);
    fetchRelayCapabilities(relayUrl).then((c) => {
      if (cancelled) return;
      setCaps(c);
      if (canDo(c, "listAllowedKinds") || canDo(c, "listDisallowedKinds")) void loadPolicy();
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
        toast({ title: "Your host turned that down", description: `${failed} of ${kinds.length} changes were refused.`, variant: "destructive" });
      }
      // The relay's answer is the truth — re-list rather than mirroring locally.
      await loadPolicy();
    } finally {
      setBusyLabel(null);
    }
  }, [relayUrl, loadPolicy, toast]);

  const policyLine = (() => {
    if (!policy) return "Reading what can be posted…";
    switch (policy.mode) {
      case "allowlist":
        return `Only ${formatKindList(policy.kinds, technical)} can be posted here.`;
      case "blocklist":
        return `Everything can be posted here except ${formatKindList(policy.kinds, technical)}.`;
      case "unrestricted":
        return "Every kind of post is accepted here.";
      case "unknown":
        return "We couldn't read what can be posted here — what's below may be incomplete.";
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
          action={canRead ? (
            <Button size="sm" variant="ghost" onClick={loadPolicy} aria-label="Refresh policy"><RefreshCw className="w-3.5 h-3.5" /></Button>
          ) : undefined}
        >
          <p className="text-xs text-muted-foreground">
            Choose which kinds of posts your community accepts at all.
          </p>
        </OpsSectionHeader>

        {caps === null ? (
          <p className="text-xs text-muted-foreground/70 py-2">Asking your host what you can change…</p>
        ) : !canChange ? (
          <div className="space-y-2" data-testid="kind-gate-unsupported">
            {canRead && <p className="text-xs text-muted-foreground" data-testid="kind-gate-policy">{policyLine}</p>}
            <ManagedAtNote where={managedAt(relayUrl)} lead="Your host doesn't let apps change which kinds of posts are accepted." testId="kind-gate-managed-at" />
          </div>
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
                      {technical && <p className="text-[10px] text-muted-foreground/50">kind {opt.kinds.join(", ")}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {st === "allowed" && <span className="flex items-center gap-0.5 text-[10px] text-success dark:text-emerald-500"><Check className="w-3 h-3" />in</span>}
                      {st === "blocked" && <span className="flex items-center gap-0.5 text-[10px] text-danger dark:text-red-500"><Ban className="w-3 h-3" />out</span>}
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
              How Allow and Block work depends on your host — the line above is always what it reports.
            </p>
          </>
        )}
      </div>
    </OpsCard>
  );
}
