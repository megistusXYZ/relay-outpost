// KNOWN-GOOD twin of known-bad.tsx: the same panel with the bars met. Not
// compiled or shipped. A reviewer who fails any row here is inventing a defect.
import { useEffect, useState, useCallback } from "react";
import { queryAnswered } from "@/lib/relay-reach";
import { loadFollowBase, publishFollowList } from "@/lib/follow-list";
import { getTrustPhrase, type SignalTier } from "@/lib/trust-words";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { X, UserPlus } from "lucide-react";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

const HEX64 = /^[0-9a-f]{64}$/;
/** A member as the relay's list names them; the trust tier arrives separately and may still be unknown. */
type Member = { pubkey: string; name: string; tier?: SignalTier };

export function MembersPanel({ communityId, myPubkey, signer, onClose }: {
  communityId: string; myPubkey: string; signer: any; onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [state, setState] = useState<"loading" | "answered" | "unreachable">("loading");
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    queryAnswered(RELAYS, { kinds: [39002], "#d": [communityId] }).then(({ events, answered }) => {
      if (cancelled) return;
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      // Only well-formed pubkeys cross the boundary; names are trimmed and capped. The tier is left unknown until asked.
      const list = latest
        ? latest.tags.filter((t) => t[0] === "p" && HEX64.test(t[1] ?? "")).map((t) => ({ pubkey: t[1], name: (t[2] ?? "").trim().slice(0, 60) || t[1].slice(0, 8) }))
        : [];
      setMembers(list);
      setState(answered ? "answered" : "unreachable");
    });
    return () => { cancelled = true; };
  }, [communityId]);

  const follow = useCallback(async (pk: string) => {
    // The follow list is replaceable: only ever published from a loaded base, never from a guess.
    const base = await loadFollowBase(myPubkey);
    if (!base.known) { toast({ title: "Couldn't load your follows", description: "Try again in a moment." }); return; }
    if (base.pubkeys.includes(pk)) return;
    const ok = await publishFollowList(signer, [...base.pubkeys, pk]);
    toast({ title: ok ? "Following" : "Couldn't save the follow", description: ok ? undefined : "No relay accepted it. Try again." });
  }, [myPubkey, signer, toast]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Members</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
      </div>
      {state === "loading" ? (
        <p className="text-sm text-muted-foreground/60">Loading…</p>
      ) : state === "unreachable" ? (
        <p className="text-sm text-muted-foreground/60">Couldn't reach this community's relay. Try again in a moment.</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">No members yet. Invite a friend.</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.pubkey} className="flex items-center gap-2">
              <span className="text-sm">{m.name}</span>
              {m.tier && <span className={`text-xs ${m.tier === "strong" ? "text-success" : "text-muted-foreground/60"}`}>{getTrustPhrase(m.tier)}</span>}
              <Button size="sm" variant="ghost" onClick={() => follow(m.pubkey)} aria-label={`Follow ${m.name}`}><UserPlus className="w-3.5 h-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
