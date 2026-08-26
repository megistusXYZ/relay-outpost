import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * Shared visual scaffold for the relay operator console.
 *
 * Every operator tab used to hand-roll the same "icon + uppercase brand label"
 * header and its own card wrapper (padding drifted between p-3 / p-3 sm:p-4 /
 * p-4 / p-6; the accent flip-flopped between two different violets).
 * These primitives are the single source of truth so every tab reads as one
 * system: one glass surface, one border, one padding scale, one accent.
 */

/** Canonical accent for section headers (violet in light, purple-300 in dark). */
export const OPS_LABEL_ACCENT =
  "text-primary dark:text-brand/80";
export const OPS_ICON_ACCENT =
  "text-primary dark:text-brand/80";

/**
 * Operator card. Frosted `.glass-card` surface (reacts to Performance Full/Lite),
 * one border style, consistent `p-3 sm:p-4`. Pass `className` to tweak layout
 * (e.g. `flex flex-col`, `overflow-visible`) — padding/border/surface stay put
 * unless you deliberately override them.
 */
export const OpsCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <Card
    ref={ref}
    className={cn(
      "glass-card border-border dark:border-brand/15 p-3 sm:p-4",
      className,
    )}
    {...props}
  >
    {children}
  </Card>
));
OpsCard.displayName = "OpsCard";

/**
 * Nested panel inside an OpsCard. Lighter border + `glass-card` so it stays
 * perf-mode reactive instead of a hardcoded `bg-accent` / `bg-card/50` surface.
 */
export const OpsSubCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "glass-card rounded-lg border border-border dark:border-brand/10 p-3",
      className,
    )}
    {...props}
  >
    {children}
  </div>
));
OpsSubCard.displayName = "OpsSubCard";

type OpsIcon = LucideIcon | React.ReactNode;

/**
 * The one operator section header. Renders `icon + uppercase brand label` in a
 * single consistent accent, with an optional right-aligned `action` slot and an
 * inline `children` slot (badges, spinners, counts) that sits next to the label.
 *
 * `icon` accepts a Lucide component (rendered at the standard size/accent) or a
 * pre-styled element (used by Access Control's semantic allow/block/read cards,
 * where the icon colour is intentionally green/red/blue). Use `labelClassName` /
 * `iconClassName` for those deliberate semantic overrides only.
 */
export function OpsSectionHeader({
  icon,
  label,
  action,
  children,
  className,
  labelClassName,
  iconClassName,
}: {
  icon?: OpsIcon;
  label: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  labelClassName?: string;
  iconClassName?: string;
}) {
  let iconNode: React.ReactNode = null;
  if (icon) {
    if (React.isValidElement(icon)) {
      // Already a rendered element (e.g. Access Control's semantic
      // allow/block/read icons) — render as-is.
      iconNode = icon;
    } else {
      // A component TYPE — a plain function OR a forwardRef/memo object. ALL
      // lucide-react icons are forwardRef objects (`typeof` is "object", not
      // "function"), so the old `typeof === "function"` check fell through to
      // rendering the icon value directly as a child → React #31 ("object with
      // keys {$$typeof, render, displayName}"), crashing every ops tab that
      // passed a bare lucide icon. Instantiate the component instead.
      const Icon = icon as React.ElementType;
      iconNode = (
        <Icon
          className={cn("w-3.5 h-3.5 shrink-0", OPS_ICON_ACCENT, iconClassName)}
        />
      );
    }
  }
  return (
    <div className={cn("flex items-center justify-between gap-2 mb-3", className)}>
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
        {iconNode}
        <span
          className={cn(
            "text-[11px] sm:text-xs font-brand tracking-wider uppercase",
            OPS_LABEL_ACCENT,
            labelClassName,
          )}
        >
          {label}
        </span>
        {children}
      </div>
      {action != null && (
        <div className="flex items-center gap-1.5 shrink-0">{action}</div>
      )}
    </div>
  );
}
