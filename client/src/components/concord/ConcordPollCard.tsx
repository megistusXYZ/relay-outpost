/**
 * A poll in a group chat (Armada's, CORD.md "Polls"): the options to vote on,
 * then, once you've voted or it has closed, the results. The count comes from
 * tallyPollVotes, so it matches Armada's to the vote; the percentage is per
 * voter, as there, so a pick-any poll's can add up past 100%.
 */
import { useState } from "react";
import { BarChart3, Check, Loader2 } from "lucide-react";
import type { ParsedPoll, PollTally } from "@/lib/concord/concord-polls";

/** "in 3d", "in 5h", "in 12m" (Armada's formatEndsAt). */
function endsIn(endsAt: number): string {
  const diff = endsAt - Math.floor(Date.now() / 1000);
  if (diff < 3600) return `in ${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`;
  return `in ${Math.floor(diff / 86400)}d`;
}

export function ConcordPollCard({ poll, tally, canVote, onVote }: {
  poll: ParsedPoll;
  tally: PollTally;
  /** A member of a live group: a deleted group's polls only show results. */
  canVote: boolean;
  /** Cast the selection; false when no relay took it (the caller says so). */
  onVote: (optionIds: string[]) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [voting, setVoting] = useState(false);
  const closed = poll.endsAt !== undefined && poll.endsAt < Math.floor(Date.now() / 1000);
  const voted = !!tally.myVote && tally.myVote.size > 0;
  const showResults = voted || closed || !canVote;
  const single = poll.pollType === "singlechoice";
  const share = (id: string) => (tally.totalVoters > 0 ? Math.round(((tally.counts.get(id) ?? 0) / tally.totalVoters) * 100) : 0);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(single ? [] : prev);
    if (!single && prev.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const submit = async () => {
    if (selected.size === 0 || voting) return;
    setVoting(true);
    const ok = await onVote([...selected]);
    setVoting(false);
    if (ok) setSelected(new Set());
  };

  return (
    <div className="mt-1.5 w-full max-w-md space-y-2 rounded-xl border border-border bg-card p-3 dark:border-white/[0.08] dark:bg-white/[0.03]" data-testid="concord-poll">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5 text-brand" />
        <span>Poll{single ? "" : " · pick any"}</span>
        {poll.endsAt !== undefined && <span className="ml-auto tabular-nums">{closed ? "Ended" : `Ends ${endsIn(poll.endsAt)}`}</span>}
      </div>

      <div className="space-y-1.5">
        {poll.options.map((o) => {
          const mine = !!tally.myVote?.has(o.id);
          if (showResults) {
            const pct = share(o.id);
            return (
              <div key={o.id} className="relative overflow-hidden rounded-lg border border-border/70 dark:border-white/[0.08]" data-testid="concord-poll-result">
                <div className={`absolute inset-y-0 left-0 transition-[width] duration-500 motion-reduce:transition-none ${mine ? "bg-brand/20" : "bg-muted dark:bg-white/[0.06]"}`} style={{ width: `${pct}%` }} aria-hidden="true" />
                <div className="relative flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {mine && <Check className="h-3.5 w-3.5 shrink-0 text-brand" aria-label="Your vote" />}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct}%</span>
                </div>
              </div>
            );
          }
          const on = selected.has(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role={single ? "radio" : "checkbox"}
              aria-checked={on}
              onClick={() => toggle(o.id)}
              className={`flex w-full min-h-11 md:min-h-9 items-center gap-2.5 rounded-lg border px-3 text-left text-sm transition-colors ${on ? "border-brand bg-brand/10" : "border-border/70 hover:bg-accent dark:border-white/[0.08] dark:hover:bg-white/[0.04]"}`}
              data-testid="concord-poll-option"
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center border ${single ? "rounded-full" : "rounded"} ${on ? "border-brand bg-brand text-primary-foreground" : "border-muted-foreground/50"}`} aria-hidden="true">
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">{tally.totalVoters} {tally.totalVoters === 1 ? "vote" : "votes"}</span>
        {!showResults && (
          <button
            type="button"
            onClick={submit}
            disabled={selected.size === 0 || voting}
            className="inline-flex h-9 md:h-8 items-center rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            data-testid="concord-poll-vote"
          >
            {voting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Vote"}
          </button>
        )}
      </div>
    </div>
  );
}
