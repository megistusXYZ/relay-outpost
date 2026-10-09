/**
 * Overview › Set up your community (owner, 2026-10-04; by hand and across
 * devices 2026-10-09). See lib/setup-checklist.ts and lib/setup-progress.ts.
 *
 * Facts come from the relay where they can (its public card, the rules
 * record, the team, the member-inbox listing, the badges). What the relay
 * can't tell us — a step ticked or skipped by hand, "just me", "I copied the
 * link", hidden — is the owner's own record kept with the community, so
 * every device agrees. The list opens where it left off (the last record and
 * facts this browser saw) and then quietly re-checks.
 */
import { fetchBadgeDefinitionsByAuthor } from "@/lib/nip58-badges";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, ChevronRight } from "lucide-react";
import type { Nip11Document } from "@/lib/nip11";
import { clearNip11Cache, fetchNip11 } from "@/lib/nip11";
import type { RelayTeam } from "@/hooks/use-relay-team";
import { pool } from "@/lib/nostr";
import { communityRecordRelays } from "@/lib/featured";
import { fetchFeedbackListing } from "@/lib/nip34-feedback";
import { readInboxSettings } from "@/lib/inbox-settings";
import { setupChecklist, type SetupItem, type SetupItemId } from "@/lib/setup-checklist";
import { emptyProgress, markDone, newer, PROGRESS_D_TAG, readProgress, setHidden, skipStep, unmark, type SetupProgress } from "@/lib/setup-progress";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { signWithTimeout } from "@/lib/signer-timeout";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import type { TabId } from "./shared";

export const SETUP_CHANGED_EVENT = "relay-outpost:setup-changed";
/** A change asked for from another screen (Who can post's confirm, the menu's resume). */
const SETUP_CHANGE_EVENT = "relay-outpost:setup-change";
type Flag = "wcp" | "justme" | "shared" | "hidden";
const lastKey = (relayUrl: string) => `ro_setup_last_${relayUrl}`;
const flagKey = (what: Flag, relayUrl: string) => `ro_setup_${what}_${relayUrl}`;

/**
 * Kept for the screens that call it: a hand-tick from elsewhere. The console's
 * checklist hook applies it to the owner's record; until it has, the old
 * device flag stands in so nothing is lost.
 */
export function setSetupFlag(what: Flag, relayUrl: string, on = true): void {
  try { if (on) localStorage.setItem(flagKey(what, relayUrl), "1"); else localStorage.removeItem(flagKey(what, relayUrl)); } catch { /* this visit only */ }
  try { window.dispatchEvent(new CustomEvent(SETUP_CHANGE_EVENT, { detail: { relayUrl, what, on } })); } catch { /* no window */ }
}

interface Last { facts: Facts; progress: SetupProgress }
interface Facts { name: boolean; picture: boolean; description: boolean; rules: boolean; teammates: number; inboxOn: boolean; badges: number }

function readLast(relayUrl: string): Last | null {
  try {
    const raw = localStorage.getItem(lastKey(relayUrl));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Last>;
    const progress = v.progress ? readProgress(JSON.stringify(v.progress)) : null;
    if (!v.facts || !progress) return null;
    return { facts: v.facts, progress };
  } catch { return null; }
}
function writeLast(relayUrl: string, last: Last): void {
  try { localStorage.setItem(lastKey(relayUrl), JSON.stringify(last)); } catch { /* this visit only */ }
}
/** The flags this browser kept before the record existed, as a record — read once, then they're the record's. */
function legacyFlags(relayUrl: string): SetupProgress | null {
  const has = (w: Flag) => { try { return localStorage.getItem(flagKey(w, relayUrl)) === "1"; } catch { return false; } };
  const done: SetupItemId[] = []; const skipped: SetupItemId[] = [];
  if (has("wcp")) done.push("who-can-post");
  if (has("shared")) done.push("share");
  if (has("justme")) skipped.push("team");
  const hidden = has("hidden");
  if (!done.length && !skipped.length && !hidden) return null;
  return { done, skipped, hidden, at: 1 };
}

export function useSetupChecklist(relayUrl: string, nip11: Nip11Document | null, team: RelayTeam, me: string | null) {
  const owner = (nip11?.pubkey && /^[0-9a-f]{64}$/i.test(nip11.pubkey) ? nip11.pubkey : me)?.toLowerCase() ?? null;
  const last = useMemo(() => readLast(relayUrl), [relayUrl]);
  const [facts, setFacts] = useState<Facts>(() => last?.facts ?? { name: false, picture: false, description: false, rules: false, teammates: 0, inboxOn: false, badges: 0 });
  const [progress, setProgress] = useState<SetupProgress>(() => last?.progress ?? legacyFlags(relayUrl) ?? emptyProgress());
  const [freshCard, setFreshCard] = useState<Nip11Document | null>(null);
  const [tick, setTick] = useState(0);
  const progressRef = useRef(progress); progressRef.current = progress;

  // Re-check when a screen says something changed; re-read the public card
  // too, since the console fetched it once and saving a name doesn't refresh it.
  useEffect(() => {
    const again = () => { clearNip11Cache(relayUrl); setTick((n) => n + 1); };
    window.addEventListener(SETUP_CHANGED_EVENT, again);
    window.addEventListener("relay-outpost:inbox-settings-saved", again);
    return () => { window.removeEventListener(SETUP_CHANGED_EVENT, again); window.removeEventListener("relay-outpost:inbox-settings-saved", again); };
  }, [relayUrl]);

  useEffect(() => {
    let live = true;
    if (!owner) return;
    const relays = communityRecordRelays(relayUrl);
    if (tick > 0) fetchNip11(relayUrl).then((d) => { if (live && d) setFreshCard(d); }).catch(() => {});
    pool.querySync(relays, { kinds: [30078], authors: [owner], "#d": [`relay-outpost/community-rules/${relayUrl}`], limit: 1 }, { maxWait: 4000 } as never)
      .then((evs) => {
        if (!live) return;
        const newest = [...evs].sort((a, b) => b.created_at - a.created_at)[0];
        let rules = false;
        try { rules = !!newest && !!String((JSON.parse(newest.content) as { rules?: unknown }).rules ?? "").trim(); } catch { rules = false; }
        setFacts((f) => ({ ...f, rules }));
      })
      .catch(() => {});
    // The owner's own progress: the newer of the relay's copy and this browser's.
    pool.querySync(relays, { kinds: [30078], authors: [owner], "#d": [PROGRESS_D_TAG(relayUrl)], limit: 1 }, { maxWait: 4000 } as never)
      .then((evs) => {
        if (!live) return;
        const newest = [...evs].sort((a, b) => b.created_at - a.created_at)[0];
        const fromRelay = newest ? readProgress(newest.content) : null;
        const merged = newer(progressRef.current, fromRelay);
        if (merged && merged !== progressRef.current) setProgress(merged);
      })
      .catch(() => {});
    fetchFeedbackListing(relayUrl, owner).then((l) => { if (live) setFacts((f) => ({ ...f, inboxOn: readInboxSettings(l).on })); }).catch(() => {});
    fetchBadgeDefinitionsByAuthor(owner).then((defs) => { if (live) setFacts((f) => ({ ...f, badges: defs.filter((d) => d.community === relayUrl).length })); }).catch(() => {});
    return () => { live = false; };
  }, [relayUrl, owner, tick]);

  const card = freshCard ?? nip11;
  useEffect(() => {
    if (!card) return;
    setFacts((f) => ({ ...f, name: !!card.name?.trim(), picture: !!card.icon?.trim(), description: !!card.description?.trim() }));
  }, [card]);
  useEffect(() => { setFacts((f) => ({ ...f, teammates: team.members.filter((m) => m !== team.owner).length })); }, [team.members, team.owner]);

  // Write a change: the record goes to the relay (signed by you), and this
  // browser keeps the copy. If signing or the relay fails, the copy still stands.
  const change = useCallback(async (fn: (p: SetupProgress) => SetupProgress) => {
    const next = fn(progressRef.current);
    const stamped = { ...next, at: Math.max(Math.floor(Date.now() / 1000), progressRef.current.at + 1) };
    setProgress(stamped);
    const signer = getGlobalSigner();
    if (!signer) return;
    try {
      const signed = await signWithTimeout(signer, { kind: 30078, created_at: stamped.at, tags: [["d", PROGRESS_D_TAG(relayUrl)], ["relay", relayUrl]], content: JSON.stringify(stamped) } as never);
      const { publishEvent } = await import("@/lib/nostr");
      await publishEvent(signed as never, communityRecordRelays(relayUrl));
    } catch { /* kept here; the next change tries again */ }
  }, [relayUrl]);

  // Hand-ticks asked for from other screens (Who can post's confirm; the menu's resume).
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ relayUrl: string; what: Flag; on: boolean }>).detail;
      if (!d || d.relayUrl !== relayUrl) return;
      const at = 0;
      if (d.what === "hidden") void change((p) => setHidden(p, d.on, at));
      else if (d.what === "wcp") void change((p) => (d.on ? markDone(p, "who-can-post", at) : unmark(p, "who-can-post", at)));
      else if (d.what === "shared") void change((p) => (d.on ? markDone(p, "share", at) : unmark(p, "share", at)));
      else if (d.what === "justme") void change((p) => (d.on ? skipStep(p, "team", at) : unmark(p, "team", at)));
      try { localStorage.removeItem(flagKey(d.what, relayUrl)); } catch { /* fine */ }
    };
    window.addEventListener(SETUP_CHANGE_EVENT, on);
    return () => window.removeEventListener(SETUP_CHANGE_EVENT, on);
  }, [relayUrl, change]);

  const list = useMemo(() => setupChecklist({ ...facts, whoCanPostConfirmed: false, justMe: false, shared: false }, progress), [facts, progress]);
  useEffect(() => { writeLast(relayUrl, { facts, progress }); }, [relayUrl, facts, progress]);
  const isOwner = !!me && !!owner && owner === me.toLowerCase();
  return { ...list, hidden: progress.hidden, isOwner, change };
}

export type SetupState = ReturnType<typeof useSetupChecklist>;

export function SetupChecklist({ relayUrl, state, onGo }: { relayUrl: string; state: SetupState; onGo: (tab: TabId) => void }) {
  const { toast } = useToast();
  const copyLink = useCallback(async () => {
    const link = `${window.location.origin}/outposts/${encodeURIComponent(relayUrl)}`;
    try {
      await navigator.clipboard.writeText(link);
      void state.change((p) => markDone(p, "share", 0));
      toast({ title: "Link copied", description: "Send it to the people you want here." });
    } catch {
      toast({ title: "Couldn't copy the link", description: link, variant: "destructive" });
    }
  }, [relayUrl, toast, state]);
  if (!state.isOwner || state.complete || state.hidden) return null;
  const pct = Math.round((state.done / state.items.length) * 100);
  const tickByHand = (i: SetupItem) => {
    void state.change((p) => markDone(p, i.id, 0));
    toast({ title: `${i.label} — marked done`, description: "Tap the tick to undo." });
  };
  const skip = (i: SetupItem) => {
    void state.change((p) => skipStep(p, i.id, 0));
    toast({ title: `${i.label} — skipped`, description: "Tap the tick to bring it back." });
  };
  const undo = (i: SetupItem) => void state.change((p) => unmark(p, i.id, 0));
  // Compact on a phone: the text itself opens the step (a settings-list row), the
  // chevron says so, Skip is a word. The share row's action is Copy link; to
  // disregard it, tap the circle.
  const action = (i: SetupItem) => {
    if (i.done) return null;
    return (
      <span className="flex items-center gap-0.5 shrink-0">
        {i.id === "team" && <Button size="sm" variant="ghost" className="h-10 px-2.5 text-[13px] text-muted-foreground" onClick={() => skip(i)} data-testid="ops-setup-just-me">Just me</Button>}
        {i.id !== "team" && i.id !== "share" && <Button size="sm" variant="ghost" className="h-10 px-2.5 text-[13px] text-muted-foreground" onClick={() => skip(i)} data-testid="ops-setup-skip">Skip</Button>}
        {i.id === "share"
          ? <Button size="sm" variant="outline" className="h-10 rounded-full px-4" onClick={() => void copyLink()} data-testid="ops-setup-copy-link">Copy link</Button>
          : <button type="button" onClick={() => i.go && onGo(i.go)} aria-label={`Open ${i.label}`} className="w-11 h-11 inline-flex items-center justify-center rounded-full text-brand hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" data-testid={`ops-setup-go-${i.id}`}><ChevronRight className="w-5 h-5" aria-hidden="true" /></button>}
      </span>
    );
  };
  return (
    <section className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden" data-testid="ops-setup">
      <div className="flex items-center gap-3 px-4 pt-3.5">
        <h2 className="text-[15px] font-semibold flex-1">Set up your community</h2>
        <span className="text-[13px] text-muted-foreground tabular-nums" data-testid="ops-setup-progress">{state.done} of {state.items.length} done</span>
        <Button size="sm" variant="ghost" className="h-10 px-3 text-[13px] text-muted-foreground" onClick={() => void state.change((p) => setHidden(p, true, 0))} data-testid="ops-setup-hide">Hide</Button>
      </div>
      <div className="mx-4 mt-2 h-1 rounded-full bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden="true"><div className="h-1 rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} /></div>
      <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {state.items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 pl-2 pr-4 min-h-[56px]" data-testid="ops-setup-item" data-id={i.id} data-done={i.done ? "true" : "false"} data-skipped={i.skipped ? "true" : "false"}>
            {/* The circle is the checkbox: tap to mark done; tap the tick to undo. */}
            <button
              type="button"
              onClick={() => (i.done ? undo(i) : tickByHand(i))}
              aria-label={i.done ? `${i.label}: done — tap to undo` : `${i.label}: mark done`}
              className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              data-testid={i.done ? "ops-setup-undo" : "ops-setup-mark-done"}
            >
              {i.done ? <Check className="w-5 h-5 text-success dark:text-emerald-400" aria-hidden="true" /> : <Circle className="w-5 h-5 text-muted-foreground" aria-hidden="true" />}
            </button>
            {/* The text opens the step too; the label is never cut off (a hint may be). */}
            {!i.done && i.go ? (
              <button type="button" onClick={() => onGo(i.go!)} className="min-w-0 flex-1 text-left py-2" data-testid="ops-setup-open-text">
                <span className="block text-[14px] font-medium" data-testid="ops-setup-label">{i.label}</span>
                <span className="block text-[13px] text-muted-foreground truncate">{i.hint}</span>
              </button>
            ) : (
              <span className="min-w-0 flex-1 py-2">
                <span className={`block text-[14px] font-medium ${i.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`} data-testid="ops-setup-label">{i.label}</span>
                {!i.done && <span className="block text-[13px] text-muted-foreground truncate">{i.hint}</span>}
                {i.skipped && <span className="block text-[13px] text-muted-foreground">Skipped</span>}
              </span>
            )}
            {action(i)}
          </li>
        ))}
      </ul>
    </section>
  );
}
