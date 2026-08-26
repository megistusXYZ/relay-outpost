import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface AutoGrowTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Max pixel height before the textarea starts scrolling internally. */
  maxHeight?: number;
}

/**
 * A controlled single-line-feeling textarea that grows with its content (X /
 * iMessage style) so users always see everything they type, then scrolls once
 * it hits maxHeight. Resets cleanly when the value is cleared programmatically
 * (e.g. after sending), which a raw onInput handler can't do on its own.
 */
export function AutoGrowTextarea({ className, maxHeight = 140, value, ...props }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={cn(
        "flex max-h-[140px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}
