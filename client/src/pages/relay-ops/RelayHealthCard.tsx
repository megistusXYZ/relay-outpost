/**
 * "How your relay is doing" — newlay's health report (getrelaystatus), shown
 * on Overview only when the relay lists it for this key. Every other relay
 * shows nothing here: no empty card, no "not supported".
 */
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { fetchRelayCapabilities, nip86Call } from "@/lib/nip86";
import { canDo } from "@/lib/relay-capabilities";
import { describeRelayStatus, type RelayStatusView } from "@/lib/relay-status";
import { OpsCard, OpsSectionHeader } from "./ops-ui";

export function RelayHealthCard({ relayUrl }: { relayUrl: string }) {
  const [view, setView] = useState<RelayStatusView | null>(null);

  useEffect(() => {
    let live = true;
    setView(null);
    (async () => {
      const caps = await fetchRelayCapabilities(relayUrl);
      if (!live || !canDo(caps, "status")) return;
      const res = await nip86Call(relayUrl, "getrelaystatus", []);
      if (live) setView(describeRelayStatus(res.result));
    })();
    return () => { live = false; };
  }, [relayUrl]);

  if (!view) return null;
  return (
    <OpsCard data-testid="ops-relay-health">
      <OpsSectionHeader icon={Activity} label="How your relay is doing" className="mb-2" />
      <p className="text-[13px] font-medium" data-testid="ops-relay-health-uptime">
        {view.uptime}
        {view.features.length > 0 && <span className="font-normal text-muted-foreground"> · {view.features.join(" · ")}</span>}
      </p>
      {view.counts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2" data-testid="ops-relay-health-counts">
          {view.counts.map((c) => (
            <div key={c.label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">{c.label}</dt>
              <dd className="text-[15px] font-semibold tabular-nums">{c.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {view.trust && <p className="mt-3 text-[13px] text-muted-foreground" data-testid="ops-relay-health-trust">{view.trust}</p>}
      {view.software && <p className="mt-2 text-[11px] text-muted-foreground">{view.software}</p>}
    </OpsCard>
  );
}
