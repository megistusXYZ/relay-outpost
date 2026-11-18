import type { ReactNode } from "react";

/**
 * One row of choices where exactly one is on — the shared control of every
 * options panel (the Home feed filter, Search's media sort, a community's
 * settings). 44px targets; the picked one is filled.
 */
export function Segment<T extends string>({
  label, options, value, onChange, testPrefix, cols = 3,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; desc?: string; icon?: ReactNode }>;
  value: T | null;
  onChange: (v: T) => void;
  testPrefix: string;
  cols?: 2 | 3 | 4;
}) {
  return (
    <div>
      {label && <p className="text-[13px] font-medium text-muted-foreground mb-1.5">{label}</p>}
      <div className={`grid ${cols === 4 ? "grid-cols-4" : cols === 2 ? "grid-cols-2" : "grid-cols-3"} gap-1.5`}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`rounded-full px-2 py-2 text-sm font-medium border transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${ active ? "border-foreground bg-foreground text-background" : "border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]" }`}
              aria-pressed={active}
              data-testid={`${testPrefix}-${o.value}`}
            >
              {o.icon ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  {o.icon}
                  {o.label}
                </span>
              ) : (
                o.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
