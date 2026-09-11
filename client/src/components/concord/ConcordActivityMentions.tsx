/**
 * "From your group chats" in Activity: mentions and replies to you in group
 * chats that you haven't read yet, each opening the room it's in. Reading the
 * room clears it (the mention ledger prunes on the read mark). Self-hides when
 * nothing is waiting.
 */
import { Link } from "wouter";
import { Lock } from "lucide-react";
import { formatCompactTime } from "@/lib/time";
import { useConcordProfile } from "./ConcordIdentity";
import { useGroupMentions } from "./useGroupMentions";
import type { GroupMentionRow } from "@/lib/concord/concord-activity-mentions";

export function ConcordActivityMentions({ className }: { className?: string }) {
  const rows = useGroupMentions();
  if (rows.length === 0) return null;
  return (
    <section className={className} data-testid="activity-group-mentions">
      <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <Lock className="w-3 h-3" aria-hidden="true" /> From your group chats
      </p>
      <div className="glass-card rounded-lg border divide-y divide-border/20 overflow-hidden">
        {rows.map((row) => <MentionRow key={row.key} row={row} />)}
      </div>
    </section>
  );
}

function MentionRow({ row }: { row: GroupMentionRow }) {
  const { name } = useConcordProfile(row.author ?? "");
  const who = row.author ? name : "Someone";
  return (
    <Link
      href={row.href}
      className="flex items-start gap-3 px-3 py-2.5 min-h-11 hover:bg-muted/20 transition-colors"
      data-testid={`group-mention-${row.key.slice(-12)}`}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 ring-1 ring-primary/20" aria-hidden="true">
        <Lock className="w-3.5 h-3.5 text-brand" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground/90 truncate">
          <span className="font-medium">{who}</span> {row.verb} in <span className="font-medium">{row.groupName}</span>
          {row.roomName && <span className="text-muted-foreground/60"> · #{row.roomName}</span>}
        </span>
        {row.snippet && <span className="block text-xs text-muted-foreground/70 truncate">{row.snippet}</span>}
      </span>
      <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums mt-0.5">{formatCompactTime(Math.floor(row.t / 1000))}</span>
    </Link>
  );
}
