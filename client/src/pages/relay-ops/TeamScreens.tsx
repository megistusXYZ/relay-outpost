/**
 * Settings › Team and Settings › Moderation log (owner, 2026-10-03).
 *
 * Team: who shares the relay's private notes and moderation log. Their
 * records are encrypted to the people on this list and kept on the relay
 * itself (lib/relay-team.ts). Only the relay's owner changes the list; a
 * teammate's powers on the relay itself (removing posts, banning) are granted
 * by the relay, so where it can't grant them here, the screen says where.
 *
 * Moderation log: what the team has done, newest first — shared across the
 * team's devices. Entries recorded before sharing existed stay visible as
 * "on this device only".
 */
import { useEffect, useMemo, useState } from "react";
import { nip19 } from "nostr-tools";
import { Plus, X } from "lucide-react";
import type { Nip11Document } from "@/lib/nip11";
import { managedAt } from "@/lib/relay-capabilities";
import { describeLogEntry, deviceOnlyEntries, teamSuggestions } from "@/lib/team-records";
import { pool } from "@/lib/nostr";
import { communityRecordRelays } from "@/lib/featured";
import type { RelayTeam } from "@/hooks/use-relay-team";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ManagedAtNote } from "./ops-ui";
import { getModLog, getStoredList, MANUAL_TEAM_KEY, pubkeyToNpub, resolveProfileBatch, type ProfileInfo } from "./shared";

const OFFER_NO_KEY = "ro_team_offer_no_";

/**
 * People the console used to list as a team elsewhere — Overview's "Relay
 * Team" (this browser), the old moderators record, the relay's own
 * moderators — who aren't on the team. Offered once (owner, 2026-10-04: one
 * team list); "Not now" is remembered on this device.
 */
function useTeamOffer(relayUrl: string, nip11: Nip11Document | null, team: RelayTeam) {
  const [recordMods, setRecordMods] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setRecordMods([]);
    if (!team.owner) return;
    pool.querySync(communityRecordRelays(relayUrl), { kinds: [30078], authors: [team.owner], "#d": [`relay-outpost/moderators/${relayUrl}`], limit: 1 }, { maxWait: 4000 } as never)
      .then((evs) => {
        if (!live) return;
        const newest = [...evs].sort((a, b) => b.created_at - a.created_at)[0];
        try { const m = newest ? (JSON.parse(newest.content) as { moderators?: unknown }).moderators : []; setRecordMods(Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : []); } catch { /* not ours */ }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [relayUrl, team.owner]);
  const [no, setNo] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(OFFER_NO_KEY + relayUrl) || "[]"); } catch { return []; } });
  const people = useMemo(
    () => (team.isOwner && !team.loading ? teamSuggestions([getStoredList(MANUAL_TEAM_KEY, relayUrl), recordMods, nip11?.moderators ?? []], team.members, no) : []),
    [team.isOwner, team.loading, team.members, relayUrl, recordMods, nip11, no],
  );
  const notNow = (pk: string) => {
    const next = [...no, pk];
    setNo(next);
    try { localStorage.setItem(OFFER_NO_KEY + relayUrl, JSON.stringify(next)); } catch { /* this visit only */ }
  };
  return { people, notNow };
}

function useProfiles(pubkeys: string[]) {
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const key = pubkeys.join(",");
  useEffect(() => {
    const want = pubkeys.filter((pk) => !profiles.has(pk));
    if (!want.length) return;
    resolveProfileBatch(want).then((m) => setProfiles((prev) => { const n = new Map(prev); m.forEach((v, k) => n.set(k, v)); return n; })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return profiles;
}

function toHex(input: string): string | null {
  const s = input.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  try {
    const d = nip19.decode(s);
    if (d.type === "npub") return d.data as string;
    if (d.type === "nprofile") return (d.data as { pubkey: string }).pubkey;
  } catch {}
  return null;
}

function TeamUnavailable({ team, relayName }: { team: RelayTeam; relayName: string }) {
  if (!team.canEncrypt) {
    return <p className="rounded-xl bg-amber-500/10 px-3.5 py-3 text-[14px] text-amber-800 dark:text-amber-200" data-testid="ops-team-no-encrypt">Your signer can't encrypt, so team notes and the shared log are off. Sign in with a signer that supports private messages to use them.</p>;
  }
  if (!team.reached) {
    return <p className="rounded-xl bg-amber-500/10 px-3.5 py-3 text-[14px] text-amber-800 dark:text-amber-200" data-testid="ops-team-unreached">We couldn't reach {relayName} to read your team's records. Nothing here is the full picture until it's back.</p>;
  }
  return null;
}

export function TeamScreen({ relayUrl, nip11, team }: { relayUrl: string; nip11: Nip11Document | null; team: RelayTeam }) {
  const { toast } = useToast();
  const relayName = nip11?.name?.trim() || relayUrl.replace(/^wss?:\/\//, "");
  const profiles = useProfiles(team.members);
  const moderators = useMemo(() => new Set((nip11?.moderators ?? []).map((m) => m.toLowerCase())), [nip11]);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const ownerName = profiles.get(team.owner)?.name ?? "the relay's owner";
  const offer = useTeamOffer(relayUrl, nip11, team);
  const offerProfiles = useProfiles(offer.people);

  const change = async (next: string[], said: string) => {
    setBusy(true);
    const out = await team.setMembers(next);
    setBusy(false);
    if (!out.stored) toast({ title: "The team didn't change", description: out.reason, variant: "destructive" });
    else toast({ title: said, description: out.missed ? `${out.missed} of the team's copies weren't kept by the relay.` : undefined });
  };
  const add = async () => {
    const hex = toHex(adding);
    if (!hex) { toast({ title: "That isn't an npub", variant: "destructive" }); return; }
    if (team.members.includes(hex)) { toast({ title: "Already on the team" }); return; }
    await change([...team.members, hex], "Added to the team");
    setAdding("");
  };

  return (
    <div className="space-y-4 max-w-2xl" data-testid="ops-team">
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        Your team's notes and moderation log are encrypted and kept on {relayName}. Only the people here can read them.
      </p>
      <TeamUnavailable team={team} relayName={relayName} />
      <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-team-members">
        {team.members.map((pk) => {
          const p = profiles.get(pk);
          const name = p?.name || `${pubkeyToNpub(pk).slice(0, 14)}…`;
          const role = pk === team.owner ? "Runs the relay" : moderators.has(pk) ? "Moderator on the relay" : "Can see and add notes";
          return (
            <li key={pk} className="flex items-center gap-3 px-3.5 min-h-[60px]" data-testid="ops-team-member" data-pubkey={pk}>
              <Avatar className="w-9 h-9 shrink-0">{p?.picture && <AvatarImage src={p.picture} alt="" />}<AvatarFallback className="bg-brand/10 text-brand">{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
              <span className="min-w-0 flex-1">
                <span className="block font-medium truncate">{name}</span>
                <span className="block text-[13px] text-muted-foreground">{role}</span>
              </span>
              {team.isOwner && pk !== team.owner && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => change(team.members.filter((m) => m !== pk), "Removed from the team")} className="h-10 px-3 text-[13px] text-red-600 dark:text-red-400" aria-label={`Remove ${name} from the team`} data-testid="ops-team-remove">
                  <X className="w-4 h-4 mr-1" />Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {offer.people.length > 0 && (
        <section className="space-y-2" data-testid="ops-team-offer">
          <h3 className="text-[13px] font-medium text-muted-foreground">People you listed before — add them to your team?</h3>
          <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {offer.people.map((pk) => {
              const p = offerProfiles.get(pk);
              const name = p?.name || `${pubkeyToNpub(pk).slice(0, 14)}…`;
              return (
                <li key={pk} className="flex items-center gap-3 px-3.5 min-h-[60px]" data-testid="ops-team-offer-person" data-pubkey={pk}>
                  <Avatar className="w-9 h-9 shrink-0">{p?.picture && <AvatarImage src={p.picture} alt="" />}<AvatarFallback className="bg-brand/10 text-brand">{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1 font-medium truncate">{name}</span>
                  <Button variant="ghost" size="sm" className="h-10 px-3 text-[13px]" onClick={() => offer.notNow(pk)} data-testid="ops-team-offer-no">Not now</Button>
                  <Button size="sm" className="h-10 rounded-full px-4" disabled={busy || !team.canEncrypt} onClick={() => change([...team.members, pk], "Added to the team")} data-testid="ops-team-offer-add">Add</Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {team.isOwner ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add someone by npub" className="h-11 flex-1" aria-label="Add someone by npub" data-testid="ops-team-add-input" />
          <Button type="submit" disabled={busy || !adding.trim() || !team.canEncrypt} className="h-11 rounded-full px-5" data-testid="ops-team-add"><Plus className="w-4 h-4 mr-1.5" />Add</Button>
        </form>
      ) : (
        <p className="text-[13px] text-muted-foreground" data-testid="ops-team-not-owner">Only {ownerName} can change the team.</p>
      )}
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Someone you remove can't read anything written after. What they've already seen can't be taken back.
      </p>
      <ManagedAtNote
        where={managedAt(relayUrl)}
        lead="Being on the team lets someone read and add notes. To let them remove posts or ban people on the relay itself,"
        verb="add them as moderators"
        testId="ops-team-powers"
      />
    </div>
  );
}

function ago(sec: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(sec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function LogScreen({ relayUrl, nip11, team }: { relayUrl: string; nip11: Nip11Document | null; team: RelayTeam }) {
  const relayName = nip11?.name?.trim() || relayUrl.replace(/^wss?:\/\//, "");
  const people = useMemo(() => [...new Set(team.log.flatMap((e) => [e.author, ...(e.targetPubkey ? [e.targetPubkey] : [])]))], [team.log]);
  const profiles = useProfiles(people);
  const nameOf = (pk?: string) => (pk ? profiles.get(pk)?.name || `${pubkeyToNpub(pk).slice(0, 12)}…` : "");
  // What only this device knows: from before the team log existed, or while it couldn't be written.
  const local = useMemo(() => deviceOnlyEntries(getModLog(relayUrl), team.log).reverse(), [relayUrl, team.log]);

  return (
    <div className="space-y-4 max-w-3xl" data-testid="ops-log">
      <TeamUnavailable team={team} relayName={relayName} />
      {team.log.length === 0 && !team.loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground" data-testid="ops-log-empty">Nothing your team has done here yet.</p>
      ) : (
        <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-log-list">
          {team.log.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-3.5 py-3" data-testid="ops-log-entry">
              <Avatar className="w-8 h-8 shrink-0">{profiles.get(e.author)?.picture && <AvatarImage src={profiles.get(e.author)!.picture} alt="" />}<AvatarFallback className="bg-brand/10 text-brand text-[12px]">{nameOf(e.author).slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-snug"><span className="font-medium">{nameOf(e.author)}</span> · {describeLogEntry(e)}</span>
                <span className="block text-[13px] text-muted-foreground">{e.targetPubkey ? `${nameOf(e.targetPubkey)} · ` : ""}{ago(e.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {local.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="min-h-[44px] text-[13px] font-medium text-muted-foreground hover:text-foreground" data-testid="ops-log-local">
            Earlier, on this device only ({local.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1 space-y-1 text-[13px] text-muted-foreground">
              {local.slice(0, 200).map((e) => (
                <li key={e.id}>{describeLogEntry({ action: e.action, count: e.count, note: e.note })} · {new Date(e.ts).toLocaleString()}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/** Notes about a member, for a person's detail in People. */
export function MemberNotes({ team, about }: { team: RelayTeam; about: string }) {
  const { toast } = useToast();
  const notes = team.notesAbout(about);
  const profiles = useProfiles(notes.map((n) => n.author));
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  if (!team.canEncrypt) return null;
  const save = async () => {
    setSaving(true);
    const out = await team.addNote(about, text);
    setSaving(false);
    if (!out.stored) { toast({ title: "The note wasn't saved", description: out.reason, variant: "destructive" }); return; }
    setText("");
    toast({ title: "Note saved for your team", description: out.missed ? `${out.missed} of the team's copies weren't kept by the relay.` : undefined });
  };
  return (
    <section className="space-y-2" data-testid="ops-member-notes">
      <h3 className="text-[13px] font-medium text-muted-foreground">Team notes</h3>
      {notes.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No notes yet. Only your team can read them.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2" data-testid="ops-member-note">
              <p className="text-[14px] leading-snug whitespace-pre-wrap break-words">{n.text}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{profiles.get(n.author)?.name ?? "A teammate"} · {ago(n.at)}</p>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void save(); }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note for your team" className="h-10 flex-1" aria-label="Add a note for your team" data-testid="ops-member-note-input" />
        <Button type="submit" disabled={saving || !text.trim()} className="h-10 rounded-full px-4" data-testid="ops-member-note-save">Save</Button>
      </form>
    </section>
  );
}
