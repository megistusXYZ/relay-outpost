/**
 * Community details › How it's used: Open, a private-messages inbox, or a
 * community chat (newlay's relay mode — lib/relay-type.ts). Shown only where
 * the host's engine lets the operator choose. Picking one saves it at once.
 * A line underneath says what this place is already used for — an outpost of
 * yours, your private messages — and what that calls for.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchRelayCapabilities, nip86Call } from "@/lib/nip86";
import { canDo } from "@/lib/relay-capabilities";
import { callToChoose, readRelayType, relayHostsOutpost, sameRelay, suggestRelayType, type RelayType } from "@/lib/relay-type";
import { getCommunities } from "@/lib/concord/concord-keys";
import { getOwnDMInboxRelays } from "@/lib/outbox";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { OpsCard, OpsSectionHeader } from "./ops-ui";

const CHOICES: Array<{ id: RelayType; title: string; line: string }> = [
  { id: "open", title: "Open", line: "Anyone can read what's here. Deleting works as usual." },
  { id: "inbox", title: "Private-messages inbox", line: "Each private message is shown only to the person it's for." },
  { id: "chat", title: "Community chat", line: "Group chat history can't be erased by whoever holds the chat key." },
];

export function RelayTypeCard({ relayUrl }: { relayUrl: string }) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [offered, setOffered] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<RelayType | "custom" | null>(null);
  const [uses, setUses] = useState<{ hostsOutpost: boolean; isMyInbox: boolean }>({ hostsOutpost: false, isMyInbox: false });
  const [saving, setSaving] = useState<RelayType | null>(null);

  const read = useCallback(async () => {
    const r = await nip86Call(relayUrl, "getrelaymode", []);
    setCurrent(readRelayType(r.result));
  }, [relayUrl]);

  useEffect(() => {
    let live = true;
    setOffered(null); setCurrent(null);
    (async () => {
      const caps = await fetchRelayCapabilities(relayUrl);
      if (!live) return;
      const ok = canDo(caps, "relayType");
      setOffered(ok);
      if (ok) await read();
    })();
    return () => { live = false; };
  }, [relayUrl, read]);

  useEffect(() => {
    let live = true;
    if (!pubkey) return;
    const isMyInbox = getOwnDMInboxRelays(pubkey).some((u) => sameRelay(u, relayUrl));
    getCommunities(pubkey).then((all) => { if (live) setUses({ hostsOutpost: relayHostsOutpost(all, pubkey, relayUrl), isMyInbox }); }).catch(() => { if (live) setUses({ hostsOutpost: false, isMyInbox }); });
    return () => { live = false; };
  }, [pubkey, relayUrl]);

  const choose = async (type: RelayType) => {
    if (saving) return;
    setSaving(type);
    const call = callToChoose(type);
    const r = await nip86Call(relayUrl, call.method as any, call.params);
    if (r.error) toast({ title: "Couldn't change how it's used", description: r.error, variant: "destructive" });
    await read();
    setSaving(null);
  };

  if (!offered || current === null) return null;
  const suggestion = suggestRelayType({ current, ...uses });

  return (
    <OpsCard data-testid="ops-relay-type">
      <OpsSectionHeader label="How it's used" className="mb-2" />
      <div role="radiogroup" aria-label="How it's used" className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {CHOICES.map((c) => {
          const on = current === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!!saving}
              onClick={() => !on && choose(c.id)}
              className="w-full min-h-[56px] flex items-start gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] disabled:opacity-60"
              data-testid={`ops-relay-type-${c.id}`}
            >
              <span className={`mt-1 w-4 h-4 shrink-0 rounded-full border-2 ${on ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--background))]" : "border-muted-foreground/60"}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">{c.title}{saving === c.id ? " · Saving…" : ""}</span>
                <span className="block text-[13px] text-muted-foreground">{c.line}</span>
              </span>
            </button>
          );
        })}
      </div>
      {current === "custom" && <p className="mt-2 text-[13px] text-muted-foreground" data-testid="ops-relay-type-custom">Your host set this by hand: private messages are kept private and chat history can't be erased. Pick one above to change it.</p>}
      {suggestion && <p className="mt-2 text-[13px]" data-testid="ops-relay-type-suggestion">{suggestion.why}</p>}
    </OpsCard>
  );
}
