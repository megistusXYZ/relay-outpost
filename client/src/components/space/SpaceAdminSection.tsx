import type { ComponentType, ReactNode } from "react";
import { OpsSubCard, OpsSectionHeader } from "@/pages/relay-ops/ops-ui";

/**
 * One section of the admin drawer — or nothing at all.
 *
 * There is deliberately NO `disabled` prop. A greyed-out control still teaches
 * that the action exists and that you are being refused, which is the wrong
 * lesson when the truth is either "you don't hold this" or "this doesn't exist
 * on this backend". The drawer's header says once what you hold; the sections
 * say nothing whatever about what you don't.
 *
 * Built on OpsSubCard/OpsSectionHeader rather than fresh markup. That file
 * exists because every operator tab hand-rolled the same header until the
 * padding and accent drifted — which is precisely this drawer's job description,
 * so using anything else here would be self-defeating. The drawer passes the
 * header's own overrides for a calmer title (sentence case, the page's type):
 * every section in the ops look — loud uppercase in the accent colour — made
 * eight cards read as one undifferentiated wall.
 */
export function SpaceAdminSection({
  can,
  title,
  icon,
  action,
  children,
}: {
  /** From visibleSections() — capability AND backend already resolved. */
  can: boolean;
  title: string;
  icon?: Parameters<typeof OpsSectionHeader>[0]["icon"];
  /** Optional right-aligned control in the header (a count, a small button). */
  action?: ReactNode;
  children: ReactNode;
}) {
  if (!can) return null;
  return (
    <OpsSubCard>
      <OpsSectionHeader
        icon={icon}
        label={title}
        action={action}
        labelClassName="font-sans normal-case tracking-normal text-sm font-semibold text-foreground dark:text-foreground"
      />
      {children}
    </OpsSubCard>
  );
}

/**
 * A section's action, as a button you can find and tap. They were 11px text
 * links ("New room", "Change who can invite", "Delete this group chat"): easy
 * to miss on a desktop, too small to hit on a phone. `primary` for the thing
 * the section is for, `destructive` for the irreversible one.
 */
export function SpaceAdminAction({
  onClick,
  icon: Icon,
  tone = "default",
  disabled,
  testId,
  children,
}: {
  onClick?: () => void;
  icon?: ComponentType<{ className?: string }>;
  tone?: "primary" | "default" | "destructive";
  disabled?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const tones = {
    primary: "border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
    default: "border-border/50 bg-background/60 text-foreground/85 hover:bg-muted/40",
    destructive: "border-destructive/30 text-destructive hover:bg-destructive/10",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 md:min-h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${tones[tone]}`}
      data-testid={testId}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </button>
  );
}
