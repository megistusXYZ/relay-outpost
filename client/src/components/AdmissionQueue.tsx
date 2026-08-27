import { useCallback, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import type { Event } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PersonBadges } from "@/components/PersonBadges";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import { sweepNotice, EMPTY_SWEEP } from "@/lib/queue-sweep";
import { useNeedsYou } from "@/contexts/NeedsYouContext";
import { useQueuePerson } from "@/hooks/use-queue-person";
import { sendPutUser } from "@/lib/nip29";
import type { PendingAdmission } from "@/lib/admission-queue";
import { Check, Ticket, X } from "lucide-react";

/** The claimed name — display_name || name — never an npub fallback, which the
 *  collision check must never be handed (see PersonBadges). */
function claimedNameOf(profile: Event | null): string | undefined {
  if (!profile) return undefined;
  try {
    const c = JSON.parse(profile.content || "{}");
    return (c.display_name || c.name || "").trim() || undefined;
  } catch {
    return undefined;
  }
}

function nip05Of(profile: Event | null): string | undefined {
  if (!profile) return undefined;
  try {
    return JSON.parse(profile.content || "{}").nip05 || undefined;
  } catch {
    return undefined;
  }
}

function AdmissionRow({
  item,
  onDecided,
}: {
  item: PendingAdmission;
  onDecided: (relayUrl: string, groupId: string, pubkey: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "approve" | "deny">(null);
  // Shared with ReportsQueue, and it FETCHES on a miss. Reading the store alone
  // showed a bare npub for every stranger at the door — which is all of them,
  // since the store only holds people this app has already seen.
  const { profile, name, avatarUrl, profileUrl } = useQueuePerson(item.pubkey);

  const approve = useCallback(async () => {
    setBusy("approve");
    try {
      // DESTRUCTURE. sendPutUser returns {ok, error} now, and `if (!someObject)`
      // is always false — leaving this as a bare `ok` would toast "<name> is in"
      // and drop them from the queue for an approval the relay REFUSED. The
      // worst failure in this change, and invisible to tsc.
      const { ok, error } = await sendPutUser(item.relayUrl, item.groupId, item.pubkey);
      if (!ok) {
        toast({ title: "Couldn't let them in", description: error ?? "The relay didn't accept it.", variant: "destructive" });
        return;
      }
      toast({ title: `${name} is in` });
      onDecided(item.relayUrl, item.groupId, item.pubkey);
    } catch {
      toast({ title: "Couldn't let them in", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [item, name, onDecided, toast]);

  // Deny is LOCAL ONLY, and says so. NIP-29 has no "rejected" event: writing a
  // remove-user for someone who was never a member would be a lie in the
  // moderation log, and there is nothing to publish that means "no". So this
  // clears the row for this operator and nothing else — the request stays on
  // the relay, and a co-admin can still act on it.
  const deny = useCallback(() => {
    setBusy("deny");
    onDecided(item.relayUrl, item.groupId, item.pubkey);
    toast({ title: "Dismissed", description: "They weren't notified. Another admin can still let them in." });
  }, [item, onDecided, toast]);

  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/50 px-3 py-2.5"
      data-testid={`admission-${item.groupId}-${item.pubkey.slice(0, 8)}`}
    >
      <Link href={profileUrl}>
        <Avatar className="w-9 h-9 shrink-0 border border-border/40">
          <AvatarImage src={avatarUrl} alt="" />
          <AvatarFallback className="bg-brand/10 text-brand text-[10px] font-semibold">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link href={profileUrl} className="truncate text-sm font-medium text-foreground hover:underline">
            {name}
          </Link>
          {/* Positive-only, exactly as on profiles and member lists: a check
              where a domain vouches for the key, ⚠ only on a real name
              collision, and NOTHING otherwise. An operator deciding about a
              stranger is the last place to paint an accusation on absence. */}
          <PersonBadges
            pubkey={item.pubkey}
            nip05={nip05Of(profile)}
            claimedName={claimedNameOf(profile)}
            showCollision={!!profile}
          />
        </div>
        <p className="truncate text-xs text-muted-foreground/80">
          wants into <span className="text-foreground/70">{item.groupName || item.groupId}</span>
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/60">
          <span>{formatDistanceToNow(item.createdAt * 1000, { addSuffix: true })}</span>
          {/* The strongest cheap evidence there is: a code means a member handed
              them a link. Somebody vouched by ACTION, not by assertion — which
              is the only kind of vouching this app treats as proof. */}
          {item.code && (
            <span className="inline-flex items-center gap-1 text-brand/80">
              <Ticket className="w-3 h-3" /> has an invite
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={deny}
          disabled={!!busy}
          className="h-8 w-8 p-0 text-muted-foreground/60 hover:text-foreground"
          aria-label={`Dismiss ${name}`}
          data-testid={`admission-deny-${item.pubkey.slice(0, 8)}`}
        >
          <X className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          onClick={approve}
          disabled={!!busy}
          className="h-8 gap-1.5 rounded-full px-3"
          data-testid={`admission-approve-${item.pubkey.slice(0, 8)}`}
        >
          {busy === "approve" ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          Let in
        </Button>
      </div>
    </div>
  );
}

/**
 * Everyone waiting at the door of any space you run, in one place.
 *
 * The pieces existed — a request row, a fetch, the kind-9000 approve — but only
 * INSIDE a single group's admin panel, so an operator with three spaces opened
 * three spaces to learn nobody was waiting. This is the aggregate.
 *
 * Self-hiding: renders nothing at all when the queue is empty, because
 * "Needs you" over an empty box is worse than no heading.
 */
export function AdmissionQueue({ className = "" }: { className?: string }) {
  // From the shared provider, so the badge in the nav and the rows on this
  // page are the SAME sweep rather than two that can disagree.
  const needsYou = useNeedsYou();
  const { queue, sweep, removeLocally } = needsYou?.admissions ?? EMPTY_QUEUE_STATE;
  // Subject named — see ReportsQueue: an orphan "may be incomplete" line on
  // the Activity page reads as broken notifications.
  const notice = sweepNotice(sweep, "join requests");
  // Self-hiding still, but only when the silence is TRUE: nothing waiting AND
  // nothing we failed to ask. An empty queue on a sweep that never reached a
  // relay is not "nobody is waiting", and it used to render as exactly that.
  if (queue.length === 0 && !notice) return null;
  return (
    <div className={`space-y-2 ${className}`} data-testid="admission-queue">
      {/* A partial sweep understates a populated queue exactly as much as it
          understates an empty one, so this sits above the rows either way.
          Silent unless a relay was ASKED and did not answer — see
          lib/queue-sweep.ts for why a zero-relay sweep says nothing. */}
      {notice && (
        <p className="px-1 text-[11px] text-muted-foreground/50" data-testid="admission-sweep-notice">
          {notice}
        </p>
      )}
      {/* Only over actual rows — "0 accounts are waiting" next to a notice
          saying we could not reach the relay is the confident empty this whole
          change exists to remove. */}
      {queue.length > 0 && (
        <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
          {/* "account", not "person". It is what we actually know: a key that has
              asked to come in. The row below may carry a warning saying this might
              not be who they claim — a heading that has already called them a
              person contradicts the caution underneath it. */}
          {queue.length === 1 ? "1 account is waiting" : `${queue.length} accounts are waiting`}
        </p>
      )}
      {queue.map((item) => (
        <AdmissionRow
          key={`${item.relayUrl}|${item.groupId}|${item.pubkey}`}
          item={item}
          onDecided={removeLocally}
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
