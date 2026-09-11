/**
 * A count on a group chat's Manage button: reports, and people waiting to
 * join. Both wait on a moderator, so neither should wait unseen behind a
 * button nobody has a reason to open.
 */
import { useGroupReports } from "./ConcordReports";
import { useJoinRequests } from "./ConcordJoinRequests";

export function ManageCountBadge({ communityId }: { communityId: string }) {
  const n = useGroupReports(communityId).length + useJoinRequests(communityId).length;
  if (!n) return null;
  return (
    <span
      className="min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-[9px] font-semibold leading-4 text-black text-center tabular-nums"
      aria-label={`${n} waiting for you`}
      data-testid="manage-count"
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}
