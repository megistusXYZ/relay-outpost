import { useCallback, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import { sweepNotice, EMPTY_SWEEP } from "@/lib/queue-sweep";
import { useNeedsYou } from "@/contexts/NeedsYouContext";
import { describeReportQueue } from "@/lib/reports-queue";
import { useQueuePerson } from "@/hooks/use-queue-person";
import { sendDeleteEvent } from "@/lib/nip29";
import type { PendingReport } from "@/lib/reports-queue";
import { Flag, ShieldAlert, Trash2, X } from "lucide-react";

/**
 * The queue says which room a report is about; the row has to SHOW it.
 *
 * Three different things arrive here — a message in this room, a member
 * reported for something on the open network, and a message the relay would not
 * return — and a moderator acting on the wrong one is the failure this label
 * exists to prevent. So the difference is stated in words, not implied by
 * position in a list.
 */
function ScopeNote({ scope }: { scope: PendingReport["scope"] }) {
  if (scope === "in-room") return null; // the default case needs no caveat
  const text =
    scope === "about-person"
      ? "Reported elsewhere — not a message in this space"
      : "Message could not be loaded from this relay";
  return (
    <span className="block text-[11px] text-muted-foreground/60" data-testid={`report-scope-${scope}`}>
      {text}
    </span>
  );
}

function ReportRow({
  item,
  onDone,
}: {
  item: PendingReport;
  onDone: (relayUrl: string, groupId: string, key: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"remove" | null>(null);
  // Shared with AdmissionQueue so the two rows in one Needs-you list cannot name
  // the same person two different ways — and, more to the point, so neither can
  // forget to ASK for the profile. Both used to read the store and stop, which
  // showed a bare npub for exactly the strangers these queues are about.
  const { name, avatarUrl, profileUrl } = useQueuePerson(item.targetPubkey);
  const key = item.targetEventId ?? item.targetPubkey;

  const remove = useCallback(async () => {
    if (!item.targetEventId) return;
    setBusy("remove");
    try {
      // The reason is carried through, not dropped: a moderation log that says
      // WHY beats one that only says a message vanished.
      const { ok, error } = await sendDeleteEvent(item.relayUrl, item.groupId, item.targetEventId, "reported");
      // CHECK IT. This awaited and discarded the result, so a delete the relay
      // never performed still reported "Message removed" and dismissed the row —
      // the moderator believed they had acted, and the message was still there.
      // sendDeleteEvent returns false without throwing, so the catch below never
      // covered this case.
      if (!ok) {
        toast({ title: "Could not remove that message", description: error, variant: "destructive" });
        setBusy(null);
        return;
      }
      toast({ title: "Message removed" });
      onDone(item.relayUrl, item.groupId, key);
    } catch {
      toast({ title: "Could not remove that message", variant: "destructive" });
      setBusy(null);
    }
  }, [item, key, onDone, toast]);

  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-border/60 dark:border-white/[0.07] bg-card p-3 shadow-sm shadow-black/[0.04] dark:shadow-none"
      data-testid="report-row"
    >
      <Link href={profileUrl} className="shrink-0">
        <Avatar className="w-8 h-8 border border-border/40">
          <AvatarImage src={avatarUrl} alt="" />
          <AvatarFallback className="bg-brand/10 text-brand text-[11px] font-semibold">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-sm font-medium text-foreground/90 truncate">{name}</span>
          {item.severity === "severe" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
              <ShieldAlert className="w-3 h-3" /> serious
            </span>
          )}
        </div>
        {/* The count IS the signal, and it is the one thing here that is
            expensive to fake — so it leads, in words rather than a bare badge. */}
        <span className="block text-xs text-muted-foreground">
          {item.reporters.length === 1
            ? "1 person reported this"
            : `${item.reporters.length} people reported this`}
          {item.groupName ? ` in ${item.groupName}` : ""}
          {" · "}
          {formatDistanceToNow(new Date(item.firstReportedAt * 1000), { addSuffix: true })}
        </span>
        <ScopeNote scope={item.scope} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDone(item.relayUrl, item.groupId, key)}
          disabled={!!busy}
          className="h-8 w-8 p-0 text-muted-foreground/60 hover:text-foreground"
          aria-label="Dismiss this report"
          data-testid="report-dismiss"
        >
          <X className="w-4 h-4" />
        </Button>
        {/* Remove is offered ONLY for a message proven to be in this room.
            NIP-29 delete addresses an event inside a group; firing it at
            something reported from the open network would be a no-op at best
            and a lie in the moderation log at worst. */}
        {item.scope === "in-room" && item.targetEventId && (
          <Button
            size="sm"
            variant="destructive"
            onClick={remove}
            disabled={!!busy}
            className="h-8 gap-1.5 rounded-full px-3"
            data-testid="report-remove"
          >
            {busy === "remove" ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Everything flagged in any space you run, in one place.
 *
 * Same story as the admission queue and the same fix: a report was only ever
 * visible from inside the room it happened in, so a moderator with three spaces
 * opened three to learn nothing needed doing. This is the aggregate.
 *
 * Self-hiding, for the same reason the admission queue is: "Needs you" over an
 * empty box is worse than no heading at all.
 */
export function ReportsQueue({ className = "" }: { className?: string }) {
  // From the shared provider, so the badge in the nav and the rows on this
  // page are the SAME sweep rather than two that can disagree.
  const needsYou = useNeedsYou();
  const { queue, sweep, removeLocally } = needsYou?.reports ?? EMPTY_QUEUE_STATE;
  const notice = sweepNotice(sweep);
  if (queue.length === 0 && !notice) return null;
  return (
    <div className={`space-y-2 ${className}`} data-testid="reports-queue">
      {/* A partial sweep understates a populated queue exactly as much as it
          understates an empty one, so this sits above the rows either way.
          Silent unless a relay was ASKED and did not answer — see
          lib/queue-sweep.ts for why a zero-relay sweep says nothing. */}
      {notice && (
        <p className="px-1 text-[11px] text-muted-foreground/50" data-testid="reports-sweep-notice">
          {notice}
        </p>
      )}
      {queue.length > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
          <Flag className="w-3 h-3" />
          {/* "message" vs "account" is a real distinction the rows already carry —
              one is a post to review, the other is a member to decide about. */}
          {describeReportQueue(queue)}
        </p>
      )}
      {queue.map((item) => (
        <ReportRow
          key={`${item.relayUrl}|${item.groupId}|${item.targetEventId ?? item.targetPubkey}`}
          item={item}
          onDone={removeLocally}
        />
      ))}
    </div>
  );
}

/** Outside the provider there is nothing to show — never a crash. */
const EMPTY_QUEUE_STATE = {
  queue: [] as never[],
  sweep: EMPTY_SWEEP,
  removeLocally: () => {},
};
