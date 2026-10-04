/**
 * Overview › Set up your community (owner, 2026-10-04). See lib/setup-checklist.ts.
 *
 * Facts come from the relay where they can (its public card, the rules
 * record, the team, the member-inbox listing); the two that can't — you
 * confirmed who can post, you copied the link — are remembered on this device.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Circle, ChevronRight } from "lucide-react";
import type { Nip11Document } from "@/lib/nip11";
import type { RelayTeam } from "@/hooks/use-relay-team";
import { pool } from "@/lib/nostr";
import { communityRecordRelays } from "@/lib/featured";
import { fetchFeedbackListing } from "@/lib/nip34-feedback";
import { readInboxSettings } from "@/lib/inbox-settings";
import { setupChecklist, type SetupItem } from "@/lib/setup-checklist";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import type { TabId } from "./shared";

export const SETUP_CHANGED_EVENT = "relay-outpost:setup-changed";
const flagKey = (what: "wcp" | "justme" | "shared" | "hidden", relayUrl: string) => `ro_setup_${what}_${relayUrl}`;

function readFlag(what: "wcp" | "justme" | "shared" | "hidden", relayUrl: string): boolean {
  try { return localStorage.getItem(flagKey(what, relayUrl)) === "1"; } catch { return false; }
}

/** Remember one of the things the relay can't tell us, and let the page know. */
export function setSetupFlag(what: "wcp" | "justme" | "shared" | "hidden", relayUrl: string, on = true): void {
  try { if (on) localStorage.setItem(flagKey(what, relayUrl), "1"); else localStorage.removeItem(flagKey(what, relayUrl)); } catch { /* this visit only */ }
  try { window.dispatchEvent(new CustomEvent(SETUP_CHANGED_EVENT, { detail: { relayUrl } })); } catch { /* no window */ }
}

export function useSetupChecklist(relayUrl: string, nip11: Nip11Document | null, team: RelayTeam, me: string | null) {
  const owner = (nip11?.pubkey && /^[0-9a-f]{64}$/i.test(nip11.pubkey) ? nip11.pubkey : me)?.toLowerCase() ?? null;
  const [rules, setRules] = useState(false);
  const [inboxOn, setInboxOn] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener(SETUP_CHANGED_EVENT, again);
    window.addEventListener("relay-outpost:inbox-settings-saved", again);
    return () => { window.removeEventListener(SETUP_CHANGED_EVENT, again); window.removeEventListener("relay-outpost:inbox-settings-saved", again); };
  }, []);
  useEffect(() => {
    let live = true;
    if (!owner) return;
    pool.querySync(communityRecordRelays(relayUrl), { kinds: [30078], authors: [owner], "#d": [`relay-outpost/community-rules/${relayUrl}`], limit: 1 }, { maxWait: 4000 } as never)
      .then((evs) => {
        if (!live) return;
        const newest = [...evs].sort((a, b) => b.created_at - a.created_at)[0];
        try { setRules(!!newest && !!String((JSON.parse(newest.content) as { rules?: unknown }).rules ?? "").trim()); } catch { setRules(false); }
      })
      .catch(() => {});
    fetchFeedbackListing(relayUrl, owner).then((l) => { if (live) setInboxOn(readInboxSettings(l).on); }).catch(() => {});
    return () => { live = false; };
  }, [relayUrl, owner, tick]);
  const facts = {
    name: !!nip11?.name?.trim(),
    picture: !!nip11?.icon?.trim(),
    description: !!nip11?.description?.trim(),
    rules,
    whoCanPostConfirmed: readFlag("wcp", relayUrl),
    teammates: team.members.filter((m) => m !== team.owner).length,
    justMe: readFlag("justme", relayUrl),
    inboxOn,
    shared: readFlag("shared", relayUrl),
  };
  // `tick` re-reads the device flags when they change.
  const list = useMemo(() => setupChecklist(facts), [JSON.stringify(facts), tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = readFlag("hidden", relayUrl);
  const isOwner = !!me && !!owner && owner === me.toLowerCase();
  return { ...list, hidden, isOwner };
}

export type SetupState = ReturnType<typeof useSetupChecklist>;

export function SetupChecklist({ relayUrl, state, onGo }: { relayUrl: string; state: SetupState; onGo: (tab: TabId) => void }) {
  const { toast } = useToast();
  const copyLink = useCallback(async () => {
    const link = `${window.location.origin}/outposts/${encodeURIComponent(relayUrl)}`;
    try {
      await navigator.clipboard.writeText(link);
      setSetupFlag("shared", relayUrl);
      toast({ title: "Link copied", description: "Send it to the people you want here." });
    } catch {
      toast({ title: "Couldn't copy the link", description: link, variant: "destructive" });
    }
  }, [relayUrl, toast]);
  if (!state.isOwner || state.complete || state.hidden) return null;
  const pct = Math.round((state.done / state.items.length) * 100);
  const action = (i: SetupItem) => {
    if (i.done) return null;
    if (i.id === "share") return <Button size="sm" variant="outline" className="h-10 rounded-full px-4" onClick={() => void copyLink()} data-testid="ops-setup-copy-link">Copy link</Button>;
    return (
      <span className="flex items-center gap-1">
        {i.id === "team" && <Button size="sm" variant="ghost" className="h-10 px-3 text-[13px]" onClick={() => setSetupFlag("justme", relayUrl)} data-testid="ops-setup-just-me">Just me</Button>}
        <Button size="sm" variant="ghost" className="h-10 px-3 text-[13px] text-brand" onClick={() => i.go && onGo(i.go)} data-testid={`ops-setup-go-${i.id}`}>Open<ChevronRight className="w-4 h-4 ml-0.5" aria-hidden="true" /></Button>
      </span>
    );
  };
  return (
    <section className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden" data-testid="ops-setup">
      <div className="flex items-center gap-3 px-4 pt-3.5">
        <h2 className="text-[15px] font-semibold flex-1">Set up your community</h2>
        <span className="text-[13px] text-muted-foreground tabular-nums" data-testid="ops-setup-progress">{state.done} of {state.items.length} done</span>
        <Button size="sm" variant="ghost" className="h-10 px-3 text-[13px] text-muted-foreground" onClick={() => setSetupFlag("hidden", relayUrl)} data-testid="ops-setup-hide">Hide</Button>
      </div>
      <div className="mx-4 mt-2 h-1 rounded-full bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden="true"><div className="h-1 rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} /></div>
      <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {state.items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-4 min-h-[56px]" data-testid="ops-setup-item" data-id={i.id} data-done={i.done ? "true" : "false"}>
            {i.done ? <Check className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" /> : <Circle className="w-5 h-5 shrink-0 text-muted-foreground/50" aria-label="Not yet" />}
            <span className="min-w-0 flex-1">
              <span className={`block text-[14px] font-medium ${i.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>{i.label}</span>
              {!i.done && <span className="block text-[13px] text-muted-foreground">{i.hint}</span>}
            </span>
            {action(i)}
          </li>
        ))}
      </ul>
    </section>
  );
}
