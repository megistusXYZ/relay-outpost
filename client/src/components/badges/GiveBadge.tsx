/**
 * Give a badge (owner, 2026-10-06 — badges-plan, step 3): pick the badge,
 * pick people the way you'd add them to a chat — the people you follow, or a
 * search — add a note if you like, and confirm in plain words before anything
 * is sent: "Give Founding member to 12 people?".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { nip19 } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { Award, Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { eventStore, searchCachedProfiles, fetchProfilesCached } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { fetchBadgeDefinitionsByAuthorResult, awardBadge, type BadgeDefinition } from "@/lib/nip58-badges";

function usePerson(pubkey: string) {
  const meta = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const fallback = useMemo(() => { try { return nip19.npubEncode(pubkey).slice(0, 12) + "…"; } catch { return "Someone"; } }, [pubkey]);
  return { name: (meta && getDisplayName(meta, "")) || fallback, avatar: meta ? getAvatarUrl(meta) : undefined };
}

function PersonButton({ pubkey, selected, onToggle }: { pubkey: string; selected: boolean; onToggle: () => void }) {
  const { name, avatar } = usePerson(pubkey);
  return (
    <button type="button" onClick={onToggle} aria-pressed={selected}
      className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${selected ? "bg-primary/10" : "hover:bg-muted/40"}`}
      data-testid={`give-person-${pubkey.slice(0, 8)}`}>
      <Avatar className="h-8 w-8"><AvatarImage src={avatar} /><AvatarFallback>{name.slice(0, 1)}</AvatarFallback></Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {selected && <Check className="h-4 w-4 text-primary" aria-hidden />}
    </button>
  );
}

function Chip({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const { name } = usePerson(pubkey);
  return (
    <span className="inline-flex min-h-[44px] items-center gap-1 rounded-full bg-muted pl-3 text-sm">
      {name}
      <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/10">
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function BadgeChoice({ def, selected, onPick }: { def: BadgeDefinition; selected: boolean; onPick: () => void }) {
  const [broken, setBroken] = useState(false);
  const src = def.thumb || def.image;
  return (
    <button type="button" onClick={onPick} role="radio" aria-checked={selected}
      className={`flex min-h-[44px] items-center gap-2 rounded-lg border p-2 text-left ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}
      data-testid={`give-badge-${def.dTag}`}>
      {src && !broken ? <img src={src} alt="" className="h-8 w-8 object-contain" onError={() => setBroken(true)} /> : <Award className="h-6 w-6 text-brand" aria-hidden />}
      <span className="truncate text-sm font-medium">{def.name}</span>
    </button>
  );
}

export function GiveBadge({ refreshKey = 0, onCreate, community, initialPeople = [], onGiven }: {
  refreshKey?: number;
  onCreate: () => void;
  /** Give this community's badges (and send them to its relay too). */
  community?: string;
  /** People already chosen (e.g. selected in the community's People list). */
  initialPeople?: string[];
  onGiven?: () => void;
}) {
  const { pubkey, signer, follows } = useNostrAuth();
  const { toast } = useToast();
  const [badges, setBadges] = useState<BadgeDefinition[] | null>(null);
  const [badge, setBadge] = useState<BadgeDefinition | null>(null);
  const [people, setPeople] = useState<string[]>(initialPeople);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [giving, setGiving] = useState(false);

  useEffect(() => {
    if (!pubkey) return;
    let off = false;
    void fetchBadgeDefinitionsByAuthorResult(pubkey).then(({ data }) => {
      if (off) return;
      const sorted = data.filter((d) => (d.community ?? undefined) === community).sort((a, b) => b.createdAt - a.createdAt);
      setBadges(sorted);
      setBadge((cur) => cur ?? sorted[0] ?? null);
    });
    return () => { off = true; };
  }, [pubkey, refreshKey, community]);

  const suggested = useMemo(() => follows.filter((f) => f !== pubkey).slice(0, 12), [follows, pubkey]);
  useEffect(() => { if (suggested.length) fetchProfilesCached(suggested); }, [suggested]);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    const t = q.trim();
    if (t.length < 2) { setResults([]); return; }
    if (t.startsWith("npub1")) {
      try { const d = nip19.decode(t); if (d.type === "npub") { setResults([d.data as string]); return; } } catch { /* not an npub */ }
    }
    const cached = searchCachedProfiles(t, 6).map((e) => e.pubkey);
    if (cached.length) { setResults(cached); return; }
    try { setResults((await searchUsers(t, 6)).map((e) => e.pubkey)); } catch { setResults([]); }
  }, []);

  const toggle = (pk: string) => setPeople((p) => (p.includes(pk) ? p.filter((x) => x !== pk) : [...p, pk]));

  const give = async () => {
    if (!signer || !badge || people.length === 0) return;
    setConfirming(false);
    setGiving(true);
    try {
      const ok = await awardBadge(signer, badge.pubkey, badge.dTag, people, note, badge.community);
      if (ok) {
        toast({ title: "Badge given", description: `${badge.name} went to ${people.length === 1 ? "1 person" : `${people.length} people`}. They'll be asked whether to show it.` });
        setPeople([]); setNote(""); setQuery(""); setResults([]);
        onGiven?.();
      } else {
        toast({ title: "Couldn't give the badge", description: "Nothing was sent. Try again in a moment.", variant: "destructive" });
      }
    } finally {
      setGiving(false);
    }
  };

  if (badges === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (badges.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
        <p className="text-sm text-muted-foreground">Make a badge first, then give it here.</p>
        <Button variant="outline" className="min-h-[44px]" onClick={onCreate}>Create a badge</Button>
      </div>
    );
  }

  const listed = query.trim().length >= 2 ? results : suggested;
  const count = people.length === 1 ? "1 person" : `${people.length} people`;

  return (
    <div className="space-y-4" data-testid="give-badge">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Which badge</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Which badge">
          {badges.map((d) => <BadgeChoice key={d.dTag} def={d} selected={badge?.dTag === d.dTag} onPick={() => setBadge(d)} />)}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">To whom</p>
        {people.length > 0 && <div className="flex flex-wrap gap-2">{people.map((pk) => <Chip key={pk} pubkey={pk} onRemove={() => toggle(pk)} />)}</div>}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => void search(e.target.value)} placeholder="Search people by name" className="min-h-[44px] pl-9" data-testid="input-give-search" />
        </div>
        {listed.length > 0 && (
          <div className="rounded-lg border border-border p-1">
            {query.trim().length < 2 && <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">People you follow</p>}
            {listed.map((pk) => <PersonButton key={pk} pubkey={pk} selected={people.includes(pk)} onToggle={() => toggle(pk)} />)}
          </div>
        )}
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Add a note <span className="font-normal text-muted-foreground">(optional)</span></span>
        <Input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="e.g. For running the meetup" className="min-h-[44px]" data-testid="input-give-note" />
      </label>

      <Button className="min-h-[44px] w-full sm:w-auto" disabled={!badge || people.length === 0 || giving || !signer} onClick={() => setConfirming(true)} data-testid="button-give-badge">
        {giving ? "Giving…" : people.length ? `Give to ${count}` : "Choose people to give it to"}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        {/* Above a Dialog (z-210): Give badge also opens inside Relay Control's People pop-up. */}
        <AlertDialogContent className="z-[220]" overlayClassName="z-[220]">
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="give-confirm-title">Give {badge?.name} to {count}?</AlertDialogTitle>
            <AlertDialogDescription>They'll be notified and can choose to show it on their profile.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => void give()} data-testid="button-confirm-give">Give</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
