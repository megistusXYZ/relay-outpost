/**
 * Reports members sent this group's moderators (concord-reports), shown in
 * Manage. Each says what was reported, where, why and by whom. "Done" clears
 * it; removing the message or the person happens where it always does.
 */
import { useEffect, useState } from "react";
import { Flag, Check } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { listReports, dismissReport, REPORTS_CHANGED_EVENT, type GroupReport, type ReportReason } from "@/lib/concord/concord-reports";
import { useConcordProfile } from "./ConcordIdentity";
import { formatCompactTime } from "@/lib/time";

/** The reasons in plain words, as the report dialog offers them. */
export const REASON_LABEL: Record<ReportReason, string> = {
  spam: "Spam",
  profanity: "Harassment or hate",
  nudity: "Nudity or sexual content",
  illegal: "Something illegal",
  impersonation: "Pretending to be someone",
  other: "Something else",
};

/** This viewer's open reports for a group, kept current. */
export function useGroupReports(communityId: string): GroupReport[] {
  const { pubkey } = useNostrAuth();
  const [reports, setReports] = useState<GroupReport[]>(() => (pubkey ? listReports(pubkey, communityId) : []));
  useEffect(() => {
    const update = () => setReports(pubkey ? listReports(pubkey, communityId) : []);
    update();
    window.addEventListener(REPORTS_CHANGED_EVENT, update);
    return () => window.removeEventListener(REPORTS_CHANGED_EVENT, update);
  }, [pubkey, communityId]);
  return reports;
}

export function ConcordReports({ communityId, roomName }: {
  communityId: string;
  /** A room's name by id, for saying where it happened. */
  roomName: (channelId: string) => string | undefined;
}) {
  const { pubkey } = useNostrAuth();
  const reports = useGroupReports(communityId);
  if (reports.length === 0) {
    return <p className="text-xs text-muted-foreground/60">No reports. When a member reports a message, it shows up here. Only moderators see reports.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground/60">Remove a message from its menu in the room, or a person from People.</p>
      {reports.map((r) => (
        <ReportRow key={r.id} report={r} room={roomName(r.channelId)} onDone={() => { if (pubkey) dismissReport(pubkey, r.id); }} />
      ))}
    </div>
  );
}

function ReportRow({ report, room, onDone }: { report: GroupReport; room?: string; onDone: () => void }) {
  const author = useConcordProfile(report.author).name;
  const reporter = useConcordProfile(report.reporter).name;
  return (
    <div className="rounded-lg border border-border/30 p-2.5 space-y-1.5" data-testid={`report-${report.id.slice(0, 8)}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 min-w-0">
        <Flag className="w-3 h-3 text-amber-500 shrink-0" aria-hidden="true" />
        <span className="font-medium text-foreground/85 shrink-0">{REASON_LABEL[report.reason]}</span>
        {room && <span className="truncate">· #{room}</span>}
        <span className="ml-auto shrink-0 tabular-nums">{formatCompactTime(report.at)}</span>
      </div>
      {report.snippet && (
        <blockquote className="text-xs text-foreground/85 border-l-2 border-border/50 pl-2 break-words [overflow-wrap:anywhere] line-clamp-3" title="As the reporter saw it">
          <span className="font-medium">{author}:</span> {report.snippet}
        </blockquote>
      )}
      {report.note && <p className="text-xs text-muted-foreground/80 break-words [overflow-wrap:anywhere]">“{report.note}”</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground/60 truncate">Reported by {reporter}</span>
        <button
          onClick={onDone}
          className="shrink-0 flex items-center gap-1 h-9 md:h-7 px-2.5 rounded-full text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
          data-testid={`report-done-${report.id.slice(0, 8)}`}
        >
          <Check className="w-3 h-3" /> Done
        </button>
      </div>
    </div>
  );
}
