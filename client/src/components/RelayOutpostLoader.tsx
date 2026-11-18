/**
 * The app's loaders and its small mark, drawn as Otto (owner, 2026-11-16):
 * the open ring with the Ember dot, eyes in the ring.
 *
 *   RelayOutpostLoader        a page or section is loading: Otto thinks, the
 *                             ring whirls around a head that stays put, the
 *                             eyes glance about, the dot keeps time; a label
 *                             may sit under it
 *   RelayOutpostInlineLoader  the same, button-sized, for a row or a button
 *   RelayOutpostIcon          the mark at rest, for places that want the
 *                             brand without motion
 *
 * The export names stay as they were: three hundred call sites use them.
 * Motion lives in otto-loader.css and stops for prefers-reduced-motion.
 */
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { loaderMounted } from "@/lib/otto-busy";
import "./otto-loader.css";

const sizeMap = {
  xs: "w-3.5 h-3.5",
  sm: "w-5 h-5",
  md: "w-8 h-8",
  lg: "w-12 h-12",
};

interface RelayOutpostLoaderProps {
  size?: keyof typeof sizeMap;
  className?: string;
  label?: string;
}

/** Otto's geometry, shared by the three. `thinking` adds the loader's motion classes. */
function OttoGlyph({ className, thinking, face = true, testId }: { className?: string; thinking: boolean; face?: boolean; testId?: string }) {
  // A thinking glyph on screen tells the chrome's Otto the app is busy.
  useEffect(() => (thinking ? loaderMounted() : undefined), [thinking]);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={cn(thinking && "otto-loader", className)}
      aria-hidden="true"
      data-testid={testId}
    >
      <g className={thinking ? "ring" : undefined}>
        <path d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round" />
        <circle className={thinking ? "dot" : undefined} cx="71.2" cy="28.8" r="6.5" fill="hsl(var(--brand))" />
      </g>
      {face && (
        <g className={thinking ? "look" : undefined}>
          <g className={thinking ? "lid" : undefined}>
            <ellipse cx="42" cy="51" rx="3.6" ry="5.2" fill="currentColor" />
            <ellipse cx="58" cy="51" rx="3.6" ry="5.2" fill="currentColor" />
          </g>
        </g>
      )}
    </svg>
  );
}

export function RelayOutpostLoader({ size = "md", className, label }: RelayOutpostLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2", className)} data-testid="relay-outpost-loader" role="status" aria-label={label || "Loading"}>
      <OttoGlyph thinking className={cn(sizeMap[size], "is-page text-foreground")} />
      {label && <span className="text-[13px] text-muted-foreground">{label}</span>}
    </div>
  );
}

export function RelayOutpostIcon({ className }: { className?: string }) {
  return <OttoGlyph thinking={false} className={cn("w-3.5 h-3.5", className)} />;
}

export function RelayOutpostInlineLoader({ className }: { className?: string }) {
  return <OttoGlyph thinking className={cn("w-3.5 h-3.5", className)} testId="relay-outpost-inline-loader" />;
}
