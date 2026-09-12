/**
 * A divider you drag to set a side panel's width, like an editor's side bar.
 * Double-click (or Enter) resets it; arrow keys nudge it, Shift for bigger
 * steps. The width math (limits, folding away) lives with the caller's layout
 * (lib/chat-layout): this only reports where the edge was dragged.
 *
 * Desktop only: the page renders no dividers on touch layouts.
 */
import { useEffect, useRef, useState } from "react";

export function PaneResizeHandle({ paneSide, width, min, max, label, onResize, onReset, testId }: {
  /** Which side the panel sits on: a left panel grows as you drag right. */
  paneSide: "left" | "right";
  /** The panel's current width (0 while it's folded away). */
  width: number;
  min: number;
  max: number;
  label: string;
  /** `drag.from`: the width when a pointer drag began (absent for arrow keys). */
  onResize: (width: number, drag?: { from: number }) => void;
  onReset: () => void;
  testId?: string;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const toward = paneSide === "left" ? 1 : -1;

  const endDrag = () => {
    start.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };
  // A drag that folds the panel away unmounts this divider mid-drag, before
  // any pointerup: without this the page kept the resize cursor and could no
  // longer select text (found in the browser).
  useEffect(() => () => {
    if (!start.current) return;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} · drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        setDragging(true);
        // The whole page shows the resize cursor and selects no text mid-drag.
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(start.current.width + toward * (e.clientX - start.current.x), { from: start.current.width });
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const grows = (e.key === "ArrowRight") === (paneSide === "left");
          onResize(Math.max(width, min) + (grows ? step : -step));
        } else if (e.key === "Enter") {
          e.preventDefault();
          onReset();
        }
      }}
      className="group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize touch-none select-none outline-none"
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-3 left-1/2 -translate-x-1/2 rounded-full transition-[background-color,width] duration-150 ${
          dragging ? "w-0.5 bg-brand" : "w-px bg-transparent group-hover:bg-brand/50 group-focus-visible:w-0.5 group-focus-visible:bg-brand"
        }`}
      />
    </div>
  );
}
