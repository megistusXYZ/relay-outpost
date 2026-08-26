import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * PageTabs — the ONE shared segmented tab switcher for top-of-page content
 * switchers, styled exactly like the Home feed's mode switcher (the design
 * reference). It reuses the same CSS (`glass-feed-tabs`, `feed-tab-active`,
 * `feed-tab-glow` in index.css) rather than duplicating styles.
 *
 * Layout modes:
 * - equalWidth (default): segments are flex-1 and truncate — the row is always
 *   exactly one line. Automatically turns OFF when there are more than 4 tabs.
 * - scrollable (equalWidth={false} or >4 tabs): segments keep their content
 *   width and the glass container scrolls horizontally (no visible scrollbar),
 *   so the page never overflows.
 *
 * onChange fires on EVERY tap, including the already-active segment — several
 * surfaces use "tap the active tab again" to open an options sheet.
 */
export interface PageTabDef {
  key: string;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Small muted count pill after the label (auto-styled for active/inactive). */
  count?: number;
  /** Free-form trailing slot (unread pills, live dots, chevrons…). */
  badge?: React.ReactNode;
  disabled?: boolean;
  /** Render at half opacity but keep clickable (e.g. requires sign-in). */
  dimmed?: boolean;
  title?: string;
  ariaLabel?: string;
  /** data-testid for the segment; defaults to `tab-${key}`. */
  testId?: string;
}

export interface PageTabsProps {
  tabs: PageTabDef[];
  active: string;
  onChange: (key: string) => void;
  /** flex-1 equal segments (default). Forced off when tabs.length > 4. */
  equalWidth?: boolean;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  /**
   * Attached to whichever tab is currently active. Desktop feed-option popovers
   * anchor to this so they drop from the active pill (see DesktopOptionsPopover).
   */
  activeTabRef?: React.Ref<HTMLButtonElement>;
}

export function PageTabs({
  tabs,
  active,
  onChange,
  equalWidth = true,
  className,
  testId,
  ariaLabel,
  activeTabRef,
}: PageTabsProps) {
  const fill = equalWidth && tabs.length <= 4;
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "glass-feed-tabs flex items-center gap-0.5 sm:gap-1 p-1 rounded-lg overflow-x-auto no-scrollbar min-h-10",
        className,
      )}
      data-testid={testId}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Button
            key={tab.key}
            ref={isActive ? activeTabRef : undefined}
            type="button"
            role="tab"
            aria-selected={isActive}
            variant="ghost"
            size="sm"
            disabled={tab.disabled}
            title={tab.title}
            aria-label={tab.ariaLabel}
            className={cn(
              fill ? "flex-1 min-w-0" : "shrink-0",
              "gap-1 text-xs sm:text-sm px-2 sm:px-3",
              isActive
                ? "feed-tab-active feed-tab-glow text-white no-default-hover-elevate"
                : tab.dimmed
                  ? "opacity-50"
                  : "text-foreground/70 dark:text-inherit",
            )}
            onClick={() => onChange(tab.key)}
            data-testid={tab.testId ?? `tab-${tab.key}`}
          >
            {/* Icon drops below sm. In an equal-width row of four, the icon and
                the count leave a ~78px segment at 375px, which truncates
                "Following" and "Followers" to the SAME string — "Foll…" — so two
                tabs became indistinguishable. The label always carries the
                meaning here; the glyph is reinforcement, and reinforcement is
                what you spend first when space runs out. */}
            {tab.icon && <tab.icon className="w-3.5 h-3.5 shrink-0 hidden sm:block" />}
            <span className="truncate">{tab.label}</span>
            {typeof tab.count === "number" && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums",
                  isActive ? "bg-white/15 text-white/90" : "bg-muted/60 text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            )}
            {tab.badge}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * TabCountLine — muted micro-copy count at the top of a tab's content. Replaces
 * the counts that used to sit in the tab labels (they overflowed the tab row at
 * 375px and pushed the last tab off-screen). Renders nothing while the count is
 * unknown/zero, matching the old label badges.
 */
export function TabCountLine({ count, singular, plural }: { count?: number; singular: string; plural: string }) {
  if (!count || count <= 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground/50 tabular-nums mb-2 px-1" data-testid="tab-count-line">
      {count.toLocaleString()} {count === 1 ? singular : plural}
    </p>
  );
}
