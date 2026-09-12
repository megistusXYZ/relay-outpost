/**
 * A section of a group chat's side panel (Rooms, Members, About) that you can
 * open and close. Its open state is the layout's (lib/chat-layout), so a
 * section you close stays closed next visit, here and in the phone's Group sheet.
 *
 * `fill` sections take the panel's leftover height and scroll inside it, so
 * a long member list never pushes the next section's header out of reach.
 */
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function ChatPaneSection({ title, open, onToggle, count, action, fill, children, testId }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  count?: number;
  /** A control beside the title (Rooms' "New room"), outside the toggle button. */
  action?: ReactNode;
  fill?: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col ${open && fill ? "flex-1" : "shrink-0"}`}
      data-testid={testId}
      data-open={open ? "true" : "false"}
    >
      <div className="flex shrink-0 items-center gap-1 pr-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-h-[44px] md:min-h-[32px] min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
          data-testid={`${testId}-toggle`}
        >
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider">{title}</span>
          {typeof count === "number" && <span className="text-[11px] tabular-nums text-muted-foreground/40">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className={fill ? "min-h-0 flex-1 overflow-y-auto overscroll-contain" : ""}>{children}</div>}
    </section>
  );
}
