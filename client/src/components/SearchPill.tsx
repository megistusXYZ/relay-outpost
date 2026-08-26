import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Canonical search-pill surface — ONE rounded/glass treatment for every
 * page-level search input in the app (Search, News, Communities, Chats,
 * Calendar, Following/Followers, Help, Music…).
 *
 * Exported standalone so button-shaped search *triggers* (e.g. the News hero
 * that opens the feed-search dialog) can wear the identical skin.
 *
 * Anatomy: 44px pill (comfortable tap target), violet-alpha hairline,
 * translucent glass fill (soft white in light mode, dark panel in dark mode),
 * primary focus ring with no offset so the ring hugs the pill.
 */
export const searchPillClass =
  "h-11 w-full rounded-full border border-primary/25 dark:border-primary/15 " +
  "bg-white/70 dark:bg-white/[0.04] shadow-sm dark:shadow-none " +
  "text-base sm:text-sm placeholder:text-muted-foreground/60 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 " +
  "focus-visible:ring-offset-0 focus-visible:border-primary/40 transition-colors";

export interface SearchPillProps extends React.ComponentProps<"input"> {
  /** Classes for the outer relative wrapper (widths, margins, flex sizing). */
  containerClassName?: string;
  /**
   * Optional right-edge affordance — clear button, inline loader, "+" add
   * trigger… Rendered centered at the pill's right edge; omit for a clean pill.
   */
  trailing?: React.ReactNode;
}

/**
 * SearchPill — the shared search input: leading muted Search icon, pill
 * surface, optional trailing slot. Purely presentational: value/handlers/
 * testids stay caller-owned, and any prop here overrides the defaults below.
 */
export const SearchPill = React.forwardRef<HTMLInputElement, SearchPillProps>(
  ({ className, containerClassName, trailing, ...props }, ref) => (
    <div className={cn("relative w-full", containerClassName)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
      <Input
        ref={ref}
        inputMode="search"
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        className={cn(searchPillClass, "pl-10", trailing ? "pr-11" : "pr-4", className)}
        {...props}
      />
      {trailing && (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
          {trailing}
        </div>
      )}
    </div>
  ),
);
SearchPill.displayName = "SearchPill";
