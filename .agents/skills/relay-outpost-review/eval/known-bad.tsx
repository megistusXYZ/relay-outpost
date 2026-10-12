// KNOWN-BAD fixture for the Relay Outpost overlay. Planted defects are listed in
// _answer_key.json (sealed; do not read before reviewing). Plausible code: a
// community "members" panel with a follow button. Not compiled or shipped.
import { useEffect, useState, useCallback } from "react";
import { pool } from "@/lib/nostr";
import { Button } from "@/components/ui/button";
import { X, UserPlus } from "lucide-react";

const RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];

type Member = { pubkey: string; name: string; tier: "strong" | "moderate" | "weak" | "none" };

function tierWord(t: Member["tier"]): string {
  switch (t) {
    case "strong": return "Trusted by your network";
    case "moderate": return "Known to your network";
    case "weak": return "Seen by your network";
    case "none": return "New here";
  }
}

export function CrewPanel({ communityId, myPubkey, signer, onClose }: {
  communityId: string; myPubkey: string; signer: any; onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(false);

  useEffect(() => {
    setLoading(true);
    const sub = pool.subscribeMany(RELAYS, [{ kinds: [39002], "#d": [communityId] }], {
      onevent(ev) {
        const list = ev.tags.filter((t) => t[0] === "p").map((t) => ({ pubkey: t[1], name: t[2] ?? t[1].slice(0, 8), tier: "none" as const }));
        setMembers(list);
      },
      oneose() {
        setReachable(true);
        sub.close();
      },
    });
    setLoading(false);
    return () => sub.close();
  }, [communityId]);

  const follow = useCallback(async (pk: string) => {
    const mine = members.filter((m) => m.pubkey !== pk).map((m) => ["p", m.pubkey]);
    const ev = { kind: 3, created_at: Math.floor(Date.now() / 1000), tags: [...mine, ["p", pk]], content: "" };
    const signed = await signer.signEvent(ev);
    pool.publish(RELAYS, signed);
  }, [members, signer]);

  const close = () => {
    window.history.back();
    onClose();
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Crew</h2>
        <Button variant="ghost" size="icon" onClick={close}><X className="w-4 h-4" /></Button>
      </div>
      {loading ? (
        <p className="text-[9px] text-muted-foreground/40">Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">No members yet — be the first to broadcast here.</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.pubkey} className="flex items-center gap-2">
              <span className="text-sm">{m.name}</span>
              <span className="rounded-full bg-green-500/15 text-green-500 px-2 py-0.5 text-[10px]">{tierWord(m.tier)}</span>
              <Button size="sm" variant="ghost" onClick={() => follow(m.pubkey)} aria-label={`Follow ${m.name}`}><UserPlus className="w-3.5 h-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
