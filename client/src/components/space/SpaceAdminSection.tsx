import type { ReactNode } from "react";
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
 * Ten lines, and that is the point: with no second state to reach for, a later
 * contributor cannot quietly reintroduce a dead control by passing a flag. If a
 * section should not be there, it is not rendered.
 *
 * Built on OpsSubCard/OpsSectionHeader rather than fresh markup. That file
 * exists because every operator tab hand-rolled the same header until the
 * padding and accent drifted — which is precisely this drawer's job description,
 * so using anything else here would be self-defeating.
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
      <OpsSectionHeader icon={icon} label={title} action={action} />
      {children}
    </OpsSubCard>
  );
}
