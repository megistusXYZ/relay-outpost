import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { condenseBio } from "@/lib/condense-bio";

/**
 * A profile bio on a phone: at most three lines, blank lines squeezed out, so
 * every profile reads the same length (owner, 2026-09-29). "Show more" appears
 * only when there's more, and gives back the author's own layout. Wider
 * screens show the bio as written.
 */
export function CollapsibleBio({ text, render }: { text: string; render: (text: string) => ReactNode }) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const collapsed = isMobile && !expanded;

  // Measured, not guessed: the toggle shows only when the three lines hide text.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !collapsed) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [collapsed, text]);

  if (!isMobile) return <>{render(text)}</>;

  return (
    <div>
      <div ref={boxRef} className={collapsed ? "line-clamp-3" : undefined} data-testid="profile-bio">
        {render(collapsed ? condenseBio(text) : text)}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="-my-2 inline-flex min-h-11 items-center pr-3 text-xs font-medium text-brand hover:text-brand/80"
          data-testid="button-bio-more"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
