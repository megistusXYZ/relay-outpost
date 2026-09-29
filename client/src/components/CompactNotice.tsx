import type { ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";

/**
 * The app's one notice style: a slim row that sits in the page instead of on
 * top of it. Icon, a short title and one line of body, inline text actions,
 * and a dismiss. On a wide screen it's a single line; on a phone the text
 * wraps and the actions follow. Tap targets stay 44 px without making the
 * row taller (negative margins around padded hit areas).
 *
 * `tone` only tints the icon: "info" in the brand colour, "warning" in amber,
 * so a state that needs attention reads at a glance without a louder surface.
 */
export function CompactNotice({
  icon: Icon,
  tone = "info",
  title,
  body,
  actions,
  more,
  onDismiss,
  className = "",
  testId,
}: {
  icon: LucideIcon;
  tone?: "info" | "warning";
  /** Optional: a notice whose body says it all can go without. */
  title?: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  /** Extra detail shown under the row (e.g. an opened "Why?"). */
  more?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-lg border border-brand/15 bg-brand/[0.05] px-3 py-2 ${className}`}
      data-testid={testId}
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "warning" ? "text-amber-500" : "text-brand"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="min-w-0">
            {title && <span className="font-medium text-foreground/90">{title}</span>}
            {title && body && <span className="text-muted-foreground"> · </span>}
            {body && <span className="text-muted-foreground">{body}</span>}
          </p>
          {actions && <div className="flex items-center gap-x-4">{actions}</div>}
        </div>
        {more && <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{more}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-2.5 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={testId ? `${testId}-dismiss` : undefined}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** A text action for CompactNotice: brand coloured, 44 px tall to the thumb. */
export function NoticeAction({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="-my-3 inline-flex min-h-11 items-center whitespace-nowrap text-[13px] font-medium text-brand hover:text-brand/80 disabled:opacity-60"
      data-testid={testId}
    >
      {children}
    </button>
  );
}
