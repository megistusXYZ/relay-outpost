import { useEffect, useRef, useState } from "react";
import { nip19 } from "nostr-tools";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Segment } from "@/components/Segment";
import { Check, X } from "lucide-react";
import { getCachedProfile, searchCachedProfiles } from "@/lib/nostr";
import { getProfileContent } from "@/lib/nostr-helpers";
import { searchUsers } from "@/lib/primal-cache";
import { TIMER_OPTIONS } from "@/lib/dm-prefs";

/**
 * The three things a private chat's menu opens (the Messages page owns what
 * they do; lib/dm-room.ts and lib/dm-prefs.ts own the rules):
 *
 *  - name the chat — a message everyone in it receives (NIP-17 `subject`);
 *  - a timer for MY messages there (NIP-40 `expiration`);
 *  - add people — which, in NIP-17, is by definition a NEW chat.
 */

/** The most people a chat can be started with: each message is one sealed copy per person. */
export const MAX_CHAT_PEOPLE = 12;

export function NameChatDialog({
  open, onOpenChange, current, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: string;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(current);
  useEffect(() => { if (open) setName(current); }, [open, current]);
  const clean = name.trim().replace(/\s+/g, " ");
  const canSave = clean.length > 0 && clean !== current.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-name-chat">
        <DialogHeader>
          <DialogTitle>Name this chat</DialogTitle>
          <DialogDescription>Everyone in the chat sees the name, and that you set it.</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 80))}
          onKeyDown={(e) => { if (e.key === "Enter" && canSave) { onSave(clean); onOpenChange(false); } }}
          placeholder="Lisbon trip"
          aria-label="Chat name"
          autoFocus
          className="h-11"
          data-testid="input-chat-name"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSave} onClick={() => { onSave(clean); onOpenChange(false); }} data-testid="button-save-chat-name">Save name</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TimerDialog({
  open, onOpenChange, seconds, onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  seconds: number;
  onPick: (seconds: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-chat-timer">
        <DialogHeader>
          <DialogTitle>Disappearing messages</DialogTitle>
          <DialogDescription>
            Messages you send in this chat are removed after the time you pick. Messages already sent are not changed.
          </DialogDescription>
        </DialogHeader>
        <Segment
          label="Remove my messages after"
          cols={2}
          options={TIMER_OPTIONS.map((o) => ({ value: String(o.seconds), label: o.label }))}
          value={String(seconds)}
          onChange={(v) => { onPick(Number(v)); onOpenChange(false); }}
          testPrefix="chat-timer"
        />
        {/* What it can't promise, said plainly. */}
        <p className="text-xs text-muted-foreground">
          This app and others that support it stop showing the message when its time is up. An app that doesn't, or someone who copied it first, can still keep it.
        </p>
      </DialogContent>
    </Dialog>
  );
}

interface Person { pubkey: string; name: string; picture?: string; nip05?: string }

function personFrom(pubkey: string, ev: unknown): Person | null {
  const p = ev ? getProfileContent(ev as never) : null;
  if (!p) return null;
  return { pubkey, name: p.display_name || p.name || "", picture: p.picture, nip05: p.nip05 };
}

export function AddPeopleDialog({
  open, onOpenChange, already, me, follows, onStart,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The people already in the chat (they come along). */
  already: { pubkey: string; name: string }[];
  me: string;
  follows: string[];
  /** The people chosen to add. */
  onStart: (added: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Person[]>([]);
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { if (open) { setQuery(""); setPicked([]); setResults([]); } }, [open]);

  const taken = new Set([me, ...already.map((p) => p.pubkey), ...picked.map((p) => p.pubkey)]);
  const room = MAX_CHAT_PEOPLE - already.length - picked.length;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }

    // A pasted key is the person, no search needed.
    let pasted: string | null = null;
    if (/^[0-9a-f]{64}$/i.test(q)) pasted = q.toLowerCase();
    else if (q.startsWith("npub1") || q.startsWith("nprofile1")) {
      try { const d = nip19.decode(q); pasted = d.type === "npub" ? d.data : d.type === "nprofile" ? d.data.pubkey : null; } catch { pasted = null; }
    }
    if (pasted) {
      const known = personFrom(pasted, getCachedProfile(pasted));
      setResults([known ?? { pubkey: pasted, name: "" }]);
      setSearching(false);
      return;
    }

    const lower = q.toLowerCase();
    const seen = new Set<string>();
    const local: Person[] = [];
    // The people you follow first, then anyone this device has seen.
    for (const pk of follows) {
      if (local.length >= 8) break;
      const person = personFrom(pk, getCachedProfile(pk));
      if (!person || seen.has(pk)) continue;
      if ([person.name, person.nip05].filter(Boolean).some((f) => f!.toLowerCase().includes(lower))) { seen.add(pk); local.push(person); }
    }
    for (const ev of searchCachedProfiles(lower, 8)) {
      if (local.length >= 8) break;
      const person = personFrom(ev.pubkey, ev);
      if (!person || seen.has(ev.pubkey)) continue;
      seen.add(ev.pubkey);
      local.push(person);
    }
    setResults(local);
    if (local.length >= 4 || q.length < 2) { setSearching(false); return; }

    setSearching(true);
    let cancelled = false;
    timer.current = setTimeout(async () => {
      try {
        const remote = await searchUsers(q, 8);
        if (cancelled) return;
        const combined = [...local];
        for (const ev of remote) {
          if (combined.length >= 8) break;
          if (seen.has(ev.pubkey)) continue;
          const person = personFrom(ev.pubkey, ev);
          if (!person) continue;
          seen.add(ev.pubkey);
          combined.push(person);
        }
        setResults(combined);
      } catch { /* the local results stand */ }
      if (!cancelled) setSearching(false);
    }, 300);
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [query, follows]);

  const shortKey = (pk: string) => { try { const n = nip19.npubEncode(pk); return `${n.slice(0, 10)}…${n.slice(-4)}`; } catch { return pk.slice(0, 10); } };
  const add = (p: Person) => { if (room > 0 && !taken.has(p.pubkey)) { setPicked([...picked, p]); setQuery(""); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-people">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>
            This starts a new chat with everyone in it. The chat you're in stays as it is, and earlier messages are not shared with the people you add.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5" data-testid="add-people-chosen">
          {already.map((p) => (
            <span key={p.pubkey} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{p.name}</span>
          ))}
          {picked.map((p) => (
            <span key={p.pubkey} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 pl-2.5 pr-1 py-0.5 text-xs text-foreground" data-testid={`add-people-picked-${p.pubkey.slice(0, 8)}`}>
              {p.name || shortKey(p.pubkey)}
              <button type="button" onClick={() => setPicked(picked.filter((x) => x.pubkey !== p.pubkey))} className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-brand/20" aria-label={`Remove ${p.name || "this person"}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, or paste an npub"
          aria-label="Search people"
          className="h-11"
          disabled={room <= 0}
          data-testid="input-add-people"
        />
        {room <= 0 && <p className="text-xs text-muted-foreground">A chat can have up to {MAX_CHAT_PEOPLE} other people.</p>}

        <div className="max-h-56 overflow-y-auto -mx-1" data-testid="add-people-results">
          {results.filter((r) => r.pubkey !== me).map((r) => {
            const isIn = taken.has(r.pubkey);
            return (
              <button
                key={r.pubkey}
                type="button"
                onClick={() => add(r)}
                disabled={isIn}
                className="flex w-full items-center gap-3 px-2 min-h-[48px] rounded-lg text-left hover:bg-muted/60 disabled:opacity-50"
                data-testid={`add-people-result-${r.pubkey.slice(0, 8)}`}
              >
                <Avatar className="w-8 h-8 border border-border shrink-0">
                  <AvatarImage src={r.picture} alt="" />
                  <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">{(r.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{r.name || shortKey(r.pubkey)}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{r.nip05 || shortKey(r.pubkey)}</span>
                </span>
                {isIn && <Check className="w-4 h-4 text-brand shrink-0" aria-label="Already in the chat" />}
              </button>
            );
          })}
          {searching && <p className="px-2 py-2 text-xs text-muted-foreground">Searching…</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">Nobody found by that name. You can paste their npub.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={picked.length === 0} onClick={() => { onStart(picked.map((p) => p.pubkey)); onOpenChange(false); }} data-testid="button-start-chat-with-added">
            Start chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
