import type { ReactNode } from "react";

/**
 * The slim row above a page's content, for what its old title block carried
 * besides the title: status on the left ("6 of 6 connected", "3 saved items"),
 * actions on the right ("Check all", refresh, "New").
 *
 * Pages no longer open with a title (see lib/page-titles.test.ts). This row is
 * the one shape that replaced them, so controls sit at the same height, size
 * and spacing on every page, phone and desktop. Render it only when there is
 * something to put in it; an empty row would just be a gap.
 */
export function PageToolbar({
  status,
  children,
  className = "",
  testId = "page-toolbar",
  inStack = false,
}: {
  status?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
  /** Inside a space-y stack the stack spaces it; skip the row's own margin. */
  inStack?: boolean;
}) {
  return (
    <div className={`flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 ${inStack ? "" : "mb-4"} ${className}`} data-testid={testId}>
      {status != null && status !== false && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{status}</div>
      )}
      {children != null && children !== false && (
        <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
