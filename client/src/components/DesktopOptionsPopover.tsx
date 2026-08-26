import type { ReactNode, RefObject } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Desktop home for the feed-option panels. On mobile these render as full-width
 * bottom Sheets (unchanged); on desktop (≥768px) the SAME option content renders
 * inside this compact glass Popover, dropping from the active tab/pill that
 * opened it. The popover anchors to the active tab button via `anchorRef`
 * (a virtual Radix anchor), so it always lands under the pill regardless of
 * which one is active. Styling matches the app's glass-dialog language
 * (violet-tinted border, rounded-xl, bg-popover glass).
 *
 * Behavior mirrors the sheet exactly: outside-click / Escape close it, and
 * picking an option that closes the sheet closes the popover too (the option
 * content calls onOpenChange(false) itself). Toggling stays open otherwise.
 */
export function DesktopOptionsPopover({
  open, onOpenChange, anchorRef, align = "start", title, testId, width = "w-[380px]", children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  anchorRef: RefObject<HTMLElement>;
  align?: "start" | "center" | "end";
  title: ReactNode;
  testId: string;
  width?: string;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        align={align}
        sideOffset={8}
        collisionPadding={12}
        className={cn(width, "max-h-[70vh] overflow-y-auto rounded-xl border-brand/15 p-4")}
        data-testid={testId}
      >
        <h2 className="text-sm font-brand uppercase tracking-widest mb-4">{title}</h2>
        {children}
      </PopoverContent>
    </Popover>
  );
}
