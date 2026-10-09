/**
 * Who can post, on a relay that lets the operator choose (newlay / relay.tools
 * Feeds — lib/posting-gate.ts). Two choices; picking one saves it on the relay
 * at once (newlay has no separate save step). Any other relay gets `fallback`:
 * today's read-only line and where the host lets you change it.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchRelayCapabilities, nip86Call } from "@/lib/nip86";
import { canDo, managedAt } from "@/lib/relay-capabilities";
import { callsToChoose, readPostingGate, type PostingChoice, type PostingGate, type WotSettings } from "@/lib/posting-gate";
import { useToast } from "@/hooks/use-toast";
import { ManagedAtNote } from "./ops-ui";

const CHOICES: Array<{ id: PostingChoice; title: string; line: string }> = [
  { id: "anyone", title: "Anyone", line: "Everyone can post. You can still ban people." },
  { id: "network", title: "People your network trusts", line: "Members, people you follow and people they trust can post. Posts from strangers are turned away." },
];

export function PostingGateCard({ relayUrl, me, fallback }: { relayUrl: string; me: string | null; fallback: ReactNode }) {
  const { toast } = useToast();
  const [offered, setOffered] = useState<boolean | null>(null);
  const [gate, setGate] = useState<PostingGate | null>(null);
  const [settings, setSettings] = useState<WotSettings | null>(null);
  const [saving, setSaving] = useState<PostingChoice | null>(null);

  const read = useCallback(async () => {
    const res = await nip86Call<WotSettings>(relayUrl, "getwotsettings", []);
    // Wired at boot? The health report says; a relay that doesn't send one is taken at its settings.
    const status = await nip86Call<{ subsystems?: { wot?: boolean } }>(relayUrl, "getrelaystatus", []);
    const wired = status.result?.subsystems ? status.result.subsystems.wot === true : true;
    setSettings(res.result ?? null);
    setGate(readPostingGate(res.result, { wired }));
  }, [relayUrl]);

  useEffect(() => {
    let live = true;
    setOffered(null); setGate(null);
    (async () => {
      const caps = await fetchRelayCapabilities(relayUrl);
      if (!live) return;
      const ok = canDo(caps, "postingGate");
      setOffered(ok);
      if (ok) await read();
    })();
    return () => { live = false; };
  }, [relayUrl, read]);

  const choose = async (choice: PostingChoice) => {
    if (!settings || !me || saving) return;
    setSaving(choice);
    for (const call of callsToChoose(choice, settings, me)) {
      const r = await nip86Call(relayUrl, call.method as any, call.params);
      if (r.error) {
        toast({ title: "Couldn't change who can post", description: r.error, variant: "destructive" });
        break;
      }
    }
    await read();
    setSaving(null);
  };

  if (offered === false) return <>{fallback}</>;
  if (offered === null || !gate) return null;

  if (gate.choice === null) {
    return (
      <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 space-y-1" data-testid="ops-posting-gate-off">
        <p className="text-[15px] font-medium">
          {gate.why === "host-off" ? "Your host hasn't switched on trust checks for this relay." : "We couldn't read who can post right now."}
        </p>
        {gate.why === "host-off" && <ManagedAtNote where={managedAt(relayUrl)} lead="Ask them, or" verb="change it" testId="ops-posting-gate-host" />}
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label="Who can post" className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-posting-gate">
      {CHOICES.map((c) => {
        const on = gate.choice === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!!saving || !me}
            onClick={() => !on && choose(c.id)}
            className="w-full min-h-[56px] flex items-start gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] disabled:opacity-60"
            data-testid={`ops-posting-gate-${c.id}`}
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
  );
}
