/**
 * Relay Control › Settings › Member inbox.
 *
 * One switch — let members contact the team — and the kinds of request they
 * can open (ticket templates): a name, what to ask them, private or public,
 * and what it files as. Saved on the community's feedback listing
 * (lib/inbox-settings.ts), so members' apps show the same choices.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { fetchNip11 } from "@/lib/nip11";
import { publishEvent } from "@/lib/nostr";
import { signWithTimeout } from "@/lib/signer-timeout";
import { fetchFeedbackListing, invalidateRecipientCache, relayScopedRepoD, type FeedbackType } from "@/lib/nip34-feedback";
import { readInboxSettings, writeInboxSettings, STARTER_TEMPLATES, type TicketTemplate } from "@/lib/inbox-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Event as NostrEvent } from "nostr-tools";

const KIND_WORD: Record<FeedbackType, string> = { bug: "Problem", idea: "Idea", question: "Question", ux: "Design" };

export function MemberInboxSettings({ relayUrl, relayName }: { relayUrl: string; relayName: string }) {
  const { signer, pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [listing, setListing] = useState<NostrEvent | null | undefined>(undefined); // undefined = still reading
  const [operator, setOperator] = useState<string | null>(null);
  // Members find the inbox through the relay's named owner; with none named,
  // a saved inbox would have nowhere for them to reach.
  const [ownerless, setOwnerless] = useState(false);
  const [on, setOn] = useState(false);
  const [templates, setTemplates] = useState<TicketTemplate[]>(STARTER_TEMPLATES);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");

  useEffect(() => {
    let live = true;
    setListing(undefined);
    (async () => {
      const nip11 = await fetchNip11(relayUrl).catch(() => null);
      const op = nip11?.pubkey || pubkey || null;
      if (!live) return;
      setOperator(op);
      setOwnerless(!nip11?.pubkey);
      const found = op ? await fetchFeedbackListing(relayUrl, op).catch(() => null) : null;
      if (!live) return;
      const s = readInboxSettings(found);
      setListing(found);
      setOn(s.on);
      setTemplates(s.templates);
      setSavedAt(JSON.stringify({ on: s.on, templates: s.templates }));
    })();
    return () => { live = false; };
  }, [relayUrl, pubkey]);

  const dirty = useMemo(() => JSON.stringify({ on, templates }) !== savedAt, [on, templates, savedAt]);
  const blank = templates.some((t) => t.enabled && !t.label.trim());
  const notYours = !!operator && !!pubkey && operator !== pubkey;

  const update = (i: number, patch: Partial<TicketTemplate>) => setTemplates((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const move = (i: number, by: number) => setTemplates((ts) => {
    const j = i + by;
    if (j < 0 || j >= ts.length) return ts;
    const next = [...ts];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    if (!signer || listing === undefined) return;
    setSaving(true);
    try {
      const base = { d: relayScopedRepoD(relayUrl), name: `${relayName} feedback`, description: `Feedback inbox for ${relayName}`, relay: relayUrl };
      // Every other tag on the listing is kept (lib/inbox-settings.ts).
      const tpl = writeInboxSettings(listing, { on, templates }, base);
      const signed = await signWithTimeout(signer, tpl);
      await publishEvent(signed, [relayUrl], undefined, true);
      invalidateRecipientCache(relayUrl);
      // The Inbox read the old settings when it opened; tell it to read again.
      window.dispatchEvent(new CustomEvent("relay-outpost:inbox-settings-saved", { detail: { relayUrl } }));
      setListing(signed as unknown as NostrEvent);
      setSavedAt(JSON.stringify({ on, templates }));
      toast({ title: on ? "Members can contact the team" : "Member inbox turned off", description: on ? `They'll see Contact the team on ${relayName}'s page.` : "Nothing is deleted; turn it back on any time." });
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (listing === undefined) return <p className="py-8 text-center text-sm text-muted-foreground" role="status">Reading {relayName}'s inbox settings…</p>;

  return (
    <div className="space-y-6" data-testid="member-inbox-settings">
      <label className="flex items-start justify-between gap-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-4 py-3.5 min-h-[64px]">
        <span className="min-w-0">
          <span className="block text-[15px] font-medium">Let members contact the team</span>
          <span className="block text-[13px] text-muted-foreground">Members see <span className="text-foreground/80">Contact the team</span> on {relayName}'s page. What they send lands in your Inbox.</span>
        </span>
        <Switch checked={on} onCheckedChange={setOn} className="mt-1" data-testid="member-inbox-switch" />
      </label>

      <section aria-labelledby="mi-types" className={on ? "" : "opacity-60"}>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h3 id="mi-types" className="text-[13px] font-medium text-muted-foreground">What members can ask</h3>
          <button type="button" onClick={() => setTemplates(STARTER_TEMPLATES)} className="min-h-[44px] px-1 text-[13px] text-muted-foreground hover:text-foreground" data-testid="member-inbox-restore">Restore the starters</button>
        </div>
        <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08] border-y border-black/[0.06] dark:border-white/[0.08]">
          {templates.map((t, i) => (
            <li key={t.id} className="py-3 space-y-2" data-testid="member-inbox-template" data-id={t.id}>
              <div className="flex items-center gap-2">
                <Input value={t.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Name, e.g. Ask for help" className="h-11 text-[15px] font-medium flex-1" aria-label="Name" data-testid="member-inbox-template-label" />
                <Switch checked={t.enabled} onCheckedChange={(v) => update(i, { enabled: v })} aria-label={`Offer ${t.label || "this"}`} data-testid="member-inbox-template-on" />
              </div>
              <Input value={t.prompt} onChange={(e) => update(i, { prompt: e.target.value })} placeholder="What to ask them" className="h-11 text-[14px]" aria-label="What to ask them" data-testid="member-inbox-template-prompt" />
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <div role="radiogroup" aria-label="Who sees it" className="inline-flex rounded-full border border-black/[0.1] dark:border-white/[0.12] p-0.5">
                  {(["private", "public"] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={t.visibility === v} onClick={() => update(i, { visibility: v })}
                      className={`min-h-[44px] px-3 rounded-full ${t.visibility === v ? "bg-brand/[0.1] text-brand font-medium" : "text-muted-foreground"}`}
                      data-testid={`member-inbox-template-${v}`}>{v === "private" ? "Private" : "Public"}</button>
                  ))}
                </div>
                <label className="inline-flex items-center gap-1.5 text-muted-foreground">
                  Files as
                  <select value={t.kind} onChange={(e) => update(i, { kind: e.target.value as FeedbackType })} className="min-h-[44px] rounded-lg border border-black/[0.1] dark:border-white/[0.12] bg-background px-2 text-foreground" data-testid="member-inbox-template-kind">
                    {(Object.keys(KIND_WORD) as FeedbackType[]).map((k) => <option key={k} value={k}>{KIND_WORD[k]}</option>)}
                  </select>
                </label>
                <span className="ml-auto inline-flex items-center">
                  <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full" onClick={() => move(i, 1)} disabled={i === templates.length - 1} aria-label="Move down"><ArrowDown className="w-4 h-4" /></Button>
                  <button type="button" onClick={() => setTemplates((ts) => ts.filter((_, j) => j !== i))} className="min-h-[44px] px-2 text-muted-foreground hover:text-red-600" data-testid="member-inbox-template-remove">Remove</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setTemplates((ts) => [...ts, { id: Math.random().toString(36).slice(2, 10), label: "", prompt: "", visibility: "private", kind: "question", enabled: true }])}
          className="mt-2 min-h-[44px] text-[14px] font-medium text-brand" data-testid="member-inbox-template-add">Add a kind of request</button>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || saving || blank || !signer || notYours || ownerless} className="h-11 rounded-full px-6" data-testid="member-inbox-save">{saving ? "Saving…" : "Save"}</Button>
        {blank && <span className="text-[13px] text-amber-700 dark:text-amber-400">Give each request a name.</span>}
        {notYours && <span className="text-[13px] text-muted-foreground">Only {relayName}'s operator can change this.</span>}
        {ownerless && <span className="text-[13px] text-warning dark:text-amber-400" data-testid="member-inbox-ownerless">{relayName} doesn't name its owner, so members can't reach an inbox here yet. Ask your host to list you as the owner.</span>}
        {!dirty && !saving && savedAt && <span className="text-[13px] text-muted-foreground" data-testid="member-inbox-saved">Saved</span>}
      </div>
    </div>
  );
}
