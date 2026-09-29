import { Skeleton } from "@/components/ui/skeleton";

// Name and teaser widths vary row to row so the list reads as conversations,
// not a grid. Percent of the text column.
const NAME_W = [42, 58, 36, 50, 64, 40, 54];
const TEASER_W = [72, 84, 66, 90, 76, 80, 62];

/**
 * Chats on a cold load, before the first conversations arrive: rows the
 * shape of ChatListRow (40px avatar, name line, teaser line), so the list
 * fills in place instead of replacing a spinner.
 */
export function ChatListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading conversations" data-testid="chat-list-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-testid="chat-skeleton-row"
          className="flex items-center gap-3 px-3 py-3 border-b border-border/10"
        >
          <Skeleton className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${NAME_W[i % NAME_W.length]}%` }} />
            <Skeleton className="h-3" style={{ width: `${TEASER_W[i % TEASER_W.length]}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
