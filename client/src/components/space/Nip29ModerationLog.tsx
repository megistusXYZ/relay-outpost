/**
 * What has been done in a relay-hosted group, and by whom.
 *
 * The DATA has existed since the NIP-29 client was written — fetchModerationLog
 * reads kinds 9000/9001/9002/9005/9007/9008/9009 filtered by `h`. What did not
 * exist was anywhere to see it outside the Relay Ops console, a separate page on
 * a different mental model (relay operator, not group admin). The only renderer
 * was un-exported JSX inside that console — this is now the second, and the
 * only one a group admin can reach without operator standing.
 *
 * Fetches on MOUNT, which means on drawer open — not on room open. A moderation
 * log is read rarely and deliberately; paying a relay round-trip every time
 * anyone enters a chat would be a poor trade for a list most members never see.
 */
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, ShieldAlert } from "lucide-react";
import type { Event as NostrEvent } from "nostr-tools";
import { fetchModerationLogResult, getModerationActionPhrase } from "@/lib/nip29";
import { useQueuePerson } from "@/hooks/use-queue-person";

/** One line: who did what to whom, and when. */
function LogRow({ event }: { event: NostrEvent }) {
  const actor = useQueuePerson(event.pubkey);
  const targetPk = event.tags.find((t) => t[0] === "p")?.[1];
  const target = useQueuePerson(targetPk ?? "");
  return (
    <div className="flex items-start gap-2 text-[11px] text-muted-foreground/70 px-0.5">
      <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground/40" />
      <div className="min-w-0 flex-1">
        <p className="leading-snug">
          <span className="font-medium text-foreground/70">{actor.name}</span>{" "}
          <span>{getModerationActionPhrase(event.kind)}</span>
          {targetPk ? <> <span className="font-medium text-foreground/70">{target.name}</span></> : null}
        </p>
        {event.content && <p className="text-muted-foreground/45 italic truncate">“{event.content}”</p>}
      </div>
      <span className="shrink-0 text-muted-foreground/40">
        {formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })}
      </span>
    </div>
  );
}

export function Nip29ModerationLog({ relayUrl, groupId }: { relayUrl: string; groupId: string }) {
  const [events, setEvents] = useState<NostrEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setEvents(null);
    setFailed(false);
    // An empty log and an unreachable relay are NOT the same answer, and this
    // whole drawer exists because that distinction kept getting lost.
    //
    // It got lost here too: this used to read the bare fetcher and set `failed`
    // from a `.catch`, but that promise resolves [] on an unreachable relay and
    // never rejects — so the honest branch below was unreachable code, and an
    // audit log we could not read rendered as an audit log with nothing in it.
    fetchModerationLogResult(relayUrl, groupId)
      .then(({ data, reached }) => {
        if (!alive) return;
        setFailed(!reached);
        setEvents(data);
      })
      .catch(() => { if (alive) { setFailed(true); setEvents([]); } });
    return () => { alive = false; };
  }, [relayUrl, groupId]);

  if (events === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground/60">
        <Loader2 className="w-3 h-3 animate-spin" /> Reading the log…
      </p>
    );
  }
  if (failed) {
    return <p className="text-xs text-muted-foreground/60">Couldn't reach the relay for this. Try again in a moment.</p>;
  }
  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground/60">Nothing has been moderated here yet.</p>;
  }
  return (
    <div className="space-y-1.5" data-testid="nip29-moderation-log">
      {events.map((e) => <LogRow key={e.id} event={e} />)}
    </div>
  );
}
